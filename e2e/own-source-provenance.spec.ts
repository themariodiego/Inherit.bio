import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { INPUT_PROVENANCE_COPY as COPY } from "../src/copy/reports/input-provenance";
import { OWN_REPORT_CHOICES } from "../src/lib/uploads/own-report-purpose";

test("canonical source facts explain converted coordinates and listed no-calls without inventing genome coverage", async ({ page }, testInfo) => {
  const email = `own-source-facts-${randomUUID()}@e2e.local`;
  const password = "synthetic-source-facts-password";
  await createConfirmedUser(email, password);
  await signIn(page, email, password);
  // Coordinates are the checked GRCh37/38 pairs in genome/liftover.test.ts.
  // One invented observed call and one explicit missing call, no human data.
  const bytes = ["##fileformat=VCFv4.2", "##reference=GRCh37",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC",
    "2\t136608646\trs4988235\tG\tA\t.\tPASS\t.\tGT\t0/1",
    "15\t75041917\trs762551\tC\tA\t.\tPASS\t.\tGT\t./.", ""].join("\n");
  const fixture = testInfo.outputPath("synthetic-source-grch37.vcf");
  writeFileSync(fixture, bytes);
  const fileId = await uploadOwnFileWithChosenReports(page, fixture,
    { fileType: "vcf", purposes: ["reports.polygenic"] });
  const library = "/genome/me/reports";
  const detail = `${library}/lactase-persistence-lct-rs4988235`;
  for (const destination of [library, detail]) {
    const response = await page.goto(destination);
    expect(response?.ok()).toBe(true);
    const facts = page.locator('[data-slot="input-source"]');
    await expect(facts).toHaveCount(1);
    await expect(facts).toContainText(COPY.converted);
    await expect(facts).toContainText(COPY.declared);
    await expect(facts).toContainText(COPY.callScope);
    await expect(facts).not.toContainText(COPY.unknown);
    await expect(facts.locator('[data-provenance="computed:genome/input-provenance"] [data-slot="figure-value"]'))
      .toHaveText("read 1 of the 2 positions this needs");
    const document = await response!.text();
    expect(document.includes(createHash("sha256").update(bytes).digest("hex")), "source hash stays private").toBe(false);
  }
  await expect(page.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/G");
  const normalized = await adminClient().from("user_variants").select("chrom,pos,genotype")
    .eq("file_id", fileId).eq("rsid", 4988235).single();
  expect(normalized.error).toBeNull();
  expect(normalized.data).toEqual({ chrom: 2, pos: 135851076, genotype: "A/G" });
  await page.screenshot({ path: testInfo.outputPath("converted-source-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("converted-source-mobile.png"), fullPage: true });

  await page.goto(library);
  const withdrawal = page.waitForResponse(response => /\/api\/consents\/[^/]+\/revoke$/.test(response.url())
    && response.request().method() === "POST");
  await page.getByRole("button", { name: `Turn off ${OWN_REPORT_CHOICES["reports.polygenic"].label}`, exact: true }).click();
  expect((await withdrawal).status()).toBe(200);
  await page.goto(detail);
  await expect(page.locator('[data-slot="input-source"]')).toHaveCount(0);
  await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  // Source permission survives report withdrawal; source facts do not require
  // a renewed analytic choice or silently restore one.
  await page.goto("/genome/me/data/browser");
  const search = page.getByRole("textbox", { name: "Search variants", exact: true });
  await search.fill("rs4988235");
  await page.locator("form").filter({ has: search }).getByRole("button", { name: "Search", exact: true }).click();
  const tableFacts = page.locator('[data-slot="table-input-provenance"]');
  await expect(tableFacts).toContainText(COPY.converted);
  await expect(tableFacts.locator('[data-provenance="computed:genome/input-provenance"] [data-slot="figure-value"]'))
    .toHaveText("read 1 of the 2 positions this needs");
  await expect(page.locator('#results [data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/G");
});
