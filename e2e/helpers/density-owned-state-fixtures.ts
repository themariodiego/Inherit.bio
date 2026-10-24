import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page, type Route } from "@playwright/test";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "../helpers";
import { uploadOwnFilePrepared } from "../own-report-helpers";
import { accountCsrf } from "./session-csrf";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { ownedDensityRecipe, type OwnedDensityRecipe } from "../../scripts/density-owned-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { OWN_UPLOAD_COPY } from "../../src/copy/upload/consent";
import { NOTHING_READ, ANCESTRY_OFF } from "../../src/copy/ancestry";
import { BROWSER_NO_FILE, BROWSER_PREPARING, SCORE_COVERAGE_NO_FILE, SCORE_COVERAGE_PREPARING } from "../../src/copy/genome/data";
import { ANCESTRY_PREPARING, HUB_PREPARING, REPORT_PREPARING, REPORTS_PREPARING } from "../../src/copy/genome/preparation";
import { NO_FILE_YET, LIST_NO_FILE } from "../../src/copy/reports/strings";
import { PREPARED_REPORTS, START_HERE, STATE_A_LEDE, STATE_B } from "../../src/copy/overview";

const CLOUD_ENDPOINT = "https://203.0.114.10:8123/v1";
const CLOUD_PROVIDER = "203.0.114.10:8123";
const REPORT_PATH = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const realPath: Readonly<Record<string, string>> = {
  "genome.subject": "/genome/me", "genome.reports": "/genome/me/reports",
  "genome.report": REPORT_PATH, "genome.ancestry": "/genome/me/ancestry",
  "genome.data": "/genome/me/data", "genome.browser": "/genome/me/data/browser",
};
interface NativeRows { [table: string]: Record<string, unknown>[] }

/** Complete rows of this one fresh synthetic actor. Exact counts reject a
 * truncated PostgREST read; keys, bearers and row values are never written by
 * this provider. The existing owned observer hashes these actual facts. */
