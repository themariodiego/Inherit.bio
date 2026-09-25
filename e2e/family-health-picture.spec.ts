import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import { CELL_NO_FILE, CELL_NO_PREPARED_FILE, EACH_TURNS_IT_ON } from "../src/copy/family/health-picture";
import { COPILOT_LOCAL_ONLY, PERSON_H1, noFileYet, noneCovered, notShared, reportsLede } from "../src/copy/family/person";
import { NOT_DIAGNOSTIC } from "../src/copy/reports/strings";
import path from "node:path";
import {
  DEFAULT_TEST_JURISDICTION,
  acceptAdultInvitation,
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  createConfirmedUser,
  drainMailUntil,
  expectAxeClean,
  firstViewportInteractives,
  setDeclaredJurisdiction,
  signIn,
} from "./helpers";
import { CARRIER_FIXTURE_POSITIONS, type FixtureGenotype } from "./fixtures/carrier-pair-positions";
import { buildCarrierPairVcf, verify, type FixtureCheck } from "./fixtures/carrier-pair-fixture";

/** Ten Health Picture journeys through actual canonical upload, selected report
 * generation, invitation acceptance and freshly signed directional permissions.
 * No grant, analysis completion, annotated status or independent-login marker is
 * fabricated. Both source files retain their own identity throughout withdrawal.
 *
 * The synthetic clinical reference strings below remain deliberately unbound:
 * canonical ROH/clinical analysis is NOT implemented or accepted by these tests.
 * The original deterministic ROH calculator proof remains checked separately;
 * the former ingest-time persisted-ROH acceptance stays open rather than being
 * replaced by a fabricated measurement or a claim that refusal completes it.
 *
 * This spec's real global mail drain requires the owned disposable browser DB
 * and local capture provider on port 8124, as Family/Portrait do. Never run that drain
 * against a preserved shared queue without reviewing every eligible item.
 * Each result-reading context passes the session-bound Tier-2 gate.
 */

const A = { email: `family-hp-a-${randomUUID()}@e2e.local`, password: "e2e-family-hp-pw" };
const B = { email: `family-hp-b-${randomUUID()}@e2e.local`, password: "e2e-family-hp-pw" };

/** Neither self subject carries a name, so each sees the other as an adult. */

const BANNER =
  "These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off.";
const NO_RANKING = "Inherit does not rank embryos and does not recommend one.";
const NOTHING_PICKS =
  "Nothing here picks between people. A lower chance on one row for one person says nothing about any other row or person.";
const AVAILABILITY =
  "This page shows 2 people because 2 people have agreed to be seen side by side. It shows nothing about anyone who has not.";
const BASELINE_ABSENT =
  "No baseline: Inherit does not know this person’s sex and age band.";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const NEEDS_TWO =
  "This page needs two people who have both agreed to be seen side by side. So far there is 1.";
const NO_CLASSIFIED_POSITIONS =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";
const NOT_SHARED_CELL = "Not shared with you";

/** The three purposes each account grants the other: the joint one and the two report layers. */
const GRANTED_PURPOSES = ["family.heritability", "reports.monogenic", "reports.polygenic"] as const;
type GrantedPurpose = (typeof GRANTED_PURPOSES)[number];

interface SyntheticEntry {
  gene: string;
  significance: string;
  conditionId: string;
  mode: string | null;
  /** The genotype the fixture writes at this position (carrier-pair-positions.ts). */
  gt: FixtureGenotype;
  /**
   * `probability`: the one 25-in-100 block; a phrase: a block with that
   * reason; null: both files cover the position but neither shows the
   * classified change, so no block renders and the position counts only
   * toward "both files cover".
   */
  block: "probability" | string | null;
}

/** The seven synthetic positions, in the order of `CARRIER_FIXTURE_POSITIONS`, with what each must produce. */
const SYNTHETIC: readonly SyntheticEntry[] = [
  {
    gene: "E2EGENE1",
    // ClinVar's own joined label (D-033): read as pathogenic, printed as it is.
    significance: "Pathogenic/Likely pathogenic",
    conditionId: "e2e-recessive",
    mode: "autosomal_recessive",
    gt: "0/1",
    block: "probability",
  },
  {
    gene: "E2EGENE2",
    significance: "Pathogenic",
    conditionId: "e2e-dominant",
    mode: "autosomal_dominant",
    gt: "0/1",
    block: "the change runs in a dominant pattern",
  },
  {
    gene: "E2EGENE3",
    significance: "Uncertain significance",
    conditionId: "e2e-uncertain",
    mode: "autosomal_recessive",
    gt: "0/1",
    block: "nobody yet knows what this change means",
  },
  {
    gene: "E2EGENE4",
    significance: "Pathogenic",
    conditionId: "e2e-no-pattern",
    mode: null,
    gt: "0/1",
    block: "Inherit has no recorded inheritance pattern for this gene",
  },
  {
    gene: "E2EGENE5",
    significance: "Pathogenic",
    conditionId: "e2e-two-copies",
    mode: "autosomal_recessive",
    gt: "1/1",
    block: "one file shows two changed copies, not one",
  },
  {
    gene: "E2EGENE6",
    significance: "Pathogenic",
    conditionId: "e2e-other-letter-1",
    mode: "autosomal_recessive",
    gt: "0/2",
    block: null,
  },
  {
    gene: "E2EGENE7",
    significance: "Likely pathogenic",
    conditionId: "e2e-other-letter-2",
    mode: "autosomal_recessive",
    gt: "0/2",
    block: null,
  },
];

const rsidOf = (index: number) => CARRIER_FIXTURE_POSITIONS[index].rsid;
const CARRIED = SYNTHETIC.map((entry, index) => ({ ...entry, rsid: rsidOf(index) })).filter(
  (entry) => entry.block !== null,
);
const NOT_CARRIED = SYNTHETIC.map((entry, index) => ({ ...entry, rsid: rsidOf(index) })).filter(
  (entry) => entry.block === null,
);

