import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import mental from "../data/templates/mental-health.json";
import addiction from "../data/templates/addiction.json";
import { createConfirmedUser, ingestFileAs, signIn } from "./helpers";
import { isGatedTemplate } from "../src/lib/genome/taxonomy";
import { readStudyContext } from "../src/lib/genome/study-context";
import type { ReportTemplate } from "../src/lib/genome/reports";

const USER = { email: `behavior-scope-${randomUUID()}@e2e.local`, password: "e2e-behavior-scope-password" };
const CASES = [
  { slug: "stress-anxiety-comt-rs4680", key: "AG", letters: "A/G" },
  { slug: "mood-stress-resilience-bdnf-rs6265", key: "CT", letters: "C/T" },
  { slug: "problem-substance-use-faah-rs324420", key: "AA", letters: "A/A" },
];
const templates = [...mental, ...addiction] as ReportTemplate[];
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await createConfirmedUser(USER.email, USER.password); });

for (const [index, entry] of CASES.entries()) {
  test(`/genome/[subject]/reports/[slug] shown ${entry.slug}: processed call and exact source scope`, async ({ page }) => {
    await signIn(page, USER.email, USER.password);
    if (index === 0) await ingestFileAs(page, USER.email, USER.password,
      path.join(process.cwd(), "e2e/fixtures/behavior-scope-grch38.vcf"), "vcf");
    const template = templates.find((t) => t.slug === entry.slug)!;
    await page.goto(`/genome/me/reports/${entry.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(template.title);
    if (isGatedTemplate(template)) {
      // The existing sensitive-category opt-in is unchanged; the source facts
      // remain readable before the synthetic personal result is revealed.
      await expect(page.getByTestId("sensitive-gate")).toBeVisible();
      await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="study-context"]')).toHaveCount(template.citations.length);
      await page.getByTestId("sensitive-gate-reveal").click();
      await expect(page).toHaveURL(new RegExp(`${entry.slug}\\?reveal=1$`));
    }
    const genotype = page.locator('[data-figure-kind="genotype"]');
    await expect(genotype).toHaveCount(1);
    await expect(genotype).toContainText(entry.letters);
    await expect(page.locator("#your-result").locator("..")).toContainText(template.variants[0].interpretations[entry.key]);
    await expect(page.locator('[data-slot="report-skeleton"] h2')).toHaveText([
      "What this is", "Your result", "What this doesn’t mean", "How sure we are", "What you can do", "Where this comes from",
    ]);
    await expect(page.locator('[data-slot="study-context"]')).toHaveCount(template.citations.length);
    await expect(page.locator('time[datetime="2026-09-06"]')).toHaveCount(template.citations.length);
    for (const [sourceIndex, source] of template.citations.entries()) {
      const panel = page.locator('[data-slot="study-context"]').nth(sourceIndex);
      await expect(panel).toBeVisible();
      for (const fact of Object.values(readStudyContext(source)!)) {
        if (!fact) continue;
        await expect(panel).toContainText(fact.text);
        await expect(panel).toContainText(fact.locator);
      }
      await expect(page.getByRole("link", { name: new RegExp(`PMID ${source.pmid}`) })).toHaveAttribute("href", `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`);
    }
    await expect(page.locator('[data-figure-kind="percentile"], [data-figure-kind="relative"]')).toHaveCount(0);
  });
}
