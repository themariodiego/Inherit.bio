import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import {
  adminClient,
  createConfirmedUser,
  firstViewportInteractives,
  ingestFileAs,
  signIn,
} from "./helpers";

// The expert path (brief §7.3, §1.4–§1.6, §2.2, X4, X6.1, X13) on the tiny
// GRCh38 fixture (rs762551 0/1 → A/C; rs4988235 1/1 → A/A), over the real
// processing route and the local Supabase stack:
//
// - the genome browser renders one attributed claim block per results table
//   with every genotype as an observed `genotype` figure carrying the four
//   contract attributes; rsIDs and coordinates are plain text; the
//   four-level breadcrumb, the subject bar, no eyebrow, no `title` in the
//   table, exactly three headings, the region range as text, the first-party
//   sentence, one default button and ≤12 first-viewport interactives at
//   1280×800 with the track in view;
// - the gene, clinical-gene, trait and no-match states;
// - `/genome/me/data` titled "Data and methods" with one `coverage` figure
//   per score and no percent text;
// - the Settings and ancestry entry points (the report footer is pinned by
//   `report-skeleton.spec.ts`).

const USER = { email: "genome-data@e2e.local", password: "e2e-genome-data-pw" };

const BROWSER = "/genome/me/data/browser";
const DATA = "/genome/me/data";
const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";
const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";

const FIRST_PARTY_NOTE =
  "This view uses only the DNA data stored in Inherit. It does not contact an outside genome service. The list of positions comes from this Inherit site.";
const CLINICAL_FIRST_SENTENCE = "Inherit’s reference has no clinical variants for BRCA1.";
const NOT_COVERED = "Not covered by your file";
const NO_MATCH = /^No reference variants known for “zzz”\./;
const OR_START_FROM_REPORTS = "Or start from your reports.";
const FULL_LIBRARY = "Browse the full report library";
const DATA_AND_METHODS = "Data and methods";
const TABLE_HEADINGS = ["Variant", "Position", "Gene", "Your two letters"];
/** rs762551 sits at chr15:74749576; the region is the 5 kb window either side. */
const REGION_RANGE = "chr15:74744576-74754576";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

/** Upload and process the fixture, then wait for the row to be annotated (the pattern of overview.spec.ts). */
async function ingestAndWait(page: Page) {
  const fileId = await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), TINY_FIXTURE),
    "vcf",
  );
  const admin = adminClient();
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("genome_files").select("status").eq("id", fileId).single();
        return (data as { status: string } | null)?.status;
      },
      { timeout: 60_000 },
    )
    .toBe("annotated");
}

async function subjectName(page: Page): Promise<string> {
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  return name!;
}