let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let invitedSubjectB = "";
const sourceFileIds: string[] = [];
let sourceBefore: unknown;
let ownGrantsBefore: unknown;
interface CapturedEmail { to: string[] | string; html?: string }
const captured: CapturedEmail[] = [];
let resendMock: http.Server;
/** Only IDs returned by B's actual permission POSTs. */
const grantsFromB = new Map<GrantedPurpose, string>();
/** The fixture as the generator builds it, checked with the real parser and the real runs measure. */
let fixtureCheck: FixtureCheck;

test.use({ trace: "off" }); // Restricted upload, invitation and permission bearers stay out of traces.
test.describe.configure({ mode: "serial" });

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data } = await adminClient()
    .from("subjects")
    .select("id")
    .eq("subject_account_id", accountId)
    .eq("subject_class", "self")
    .eq("lifecycle", "active")
    .single();
  return (data as { id: string }).id;
}

/** A fresh presentation is obtained for every purpose; an earlier signature
 * may create the relationship captured by the next presentation. */
async function setSharingPurpose(page: Page, recipientHandle: string, purpose: GrantedPurpose, enabled: boolean) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const label = PERMISSION_ROWS.find(row => row.id === purpose)!.label;
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "Off" : "On");
  const response = page.waitForResponse(response => response.request().method() === "POST"
    && (enabled ? response.url().endsWith("/api/consents")
      : response.url().endsWith(`/api/consents/${grantsFromB.get(purpose)}/revoke`)));
  await row.getByRole("button", { name: enabled ? /^Turn on / : /^Turn off / }).click();
  const result = await response;
  expect(result.status()).toBe(enabled ? 201 : 200);
  const receipt = await result.json();
  expect(receipt).toMatchObject(enabled ? { recordKind: "purpose_grant", purposeKey: purpose,
    artifactKey: "consent.share-with-adult" } : { revoked: true });
  if (enabled) expect(receipt.recordId).toMatch(/^[0-9a-f-]{36}$/);
  else expect(Number.isFinite(Date.parse(receipt.effectiveAt))).toBe(true);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "On" : "Off");
  return enabled ? receipt.recordId as string : null;
}

async function sourceReceipt() {
  const result = await adminClient().from("genome_files")
    .select("id,user_id,subject_id,sha256,source_sha256,storage_object_id,size_bytes,status,upload_revision,normalization_source_revision,normalization_completed_at")
    .in("id", sourceFileIds).order("id");
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(2);
  return result.data;
}

async function ownGrantReceipt() {
  const result = await adminClient().from("purpose_grants")
    .select("grant_id,grant_revision,target_id,purpose,revoked_at")
    .in("target_id", [selfSubjectA, selfSubjectB])
    .in("artifact_key", ["consent.own-monogenic", "consent.own-polygenic"]).order("grant_id");
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(4);
  expect(result.data!.every(row => row.revoked_at === null)).toBe(true);
  return result.data;
}

async function expectSourcesAndOwnPermissionsPreserved() {
  expect(await sourceReceipt()).toEqual(sourceBefore);
  expect(await ownGrantReceipt()).toEqual(ownGrantsBefore);
}

/** Removes the classification from the given synthetic rows: the shipped table's own state. */
async function declassify(rsids: readonly number[]) {
  const { error } = await adminClient()
    .from("ref_variants")
    .update({ clinvar_significance: null })
    .in("rsid", [...rsids]);
  expect(error).toBeNull();
}

/**
 * Passes the domain's one Tier-2 gate in this browser context, after
 * `signIn`: the gate cookie is keyed to the auth session, so a fresh
 * context sees the gate again until it is acknowledged.
 */
async function passGate(page: Page) {
  await page.goto("/family/health-picture");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
}

/**
 * Axe in both themes, each on a fresh load in that theme, as every other
 * spec does (D-025): the theme provider flips the class on the live page
 * and the chrome animates its colours, so an audit taken on a page that was
 * loaded in the other theme samples mid-transition colours.
 */

test.beforeAll(async () => {
  const admin = adminClient();
  resendMock = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/emails") {
        captured.push(JSON.parse(body) as CapturedEmail);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `health-picture-${captured.length}` }));
      } else response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve, reject) => { resendMock.once("error", reject); resendMock.listen(8124, "127.0.0.1", resolve); });
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);

  // The spec's expectations and the fixture's rows are one list: the
  // genotype each entry expects is the one the generator writes there.
  expect(SYNTHETIC).toHaveLength(CARRIER_FIXTURE_POSITIONS.length);
  SYNTHETIC.forEach((entry, index) => expect(entry.gt).toBe(CARRIER_FIXTURE_POSITIONS[index].gt));

  // The committed fixture is byte-identical to what the generator builds,
  // and the real parser and runs measure accept it.
  const lines = buildCarrierPairVcf();
  const committed = fs.readFileSync(
    path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf"),
    "utf8",
  );
  expect(committed).toBe(`${lines.join("\n")}\n`);
  fixtureCheck = await verify(lines);
  expect(fixtureCheck.reasons).toEqual([]);
  expect(fixtureCheck.measure.status).toBe("measured");

  // Synthetic reference rows: the shipped table classifies nothing, so the
  // carrier branches exist only against these. Every one is removed below.
  for (const [index, entry] of SYNTHETIC.entries()) {
    const { error: variantError } = await admin.from("ref_variants").upsert({
      rsid: rsidOf(index),
      chrom: 1,
      pos38: CARRIER_FIXTURE_POSITIONS[index].pos,
      ref: "A",
      alt: "G",
      gene_symbol: entry.gene,
      clinvar_significance: entry.significance,
      sources: { synthetic: "e2e/family-health-picture.spec.ts" },
    });
    if (variantError) throw new Error(`ref_variants: ${variantError.message}`);
    const { error: conditionError } = await admin.from("condition_registry").upsert({
      condition_id: entry.conditionId,
      condition_name: `Synthetic test entry ${index + 1}`,
      category: "Having children",
      phenotype_class: "synthetic",
      inheritance_mode: entry.mode,
      active: false,
      registry_revision: 1,
      citation_ids: [],
      gene_symbols: [entry.gene],
    });
    if (conditionError) throw new Error(`condition_registry: ${conditionError.message}`);
  }

  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);
});

