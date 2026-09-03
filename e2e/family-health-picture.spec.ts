import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  adminClient,
  anonClient,
  createConfirmedUser,
  firstViewportInteractives,
  ingestFileAs,
  signIn,
} from "./helpers";
import { CARRIER_FIXTURE_POSITIONS, type FixtureGenotype } from "./fixtures/carrier-pair-positions";
import { buildCarrierPairVcf, verify, type FixtureCheck } from "./fixtures/carrier-pair-fixture";

/**
 * `/family/health-picture` (design docs/design/w9-family-surfaces.md §6.2):
 * two adults side by side, the carrier panel above the table, and the
 * Overview line that points at it.
 *
 * What it pins: the mandated banner and the G4.5 statement verbatim; one
 * compare surface per layer with one attributed claim block per cell; no
 * control anywhere that could order, rank or sum the table; the exact
 * baseline-absence sentence in every column footer; exactly one block with
 * the 25-in-100 sentence and none anywhere else; the named reason on every
 * other match, the two-copies reason included; each person's own variant
 * and classification named in every block; the runs measure stored with
 * the file at ingest; another adult's cells reading "Not shared with you"
 * without that layer's own grant while the column and the panel remain;
 * the count sentence over a classified set with no match and the plain
 * sentence over an empty one; and no word about how the two people are
 * related.
 *
 * Setup. The permissions page carries a "Health picture" row for
 * `family.heritability` (ADR 0017), on the same own-session rules as the
 * other rows. This spec writes every grant through the real routine
 * (`grant_directional_purpose_v1`) with the service-role client, exactly as
 * the rows do, and sets the independent-login marker through the real
 * routine (`mark_independent_login_v1`) from a real session of each
 * account, so the surface is exercised without a second sign-in dance. The
 * seven classified positions are synthetic rows inserted here and removed
 * in `afterAll`: the shipped reference table has no classification at all,
 * so these branches have no other way to be proved.
 *
 * The Tier-2 gate is a session cookie keyed to the auth session
 * (src/lib/family/tier2.ts), and every `test()` runs in a fresh browser
 * context, so every test that reads a result passes the gate itself
 * (`passGate`); the second test pins the gate's own behaviour explicitly.
 */

const A = { email: "family-hp-a@e2e.local", password: "e2e-family-hp-pw" };
const B = { email: "family-hp-b@e2e.local", password: "e2e-family-hp-pw" };

/** Neither self subject carries a name, so each sees the other as an adult. */
const B_AS_SEEN_BY_A = "Another adult";

const BANNER =
  "These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off.";
const NO_RANKING = "Inherit does not rank embryos and does not recommend one.";
const NOTHING_PICKS =
  "Nothing here picks between people. A lower chance on one row for one person says nothing about any other row or person.";
const AVAILABILITY =
  "This page shows 2 people because 2 people have agreed to be seen side by side. It shows nothing about anyone who has not.";
const BASELINE_ABSENT =
  "No baseline: Inherit does not know this person’s sex and age band.";
const CARRIER_SENTENCE =
  "For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children.";
const EXACT_MARKER = "This is exact arithmetic, not an estimate.";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const NEEDS_TWO =
  "This page needs two people who have both agreed to be seen side by side. So far there is 1.";
const NO_CLASSIFIED_POSITIONS =
  "Inherit has no classified positions to check yet, so it cannot look for a change you both carry.";
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
/** The grants B made toward A, by purpose, so a test can revoke one through the real routine. */
const grantsFromB = new Map<GrantedPurpose, string>();
/** The fixture as the generator builds it, checked with the real parser and the real runs measure. */
let fixtureCheck: FixtureCheck;

test.describe.configure({ mode: "serial" });

async function accountIdFor(email: string): Promise<string> {
  const { data } = await adminClient().auth.admin.listUsers();
  return data!.users.find((user) => user.email === email)!.id;
}

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

async function principalOf(subjectId: string, accountId: string): Promise<string> {
  const { data } = await adminClient()
    .from("subject_principals")
    .select("id")
    .eq("subject_id", subjectId)
    .eq("account_id", accountId)
    .eq("principal_kind", "account_subject")
    .eq("status", "active")
    .limit(1)
    .single();
  return (data as { id: string }).id;
}

/** The auth session id an access token carries, as `authSessionIdFromAccessToken` reads it server-side. */
function authSessionIdOf(accessToken: string): string {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { session_id?: unknown };
  if (typeof payload.session_id !== "string") throw new Error("the access token carries no session id");
  return payload.session_id;
}

