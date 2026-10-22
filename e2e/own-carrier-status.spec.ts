import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, expectAxeClean, signIn, uploadOwnFileThroughUi } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";
import { buildCarrierPairVcf } from "./fixtures/carrier-pair-fixture";
import {
  importSyntheticRelease,
  reviewSynthetic,
  ruleGenes,
  withdrawSynthetic,
  type SyntheticAssertion,
  type SyntheticCondition,
} from "./synthetic-carrier-release";
import { OWN_CARRIER_LIMITS } from "@/copy/genome/carrier";
import { CARRIER_LIMITS_HEADING } from "@/copy/family/health-picture";
import { LAB_CONFIRMATION_LINE, PENETRANCE_NOT_ESTABLISHED, reviewedVariantLine } from "@/copy/family/carrier-evidence";

/**
 * `/genome/[subject]/carrier`: one person's own carrier status, over the
 * reviewed assertion rule, under the TEST-LOCAL acceptance build (owner
 * decision of 22 October 2026, "Carrier status and carrier-pair arithmetic
 * (G7.4)", `docs/protocol/decisions.md`).
 *
 * WHAT IS REAL. Accounts of their own; a synthetic file prepared through the
 * real upload and preparation path; the "Observed genetic variants" choice
 * signed and generated in the person's own Reports page; the page reading the
 * person's own prepared source at the rule's loci only, after
 * `filterOwnAnalysisFiles` admits it under the live grant.
 *
 * WHAT IS SYNTHETIC, and only this. The rule holds no ClinVar release in a
 * test database, so this spec imports a synthetic release through the import
 * door (`import_clinical_assertion_release_v1`, release `synthetic-…`,
 * conditions `SYNTHETIC:…`) and activates each condition through the review
 * door (`review_carrier_condition_v1`) under a reviewer identity that names
 * itself a browser test identity. The page says the classifications come
 * from a test release, not from ClinVar. Nothing is written into a person's
 * data, and every condition is withdrawn through the same door afterwards.
 *
 * THE FILE. `carrier-pair-grch38.vcf` (e2e/fixtures/PROVENANCE.md): at
 * chr1:21,000,000 one changed copy (A/G); at chr1:101,000,000 two (G/G); at
 * chr1:121,000,000 A/T, a changed letter that is not the reviewed one; and no
 * row at all at chr1:16,000,000.
 *
 * THE STATES, as `docs/route-register.json` defines them: `not-covered` (a
 * prepared file and nothing the rule admits), `consent-required` (a reviewed
 * condition active and the choice off), `complete` (every reviewed position
 * read), `partial-coverage` (a reviewed position the file does not report,
 * named with its count and why), `empty` (no file) and `processing` (a file in
 * flight). Each test establishes its cause from the database, not from the
 * page alone, because several of these render almost nothing.
 *
 * The brief's monogenic presentation law (§4, lines 1329-1335) is asserted on
 * a finding and on a condition the file does not cover: the penetrance label
 * on both; "This is not a negative result." with the checked count where no
 * reviewed change shows; the laboratory line on every finding; and the review
 * status and date as text beside it.
 */

const SPEC = "e2e/own-carrier-status.spec.ts";
const RUN_ID = randomUUID();
const RELEASE_ID = `synthetic-e2e-own-carrier-${RUN_ID.slice(0, 8)}`;
const PASSWORD = "e2e-own-carrier-status-pw";
const A = { email: `own-carrier-a-${RUN_ID}@e2e.local`, password: PASSWORD };
const EMPTY = { email: `own-carrier-empty-${RUN_ID}@e2e.local`, password: PASSWORD };
const HELD = { email: `own-carrier-held-${RUN_ID}@e2e.local`, password: PASSWORD };
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
const URL_OWN = "/genome/me/carrier";

/** Retyped rather than imported, so the assertion checks that the approved sentence reaches the reader. */
const UNAVAILABLE =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";
const OFF = "The Observed genetic variants choice is off. You can turn it on under Reports, in Choose your reports.";
const NO_FILE = "Add a file to see a result here.";
const PREPARING = "A file is still being prepared. This check says what it covers once it is ready.";
const NOT_NEGATIVE = "This is not a negative result.";
const NOT_READ = "Some reviewed positions were not read in this file.";
const TEST_RELEASE = "Classifications from a test release, not from ClinVar.";

