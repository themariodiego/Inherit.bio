import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "../helpers";
import { generateOwnFileWithChosenReports, ownRunCompletions, uploadOwnFilePrepared } from "../own-report-helpers";
import { buildCarrierPairVcf } from "../fixtures/carrier-pair-fixture";
import { importSyntheticRelease, reviewSynthetic, ruleGenes, withdrawSynthetic,
  type SyntheticCondition } from "../synthetic-carrier-release";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { CARRIER_DENSITY_RECIPES, carrierDensityRecipe, type CarrierCondition } from "../../scripts/density-carrier-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { OWN_CARRIER_LIMITS } from "../../src/copy/genome/carrier";
import { LAB_CONFIRMATION_LINE, PENETRANCE_NOT_ESTABLISHED } from "../../src/copy/family/carrier-evidence";

type Facts = Record<string, Record<string, unknown>[]>;
const FIXTURE = "e2e/fixtures/carrier-pair-grch38.vcf";
const OWN_URL = "/genome/me/carrier";
/** Retyped from the approved copy, as `e2e/own-carrier-status.spec.ts` does, so the sentence must reach the reader. */
const H1 = "A change you carry";
const UNAVAILABLE =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";
const OFF = "The Observed genetic variants choice is off. You can turn it on under Reports, in Choose your reports.";
const NO_FILE = "Add a file to see a result here.";
const PREPARING = "A file is still being prepared. This check says what it covers once it is ready.";
const NOT_NEGATIVE = "This is not a negative result.";
const NOT_READ = "Some reviewed positions were not read in this file.";
const TEST_RELEASE = "Classifications from a test release, not from ClinVar.";

/** The fixture's reviewed positions, as the carrier spec reads them; distinct synthetic ids. */
const CONDITIONS: Readonly<Record<CarrierCondition, SyntheticCondition>> = {
  one: { conditionId: "SYNTHETIC:8831", conditionName: "Synthetic density recessive condition one", gene: "SYNDENA",
    assertions: [
      { variationId: 883101, variantName: "Synthetic density change one", reviewStatus: "practice guideline", reviewStars: 4,
        lastEvaluated: "2023-06-15", pos: 21_000_000, ref: "A", alt: "G" },
      { variationId: 883102, variantName: "Synthetic density change one-b", reviewStatus: "reviewed by expert panel", reviewStars: 3,
        lastEvaluated: "2024-01-01", pos: 121_000_000, ref: "A", alt: "G" },
    ] },
  two: { conditionId: "SYNTHETIC:8832", conditionName: "Synthetic density recessive condition two", gene: "SYNDENB",
    assertions: [
      { variationId: 883201, variantName: "Synthetic density change two", reviewStatus: "criteria provided, multiple submitters, no conflicts",
        reviewStars: 2, lastEvaluated: null, pos: 16_000_000, ref: "C", alt: "T" },
    ] },
  three: { conditionId: "SYNTHETIC:8833", conditionName: "Synthetic density recessive condition three", gene: "SYNDENC",
    assertions: [
      { variationId: 883301, variantName: "Synthetic density change three", reviewStatus: "reviewed by expert panel", reviewStars: 3,
        lastEvaluated: "2022-11-30", pos: 101_000_000, ref: "A", alt: "G" },
    ] },
};
const ALL = Object.values(CONDITIONS);

async function exactRows(table: string, column: string, value: string | string[]) {
  const query = adminClient().from(table).select("*", { count: "exact" });
  const result = await (Array.isArray(value) ? query.in(column, value) : query.eq(column, value));
  expect(result.error, `complete carrier ${table}`).toBeNull(); expect(result.count).not.toBeNull();
  expect(result.data!.length).toBe(result.count);
  return result.data! as Record<string, unknown>[];
}

