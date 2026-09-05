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
import {
  ACKNOWLEDGE_BUTTON,
  ACKNOWLEDGE_CHECKBOX_LABEL,
  BANNER_FIRST,
  BANNER_SECOND,
  BLOCKING_BODY,
  DELETE_BUTTON,
  DELETE_CONFIRM_BUTTON,
  DELETE_DIALOG_HEADING,
  DISTINGUISHING_PRINCIPLE,
  HEADER_SENTENCE,
  NO_CLASSIFIED_POSITIONS,
  OPEN_CONSENTS_BUTTON,
  PORTRAIT_H1,
  PORTRAIT_STEPS,
  REFUSALS,
  REFUSALS_HEADING,
  TRAIT_NAMES,
  VIEWER_PORTRAIT_STEPS,
  blockingHeading,
  missingStep,
  unregisteredCard,
  viewerMissingStep,
} from "@/copy/family/portrait";
import { TRAIT_KEYS } from "@/lib/family/traits";

/**
 * `/family/portrait/[pairId]` (design docs/design/w9-family-surfaces.md
 * §6.2; the brief's `portrait` suite, line 2308): two adults with their own
 * accounts, an invitation-free pairing through the real grant routine, the
 * real acknowledgement routine, the real independent-login marker, and the
 * synthetic carrier-pair fixture ingested for both.
 *
 * What it pins: with only A's grant, the blocking screen naming B and each
 * undone step, the banner pair verbatim, no figure and no image; A's own
 * acknowledgement through the real checkbox, recorded for A's subject only;
 * the Tier-2 gate withholding every result server-side; the page proper —
 * the header sentence, the principle, the segregation sentence once per
 * output, the chance-not-prediction line in every claim block, the
 * exactness label once in the recessive block with the mandated derivation,
 * 100 outcome dots as spans and no `img`, `canvas` or `svg[role=img]`, the
 * side-by-side page's refusal sentence for every other match and never a
 * fraction, "How sure we are" outside any details, every trait card
 * unregistered, the refusals list server-rendered with at least eight items
 * and no value; byte-equal finding text from A's and B's sessions; no
 * second-person sentence about a child in `src/` or the rendered page;
 * the budgets and axe in both themes; the empty state in words; and B's
 * deletion closing the page for both on the next request.
 *
 * The Tier-2 gate is a session cookie keyed to the auth session
 * (src/lib/family/tier2.ts), and every `test()` runs in a fresh browser
 * context, so every test that reads a result passes the gate itself.
 */

const A = { email: "portrait-a@e2e.local", password: "e2e-portrait-pw" };
const B = { email: "portrait-b@e2e.local", password: "e2e-portrait-pw" };

/** Neither self subject carries a name, so each sees the other as an adult. */
const OTHER = "Another adult";

const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const SINGULAR_CHILD = /your child will|your baby will|your future child is|your baby’s/i;
const FORBIDDEN_MEDIA = "main img, main canvas, main svg[role=img]";

interface SyntheticEntry {
  gene: string;
  significance: string;
  conditionId: string;
  mode: string | null;
  /** The genotype the fixture writes at this position (carrier-pair-positions.ts). */
  gt: FixtureGenotype;
  /** `probability`: the one recessive block; a phrase: a refused block with that reason; null: no block. */
  block: "probability" | string | null;
}

