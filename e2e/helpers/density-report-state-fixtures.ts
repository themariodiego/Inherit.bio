import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, seededTemplateCount, signIn } from "../helpers";
import { generateOwnFileWithChosenReports, ownRunCompletions, uploadOwnFilePrepared } from "../own-report-helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { reportDensityRecipe, type ReportDensityRecipe } from "../../scripts/density-report-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES, type OwnReportPurpose } from "../../src/lib/uploads/own-report-purpose";
import { COUNT_NOUNS, LIMIT_OF_FILE, LIST_NO_FILE, NOT_COVERED_VCF, NOT_DIAGNOSTIC, coverageSentence } from "../../src/copy/reports/strings";
import { BROWSER_NO_FILE, BROWSER_PREPARING, SCORE_COVERAGE_NO_FILE, SCORE_COVERAGE_PREPARING, SEARCH_LABEL,
  rsidNotCovered } from "../../src/copy/genome/data";
import { REPORTS_PREPARING } from "../../src/copy/genome/preparation";
import { PREPARED_REPORTS, PRIMARY, STARTER, STATE_A_LEDE, STATE_C } from "../../src/copy/overview";
import { regionalBelowMinimum } from "../../src/copy/regional-ancestry";
import { REGIONAL_EMPTY_NOTE } from "../../src/lib/genome/regional-admixture";
import regionalManifest from "../../data/ref/aims-seven-region-manifest.json";
import nothingReceipt from "../fixtures/synthetic-browser-grch38.receipt.json";
import { ANCESTRY_OFF, ANCESTRY_REPORTS_LINK, NOTHING_READ } from "../../src/copy/ancestry";

type Facts = Record<string, Record<string, unknown>[]>;
const fixturePaths: Record<ReportDensityRecipe, string> = { tiny: "e2e/fixtures/tiny-grch38.vcf",
  nothing: nothingReceipt.fixture.path, partial: "e2e/fixtures/tiny-b-grch38.vcf",
  full: "e2e/fixtures/density-source-grch38.vcf", "ancestry-shown": "e2e/fixtures/aims-mixed-grch38.vcf",
  "ancestry-off": "e2e/fixtures/aims-mixed-grch38.vcf", "reports-off": "e2e/fixtures/tiny-grch38.vcf" };
const genomePaths: Record<string, string> = { "genome.subject": "/genome/me", "genome.reports": "/genome/me/reports",
  "genome.data": "/genome/me/data", "genome.ancestry": "/genome/me/ancestry" };

async function snapshot(accountId: string, fileId: string): Promise<Facts> {
  const admin = adminClient(), facts: Facts = {};
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).eq("id", accountId)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" }).eq("subject_account_id", accountId)],
    ["principals", admin.from("subject_principals").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["files", admin.from("genome_files").select("*", { count: "exact" }).eq("user_id", accountId)],
    ["scores", admin.from("prs_scores").select("*", { count: "exact" })],
    ["reference", admin.from("ref_variants").select("*", { count: "exact" }).eq("gene_symbol", "CYP1A2")],
  ] as const) {
    const result = await query;
    expect(result.error, `complete report ${name}`).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[name] = result.data!;
  }
  expect(facts.files).toHaveLength(1);
  expect(facts.files[0]).toMatchObject({ id: fileId, user_id: accountId, status: "stored" });
  expect(facts.files[0].normalization_completed_at).not.toBeNull();
  expect(facts.files[0].single_logical_sample_verified_at).not.toBeNull();
  expect(facts.files[0].normalization_source_revision).toBe(facts.files[0].upload_revision);
  for (const table of ["user_prs", "user_variants", "report_observed_calls", "ancestry_results"]) {
    const result = await admin.from(table).select("*", { count: "exact" }).eq("file_id", fileId);
    expect(result.error, `complete report ${table}`).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[table] = result.data!;
  }
  const subjects = facts.subjects.map(subject => subject.id as string);
  assert(subjects.length > 0, "Native current subject required");
  const grants = await admin.from("purpose_grants").select("*", { count: "exact" }).eq("target_kind", "subject").in("target_id", subjects);
  expect(grants.error).toBeNull(); expect(grants.count).not.toBeNull(); expect(grants.data!.length).toBe(grants.count);
  facts.grants = grants.data!;
  facts.runs = await ownRunCompletions(fileId);
  for (const run of facts.runs) {
    expect(run.complete, "exact native source/live-grant completion").toBe(true); expect(run.completed_at).not.toBeNull();
  }
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