test.afterAll(async () => {
  if (resendMock) await new Promise<void>(resolve => resendMock.close(() => resolve()));
  const admin = adminClient();
  await admin
    .from("condition_registry")
    .delete()
    .in("condition_id", SYNTHETIC.map((entry) => entry.conditionId));
  await admin
    .from("ref_variants")
    .delete()
    .in("rsid", CARRIER_FIXTURE_POSITIONS.map((entry) => entry.rsid));
});

test("both adults prepare their real source and generate chosen reports before sharing", async ({ page, request }) => {
  const fixture = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
  const measure = fixtureCheck.measure;
  if (measure.status !== "measured") throw new Error("the fixture calculator must remain measurable");
  expect(measure.aboveThreshold).toBe(false);
  expect(measure.runCount).toBeGreaterThanOrEqual(1);
  expect(measure.totalRunBases).toBeGreaterThan(0);
  expect(measure.coveredSpanBases).toBeGreaterThan(0);
  expect(measure.fRoh).toBeCloseTo(measure.totalRunBases / measure.coveredSpanBases, 6);
  for (const account of [A, B]) {
    await signIn(page, account.email, account.password);
    sourceFileIds.push(await uploadOwnFileWithChosenReports(page, fixture, { fileType: "vcf",
      purposes: ["reports.monogenic", "reports.polygenic"] }));
    await page.request.post("/auth/sign-out");
  }
  sourceBefore = await sourceReceipt();
  ownGrantsBefore = await ownGrantReceipt();
  // Canonical preparation does not compute persisted ROH. Preserve this gap
  // explicitly alongside the real calculator proof; never stamp measured rows.
  const roh = await adminClient().from("genome_files")
    .select("roh_status,roh_reason,roh_total_bases,roh_covered_bases,roh_fraction,roh_measured_at").in("id", sourceFileIds);
  expect(roh.error).toBeNull(); expect(roh.data).toHaveLength(2);
  for (const row of roh.data!) expect(Object.values(row).every(value => value === null)).toBe(true);
  // Acceptance links real accounts; it does not share their existing own reports.
  await signIn(page, A.email, A.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const token = await drainMailUntil(request, () => captured
    .map(email => (Array.isArray(email.to) ? email.to : [email.to]).includes(B.email)
      ? adultInvitationToken(email.html) : undefined)
    .find(found => found !== undefined), "the invitation");
  await page.request.post("/auth/sign-out");
  await acceptAdultInvitation({
    page, invitationUrl: adultInvitationUrl(token), email: B.email, password: B.password,
  });
  // This was B's actual acceptance session. A's Family route names the invited
  // representative, while every source assertion still names B's own self.
  const admin = adminClient();
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id,invitee_principal_id,accepted_at")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("target_kind", "subject").eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  expect(invitation.data!.accepted_at).not.toBeNull();
  expect(invitation.data!.invitee_principal_id).not.toBeNull();
  invitedSubjectB = invitation.data!.target_id;
  expect(invitedSubjectB).not.toBe(selfSubjectB);
  const representative = await admin.from("subjects")
    .select("id,subject_class,subject_account_id,owner_account_id,lifecycle").eq("id", invitedSubjectB).single();
  expect(representative.error).toBeNull();
  expect(representative.data).toEqual({ id: invitedSubjectB, subject_class: "other_adult",
    subject_account_id: accountB, owner_account_id: null, lifecycle: "active" });
  const invitee = await admin.from("subject_principals").select("account_id,subject_id,principal_kind,status")
    .eq("id", invitation.data!.invitee_principal_id!).single();
  expect(invitee.error).toBeNull();
  expect(invitee.data).toEqual({ account_id: accountB, subject_id: invitedSubjectB, principal_kind: "account_subject", status: "active" });
  const binding = await admin.from("subject_account_bindings").select("account_principal_id")
    .eq("subject_id", invitedSubjectB).eq("subject_principal_id", invitation.data!.invitee_principal_id!)
    .eq("account_id", accountB).eq("binding_kind", "adult_claim").eq("status", "current").is("ended_at", null).single();
  expect(binding.error).toBeNull();
  const boundSelf = await admin.from("subject_principals").select("account_id,subject_id,principal_kind,status")
    .eq("id", binding.data!.account_principal_id).single();
  expect(boundSelf.error).toBeNull();
  expect(boundSelf.data).toEqual({ account_id: accountB, subject_id: selfSubjectB, principal_kind: "account_subject", status: "active" });
  await page.request.post("/auth/sign-out");
  // B signs in independently and only reads the permission presentation.
  await signIn(page, B.email, B.password);
  await page.goto(`/family/s-${selfSubjectA}/permissions`);
  await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toBeVisible();
  const grants = await adminClient().from("directional_grants").select("grant_id")
    .in("recipient_account_id", [accountA, accountB]).eq("direction", "subject_to_recipient").eq("status", "current");
  expect(grants.error).toBeNull(); expect(grants.data).toEqual([]);
});

test("the page withholds every result until the one Tier-2 gate is passed", async ({ page }) => {
  // Real permission UI supplies current endpoint receipts. A routes through
  // the accepted representative; B routes through A's self. DNA attribution
  // continues to use both self IDs, never the invitation representative.
  await signIn(page, A.email, A.password);
  for (const purpose of GRANTED_PURPOSES) await setSharingPurpose(page, invitedSubjectB, purpose, true);
  await page.request.post("/auth/sign-out");
  await signIn(page, B.email, B.password);
  for (const purpose of GRANTED_PURPOSES) grantsFromB.set(purpose, (await setSharingPurpose(page, selfSubjectA, purpose, true))!);
  await page.request.post("/auth/sign-out");
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");
  await expect(
    page.getByRole("heading", { level: 1, name: "Family health picture" }),
  ).toBeVisible();
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();

  const gatedHtml = await page.content();
  expect(gatedHtml).not.toContain("data-figure-kind");
  expect(gatedHtml).not.toContain("data-claim-block");
  expect(gatedHtml).not.toContain("data-compare-surface");
  expect(gatedHtml).not.toContain("25 in 100");
  for (const entry of SYNTHETIC) expect(gatedHtml).not.toContain(entry.gene);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
});

/**
 * RETITLED 2026-09-12 to name `/family/health-picture complete`. Every
 * assertion below already established it; the title named the page's refusals
 * rather than its state, so the route gate could not count it.
 *
 * WHAT `complete` MEANS ON A COMPARISON SURFACE, because it cannot mean "every
 * report covered" — no real file covers the whole catalogue. It means the page
 * is showing everything it is PERMITTED AND ABLE to show: both people's
 * columns, both layers, every granted cell carrying its own attributed result,
 * and no cell absent for want of a permission or a prepared file. Coverage
 * absences may remain, and do; they are a property of the file, not of this
 * page's completeness.
 *
 * That is exactly what separates it from `partial-coverage`, proven further
 * down the same file on the same fixture: there one layer's grant is missing
 * and the other adult's cells read "Not shared with you". The two titles sit
 * on one fixture and differ only in what has been granted, which is what makes
 * the pair worth reading together.
 *
 * TWO ASSERTIONS ARE NEW, and they are what make the retitle safe rather than
 * a rename: no cell reads "No prepared file yet" and none reads "No file yet".
 * Both are absences of a SOURCE rather than of coverage, and either would mean
 * the page was not showing everything it could.
 */
test("/family/health-picture complete: both columns, both layers, every permitted cell carrying its own attributed result", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await passGate(page);

  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(
    "Family / Family health picture",
  );
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);

  await expect(page.locator('[data-slot="comparison-banner"]')).toHaveText(BANNER);
  await expect(page.locator("details", { hasText: BANNER })).toHaveCount(0);

  // The trade-off panel: a statement, never a computation, and never hidden.
  const panel = page.locator("[data-trade-off-panel]");
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText(NOTHING_PICKS);
  await expect(panel).toContainText(NO_RANKING);
  await expect(panel).toContainText(AVAILABILITY);
  await expect(page.locator("details [data-trade-off-panel]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="trade-off-row"]')).toHaveCount(2);

  // One table per layer, and no table mixes two layers.
  const tables = page.locator("[data-compare-surface]");
  const tableCount = await tables.count();
  expect(tableCount).toBe(2);
  const layers = await tables.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-layer")),
  );
  expect(new Set(layers)).toEqual(new Set(["variant_call", "estimate"]));
  for (let index = 0; index < tableCount; index++) {
    await expect(tables.nth(index).locator("caption")).toHaveCount(1);
  }

  // Every cell is its own attributed claim block, and it names one subject.
  const cellBlocks = page.locator('[data-slot="health-picture-cell"] [data-claim-block]');
  expect(await cellBlocks.count()).toBeGreaterThan(0);
  const attributions = await cellBlocks.evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-subject-id"),
      pair: node.getAttribute("data-subject-pair"),
    })),
  );
  for (const attribution of attributions) {
    expect(attribution.id).toBeTruthy();
    expect(attribution.pair).toBeNull();
  }
  expect(new Set(attributions.map((attribution) => attribution.id))).toEqual(
    new Set([selfSubjectA, selfSubjectB]),
  );

  // With both report layers granted, the other adult's covered cells carry their
  // letters as observed genotype figures, and no cell says "not shared".
  const lettersOfB = page.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="cell-absence"]', { hasText: NOT_SHARED_CELL })).toHaveCount(0);
  // Nor is any cell missing a SOURCE. These two absences mean the page is not
  // showing everything it could; a coverage absence does not, which is why
  // only these two are asserted to zero.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true }),
    "no column is waiting on a file to be prepared").toHaveCount(0);
  await expect(page.getByText(CELL_NO_FILE, { exact: true }),
    "and none is waiting on a file at all").toHaveCount(0);

  // These are actual fixture calls rendered from each separately completed
  // stored report, not synthetic clinical labels or a shared genotype map.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  for (const [index, subjectId, segment] of [[0, selfSubjectA, "me"], [1, selfSubjectB, `s-${invitedSubjectB}`]] as const) {
    for (const [slug, genotype] of [["caffeine-metabolism-cyp1a2-rs762551", "A/C"], ["lactase-persistence-lct-rs4988235", "A/A"]]) {
      const row = estimates.locator(`[data-report-slug="${slug}"]`);
      const source = row.locator(`[data-source-file-id="${sourceFileIds[index]}"]`);
      await expect(source).toHaveCount(1);
      await expect(source.locator(`[data-claim-block][data-subject-id="${subjectId}"] [data-figure-kind="genotype"]`)).toContainText(genotype);
      await expect(source.getByRole("link", { name: /Open/ })).toHaveAttribute("href",
        `/genome/${segment}/reports/${slug}?source=${sourceFileIds[index]}`);
    }
  }
  await expect(page.locator('[data-slot="subject-files"]')).toHaveCount(0);

  // Nothing sorts, ranks or sums.
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  await expect(page.locator("th button")).toHaveCount(0);
  await expect(page.locator("[data-compare-surface] button")).toHaveCount(0);
  const content = await page.content();
  expect(content).not.toMatch(/aria-sort/);

  // The mandated footer appears once per column in EACH rendered layer table.
  const footers = page.locator('[data-slot="column-footer"]');
  await expect(footers).toHaveCount(2 * tableCount);
  for (let index = 0; index < 2 * tableCount; index++) {
    await expect(footers.nth(index)).toHaveText(BASELINE_ABSENT);
  }

  // Acceptance 20: nothing on this page says how these two people are related.
  expect(content).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);

  // Follow each real saved-source link: the own route and recipient route must
  // both show the captured call with source provenance, not just a valid href.
  const slug = "caffeine-metabolism-cyp1a2-rs762551";
  for (const [index, subjectId, segment] of [[0, selfSubjectA, "me"], [1, selfSubjectB, `s-${invitedSubjectB}`]] as const) {
    const sourceLink = page.locator(`[data-compare-surface][data-layer="estimate"] [data-report-slug="${slug}"] [data-source-file-id="${sourceFileIds[index]}"]`)
      .getByRole("link", { name: /Open/ });
    const expectedPath = `/genome/${segment}/reports/${slug}?source=${sourceFileIds[index]}`;
    await sourceLink.click();
    await expect(page).toHaveURL(new URL(expectedPath, page.url()).toString());
    await expect(page.locator(`[data-claim-block][data-subject-id="${subjectId}"] [data-figure-kind="genotype"]`)).toContainText("A/C");
    const provenance = page.locator('[data-slot="input-provenance"]');
    await expect(provenance).toBeVisible();
    await expect(provenance.locator('[data-slot="input-source"]')).toHaveCount(1);
    await expect(provenance).toContainText("No change of genome coordinates was needed.");
    // The same session already acknowledged Tier-2 before opening the report.
    await page.goto("/family/health-picture");
    await expect(page.locator('[data-compare-surface][data-layer="estimate"]')).toBeVisible();
  }
});