/** The seven synthetic positions, in the order of `CARRIER_FIXTURE_POSITIONS`, with what each must produce. */
const SYNTHETIC: readonly SyntheticEntry[] = [
  { gene: "PTGENE1", significance: "Pathogenic", conditionId: "portrait-recessive", mode: "autosomal_recessive", gt: "0/1", block: "probability" },
  { gene: "PTGENE2", significance: "Pathogenic", conditionId: "portrait-dominant", mode: "autosomal_dominant", gt: "0/1", block: "dominant" },
  { gene: "PTGENE3", significance: "Uncertain significance", conditionId: "portrait-uncertain", mode: "autosomal_recessive", gt: "0/1", block: "unknown-meaning" },
  { gene: "PTGENE4", significance: "Pathogenic", conditionId: "portrait-x-linked", mode: "x_linked", gt: "0/1", block: "sex-unknown" },
  { gene: "PTGENE5", significance: "Pathogenic", conditionId: "portrait-two-copies", mode: "autosomal_recessive", gt: "1/1", block: "two-copies" },
  { gene: "PTGENE6", significance: "Pathogenic", conditionId: "portrait-other-letter-1", mode: "autosomal_recessive", gt: "0/2", block: null },
  { gene: "PTGENE7", significance: "Likely pathogenic", conditionId: "portrait-other-letter-2", mode: "autosomal_recessive", gt: "0/2", block: null },
];


const rsidOf = (index: number) => CARRIER_FIXTURE_POSITIONS[index].rsid;
let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let principalA = "";
let principalB = "";
let pairId = "";
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

function authSessionIdOf(accessToken: string): string {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { session_id?: unknown };
  if (typeof payload.session_id !== "string") throw new Error("the access token carries no session id");
  return payload.session_id;
}

/**
 * The independent-login marker through the real routine from a real session
 * of the account (`grant_directional_purpose_v1` refuses `family.portrait`
 * while it is unset, and the page names it as a step). These accounts
 * accepted no invitation, so any session of theirs stamps.
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

/** One directional Portrait grant, through the real routine, from the granter's own account. */
async function grantPortrait(
  granterAccount: string,
  granterSubject: string,
  recipientPrincipal: string,
): Promise<string> {
  const { data, error } = await adminClient().rpc("grant_directional_purpose_v1", {
    p_account_id: granterAccount,
    p_data_subject_id: granterSubject,
    p_recipient_principal_id: recipientPrincipal,
    p_purpose: "family.portrait",
    p_artifact_key: "consent.share-with-adult",
    p_artifact_version: 1,
    p_token_nonce: `e2e-portrait-${randomUUID()}`,
  });
  if (error) throw new Error(`grant family.portrait: ${error.message}`);
  return data as unknown as string;
}

async function acknowledgedAt(subjectId: string): Promise<string | null> {
  const { data } = await adminClient()
    .from("subjects")
    .select("portrait_acknowledged_at")
    .eq("id", subjectId)
    .single();
  return (data as { portrait_acknowledged_at: string | null }).portrait_acknowledged_at;
}

async function pairOf(): Promise<{ id: string; status: string }> {
  const { data } = await adminClient()
    .from("family_pairs")
    .select("id, status, subject_a_id, subject_b_id")
    .or(`subject_a_id.eq.${selfSubjectA},subject_b_id.eq.${selfSubjectA}`);
  const pair = (data as { id: string; status: string; subject_a_id: string; subject_b_id: string }[]).find(
    (row) => row.subject_a_id === selfSubjectB || row.subject_b_id === selfSubjectB,
  );
  if (!pair) throw new Error("no pair between A and B");
  return pair;
}

const url = () => `/family/portrait/${pairId}`;

/**
 * Passes the domain's one Tier-2 gate on this page in this browser context,
 * after `signIn`: the gate cookie is keyed to the auth session, so a fresh
 * context sees the gate again until it is acknowledged.
 */
async function passGate(page: Page) {
  await page.goto(url());
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toBeVisible();
}

/** Axe in both themes, each on a fresh load in that theme (D-025). */
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

/** The finding texts of the page: every `[data-finding]` node, in document order. */
async function findingTexts(page: Page): Promise<string[]> {
  return page.locator("[data-claim-block] [data-finding]").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

/** Every source file under `src/` that is not a test, for the singular-child grep (G5.9(d)). */
function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(absolute));
    else if (/\.(tsx?|json|md|mdx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(absolute);
    }
  }
  return out;
}

