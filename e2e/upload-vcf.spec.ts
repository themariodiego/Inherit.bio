import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConfirmedUser, signIn } from "./helpers";
import { expectNoOwnAncestryResult, generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";
import receipt from "./fixtures/HG001_GRCh38_chr20_1000000-1100000.receipt.json";

// A5: a byte-verbatim window of the public GIAB benchmark, plus a separate
// synthetic source for rsID/gene positives (GIAB's original IDs are all '.').
// The 99,744,915-byte parent exceeds the approved 50 MiB decoder limit.
// Computed zero-AIM ancestry is covered; A8 MT/Y coverage remains NOT closed:
// canonical lineage generation is unimplemented, not a chromosome-absence test.
const USER = { email: `vcf-user-${randomUUID()}@e2e.local`, password: "e2e-vcf-pw" };
const PANEL_SIZE = (JSON.parse(readFileSync(path.join(process.cwd(), "data/ref/aims.json"), "utf8")) as unknown[]).length;
const GIAB_RATE = "calls in 127 of 127 listed, supported records";
const RATE = '[data-provenance="computed:genome/input-provenance"] [data-slot="figure-value"]';
let giabFileId: string;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await createConfirmedUser(USER.email, USER.password); });

test("GIAB window: real hashed upload → preparation → explicit ancestry generation", async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, USER.email, USER.password);
  // No result permission exists during either upload. Upload GIAB last so its
  // exact source is the active locus/track file, independently of the tiny SNPs.
  const tinyId = await uploadOwnFilePrepared(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf" });
  const declared = page.waitForRequest(request => new URL(request.url()).pathname === "/api/files/upload-session" && request.method() === "POST");
  void declared.catch(() => {});
  giabFileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), receipt.fixture.path), { fileType: "vcf" });
  // Observe the real browser hash declaration; a tiny file's transient hashing
  // label is not a stable checkpoint. The helper also compares the stored SHA.
  expect((await declared).postDataJSON()).toMatchObject({
    declaredFormat: "VCF.GZ", sizeBytes: receipt.fixture.compressedBytes, sha256: receipt.fixture.sha256,
  });
  await expect(page.getByText("Your file is stored and prepared. Reports have not been generated yet.", { exact: true })).toBeVisible();
  await page.goto("/files");
  const file = page.getByRole("listitem").filter({ hasText: receipt.fixture.sha256.slice(0, 32) });
  await expect(file).toHaveCount(1);
  await expect(file.getByText("Prepared", { exact: true })).toBeVisible();
  await expect(file).toContainText("GRCh38 · 144 variants");
  await expect(file).toContainText(`sha256 ${receipt.fixture.sha256.slice(0, 32)}`);
  await expect(page.getByText(/median \d+(\.\d+)?s/)).toBeVisible();
  await expectNoOwnAncestryResult(giabFileId);
  await expectNoOwnAncestryResult(tinyId);
  await generateOwnFileWithChosenReports(page, giabFileId, ["ancestry"]);
  await expectNoOwnAncestryResult(tinyId);
});

