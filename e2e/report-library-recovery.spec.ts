import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";

test("/genome/[subject]/reports empty: recover from a results-only filter without a file", async ({ page }) => {
  const user = { email: `library-empty-${randomUUID()}@e2e.local`, password: "synthetic-library-password" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await page.goto("/genome/me/reports");
  const cards = page.locator('[data-card="estimate"]');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  await expect(cards.locator('[data-coverage-status="covered"]')).toHaveCount(0);
  await page.getByLabel("With results", { exact: true }).check();
  await expect(cards).toHaveCount(0);
  const reset = page.getByRole("button", { name: "Clear filters", exact: true });
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Search reports by title, gene, or category")).toBeFocused();
  await expect(page.getByLabel("With results", { exact: true })).not.toBeChecked();
  await expect(cards).toHaveCount(count);
  await expect(cards.locator('[data-coverage-status="covered"]')).toHaveCount(0);
  await expect(reset).toHaveCount(0);
});

test("/genome/[subject]/reports partial-coverage: return to a result search and clear empty filters by keyboard", async ({ page }) => {
  const user = { email: `library-recovery-${randomUUID()}@e2e.local`, password: "synthetic-library-password" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  // Establish the covered result through real ingestion before testing search.
  await ingestFileAs(page, user.email, user.password,
    path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf"), "vcf");
  await page.goto("/genome/me/reports");
  const search = page.getByLabel("Search reports by title, gene, or category");
  const resultsOnly = page.getByLabel("With results", { exact: true });
  const cards = page.locator('[data-card="estimate"]');
  const initialCardCount = await cards.count();
  expect(initialCardCount).toBeGreaterThan(1);
  await resultsOnly.check();
  await search.fill("MCM6");
  await expect(cards).toHaveCount(1);
  const filteredTitle = await cards.locator("h3").innerText();
  await cards.getByRole("link").click();
  await expect(page.locator('[data-slot="report-skeleton"]')).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("MCM6");
  await expect(resultsOnly).toBeChecked();
  await expect(cards).toHaveCount(1);
  await expect(cards.locator("h3")).toHaveText(filteredTitle);

  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill("no-such-trait");
  await expect(cards).toHaveCount(0);
  await expect(page.getByText("No reports with results match this search.", { exact: false })).toBeVisible();
  const reset = page.getByRole("button", { name: "Clear filters", exact: true });
  await reset.focus();
  const box = await reset.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(resultsOnly).not.toBeChecked();
  await expect(cards).toHaveCount(initialCardCount);
  await expect(reset).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
