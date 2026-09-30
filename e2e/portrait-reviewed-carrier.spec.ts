import { type Page } from "@playwright/test";
import { expect, test } from "./audited-test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  acceptAdultInvitation,
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  createConfirmedUser,
  drainMailUntil,
  expectAxeClean,
  signIn,
} from "./helpers";
import { uploadOwnFilePrepared } from "./own-report-helpers";
import { buildCarrierPairVcf, verify, verifyAgainst } from "./fixtures/carrier-pair-fixture";
import { buildCarrierPairBVcf, CARRIER_B_POSITIONS } from "./fixtures/carrier-pair-b-fixture";
import {
  ACKNOWLEDGE_BUTTON,
  CHANCE_NOT_PREDICTION,
  DELETE_BUTTON,
  HEADER_SENTENCE,
  NO_CLASSIFIED_POSITIONS,
  NO_POSITIONS_BOTH_COVER,
  OUTCOME_LEGEND,
  PORTRAIT_H1,
  POSITIONS_NOT_COVERED_READING,
  REFUSALS,
  RUNS_CHECKED_STATEMENT,
  SEGREGATION_SENTENCE,
  TRAIT_NAMES,
  cannotCalculate,
  knownChangesCovered,
  oneSidedWhatWouldChange,
  unregisteredCard,
} from "@/copy/family/portrait";
import {
  LAB_CONFIRMATION_LINE,
  PENETRANCE_NOT_ESTABLISHED,
  assertionSourceLine,
  reviewedVariantLine,
} from "@/copy/family/carrier-evidence";
import { EXACT_MARKER } from "@/lib/figures/contract";
import { TRAIT_KEYS } from "@/lib/family/traits";

/**
 * `/family/portrait/[pairId]` with a result: the future-child preview's
 * positive contract (brief G5.9, line 2655) and the two states that need one,
 * `complete` and `partial-coverage`.
 *
 * WHAT IS REAL. Two adults with their own accounts; an invitation accepted by
 * B; both Portrait grants signed in each person's own permission UI; both
 * acknowledgements through the real checkbox; the Tier-2 gate passed in each
 * session. Each adult prepares a synthetic file through the prepared upload
 * path, which now stores that file's runs-of-homozygosity measure as the
 * verified bytes stream past (`record_own_normalization_runs_v1`). The page
 * reads both prepared sources only through
 * `family_portrait_carrier_calls_v1`, which proves the readiness receipt the
 * page captured and reads each file at the reviewed rule's loci only.
 *
 * WHAT IS SYNTHETIC, and only this. The reviewed carrier rule holds no ClinVar
 * release in a test database, so this spec imports a synthetic one through
 * the import door (`import_clinical_assertion_release_v1`, release id
 * `synthetic-…`, condition ids `SYNTHETIC:…`) and a named test reviewer
 * activates each condition through the review door
 * (`review_carrier_condition_v1`). The rule refuses a synthetic condition
 * under a ClinVar release and the reverse, and the page says the
 * classifications come from a test release, not from ClinVar. Nothing is
 * written into a person's data. The conditions are withdrawn through the
 * same review door after the suite.
 *
 * THE FILES. A prepares `carrier-pair-grch38.vcf`; B prepares
 * `carrier-pair-b-grch38.vcf`. Both are synthetic and registered in
 * `e2e/fixtures/PROVENANCE.md`. At chr1:61,000,000 both carry one changed
 * copy (A/G); at chr1:141,000,000 both read A/T, a changed letter that is not
 * the reviewed one; at chr1:10,000,000 only A's file has a row (C/T), and B's
 * file does not report the position at all.
 *
 * THE TWO STATES, as `docs/route-register.json` defines them:
 *   - `complete` (the "permitted-and-able" reading): every grant is signed,
 *     both prepared sources are read, both runs measures were taken, and the
 *     one reviewed condition's two known positions are covered by both files.
 *     The page shows the one result the rule admits and nothing is absent for
 *     want of a permission or a source.
 *   - `partial-coverage` (the "coverage" reading): a second reviewed
 *     condition is activated whose only known change sits at a position B's
 *     file does not report. The first result stays; the second is absent, and
 *     the page names which calculation and why: B's file does not cover that
 *     change.
 *
 * G5.9, word by word, on the page with a result: (a) no `img`, `canvas`,
 * `svg`, `picture` or `video` in the result region, and none of the
 * `svg[role=img]` figures anywhere in `main`; (b) every figure is a count out
 * of 100 possible children, and every claim block carries "This is a chance,
 * not a prediction about a particular child."; (c) every trait card is one of
 * the allowlist's classes, unregistered and without a figure; (d) no
 * second-person possessive about a child anywhere in the rendered page.
 */

