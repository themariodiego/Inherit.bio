import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "../helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { cohortEntryDensityRecipe, type CohortEntryDensityRecipe } from "../../scripts/density-cohort-entry-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { EMPTY_HEADING, EMPTY_WHAT_APPEARS, EMPTY_HOW_TO_MAKE_IT_APPEAR, NOT_DIAGNOSTIC,
  REQUEST_DATA_BUTTON } from "../../src/copy/embryos/index";
import { NO_COHORT_SENTENCE } from "../../src/copy/embryos/compare";
import { LETTER, FORMATS_SENTENCE, NEXT_STEP_SENTENCE, COPY_EMAIL_BUTTON,
  BACK_TO_EMBRYOS_LINK } from "../../src/copy/embryos/request-data";

type Facts = Record<string, Record<string, unknown>[]>;
async function emptyCohortSnapshot(accountId: string): Promise<Facts> {
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(accountId), "Actual native account required");
  const admin = adminClient(), facts: Facts = {};
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).eq("id", accountId)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" })
      .or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)],
    ["principals", admin.from("subject_principals").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["cohorts", admin.from("embryo_cohorts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["drafts", admin.from("embryo_cohort_drafts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["consents", admin.from("subject_consents").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["signatures", admin.from("consent_signatures").select("*", { count: "exact" }).eq("signer_account_id", accountId)],
  ] as const) {
    const result = await query;
    expect(result.error, `complete cohort entry ${name}`).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[name] = result.data!;
  }
  expect(facts.profiles).toHaveLength(1);
  expect(facts.subjects.filter(subject => subject.subject_class === "embryo")).toEqual([]);
  for (const name of ["cohorts", "drafts", "consents", "signatures"]) expect(facts[name]).toEqual([]);
  const principals = facts.principals.map(row => row.id as string);
  for (const [name, query] of [
    ["memberships", principals.length ? admin.from("embryo_participant_sets").select("*", { count: "exact" })
      .in("principal_id", principals) : null],
    ["analysis_grants", principals.length ? admin.from("purpose_grants").select("*", { count: "exact" })
      .eq("purpose", "embryo.analysis").in("data_subject_principal_id", principals) : null],
  ] as const) {
    const result = query ? await query : null;
    if (result) {
      expect(result.error, `complete cohort entry ${name}`).toBeNull(); expect(result.count).not.toBeNull();
      expect(result.data!.length).toBe(result.count);
    }
    facts[name] = result?.data ?? []; expect(facts[name]).toEqual([]);
  }
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

/** Only real fresh-account entry states. Completed, processing and quality
 * cohorts require the composed native journey; seeded cohort rows cannot
 * satisfy that prerequisite or provide a density image. */
export function realCohortEntryDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-cohort-entry-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = cohortEntryDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), email = `density-cohort-entry-${randomUUID()}@e2e.local`, password = "synthetic-cohort-entry-password";
        try {
          const accountId = await createConfirmedUser(email, password); await signIn(page, email, password);
          const apiWrites: string[] = [];
          page.on("request", request => {
            const url = new URL(request.url());
            if (url.origin === origin.origin && url.pathname.startsWith("/api/") && request.method() !== "GET")
              apiWrites.push(`${request.method()} ${url.pathname}`);
          });
          const response = await page.goto(row.route.path); expect(response?.status()).toBe(200);
          const before = await emptyCohortSnapshot(accountId);
          const observe = async () => {
            const nativeSnapshot = await emptyCohortSnapshot(accountId);
            expect(nativeSnapshot, "entry navigation does not create a cohort, consent or completed job").toEqual(before);
            expect(apiWrites, "entry forms keep every answer local before native authority").toEqual([]);
            await assertEntryState(page, recipe);
            return input.observeState(row, page, sourceSha256, { accountId, nativeSnapshot });
          };
          await observe(); await capture({ page, observe });
        } finally { await context.close(); }
      } } satisfies DensityStateFixture];
  });
}

async function assertEntryState(page: Page, recipe: CohortEntryDensityRecipe) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator('[data-slot="jurisdiction-line"], [data-slot="cohort-jurisdiction"], [data-slot="jurisdiction-unavailable"]')).toHaveCount(0);
  await expect(page.locator('[data-figure-kind], [data-trade-off-panel], [data-slot="cohort-card"], [data-slot="qc-table"]')).toHaveCount(0);
  if (recipe === "empty-hub") {
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(empty).toContainText(EMPTY_HEADING); await expect(empty).toContainText(EMPTY_WHAT_APPEARS);
    await expect(empty).toContainText(EMPTY_HOW_TO_MAKE_IT_APPEAR);
    await expect(page.getByRole("link", { name: REQUEST_DATA_BUTTON, exact: true })).toHaveAttribute("href", "/embryos/request-data");
    await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="embryo-tile"]')).toHaveCount(3);
  } else if (recipe === "empty-compare") {
    await expect(page.locator('[data-slot="blocking-state"][data-state="empty"]')).toContainText(NO_COHORT_SENTENCE);
    await expect(page.getByRole("link", { name: REQUEST_DATA_BUTTON, exact: true })).toHaveAttribute("href", "/embryos/request-data");
  } else {
    await expect(page.locator('blockquote[data-slot="request-letter"]')).toHaveText(LETTER);
    await expect(page.locator('[data-slot="formats"]')).toHaveText(FORMATS_SENTENCE);
    await expect(page.locator('[data-slot="next-step"]')).toHaveText(NEXT_STEP_SENTENCE);
    await expect(page.getByRole("button", { name: COPY_EMAIL_BUTTON, exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: BACK_TO_EMBRYOS_LINK, exact: true })).toHaveAttribute("href", "/embryos");
    expect(await page.locator('blockquote[data-slot="request-letter"]').innerText()).not.toMatch(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/iu);
  }
}
