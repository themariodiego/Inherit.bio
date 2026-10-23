import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "../helpers";
import { settingsOperationNonce } from "./operation-nonce";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { assertFreshJurisdictionRows, DENSITY_TEST_DENY_SENTENCE, jurisdictionDensityRecipe,
  type FreshJurisdictionRows, type JurisdictionDensityRecipe } from "../../scripts/density-jurisdiction-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { EACH_TURNS_IT_ON, needsTwoPeople } from "../../src/copy/family/health-picture";
import { HUB_TILES as FAMILY_TILES, NOBODY_YET } from "../../src/copy/family/index";
import { HUB_TILES as COHORT_TILES } from "../../src/copy/embryos/index";

const UNKNOWN_EMBRYO = "0e000000-0000-4000-8000-0000000000ff";
async function freshSnapshot(accountId: string, denied: boolean): Promise<FreshJurisdictionRows> {
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(accountId), "Actual actor required");
  const admin = adminClient(), facts: Record<string, Record<string, unknown>[]> = {};
  const save = async (name: string, query: PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown; count: number | null }> | null) => {
    const result = query ? await query : null;
    if (result) {
      expect(result.error, `complete jurisdiction ${name}`).toBeNull(); expect(result.count).not.toBeNull();
      expect(result.data!.length).toBe(result.count);
    }
    facts[name] = [...(result?.data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).eq("id", accountId)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" }).or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)],
    ["subject_principals", admin.from("subject_principals").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["genome_files", admin.from("genome_files").select("*", { count: "exact" }).eq("user_id", accountId)],
    ["subject_consents", admin.from("subject_consents").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["consent_signatures", admin.from("consent_signatures").select("*", { count: "exact" }).eq("signer_account_id", accountId)],
    ["consent_grants", admin.from("consent_grants").select("*", { count: "exact" }).eq("user_id", accountId)],
    ["directional_grants_received", admin.from("directional_grants").select("*", { count: "exact" }).eq("recipient_account_id", accountId)],
    ["family_sharing_pauses", admin.from("family_sharing_pauses").select("*", { count: "exact" }).or(`account_low_id.eq.${accountId},account_high_id.eq.${accountId}`)],
    ["cohorts", admin.from("embryo_cohorts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["drafts", admin.from("embryo_cohort_drafts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["account_operation_nonces", admin.from("account_operation_nonces").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["published_attestations", admin.from("consent_artifacts").select("*", { count: "exact" })
      .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null)],
  ] as const) await save(name, query);
  const subjects = facts.subjects.map(row => row.id as string), principals = facts.subject_principals.map(row => row.id as string);
  assert([...subjects, ...principals].every(id => typeof id === "string"
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)), "Exact native subject/principal identifiers required before scoped reads");
  await save("family_pairs", subjects.length ? admin.from("family_pairs").select("*", { count: "exact" })
    .or(`subject_a_id.in.(${subjects.join(",")}),subject_b_id.in.(${subjects.join(",")})`) : null);
  await save("purpose_grants", principals.length ? admin.from("purpose_grants").select("*", { count: "exact" })
    .or(`data_subject_principal_id.in.(${principals.join(",")}),signer_principal_id.in.(${principals.join(",")})`) : null);
  await save("invitations", principals.length ? admin.from("subject_invitations").select("*", { count: "exact" }).in("inviter_principal_id", principals) : null);
  await save("participant_sets", principals.length ? admin.from("embryo_participant_sets").select("*", { count: "exact" }).in("principal_id", principals) : null);
  assertFreshJurisdictionRows(facts, accountId, denied); return facts;
}

/** The original declaration route, exact current attestation and same signed-in
 * session create a denial. A missing TEST admission refuses; no env is changed. */
export function realJurisdictionDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: FreshJurisdictionRows }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-jurisdiction-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = jurisdictionDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), email = `density-jurisdiction-${randomUUID()}@e2e.local`, password = "synthetic-jurisdiction-password";
        try {
          const accountId = await createConfirmedUser(email, password); await signIn(page, email, password);
          const denied = recipe !== "health-empty", original = await freshSnapshot(accountId, false);
          if (denied) {
            const artifact = original.published_attestations[0];
            const response = await page.request.put("/api/settings/jurisdiction", {
              headers: { origin: origin.origin, "content-type": "application/json",
                "x-inherit-operation-nonce": await settingsOperationNonce(page.request, "jurisdiction") },
              data: { code: "XX", attestationVersion: artifact.version, attestationHash: artifact.body_sha256, affirmed: true },
            });
            expect(response.status(), "actual TEST jurisdiction admission is mandatory").toBe(200);
            expect(await response.json()).toEqual({ status: "updated", jurisdiction: "XX", capabilityReevaluation: "complete" });
            const declared = await freshSnapshot(accountId, true);
            for (const name of Object.keys(original).filter(name => name !== "profiles") as (keyof FreshJurisdictionRows)[])
              expect(declared[name], "declaration creates no source, consent, invitation or cohort").toEqual(original[name]);
          }
          const before = await freshSnapshot(accountId, denied), apiWrites: string[] = [];
          page.on("request", request => {
            const url = new URL(request.url());
            if (url.origin === origin.origin && url.pathname.startsWith("/api/") && request.method() !== "GET")
              apiWrites.push(`${request.method()} ${url.pathname}`);
          });
          const target = row.route.id === "embryos.detail" ? `/embryos/${UNKNOWN_EMBRYO}` : row.route.path;
          const response = await page.goto(target); expect(response?.status()).toBe(200);
          const observe = async () => {
            const nativeSnapshot = await freshSnapshot(accountId, denied);
            expect(nativeSnapshot, "refused or empty navigation preserves complete native facts").toEqual(before);
            expect(apiWrites, "refusal does not create analysis or consent").toEqual([]);
            await assertJurisdictionState(page, recipe);
            return input.observeState(row, page, sourceSha256, { accountId, nativeSnapshot });
          };
          await observe(); await capture({ page, observe });
        } finally { await context.close(); }
      } } satisfies DensityStateFixture];
  });
}