test.beforeAll(async () => {
  const admin = adminClient();
  await createConfirmedUser(A.email, A.password);
  await createConfirmedUser(B.email, B.password);

  expect(SYNTHETIC).toHaveLength(CARRIER_FIXTURE_POSITIONS.length);
  SYNTHETIC.forEach((entry, index) => expect(entry.gt).toBe(CARRIER_FIXTURE_POSITIONS[index].gt));

  // The committed fixture is what the generator builds, and the real parser
  // and the real runs measure accept it.
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
      sources: { synthetic: "e2e/portrait.spec.ts" },
    });
    if (variantError) throw new Error(`ref_variants: ${variantError.message}`);
    const { error: conditionError } = await admin.from("condition_registry").upsert({
      condition_id: entry.conditionId,
      condition_name: `Synthetic Portrait entry ${index + 1}`,
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

  accountA = await accountIdFor(A.email);
  accountB = await accountIdFor(B.email);
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);
  await markIndependentLogin(A, accountA);
  await markIndependentLogin(B, accountB);
  principalA = await principalOf(selfSubjectA, accountA);
  principalB = await principalOf(selfSubjectB, accountB);
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

test("both adults add the synthetic file to their own record", async ({ page }) => {
  const admin = adminClient();
  const fixture = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
  for (const account of [A, B]) {
    await signIn(page, account.email, account.password);
    const fileId = await ingestFileAs(page, account.email, account.password, fixture, "vcf");
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("genome_files").select("status").eq("id", fileId).single();
          return (data as { status: string } | null)?.status;
        },
        { timeout: 60_000 },
      )
      .toBe("annotated");
    await page.request.post("/auth/sign-out");
  }
});

test("with only A's grant, the page is the blocking screen: it names B's steps, carries the banner pair and shows no figure", async ({
  page,
}) => {
  // A turns Portrait on from A's own account; the routine creates the pair.
  await grantPortrait(accountA, selfSubjectA, principalB);
  const pair = await pairOf();
  pairId = pair.id;
  expect(pair.status).toBe("pending");

  await signIn(page, A.email, A.password);
  await page.goto(url());
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(`Family / ${OTHER} / ${PORTRAIT_H1}`);
  await expect(page.locator('nav[aria-label="Breadcrumb"] a').nth(1)).toHaveAttribute(
    "href",
    `/family/s-${selfSubjectB}`,
  );

  // Both chips, no file count on either (a fact about another adult's files).
  const bar = page.locator('[data-slot="pair-bar"]');
  await expect(bar.locator('[data-slot="pair-person"]')).toHaveCount(2);
  await expect(bar.locator('[data-slot="subject-files"]')).toHaveCount(0);
  await expect(bar.locator('[data-slot="subject-kind"]', { hasText: /^Shared with you$/ })).toHaveCount(1);

  // The banner pair, verbatim, on the blocking screen too, and never inside a details.
  await expect(page.locator('[data-slot="portrait-banner-first"]')).toHaveText(BANNER_FIRST);
  await expect(page.locator('[data-slot="portrait-banner-second"]')).toHaveText(BANNER_SECOND);
  await expect(page.locator("details", { hasText: BANNER_FIRST })).toHaveCount(0);

  // The register's contract: heading naming who has a step left, the body,
  // the server-derived list, the action to the consents page.
  const blocking = page.locator('[data-slot="portrait-blocking"]');
  await expect(blocking).toHaveAttribute("data-state", "consent-required");
  await expect(blocking.getByRole("heading", { level: 2 })).toHaveText(blockingHeading(`you and ${OTHER}`));
  await expect(blocking).toContainText(BLOCKING_BODY);
  const steps = blocking.locator('[data-slot="portrait-missing-step"]');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toHaveText(viewerMissingStep(VIEWER_PORTRAIT_STEPS.acknowledged));
  await expect(steps.nth(1)).toHaveText(missingStep(OTHER, PORTRAIT_STEPS.grant));
  await expect(steps.nth(2)).toHaveText(missingStep(OTHER, PORTRAIT_STEPS.acknowledged));
  await expect(page.getByRole("link", { name: OPEN_CONSENTS_BUTTON })).toHaveAttribute("href", "/settings/consents");

  // Nothing derived, no image, no result (acceptance 16, G5.9(a)).
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator(FORBIDDEN_MEDIA)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("data-figure-kind");
  expect(html).not.toContain("outcome-dot");
  for (const entry of SYNTHETIC) expect(html).not.toContain(entry.gene);
  expect(html).not.toContain("25 in 100");
  expect(html).not.toMatch(SINGULAR_CHILD);
});