/**
 * `/family/[person] complete`, the permitted-and-able reading (register
 * `stateDefinitions.complete`, the reading `/family/health-picture complete`
 * above already claims on this same fixture): everything the page is
 * permitted AND able to show, with nothing absent for want of a permission
 * or a source. B has granted A both report layers, B's file is prepared and
 * both layers were generated, so the page lists every granted layer — each
 * either naming the reports B's file covers or saying in words that it
 * covers none of that layer's reports, which is a coverage fact and not an
 * absence of permission or of a file.
 *
 * What separates it from `/family/[person] partial-coverage`
 * (`e2e/family.spec.ts`, the permission reading): no layer reads "has not
 * shared … with you", because none is withheld. And from `not-covered`: at
 * least one granted layer lists a covered report. The ancestry section is
 * absent because B never granted it, and nothing absent for want of a
 * permission the page was never given is a gap in what it can show; the
 * assertion is that no GRANTED layer is missing.
 */
test("/family/[person] complete: past the Tier-2 gate with both report layers granted, every granted layer is listed and none is absent for want of a permission or a source", async ({ page }) => {
  expect(grantsFromB.has("reports.monogenic") && grantsFromB.has("reports.polygenic"),
    "both report layers were granted by B through the real permission route").toBe(true);
  await signIn(page, A.email, A.password);
  await passGate(page);
  await page.goto(`/family/s-${invitedSubjectB}`);

  await expect(page.getByRole("heading", { level: 1, name: PERSON_H1 })).toBeVisible();
  const name = (await page.locator('[data-subject-bar] [data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  // Past the gate, and none of the page's blocking renders.
  await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="person-blocking"]')).toHaveCount(0);
  await expect(page.getByText(reportsLede(name!), { exact: true })).toBeVisible();

  // Every granted layer is on the page, by its own heading line.
  const estimate = page.locator('[data-layer="estimate"]');
  const variantCall = page.locator('[data-layer="variant_call"]');
  await expect(estimate).toHaveCount(1);
  await expect(variantCall).toHaveCount(1);
  // The layer B's file reaches lists its covered reports as links to B's own record.
  const covered = estimate.locator(`a[href^="/genome/s-${invitedSubjectB}/reports/"]`);
  expect(await covered.count()).toBeGreaterThan(0);
  await expect(estimate.getByText(noneCovered(name!, "estimate"), { exact: true })).toHaveCount(0);
  // The other granted layer either lists reports or says in words that the
  // file covers none of them — a coverage fact, never a withheld permission.
  const variantLinks = variantCall.locator(`a[href^="/genome/s-${invitedSubjectB}/reports/"]`);
  const variantAbsence = variantCall.getByText(noneCovered(name!, "variant_call"), { exact: true });
  expect((await variantLinks.count()) + (await variantAbsence.count())).toBeGreaterThan(0);

  // Nothing is absent for want of a permission or a source.
  for (const layer of ["estimate", "variant_call"] as const) {
    await expect(page.getByText(notShared(name!, layer), { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(noFileYet(name!), { exact: true })).toHaveCount(0);
  await expect(page.getByText("No completed result is shared yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No completed result is shared for this result type yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A saved result is missing the source details needed to show it.", { exact: true })).toHaveCount(0);

  await expect(page.getByText(BASELINE_ABSENT, { exact: true })).toHaveCount(1);
  await expect(page.locator("#family-ancestry-heading"), "ancestry was never granted, so no section claims it").toHaveCount(0);
  await expect(page.locator("#family-permissions-heading a")).toHaveAttribute("href", `/family/s-${invitedSubjectB}/permissions`);
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();
  await expect(page.getByText(COPILOT_LOCAL_ONLY, { exact: true })).toBeAttached();
});

/** The block-only row's own sentence (data/jurisdictions.json TEST-DENY), retyped. */
const TEST_DENY_SENTENCE = "This capability is blocked for the TEST-DENY acceptance fixture.";

/** Every share B has made, current or ended, in a stable order. */
async function sharesFromB() {
  const result = await adminClient().from("purpose_grants")
    .select("grant_id,grant_revision,purpose,revoked_at,revocation_reason")
    .eq("target_id", selfSubjectB).eq("artifact_key", "consent.share-with-adult").order("grant_id");
  expect(result.error).toBeNull();
  return result.data!;
}

/**
 * G5.1b (ADR 0032): a permitted reader and a prohibited contributor. A is
 * declared GB, which the flag resolves to TEST-LOCAL; B's declaration becomes
 * the block-only TEST-DENY row's stored code while B's shares stay exactly as
 * they were. B's answer is written directly: through the declaration writer
 * it would also end those shares, and A would then be refused for want of a
 * permission rather than by the jurisdiction check this case exists to prove.
 * The writer's own effect is the last test in this file.
 *
 * "No result data is serialised" is read from the served documents, RSC
 * payload included: none of the report links the page listed, and not the
 * report's own title, which only a permitted page renders.
 */
test("/family/[person] jurisdiction-unavailable: a permitted reader whose contributor's declared jurisdiction is prohibited is refused, and none of the shared result reaches the page", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await passGate(page);
  await page.goto(`/family/s-${invitedSubjectB}`);
  const reports = page.locator(`[data-layer] a[href^="/genome/s-${invitedSubjectB}/reports/"]`);
  const hrefs = await reports.evaluateAll(links => links.map(link => link.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  await page.goto(hrefs[0]);
  const reportTitle = (await page.locator("main h1").first().textContent())?.trim() ?? "";
  expect(reportTitle.length, "the permitted report page names its report").toBeGreaterThan(0);
  const sharesBefore = await sharesFromB();

  await setDeclaredJurisdiction(accountB, "XX");
  try {
    const person = await page.goto(`/family/s-${invitedSubjectB}`);
    expect(person?.status()).toBe(200);
    const personDocument = await person!.text();
    await expect(page.getByText(TEST_DENY_SENTENCE, { exact: true })).toBeVisible();
    await expect(page.locator("[data-layer]")).toHaveCount(0);
    for (const href of hrefs) expect(personDocument, "no shared report is linked or serialised").not.toContain(href);

    const report = await page.goto(hrefs[0]);
    expect(report?.status()).toBe(200);
    const reportDocument = await report!.text();
    await expect(page.getByRole("heading", { name: "Not available in this jurisdiction yet" })).toBeVisible();
    expect(reportDocument, "the refused report page carries none of the report").not.toContain(reportTitle);
    await expect(page.locator("[data-claim-block], [data-figure-kind]")).toHaveCount(0);

    expect(await sharesFromB(), "the shares never changed: the jurisdiction decided").toEqual(sharesBefore);
  } finally {
    await setDeclaredJurisdiction(accountB, DEFAULT_TEST_JURISDICTION);
  }
  // Answered back, the same shares read again.
  await page.goto(`/family/s-${invitedSubjectB}`);
  await expect(reports).toHaveCount(hrefs.length);
});

test("the carrier panel withholds unbound clinical labels and explicitly states unavailable", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await passGate(page);

  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "A change you both carry" })).toBeVisible();

  // Legacy clinical strings are present but cannot establish an assertion.
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveAttribute("data-state", "unavailable");
  await expect(panel.locator("[data-exact-marker], [data-figure-kind]")).toHaveCount(0);
  for (const entry of SYNTHETIC) await expect(panel).not.toContainText(entry.gene);
  await expect(panel).not.toContainText("No change to show that you both carry");
  await expect(panel).not.toContainText("25 in 100");
});

test("the page keeps its budgets and is clean in both themes", async ({ page }) => {
  // The audit is eight passes now, not two: three pinned viewports plus
  // reduced motion, in each theme, over the widest table the product renders
  // (660 figures, and the one surface allowed 24 interactive elements). At the
  // suite's 120-second default it timed out inside axe on CI run 341. The work
  // is the brief's, not a regression, so the budget moves rather than the
  // matrix: 600 seconds is what e2e/a11y.spec.ts already allows its own
  // multi-page sweeps.
  test.setTimeout(600_000);
  await signIn(page, A.email, A.password);
  await passGate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(24);
  await expectAxeClean(page);
});

test("the Overview does not advertise a clinical match from unbound reference labels", async ({ page }) => {
  await signIn(page, A.email, A.password);
  // The Overview's carrier line reads nothing before the domain's gate is
  // passed in this session, so the gate is passed on the domain's page first.
  await passGate(page);
  await page.goto("/overview");
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /carrier match to look at/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Two people carry a change in the same gene.");
});

/**
 * `/overview jurisdiction-unavailable`, and it belongs in THIS file because of
 * what the state costs to reach. The Overview's carrier line renders only in
 * State D, with a self subject, at least one relative sharing
 * `family.heritability` in both directions, and the domain's Tier-2 gate
 * passed in this session. Nothing above that list is a shortcut: it is two
 * real accounts, two prepared uploads and two signed grants, which is exactly
 * the fixture the ten tests above already build. Rebuilding it in a
 * `.nojurisdiction.spec.ts` of its own would have duplicated the most
 * expensive setup in the suite to assert one sentence.
 *
 * It sits here, before the withdrawal tests below start revoking grants, and
 * it reads from the OFF server while the fixture was built on this one. One
 * database stands behind both and cookies are host-scoped rather than
 * port-scoped, so the session and the passed gate carry across —
 * `e2e/genome-family.nojurisdiction.spec.ts` uses the same crossing in the
 * other direction.
 *
 * A FIFTH REFUSAL SHAPE. The three `/genome/[subject]/…` routes replace the
 * page; `/family/[person]/permissions` adds a line to its header;
 * `/family/[person]` fills the results slot; `/family/portrait/[pairId]`
 * replaces its one output slot. The Overview does none of those: it keeps
 * every other finding and refuses ONE line, because a jurisdiction that has
 * not reviewed carrier matching has said nothing about the rest of a person's
 * own genome. Traced at `overview/page.tsx:393` before it was titled.
 */
test("/overview jurisdiction-unavailable: the carrier line refuses in words while every other finding stays", async ({ page }) => {
  const OFF = "http://localhost:3101";
  await signIn(page, A.email, A.password);
  await passGate(page);

  // The control first: on THIS server the same account, same session and same
  // grants reach the carrier line's own surface. Without it, a refusal on the
  // other server could be an unreached state rather than a refused one.
  await page.goto("/overview");
  await expect(page.locator('[data-slot="carrier-jurisdiction"]')).toHaveCount(0);

  const response = await page.goto(`${OFF}/overview`);
  expect(response?.status()).toBe(200);
  const refusal = page.locator('[data-slot="carrier-jurisdiction"]');
  await expect(refusal).toHaveCount(1);
  await expect(refusal).toContainText("Inherit cannot show carrier matches for your family here.");

  // The refusal says THAT it cannot show them, never HOW MANY there were.
  // Whether two people in a family carry a change in the same gene is a fact
  // about their DNA, and a refusal that leaked it in either direction would be
  // worse than the analysis. So the sentence carries no number at all - the
  // first draft of this test asserted the refusal did not contain "carrier
  // match", which its own copy says, and caught nothing.
  await expect(refusal).not.toContainText(/\d/);
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /carrier match to look at/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Two people carry a change in the same gene.");

  // And the rest of the Overview is untouched. This is the point of the
  // shape: one restricted capability is refused, not the account's own genome.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main a[href^='/genome/']").first()).toBeVisible();
});

/**
 * `/family/health-picture partial-coverage`, the same both-halves reading used
 * for `/genome/[subject]/data/browser` and `/family/[person]`: the page shows
 * some content AND names the rest absent, in one view, and this test asserts
 * both. B withdraws the estimates layer toward A while the joint grant and the
 * variant layer stay, so the column still opens, the carrier panel still
 * opens, A's own cells are untouched - and every one of B's cells in that
 * layer reads the not-shared sentence with no figure and no link.
 *
 * What makes it the right id rather than `not-covered`: nothing here is
 * uncovered by anyone's file. The data exists and B has withdrawn permission
 * for one layer of it, which is a coverage of the VIEW rather than of the
 * genome. A page that dropped the column or the panel along with the cells
 * would be hiding that a person had chosen to withdraw, and would fail here.
 */
test("/family/health-picture partial-coverage: without that layer's own grant, the other adult's cells read as not shared while the column and the panel remain", async ({
  page,
}) => {
  // B withdraws the estimates layer toward A; the joint grant and the
  // variant layer stay. The column still opens on the joint grant, and so
  // does the carrier panel; the cells of that layer do not (D-038).
  await signIn(page, B.email, B.password);
  await setSharingPurpose(page, selfSubjectA, "reports.polygenic", false);
  await expectSourcesAndOwnPermissionsPreserved();
  const remaining = await adminClient().from("purpose_grants").select("grant_id,revoked_at")
    .in("grant_id", [grantsFromB.get("reports.monogenic")!, grantsFromB.get("family.heritability")!]);
  expect(remaining.error).toBeNull(); expect(remaining.data).toHaveLength(2);
  expect(remaining.data!.every(row => row.revoked_at === null)).toBe(true);
  await page.request.post("/auth/sign-out");

  await signIn(page, A.email, A.password);
  await passGate(page);

  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectB}"]`)).toHaveCount(1);

  const cellsOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"]`,
  );
  const count = await cellsOfB.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfB.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(NOT_SHARED_CELL);
    await expect(cellsOfB.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfB.nth(index).locator("a")).toHaveCount(0);
  }

  // The viewer's own cells are untouched.
  const lettersOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfA.count()).toBeGreaterThan(0);

  // B's independently shared variant-call layer remains available. Its
  // current catalog may have no covered report in this fixture; do not invent
  // a positive call or require a nonexistent report link to prove permission.
  const variantStatusOfB = page.locator(`[data-compare-surface][data-layer="variant_call"] [data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectB}"]`);
  await expect(variantStatusOfB).toHaveCount(1);
  await expect(variantStatusOfB).not.toContainText(NOT_SHARED_CELL);

  // The joint section stays, with the same unavailable clinical state.
  await expect(page.locator('[data-slot="carrier-panel"] [data-claim-block]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator('[data-slot="column-footer"]')).toHaveCount(4);
});