function panelRows(facts: Facts) {
  expect(facts.user_prs).toHaveLength(facts.scores.length); expect(facts.scores.length).toBeGreaterThan(0);
  return facts.user_prs.map(row => {
    const score = facts.scores.find(score => score.pgs_id === row.pgs_id); assert(score, "Actual panel row required");
    assert(Number.isInteger(row.matched) && Number.isInteger(score.n_variants), "Native integer coverage required");
    return { id: row.pgs_id as string, name: score.name as string, matched: row.matched as number, needed: score.n_variants as number };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Only existing canonical upload, explicit report choices and current native
 * reads create these result states. No saved result or completed job is seeded. */
export function realOwnReportDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; fileId: string; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-report-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = reportDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), email = `density-report-${randomUUID()}@e2e.local`, password = "synthetic-density-report-password";
        try {
          const accountId = await createConfirmedUser(email, password); await signIn(page, email, password);
          const fileId = await uploadOwnFilePrepared(page, path.join(input.root, fixturePaths[recipe]), { fileType: "vcf" });
          let unchosenMutations = 0;
          if (recipe === "reports-off") page.on("request", request => {
            const url = new URL(request.url());
            if (request.method() !== "GET" && url.origin === origin.origin
              && (url.pathname === "/api/consents" || /^\/api\/consents\//.test(url.pathname)
                || url.pathname === `/api/files/${fileId}/process`)) unchosenMutations += 1;
          });
          const purposes: readonly OwnReportPurpose[] = recipe === "reports-off" || row.route.id === "genome.browser" ? []
            : row.route.id === "app.overview" ? ["reports.monogenic", "reports.polygenic", "ancestry"]
            : row.route.id === "genome.ancestry" ? ["ancestry"]
            : row.route.id === "genome.reports" ? ["reports.monogenic", "reports.polygenic"] : ["reports.polygenic"];
          const [firstPurpose, ...remainingPurposes] = purposes;
          if (firstPurpose) await generateOwnFileWithChosenReports(page, fileId, [firstPurpose, ...remainingPurposes]);
          let expectedRuns = [...purposes].sort();
          let fixedRevokedFacts: Facts | undefined;
          const fixedUnchosenFacts = recipe === "reports-off" ? await snapshot(accountId, fileId) : undefined;
          if (fixedUnchosenFacts) assertUnchosenNative(fixedUnchosenFacts);
          let actualPath = genomePaths[row.route.id] ?? row.route.path;
          if (row.route.id === "genome.report") actualPath = `/genome/me/reports/${row.state === "partial-coverage"
            ? "lactase-persistence-lct-rs4988235" : "caffeine-metabolism-cyp1a2-rs762551"}`;
          if (row.route.id === "genome.browser") actualPath = `/genome/me/data/browser?q=${row.state === "partial-coverage" ? "CYP1A2" : "rs762551"}`;
          if (recipe === "ancestry-off") {
            // Absence alone cannot prove revocation. Establish the actual
            // generated result and exact live-source journal first.
            expect((await page.goto("/genome/me/ancestry"))?.status()).toBe(200);
            await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "shown");
            expect(await page.locator('[data-figure-kind="ancestry-share"]').count()).toBeGreaterThan(0);
            const before = await snapshot(accountId, fileId);
            expect(before.runs.map(run => run.purpose)).toEqual(["ancestry"]);
            const live = before.grants.filter(grant => grant.purpose === "ancestry" && grant.revoked_at === null);
            expect(live).toHaveLength(1);
            expect((await page.goto("/genome/me/reports"))?.status()).toBe(200);
            const choice = page.getByRole("region", { name: "Choose your reports", exact: true });
            const revoked = page.waitForResponse(response => /\/api\/consents\/[0-9a-f-]{36}\/revoke$/.test(response.url())
              && response.request().method() === "POST");
            await choice.getByRole("button", { name: "Turn off Ancestry", exact: true }).click();
            const response = await revoked; expect(response.status()).toBe(200);
            expect(await response.json()).toMatchObject({ revoked: true }); expect(await response.finished()).toBeNull();
            const after = await snapshot(accountId, fileId);
            expect(after.runs, "native derived journal is purged, not merely hidden").toEqual([]);
            const revokedGrant = after.grants.find(grant => grant.grant_id === live[0].grant_id);
            assert(revokedGrant && typeof revokedGrant.revoked_at === "string", "The exact live grant must be retained as revoked");
            expect(after.grants.filter(grant => grant.purpose !== "ancestry"))
              .toEqual(before.grants.filter(grant => grant.purpose !== "ancestry"));
            for (const name of ["files", "report_observed_calls", "user_prs", "user_variants", "ancestry_results"])
              expect(after[name], "revocation preserves the actual canonical source and other outputs").toEqual(before[name]);
            expectedRuns = []; fixedRevokedFacts = after;
          }
          if (row.route.id === "genome.reports" && recipe === "nothing") {
            // Both layers must genuinely have been generated and be uncovered.
            // A single open group cannot prove a whole-page no-coverage state.
            for (const [layer, cls, noun] of [
              ["estimate", "estimate", COUNT_NOUNS.estimate.other],
              ["variant_call", "variant-call", COUNT_NOUNS["variant-call"].other],
            ] as const) {
              const response = await page.goto(`/genome/me/reports${layer === "estimate" ? "" : "?layer=variant_call"}`);
              expect(response?.status()).toBe(200);
              await assertUncoveredLibrary(page, layer, cls, noun);
            }
          }
          // Establish the native regional branch before the hub hides its details.
          if (row.route.id === "app.overview") {
            await page.goto("/genome/me/ancestry");
            const regional = page.locator('[data-slot="regional-ancestry"]');
            if (recipe === "full") await expect(regional.locator('[data-figure-kind="coverage"] [data-slot="figure-value"]'))
              .toHaveText(`read ${regionalManifest.markerCount} of the ${regionalManifest.markerCount} positions this needs`);
            else if (recipe === "nothing") {
              await expect(regional.locator('[data-slot="grey-state"]')).toHaveText(regionalBelowMinimum(0, regionalManifest.markerCount));
              await expect(regional.locator('[data-slot="stored-support-note"]')).toHaveText(REGIONAL_EMPTY_NOTE);
            }
          }
          const response = await page.goto(actualPath); expect(response?.status()).toBe(200);
          if (recipe === "reports-off") {
            for (const layer of ["estimate", "variant_call"] as const) {
              expect((await page.goto(`/genome/me/reports${layer === "estimate" ? "" : "?layer=variant_call"}`))?.status()).toBe(200);
              await assertUnchosenLibrary(page, layer, layer === "estimate" ? "estimate" : "variant-call");
            }
            expect((await page.goto(actualPath))?.status()).toBe(200);
          }
          if (row.state === "partial-coverage" && row.route.id === "genome.reports") {
            // Both whole library layers must show a real covered and an
            // uncovered part. The fixture holds if the current library lacks either.
            for (const layer of ["estimate", "variant_call"] as const) {
              expect((await page.goto(`/genome/me/reports${layer === "estimate" ? "" : "?layer=variant_call"}`))?.status()).toBe(200);
              await assertPartialLibrary(page, layer === "estimate" ? "estimate" : "variant-call");
            }
            expect((await page.goto(actualPath))?.status()).toBe(200);
          }
          const observe = async () => {
            const facts = await snapshot(accountId, fileId);
            expect(facts.runs.map(run => run.purpose).sort()).toEqual(expectedRuns);
            if (fixedRevokedFacts) expect(facts, "the revoked full native state stays exact around capture").toEqual(fixedRevokedFacts);
            if (fixedUnchosenFacts) {
              assertUnchosenNative(facts);
              expect(facts, "the complete prepared source and absent choices/results stay exact around capture").toEqual(fixedUnchosenFacts);
              expect(unchosenMutations, "no choice, revocation or generation request creates this missing-choice state").toBe(0);
            }
            await assertState(page, row, recipe, facts);
            return input.observeState(row, page, sourceSha256, { accountId, fileId, nativeSnapshot: facts });
          };
          await observe(); await capture({ page, observe });
        } finally { await context.close(); }
      } } satisfies DensityStateFixture];
  });
}

