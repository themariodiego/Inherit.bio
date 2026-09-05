import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { PERSONAL_PREVIEW_TRAITS } from "../src/copy/reports/personal-previews";

const RUN = randomUUID();
const USER = { email: `preview-${RUN}@e2e.local`, password: "e2e-preview-password" };
const EMPTY = { email: `preview-empty-${RUN}@e2e.local`, password: "e2e-preview-password" };
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/personal-previews-grch38.vcf");
const HEADINGS = ["What this is", "Your result", "What this doesn’t mean", "How sure we are", "What you can do", "Where this comes from"];

for (const [genotype, gt] of [["GG", "0/0"], ["AA", "1/1"]] as const) {
  test(`alcohol ${genotype} upload shows the matching takeaway and qualified full result`, async ({ page }) => {
    const user = { email: `preview-alcohol-${genotype}-${RUN}@e2e.local`, password: USER.password };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inherit-alcohol-preview-"));
    const fixture = path.join(dir, "synthetic-alcohol.vcf");
    const arrayFixture = path.join(dir, "synthetic-alcohol-array.txt");
    // Only an invented call in the documented synthetic fixture is varied.
    fs.writeFileSync(fixture, fs.readFileSync(FIXTURE, "utf8").replace(
      "12\t111803962\trs671\tG\tA\t.\tPASS\t.\tGT\t0/1",
      `12\t111803962\trs671\tG\tA\t.\tPASS\t.\tGT\t${gt}`,
    ));
    try {
      await createConfirmedUser(user.email, user.password);
      await signIn(page, user.email, user.password);
      await ingestFileAs(page, user.email, user.password, fixture, "vcf");
      const trait = PERSONAL_PREVIEW_TRAITS.find((item) => item.rsid === 671)!;
      await page.goto("/genome/me/reports");
      if (genotype === "GG") {
        // Explicit VCF 0/0 calls currently live outside user_variants. Do not
        // infer the reference from absence; test a genuinely supplied array call.
        await expect(page.locator(`[data-personal-preview="${trait.slug}"]`)).toHaveCount(0);
        fs.writeFileSync(arrayFixture, "# 23andMe synthetic test data; not a real person\n# reference build 38\n# rsid\tchromosome\tposition\tgenotype\nrs671\t12\t111803962\tGG\n");
        await ingestFileAs(page, user.email, user.password, arrayFixture, "array_23andme");
        await page.goto("/genome/me/reports");
      }
      await expect(page.locator(`[data-personal-preview="${trait.slug}"]`)).toContainText(trait.statements[genotype]);
      await expect(page.locator(`[data-personal-preview="${trait.slug}"]`)).toContainText(trait.qualifier);
      await page.locator(`a[href="/genome/me/reports/${trait.slug}"]`).click();
      await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveText(HEADINGS);
      await expect(page.locator('[data-slot="report-skeleton"]')).toContainText(genotype === "AA"
        ? "An early study found no measurable liver ALDH2 activity in two AA samples"
        : "It does not show the common Lys504 change linked to alcohol flushing.");
      await expect(page.locator('[data-slot="study-context"]')).toHaveCount(2);
    } finally {
      fs.unlinkSync(fixture);
      if (fs.existsSync(arrayFixture)) fs.unlinkSync(arrayFixture);
      fs.rmdirSync(dir);
    }
  });
}

test("own DNA shows four useful takeaways, filters all results, and links to the source-backed reports", async ({ page }) => {
  await createConfirmedUser(USER.email, USER.password);
  await signIn(page, USER.email, USER.password);
  const fileId = await ingestFileAs(page, USER.email, USER.password, FIXTURE, "vcf");
  await page.goto("/genome/me/reports");
  await expect(page.locator("[data-personal-preview]")).toHaveCount(4);
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
  // The filter includes interpreted calls beyond the four preview traits.
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
    await expect(page.locator('[data-slot="study-context"]')).toHaveCount(trait.rsid === 671 ? 2 : 1);
    if (trait.rsid === 671) {
      await expect(page.getByRole("link", { name: "PMID 2024727" })).toBeVisible();
      await expect(page.getByText("Not recorded in this study summary.", { exact: true })).toHaveCount(1);
      await expect(page.locator('[data-slot="report-skeleton"]')).toContainText("Your file shows one A copy");
      await expect(page.locator('[data-slot="report-skeleton"]')).not.toContainText("do not show this excess");
    }
  }

  await page.goto("/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551");
  await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveText(HEADINGS);
  await expect(page.getByRole("link", { name: "PMID 10233211" })).toBeVisible();
  await expect(page.locator('[data-slot="report-skeleton"]')).toContainText("This is not your measured caffeine breakdown rate.");
  await expect(page.locator('[data-slot="study-context"]')).toContainText("Nonsmokers showed no clear genotype differences.");
  await expect(page.locator('[data-slot="report-skeleton"]')).not.toContainText("fast metabolizer");
  await expect(page.locator('[data-slot="report-skeleton"]')).not.toContainText("heart attack");

  // A matching rsID at the wrong coordinate must not gain a personal preview.
  const admin = adminClient();
  const { error } = await admin.from("user_variants").update({ pos: 1 }).eq("file_id", fileId).eq("rsid", 17822931);
  expect(error).toBeNull();
  await page.goto("/genome/me/reports");
  await expect(page.locator('[data-personal-preview="earwax-type-abcc11"]')).toHaveCount(0);
  await expect(page.locator("[data-personal-preview]")).toHaveCount(3);
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