/**
 * The independent-login marker, through the real routine from a real
 * session of the account: `grant_directional_purpose_v1` refuses
 * `family.heritability` while it is unset, and the marker is otherwise
 * stamped by a server-verified sign-in the harness cannot reproduce for two
 * accounts in one browser context. These accounts accepted no invitation,
 * so any session of theirs stamps.
 */
async function markIndependentLogin(account: { email: string; password: string }, accountId: string) {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error || !data.session) throw new Error(`sign-in: ${error?.message}`);
  const stamped = await adminClient().rpc("mark_independent_login_v1", {
    p_account_id: accountId,
    p_auth_session_id: authSessionIdOf(data.session.access_token),
  });
  expect(stamped.error).toBeNull();
  expect(stamped.data).toBe(1);
}

/** One directional grant of one purpose, through the real routine. */
async function grantPurpose(
  purpose: GrantedPurpose,
  granterAccount: string,
  granterSubject: string,
  recipientPrincipal: string,
): Promise<string> {
  const { data, error } = await adminClient().rpc("grant_directional_purpose_v1", {
    p_account_id: granterAccount,
    p_data_subject_id: granterSubject,
    p_recipient_principal_id: recipientPrincipal,
    p_purpose: purpose,
    p_artifact_key: "consent.share-with-adult",
    p_artifact_version: 1,
    // The presentation nonce is single-use by design, so each grant mints its own.
    p_token_nonce: `e2e-hp-${randomUUID()}`,
  });
  if (error) throw new Error(`grant ${purpose}: ${error.message}`);
  return data as unknown as string;
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
async function expectAxeClean(page: Page) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, theme, help: violation.help })),
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.beforeAll(async () => {
  const admin = adminClient();
  await createConfirmedUser(A.email, A.password);
  await createConfirmedUser(B.email, B.password);

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

  // The two people, their self subjects (provisioned with the account) and
  // the principals the grants are addressed to.
  accountA = await accountIdFor(A.email);
  accountB = await accountIdFor(B.email);
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);
  await markIndependentLogin(A, accountA);
  await markIndependentLogin(B, accountB);
  const principalA = await principalOf(selfSubjectA, accountA);
  const principalB = await principalOf(selfSubjectB, accountB);

  // Every grant in both directions: the joint one that opens the column
  // and the panel, and the two report layers that open the cells (D-038).
  for (const purpose of GRANTED_PURPOSES) {
    await grantPurpose(purpose, accountA, selfSubjectA, principalB);
    grantsFromB.set(purpose, await grantPurpose(purpose, accountB, selfSubjectB, principalA));
  }
  const { data: live } = await admin
    .from("purpose_grants")
    .select("purpose, target_id")
    .in("target_id", [selfSubjectA, selfSubjectB])
    .is("revoked_at", null);
  expect(live).toHaveLength(GRANTED_PURPOSES.length * 2);
  for (const target of [selfSubjectA, selfSubjectB]) {
    expect(
      (live as { purpose: string; target_id: string }[])
        .filter((row) => row.target_id === target)
        .map((row) => row.purpose)
        .sort(),
    ).toEqual([...GRANTED_PURPOSES].sort());
  }
});

