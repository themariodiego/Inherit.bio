import { uploadOwnFilePrepared, generateOwnFileWithChosenReports } from "./own-report-helpers";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import {
  createConfirmedUser,
  firstViewportInteractives,
  signIn,
} from "./helpers";
import { NO_RANGE_YET, RESOLUTION_LIMIT, panelVersionLine } from "../src/copy/genome/polygenic";
import { NOT_FOUND_HEADING } from "../src/copy/not-found";

// The expert path (brief §7.3, §1.4–§1.6, §2.2, X4, X6.1, X13) on the tiny
// GRCh38 fixture (rs762551 0/1 → A/C; rs4988235 1/1 → A/A), over the real
// processing route and the local Supabase stack:
//
// - the genome browser renders one attributed claim block per results table
//   with every genotype as an observed `genotype` figure carrying the four
//   contract attributes; rsIDs and coordinates are plain text; the
//   four-level breadcrumb, the subject bar, no eyebrow, no `title` in the
//   table, three primary headings plus visible input provenance, the region range as text, the first-party
//   sentence, one default button and ≤12 first-viewport interactives at
//   1280×800 with the track in view;
// - the gene, clinical-gene, trait and no-match states;
// - `/genome/me/data` titled "Data and methods" with one `coverage` figure
//   per score and no percent text;
// - the Settings and ancestry entry points (the report footer is pinned by
//   `report-skeleton.spec.ts`).

const USER = { email: `genome-data-${randomUUID()}@e2e.local`, password: "e2e-genome-data-pw" };

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

let preparedFileId: string;

async function subjectName(page: Page): Promise<string> {
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  return name!;
}

test("an rsID search renders one attributed block, one observed genotype figure and the region within the caps", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  preparedFileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), TINY_FIXTURE), { fileType: "vcf" });
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
  await expect(page.locator("#results [data-claim-block][data-subject-id]")).toHaveCount(1);
  await expect(page.locator("[data-claim-block] table")).toHaveCount(1);
  await expect(page.locator("#results")).toHaveCount(1);
  await expect(page.locator("table th")).toHaveText(TABLE_HEADINGS);
  await expect(page.locator("table [title]")).toHaveCount(0);

  // Exactly one genotype figure in the results table, with the four contract
  // attributes, reading the fixture's heterozygous call.
  const figures = page.locator("#results [data-figure-kind]");
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

  // Provenance is below the region, never folded into a closed control.
  await expect(page.locator("main :is(h1, h2, h3, h4, h5, h6)")).toHaveText([
    "Genome browser",
    "Results",
    "Region",
    "About the source files",
    "About the source files",
  ]);
  const inputs = page.locator('[data-slot="browser-input-provenance"]');
  await expect(inputs.locator('[data-slot="input-provenance"]')).toHaveCount(2);
  await expect(inputs.locator('details, [hidden], [aria-hidden="true"]')).toHaveCount(0);
  const tableInputs = inputs.locator('[data-slot="table-input-provenance"]');
  await expect(tableInputs).toContainText("This count is for the rows shown here");
  await expect(tableInputs).toContainText("cannot verify where they came from");
  await expect(tableInputs).toContainText("No change of genome coordinates was needed");
  await expect(tableInputs.locator('[data-provenance="computed:genome/browser"] [data-slot="figure-value"]')).toContainText("1 of the 1");
  const trackInputs = inputs.locator('[data-slot="track-input-provenance"]');
  await expect(trackInputs).toContainText("newest processed file");
  await expect(trackInputs.locator('[data-provenance="computed:genome/input-provenance"] [data-slot="figure-value"]')).toHaveText("calls in 4 of 4 listed, supported records");

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

  await expect(page.locator("#results [data-claim-block][data-subject-id]")).toHaveCount(1);
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
  await expect(page.locator("#results [data-figure-kind]")).toHaveCount(1);
  await expect(page.locator('[data-slot="table-input-provenance"]')).toContainText("not a count of all positions in the gene or region");
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

/**
 * `/genome/[subject]/data complete`. The same question `/files/upload
 * complete` raised, answered the same way rather than assumed: this page
 * shows a coverage figure per score AND states that no interval is available
 * and what the panel's resolution limit is, so a reader could ask whether a
 * page admitting a missing interval is `partial-coverage`.
 *
 * It is not, because the missing interval is not missing coverage - it is the
 * method's own honesty about what a score can say, stated in full. This page's
 * product IS the account of methods and coverage, and it renders all of it.
 * A page that hid the absent interval to look finished would be the failure,
 * and it is asserted against below.
 */