function assertUnchosenNative(facts: Facts) {
  expect(facts.runs).toEqual([]);
  expect(facts.user_prs).toEqual([]); expect(facts.ancestry_results).toEqual([]);
  expect(facts.grants.filter(grant => OWN_REPORT_PURPOSES.some(purpose => purpose === grant.purpose))).toEqual([]);
  expect(facts.user_variants.length + facts.report_observed_calls.length,
    "a real prepared canonical source is retained; missing choice is not missing data").toBeGreaterThan(0);
}

async function assertUnchosenLibrary(page: Page, layer: "estimate" | "variant_call", cls: "estimate" | "variant-call") {
  const choices = page.getByRole("region", { name: "Choose your reports", exact: true });
  await expect(choices).toBeVisible();
  await expect(choices.getByRole("checkbox")).toHaveCount(OWN_REPORT_PURPOSES.length);
  for (const purpose of OWN_REPORT_PURPOSES) {
    const choice = OWN_REPORT_CHOICES[purpose];
    await expect(choices.getByRole("checkbox", { name: choice.label, exact: true })).not.toBeChecked();
    await expect(choices.getByRole("checkbox", { name: choice.label, exact: true })).toBeEnabled();
    await expect(choices.getByRole("button", { name: `Enable ${choice.label}`, exact: true })).toBeDisabled();
    await expect(choices.getByRole("button", { name: `Turn off ${choice.label}`, exact: true })).toHaveCount(0);
    await expect(choices.getByText(choice.description, { exact: true })).toBeVisible();
  }
  await expect(choices.getByRole("button", { name: "Generate selected reports", exact: true })).toBeDisabled();
  for (const text of [
    "Start with trait reports to explore findings from your file. Each choice is independent; you do not need to enable everything. You can turn a choice off here later.",
    "Enable a report type above to get started. Your file stays stored even if every choice is off.",
  ]) await expect(choices.getByText(text, { exact: true })).toBeVisible();
  await expect(choices.getByRole("status")).toHaveCount(0); await expect(choices.getByRole("alert")).toHaveCount(0);
  const library = page.locator(`[data-library-layer="${cls}"]`), cards = library.locator("li[data-card]");
  await expect(library).toHaveCount(1); expect(await cards.count()).toBeGreaterThan(0);
  await expect(library.locator('[data-coverage-status="awaiting"]')).toHaveCount(await cards.count());
  await expect(library.locator('[data-coverage-status="covered"], [data-coverage-status="not-covered"]')).toHaveCount(0);
  const noun = cls === "estimate" ? COUNT_NOUNS.estimate.other : COUNT_NOUNS["variant-call"].other;
  const counts = page.locator(`main header [data-slot="count"][data-figure-class="${cls}"]`);
  await expect(counts).toHaveCount(1); await expect(counts).toHaveText(`${seededTemplateCount(layer)} ${noun}`);
  await expect(page.locator("[data-personal-preview], [data-figure-kind]")).toHaveCount(0);
  for (const copy of [REPORTS_PREPARING, LIST_NO_FILE]) await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
}