const RUN_ID = randomUUID();
const A = { email: `portrait-reviewed-a-${RUN_ID}@e2e.local`, password: "e2e-portrait-reviewed-pw" };
const B = { email: `portrait-reviewed-b-${RUN_ID}@e2e.local`, password: "e2e-portrait-reviewed-pw" };
const FIXTURE_A = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
const FIXTURE_B = path.join(process.cwd(), "e2e/fixtures/carrier-pair-b-grch38.vcf");

/** A sees B through the invitation's handle; B sees A as the unnamed self. */
const INVITEE_LABEL = "Invited adult";
const INVITER_LABEL = "Another adult";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const DERIVATION = "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither";
/** G5.9(d): a second-person possessive about a child, in any spelling the brief names or implies. */
const SECOND_PERSON_CHILD = /\byour (?:future |unborn |own )?(?:child|baby|son|daughter|kid)\b|\byour (?:child|baby)(?:’|')s\b/i;
/** G5.9(a): nothing pictorial in the result region, and no figure-role svg anywhere in main. */
const RESULT_MEDIA = '[data-slot="portrait-outputs"] :is(img, canvas, svg, picture, video)';
const MAIN_FIGURE_MEDIA = "main img, main canvas, main svg[role=img]";

// ---------------------------------------------------------------------------
// The synthetic reviewed release
// ---------------------------------------------------------------------------

const RELEASE_ID = `synthetic-e2e-portrait-${RUN_ID.slice(0, 8)}`;
const REVIEWER = { name: "Synthetic test reviewer", role: "Browser test fixture", reference: "e2e/portrait-reviewed-carrier.spec.ts" };

interface SyntheticAssertion {
  variationId: number;
  variantName: string;
  reviewStatus: string;
  reviewStars: number;
  lastEvaluated: string | null;
  pos: number;
  ref: string;
  alt: string;
}

interface SyntheticCondition {
  conditionId: string;
  conditionName: string;
  gene: string;
  assertions: SyntheticAssertion[];
}

/** Both files carry one changed copy at the first change; both read A/T, not the reviewed G, at the second. */
const BOTH_COVER: SyntheticCondition = {
  conditionId: "SYNTHETIC:8801",
  conditionName: "Synthetic recessive condition A",
  gene: "SYNPORTA",
  assertions: [
    { variationId: 880101, variantName: "Synthetic change A1", reviewStatus: "reviewed by expert panel", reviewStars: 3,
      lastEvaluated: "2024-01-01", pos: 61_000_000, ref: "A", alt: "G" },
    { variationId: 880102, variantName: "Synthetic change A2", reviewStatus: "criteria provided, multiple submitters, no conflicts",
      reviewStars: 2, lastEvaluated: null, pos: 141_000_000, ref: "A", alt: "G" },
  ],
};

/** A's file carries one changed copy; B's file does not report the position. */
const ONE_SIDE_COVERS: SyntheticCondition = {
  conditionId: "SYNTHETIC:8802",
  conditionName: "Synthetic recessive condition B",
  gene: "SYNPORTB",
  assertions: [
    { variationId: 880201, variantName: "Synthetic change B1", reviewStatus: "practice guideline", reviewStars: 4,
      lastEvaluated: "2023-06-15", pos: 10_000_000, ref: "C", alt: "T" },
  ],
};

const CONDITIONS = [BOTH_COVER, ONE_SIDE_COVERS];

function releasePayload() {
  return {
    release: {
      releaseId: RELEASE_ID, source: "synthetic", sourceUrl: "https://example.invalid/synthetic-portrait-release",
      sourceSha256: "a".repeat(64), sourceBytes: 1, sourcePublishedOn: "2026-09-03", retrievedAt: "2026-09-28T08:40:57Z",
      extractSha256: "b".repeat(64), geneValidityUrl: "https://example.invalid/synthetic-gene-validity",
      geneValiditySha256: "c".repeat(64), geneValidityCreatedOn: "2026-09-28",
    },
    conditions: CONDITIONS.map((condition) => ({
      conditionId: condition.conditionId, conditionName: condition.conditionName, geneSymbol: condition.gene,
      inheritanceMode: "autosomal_recessive", geneValidityClassification: "Definitive", geneValidityClassifiedOn: "2022-06-01",
      geneValidityUrl: `https://example.invalid/synthetic-validity-${condition.gene.toLowerCase()}`,
    })),
    assertions: CONDITIONS.flatMap((condition) => condition.assertions.map((assertion) => ({
      variationId: assertion.variationId, conditionId: condition.conditionId, geneSymbol: condition.gene,
      variantName: assertion.variantName, classification: "Pathogenic", reviewStatus: assertion.reviewStatus,
      reviewStars: assertion.reviewStars, conflict: false, lastEvaluated: assertion.lastEvaluated,
      grch38: [1, assertion.pos, assertion.ref, assertion.alt], grch37: null, grch38Equivalents: [],
    }))),
  };
}

async function registryRevision(conditionId: string): Promise<{ revision: number; active: boolean }> {
  const { data, error } = await adminClient().from("carrier_conditions")
    .select("registry_revision, active").eq("condition_id", conditionId).single();
  expect(error).toBeNull();
  return { revision: Number(data!.registry_revision), active: Boolean(data!.active) };
}

/** A named reviewer's decision, through the one door that may change a condition's state. */
async function review(condition: SyntheticCondition, decision: "activate" | "deactivate") {
  const { revision } = await registryRevision(condition.conditionId);
  const { data, error } = await adminClient().rpc("review_carrier_condition_v1", {
    p_condition_id: condition.conditionId, p_registry_revision: revision, p_decision: decision,
    p_reviewer_name: REVIEWER.name, p_reviewer_role: REVIEWER.role, p_review_reference: REVIEWER.reference,
    p_severity_class: decision === "activate" ? "not_serious" : null,
  });
  expect(error).toBeNull();
  expect(Number(data)).toBeGreaterThan(0);
  expect((await registryRevision(condition.conditionId)).active).toBe(decision === "activate");
}

/** The rule's rows, as every carrier surface reads them. */
async function ruleGenes(): Promise<string[]> {
  const { data, error } = await adminClient().rpc("carrier_assertions_v1");
  expect(error).toBeNull();
  return [...new Set((data as { gene_symbol: string }[]).map((row) => row.gene_symbol))].sort();
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let invitedSubjectB = "";
let pairId = "";
const fileIds: { a: string; b: string } = { a: "", b: "" };

interface CapturedEmail { to: string[] | string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;
test.use({ trace: "off" }); // Restricted upload, invitation and permission bearers stay out of traces.
test.describe.configure({ mode: "serial" });

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** A fresh server presentation and a real permission POST from the signed-in account. */
async function grantPortrait(page: Page, recipientHandle: string) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/consents") && candidate.request().method() === "POST");
  await row.getByRole("button", { name: /Turn on/ }).click();
  expect((await response).status()).toBe(201);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

async function acknowledgePortrait(page: Page) {
  await page.goto(url());
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON }).click();
  await expect(form).toHaveCount(0);
}

async function pairOf(): Promise<{ id: string; status: string }> {
  const { data } = await adminClient().from("family_pairs").select("id, status, subject_a_id, subject_b_id")
    .or(`subject_a_id.eq.${selfSubjectA},subject_b_id.eq.${selfSubjectA}`);
  const pair = (data as { id: string; status: string; subject_a_id: string; subject_b_id: string }[] | null ?? []).find(
    (row) => row.subject_a_id === selfSubjectB || row.subject_b_id === selfSubjectB);
  if (!pair) throw new Error("no pair between A and B");
  return pair;
}

const url = () => `/family/portrait/${pairId}`;

/** The domain's one Tier-2 gate, passed in this browser context after `signIn`. */
async function passGate(page: Page) {
  await page.goto(url());
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
}

/** The finding texts of the page: every `[data-finding]` node inside a claim block, in document order. */
async function findingTexts(page: Page): Promise<string[]> {
  return page.locator("[data-claim-block] [data-finding]").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));
}

