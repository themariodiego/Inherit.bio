import { expect, test } from "@playwright/test";
import path from "node:path";
import { createConfirmedUser, signIn } from "./helpers";

// A5 — the GIAB HG001 chr20-22 subset uploads through the real UI, parses,
// annotates, and powers browse/search + the genome browser. A8's VCF side
// (honest "what your file supports" labels) is asserted on the ancestry
// page: chr20-22 has no MT/Y and nearly no AIM coverage.

const USER = { email: "vcf-user@e2e.local", password: "e2e-vcf-pw" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("GIAB VCF subset: upload → parse → annotate through the real uploader UI", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signIn(page, USER.email, USER.password);
  await page.goto("/uploads");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles(
    path.join(process.cwd(), "data/samples/HG001_GRCh38_chr20-22.vcf.gz"),
  );

  await expect(page.getByText(/Hashing locally/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Processed. Your reports are ready."),
  ).toBeVisible({ timeout: 540_000 });

  await page.reload();
  await expect(page.getByText("Processed", { exact: true })).toBeVisible();
  // Match the metadata line ("vcf · 5 MB · GRCh38 · 187,130"), not the
  // filename, which also contains "GRCh38".
  await expect(page.getByText(/GRCh38 · [\d,]+/)).toBeVisible();
  await expect(page.getByText(/sha256/)).toBeVisible();
  // Honest measured processing time now exists.
  await expect(page.getByText(/median \d+(\.\d+)?s/)).toBeVisible();
});

test("variant search by rsID returns genotype; genome browser displays variants at the locus", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);

  // rs6062496 is a common chr20 SNV present in HG001's benchmark set;
  // search by position window instead of hardcoding a genotype: query a
  // known locus and assert rows + browser render.
  await page.goto("/genome/me/data/browser?q=chr20:1000000-1100000");
  const table = page.locator("table");
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  // The results table is one attributed claim block (X4) under the
  // four-level breadcrumb of brief §1.4, with the subject's full name.
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);
  await expect(page.locator("[data-claim-block] table")).toHaveCount(1);
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
    `My Genome / ${name} / Data / Genome browser`,
  );

  const browser = page.getByTestId("genome-browser");
  await expect(browser).toBeVisible();
  // igv renders its track UI inside the container.
  await expect(browser.locator("canvas").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/does not contact an outside genome service/)).toBeVisible();

  // rsID search: pick an rsID from the table we just rendered, then search
  // for it directly and assert the genotype renders as an observed
  // `genotype` figure (X4), never as loose text.
  const firstRsid = await rows
    .first()
    .locator("td")
    .first()
    .textContent();
  if (firstRsid && firstRsid.startsWith("rs")) {
    await page.goto(`/genome/me/data/browser?q=${firstRsid.trim()}`);
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    const genotype = page
      .locator("table tbody tr")
      .first()
      .locator('[data-figure-kind="genotype"] [data-slot="figure-value"]');
    await expect(genotype).toBeVisible();
    await expect(genotype).toHaveText(/^[ACGT](\/[ACGT])?$/);
  }
});

test("gene search joins reference annotations with user genotypes", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  // A gene on chr20-22 covered by templates (seeded ref_variants); ADA is
  // chr20. If the reference store lacks it, the page must say so honestly
  // rather than render junk.
  await page.goto("/genome/me/data/browser?q=PRODH"); // chr22 gene used by template seeds
  const outcome = page
    .locator("table tbody tr")
    .first()
    .or(page.getByText(/No reference variants known/));
  await expect(outcome).toBeVisible();
});

test("ancestry page states what a chr20-22 file cannot support", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/ancestry");
  await expect(page.getByTestId("mtdna")).toContainText(
    /no mitochondrial positions/i,
  );
  await expect(page.getByTestId("ydna")).toContainText(
    /no Y-chromosome positions/i,
  );
  // Plain-language gloss on the "XX genomes" jargon.
  await expect(page.getByTestId("ydna")).toContainText(
    /without a Y chromosome/i,
  );

  // chr20-22 covers almost none of the AIM panel, so the regions section
  // renders the grey state: the mandated §4.6 sentence, character for
  // character, with the measured counts (the subset's marker count is read
  // from the file, never fixed here), and no percentages.
  const admixture = page.getByTestId("admixture");
  await expect(admixture.locator('[data-slot="grey-state"]')).toHaveText(
    /^Your file covers only \d+ of \d+ ancestry markers — too few to draw a map\. This is a limit of the file, not a result about you\.$/,
  );
  // The raw numbers stay hidden behind an explicit disclosure...
  const rawList = admixture.getByRole("list");
  await expect(rawList).toBeHidden();
  // ...and opening it shows the warning plus the greyed, whole-number bars.
  await admixture
    .getByText("Show the unreliable raw numbers anyway")
    .click();
  await expect(admixture).toContainText(/proportions are unreliable/i);
  await expect(rawList).toBeVisible();
  await expect(rawList.getByRole("listitem")).toHaveCount(5);
});