async function assertPartialLibrary(page: Page, cls: "estimate" | "variant-call") {
  const library = page.locator(`[data-library-layer="${cls}"]`), cards = library.locator("li[data-card]");
  await expect(library).toHaveCount(1);
  const total = await cards.count(), covered = await library.locator('[data-coverage-status="covered"]').count();
  const missing = await library.locator('[data-coverage-status="not-covered"]').count();
  expect(covered).toBeGreaterThan(0); expect(missing).toBeGreaterThan(0); expect(covered + missing).toBe(total);
  await expect(library.locator('[data-coverage-status="awaiting"]')).toHaveCount(0);
}

async function assertUncoveredLibrary(page: Page, layer: "estimate" | "variant_call", cls: "estimate" | "variant-call", noun: string) {
  const counts = page.locator(`main header [data-slot="count"][data-figure-class="${cls}"]`);
  await expect(counts).toHaveCount(2); await expect(counts.first()).toHaveText(`0 ${noun} covered by your file`);
  await expect(counts.nth(1)).toHaveText(`${seededTemplateCount(layer)} ${noun}`);
  const library = page.locator(`[data-library-layer="${cls}"]`), cards = library.locator("li[data-card]");
  await expect(library).toHaveCount(1); expect(await cards.count()).toBeGreaterThan(0);
  await expect(library.locator('[data-coverage-status="not-covered"]')).toHaveCount(await cards.count());
  await expect(library.locator('[data-coverage-status="covered"], [data-coverage-status="awaiting"]')).toHaveCount(0);
  await expect(page.locator("[data-personal-preview], [data-figure-kind]")).toHaveCount(0);
  for (const copy of [REPORTS_PREPARING, LIST_NO_FILE]) await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
}