test("an rsID search renders one attributed block, one observed genotype figure and the region within the caps", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await ingestAndWait(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BROWSER}?q=rs762551`);

  // Composition: h1, four-level breadcrumb with the full name, subject bar.
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toHaveText("Genome browser");
  const name = await subjectName(page);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText(`My Genome / ${name} / Data / Genome browser`);
  await expect(breadcrumb.getByRole("link", { name: "My Genome" })).toHaveAttribute("href", "/genome/me");
  await expect(breadcrumb.getByRole("link", { name: "Data" })).toHaveAttribute("href", DATA);
  await expect(page.locator("[data-subject-bar][data-subject-id]")).toHaveCount(1);
  await expect(page.locator("main .eyebrow")).toHaveCount(0);

  // Exactly one block, attributed to the subject, wrapping the one table.
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);
  await expect(page.locator("[data-claim-block] table")).toHaveCount(1);
  await expect(page.locator("#results")).toHaveCount(1);
  await expect(page.locator("table th")).toHaveText(TABLE_HEADINGS);
  await expect(page.locator("table [title]")).toHaveCount(0);

  // Exactly one figure on the page: the genotype, with the four contract
  // attributes, reading the fixture's heterozygous call.
  const figures = page.locator("[data-figure-kind]");
  await expect(figures).toHaveCount(1);
  const genotype = figures.first();
  await expect(genotype).toHaveAttribute("data-figure-kind", "genotype");
  await expect(genotype).toHaveAttribute("data-figure-class", "variant-call");
  await expect(genotype).toHaveAttribute("data-figure-basis", "observed");
  await expect(genotype).toHaveAttribute("data-provenance", "computed:genome/browser");
  await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText("A/C");
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
  await expect(page.locator('[data-figure-kind="absolute"]')).toHaveCount(0);

  // The row's identity is plain text: the rsID and the ungrouped coordinate.
  const row = page.locator("[data-claim-block] table tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").first()).toHaveText("rs762551");
  await expect(row).toContainText("chr15:74749576");
  await expect(row).toContainText("CYP1A2");

  // Headings: the h1 and the two h2s, nothing deeper (§2.2).
  await expect(page.locator("main :is(h1, h2, h3, h4, h5, h6)")).toHaveText([
    "Genome browser",
    "Results",
    "Region",
  ]);

  // The region: the coordinate range as text, the first-party sentence and
  // the track, whose canvas marks the library as initialised.
  const region = page.locator('section[aria-labelledby="region-heading"]');
  await expect(region).toContainText(REGION_RANGE);
  await expect(region.getByText(FIRST_PARTY_NOTE)).toBeVisible();
  await expect(page.getByTestId("genome-browser").locator("canvas").first()).toBeVisible({
    timeout: 60_000,
  });

  // §1.5: one default-variant button; X6.1: at most twelve interactive
  // elements in the first 800px at 1280×800, the track's controls included.
  const primary = page.locator('main [data-slot="button"][data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Search");
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(12);
});

test("a gene search lists every reference position with the covered genotype as a figure and the rest as not covered", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto(`${BROWSER}?q=CYP1A2`);

  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);
  const rows = page.locator("[data-claim-block] table tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(1);

  const covered = rows.filter({ hasText: "rs762551" });
  await expect(covered).toHaveCount(1);
  await expect(covered.locator('[data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText("A/C");
  await expect(covered).toContainText("chr15:74749576");
  await expect(covered).not.toContainText(NOT_COVERED);

  // Every other seeded CYP1A2 position is outside the fixture: the cell says
  // so in the report's words and carries no figure.
  const others = rows.filter({ hasNotText: "rs762551" });
  const otherCount = await others.count();
  for (let index = 0; index < otherCount; index++) {
    await expect(others.nth(index)).toContainText(NOT_COVERED);
    await expect(others.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
  }
  await expect(page.locator("[data-figure-kind]")).toHaveCount(1);
  await expect(page.locator("table [title]")).toHaveCount(0);
});

test("clinical-gene, trait and no-match queries render their honest states with no figure", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);

  // A hereditary-risk gene: the status sentence, never an empty table.
  await page.goto(`${BROWSER}?q=BRCA1`);
  await expect(page.locator('main [role="status"]')).toContainText(CLINICAL_FIRST_SENTENCE);
  await expect(page.locator("#results")).toHaveCount(0);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);

  // A trait word: the reports that cover it, named by their current titles.
  await page.goto(`${BROWSER}?q=caffeine`);
  const caffeine = page.locator(`main a[href="${CAFFEINE}"]`);
  await expect(caffeine).toHaveCount(1);
  await expect(caffeine).toHaveText("Caffeine metabolism");
  await expect(page.getByRole("link", { name: FULL_LIBRARY })).toHaveAttribute("href", "/genome/me/reports");
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);

  // Nothing matches: the sentence and the way back to the reports.
  await page.goto(`${BROWSER}?q=zzz`);
  await expect(page.getByText(NO_MATCH)).toBeVisible();
  await expect(page.getByRole("link", { name: OR_START_FROM_REPORTS })).toHaveAttribute(
    "href",
    "/genome/me/reports",
  );
  await expect(page.locator("#results")).toHaveCount(0);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
});

test("the data page is titled Data and methods with one coverage figure per score and no percent text", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto(DATA);

  await expect(page.locator("main h1")).toHaveText(DATA_AND_METHODS);
  const name = await subjectName(page);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText(`My Genome / ${name} / Data`);
  await expect(breadcrumb.getByRole("link", { name: "My Genome" })).toHaveAttribute("href", "/genome/me");

  // The two outline links; no default-variant button on this page.
  await expect(
    page.locator(`main a[data-slot="button"][data-variant="outline"][href="${BROWSER}"]`),
  ).toHaveCount(1);
  await expect(
    page.locator('main a[data-slot="button"][data-variant="outline"][href="/files"]'),
  ).toHaveCount(1);
  await expect(page.locator('main [data-slot="button"][data-variant="default"]')).toHaveCount(0);

  // One `coverage` figure per listed score, each inside its own attributed
  // block, and the former "12.3% of this score's positions" sentence gone.
  const items = page.locator('section[aria-labelledby="score-panel-coverage"] li');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('[data-figure-kind="coverage"]')).toHaveCount(count);
  await expect(items.locator("[data-claim-block][data-subject-id]")).toHaveCount(count);
  for (const text of await items.allTextContents()) {
    expect(text).not.toMatch(/\d%/);
  }
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
});

test("Settings and the ancestry page link to Data and methods", async ({ page }) => {
  await signIn(page, USER.email, USER.password);

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: DATA_AND_METHODS })).toHaveAttribute("href", DATA);

  await page.goto("/genome/me/ancestry");
  await expect(page.getByRole("link", { name: DATA_AND_METHODS })).toHaveAttribute("href", DATA);
});
