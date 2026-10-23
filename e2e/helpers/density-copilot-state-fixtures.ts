import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page, type Route } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "../helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { assertUnansweredCopilotRows, copilotDensityRecipe, COPILOT_DENSITY_TABLES,
  DENSITY_COPILOT_ENDPOINT, DENSITY_COPILOT_PROVIDER, type CopilotDensityRecipe } from "../../scripts/density-copilot-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";

const question = "What is my caffeine genotype?";
async function completeRows(accountId: string) {
  assert(/^[a-f0-9-]{36}$/.test(accountId), "Actual native account required");
  const rows: Record<string, Record<string, unknown>[]> = {}, admin = adminClient();
  for (const [table, column] of [["profiles", "id"], ["subjects", "subject_account_id"], ["subject_principals", "account_id"],
    ["llm_settings", "user_id"], ["llm_keys", "user_id"], ["subject_consents", "account_id"],
    ["consent_signatures", "signer_account_id"], ["consent_grants", "user_id"], ["genome_files", "user_id"],
    ["chats", "user_id"], ["copilot_context_tokens", "account_id"], ["account_operation_nonces", "account_id"]]) {
    const result = await admin.from(table).select("*", { count: "exact" }).eq(column, accountId);
    expect(result.error, `full native Copilot ${table}`).toBeNull();
    expect(result.count).not.toBeNull(); expect(result.data!.length).toBe(result.count);
    rows[table] = result.data!;
  }
  expect(rows.subjects).toHaveLength(1);
  const grants = await admin.from("purpose_grants").select("*", { count: "exact" })
    .eq("target_kind", "subject").eq("target_id", rows.subjects[0].id as string);
  expect(grants.error).toBeNull(); expect(grants.count).not.toBeNull(); expect(grants.data!.length).toBe(grants.count);
  rows.purpose_grants = grants.data!;
  expect(Object.keys(rows).sort()).toEqual([...COPILOT_DENSITY_TABLES].sort());
  for (const values of Object.values(rows)) values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assertUnansweredCopilotRows(rows, accountId);
  return rows;
}

async function consentRefusal(route: Route) {
  await route.continue();
  const response = await route.request().response();
  assert(response && await response.finished() === null, "The same original chat request must settle");
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: "consent_required", provider_key: DENSITY_COPILOT_PROVIDER });
}

/** Original compatibility conversation on a fresh actor with no canonical
 * source. The app's own consent gate answers before retrieval or inference.
 * A new account that cannot enter this real legacy contract holds instead. */
export function realUnansweredCopilotDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: unknown }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable app required");
  const sourcePath = "e2e/helpers/density-copilot-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = copilotDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), email = `density-copilot-${randomUUID()}@e2e.local`, password = "synthetic-density-copilot-password";
        let release: (() => void) | undefined, continuation: Promise<void> | undefined, intercepted = 0;
        try {
          const accountId = await createConfirmedUser(email, password); await signIn(page, email, password);
          expect((await page.goto("/settings/copilot"))?.status()).toBe(200);
          await page.getByLabel("Provider", { exact: true }).click();
          await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
          await page.getByLabel("Base URL").fill(DENSITY_COPILOT_ENDPOINT);
          await page.getByLabel("Model", { exact: true }).fill("synthetic-model");
          const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/llm/settings"
            && response.request().method() === "POST");
          await page.getByRole("button", { name: "Save provider", exact: true }).click();
          const savedResponse = await saved; expect(savedResponse.status()).toBe(200);
          // llm-settings-v1 (G8.5, 23 October 2026): the server-normalized recipient, never the key.
          expect(await savedResponse.json()).toEqual({ status: "saved", provider: DENSITY_COPILOT_PROVIDER,
            endpointOrigin: `https://${DENSITY_COPILOT_PROVIDER}`, classification: "cloud" });
          expect(await savedResponse.finished()).toBeNull();
          await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true })).toBeVisible();
          const original = await completeRows(accountId);
          expect((await page.goto("/copilot/me"))?.status()).toBe(200);
          await expect(page.getByLabel("Message the copilot")).toBeVisible();
          if (recipe !== "empty") {
            const pending = new Promise<void>(resolve => { release = resolve; });
            await page.route("**/api/chat", async route => {
              if (route.request().method() !== "POST") { await route.continue(); return; }
              assert(++intercepted === 1, "Exactly one original chat POST required");
              continuation = (async () => { await pending; await consentRefusal(route); })();
              void continuation.catch(() => {}); await continuation;
            });
            await page.getByLabel("Message the copilot").fill(question);
            await page.getByRole("button", { name: "Send", exact: true }).click();
            await expect.poll(() => intercepted).toBe(1);
            if (recipe === "permission") { assert(release && continuation); release(); await continuation; }
          }
          const observe = async () => {
            const actual = await completeRows(accountId);
            expect(actual, "the consent refusal stores no conversation or permission").toEqual(original);
            await assertState(page, recipe);
            if (recipe === "pending") expect(intercepted).toBe(1);
            return input.observeState(row, page, sourceSha256, { accountId, nativeSnapshot: actual });
          };
          await observe(); await capture({ page, observe });
          expect(await completeRows(accountId)).toEqual(original);
        } finally {
          try {
            if (release) { release(); if (continuation) await continuation; }
          } finally { await context.close(); }
        }
      } } satisfies DensityStateFixture];
  });
}

async function assertState(page: Page, recipe: CopilotDensityRecipe) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask about You");
  const indicator = page.getByTestId("data-flow-indicator");
  await expect(indicator).toContainText("Cloud mode"); await expect(indicator).toContainText(DENSITY_COPILOT_PROVIDER);
  await expect(indicator.getByRole("link", { name: "revoke in Settings" })).toHaveAttribute("href", "/settings/copilot");
  await expect(page.locator('[data-role="assistant"], [data-figure-kind], [data-claim-block]')).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  if (recipe === "empty") {
    await expect(page.locator('[data-role="user"]')).toHaveCount(0);
    await expect(page.getByText("Ask about your own genome. Try:", { exact: false })).toBeVisible();
    await expect(page.getByText("The copilot is informational — never a diagnosis", { exact: false })).toBeVisible();
    await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review what would be shared", exact: true })).toHaveCount(0);
  } else {
    await expect(page.locator('[data-role="user"]')).toHaveCount(1);
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    if (recipe === "pending") {
      await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Review what would be shared", exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Before sending data from your genome to a cloud service, Copilot needs your clear consent.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Review what would be shared", exact: true })).toBeVisible();
    }
  }
}