test("GIAB locus and first-party track preserve benchmark calls; rsID search uses the distinct synthetic source", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const region = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/browse/region" && url.searchParams.get("file") === giabFileId
      && url.searchParams.get("chrom") === "chr20" && url.searchParams.get("start") === "1000000"
      && url.searchParams.get("end") === "1100000";
  });
  void region.catch(() => {});
  await page.goto("/genome/me/data/browser?q=chr20:1000000-1100000");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(receipt.fixture.records);
  // The exact window's IDs were not annotated; test a real immutable point.
  for (const row of await rows.all()) await expect(row.locator("td").first()).toHaveText("—");
  const point = receipt.fixture.firstPoint;
  const firstPoint = rows.filter({ hasText: `chr20:${point.pos} ${point.ref}→${point.alt}` });
  await expect(firstPoint).toHaveCount(1);
  await expect(firstPoint.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText(point.genotype);
  const result = page.locator('section[aria-labelledby="results-heading"] [data-claim-block][data-subject-id]');
  await expect(result).toHaveCount(1);
  await expect(page.locator("[data-claim-block] table")).toHaveCount(1);
  const subjectId = await result.getAttribute("data-subject-id");
  expect(subjectId).toBeTruthy();
  // These are two views of ONE GIAB input, not evidence of two uploaded files.
  for (const slot of ["table-input-provenance", "track-input-provenance"]) {
    const context = page.locator(`[data-slot="${slot}"]`);
    await expect(context).toBeVisible();
    await expect(context.locator('details, [hidden], [aria-hidden="true"]')).toHaveCount(0);
    await expect(context.locator('[data-slot="input-source"]')).toHaveCount(1);
    await expect(context.locator(RATE)).toHaveText(GIAB_RATE);
    await expect(context).toContainText("No change of genome coordinates was needed.");
    await expect(context).toContainText("cannot verify where they came from");
    await expect(context).toContainText("Those records are outside this read-rate count.");
    for (const block of await context.locator('[data-claim-block]').all()) {
      await expect(block).toHaveAttribute("data-subject-id", subjectId!);
      await expect(block.locator('[data-figure-kind="coverage"][data-figure-class="quality"][data-figure-basis="observed"]')).toHaveCount(1);
    }
  }
  await expect(page.locator('[data-provenance="computed:genome/browser"] [data-slot="figure-value"]')).toHaveText("read 144 of the 144 positions this needs");
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(`My Genome / ${name} / Data / Genome browser`);
  const regionResponse = await region;
  expect(regionResponse.status()).toBe(200);
  const body = await regionResponse.json();
  expect(body.truncated).toBe(false);
  expect(body.variants).toHaveLength(receipt.fixture.records);
  expect(body.variants).toContainEqual(point);
  expect(body.variants.every((variant: { rsid: number | null; chrom: number; pos: number }) =>
    variant.rsid === null && variant.chrom === 20 && variant.pos >= 1_000_000 && variant.pos <= 1_100_000)).toBe(true);
  await expect(page.getByTestId("genome-browser").locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/does not contact an outside genome service/)).toBeVisible();

  await page.goto("/genome/me/data/browser?q=rs762551");
  await expectSyntheticCaffeineCall(page);
});

async function expectSyntheticCaffeineCall(page: Page) {
  const row = page.locator("table tbody tr").filter({ has: page.getByText("rs762551", { exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("CYP1A2");
  await expect(row.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
  const tableInputs = page.locator('[data-slot="table-input-provenance"]');
  await expect(tableInputs.locator('[data-slot="input-source"]')).toHaveCount(2);
  await expect(tableInputs.locator(RATE)).toHaveCount(2);
  expect(await tableInputs.locator(RATE).allTextContents()).toEqual(expect.arrayContaining([
    GIAB_RATE, "calls in 4 of 4 listed, supported records",
  ]));
  await expect(tableInputs.getByText("This file was checked but supplied no record at this result's positions.", { exact: true })).toHaveCount(1);
  const trackInputs = page.locator('[data-slot="track-input-provenance"]');
  await expect(trackInputs.locator('[data-slot="input-source"]')).toHaveCount(1);
  await expect(trackInputs.locator(RATE)).toHaveText(GIAB_RATE);
}

test("gene search joins the actual synthetic source's call with CYP1A2 reference annotations", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me/data/browser?q=CYP1A2");
  await expectSyntheticCaffeineCall(page);
});

test("GIAB ancestry has computed zero-marker coverage and explicitly uncomputed lineages", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/ancestry");
  for (const kind of ["mtdna", "ydna"]) {
    const lineage = page.getByTestId(kind);
    await expect(lineage).toContainText("Lineage has not been computed from this file.");
    await expect(lineage.locator('[data-figure-kind="haplogroup"], [data-figure-kind="coverage"], [data-slot="haplogroup-tree"]')).toHaveCount(0);
  }
  await expect(page.locator('[data-slot="maternal-input-provenance"], [data-slot="paternal-input-provenance"]')).toHaveCount(0);
  const admixture = page.getByTestId("admixture");
  await expect(admixture.locator('[data-slot="grey-state"]')).toHaveText(
    `Your file covers only 0 of ${PANEL_SIZE} ancestry markers — too few to draw a map. This is a limit of the file, not a result about you.`,
  );
  const rawList = admixture.getByRole("list");
  await expect(rawList).toBeHidden();
  await admixture.getByText("Show the unreliable raw numbers anyway").click();
  await expect(admixture).toContainText(/proportions are unreliable/i);
  await expect(rawList).toBeVisible();
  await expect(rawList.getByRole("listitem")).toHaveCount(5);
});