/** Complete native rows around the capture; the native observer re-reads them independently. */
async function snapshot(accountId: string, fileId: string | null): Promise<Facts> {
  const facts: Facts = {
    profiles: await exactRows("profiles", "id", accountId),
    subjects: await exactRows("subjects", "subject_account_id", accountId),
    files: await exactRows("genome_files", "user_id", accountId),
    conditions: await exactRows("carrier_conditions", "condition_id", ALL.map(condition => condition.conditionId)),
  };
  const subjects = facts.subjects.map(subject => subject.id as string);
  assert(subjects.length > 0, "Native current subject required");
  facts.grants = await exactRows("purpose_grants", "target_id", subjects);
  facts.rule = (await ruleGenes()).map(gene => ({ gene }));
  facts.runs = fileId ? await ownRunCompletions(fileId) : [];
  if (fileId) facts.calls = await exactRows("user_variants", "file_id", fileId);
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

const block = (page: Page, condition: SyntheticCondition) =>
  page.locator(`[data-slot="carrier-status-condition"][data-condition-id="${condition.conditionId}"]`);

async function expectNoResult(page: Page) {
  await expect(page.locator("main [data-claim-block], main [data-figure-kind]")).toHaveCount(0);
  await expect(page.locator('[data-slot="carrier-limits"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Synthetic density change");
}

async function expectFinding(page: Page, condition: SyntheticCondition, copies: string) {
  const section = block(page, condition), claim = section.locator("[data-claim-block]");
  await expect(section).toHaveAttribute("data-coverage", "covered");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(condition.conditionName);
  await expect(claim).toHaveCount(1);
  await expect(claim.locator('[data-slot="carrier-status-reading"]')).toHaveText(`You: ${copies}`);
  await expect(claim.locator('[data-figure-kind="carrier-status"]')).toHaveAttribute("data-figure-basis", "observed");
  await expect(claim.locator('[data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  await expect(claim.locator('[data-slot="penetrance"]')).toHaveText(PENETRANCE_NOT_ESTABLISHED);
  await expect(claim.locator('[data-slot="assertion-source"]')).toHaveText(TEST_RELEASE);
}

async function assertState(page: Page, row: DensityStateCase, facts: Facts) {
  const recipe = carrierDensityRecipe(row); assert(recipe, "Reviewed carrier density state required");
  const plan = CARRIER_DENSITY_RECIPES[recipe];
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", plan.pageState);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\b1 in 4\b|in 100\b|\d+(\.\d+)?%|per pregnancy|For each pregnancy|your (?:future )?child/i);
  expect(facts.rule.map(row => row.gene)).toEqual(plan.active.map(name => CONDITIONS[name].gene).sort());
  const monogenic = facts.grants.filter(grant => grant.purpose === "reports.monogenic" && grant.revoked_at === null);
  expect(monogenic).toHaveLength(plan.monogenicChoice ? 1 : 0);
  if (plan.file === "none") expect(facts.files).toEqual([]);
  else {
    expect(facts.files).toHaveLength(1);
    expect(facts.files[0].status).toBe(plan.file === "held" ? "uploaded" : "stored");
  }
  if (recipe === "no-file") {
    await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(NO_FILE); await expectNoResult(page);
  } else if (recipe === "in-flight") {
    await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(PREPARING);
    await expect(page.getByText(NO_FILE, { exact: true })).toHaveCount(0); await expectNoResult(page);
  } else if (recipe === "no-reviewed-condition") {
    await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(UNAVAILABLE);
    await expect(page.getByText(OFF, { exact: true })).toHaveCount(0); await expectNoResult(page);
  } else if (recipe === "choice-off") {
    await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(OFF); await expectNoResult(page);
    await expect(page.getByRole("link", { name: "Open Reports", exact: true })).toHaveAttribute("href", "/genome/me/reports");
  } else {
    expect(facts.runs.map(run => run.purpose)).toEqual(["reports.monogenic"]);
    for (const run of facts.runs) expect(run.complete, "exact native source/live-grant completion").toBe(true);
    await expectFinding(page, CONDITIONS.one, "one copy");
    await expectFinding(page, CONDITIONS.three, "two copies");
    await expect(page.locator('[data-slot="carrier-limits"] li')).toHaveText([...OWN_CARRIER_LIMITS]);
    if (recipe === "position-not-reported") {
      // The cause, from the database: the file has no row at the reviewed position.
      expect(facts.calls.filter(call => Number(call.chrom) === 1 && Number(call.pos) === CONDITIONS.two.assertions[0].pos)).toEqual([]);
      const missing = block(page, CONDITIONS.two);
      await expect(missing).toHaveAttribute("data-coverage", "not-covered");
      await expect(missing.locator('[data-slot="carrier-status-coverage"]')).toHaveText(
        `${NOT_NEGATIVE} Your file was checked at 0 of the 1 positions known for ${CONDITIONS.two.conditionName}.`);
      await expect(missing.locator('[data-slot="carrier-status-not-read"]')).toHaveText(NOT_READ);
      await expect(missing.locator('[data-figure-kind="carrier-status"], [data-slot="lab-confirmation"]')).toHaveCount(0);
    } else await expect(page.getByText(NOT_READ, { exact: true })).toHaveCount(0);
  }
}

/**
 * The six `genome.carrier` states through the path `e2e/own-carrier-status.spec.ts`
 * uses. A fresh account per capture, the committed fixture through the real
 * upload, the real choice and generation, and a synthetic release through the
 * import and review doors only. No result, grant, call or job is seeded.
 */
export function realOwnCarrierDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-carrier-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  const fixture = path.join(input.root, FIXTURE);
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = carrierDensityRecipe(row); if (!recipe) return [];
    const plan = CARRIER_DENSITY_RECIPES[recipe];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        // The committed fixture is what its generator builds.
        expect(fs.readFileSync(fixture, "utf8")).toBe(`${buildCarrierPairVcf().join("\n")}\n`);
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const releaseId = `synthetic-density-carrier-${randomUUID().slice(0, 8)}`;
        let release: () => void = () => {};
        let continuation: Promise<void> | undefined;
        try {
          const page = await context.newPage(), email = `density-carrier-${randomUUID()}@e2e.local`;
          const password = "synthetic-density-carrier-password";
          const accountId = await createConfirmedUser(email, password);
          await importSyntheticRelease(releaseId, ALL, sourcePath);
          expect(await ruleGenes(), "importing retires every earlier synthetic release").toEqual([]);
          for (const name of plan.active) await reviewSynthetic(CONDITIONS[name], "activate", sourcePath);
          await signIn(page, email, password);
          let fileId: string | null = null, view = page;
          if (plan.file === "held") {
            // The upload's own preparation request is held, never answered by
            // the provider, and settled through to its response after capture.
            const held = new Promise<void>(resolve => { release = resolve; });
            let intercepted = 0;
            await page.route("**/api/files/*/process", async route => {
              intercepted += 1;
              continuation = (async () => {
                await held; await route.continue();
                const response = await route.request().response();
                assert(response && await response.finished() === null, "Original preparation response did not settle");
              })();
              void continuation.catch(() => {});
              await continuation;
            }, { times: 1 });
            fileId = await uploadOwnFileThroughUi(page, fixture);
            await expect.poll(() => intercepted).toBe(1);
            view = await context.newPage();
          } else if (plan.file === "prepared") {
            fileId = await uploadOwnFilePrepared(page, fixture, { fileType: "vcf" });
            if (plan.monogenicChoice) await generateOwnFileWithChosenReports(page, fileId, ["reports.monogenic"]);
          }
          const fixed = await snapshot(accountId, fileId);
          expect((await view.goto(OWN_URL))?.status()).toBe(200);
          const observe = async () => {
            const facts = await snapshot(accountId, fileId);
            expect(facts, "the complete native carrier state stays exact around capture").toEqual(fixed);
            await assertState(view, row, facts);
            return input.observeState(row, view, sourceSha256, { accountId, nativeSnapshot: facts });
          };
          await observe(); await capture({ page: view, observe });
        } finally {
          try { release(); if (continuation) await continuation; }
          finally { await withdrawSynthetic(ALL, sourcePath); await context.close(); }
        }
      } } satisfies DensityStateFixture];
  });
}