test("A acknowledges through the real checkbox, for A's own subject only", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto(url());
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await expect(form.getByText(ACKNOWLEDGE_CHECKBOX_LABEL, { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: ACKNOWLEDGE_BUTTON })).toBeDisabled();
  // Nothing is pre-ticked and nothing is remembered on the device.
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  expect(await acknowledgedAt(selfSubjectA)).toBeNull();

  // The endpoint refuses the other person's subject from this session, and
  // stamps nothing: the acknowledgement is one person's own, always.
  const foreign = await page.request.post("/api/family/acknowledge", {
    headers: { origin: "http://localhost:3100" },
    data: { acknowledgement: "portrait", subjectId: selfSubjectB, affirmed: true },
  });
  expect(foreign.ok()).toBe(false);
  expect(await acknowledgedAt(selfSubjectB)).toBeNull();

  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON }).click();

  // A's own step is gone on the refreshed page; B's two remain; no checkbox is offered.
  const blocking = page.locator('[data-slot="portrait-blocking"]');
  await expect(blocking.locator('[data-slot="portrait-missing-step"]')).toHaveCount(2);
  await expect(blocking.getByRole("heading", { level: 2 })).toHaveText(blockingHeading(OTHER));
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: OPEN_CONSENTS_BUTTON })).toHaveAttribute("href", "/settings/consents");
  expect(await acknowledgedAt(selfSubjectA)).not.toBeNull();
  expect(await acknowledgedAt(selfSubjectB)).toBeNull();
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
});

test("once B has turned Portrait on and acknowledged, the page withholds every result until the one Tier-2 gate is passed", async ({
  page,
}) => {
  await grantPortrait(accountB, selfSubjectB, principalA);
  const { data: stamp, error } = await adminClient().rpc("acknowledge_portrait_v1", {
    p_account_id: accountB,
    p_subject_id: selfSubjectB,
  });
  expect(error).toBeNull();
  expect(stamp).toBeTruthy();
  expect((await pairOf()).status).toBe("current");

  await signIn(page, A.email, A.password);
  await page.goto(url());
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-blocking"]')).toHaveCount(0);
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-banner-first"]')).toHaveText(BANNER_FIRST);

  const gatedHtml = await page.content();
  expect(gatedHtml).not.toContain("data-figure-kind");
  expect(gatedHtml).not.toContain("data-claim-block");
  expect(gatedHtml).not.toContain("outcome-dot");
  expect(gatedHtml).not.toContain("25 in 100");
  expect(gatedHtml).not.toContain(HEADER_SENTENCE);
  for (const entry of SYNTHETIC) expect(gatedHtml).not.toContain(entry.gene);
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.local).not.toMatch(/tier2|family|portrait/i);
  expect(stored.session).not.toMatch(/tier2|family|portrait/i);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
});