const ONE: SyntheticCondition = {
  conditionId: "SYNTHETIC:8811", conditionName: "Synthetic recessive condition one", gene: "SYNOWNA",
  assertions: [
    { variationId: 881101, variantName: "Synthetic change one", reviewStatus: "practice guideline", reviewStars: 4,
      lastEvaluated: "2023-06-15", pos: 21_000_000, ref: "A", alt: "G" },
    { variationId: 881102, variantName: "Synthetic change one-b", reviewStatus: "reviewed by expert panel", reviewStars: 3,
      lastEvaluated: "2024-01-01", pos: 121_000_000, ref: "A", alt: "G" },
  ],
};
/** The one position this file has no row for. */
const TWO: SyntheticCondition = {
  conditionId: "SYNTHETIC:8812", conditionName: "Synthetic recessive condition two", gene: "SYNOWNB",
  assertions: [
    { variationId: 881201, variantName: "Synthetic change two", reviewStatus: "criteria provided, multiple submitters, no conflicts",
      reviewStars: 2, lastEvaluated: null, pos: 16_000_000, ref: "C", alt: "T" },
  ],
};
const THREE: SyntheticCondition = {
  conditionId: "SYNTHETIC:8813", conditionName: "Synthetic recessive condition three", gene: "SYNOWNC",
  assertions: [
    { variationId: 881301, variantName: "Synthetic change three", reviewStatus: "reviewed by expert panel", reviewStars: 3,
      lastEvaluated: "2022-11-30", pos: 101_000_000, ref: "A", alt: "G" },
  ],
};
const CONDITIONS = [ONE, TWO, THREE];

let accountA = "";
let accountEmpty = "";
let fileA = "";

test.describe.configure({ mode: "serial" });
test.use({ trace: "off" }); // Upload and presentation bearers stay out of traces.

const section = (page: Page, condition: SyntheticCondition) =>
  page.locator(`[data-slot="carrier-status-condition"][data-condition-id="${condition.conditionId}"]`);

function variantLine(assertion: SyntheticAssertion, gene: string): string {
  return reviewedVariantLine("You", { ...assertion, releaseId: RELEASE_ID }, gene, "Pathogenic");
}

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** Whether this account's own self record holds a live Observed genetic variants grant. */
async function monogenicGranted(accountId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("purpose_grants").select("grant_id")
    .eq("target_kind", "subject").eq("target_id", await selfSubjectOf(accountId)).eq("purpose", "reports.monogenic")
    .is("revoked_at", null);
  expect(error).toBeNull();
  return (data ?? []).length > 0;
}

