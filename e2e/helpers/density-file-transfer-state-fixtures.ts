import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "../helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { fileTransferDensityRecipe } from "../../scripts/density-file-transfer-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";

const PREPARING = "Your file is stored. Preparing it for your results…";
const PREPARED = "Your file is stored and prepared. Reports have not been generated yet.";
type Facts = Record<string, Record<string, unknown>[]>;
async function transferSnapshot(accountId: string): Promise<Facts> {
  const admin = adminClient(), facts: Facts = {};
  for (const [table, column] of [
    ["genome_files", "user_id"], ["profiles", "id"], ["subjects", "subject_account_id"],
    ["subject_consents", "account_id"], ["consent_signatures", "signer_account_id"],
    ["subject_principals", "account_id"],
  ]) {
    const result = await admin.from(table).select("*", { count: "exact" }).eq(column, accountId);
    expect(result.error, `complete transfer ${table}`).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[table] = result.data!;
  }
  expect(facts.genome_files).toHaveLength(1);
  const file = facts.genome_files[0];
  expect(file.user_id).toBe(accountId); expect(file.original_name).toBe("Genome file");
  expect(file.sha256).toMatch(/^[a-f0-9]{64}$/); expect(file.upload_revision).toBeGreaterThan(0);
  for (const table of ["user_prs", "user_variants", "report_observed_calls", "ancestry_results"]) {
    const result = await admin.from(table).select("*", { count: "exact" }).eq("file_id", file.id);
    expect(result.error, `complete transfer ${table}`).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[table] = result.data!;
    // Preparation is not an approved or generated report.
    if (table !== "user_variants") expect(facts[table]).toEqual([]);
  }
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

/** Capture the original upload flow itself. A fresh navigation to a prepared
 * file list cannot stand in for the pending control or its live confirmation. */
export function realFileTransferDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable local app required");
  const sourcePath = "e2e/helpers/density-file-transfer-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = fileTransferDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), email = `density-transfer-${randomUUID()}@e2e.local`, password = "synthetic-density-transfer-password";
        let release: (() => void) | undefined, continuation: Promise<void> | undefined;
        let intercepted = 0, completed = false;
        try {
          const accountId = await createConfirmedUser(email, password); await signIn(page, email, password);
          await completeOwnUploadConsent(page, row.route.path);
          const empty = await adminClient().from("genome_files").select("*", { count: "exact" }).eq("user_id", accountId);
          expect(empty.error).toBeNull(); expect(empty.count).toBe(0); expect(empty.data).toEqual([]);
          const held = new Promise<void>(resolve => { release = resolve; });
          await page.route("**/api/files/*/process", async route => {
            assert(route.request().method() === "POST" && ++intercepted === 1, "One original preparation POST required");
            continuation = (async () => {
              await held; await route.continue();
              const response = await route.request().response();
              assert(response && response.ok() && await response.finished() === null, "Original preparation must settle successfully");
              completed = true;
            })();
            void continuation.catch(() => {}); await continuation;
          }, { times: 1 });
          await page.locator('input[type="file"]').setInputFiles(path.join(input.root, "e2e/fixtures/tiny-grch38.vcf"));
          const progress = page.locator('[data-slot="upload-progress"][aria-live="polite"]');
          await expect(progress).toHaveText(PREPARING); await expect.poll(() => intercepted).toBe(1);
          if (recipe === "prepared") {
            assert(release && continuation, "Actual preparation barrier and request required");
            release(); await continuation;
            await expect(progress).toContainText(PREPARED);
            // The same confirmation must survive the original server refresh.
            await expect(page.locator("main ul").first().locator("li")).toHaveCount(1);
            const file = page.locator("main ul li").filter({ hasText: "Genome file" });
            await expect(file).toHaveCount(1); await expect(file.locator('a[href$="/download"]')).toHaveCount(1);
            await expect(progress).toContainText(PREPARED);
          }
          const observe = async () => {
            const nativeSnapshot = await transferSnapshot(accountId), file = nativeSnapshot.genome_files[0];
            expect(intercepted).toBe(1);
            await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
            await expect(page.locator('[data-figure-kind]')).toHaveCount(0);
            if (recipe === "pending") {
              expect(completed).toBe(false); expect(file.status).toBe("uploaded");
              expect(file.normalization_completed_at).toBeNull(); await expect(progress).toHaveText(PREPARING);
              expect(nativeSnapshot.user_variants).toEqual([]);
              await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeDisabled();
              await expect(page.locator('input[type="file"]')).toBeDisabled();
            } else {
              expect(completed).toBe(true); expect(file.status).toBe("stored");
              expect(file.normalization_completed_at).not.toBeNull(); expect(file.single_logical_sample_verified_at).not.toBeNull();
              expect(file.normalization_source_revision).toBe(file.upload_revision);
              expect(nativeSnapshot.user_variants.length).toBeGreaterThan(0);
              await expect(progress).toContainText(PREPARED);
              await expect(page.getByRole("link", { name: "Choose your reports", exact: true })).toBeVisible();
              await expect(page.getByRole("link", { name: "View your file", exact: true })).toBeVisible();
              await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
              expect(await page.content(), "the disk filename never reaches the rendered file list").not.toContain("tiny-grch38.vcf");
            }
            return input.observeState(row, page, sourceSha256, { accountId, nativeSnapshot });
          };
          await observe(); await capture({ page, observe });
        } finally {
          release?.();
          try { if (continuation) await continuation; } finally { await context.close(); }
        }
      } } satisfies DensityStateFixture];
  });
}