test("the page proper withholds legacy-label outputs, states unavailable rather than negative, and never shows a picture", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await passGate(page);

  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
  await expect(page.locator('[data-slot="distinguishing-principle"]')).toHaveText(DISTINGUISHING_PRINCIPLE);
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);
  await expect(page.getByRole("heading", { name: "What a child could inherit" })).toBeVisible();

  // Legacy labels are intentionally present in the database. They lack
  // reviewed allele/condition/assertion provenance and cannot activate output.
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("[data-exact-marker], [data-modelled-marker], [data-figure-basis=exact], [data-slot=outcome-dot]")).toHaveCount(0);
  for (const entry of SYNTHETIC) await expect(page.locator("main")).not.toContainText(entry.gene);
  await expect(page.locator("main")).not.toContainText("No change to show that you both carry");

  // G5.9(a): no image, avatar or face anywhere in the result region; the
  // dots are spans. Line 2238: no monogenic zero.
  await expect(page.locator(FORBIDDEN_MEDIA)).toHaveCount(0);
  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toMatch(/(^|[^\d])0%/);
  expect(mainText).not.toMatch(/\b0 in 100\b/);
  expect(mainText).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);

  // Every trait card states the registry's state; none carries a figure.
  const traitCards = page.locator('[data-slot="trait-card"]');
  await expect(traitCards).toHaveCount(TRAIT_KEYS.length);
  for (const key of TRAIT_KEYS) {
    const card = page.locator(`[data-slot="trait-card"][data-trait="${key}"]`);
    await expect(card.locator('[data-slot="trait-status"]')).toHaveText(unregisteredCard(TRAIT_NAMES[key]));
    await expect(card.locator("[data-figure-kind]")).toHaveCount(0);
    await expect(card.locator("[data-claim-block]")).toHaveCount(0);
  }

  // The delete control is real: one destructive action, no dialog until asked.
  await expect(page.getByRole("button", { name: DELETE_BUTTON })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-delete-dialog"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Data and methods" })).toHaveAttribute("href", "/genome/me/data");
});

test("the refusals are server-rendered with at least eight items, no value, and no sentence about one child anywhere", async ({
  page,
}) => {
  await signIn(page, A.email, A.password);
  await passGate(page);

  // Brief lines 1368 and 495: the list is in the server-rendered HTML.
  const response = await page.request.get(url());
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('id="not-shown"');
  expect(html).toContain(REFUSALS_HEADING);
  const ids = html.match(/data-refusal-id="[^"]+"/g) ?? [];
  expect(ids.length).toBeGreaterThanOrEqual(8);
  expect(ids).toHaveLength(REFUSALS.length);
  for (const refusal of REFUSALS) expect(html).toContain(`data-refusal-id="${refusal.refusalId}"`);

  const section = page.locator("#not-shown");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(REFUSALS_HEADING);
  await expect(section.locator("[data-refusal-id]")).toHaveCount(REFUSALS.length);
  await expect(page.locator("details #not-shown")).toHaveCount(0);
  await expect(section.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(section.locator("[data-claim-block]")).toHaveCount(0);
  // Acceptance 15: no value for intelligence, height, BMI, personality, appearance or sex.
  const sectionText = await section.innerText();
  for (const word of ["Intelligence", "Height", "BMI", "Personality", "Appearance", "sex"]) {
    expect(sectionText).toContain(word);
  }
  expect(sectionText).not.toMatch(/\d+(\.\d+)?\s?%|\b\d+ in \d+\b/);
  await expect(section.getByRole("link", { name: "Read more about these limits" })).toHaveAttribute("href", "/science");

  // Acceptance 14, G5.9(d): no second-person sentence about a child in the
  // rendered page, nor in any source or copy file under src/.
  expect(html).not.toMatch(SINGULAR_CHILD);
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    expect(fs.readFileSync(file, "utf8"), file).not.toMatch(SINGULAR_CHILD);
  }
});

test("A's session and B's session render byte-equal finding text (brief line 1337)", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await passGate(page);
  const fromA = await findingTexts(page);
  expect(fromA).toEqual([]);
  const unavailableA = await page.locator('[data-slot="portrait-empty"]').textContent();
  expect(unavailableA).toBe(NO_CLASSIFIED_POSITIONS);
  await page.request.post("/auth/sign-out");

  await signIn(page, B.email, B.password);
  await passGate(page);
  const fromB = await findingTexts(page);
  expect(fromB).toEqual(fromA);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveText(unavailableA!);
  // B sees A as the other adult and themself as "You"; the findings name nobody.
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(`Family / ${OTHER} / ${PORTRAIT_H1}`);
  for (const text of fromB) expect(text).not.toContain(OTHER);
});