test("/genome/[subject]/data complete: titled Data and methods with one coverage figure per score, no percent text, and each score's panel, absent interval and resolution limit", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await generateOwnFileWithChosenReports(page, preparedFileId, ["reports.polygenic"]);
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
  await expect(items.locator(':scope > [data-claim-block] [data-figure-kind="coverage"]')).toHaveCount(count);
  await expect(items.locator(':scope > [data-claim-block][data-subject-id]')).toHaveCount(count);
  await expect(items.locator('[data-slot="score-input-label"]')).toHaveCount(count);
  const scoreInputs = page.locator('[data-slot="score-input-provenance"]');
  await expect(scoreInputs.locator('[data-slot="input-provenance"]')).toHaveCount(1);
  await expect(scoreInputs).toContainText("cannot verify where they came from");
  await expect(scoreInputs.locator('details, [hidden]')).toHaveCount(0);
  // Each score carries its seeded ancestry-portability statement (provenance
  // about the score's source cohort, which may quote the cohort's own
  // percentages); outside that note no percent text renders — the former
  // "12.3% of this score's positions" sentence is gone.
  await expect(items.locator('[data-slot="ancestry-note"]')).toHaveCount(count);
  for (let index = 0; index < count; index++) {
    const outsideNote = await items.nth(index).evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-slot="ancestry-note"]').forEach((node) => node.remove());
      return clone.textContent ?? "";
    });
    expect(outsideNote).not.toMatch(/\d%/);
    const label = (await items.nth(index).locator('[data-slot="score-input-label"]').textContent())!.trim();
    expect(label).toMatch(/^File [1-9]\d*$/);
    const source = scoreInputs.locator('[data-slot="input-source"]').filter({ has: page.getByText(new RegExp(`^${label} ·`)) });
    await expect(source).toHaveCount(1);
    // The local suite can retain older synthetic files. They must explicitly
    // report missing historical facts, not acquire the new file's snapshot.
    await expect(source).toContainText(/No change of genome coordinates was needed|were not recorded for this input/);
  }
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);

  // G4.4's three base requirements on a quantity read against a reference
  // panel, seen in a browser for the first time: the panel and its version,
  // an interval or an explicit statement that none is available, and the
  // resolution limit in plain words. (Its two polygenic extras -- the coverage
  // fraction and the ancestry-portability statement -- are the `coverage`
  // figure and `ancestry-note` already asserted above.) The strings are
  // imported from the copy module the page renders rather than retyped, so
  // the surface and this assertion cannot drift apart, and the panel sentence
  // is rebuilt from the name and id the page itself displays.
  const panelProvenance = items.locator('[data-slot="score-panel-provenance"]');
  await expect(panelProvenance).toHaveCount(count);
  // "Renders" means rendered: not folded behind a disclosure or hidden.
  await expect(panelProvenance.locator("details, [hidden]")).toHaveCount(0);
  for (let index = 0; index < count; index++) {
    const item = items.nth(index);
    // Visible in fact, not merely un-hidden: a block nested inside a closed
    // disclosure anywhere above would still pass the count assertion.
    await expect(item.locator('[data-slot="score-panel-provenance"]')).toBeVisible();
    const name = (await item.locator('[data-slot="score-panel-name"]').textContent())!.trim();
    const id = (await item.locator('[data-slot="score-panel-id"]').textContent())!.trim();
    const sentences = (await item.locator('[data-slot="score-panel-provenance"] p').allTextContents())
      .map((sentence) => sentence.trim());
    expect(sentences, "the panel line, the absent interval and the resolution limit").toHaveLength(3);
    // No shipped score carries a version: `public.prs_scores` has no version
    // column and none of the seeds in `data/prs/*.json` declares one, which
    // `src/lib/genome/prs-panel.test.ts` pins against the shipped files. So
    // the sentence must be the "no version is recorded" branch. If a record
    // ever gains a real version this fails, and that is the intent -- it asks
    // for a deliberate look rather than letting an invented build slip
    // through unread.
    expect(
      sentences[0],
      `the panel and version line for ${id}; a version here must come from the record, never from anywhere else`,
    ).toBe(panelVersionLine({ id, name, version: null }));
    expect(sentences[1], "the explicit statement that no interval is available").toBe(NO_RANGE_YET);
    expect(sentences[2], "the resolution limit in plain words").toBe(RESOLUTION_LIMIT);
  }
});

/**
 * The third not-found shape: a `notFound()` thrown inside `(app)`, which is
 * where 12 of the 19 call sites live. It needs a session, which is why it is
 * here rather than in `e2e/a11y.spec.ts` beside the other two.
 *
 * The landmark count is the point. Next renders the nearest boundary inside the
 * layouts above it, and `AppShell` already supplies the one `<main id="main">`,
 * so a boundary bringing its own would put two on the page - which is exactly
 * what the first version of this work did, undetected by an audit that only
 * visited an unmatched URL.
 */
test("an unknown subject reaches the app's not-found body inside the one existing main", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  const res = await page.goto("/genome/definitely-not-a-subject");
  expect(res?.status(), "an unknown subject is a 404").toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND_HEADING);
  await expect(page.locator("main"), "exactly one main landmark").toHaveCount(1);
  await expect(page.locator("#main"), "exactly one skip-link target").toHaveCount(1);
  const body = await page.locator("main").innerText();
  for (const leak of ["revoked", "deleted", "no longer have", "removed"]) {
    expect(body.toLowerCase(), `"${leak}" would confirm what the 404 withholds`).not.toContain(leak);
  }
});

test("Settings and the ancestry page link to Data and methods", async ({ page }) => {
  await signIn(page, USER.email, USER.password);

  await page.goto("/settings");
  await expect(page.getByRole("link", { name: DATA_AND_METHODS })).toHaveAttribute("href", DATA);

  await page.goto("/genome/me/ancestry");
  await expect(page.getByRole("link", { name: DATA_AND_METHODS })).toHaveAttribute("href", DATA);
});