test.afterAll(async () => {
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

test("both adults add the synthetic file, and its runs measure is stored with it", async ({
  page,
}) => {
  const admin = adminClient();
  const fixture = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
  const measure = fixtureCheck.measure;
  if (measure.status !== "measured") throw new Error("the fixture must be measurable");

  for (const account of [A, B]) {
    await signIn(page, account.email, account.password);
    const fileId = await ingestFileAs(page, account.email, account.password, fixture, "vcf");
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("genome_files")
            .select("status")
            .eq("id", fileId)
            .single();
          return (data as { status: string } | null)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("annotated");

    // The processing route measured the file's own runs once and stored
    // them (ADR 0017 §7, D-030): the same numbers the real measure gives
    // for the fixture, and nothing about any other file.
    const { data: stored } = await admin
      .from("genome_files")
      .select("roh_status, roh_reason, roh_total_bases, roh_covered_bases, roh_fraction, roh_measured_at")
      .eq("id", fileId)
      .single();
    const columns = stored as {
      roh_status: string | null;
      roh_reason: string | null;
      roh_total_bases: number | string | null;
      roh_covered_bases: number | string | null;
      roh_fraction: number | string | null;
      roh_measured_at: string | null;
    };
    expect(columns.roh_status).toBe("measured");
    expect(columns.roh_reason).toBeNull();
    expect(Number(columns.roh_total_bases)).toBe(measure.totalRunBases);
    expect(Number(columns.roh_covered_bases)).toBe(measure.coveredSpanBases);
    expect(Math.abs(Number(columns.roh_fraction) - measure.fRoh)).toBeLessThan(1e-6);
    expect(columns.roh_measured_at).not.toBeNull();
    expect(measure.aboveThreshold).toBe(false);
    expect(measure.runCount).toBeGreaterThanOrEqual(1);
    expect(Number(columns.roh_total_bases)).toBeGreaterThan(0);

    await page.request.post("/auth/sign-out");
  }
});

test("the page withholds every result until the one Tier-2 gate is passed", async ({ page }) => {
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

test("the side-by-side table compares nothing and offers no way to order it", async ({ page }) => {
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
  expect(tableCount).toBeGreaterThan(0);
  const layers = await tables.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-layer")),
  );
  expect(new Set(layers).size).toBe(tableCount);
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

  // With both report layers granted, the other adult's cells carry their
  // letters as observed genotype figures, and no cell says "not shared".
  const lettersOfB = page.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="cell-absence"]', { hasText: NOT_SHARED_CELL })).toHaveCount(0);

  // Nothing sorts, ranks or sums.
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  await expect(page.locator("th button")).toHaveCount(0);
  await expect(page.locator("[data-compare-surface] button")).toHaveCount(0);
  const content = await page.content();
  expect(content).not.toMatch(/aria-sort/);

  // The mandated column footer, once per column and nowhere altered.
  const footers = page.locator('[data-slot="column-footer"]');
  await expect(footers).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await expect(footers.nth(index)).toHaveText(BASELINE_ABSENT);
  }

  // Acceptance 20: nothing on this page says how these two people are related.
  expect(content).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);
});

test("the carrier panel gives one probability, names both variants, and names a reason for every other match", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await passGate(page);

  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "A change you both carry" })).toBeVisible();

  // One block per gene both files carry a change in: the five carried
  // positions, and nothing for the two where neither file shows the
  // classified change.
  const blocks = panel.locator("[data-claim-block]");
  await expect(blocks).toHaveCount(CARRIED.length);
  for (const entry of NOT_CARRIED) await expect(panel).not.toContainText(entry.gene);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveCount(0);

  // Exactly one block carries the mandated sentence, and it reads as one line.
  const sentences = panel.locator('[data-slot="carrier-sentence"]');
  await expect(sentences).toHaveCount(CARRIED.length);
  const withProbability = panel.locator(
    '[data-claim-block]:has([data-figure-basis="exact"])',
  );
  await expect(withProbability).toHaveCount(1);
  await expect(withProbability.locator('[data-slot="carrier-sentence"]')).toHaveText(
    CARRIER_SENTENCE,
  );
  await expect(withProbability.locator("[data-exact-marker]")).toHaveCount(1);
  await expect(withProbability.locator("[data-exact-marker]")).toHaveText(EXACT_MARKER);
  const probable = CARRIED.find((entry) => entry.block === "probability")!;
  await expect(withProbability).toContainText(probable.gene);

  // Brief line 346: both variants and both classifications, not just the
  // gene — one line per person, with the reference's own label.
  const variantLines = withProbability.locator('[data-slot="carrier-variant"]');
  await expect(variantLines).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await expect(variantLines.nth(index)).toContainText(`rs${probable.rsid}`);
    await expect(variantLines.nth(index)).toContainText(probable.gene);
    await expect(variantLines.nth(index)).toContainText(probable.significance);
  }
  await expect(variantLines.nth(1)).toContainText(B_AS_SEEN_BY_A);

  // Acceptance 17: no other block anywhere on the page states the fraction.
  const texts = await page
    .locator("[data-claim-block]")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(texts.filter((text) => text.includes("25 in 100"))).toHaveLength(1);
  expect(texts.filter((text) => text.includes("1 in 4"))).toHaveLength(1);

  // Each pair block names one pair, and both people are chipped in it.
  const pairs = await panel
    .locator("[data-claim-block]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-subject-pair")));
  expect(new Set(pairs)).toEqual(new Set([`${selfSubjectA}:${selfSubjectB}`]));
  await expect(withProbability.locator('[data-slot="carrier-person"]')).toHaveCount(2);
  await expect(withProbability).toContainText(B_AS_SEEN_BY_A);

  // The other four carry no number, and each says which reason applies,
  // and names both variants all the same.
  for (const entry of CARRIED.filter((item) => item.block !== "probability")) {
    const block = panel.locator(`[data-claim-block]:has-text("${entry.gene}")`);
    await expect(block).toHaveCount(1);
    await expect(block.locator('[data-slot="carrier-sentence"]')).toHaveText(
      `Both of you have a change in ${entry.gene}, but Inherit cannot turn that into a chance for a pregnancy. Reason: ${entry.block}.`,
    );
    await expect(block.locator('[data-figure-basis="exact"]')).toHaveCount(0);
    await expect(block.locator("[data-exact-marker]")).toHaveCount(0);
    await expect(block.locator('[data-slot="carrier-variant"]')).toHaveCount(2);
    await expect(block.locator('[data-slot="carrier-variant"]').first()).toContainText(`rs${entry.rsid}`);
  }

  // Two changed copies in both files: the chip says so, and no probability renders (D-035).
  const twoCopies = CARRIED.find((entry) => entry.gt === "1/1")!;
  const twoCopiesBlock = panel.locator(`[data-claim-block]:has-text("${twoCopies.gene}")`);
  const statuses = twoCopiesBlock.locator('[data-figure-kind="carrier-status"]');
  await expect(statuses).toHaveCount(2);
  await expect(statuses.nth(0)).toContainText("two copies");
  await expect(statuses.nth(1)).toContainText("two copies");

  // Neither marker contradicts the other, and nothing is called a model.
  await expect(page.locator("[data-modelled-marker]")).toHaveCount(0);
});