/** Nothing a result would render: no claim block, no figure, no limits list. */
async function expectNoResult(page: Page) {
  await expect(page.locator("main [data-claim-block], main [data-figure-kind]")).toHaveCount(0);
  await expect(page.locator('[data-slot="carrier-limits"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Synthetic change");
}

/** A block with a finding, held to every part of the brief's law. */
async function expectFinding(page: Page, condition: SyntheticCondition, copies: string, checked: number,
  assertion: SyntheticAssertion, evaluated: string) {
  const block = section(page, condition);
  await expect(block).toHaveCount(1);
  await expect(block).toHaveAttribute("data-coverage", "covered");
  await expect(block.getByRole("heading", { level: 2 })).toHaveText(condition.conditionName);
  const claim = block.locator("[data-claim-block]");
  await expect(claim).toHaveCount(1);
  await expect(claim).toHaveAttribute("data-subject-id", await selfSubjectOf(accountA));
  await expect(claim.locator('[data-slot="carrier-status-reading"]')).toHaveText(`You: ${copies}`);
  await expect(claim.locator('[data-figure-kind="carrier-status"]')).toHaveAttribute("data-provenance", "computed:family/own-carrier-status");
  await expect(claim.locator('[data-figure-kind="carrier-status"]')).toHaveAttribute("data-figure-basis", "observed");
  await expect(claim.locator('[data-figure-kind="coverage"]')).toHaveText(
    `Your file was checked at ${checked} of the ${checked} positions known for ${condition.conditionName}.`);
  await expect(claim.locator('[data-slot="carrier-variant"]')).toHaveText(variantLine(assertion, condition.gene));
  await expect(claim.locator('[data-slot="carrier-variant"]')).toContainText(`(review status: ${assertion.reviewStatus}; last evaluated ${evaluated}).`);
  await expect(claim.locator('[data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  await expect(claim.locator('[data-slot="penetrance"]')).toHaveText(PENETRANCE_NOT_ESTABLISHED);
  await expect(claim.locator('[data-slot="assertion-source"]')).toHaveText(TEST_RELEASE);
  await expect(claim).not.toContainText(NOT_NEGATIVE);
  await expect(claim).not.toContainText(NOT_READ);
  await expect(claim).not.toContainText("ClinVar classifies");
}

/** The page as a whole: never a chance, never a statement about a child, never ranked. */
async function expectNoArithmetic(page: Page) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\b1 in 4\b|in 100\b|\d+(\.\d+)?%|per pregnancy|For each pregnancy|your (?:future )?child/i);
  await expect(page.locator("main [data-exact-marker], main [data-modelled-marker], main [data-slot='outcome-dot']")).toHaveCount(0);
}

test.beforeAll(async () => {
  // The committed fixture is what its generator builds, and it holds exactly
  // the rows this spec's conditions rely on.
  expect(fs.readFileSync(FIXTURE, "utf8")).toBe(`${buildCarrierPairVcf().join("\n")}\n`);
  const rows = new Map(buildCarrierPairVcf().filter(line => !line.startsWith("#")).map(line => line.split("\t"))
    .map(fields => [`${fields[0]}:${fields[1]}`, fields]));
  expect(rows.get("chr1:21000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "0/1"]);
  expect(rows.get("chr1:101000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "1/1"]);
  expect(rows.get("chr1:121000000")?.slice(3, 5)).toEqual(["A", "G,T"]);
  expect(rows.get("chr1:121000000")?.[9]).toBe("0/2");
  expect(rows.has("chr1:16000000")).toBe(false);

  accountA = await createConfirmedUser(A.email, A.password);
  accountEmpty = await createConfirmedUser(EMPTY.email, EMPTY.password);
  await createConfirmedUser(HELD.email, HELD.password);
  await importSyntheticRelease(RELEASE_ID, CONDITIONS, SPEC);
  // Importing retired every earlier synthetic release, so the rule holds none.
  expect(await ruleGenes()).toEqual([]);
});

test.afterAll(async () => {
  await withdrawSynthetic(CONDITIONS, SPEC);
});

test("/genome/[subject]/carrier not-covered: a prepared file and no condition the reviewed rule admits give the approved unavailable sentence, never a negative screen", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, A.email, A.password);
  fileA = await uploadOwnFilePrepared(page, FIXTURE, { fileType: "vcf" });
  // The file is here and prepared; the reference data supports no result.
  expect(await ruleGenes()).toEqual([]);

  await page.goto(URL_OWN);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A change you carry");
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(UNAVAILABLE);
  await expectNoResult(page);
  await expect(page.getByText(OFF, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="subject-files"]')).toHaveText("1 file");
  await expectAxeClean(page);
});

test("/genome/[subject]/carrier consent-required: with reviewed conditions active, a prepared file whose Observed genetic variants choice is off names the choice and links to where it is made", async ({ page }) => {
  await reviewSynthetic(ONE, "activate", SPEC);
  await reviewSynthetic(THREE, "activate", SPEC);
  expect(await ruleGenes()).toEqual([ONE.gene, THREE.gene]);
  expect(await monogenicGranted(accountA), "the cause: the choice was never signed").toBe(false);

  await signIn(page, A.email, A.password);
  await page.goto(URL_OWN);
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "consent-required");
  await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(OFF);
  await expectNoResult(page);
  await expect(page.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0);
  const link = page.getByRole("link", { name: "Open Reports", exact: true });
  await expect(link).toHaveAttribute("href", "/genome/me/reports");
  await link.click();
  await expect(page.getByRole("region", { name: "Choose your reports", exact: true })).toBeVisible();
});

test("/genome/[subject]/carrier complete: two reviewed conditions the file fully covers give one copy and two copies, each with its reviewed evidence", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, A.email, A.password);
  await generateOwnFileWithChosenReports(page, fileA, ["reports.monogenic"]);
  expect(await monogenicGranted(accountA)).toBe(true);

  await page.goto(URL_OWN);
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "complete");
  // Rule order, which is gene order, and nothing else.
  expect(await page.locator('[data-slot="carrier-status-condition"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute("data-gene")))).toEqual([ONE.gene, THREE.gene]);
  await expectFinding(page, ONE, "one copy", 2, ONE.assertions[0], "15 June 2023");
  await expectFinding(page, THREE, "two copies", 1, THREE.assertions[0], "30 November 2022");
  // A/T at the second reviewed position of condition one: read, and not the reviewed change.
  await expect(section(page, ONE)).not.toContainText(ONE.assertions[1].variantName);
  const limits = page.locator('[data-slot="carrier-limits"]');
  await expect(limits).toHaveCount(1);
  await expect(limits.getByRole("heading")).toHaveText(CARRIER_LIMITS_HEADING);
  await expect(limits.locator("li")).toHaveText([...OWN_CARRIER_LIMITS]);
  await expect(page.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0);
  await expectNoArithmetic(page);
  await expectAxeClean(page);
});

test("/genome/[subject]/carrier partial-coverage: a reviewed condition at a position the file does not report is named, with its count and why, beside the results that stay", async ({ page }) => {
  await reviewSynthetic(TWO, "activate", SPEC);
  expect(await ruleGenes()).toEqual([ONE.gene, TWO.gene, THREE.gene]);
  // The cause, from the database: the file has no row at the reviewed position.
  const { count, error } = await adminClient().from("user_variants").select("id", { count: "exact", head: true })
    .eq("file_id", fileA).eq("chrom", 1).eq("pos", TWO.assertions[0].pos);
  expect(error).toBeNull();
  expect(count).toBe(0);

  await signIn(page, A.email, A.password);
  await page.goto(URL_OWN);
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "partial-coverage");
  await expectFinding(page, ONE, "one copy", 2, ONE.assertions[0], "15 June 2023");
  await expectFinding(page, THREE, "two copies", 1, THREE.assertions[0], "30 November 2022");
  const missing = section(page, TWO);
  await expect(missing).toHaveAttribute("data-coverage", "not-covered");
  await expect(missing).toHaveAttribute("data-carrier-reading", "none");
  await expect(missing.locator('[data-slot="carrier-status-coverage"]')).toHaveText(
    `${NOT_NEGATIVE} Your file was checked at 0 of the 1 positions known for ${TWO.conditionName}.`);
  await expect(missing.locator('[data-slot="carrier-status-not-read"]')).toHaveText(NOT_READ);
  await expect(missing.locator('[data-slot="penetrance"]')).toHaveText(PENETRANCE_NOT_ESTABLISHED);
  await expect(missing.locator('[data-slot="assertion-source"]')).toHaveText(TEST_RELEASE);
  await expect(missing.locator('[data-figure-kind="carrier-status"], [data-slot="lab-confirmation"], [data-slot="carrier-variant"]')).toHaveCount(0);
  await expect(missing).not.toContainText(TWO.assertions[0].variantName);
  await expect(missing).not.toContainText(/\bno copy\b|\bclear\b|\bnormal\b/i);
  await expectNoArithmetic(page);
});

test("/genome/[subject]/carrier empty: with reviewed conditions active and no file, the page says to add one and reads no result", async ({ page }) => {
  expect((await ruleGenes()).length).toBeGreaterThan(0);
  const { data: files, error } = await adminClient().from("genome_files").select("id").eq("user_id", accountEmpty);
  expect(error).toBeNull();
  expect(files, "empty because nothing was uploaded").toEqual([]);

  await signIn(page, EMPTY.email, EMPTY.password);
  await page.goto(URL_OWN);
  await expect(page.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "empty");
  await expect(page.locator('[data-slot="carrier-status-state"]')).toHaveText(NO_FILE);
  await expectNoResult(page);
  await expect(page.getByText("A file is still being prepared", { exact: false })).toHaveCount(0);
  await expect(page.getByText(UNAVAILABLE, { exact: true })).toHaveCount(0);
});

test.describe("a file in flight", () => {
  let context: BrowserContext;
  let release: () => void = () => {};

  test.afterAll(async () => {
    release();
    await context?.close();
  });

  test("/genome/[subject]/carrier processing: a file still being prepared is said to be in flight, not absent", async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300_000);
    expect((await ruleGenes()).length).toBeGreaterThan(0);
    context = await browser.newContext();
    const holder = await context.newPage();
    await signIn(holder, HELD.email, HELD.password);
    const held = new Promise<void>((resolve) => { release = resolve; });
    await holder.route("**/api/files/*/process", async (route) => {
      await held;
      await route.continue();
    }, { times: 1 });
    const fileId = await uploadOwnFileThroughUi(holder, FIXTURE);
    const stored = await adminClient().from("genome_files").select("status").eq("id", fileId).single();
    expect(stored.error).toBeNull();
    expect(stored.data!.status, "the state this test waits inside is the server's, not the test's").toBe("uploaded");

    const view = await context.newPage();
    await view.goto(URL_OWN);
    await expect(view.locator('[data-slot="carrier-status"]')).toHaveAttribute("data-state", "processing");
    await expect(view.locator('[data-slot="carrier-status-state"]')).toHaveText(PREPARING);
    await expect(view.getByText(NO_FILE, { exact: true }), "no instruction to add a file that is already here").toHaveCount(0);
    await expectNoResult(view);
  });
});

test("the carrier page answers an unknown or someone else's record exactly like a missing page", async ({ page }) => {
  await signIn(page, A.email, A.password);
  for (const segment of [`s-${randomUUID()}`, "not-a-subject"]) {
    expect((await page.request.get(`/genome/${segment}/carrier`)).status()).toBe(404);
  }
});