async function assertState(page: Page, row: DensityStateCase, recipe: ReportDensityRecipe, facts: Facts) {
  await expect(page.locator("main h1")).toHaveCount(1);
  if (recipe === "nothing") {
    expect(facts.user_variants.some(call => call.rsid === 762551)).toBe(false);
    for (const panel of facts.user_prs) expect(panel.matched).toBe(0);
  }
  if (row.route.id === "app.overview") {
    await expect(page.getByText(STATE_A_LEDE, { exact: true })).toHaveCount(0);
    await expect(page.getByText(PREPARED_REPORTS.title, { exact: true })).toHaveCount(0);
    await expect(page.getByText(STATE_C.justYou, { exact: true })).toBeVisible();
    await expect(page.getByText(STATE_C.noEmbryoFiles, { exact: true })).toBeVisible();
    const counts = page.locator("[data-metric-value]");
    await expect(counts.first()).toHaveText(`${seededTemplateCount("estimate")} ${COUNT_NOUNS.estimate.other}`);
    await expect(counts.nth(1)).toHaveText(`${seededTemplateCount("variant_call")} ${COUNT_NOUNS["variant-call"].other}`);
    await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
    await expect(page.locator('main [data-variant="default"]')).toHaveAccessibleName(PRIMARY.openReports);
    const starter = page.locator('section[aria-labelledby="starter-title"]');
    if (recipe === "nothing") {
      expect(panelRows(facts).every(panel => panel.matched === 0)).toBe(true);
      await expect(starter.locator("#starter-title")).toHaveText(STARTER.none); await expect(starter.getByRole("link")).toHaveCount(0);
    } else await expect(starter.locator("ol").getByRole("link")).toHaveCount(recipe === "full" ? 5 : 4);
    if (recipe === "full") await expect(page.getByText(STATE_C.ancestryTooFew, { exact: true })).toHaveCount(0);
    else await expect(page.getByText(STATE_C.ancestryTooFew, { exact: true })).toBeVisible();
    await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();
  } else if (row.route.id === "genome.subject") {
    await expect(page.locator('[data-slot="subject-files"]')).toHaveText("1 file");
    const tools = page.getByRole("region", { name: "Genome tools" }); await expect(tools.locator("article")).toHaveCount(3);
    for (const [name, href] of [["Reports", "/genome/me/reports"], ["Ancestry", "/genome/me/ancestry"], ["Copilot", "/copilot/me"]])
      await expect(tools.getByRole("link", { name: `Open ${name}`, exact: true })).toHaveAttribute("href", href);
    await expect(page.getByText("A file is still being prepared", { exact: false })).toHaveCount(0);
  } else if (row.route.id === "genome.reports") {
    if (recipe === "reports-off") {
      assertUnchosenNative(facts); await assertUnchosenLibrary(page, "estimate", "estimate"); return;
    }
    for (const [cls, noun] of [["estimate", COUNT_NOUNS.estimate.other], ["variant-call", COUNT_NOUNS["variant-call"].other]]) {
      const counts = page.locator(`main header [data-slot="count"][data-figure-class="${cls}"]`);
      await expect(counts).toHaveCount(2);
      if (recipe === "nothing") await expect(counts.first()).toHaveText(`0 ${noun} covered by your file`);
    }
    await expect(page.getByText(REPORTS_PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.getByText(LIST_NO_FILE, { exact: true })).toHaveCount(0);
    if (recipe === "nothing") await assertUncoveredLibrary(page, "estimate", "estimate", COUNT_NOUNS.estimate.other);
    if (row.state === "partial-coverage") await assertPartialLibrary(page, "estimate");
  } else if (row.route.id === "genome.report") {
    await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveText([
      "What this is", "Your result", "What this doesn’t mean", "How sure we are", "What you can do", "Where this comes from"]);
    const result = page.locator('section[aria-labelledby="your-result"]');
    const genotype = result.locator('[data-figure-kind="genotype"]');
    if (recipe === "nothing") {
      await expect(genotype).toHaveCount(0);
      await expect(result.getByText(NOT_COVERED_VCF, { exact: true })).toBeVisible();
      await expect(result.getByText(LIMIT_OF_FILE, { exact: true })).toBeVisible();
    } else {
      await expect(genotype).toHaveCount(1); await expect(genotype).toHaveAttribute("data-figure-basis", "observed");
      await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText(row.state === "partial-coverage" ? "A/A" : "A/C");
      const self = facts.files[0].subject_id as string;
      for (const block of await page.locator("[data-claim-block][data-subject-id]").all()) await expect(block).toHaveAttribute("data-subject-id", self);
      if (row.state === "partial-coverage") {
        await expect(result.locator('[data-variant-result="182549"] [data-outcome="not-covered"]')).toHaveCount(1);
        await expect(page.locator('section[aria-labelledby="how-sure-we-are"]')).toContainText(coverageSentence(1, 2));
      }
    }
    await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
    await expect(page.getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC);
  } else if (row.route.id === "genome.data") {
    const panels = panelRows(facts), items = page.locator('li[data-slot="score-panel-result"]');
    await expect(items).toHaveCount(panels.length);
    for (const [index, panel] of panels.entries()) {
      if (recipe === "partial") { expect(panel.matched).toBeGreaterThan(0); expect(panel.matched).toBeLessThan(panel.needed); }
      await expect(items.nth(index).locator('[data-slot="score-panel-id"]')).toHaveText(panel.id);
      await expect(items.nth(index).locator(':scope > [data-claim-block] [data-figure-kind="coverage"] [data-slot="figure-value"]'))
        .toHaveText(`read ${panel.matched} of the ${panel.needed} positions this needs`);
    }
    for (const copy of [SCORE_COVERAGE_NO_FILE, SCORE_COVERAGE_PREPARING]) await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
  } else if (row.route.id === "genome.browser") {
    await expect(page.getByLabel(SEARCH_LABEL)).toHaveValue(row.state === "partial-coverage" ? "CYP1A2" : "rs762551");
    for (const copy of [BROWSER_NO_FILE, BROWSER_PREPARING]) await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
    if (recipe === "nothing") {
      const reference = facts.reference.find(variant => variant.rsid === 762551); assert(reference, "Native reference required");
      await expect(page.getByText(rsidNotCovered(762551, reference.gene_symbol as string), { exact: true })).toBeVisible();
      await expect(page.locator('#results, [data-figure-kind="genotype"]')).toHaveCount(0);
    } else {
      const figure = page.locator('#results [data-figure-kind="genotype"]'); await expect(figure).toHaveCount(1);
      await expect(figure).toHaveAttribute("data-figure-basis", "observed");
      await expect(figure.locator('[data-slot="figure-value"]')).toHaveText("A/C");
      const rows = page.locator("#results table tbody tr");
      if (row.state === "complete") await expect(rows).toHaveCount(1);
      else {
        expect(facts.reference.length).toBeGreaterThan(1); await expect(rows).toHaveCount(facts.reference.length);
        const missing = rows.filter({ hasNotText: "rs762551" });
        for (const cell of await missing.all()) { await expect(cell).toContainText("Not covered by your file"); await expect(cell.locator("[data-figure-kind]")).toHaveCount(0); }
      }
    }
  } else if (row.route.id === "genome.ancestry") {
    const map = page.locator('[data-slot="ancestry-map"]');
    await expect(map).toHaveAttribute("data-mode", recipe === "ancestry-shown" ? "shown" : "grey");
    if (recipe === "ancestry-off") {
      expect(facts.runs).toEqual([]);
      const off = page.locator('[data-slot="ancestry-off"]'); await expect(off).toHaveCount(3);
      for (let panel = 0; panel < 3; panel++) {
        await expect(off.nth(panel).getByText(ANCESTRY_OFF, { exact: true })).toBeVisible();
        await expect(off.nth(panel).getByRole("link", { name: ANCESTRY_REPORTS_LINK, exact: true }))
          .toHaveAttribute("href", "/genome/me/reports");
      }
      await expect(page.locator('[data-figure-kind="ancestry-share"], [data-slot="ancestry-not-generated"], [data-slot="nothing-read"]')).toHaveCount(0);
      await expect(page.getByText(NOTHING_READ, { exact: true })).toHaveCount(0);
    } else if (recipe === "nothing") {
      await expect(page.locator('[data-slot="regional-ancestry"] [data-slot="grey-state"]')).toHaveText(regionalBelowMinimum(0, regionalManifest.markerCount));
      await expect(page.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(0);
    } else {
      const shares = page.locator('[data-figure-kind="ancestry-share"]'); expect(await shares.count()).toBeGreaterThan(0);
      for (const share of await shares.all()) {
        await expect(share).toHaveAttribute("data-figure-basis", "modelled");
        await expect(share.locator('[data-slot="figure-value"]')).toHaveText(/^\d+\.\d%$/);
      }
    }
  } else throw new Error("Unreviewed report density route");
}