test("with fewer legacy labels, the panel still states unavailable rather than a negative screen", async ({
  page,
}) => {
  // Reduce only the deliberately unbound legacy reference labels. Their
  // presence or absence must not activate canonical clinical computation.
  await declassify(CARRIED.map((entry) => entry.rsid));

  await signIn(page, A.email, A.password);
  await passGate(page);
  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(
    NO_CLASSIFIED_POSITIONS,
  );
  await expect(panel).not.toContainText("Inherit checked the");
  expect(await page.content()).not.toContain("25 in 100");

  await page.goto("/overview");
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
});

/**
 * `/family/health-picture not-covered`, in the sense
 * `/genome/[subject]/ancestry not-covered` already uses: the files are here
 * and prepared, and the data does not support a result.
 *
 * The claim in the title is that this is NOT the `empty` state proven at the
 * bottom of this file, and the two are one assertion apart. `empty` renders a
 * count of the people who have agreed and NOTHING else — no carrier panel, no
 * comparison table. Here the panel is present and so is the report table:
 * both adults are on the page, both files are read, and the panel's own
 * sentence says no classified position was covered. It is also not a negative
 * screen — "checked the" and "0 positions" are absent — because saying zero
 * would read as a result rather than as an absence of one.
 */
test("/family/health-picture not-covered: with no classified position at all, the panel says so in words, never a count of zero", async ({
  page,
}) => {
  // The shipped reference table's own state (D-034).
  await declassify(NOT_CARRIED.map((entry) => entry.rsid));

  await signIn(page, A.email, A.password);
  await passGate(page);
  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(panel).not.toContainText("checked the");
  await expect(panel).not.toContainText("0 positions");
  // The independently generated report table remains available. Its presence,
  // with the panel above, is what separates this from `empty`: that state
  // renders neither.
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
});