/** A reviewed variant line as the viewer reads it: "You" for the viewer, the column's name for the other person. */
function variantLine(name: string, assertion: SyntheticAssertion, gene: string): string {
  return reviewedVariantLine(name, { ...assertion, releaseId: RELEASE_ID }, gene, "Pathogenic");
}

/**
 * G5.9 on the page as it stands, whatever the state: (a) no pictorial element
 * in the result region, (b) the chance line in every claim block and every
 * figure a count of 100 possible children, (c) the trait allowlist, (d) no
 * second-person possessive about a child.
 */
async function expectBoundedHarm(page: Page) {
  // (a)
  await expect(page.locator('[data-slot="portrait-outputs"]')).toHaveCount(1);
  await expect(page.locator(RESULT_MEDIA)).toHaveCount(0);
  await expect(page.locator(MAIN_FIGURE_MEDIA)).toHaveCount(0);
  // (b)
  const blocks = page.locator('[data-slot="portrait-outputs"] [data-claim-block]');
  const count = await blocks.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(blocks.nth(index).locator('[data-slot="chance-not-prediction"]')).toHaveText(CHANCE_NOT_PREDICTION);
    await expect(blocks.nth(index).locator('[data-slot="segregation"]')).toHaveText(SEGREGATION_SENTENCE);
  }
  for (const sentence of await page.locator('[data-slot="outcome-sentence"]').allTextContents()) {
    expect(sentence).toMatch(/^Out of 100 possible children, about \d+ would [a-z ]+\.$/);
  }
  // (c)
  const allowlist = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/family-trait-allowlist.json"), "utf8")) as {
    traits: Record<string, unknown>; denied_key_patterns: string[];
  };
  const rendered = await page.locator('[data-slot="trait-card"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-trait") ?? ""));
  expect(rendered.sort()).toEqual(Object.keys(allowlist.traits).sort());
  expect([...TRAIT_KEYS].sort()).toEqual(Object.keys(allowlist.traits).sort());
  for (const key of rendered) {
    expect(allowlist.denied_key_patterns.some((pattern) => key.includes(pattern)), key).toBe(false);
    const card = page.locator(`[data-slot="trait-card"][data-trait="${key}"]`);
    await expect(card.locator('[data-slot="trait-status"]')).toHaveText(unregisteredCard(TRAIT_NAMES[key as keyof typeof TRAIT_NAMES]));
    await expect(card.locator("[data-figure-kind], [data-claim-block]")).toHaveCount(0);
  }
  await expect(page.locator("#not-shown [data-refusal-id]")).toHaveCount(REFUSALS.length);
  // (d)
  expect(await page.locator("main").innerText()).not.toMatch(SECOND_PERSON_CHILD);
  expect(await page.content()).not.toMatch(SECOND_PERSON_CHILD);
  // Line 2238: never a monogenic zero; nothing about relatedness.
  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toMatch(/(^|[^\d])0%/);
  expect(mainText).not.toMatch(/\b0 in 100\b/);
  expect(mainText).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);
}

