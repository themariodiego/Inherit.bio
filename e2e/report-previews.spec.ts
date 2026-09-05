import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { PERSONAL_PREVIEW_TRAITS } from "../src/copy/reports/personal-previews";

const RUN = randomUUID();
const USER = { email: `preview-${RUN}@e2e.local`, password: "e2e-preview-password" };
const EMPTY = { email: `preview-empty-${RUN}@e2e.local`, password: "e2e-preview-password" };
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
const HEADINGS = ["What this is", "Your result", "What this doesn’t mean", "How sure we are", "What you can do", "Where this comes from"];

test("own DNA shows three useful takeaways, filters all results, and links to the source-backed reports", async ({ page }) => {
  await createConfirmedUser(USER.email, USER.password);
  await signIn(page, USER.email, USER.password);
  const fileId = await ingestFileAs(page, USER.email, USER.password, FIXTURE, "vcf");
  await page.goto("/genome/me/reports");
  await expect(page.locator("[data-personal-preview]")).toHaveCount(3);
  for (const trait of PERSONAL_PREVIEW_TRAITS) {
    const preview = page.locator(`[data-personal-preview="${trait.slug}"]`);
    await expect(preview).toContainText(trait.qualifier);
    await expect(preview).toContainText("Your file shows");
  }
  const cards = page.locator('[data-card="estimate"]');
  const all = await cards.count();
  await page.getByLabel("With results", { exact: true }).check();
  expect(await cards.count()).toBeLessThan(all);
  await expect(cards.locator('[data-coverage-status="not-covered"]')).toHaveCount(0);
  // The filter includes interpreted calls beyond the three preview traits.
  await expect(page.getByRole("link", { name: /Caffeine metabolism/ })).toBeVisible();
  await page.getByLabel("Search reports by title, gene, or category").fill("MCM6");
  await expect(page.locator("[data-personal-preview]")).toHaveCount(1);
  await page.getByLabel("Search reports by title, gene, or category").fill("no-such-trait");
  await expect(page.getByText("No reports with results match this search.", { exact: false })).toBeVisible();
  await page.getByLabel("Search reports by title, gene, or category").fill("");
  await page.getByLabel("With results", { exact: true }).uncheck();
  await expect(cards).toHaveCount(all);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("With results", { exact: true }).check();
  for (const trait of PERSONAL_PREVIEW_TRAITS) {
    const preview = page.locator(`[data-personal-preview="${trait.slug}"]`);
    await preview.scrollIntoViewIfNeeded();
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await preview.locator("p").last().evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("none");
  }
  for (const trait of PERSONAL_PREVIEW_TRAITS) {
    await page.goto("/genome/me/reports");
    await page.locator(`a[href="/genome/me/reports/${trait.slug}"]`).click();
    await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveText(HEADINGS);
    await expect(page.locator('[data-figure-kind="genotype"]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: `PMID ${trait.source.pmid}` })).toBeVisible();
    await expect(page.locator('[data-slot="study-context"]')).toHaveCount(1);
  }

  // A matching rsID at the wrong coordinate must not gain a personal preview.
  const admin = adminClient();
  const { error } = await admin.from("user_variants").update({ pos: 1 }).eq("file_id", fileId).eq("rsid", 17822931);
  expect(error).toBeNull();
  await page.goto("/genome/me/reports");
  await expect(page.locator('[data-personal-preview="earwax-type-abcc11"]')).toHaveCount(0);
  await expect(page.locator("[data-personal-preview]")).toHaveCount(2);
});

test("a different account with no file gets no personal preview or serialized takeaway", async ({ page }) => {
  await createConfirmedUser(EMPTY.email, EMPTY.password);
  await signIn(page, EMPTY.email, EMPTY.password);
  const response = await page.goto("/genome/me/reports");
  await expect(page.locator("[data-personal-preview]")).toHaveCount(0);
  const html = await response!.text();
  for (const trait of PERSONAL_PREVIEW_TRAITS) {
    for (const text of Object.values(trait.statements)) expect(html).not.toContain(text);
  }
  await page.getByLabel("With results", { exact: true }).check();
  await expect(page.locator('[data-card="estimate"]')).toHaveCount(0);
  await expect(page.getByText("No reports with results match this search.", { exact: false })).toBeVisible();
  await page.getByLabel("With results", { exact: true }).uncheck();
  expect(await page.locator('[data-card="estimate"]').count()).toBeGreaterThan(3);
});