/**
 * `/family/health-picture consent-required`, and it is the state the test
 * below deliberately did NOT claim. That one settled the rule: a
 * `consent-required` page names an outstanding consent step and links to
 * where it is given, and an `empty` page has nothing in it and no step this
 * reader can take.
 *
 * A pause passes both halves and the empty branch was swallowing it. Both
 * adults DID turn this on; `family_sharing_pauses` suspends the live set
 * without touching a grant row, so the pair fell out of the shared list and
 * the page told them to do the thing they had already done - "Each person
 * turns this on from their own account. You cannot turn it on for them." -
 * which is false twice over for a pause either of them can lift.
 *
 * The pause row is about the PAIR and records nobody as its author, so the
 * sentence names neither. It says what the reader can act on.
 *
 * Restored before the test below, which needs both directions live to revoke
 * one of them.
 */
test("/family/health-picture consent-required: a paused pair is told sharing is paused and where to resume it, not that nobody can act", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto(`/family/s-${invitedSubjectB}/permissions`);
  await page.getByRole("button", { name: "Pause sharing" }).click();
  await expect(page.getByRole("button", { name: "Resume sharing" })).toBeVisible();

  await page.goto("/family/health-picture");
  const blocking = page.locator('[data-slot="health-picture-blocking"]');
  await expect(blocking).toHaveAttribute("data-state", "consent-required");
  await expect(blocking.locator("p")).toHaveText(
    /^Sharing with .+ is paused\. This page cannot show the two of you side by side until one of you resumes it\. Open permissions$/,
  );
  // "and links to where it is given".
  await expect(
    blocking.locator(`a[href="/family/s-${invitedSubjectB}/permissions"]`),
  ).toHaveCount(1);

  // The two sentences of the empty state, which mean the opposite and which
  // this branch used to render.
  await expect(page.getByText(NEEDS_TWO, { exact: true })).toHaveCount(0);
  await expect(page.getByText(EACH_TURNS_IT_ON, { exact: true })).toHaveCount(0);

  // Nothing derived reaches the browser behind the refusal.
  await expect(page.locator('[data-slot="carrier-panel"]')).toHaveCount(0);
  await expect(page.locator("[data-compare-surface]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);

  // A suspended consent is still a consent: resuming brings the page back
  // with no grant re-signed, which is what separates this from a revocation.
  await page.goto(`/family/s-${invitedSubjectB}/permissions`);
  await page.getByRole("button", { name: "Resume sharing" }).click();
  await expect(page.getByRole("button", { name: "Pause sharing" })).toBeVisible();
  await page.goto("/family/health-picture");
  await expect(page.locator('[data-slot="health-picture-blocking"]')).toHaveCount(0);
});

/**
 * `/family/health-picture empty`, and the product names this state itself:
 * `src/copy/family/health-picture.ts` groups the sentence under its own
 * "States" heading and the line beside it is documented as belonging to "the
 * empty state". The page renders a count of the people who have agreed and
 * nothing else - no carrier panel, no comparison table, no claim block.
 *
 * Worth separating from `consent-required`, which this route also supports and
 * which looks superficially the same. A `consent-required` page names whose
 * step is outstanding and links to where it is given - that is what the
 * Portrait blocker does, and why that one is proven under that id. This page
 * says the opposite in the product's own words: "Each person turns this on
 * from their own account. You cannot turn it on for them." Nobody here has a
 * step to take, so there is no consent to require from this reader; there is
 * only a page with nothing in it, saying so. That sentence and the absence of
 * any link in the same panel are now asserted, so the distinction is a claim
 * rather than an inference.
 *
 * The direct sibling is `/family empty`, already proven on "Just you so far."
 * - the same shape of sentence, a count of who is here rather than an absence
 * the reader has to infer.
 */
test("/family/health-picture empty: revoking one direction leaves the page counting one person, with no panel, no table, and no step anyone can take for another", async ({ page }) => {
  await signIn(page, B.email, B.password);
  await setSharingPurpose(page, selfSubjectA, "family.heritability", false);
  await expectSourcesAndOwnPermissionsPreserved();
  await page.request.post("/auth/sign-out");

  // Under two columns the page states so before the gate: nothing to pass.
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");
  await expect(page.getByText(NEEDS_TWO, { exact: true })).toBeVisible();
  // What makes this `empty` and not `consent-required`: the panel states that
  // no one can act for anyone else, and offers no link to act through.
  await expect(page.getByText(EACH_TURNS_IT_ON, { exact: true })).toBeVisible();
  const notEnough = page.locator('section[role="status"]').filter({ hasText: NEEDS_TWO });
  await expect(notEnough).toHaveCount(1);
  await expect(notEnough.getByRole("link")).toHaveCount(0);
  await expect(page.locator('[data-slot="carrier-panel"]')).toHaveCount(0);
  await expect(page.locator("[data-compare-surface]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  expect(await page.content()).not.toContain("25 in 100");

  await page.goto("/overview");
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
  await expect(page.getByText("carrier match")).toHaveCount(0);
});

/**
 * G5.1a's re-evaluation through the real writer (ADR 0032). B declares the
 * block-only row's code from B's own session, and the declaration transaction
 * ends every restricted permission B took part in, as sharer or recipient,
 * recorded as a jurisdiction change rather than a withdrawal. Both adults'
 * sources and own report permissions are untouched: adult self-analysis is
 * the one capability no jurisdiction restricts. Last in the file because it
 * ends the shares every earlier test reads.
 */
test("changing where B lives ends every Family permission B took part in, and leaves both adults' own sources and report permissions", async ({ page }) => {
  const current = (await sharesFromB()).filter(row => row.revoked_at === null);
  expect(current.length, "B still shares at least one layer with A").toBeGreaterThan(0);
  await signIn(page, B.email, B.password);
  const { data: published } = await adminClient().from("consent_artifacts").select("version, body_sha256")
    .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null).single();
  const answer = await page.request.put("/api/settings/jurisdiction", {
    headers: { origin: "http://localhost:3100", "content-type": "application/json" },
    data: { code: "XX", attestationVersion: published!.version, attestationHash: published!.body_sha256, affirmed: true },
  });
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toEqual({ status: "updated", jurisdiction: "XX", capabilityReevaluation: "complete" });

  const after = await sharesFromB();
  for (const row of current) {
    expect(after.find(candidate => candidate.grant_id === row.grant_id), row.purpose)
      .toMatchObject({ revocation_reason: "jurisdiction_changed" });
  }
  const received = await adminClient().from("purpose_grants").select("grant_id,revoked_at,revocation_reason")
    .eq("target_id", selfSubjectA).eq("artifact_key", "consent.share-with-adult").is("revoked_at", null);
  expect(received.error).toBeNull();
  expect(received.data, "nothing A shares with B stays current either").toEqual([]);
  await expectSourcesAndOwnPermissionsPreserved();
});
