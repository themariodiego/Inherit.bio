import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, firstViewportInteractives, signIn } from "./helpers";
import { NO_COHORT_SENTENCE, STANDING_STATEMENT } from "@/copy/embryos/compare";
import {
  EMPTY_HEADING,
  EMPTY_HOW_TO_MAKE_IT_APPEAR,
  EMPTY_WHAT_APPEARS,
  HUB_TILES,
  REQUEST_DATA_BUTTON,
  waitingForResultsBody,
  waitingForResultsStatus,
} from "@/copy/embryos/index";
import { EMBRYO_STATUS, RETENTION_SENTENCE, ROLE_YOU } from "@/copy/embryos/index";
import {
  COPIED_STATUS,
  COPY_EMAIL_BUTTON,
  FORMATS_SENTENCE,
  LETTER,
  NEXT_STEP_SENTENCE,
  REQUEST_DATA_H1,
} from "@/copy/embryos/request-data";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";

/**
 * Embryo surfaces (design docs/design/w10-embryo-surfaces.md §6.2,
 * `e2e/embryos.spec.ts`): the landing, request-data, compare and detail
 * pages in their honest states, for a signed-out visitor, for an account
 * with no cohort, and for two accounts that share one seeded cohort.
 *
 * The seed is written with the service role and labelled synthetic: two
 * cohorts, three embryos with quality rows on the first, one on the second.
 * No analysis grant can be seeded (the grant tables demand a paired write
 * the client cannot make), so the compare and detail pages are proven in
 * their consent-required state here; the gated and complete states are
 * proven over the same state resolver and renderers in the unit suite.
 * A second cohort names a required upload principal with no account, which
 * the capability reader resolves as unreviewed, so the jurisdiction-
 * unavailable state renders under the TEST-LOCAL flag without inventing a
 * jurisdiction row. The flag-off branch (every route refusing for an
 * account's real, unset jurisdiction) is `e2e/embryos.nojurisdiction.spec.ts`
 * in the `jurisdiction-off` project, against a second server from the same
 * build.
 *
 * The gate's write and read path (the cookie the acknowledgement sets is
 * the one `acknowledged()` verifies, and a different session fails) is
 * proven in `src/lib/embryos/tier2.test.ts` over the pure pair; the
 * browser proof of the gated and complete states stays blocked on a
 * seedable `embryo.analysis` grant (E0).
 */

const A = { email: "embryos-a@e2e.local", password: "e2e-embryos-pw" };
const B = { email: "embryos-b@e2e.local", password: "e2e-embryos-pw" };
const C = { email: "embryos-c@e2e.local", password: "e2e-embryos-pw" };

/** The register's own copy for an unreviewed capability (data/jurisdictions.json). */
const UNREVIEWED_COPY = "This part of Inherit is not available here because its legal review is not complete.";
const COPILOT_BLOCKED = HUB_TILES.find((tile) => tile.id === "copilot")!.blocked;
const COMPARE_BLOCKED = HUB_TILES.find((tile) => tile.id === "compare")!.blocked;

const NO_SEX = /\b(sex|male|female|XX|XY|chrX|chrY|chrM|karyotype|rank|ranked|best embryo)\b/i;
const UNKNOWN_UUID = "0e000000-0000-4000-8000-0000000000ff";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

let accountA = "";
let accountB = "";
let cohort1 = "";
let cohort2 = "";
let embryo1 = "";
let embryo2Of2 = "";

test.describe.configure({ mode: "serial" });

async function expectNoResults(page: Page) {
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator("[data-compare-surface]")).toHaveCount(0);
}

async function expectNoSexOrRank(page: Page) {
  expect(await page.locator("main").innerHTML()).not.toMatch(NO_SEX);
}

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

async function expectEveryLinkAnswers(page: Page) {
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of new Set(hrefs)) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
  }
}