async function assertJurisdictionState(page: Page, recipe: JurisdictionDensityRecipe) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main [data-claim-block], main [data-figure-kind], main table, main [data-subject-id], main [data-cohort-id], main [data-embryo-id], main [data-slot=cohort-card]"))
    .toHaveCount(0);
  if (recipe === "health-empty") {
    const empty = page.locator('[data-slot="health-picture-blocking"][data-state="empty"]');
    await expect(empty).toHaveCount(1); await expect(empty).toContainText(needsTwoPeople(1));
    await expect(empty).toContainText(EACH_TURNS_IT_ON);
    await expect(page.locator('[data-slot="carrier-match-panel"], [data-slot="comparison-banner"]')).toHaveCount(0);
    await expect(page.getByText(DENSITY_TEST_DENY_SENTENCE, { exact: true })).toHaveCount(0);
  } else if (recipe === "family-hub-denied" || recipe === "cohort-hub-denied") {
    const family = recipe === "family-hub-denied", tiles = page.locator(`[data-slot="${family ? "family" : "embryo"}-tile"]`);
    await expect(tiles).toHaveCount((family ? FAMILY_TILES : COHORT_TILES).length);
    const blocked = page.locator('[data-slot="tile-blocked"]'); await expect(blocked).toHaveCount(3);
    for (const item of await blocked.all()) await expect(item).toHaveText(DENSITY_TEST_DENY_SENTENCE);
    await expect(tiles.locator("a")).toHaveCount(0);
    if (family) await expect(page.getByText(NOBODY_YET, { exact: true })).toBeVisible();
    else {
      await expect(page.locator('[data-slot="jurisdiction-line"]')).toContainText(DENSITY_TEST_DENY_SENTENCE);
      await expect(page.locator('[data-slot="availability-line"], [data-slot="empty-state-ground-wrap"]')).toHaveCount(0);
    }
  } else if (recipe === "invitation-denied") {
    const status = page.getByRole("status");
    await expect(status.getByRole("heading", { name: "Not available in this jurisdiction yet", exact: true })).toBeVisible();
    await expect(status).toContainText("We create no analysis or consent record.");
    await expect(status).toContainText("When the law is unclear, Inherit keeps the feature off.");
    await expect(page.getByLabel("Their email address")).toHaveCount(0);
    await expect(page.locator("main form")).toHaveCount(0);
  } else if (recipe === "health-denied") {
    await expect(page.getByRole("status").filter({ hasText: DENSITY_TEST_DENY_SENTENCE })).toHaveCount(1);
    await expect(page.locator('[data-slot="health-picture-blocking"]')).toHaveCount(0);
  } else {
    const unavailable = page.locator('[data-slot="jurisdiction-unavailable"]');
    await expect(unavailable).toHaveCount(1); await expect(unavailable).toContainText(DENSITY_TEST_DENY_SENTENCE);
    await expect(unavailable).toHaveAttribute("data-jurisdiction-source", "test-deny");
    await expect(page.locator('main input, main fieldset, main form, [data-slot="upload-flow"], [data-slot="request-letter"], [data-slot="blocking-state"], [data-compare-surface]')).toHaveCount(0);
  }
}