async function accountSnapshot(accountId: string): Promise<NativeRows> {
  assert(/^[a-f0-9-]{36}$/.test(accountId), "Actual native account required");
  const admin = adminClient();
  const rows: NativeRows = {};
  for (const [table, column] of [
    ["profiles", "id"], ["subjects", "subject_account_id"], ["genome_files", "user_id"],
    ["subject_consents", "account_id"], ["consent_signatures", "signer_account_id"],
    ["consent_grants", "user_id"], ["llm_settings", "user_id"],
    ["account_operation_nonces", "account_id"], ["account_deletion_requests", "account_id"],
  ]) {
    const result = await admin.from(table).select("*", { count: "exact" }).eq(column, accountId);
    expect(result.error, `complete native ${table} snapshot`).toBeNull();
    expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count);
    rows[table] = [...result.data!].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  expect(rows.profiles).toHaveLength(1);
  const subjects = rows.subjects.map(row => row.id as string);
  const grants = subjects.length ? await admin.from("purpose_grants").select("*", { count: "exact" })
    .eq("target_kind", "subject").in("target_id", subjects) : null;
  if (grants) {
    expect(grants.error).toBeNull(); expect(grants.count).not.toBeNull();
    expect(grants.data!.length).toBe(grants.count);
  }
  rows.purpose_grants = [...(grants?.data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // These are the complete inputs to the Family graph for this fresh actor,
  // including historical rows. An empty card alone cannot prove no sharing.
  for (const [table, query] of [
    ["subject_principals", admin.from("subject_principals").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["family_subjects", admin.from("subjects").select("*", { count: "exact" })
      .or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)],
    ["directional_grants_received", admin.from("directional_grants").select("*", { count: "exact" })
      .eq("recipient_account_id", accountId)],
    ["family_sharing_pauses", admin.from("family_sharing_pauses").select("*", { count: "exact" })
      .or(`account_low_id.eq.${accountId},account_high_id.eq.${accountId}`)],
  ] as const) {
    const result = await query;
    expect(result.error, `complete native ${table} snapshot`).toBeNull();
    expect(result.count).not.toBeNull(); expect(result.data!.length).toBe(result.count);
    rows[table] = [...result.data!].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const principals = rows.subject_principals.map(row => row.id as string);
  for (const [table, query] of [
    ["family_invitations", principals.length ? admin.from("subject_invitations").select("*", { count: "exact" })
      .in("inviter_principal_id", principals) : null],
    ["family_grants_given", principals.length ? admin.from("purpose_grants").select("*", { count: "exact" })
      .in("data_subject_principal_id", principals) : null],
  ] as const) {
    const result = query ? await query : null;
    if (result) {
      expect(result.error, `complete native ${table} snapshot`).toBeNull();
      expect(result.count).not.toBeNull(); expect(result.data!.length).toBe(result.count);
    }
    rows[table] = [...(result?.data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return rows;
}

/** Holds only the original request. No response replacement, status write,
 * retry, fixture row insertion or invented completion can enter the capture. */
async function holdOriginal(page: Page, pattern: string, method: string) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let intercepted = 0;
  let continuation: Promise<void> | undefined;
  await page.route(pattern, async (route: Route) => {
    if (route.request().method() !== method) { await route.continue(); return; }
    assert(++intercepted === 1, "One original density request required");
    continuation = (async () => {
      await held;
      try {
        await route.continue();
        const response = await route.request().response();
        assert(response && await response.finished() === null, "Original response settlement required");
      } catch { throw new Error("Original density request did not settle"); }
    })();
    void continuation.catch(() => {});
    await continuation;
  });
  return { assertHeld: async () => { await expect.poll(() => intercepted).toBe(1); },
    settle: async () => { release(); if (continuation) await continuation; } };
}

async function saveCloudProvider(page: Page) {
  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(CLOUD_ENDPOINT);
  await page.getByLabel("Model", { exact: true }).fill("synthetic-model");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/llm/settings"
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true })).toBeVisible();
}

/** The provider-key consent the Consents page lists, through its one door
 * (grant_cloud_model_consent). The compatibility Copilot panel's dialog sent it
 * until 24 October 2026; that panel is retired (G8.5) and no screen sends it,
 * so this sends the dialog's own request with the route's one-time token. */
async function grantCloudConsent(page: Page) {
  await saveCloudProvider(page);
  const signed = await page.request.post("/api/consents", {
    headers: { origin: new URL(page.url()).origin, "content-type": "application/json", "x-inherit-csrf": await accountCsrf(page, "api.consents") },
    data: { providerKey: CLOUD_PROVIDER },
  });
  expect(signed.status()).toBe(200); // No model step is requested.
  expect(Object.keys(await signed.json())).toEqual(["grantId"]);
}

async function assertEmpty(page: Page, row: DensityStateCase) {
  if (row.route.id === "app.overview") {
    await expect(page.getByText(STATE_A_LEDE, { exact: true })).toBeVisible();
    await expect(page.getByText(START_HERE.heading, { exact: true })).toBeVisible();
    await expect(page.locator("[data-metric-value], [data-figure-kind]")).toHaveCount(0);
  } else if (row.route.id === "genome.reports") {
    await expect(page.getByText(LIST_NO_FILE, { exact: true })).toBeVisible();
    await expect(page.getByText(REPORTS_PREPARING, { exact: true })).toHaveCount(0);
  } else if (row.route.id === "genome.report") {
    await expect(page.getByText(NO_FILE_YET, { exact: true })).toBeVisible();
    await expect(page.getByText(REPORT_PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Choose this result type in", { exact: false })).toHaveCount(0);
  } else if (row.route.id === "genome.ancestry") {
    await expect(page.getByText(NOTHING_READ, { exact: true })).toHaveCount(3);
    await expect(page.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "grey");
    await expect(page.getByText(ANCESTRY_OFF, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ANCESTRY_PREPARING, { exact: true })).toHaveCount(0);
  } else if (row.route.id === "genome.data") {
    await expect(page.getByText(SCORE_COVERAGE_NO_FILE, { exact: true })).toBeVisible();
    await expect(page.getByText(SCORE_COVERAGE_PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="subject-files"]')).toHaveText("0 files");
  } else if (row.route.id === "genome.browser") {
    await expect(page.getByText(BROWSER_NO_FILE, { exact: true })).toBeVisible();
    await expect(page.getByText(BROWSER_PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
  } else if (row.route.id === "files.index") {
    await expect(page.locator("main")).toContainText("No files yet. Upload a raw data export");
    await expect(page.locator('main [data-file-id]')).toHaveCount(0);
  } else throw new Error("No reviewed empty-state assertion");
}

async function assertPreparing(page: Page, row: DensityStateCase, native: NativeRows) {
  expect(native.genome_files).toHaveLength(1);
  expect(native.genome_files[0].status).toBe("uploaded");
  expect(native.genome_files[0].normalization_completed_at).toBeNull();
  if (row.route.id === "app.overview") {
    const panel = page.locator('section[aria-labelledby="processing-title"]');
    await expect(panel.locator("#processing-title")).toHaveText("Processing Genome file");
    await expect(panel.locator("ol li")).toHaveText([...STATE_B.steps]);
    await expect(panel.locator('ol li[aria-current="step"]')).toHaveCount(1);
    await expect(panel.locator("ol li").first()).toHaveAttribute("aria-current", "step");
    const stats = await adminClient().rpc("processing_time_stats");
    expect(stats.error).toBeNull();
    const timing = (stats.data ?? []).find((entry: { file_tier: number }) => entry.file_tier === native.genome_files[0].tier);
    const measured = timing && timing.n >= 20 && timing.p50_seconds != null && timing.p95_seconds != null;
    if (measured) await expect(panel.locator("p").last())
      .toHaveText(/^Most files like this finish in about .+\. Nine in ten finish within .+\.$/);
    else await expect(panel.locator("p").last()).toHaveText(STATE_B.notEnough);
    await expect(page.getByText(START_HERE.heading, { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-metric-value]")).toHaveCount(0);
  } else {
    const copy: Record<string, string> = { "genome.subject": HUB_PREPARING, "genome.reports": REPORTS_PREPARING,
      "genome.report": REPORT_PREPARING, "genome.ancestry": ANCESTRY_PREPARING,
      "genome.data": SCORE_COVERAGE_PREPARING, "genome.browser": BROWSER_PREPARING };
    assert(copy[row.route.id], "Reviewed preparation sentence required");
    await expect(page.getByText(copy[row.route.id], { exact: true })).toBeVisible();
    if (row.route.id === "genome.data") await expect(page.getByText(SCORE_COVERAGE_NO_FILE, { exact: true })).toHaveCount(0);
    if (row.route.id === "genome.browser") {
      await expect(page.getByText(BROWSER_NO_FILE, { exact: true })).toHaveCount(0);
      await expect(page.locator("main").getByRole("searchbox")).toHaveCount(0);
    }
    if (row.route.id === "genome.report") await expect(page.getByText("Choose this result type in", { exact: false })).toHaveCount(0);
  }
}

/** First owned-state slice. Each state/viewport gets its own genuinely fresh
 * account, real session and original flow. No shared populated fixture is
 * relabelled as empty, nor a prepared-zero-coverage file as missing. */
export function realAccountAndOwnDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: NativeRows; sessionId?: string }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-owned-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = ownedDensityRecipe(row);
    if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin,
          viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const holder = await context.newPage();
        const email = `density-owned-${randomUUID()}@e2e.local`, password = "synthetic-density-owned-password";
        let held: Awaited<ReturnType<typeof holdOriginal>> | undefined;
        let capturedPage = holder;
        try {
          const accountId = await createConfirmedUser(email, password);
          await signIn(holder, email, password);
          let native = await accountSnapshot(accountId);
          expect(native.genome_files).toEqual([]);
          expect(native.consent_grants).toEqual([]);
          expect(native.account_deletion_requests).toEqual([]);
          if (recipe === "preparing") {
            held = await holdOriginal(holder, "**/api/files/*/process", "POST");
            const fileId = await uploadOwnFileThroughUi(holder, path.join(input.root, "e2e/fixtures/tiny-grch38.vcf"));
            await held.assertHeld();
            native = await accountSnapshot(accountId);
            expect(native.genome_files).toHaveLength(1); expect(native.genome_files[0].id).toBe(fileId);
            capturedPage = await context.newPage(); // Original upload keeps its request open.
          } else if (recipe === "awaiting-choice" || recipe === "model-ready") {
            await uploadOwnFilePrepared(holder, path.join(input.root, "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf" });
            if (recipe === "model-ready") await saveCloudProvider(holder);
          } else if (recipe === "upload-ready") await completeOwnUploadConsent(holder);
          else if (recipe === "consents-ready" || recipe === "consents-pending") await grantCloudConsent(holder);

          let peopleSession: (() => Promise<string>) | undefined;
          let originalPeopleSession: string | undefined;
          if (recipe === "people-not-built") {
            const { createServerClient } = await import("@supabase/ssr");
            const { ANON_KEY, SUPABASE_URL } = await import("../helpers");
            peopleSession = async () => {
              const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: {
                getAll: () => context.cookies(),
                setAll: () => { throw new Error("Actual People session cannot rotate during density proof"); },
              } });
              const verified = await auth.auth.getClaims();
              assert(!verified.error && verified.data, "Genuine current People session required");
              const claims = verified.data.claims;
              assert(claims.sub === accountId && typeof claims.session_id === "string"
                && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(claims.session_id)
                && typeof claims.exp === "number" && claims.exp * 1000 > Date.now(),
              "Exact live account/session claims required");
              const current = await auth.auth.getUser();
              assert(!current.error && current.data.user?.id === accountId, "Native authenticated People account required");
              return claims.session_id;
            };
            originalPeopleSession = await peopleSession();
          }
          const at = realPath[row.route.id] ?? row.route.path;
          const response = await capturedPage.goto(at, { waitUntil: "domcontentloaded" });
          expect(response?.status()).toBe(200);
          if (["digest-pending", "model-pending", "delete-pending", "consents-pending", "invite-pending"].includes(recipe)) {
            const pending = recipe as OwnedDensityRecipe;
            const pattern = pending === "digest-pending" ? "**/rest/v1/profiles*"
              : pending === "model-pending" ? "**/api/llm/settings"
              : pending === "delete-pending" ? "**/api/account/delete"
              : pending === "consents-pending" ? "**/api/consents/*/revoke" : "**/api/subject-drafts";
            held = await holdOriginal(capturedPage, pattern, pending === "digest-pending" ? "PATCH" : "POST");
            if (pending === "digest-pending") await capturedPage.getByRole("switch").click();
            else if (pending === "model-pending") await capturedPage.getByRole("button", { name: "Save provider", exact: true }).click();
            else if (pending === "delete-pending") {
              await capturedPage.getByLabel(/Type/).fill("delete my genome");
              await capturedPage.getByTestId("delete-account").click();
            } else if (pending === "consents-pending") await capturedPage.getByRole("button", { name: "Revoke", exact: true }).click();
            else {
              await capturedPage.getByLabel("Their email address").fill(`density-invite-${randomUUID()}@e2e.local`);
              await capturedPage.getByRole("checkbox").check();
              await capturedPage.getByRole("button", { name: "Send invitation", exact: true }).click();
            }
            await held.assertHeld();
          }
          const observe = async () => {
            if (peopleSession) {
              assert(createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex") === sourceSha256,
                "Reviewed actual People provider source changed");
              assert(await peopleSession() === originalPeopleSession, "Original People session changed");
            }
            const facts = await accountSnapshot(accountId);
            await assertOwnedState(capturedPage, row, recipe, facts, email);
            if (held) await held.assertHeld();
            if (recipe === "people-not-built") expect(facts, "Opening People does not make any account, consent, file, sharing or operation record").toEqual(native);
            return input.observeState(row, capturedPage, sourceSha256, { accountId, nativeSnapshot: facts,
              ...(peopleSession ? { sessionId: await peopleSession() } : {}) });
          };
          await observe();
          await capture({ page: capturedPage, observe });
          if (recipe === "people-not-built") await observe();
        } finally {
          try { if (held) await held.settle(); } finally { await context.close(); }
        }
      } } satisfies DensityStateFixture];
  });
}