async function accountPrincipalOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("subject_principals")
    .select("id")
    .eq("account_id", accountId)
    .eq("principal_kind", "account_subject")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .single();
  if (error || !data) throw new Error(`no account principal for ${accountId}: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Removes every synthetic row a previous run left, in FK order. */
async function unseed(ownerAccountId: string) {
  const admin = adminClient();
  const { data: cohorts } = await admin.from("embryo_cohorts").select("id").eq("owner_account_id", ownerAccountId);
  const cohortIds = (cohorts ?? []).map((row) => row.id as string);
  if (cohortIds.length > 0) {
    const { data: embryos } = await admin.from("embryos").select("id, subject_id").in("cohort_id", cohortIds);
    const embryoIds = (embryos ?? []).map((row) => row.id as string);
    const subjectIds = (embryos ?? []).map((row) => row.subject_id as string);
    if (embryoIds.length > 0) {
      await admin.from("embryo_qc").delete().in("embryo_id", embryoIds);
      await admin.from("embryos").delete().in("id", embryoIds);
    }
    if (subjectIds.length > 0) await admin.from("subjects").delete().in("id", subjectIds);
    await admin.from("embryo_participant_sets").delete().in("cohort_id", cohortIds);
    await admin.from("embryo_cohorts").delete().in("id", cohortIds);
  }
  await admin.from("embryo_cohort_drafts").delete().eq("owner_account_id", ownerAccountId);
  // The synthetic non-account parent: its principal, then its record.
  const { data: parents } = await admin
    .from("subjects")
    .select("id")
    .eq("owner_account_id", ownerAccountId)
    .eq("subject_class", "other_adult")
    .eq("display_label", "Synthetic other parent");
  const parentIds = (parents ?? []).map((row) => row.id as string);
  if (parentIds.length > 0) {
    await admin.from("subject_principals").delete().in("subject_id", parentIds);
    await admin.from("subjects").delete().in("id", parentIds);
  }
}

interface SeededEmbryo {
  ordinal: number;
  status: "qc_pass" | "qc_marginal" | "qc_fail";
  callRate: number;
}

async function seedCohort(input: {
  owner: string;
  uploaderPrincipal: string;
  requiredPrincipals: string[];
  createdAt: string;
  embryos: SeededEmbryo[];
}): Promise<{ cohortId: string; embryoIds: string[] }> {
  const admin = adminClient();
  const inThirtyDays = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const inTwoYears = new Date(Date.now() + 730 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const { data: draft, error: draftError } = await admin
    .from("embryo_cohort_drafts")
    .insert({
      owner_account_id: input.owner,
      uploader_principal_id: input.uploaderPrincipal,
      upload_class: "embryo_own",
      basis_case: "true_two_parent",
      embryo_count: input.embryos.length,
      state: "finalized",
      fixed_expires_at: inThirtyDays,
      finalized_at: now,
    })
    .select("id")
    .single();
  if (draftError || !draft) throw new Error(`draft: ${draftError?.message}`);
  const { data: cohort, error: cohortError } = await admin
    .from("embryo_cohorts")
    .insert({
      draft_id: draft.id,
      owner_account_id: input.owner,
      upload_class: "embryo_own",
      basis_case: "true_two_parent",
      basis_revision: 1,
      participant_set_revision: 1,
      donor_attribution_revision: 1,
      status: "active",
      embryo_count: input.embryos.length,
      retention_expires_at: inTwoYears,
      created_at: input.createdAt,
      uploaded_at: now,
    })
    .select("id")
    .single();
  if (cohortError || !cohort) throw new Error(`cohort: ${cohortError?.message}`);
  const { error: setError } = await admin.from("embryo_participant_sets").insert(
    input.requiredPrincipals.map((principal_id) => ({
      cohort_id: cohort.id,
      set_kind: "required_upload_principals",
      principal_id,
      set_revision: 1,
      membership_revision: 1,
    })),
  );
  if (setError) throw new Error(`participants: ${setError.message}`);
  const embryoIds: string[] = [];
  for (const embryo of input.embryos) {
    const { data: subject, error: subjectError } = await admin
      .from("subjects")
      .insert({
        owner_account_id: input.owner,
        subject_class: "embryo",
        upload_class: "embryo_own",
        display_label: `Embryo ${embryo.ordinal + 1}`,
        lifecycle: "active",
        cohort_id: cohort.id,
      })
      .select("id")
      .single();
    if (subjectError || !subject) throw new Error(`subject: ${subjectError?.message}`);
    const { data: row, error: embryoError } = await admin
      .from("embryos")
      .insert({
        cohort_id: cohort.id,
        subject_id: subject.id,
        sample_ordinal: embryo.ordinal,
        status: embryo.status,
        retention_expires_at: inTwoYears,
      })
      .select("id")
      .single();
    if (embryoError || !row) throw new Error(`embryo: ${embryoError?.message}`);
    const sitesExpected = 1000;
    const { error: qcError } = await admin.from("embryo_qc").insert({
      embryo_id: row.id,
      sites_expected: sitesExpected,
      sites_called: Math.round(embryo.callRate * sitesExpected),
      call_rate: embryo.callRate,
      qc_verdict: embryo.status === "qc_pass" ? "pass" : embryo.status === "qc_marginal" ? "marginal" : "fail",
      qc_reasons: embryo.status === "qc_pass" ? [] : ["embryo_call_rate"],
    });
    if (qcError) throw new Error(`qc: ${qcError.message}`);
    embryoIds.push(row.id);
  }
  return { cohortId: cohort.id, embryoIds };
}

test.beforeAll(async () => {
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);
  await createConfirmedUser(C.email, C.password);
  await unseed(accountA);
  const principalA = await accountPrincipalOf(accountA);
  const principalB = await accountPrincipalOf(accountB);

  // A required upload principal with no Inherit account: it has declared no
  // jurisdiction, so every capability over its cohort reads as unreviewed.
  const admin = adminClient();
  const { data: parent, error: parentError } = await admin
    .from("subjects")
    .insert({
      owner_account_id: accountA,
      subject_class: "other_adult",
      upload_class: "adult",
      display_label: "Synthetic other parent",
      lifecycle: "active",
    })
    .select("id")
    .single();
  if (parentError || !parent) throw new Error(`parent subject: ${parentError?.message}`);
  const { data: parentPrincipal, error: principalError } = await admin
    .from("subject_principals")
    .insert({ subject_id: parent.id, account_id: null, principal_kind: "genetic_parent", status: "active" })
    .select("id")
    .single();
  if (principalError || !parentPrincipal) throw new Error(`parent principal: ${principalError?.message}`);

  const first = await seedCohort({
    owner: accountA,
    uploaderPrincipal: principalA,
    requiredPrincipals: [principalA, principalB],
    createdAt: "2026-09-02T10:00:00.000Z",
    embryos: [
      { ordinal: 0, status: "qc_pass", callRate: 0.99 },
      { ordinal: 1, status: "qc_marginal", callRate: 0.9 },
      { ordinal: 2, status: "qc_fail", callRate: 0.6 },
    ],
  });
  cohort1 = first.cohortId;
  embryo1 = first.embryoIds[0];
  const second = await seedCohort({
    owner: accountA,
    uploaderPrincipal: principalA,
    requiredPrincipals: [principalA, parentPrincipal.id],
    createdAt: "2026-09-01T10:00:00.000Z",
    embryos: [{ ordinal: 0, status: "qc_pass", callRate: 0.98 }],
  });
  cohort2 = second.cohortId;
  embryo2Of2 = second.embryoIds[0];
});

test("signed out, every Embryo route sends the visitor to sign in and renders nothing", async ({ page }) => {
  for (const path of ["/embryos", "/embryos/compare", "/embryos/request-data", `/embryos/${UNKNOWN_UUID}`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(page.getByText(STANDING_STATEMENT)).toHaveCount(0);
  }
});

test("/embryos with no cohort: the four-part empty state, one primary action, the tiles and the budget", async ({ page }) => {
  await signIn(page, C.email, C.password);
  await page.goto("/embryos");
  await expect(page.getByRole("heading", { level: 1, name: "Embryos" })).toBeVisible();
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);

  const empty = page.locator('[data-slot="empty-state"]');
  await expect(empty.locator('[data-slot="empty-state-heading"]')).toHaveText(EMPTY_HEADING);
  await expect(empty.getByText(EMPTY_WHAT_APPEARS, { exact: true })).toBeVisible();
  await expect(empty.getByText(EMPTY_HOW_TO_MAKE_IT_APPEAR, { exact: true })).toBeVisible();
  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText(REQUEST_DATA_BUTTON);
  await expect(page.getByRole("link", { name: REQUEST_DATA_BUTTON })).toHaveAttribute("href", "/embryos/request-data");

  // Every tile either links or states its blocking sentence; never a dead link.
  await expect(page.locator('[data-tile="upload"] a')).toHaveAttribute("href", "/embryos/upload");
  await expect(page.locator('[data-tile="compare"] [data-slot="tile-blocked"]')).toHaveText(COMPARE_BLOCKED);
  await expect(page.locator('[data-tile="copilot"] [data-slot="tile-blocked"]')).toHaveText(COPILOT_BLOCKED);
  await expect(page.locator('[data-tile="copilot"] a')).toHaveCount(0);
  await expect(page.locator('[data-slot="availability-line"] a')).toHaveAttribute("href", "/legal/where-inherit-works");

  // The standing statement, verbatim and never collapsible; the not-diagnostic line; no result.
  const statement = page.locator('[data-slot="standing-statement"]');
  await expect(statement).toHaveText(STANDING_STATEMENT);
  await expect(page.locator("details", { hasText: STANDING_STATEMENT })).toHaveCount(0);
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="cohort-card"]')).toHaveCount(0);
  await expectNoResults(page);
  await expectNoSexOrRank(page);
  await expectEveryLinkAnswers(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const interactives = await firstViewportInteractives(page);
    expect(interactives.length, `${viewport.name}: ${interactives.join(" | ")}`).toBeLessThanOrEqual(12);
    await expect(statement).toBeAttached();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectAxeClean(page);
});

test("/embryos/compare with no cohort: the zero-cohort blocking state, and unknown cohorts answer 404", async ({ page }) => {
  await signIn(page, C.email, C.password);
  await page.goto("/embryos/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Compare embryos" })).toBeVisible();
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText("Embryos / Compare embryos");
  const blocking = page.locator('[data-slot="blocking-state"][data-state="empty"]');
  await expect(blocking).toContainText(NO_COHORT_SENTENCE);
  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText(REQUEST_DATA_BUTTON);
  await expect(page.locator('[data-trade-off-panel]')).toHaveCount(0);
  await expectNoResults(page);
  await expectNoSexOrRank(page);
  expect((await page.request.get("/embryos/compare?cohort=not-a-uuid")).status()).toBe(404);
  expect((await page.request.get(`/embryos/compare?cohort=${UNKNOWN_UUID}`)).status()).toBe(404);
  expect((await page.request.get(`/embryos/compare?cohort=${UNKNOWN_UUID.toUpperCase()}`)).status()).toBe(404);
  await expectAxeClean(page);
});

test("/embryos/request-data: the letter verbatim, one primary action that copies it, the formats and the way back", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, C.email, C.password);
  await page.goto("/embryos/request-data");
  await expect(page.getByRole("heading", { level: 1, name: REQUEST_DATA_H1 })).toBeVisible();
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(`Embryos / ${REQUEST_DATA_H1}`);
  await expect(page.getByRole("heading", { level: 2, name: "The email to send" })).toBeVisible();
  await expect(page.locator('blockquote[data-slot="request-letter"]')).toHaveText(LETTER);
  await expect(page.locator('[data-slot="formats"]')).toHaveText(FORMATS_SENTENCE);
  await expect(page.locator('[data-slot="next-step"]')).toHaveText(NEXT_STEP_SENTENCE);
  await expect(page.getByRole("link", { name: "Back to Embryos" })).toHaveAttribute("href", "/embryos");

  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await page.getByRole("button", { name: COPY_EMAIL_BUTTON }).click();
  await expect(page.locator('[data-slot="copy-status"]')).toHaveText(COPIED_STATUS);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LETTER);

  const body = await (await page.request.get("/embryos/request-data")).body();
  expect(body.length).toBeLessThanOrEqual(150 * 1024);
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(7);
  await expectNoResults(page);
  await expectAxeClean(page);
});

test("/embryos/{id} for an unknown, malformed or foreign embryo answers 404 with no existence signal", async ({ page }) => {
  await signIn(page, C.email, C.password);
  for (const segment of [UNKNOWN_UUID, "me", `s-${UNKNOWN_UUID}`, embryo1]) {
    const response = await page.request.get(`/embryos/${segment}`);
    expect(response.status(), segment).toBe(404);
    expect(await response.text()).not.toContain("Embryo 1");
  }
});

test("/embryos for the uploader: the seeded cohort's chips, status words, analysis line, links and the second cohort's jurisdiction line", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/embryos");
  await expect(page.getByRole("heading", { level: 2, name: "Your embryos" })).toBeVisible();
  await expect(page.locator('[data-slot="empty-state"]')).toHaveCount(0);
  const cards = page.locator('[data-slot="cohort-card"]');
  await expect(cards).toHaveCount(2);
  // Newest first: the register's absent-query order.
  await expect(cards.nth(0)).toHaveAttribute("data-cohort-id", cohort1);
  await expect(cards.nth(1)).toHaveAttribute("data-cohort-id", cohort2);

  const first = cards.nth(0);
  await expect(first.locator('[data-slot="cohort-label"]')).toHaveText(/^Embryos added on \d+ \w+ \d{4}$/);
  await expect(first.locator('[data-slot="embryo-label"]')).toHaveText(["Embryo 1", "Embryo 2", "Embryo 3"]);
  await expect(first.locator('[data-slot="embryo-state"]')).toHaveText([
    EMBRYO_STATUS.qc_pass,
    EMBRYO_STATUS.qc_marginal,
    EMBRYO_STATUS.qc_fail,
  ]);
  await expect(first.locator('[data-slot="subject-kind"]')).toHaveText(["Embryo", "Embryo", "Embryo"]);
  await expect(first.locator('[data-slot="embryo-disc"]')).toHaveText(["E", "E", "E"]);
  await expect(first.locator('[data-slot="analysis-state"]')).toHaveText(waitingForResultsStatus(ROLE_YOU));
  await expect(first.locator('[data-slot="compare-link"]')).toHaveAttribute("href", `/embryos/compare?cohort=${cohort1}`);
  await expect(first.locator(`a[href="/embryos/${embryo1}"]`)).toHaveCount(1);
  await expect(first.locator('[data-slot="retention-line"]')).toHaveText(RETENTION_SENTENCE);
  await expect(first.locator('[data-slot="cohort-jurisdiction"]')).toHaveCount(0);
  // Every embryo's disc is identical and carries no subject colour.
  const discClasses = await first.locator('[data-slot="embryo-disc"]').evaluateAll((nodes) => nodes.map((node) => node.className));
  expect(new Set(discClasses).size).toBe(1);
  expect(discClasses[0]).not.toMatch(/bg-subject-/);

  const second = cards.nth(1);
  await expect(second.locator('[data-slot="cohort-jurisdiction"]')).toHaveText(UNREVIEWED_COPY);
  await expect(second.locator('[data-slot="embryo-label"]')).toHaveText(["Embryo 1"]);

  // The compare tile opens the newest cohort the viewer may read.
  await expect(page.locator('[data-tile="compare"] a')).toHaveAttribute("href", `/embryos/compare?cohort=${cohort1}`);
  await expect(page.locator('[data-tile="copilot"] [data-slot="tile-blocked"]')).toHaveText(COPILOT_BLOCKED);
  await expectNoResults(page);
  await expectNoSexOrRank(page);
  await expectEveryLinkAnswers(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const interactives = await firstViewportInteractives(page);
    expect(interactives.length, `${viewport.name}: ${interactives.join(" | ")}`).toBeLessThanOrEqual(12);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectAxeClean(page);
});

test("/embryos/compare for the uploader: consent-required withholds every result; the second cohort renders the jurisdiction copy", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto(`/embryos/compare?cohort=${cohort1}`);
  await expect(page.getByRole("heading", { level: 1, name: "Compare embryos" })).toBeVisible();
  const blocking = page.locator('[data-slot="blocking-state"][data-state="consent-required"]');
  await expect(blocking).toHaveText(waitingForResultsBody(ROLE_YOU));
  await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
  await expect(page.locator('[data-trade-off-panel]')).toHaveCount(0);
  await expectNoResults(page);
  await expectNoSexOrRank(page);
  // The absent query resolves to the same newest readable cohort.
  await page.goto("/embryos/compare");
  await expect(page.locator('[data-slot="blocking-state"][data-state="consent-required"]')).toHaveCount(1);

  await page.goto(`/embryos/compare?cohort=${cohort2}`);
  const unavailable = page.locator('[data-slot="jurisdiction-unavailable"]');
  await expect(unavailable).toContainText(UNREVIEWED_COPY);
  await expect(unavailable.getByRole("link", { name: "Read the Future Person Charter" })).toHaveAttribute("href", "/legal/future-person");
  await expect(page.locator('[data-slot="blocking-state"]')).toHaveCount(0);
  await expectNoResults(page);
  // The acknowledgement is never written to device storage.
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
  }));
  expect(stored.local).not.toMatch(/tier2|embryo/i);
  expect(stored.session).not.toMatch(/tier2|embryo/i);
  await expectAxeClean(page);
});

test("/embryos/{id} for the uploader: breadcrumbs, the neutral bar, the ordinal h1 and the consent-required state", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto(`/embryos/${embryo1}`);
  // The root layout's template applies: `%s · Inherit`.
  await expect(page).toHaveTitle("Embryo 1 · Embryos · Inherit");
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText("Embryos / Embryo 1");
  const bar = page.locator('[data-subject-bar="true"]');
  await expect(bar.locator('[data-slot="subject-kind"]')).toHaveText("Embryo");
  await expect(bar.locator('[data-slot="subject-files"]')).toHaveCount(0);
  await expect(bar.locator('[data-slot="subject-disc"]')).toHaveText("E");
  expect(await bar.locator('[data-slot="subject-disc"]').getAttribute("class")).not.toMatch(/bg-subject-/);
  await expect(bar.getByRole("link", { name: "Add a file" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Embryo 1" })).toBeVisible();
  await expect(page.locator('[data-slot="blocking-state"][data-state="consent-required"]')).toHaveText(waitingForResultsBody(ROLE_YOU));
  await expect(page.getByRole("heading", { name: "What you might do" })).toHaveCount(0);
  expect(await page.locator("main").innerHTML()).not.toContain("a result about you");
  await expectNoResults(page);
  await expectNoSexOrRank(page);

  await page.goto(`/embryos/${embryo2Of2}`);
  await expect(page.locator('[data-slot="jurisdiction-unavailable"]')).toContainText(UNREVIEWED_COPY);
  await expectNoResults(page);
  await expectAxeClean(page);
});

test("the co-parent sees the shared cohort through the participant set, and only that one", async ({ page }) => {
  await signIn(page, B.email, B.password);
  await page.goto("/embryos");
  const cards = page.locator('[data-slot="cohort-card"]');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-cohort-id", cohort1);
  await expect(cards.first().locator('[data-slot="embryo-label"]')).toHaveText(["Embryo 1", "Embryo 2", "Embryo 3"]);
  await expect(cards.first().locator('[data-slot="analysis-state"]')).toHaveText(waitingForResultsStatus(ROLE_YOU));
  expect((await page.request.get(`/embryos/${embryo2Of2}`)).status()).toBe(404);
  await page.goto(`/embryos/${embryo1}`);
  await expect(page.getByRole("heading", { level: 1, name: "Embryo 1" })).toBeVisible();
  await expect(page.locator('[data-slot="blocking-state"][data-state="consent-required"]')).toHaveCount(1);
  await expectNoResults(page);
});