test("the page keeps its budgets and is clean in both themes", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await passGate(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(24);
  await expectAxeClean(page);
});

test("the Overview names the match, carries the pair and shows no value", async ({ page }) => {
  await signIn(page, A.email, A.password);
  // The Overview's carrier line reads nothing before the domain's gate is
  // passed in this session, so the gate is passed on the domain's page first.
  await passGate(page);
  await page.goto("/overview");
  const line = page.locator(`[data-subject-pair="${selfSubjectA}:${selfSubjectB}"]`);
  await expect(line).toHaveCount(1);
  await expect(line.getByRole("link", { name: "1 carrier match to look at" })).toBeVisible();
  await expect(line).toContainText("Two people carry a change in the same gene.");
  await expect(line.getByRole("link")).toHaveAttribute(
    "href",
    "/family/health-picture#carrier-matches",
  );
  await expect(line.locator("[data-figure-kind]")).toHaveCount(0);
  expect(await line.textContent()).not.toContain("25 in 100");
});

test("without that layer's own grant, the other adult's cells read as not shared while the column and the panel remain", async ({
  page,
}) => {
  // B withdraws the estimates layer toward A; the joint grant and the
  // variant layer stay. The column still opens on the joint grant, and so
  // does the carrier panel; the cells of that layer do not (D-038).
  const { error } = await adminClient().rpc("revoke_directional_purpose_v1", {
    p_account_id: accountB,
    p_grant_id: grantsFromB.get("reports.polygenic"),
  });
  expect(error).toBeNull();

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

  // The joint projection stays: the panel still lists every match.
  await expect(page.locator('[data-slot="carrier-panel"] [data-claim-block]')).toHaveCount(
    CARRIED.length,
  );
  await expect(page.locator('[data-slot="column-footer"]')).toHaveCount(2);
});

test("with no match left, the panel counts the classified positions both files cover", async ({
  page,
}) => {
  // Only the two positions neither file shows the classified change at
  // stay classified: both files cover them, so there is something to check
  // and nothing to show.
  await declassify(CARRIED.map((entry) => entry.rsid));

  await signIn(page, A.email, A.password);
  await passGate(page);
  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(
    `No change to show that you both carry. Inherit checked the ${NOT_CARRIED.length} positions both files cover.`,
  );
  expect(await page.content()).not.toContain("25 in 100");

  await page.goto("/overview");
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
});

test("with no classified position at all, the panel says so in words, never a count of zero", async ({
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
  // The table beneath still shows the positions both files do cover.
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
});

test("revoking one direction empties the panel and the Overview line at once", async ({ page }) => {
  const { error } = await adminClient().rpc("revoke_directional_purpose_v1", {
    p_account_id: accountB,
    p_grant_id: grantsFromB.get("family.heritability"),
  });
  expect(error).toBeNull();

  // Under two columns the page states so before the gate: nothing to pass.
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");
  await expect(page.getByText(NEEDS_TWO, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="carrier-panel"]')).toHaveCount(0);
  await expect(page.locator("[data-compare-surface]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  expect(await page.content()).not.toContain("25 in 100");

  await page.goto("/overview");
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
  await expect(page.getByText("carrier match")).toHaveCount(0);
});