/** The recessive block for the gene both files cover, identical in `complete` and `partial-coverage`. */
async function expectRecessiveBlock(page: Page, viewer: "a" | "b") {
  const exact = page.locator(`[data-claim-block]:has([data-output-kind="carrier-pair"][data-gene="${BOTH_COVER.gene}"])`);
  await expect(exact).toHaveCount(1);
  // Attributed to the pair, in the pair's own order, because the arithmetic used both records.
  const pair = await exact.getAttribute("data-subject-pair");
  expect(new Set(pair?.split(":"))).toEqual(new Set([selfSubjectA, selfSubjectB]));
  await expect(exact.locator('[data-slot="portrait-output-title"]')).toHaveText(`A change in ${BOTH_COVER.gene}`);
  // The mandated derivation, three exact figures at 100, and 100 dots as spans.
  await expect(exact.locator('[data-slot="portrait-derivation"]')).toHaveText(DERIVATION);
  await expect(exact.locator("[data-exact-marker]")).toHaveText(EXACT_MARKER);
  await expect(exact.locator('[data-figure-basis="exact"]')).toHaveCount(3);
  await expect(exact.locator('[data-figure-kind="carrier-status"]')).toHaveCount(2);
  const dots = exact.locator('[data-slot="outcome-dot"]');
  await expect(dots).toHaveCount(100);
  expect(await dots.evaluateAll((nodes) => nodes.every((node) => node.tagName === "SPAN"))).toBe(true);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="affected"]')).toHaveCount(25);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="carrier"]')).toHaveCount(50);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="neither"]')).toHaveCount(25);
  for (const outcome of ["affected", "carrier", "neither"] as const) {
    await expect(exact.locator(`[data-slot="outcome-legend-item"][data-outcome="${outcome}"]`)).toContainText(OUTCOME_LEGEND[outcome]);
  }
  await expect(exact.locator('[data-slot="outcome-sentence"]')).toHaveText([
    "Out of 100 possible children, about 25 would have the condition.",
    "Out of 100 possible children, about 50 would carry one copy of the change.",
    "Out of 100 possible children, about 25 would have no copy of the change.",
  ]);
  // Both of the condition's known changes are covered by both files.
  await expect(exact.locator('[data-slot="known-covered"]')).toHaveText(knownChangesCovered(2, 2));
  // The runs measure was taken for both files at preparation, and is below the limit.
  await expect(exact.locator('[data-slot="how-sure"]')).toContainText(RUNS_CHECKED_STATEMENT);
  await expect(page.locator('details [data-slot="how-sure"]')).toHaveCount(0);
  // Each person's variant line names the reviewed change, its classification,
  // its review status and its date as text, and never calls a test release ClinVar.
  const [first] = BOTH_COVER.assertions;
  const lines = exact.locator('[data-slot="carrier-variant"]');
  await expect(lines).toHaveCount(2);
  const other = viewer === "a" ? INVITEE_LABEL : INVITER_LABEL;
  const texts = await lines.allTextContents();
  expect(new Set(texts)).toEqual(new Set([variantLine("You", first, BOTH_COVER.gene), variantLine(other, first, BOTH_COVER.gene)]));
  for (const text of texts) {
    expect(text).toContain("(review status: reviewed by expert panel; last evaluated 1 January 2024).");
    expect(text).not.toContain("ClinVar classifies");
  }
  const notes = exact.locator('[data-slot="assertion-notes"]');
  await expect(notes.locator('[data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  await expect(notes.locator('[data-slot="penetrance"]')).toHaveText(PENETRANCE_NOT_ESTABLISHED);
  await expect(notes.locator('[data-slot="assertion-source"]')).toHaveText(assertionSourceLine(RELEASE_ID, "2026-09-28"));
  await expect(notes.locator('[data-slot="assertion-source"]')).toHaveText("Classifications from a test release, not from ClinVar.");
}

test.beforeAll(async () => {
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/emails") {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id: `portrait-reviewed-${captured.length}` }));
      } else response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    resendMock.once("error", reject);
    resendMock.listen(8124, "127.0.0.1", resolve);
  });
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);

  // The committed fixtures are what their generators build, and the real
  // parser and runs measure read them as this spec depends on.
  expect(fs.readFileSync(FIXTURE_A, "utf8")).toBe(`${buildCarrierPairVcf().join("\n")}\n`);
  expect(fs.readFileSync(FIXTURE_B, "utf8")).toBe(`${buildCarrierPairBVcf().join("\n")}\n`);
  const checkA = await verify(buildCarrierPairVcf());
  const checkB = await verifyAgainst(buildCarrierPairBVcf(), CARRIER_B_POSITIONS);
  expect(checkA.reasons).toEqual([]);
  expect(checkB.reasons).toEqual([]);
  const rows = (lines: string[]) => new Map(lines.filter((line) => !line.startsWith("#"))
    .map((line) => line.split("\t")).map((fields) => [`${fields[0]}:${fields[1]}`, fields]));
  const a = rows(buildCarrierPairVcf());
  const b = rows(buildCarrierPairBVcf());
  expect(a.get("chr1:61000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "0/1"]);
  expect(b.get("chr1:61000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "0/1"]);
  expect(a.get("chr1:141000000")?.slice(3, 5)).toEqual(["A", "G,T"]);
  expect(a.get("chr1:141000000")?.[9]).toBe("0/2");
  expect(b.get("chr1:141000000")?.slice(3, 5)).toEqual(["A", "G,T"]);
  expect(b.get("chr1:141000000")?.[9]).toBe("0/2");
  expect(a.get("chr1:10000000")?.slice(3)).toEqual(["C", "T", "50", "PASS", ".", "GT", "0/1"]);
  expect(b.has("chr1:10000000")).toBe(false);

  // The synthetic release, imported inactive; a reviewer activates each
  // condition in the test that needs it.
  const imported = await adminClient().rpc("import_clinical_assertion_release_v1", { p_payload: releasePayload() });
  expect(imported.error).toBeNull();
  expect(imported.data).toMatchObject({ releaseId: RELEASE_ID, conditions: 2, assertions: 3 });
  for (const condition of CONDITIONS) {
    if ((await registryRevision(condition.conditionId)).active) await review(condition, "deactivate");
  }
  expect(await ruleGenes()).toEqual([]);
});

test.afterAll(async () => {
  if (resendMock) await new Promise<void>((resolve) => resendMock.close(() => resolve()));
  // Withdrawn through the review door, so no later spec reads a synthetic condition.
  for (const condition of CONDITIONS) {
    const state = await registryRevision(condition.conditionId).catch(() => null);
    if (state?.active) await review(condition, "deactivate");
  }
});

test("both adults prepare a synthetic file, and each file's runs measure is stored as it is prepared", async ({ page }) => {
  test.setTimeout(600_000);
  for (const [side, account, fixture] of [["a", A, FIXTURE_A], ["b", B, FIXTURE_B]] as const) {
    await signIn(page, account.email, account.password);
    fileIds[side] = await uploadOwnFilePrepared(page, fixture, { fileType: "vcf" });
    await page.request.post("/auth/sign-out");
  }
  const { data, error } = await adminClient().from("genome_files")
    .select("id, roh_status, roh_reason, roh_total_bases, roh_covered_bases, roh_fraction, roh_measured_at")
    .in("id", [fileIds.a, fileIds.b]);
  expect(error).toBeNull();
  expect(data).toHaveLength(2);
  for (const row of data!) {
    // Measured from the verified bytes, never assumed: a file with no measure
    // is "not checked" and the rule would refuse the arithmetic.
    expect(row).toMatchObject({ roh_status: "measured", roh_reason: null });
    expect(Number(row.roh_total_bases)).toBeGreaterThan(0);
    expect(Number(row.roh_covered_bases)).toBeGreaterThan(Number(row.roh_total_bases));
    expect(Number(row.roh_fraction)).toBeLessThan(0.0156);
    expect(row.roh_measured_at).not.toBeNull();
  }
});

test("A invites B, B accepts, and both turn Portrait on and acknowledge it from their own accounts", async ({ page, request }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const token = await drainMailUntil(request, () => adultInvitationToken(captured
    .find((email) => (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email))?.html), "the invitation");
  await page.request.post("/auth/sign-out");
  await acceptAdultInvitation({ page, invitationUrl: adultInvitationUrl(token), email: B.email, password: B.password });
  await page.request.post("/auth/sign-out");

  const admin = adminClient();
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("target_kind", "subject").eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  invitedSubjectB = invitation.data!.target_id;

  await signIn(page, A.email, A.password);
  await grantPortrait(page, invitedSubjectB);
  pairId = (await pairOf()).id;
  await acknowledgePortrait(page);
  await page.request.post("/auth/sign-out");

  await signIn(page, B.email, B.password);
  await grantPortrait(page, selfSubjectA);
  await acknowledgePortrait(page);
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.request.post("/auth/sign-out");
  expect((await pairOf()).status).toBe("current");
});

/**
 * `complete`, in the register's "permitted-and-able" reading: both people
 * have signed everything the page asks, both prepared sources are read, both
 * runs measures were taken, and both files cover every known change of the
 * one reviewed condition. The page shows the one result the rule admits, and
 * nothing on it is absent for want of a permission or a source.
 */
test("/family/portrait/[pairId] complete: two prepared sources and one reviewed condition both files fully cover give the exact recessive block, with every G5.9 bound", async ({
  page,
}) => {
  await review(BOTH_COVER, "activate");
  expect(await ruleGenes()).toEqual([BOTH_COVER.gene]);

  await signIn(page, A.email, A.password);
  await passGate(page);
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();

  // Exactly one output, and it is the exact block; nothing is refused,
  // one-sided, unavailable or "not available yet".
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="portrait-outputs"] [data-claim-block]')).toHaveCount(1);
  await expect(page.locator('[data-output-kind="carrier-pair-refused"], [data-output-kind="one-sided"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-empty"], [data-slot="portrait-preparing"]')).toHaveCount(0);
  await expect(page.locator('main [role="status"][data-state="empty"], main [role="status"][data-state="unavailable"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator("main")).not.toContainText(NO_POSITIONS_BOTH_COVER);
  await expect(page.locator("main")).not.toContainText("not available yet");
  await expect(page.locator("main")).not.toContainText(ONE_SIDE_COVERS.gene);
  await expect(page.locator("[data-exact-marker]")).toHaveCount(1);
  await expect(page.locator('[data-slot="outcome-dot"]')).toHaveCount(100);
  await expect(page.locator("[data-modelled-marker]")).toHaveCount(0);

  await expectRecessiveBlock(page, "a");
  await expectBoundedHarm(page);
  await expect(page.getByRole("button", { name: DELETE_BUTTON })).toBeVisible();
  await expectAxeClean(page);
});

/**
 * `partial-coverage`, in the register's "coverage" reading: a second reviewed
 * condition's only known change sits at a position B's file does not report.
 * The first result stays exactly as it was; the second calculation is absent,
 * and the page names which one and why, in the right person on each side.
 */
test("/family/portrait/[pairId] partial-coverage: a reviewed change the other file does not report is named as the one calculation missing and why, beside the result that stays", async ({
  page,
}) => {
  await review(ONE_SIDE_COVERS, "activate");
  expect(await ruleGenes()).toEqual([BOTH_COVER.gene, ONE_SIDE_COVERS.gene]);
  const [change] = ONE_SIDE_COVERS.assertions;

  await signIn(page, A.email, A.password);
  await passGate(page);
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(2);
  await expectRecessiveBlock(page, "a");

  // Which part is missing and why: B's file does not cover the reviewed change.
  const missing = page.locator(`[data-claim-block]:has([data-output-kind="one-sided"][data-gene="${ONE_SIDE_COVERS.gene}"])`);
  await expect(missing).toHaveCount(1);
  await expect(missing.locator('[data-one-sided="not-covered"]')).toHaveCount(1);
  await expect(missing.locator('[data-slot="portrait-output-title"]')).toHaveText(`A change in ${ONE_SIDE_COVERS.gene}`);
  await expect(missing.locator('[data-slot="carrier-sentence"]')).toHaveText(cannotCalculate(INVITEE_LABEL, change.variantName));
  await expect(missing.locator('[data-slot="how-sure"]')).toContainText(oneSidedWhatWouldChange(INVITEE_LABEL));
  await expect(missing.locator('[data-slot="carrier-variant"]')).toHaveText(variantLine("You", change, ONE_SIDE_COVERS.gene));
  await expect(missing.locator('[data-figure-kind="carrier-status"]')).toHaveCount(2);
  await expect(missing).toContainText(POSITIONS_NOT_COVERED_READING);
  await expect(missing.locator('[data-slot="assertion-notes"] [data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  // No fraction, no dots and no exact figure where the calculation cannot be done.
  await expect(missing.locator('[data-slot="outcome-dot"], [data-figure-basis="exact"], [data-exact-marker]')).toHaveCount(0);
  await expect(missing).not.toContainText("in 100");
  await expect(missing).not.toContainText("1 in 4");
  await expect(page.locator('[data-slot="outcome-dot"]')).toHaveCount(100);
  await expectBoundedHarm(page);
  const fromA = await findingTexts(page);
  await page.request.post("/auth/sign-out");

  // B reads the mirror: B's own file is the one that does not cover the change.
  await signIn(page, B.email, B.password);
  await passGate(page);
  await expectRecessiveBlock(page, "b");
  const mirror = page.locator(`[data-claim-block]:has([data-output-kind="one-sided"][data-gene="${ONE_SIDE_COVERS.gene}"])`);
  await expect(mirror.locator('[data-slot="carrier-sentence"]')).toHaveText(
    `We cannot do this calculation. Your file does not cover ${change.variantName}.`);
  await expect(mirror.locator('[data-slot="how-sure"]')).toContainText(oneSidedWhatWouldChange("you"));
  await expect(mirror.locator('[data-slot="carrier-variant"]')).toHaveText(variantLine(INVITER_LABEL, change, ONE_SIDE_COVERS.gene));
  await expectBoundedHarm(page);
  // Brief line 1337: both sessions render byte-equal finding text.
  expect(await findingTexts(page)).toEqual(fromA);
});