async function assertOwnedState(page: Page, row: DensityStateCase, recipe: OwnedDensityRecipe, native: NativeRows, email: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (recipe === "empty") { expect(native.genome_files).toEqual([]); await assertEmpty(page, row); }
  else if (recipe === "preparing") await assertPreparing(page, row, native);
  else if (recipe === "awaiting-choice") {
    expect(native.genome_files).toHaveLength(1);
    expect(native.genome_files[0].status).toBe("stored");
    expect(native.genome_files[0].normalization_completed_at).not.toBeNull();
    expect(native.purpose_grants).toEqual([]);
    await expect(page.getByRole("heading", { name: PREPARED_REPORTS.title, exact: true })).toBeVisible();
    await expect(page.getByText(START_HERE.heading, { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-metric-value]")).toHaveCount(0);
  } else if (recipe === "upload-consent") {
    expect(native.genome_files).toEqual([]); expect(native.profiles[0].date_of_birth).toBeNull();
    expect(native.consent_signatures).toEqual([]); expect(native.subject_consents).toEqual([]);
    await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  } else if (recipe === "upload-ready") {
    expect(native.genome_files).toEqual([]);
    expect(native.profiles[0].date_of_birth).toBe("1990-01-01");
    expect(native.subject_consents.filter(grant => grant.consent_type === "upload_class" && grant.revoked_at === null)).toHaveLength(1);
    expect(native.purpose_grants).toEqual([]);
    await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
  } else if (recipe === "account") {
    await expect(page.locator("main").getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings sections" }).getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("switch")).toBeEnabled();
  } else if (recipe === "people-not-built") {
    expect(row.route.id).toBe("settings.people"); expect(row.route.path).toBe("/settings/people");
    expect(row.state).toBe("not-built"); expect(row.route.auth).toBe("authenticated");
    expect(native.genome_files).toEqual([]); expect(native.account_deletion_requests).toEqual([]);
    expect(native.account_operation_nonces).toEqual([]);
    await expect(page.locator("main h1")).toHaveText("People and relationships");
    const notice = page.locator('main [role="status"][data-slot="not-built"]');
    await expect(notice).toHaveCount(1); await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading", { level: 2, name: "Not built yet", exact: true })).toBeVisible();
    await expect(notice).toContainText("This page will list the people you share with and let you change each of those choices in one place.");
    await expect(notice).toContainText("Inherit has not written this page yet. No law and nothing about you is holding it back, and no record was made when you opened it.");
    await expect(page.getByText("Not available in this jurisdiction yet", { exact: true })).toHaveCount(0);
    await expect(notice.getByRole("link", { name: "Go back", exact: true })).toHaveAttribute("href", "/settings");
    await expect(page.locator("main form, main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
  } else if (recipe === "digest-pending") await expect(page.getByRole("switch")).toBeDisabled();
  else if (recipe === "data" || recipe === "delete-pending") {
    expect(native.account_deletion_requests).toEqual([]);
    expect(native.account_operation_nonces).toEqual([]);
    const button = page.getByTestId("delete-account");
    if (recipe === "delete-pending") { await expect(button).toHaveText("Scheduling…"); await expect(button).toBeDisabled(); }
    else {
      await expect(page.getByRole("link", { name: "Download export" })).toHaveAttribute("href", "/api/export");
      await expect(button).toBeVisible();
    }
  } else if (recipe === "model-pending") await expect(page.getByRole("button", { name: "Save provider", exact: true })).toBeDisabled();
  else if (recipe === "model-ready") {
    expect(native.genome_files).toHaveLength(1); expect(native.llm_settings).toHaveLength(1);
    expect(native.llm_settings[0].model).toBe("synthetic-model");
    const permission = page.locator('section[aria-labelledby="copilot-permission-title"]');
    await expect(permission).not.toContainText("Save an available model and complete your own-file permission");
    await expect(permission).toContainText(CLOUD_PROVIDER);
    await expect(permission).toContainText("Your original DNA file is not sent. Report types still need their separate permission.");
    await expect(permission.locator("details")).toHaveCount(2);
    await expect(permission.getByRole("button", { name: "Allow Copilot for this model", exact: true })).toBeDisabled();
  } else if (recipe === "consents-empty") {
    expect(native.consent_grants).toEqual([]);
    await expect(page.getByText("No cloud-LLM consent grants. None are needed for local models.")).toBeVisible();
    await expect(page.getByRole("button", { name: /revoke/i })).toHaveCount(0);
  } else if (recipe === "consents-ready" || recipe === "consents-pending") {
    expect(native.consent_grants).toHaveLength(1);
    expect(native.consent_grants[0].provider_key).toBe(CLOUD_PROVIDER);
    expect(native.consent_grants[0].revoked_at).toBeNull();
    expect(native.consent_grants[0].data_classes).toHaveLength(5);
    const grant = page.getByRole("listitem"); await expect(grant).toHaveCount(1);
    await expect(grant).toContainText(CLOUD_PROVIDER); await expect(grant).toContainText("5 data classes");
    await expect(grant).not.toContainText("revoked");
    const button = grant.getByRole("button", { name: recipe === "consents-pending" ? "Working…" : "Revoke", exact: true });
    await expect(button).toBeVisible();
    if (recipe === "consents-pending") await expect(button).toBeDisabled();
  } else if (recipe === "family-empty") {
    expect(native.genome_files).toEqual([]);
    expect(native.family_subjects.filter(subject => subject.subject_class !== "self")).toEqual([]);
    for (const table of ["family_invitations", "family_grants_given", "directional_grants_received", "family_sharing_pauses"])
      expect(native[table], `no actual Family ${table}`).toEqual([]);
    await expect(page.getByText("Just you so far.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add another adult", exact: true })).toHaveAttribute("href", "/family/invite");
    await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  } else if (recipe === "invite" || recipe === "invite-pending") {
    const form = page.locator("form").filter({ has: page.getByLabel("Their email address") });
    await expect(page.locator('[data-slot="pre-consent-statement"]')).toHaveText(
      "Comparing two people’s DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this.");
    await expect(page.getByText("They can’t use Inherit themselves")).toHaveCount(0);
    const button = form.getByRole("button", { name: recipe === "invite-pending" ? "Requesting…" : "Send invitation", exact: true });
    await expect(button).toBeVisible();
    if (recipe === "invite-pending") { await expect(button).toBeDisabled(); await expect(form.getByRole("alert")).toHaveCount(0); }
  } else throw new Error("Unreviewed owned density state");
}
