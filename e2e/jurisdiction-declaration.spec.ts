import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminClient, anonClient, createConfirmedUser, signIn } from "./helpers";

/**
 * G5.1a in a browser, on the MAIN server (TEST-LOCAL flag on). ADR 0032.
 *
 * What this file proves, one test each:
 *   1. The first sign-in answers where the person lives before any product
 *      page: a required selection with nothing chosen, the published
 *      attestation, and then the page it asked for, including one the
 *      navigation prefetched while the gate still redirected it.
 *   2. A signed-in browser cannot write its own declaration around the writer
 *      (D-135): the database refuses the column, not only the form.
 *   3. Declared-prohibited: an account declared as the block-only TEST-DENY
 *      row (stored as XX) is refused restricted capabilities with that row's
 *      own words, while its own genome stays open.
 *   4. A declaration changed between page load and submit: the submit is
 *      decided by the answer that holds when it arrives, and creates nothing.
 *
 * Declared-unreviewed is proven on the flag-off server in
 * `e2e/jurisdiction-declaration.nojurisdiction.spec.ts`; the permitted actor
 * with a prohibited contributor (G5.1b) in `e2e/family-health-picture.spec.ts`,
 * which already holds two adults with real shared results.
 */

const runId = randomUUID();
const PASSWORD = "e2e-jurisdiction-declaration-pw";
const MAIN = "http://localhost:3100";

/** The block-only row's own sentence, retyped rather than imported from the register. */
const TEST_DENY_SENTENCE = "This capability is blocked for the TEST-DENY acceptance fixture.";
const REFUSAL_HEADING = "Not available in this jurisdiction yet";

async function attestation(): Promise<{ version: number; body_sha256: string }> {
  const { data, error } = await adminClient().from("consent_artifacts").select("version, body_sha256")
    .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null).single();
  expect(error).toBeNull();
  return data as { version: number; body_sha256: string };
}

/** Declares through the real route, from the signed-in page's own context, as the settings form does. */
async function declare(page: Page, code: string) {
  const { version, body_sha256 } = await attestation();
  return page.request.put("/api/settings/jurisdiction", {
    headers: { origin: MAIN, "content-type": "application/json" },
    data: { code, attestationVersion: version, attestationHash: body_sha256, affirmed: true },
  });
}

async function declaredCode(accountId: string): Promise<string | null> {
  const { data, error } = await adminClient().from("profiles").select("jurisdiction_code").eq("id", accountId).single();
  expect(error).toBeNull();
  return (data as { jurisdiction_code: string | null }).jurisdiction_code;
}

test("/settings: the first sign-in answers where the person lives, from a selection with nothing chosen, then continues to the page it asked for", async ({ page }) => {
  const email = `jurisdiction-first-${runId}@e2e.local`;
  const accountId = await createConfirmedUser(email, PASSWORD, { jurisdiction: null });
  const startedAt = new Date().toISOString();

  await page.goto("/auth/sign-in?next=%2Fgenome%2Fme%2Freports");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${MAIN}/settings?next=${encodeURIComponent("/genome/me/reports")}`);

  // Every product page sends the undeclared account back here. (`/family` is
  // public-or-authenticated and refuses an undeclared account in words
  // instead; ADR 0032.)
  for (const path of ["/overview", "/genome/me", "/family/invite"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${MAIN}/settings?next=${encodeURIComponent(path)}`);
  }
  // Rights stay reachable without an answer.
  await page.goto("/settings/data");
  await expect(page).toHaveURL(`${MAIN}/settings/data`);

  await page.goto(`/settings?next=${encodeURIComponent("/genome/me/reports")}`);
  const section = page.locator('[data-slot="jurisdiction"]');
  await expect(section.getByRole("heading", { name: "Where you live" })).toBeVisible();
  await expect(section.getByText("Answer this once before you use Inherit.", { exact: false })).toBeVisible();
  const country = section.getByLabel("Country you live in");
  await expect(country).toHaveValue("");
  await expect(country).toHaveAttribute("required", "");
  const offered = await country.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(offered[0], "the first option is the empty prompt").toBe("");
  // The 249-country catalogue less the three under a comprehensive US
  // embargo (`service-restrictions.ts`), plus the empty prompt. This build is
  // not the hosted deployment, so no paused country is withheld.
  expect(offered).toHaveLength(247);
  for (const value of ["XX", "TEST-LOCAL", "TEST-DENY", "ZZ", "CU", "IR", "KP"]) expect(offered).not.toContain(value);
  for (const value of ["FR", "DE", "GB"]) expect(offered).toContain(value);
  await expect(section.locator('[data-slot="jurisdiction-withheld"]')).toContainText("Some countries are not in this list.");
  await expect(section.getByText(/Inherit uses it to decide which Family and embryo features the law there allows/)).toBeVisible();

  // Without the affirmation the browser does not submit, and nothing is stored.
  await country.selectOption("FR");
  await section.getByRole("button", { name: "Save country" }).click();
  await expect(page).toHaveURL(/\/settings\?next=/);
  expect(await declaredCode(accountId)).toBeNull();

  await section.getByLabel("The country I chose is the country I live in.").check();
  await section.getByRole("button", { name: "Save country" }).click();
  await page.waitForURL(`${MAIN}/genome/me/reports`);

  const { data: profile } = await adminClient().from("profiles")
    .select("jurisdiction_code, jurisdiction_declared_at, jurisdiction_attestation_version, jurisdiction_attestation_sha256")
    .eq("id", accountId).single();
  const published = await attestation();
  expect(profile).toMatchObject({ jurisdiction_code: "FR", jurisdiction_attestation_version: published.version,
    jurisdiction_attestation_sha256: published.body_sha256 });
  expect(profile!.jurisdiction_declared_at).toBeTruthy();
  const { data: events } = await adminClient().from("legal_audit_log").select("coded_context, audit_principal_id")
    .eq("event_code", "jurisdiction.declared").gte("occurred_at", startedAt);
  expect((events ?? []).some(event => event.coded_context.code === "FR" && event.coded_context.first === true
    && event.audit_principal_id === null), "one pseudonymized ledger event records the first declaration").toBe(true);

  // Declared: product pages open, and settings shows the answer and what changing it ends.
  await page.goto("/overview");
  await expect(page).toHaveURL(`${MAIN}/overview`);
  await page.goto("/settings");
  await expect(page.locator('[data-slot="jurisdiction-current"]')).toHaveText("You told Inherit you live in France.");
  await expect(page.getByText(/Changing your country ends the Family and embryo permissions/)).toBeVisible();
  await expect(page.locator('[data-slot="jurisdiction"]').getByLabel("Country you live in")).toHaveValue("");
});

