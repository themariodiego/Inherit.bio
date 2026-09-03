import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  adminClient,
  createConfirmedUser,
  firstViewportInteractives,
  ingestFileAs,
  signIn,
} from "./helpers";
import { CARRIER_POSITIONS, CARRIER_RSIDS } from "./fixtures/carrier-pair-positions";

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
 * other match; and no word about how the two people are related.
 *
 * Setup. No screen grants `family.heritability` — the five permission rows
 * are the report layers, ancestry, raw data and Portrait — so the spec
 * creates the two grants through the real routine
 * (`grant_directional_purpose_v1`) with the service-role client, exactly as
 * a screen would once one exists. The four classified positions are
 * synthetic rows inserted here and removed in `afterAll`: the shipped
 * reference table has no classification at all, so this branch has no other
 * way to be proved.
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
const NEEDS_TWO =
  "This page needs two people who have both agreed to be seen side by side. So far there is 1.";

/** The four synthetic positions, with the reason each one must produce. */
const SYNTHETIC = [
  {
    rsid: CARRIER_RSIDS[0],
    gene: "E2EGENE1",
    significance: "Pathogenic",
    conditionId: "e2e-recessive",
    mode: "autosomal_recessive" as string | null,
    reason: null as string | null,
  },
  {
    rsid: CARRIER_RSIDS[1],
    gene: "E2EGENE2",
    significance: "Pathogenic",
    conditionId: "e2e-dominant",
    mode: "autosomal_dominant",
    reason: "the change runs in a dominant pattern",
  },
  {
    rsid: CARRIER_RSIDS[2],
    gene: "E2EGENE3",
    significance: "Uncertain significance",
    conditionId: "e2e-uncertain",
    mode: "autosomal_recessive",
    reason: "nobody yet knows what this change means",
  },
  {
    rsid: CARRIER_RSIDS[3],
    gene: "E2EGENE4",
    significance: "Pathogenic",
    conditionId: "e2e-no-pattern",
    mode: null,
    reason: "Inherit has no recorded inheritance pattern for this gene",
  },
] as const;

let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let grantFromB = "";

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

/** One directional `family.heritability` grant, through the real routine. */
async function grantSideBySide(
  granterAccount: string,
  granterSubject: string,
  recipientPrincipal: string,
  nonce: string,
): Promise<string> {
  const { data, error } = await adminClient().rpc("grant_directional_purpose_v1", {
    p_account_id: granterAccount,
    p_data_subject_id: granterSubject,
    p_recipient_principal_id: recipientPrincipal,
    p_purpose: "family.heritability",
    p_artifact_key: "consent.share-with-adult",
    p_artifact_version: 1,
    p_token_nonce: nonce,
  });
  if (error) throw new Error(`grant: ${error.message}`);
  return data as unknown as string;
}

async function expectAxeClean(page: Page) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
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

  // Synthetic reference rows: the shipped table classifies nothing, so the
  // carrier branches exist only against these. Every one is removed below.
  for (const [index, entry] of SYNTHETIC.entries()) {
    const { error: variantError } = await admin.from("ref_variants").upsert({
      rsid: entry.rsid,
      chrom: 1,
      pos38: CARRIER_POSITIONS[index],
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
    .in("rsid", SYNTHETIC.map((entry) => entry.rsid));
});

test("both adults add the synthetic file and turn on being seen side by side", async ({ page }) => {
  const admin = adminClient();
  const fixture = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");

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
    await page.request.post("/auth/sign-out");
  }

  accountA = await accountIdFor(A.email);
  accountB = await accountIdFor(B.email);
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);

  // The routine refuses `family.heritability` while the marker is unset, and
  // it is stamped by a server-verified sign-in the test harness cannot
  // reproduce for two accounts in one browser context.
  const { error: markError } = await admin
    .from("subjects")
    .update({ independent_login_at: new Date().toISOString() })
    .in("id", [selfSubjectA, selfSubjectB]);
  expect(markError).toBeNull();

  const principalA = await principalOf(selfSubjectA, accountA);
  const principalB = await principalOf(selfSubjectB, accountB);
  // The presentation nonce is single-use by design, so each run mints its own.
  await grantSideBySide(accountA, selfSubjectA, principalB, `e2e-hp-${randomUUID()}`);
  grantFromB = await grantSideBySide(
    accountB,
    selfSubjectB,
    principalA,
    `e2e-hp-${randomUUID()}`,
  );

  const { data: live } = await admin
    .from("purpose_grants")
    .select("purpose, target_id")
    .in("target_id", [selfSubjectA, selfSubjectB])
    .is("revoked_at", null);
  expect(live).toHaveLength(2);
  for (const row of live!) expect(row).toMatchObject({ purpose: "family.heritability" });
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
  await page.getByRole("button", { name: "Show what’s shared" }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
});

test("the side-by-side table compares nothing and offers no way to order it", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");

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

test("the carrier panel gives one probability and names a reason for every other match", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");

  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "A change you both carry" })).toBeVisible();

  const blocks = panel.locator("[data-claim-block]");
  await expect(blocks).toHaveCount(4);

  // Exactly one block carries the mandated sentence, and it reads as one line.
  const sentences = panel.locator('[data-slot="carrier-sentence"]');
  await expect(sentences).toHaveCount(4);
  const withProbability = panel.locator(
    '[data-claim-block]:has([data-figure-basis="exact"])',
  );
  await expect(withProbability).toHaveCount(1);
  await expect(withProbability.locator('[data-slot="carrier-sentence"]')).toHaveText(
    CARRIER_SENTENCE,
  );
  await expect(withProbability.locator("[data-exact-marker]")).toHaveCount(1);
  await expect(withProbability.locator("[data-exact-marker]")).toHaveText(EXACT_MARKER);
  await expect(withProbability).toContainText(SYNTHETIC[0].gene);

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

  // The other three carry no number, and each says which reason applies.
  for (const entry of SYNTHETIC.filter((item) => item.reason !== null)) {
    const block = panel.locator(`[data-claim-block]:has-text("${entry.gene}")`);
    await expect(block.locator('[data-slot="carrier-sentence"]')).toHaveText(
      `Both of you have a change in ${entry.gene}, but Inherit cannot turn that into a chance for a pregnancy. Reason: ${entry.reason}.`,
    );
    await expect(block.locator('[data-figure-basis="exact"]')).toHaveCount(0);
    await expect(block.locator("[data-exact-marker]")).toHaveCount(0);
  }

  // Neither marker contradicts the other, and nothing is called a model.
  await expect(page.locator("[data-modelled-marker]")).toHaveCount(0);
});

test("the page keeps its budgets and is clean in both themes", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/family/health-picture");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(24);
  await expectAxeClean(page);
});

test("the Overview names the match, carries the pair and shows no value", async ({ page }) => {
  await signIn(page, A.email, A.password);
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

test("revoking one direction empties the panel and the Overview line at once", async ({ page }) => {
  const { error } = await adminClient().rpc("revoke_directional_purpose_v1", {
    p_account_id: accountB,
    p_grant_id: grantFromB,
  });
  expect(error).toBeNull();

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