test("the page keeps its budgets and is clean in both themes", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await passGate(page);
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const interactives = await firstViewportInteractives(page);
    expect(interactives.length, `${viewport.name}: ${interactives.join(" | ")}`).toBeLessThanOrEqual(12);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  // One primary action at most in the first viewport: the page proper has none.
  await expect(page.locator('main [data-variant="default"]')).toHaveCount(0);
  await expectAxeClean(page);
});

test("with no classified position, the outputs say so in words while the trait cards and the refusals remain", async ({
  page,
}) => {
  const { error } = await adminClient()
    .from("ref_variants")
    .update({ clinvar_significance: null })
    .in("rsid", CARRIER_FIXTURE_POSITIONS.map((entry) => entry.rsid));
  expect(error).toBeNull();

  await signIn(page, A.email, A.password);
  await passGate(page);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator('[data-slot="trait-card"]')).toHaveCount(TRAIT_KEYS.length);
  await expect(page.locator("#not-shown [data-refusal-id]")).toHaveCount(REFUSALS.length);
  await expect(page.locator('[data-slot="portrait-banner-first"]')).toHaveText(BANNER_FIRST);
  expect(await page.content()).not.toContain("25 in 100");
});

test("B deletes it: the page closes for both on the next request, and B's own grant is the one revoked", async ({
  page,
}) => {
  await signIn(page, B.email, B.password);
  await passGate(page);
  await page.getByRole("button", { name: DELETE_BUTTON }).click();
  const dialog = page.locator('[data-slot="portrait-delete-dialog"]');
  await expect(dialog).toContainText(DELETE_DIALOG_HEADING);
  await dialog.getByRole("button", { name: DELETE_CONFIRM_BUTTON }).click();

  // B's next render is the blocking screen naming B's own step.
  const blocking = page.locator('[data-slot="portrait-blocking"]');
  await expect(blocking.getByRole("heading", { level: 2 })).toHaveText(blockingHeading("you"));
  await expect(blocking.locator('[data-slot="portrait-missing-step"]')).toHaveText([
    viewerMissingStep(VIEWER_PORTRAIT_STEPS.grant),
  ]);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);

  const admin = adminClient();
  const { data: grantsB } = await admin
    .from("purpose_grants")
    .select("purpose, revoked_at")
    .eq("target_id", selfSubjectB)
    .eq("purpose", "family.portrait");
  expect((grantsB as { revoked_at: string | null }[]).every((row) => row.revoked_at !== null)).toBe(true);
  const { data: grantsA } = await admin
    .from("purpose_grants")
    .select("purpose")
    .eq("target_id", selfSubjectA)
    .eq("purpose", "family.portrait")
    .is("revoked_at", null);
  expect(grantsA).toHaveLength(1);
  expect((await pairOf()).status).toBe("pending");
  const { count } = await admin
    .from("portrait_results")
    .select("id", { count: "exact", head: true })
    .eq("family_pair_id", pairId);
  expect(count ?? 0).toBe(0);

  // Acceptance 19: A's very next request is the blocking screen naming B, with nothing derived.
  await page.request.post("/auth/sign-out");
  await signIn(page, A.email, A.password);
  await page.goto(url());
  const blockingForA = page.locator('[data-slot="portrait-blocking"]');
  await expect(blockingForA.getByRole("heading", { level: 2 })).toHaveText(blockingHeading(OTHER));
  await expect(blockingForA.locator('[data-slot="portrait-missing-step"]')).toHaveText([
    missingStep(OTHER, PORTRAIT_STEPS.grant),
  ]);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-banner-second"]')).toHaveText(BANNER_SECOND);
});