test("/settings: the first sign-in reaches a page the navigation prefetched before a country was saved", async ({ page }) => {
  const email = `jurisdiction-prefetched-${runId}@e2e.local`;
  await createConfirmedUser(email, PASSWORD, { jurisdiction: null });

  // While no country is recorded, the gate answers the sidebar's own prefetch
  // of Overview with the redirect back to this page. Saving must still leave.
  const prefetched = page.waitForRequest(request => new URL(request.url()).pathname === "/overview"
    && request.headers()["next-router-prefetch"] !== undefined);
  await page.goto("/auth/sign-in?next=%2Foverview");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${MAIN}/settings?next=${encodeURIComponent("/overview")}`);
  await page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Overview" }).hover();
  await prefetched;
  await page.waitForLoadState("networkidle");

  const section = page.locator('[data-slot="jurisdiction"]');
  await section.getByLabel("Country you live in").selectOption("DE");
  await section.getByLabel("The country I chose is the country I live in.").check();
  await section.getByRole("button", { name: "Save country" }).click();
  await page.waitForURL(`${MAIN}/overview`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
});

test("a signed-in browser cannot write its own jurisdiction around the declaration (D-135)", async () => {
  const email = `jurisdiction-direct-${runId}@e2e.local`;
  const accountId = await createConfirmedUser(email, PASSWORD);
  const client = anonClient();
  expect((await client.auth.signInWithPassword({ email, password: PASSWORD })).error).toBeNull();
  for (const patch of [{ jurisdiction_code: "XX" }, { jurisdiction_revision: 9 },
    { jurisdiction_code: null, jurisdiction_declared_at: null, jurisdiction_attestation_version: null, jurisdiction_attestation_sha256: null }]) {
    const { error } = await client.from("profiles").update(patch).eq("id", accountId);
    expect(error?.code, JSON.stringify(patch)).toBe("42501");
    expect(error?.message).toContain("jurisdiction_server_only");
  }
  expect(await declaredCode(accountId)).toBe("GB");
});

test("/family/health-picture jurisdiction-unavailable: an account declared as the block-only row is refused with that row's words, and its own genome stays open", async ({ page }) => {
  const email = `jurisdiction-deny-${runId}@e2e.local`;
  const accountId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);

  const answer = await declare(page, "XX");
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toEqual({ status: "updated", jurisdiction: "XX", capabilityReevaluation: "complete" });
  expect(await declaredCode(accountId)).toBe("XX");

  await page.goto("/family/health-picture");
  await expect(page.getByRole("status").filter({ hasText: TEST_DENY_SENTENCE })).toHaveCount(1);
  await expect(page.locator("[data-claim-block], [data-figure-kind], main table")).toHaveCount(0);

  await page.goto("/family/invite");
  await expect(page.getByRole("heading", { name: REFUSAL_HEADING })).toBeVisible();
  await expect(page.getByLabel("Their email address")).toHaveCount(0);

  const draft = await page.request.post("/api/subject-drafts", {
    headers: { origin: MAIN },
    data: { kind: "other_adult", adultFlow: "path-a-own-account", email: `someone-${runId}@e2e.local`,
      adultAttestation: true, requestId: randomUUID() },
  });
  expect(draft.status()).toBe(409);
  expect(await draft.json()).toEqual({ error: "jurisdiction_unavailable" });

  // Adult self-analysis is the one capability no jurisdiction restricts.
  await page.goto("/genome/me");
  await expect(page.getByRole("heading", { name: "My Genome", exact: true })).toBeVisible();
});

test("/family/invite: a declaration changed between page load and submit decides the submit, and nothing is created", async ({ page }) => {
  const email = `jurisdiction-race-${runId}@e2e.local`;
  const accountId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);

  // Loaded while permitted: the form is there.
  await page.goto("/family/invite");
  await expect(page.getByLabel("Their email address")).toBeVisible();

  // The answer changes elsewhere before this page submits.
  expect((await declare(page, "XX")).status()).toBe(200);

  await page.getByLabel("Their email address").fill(`invitee-${runId}@e2e.local`);
  await page.getByRole("checkbox").check();
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/subject-drafts"));
  await page.getByRole("button", { name: "Send invitation" }).click();
  expect((await submitted).status()).toBe(409);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Inherit cannot send invitations here yet.");
  const { count } = await adminClient().from("adult_subject_drafts").select("id", { count: "exact", head: true })
    .eq("owner_account_id", accountId);
  expect(count, "a refused submit creates no invitation").toBe(0);

  // Answered back, the same page offers the form again: the refusal was the
  // declaration and nothing else. (Not resubmitted, so no invitation mail is
  // queued for later specs to drain.)
  expect((await declare(page, "GB")).status()).toBe(200);
  await page.goto("/family/invite");
  await expect(page.getByLabel("Their email address")).toBeVisible();
});
