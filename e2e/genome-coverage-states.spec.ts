import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, seededTemplateCount, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";
import receipt from "./fixtures/synthetic-browser-grch38.receipt.json";
import regionalManifest from "../data/ref/aims-seven-region-manifest.json";
import { PREPARED_REPORTS, PRIMARY, STARTER, STATE_A_LEDE, STATE_C } from "../src/copy/overview";
import {
  BROWSER_EMPTY_REGION,
  BROWSER_NO_FILE,
  BROWSER_PREPARING,
  SCORE_COVERAGE_NO_FILE,
  SCORE_COVERAGE_NONE,
  SCORE_COVERAGE_PREPARING,
  SEARCH_LABEL,
  rsidNotCovered,
} from "../src/copy/genome/data";
import { REPORTS_PREPARING } from "../src/copy/genome/preparation";
import { INPUT_PROVENANCE_COPY } from "../src/copy/reports/input-provenance";
import { regionalBelowMinimum } from "../src/copy/regional-ancestry";
import { COUNT_NOUNS, LIST_NO_FILE, NOT_DIAGNOSTIC } from "../src/copy/reports/strings";
import { REGIONAL_EMPTY_NOTE } from "../src/lib/genome/regional-admixture";

/**
 * The coverage states of the My Genome surfaces, proven from three synthetic
 * accounts whose files differ in exactly one respect: how much of what the
 * product reads they carry.
 *
 * - NOTHING: `synthetic-browser-grch38.vcf.gz`, 144 invented chr20 positions
 *   with no rsID, no ancestry marker and no report or score-panel locus
 *   (`e2e/fixtures/PROVENANCE.md`). Prepared and generated for every purpose,
 *   it is the account whose data supports no result at all, which is what the
 *   register's `not-covered` means: "the file is here and prepared, and the
 *   data does not support a result".
 * - PARTIAL: `tiny-b-grch38.vcf`, which carries twelve positions drawn from the
 *   three shipped score panels (G8.3's seed B), so every panel is read in part.
 * - FULL: `density-source-grch38.vcf`, the union of the ancestry panel and
 *   every catalogue locus, so the Overview has every count, no ancestry
 *   shortfall and a full starter set.
 *
 * `empty` and `not-covered` render alike on `/overview` and mean opposites,
 * which is why every not-covered proof here establishes its cause from the
 * database before reading the page, exactly as `/overview empty` does: the
 * file exists, it is prepared, the polygenic layer read zero positions, and
 * the ancestry page confirms zero usable markers.
 *
 * Titles name a route path and one state id and nothing else the register
 * could mistake for a claim; the route gate reads them.
 */

const RUN_ID = randomUUID();
const NOTHING = { email: `coverage-nothing-${RUN_ID}@e2e.local`, password: "e2e-coverage-nothing-pw" };
const PARTIAL = { email: `coverage-partial-${RUN_ID}@e2e.local`, password: "e2e-coverage-partial-pw" };
const FULL = { email: `coverage-full-${RUN_ID}@e2e.local`, password: "e2e-coverage-full-pw" };

const NOTHING_FIXTURE = path.join(process.cwd(), receipt.fixture.path);
const PARTIAL_FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny-b-grch38.vcf");
const FULL_FIXTURE = path.join(process.cwd(), "e2e/fixtures/density-source-grch38.vcf");

const OVERVIEW = "/overview";
const REPORTS = "/genome/me/reports";
const DATA = "/genome/me/data";
const BROWSER = "/genome/me/data/browser";
const ANCESTRY = "/genome/me/ancestry";
const HEADINGS = ["Overview", "My Genome", "Family", "Embryos"];
/** The seven-region panel's size, from the manifest the estimator is pinned to. */
const PANEL_MARKERS = regionalManifest.markerCount;
/** The rsID every fixture but the NOTHING one carries (CYP1A2, the caffeine report). */
const CAFFEINE_RSID = 762551;

let nothingAccountId = "";
let nothingFileId = "";
let partialFileId = "";
let fullAccountId = "";
let fullFileId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  nothingAccountId = await createConfirmedUser(NOTHING.email, NOTHING.password);
  await createConfirmedUser(PARTIAL.email, PARTIAL.password);
  fullAccountId = await createConfirmedUser(FULL.email, FULL.password);
});

/** The one prepared file of an account, from the database rather than the page. */
async function preparedFile(accountId: string) {
  const { data, error } = await adminClient()
    .from("genome_files")
    .select("id, status, single_logical_sample_verified_at")
    .eq("user_id", accountId);
  expect(error).toBeNull();
  expect(data, "exactly one file").toHaveLength(1);
  expect(data![0].single_logical_sample_verified_at, "prepared, not in flight").not.toBeNull();
  return data![0];
}

/** Every score panel's read count for one file, with the panel size beside it. */
async function panelCoverage(fileId: string) {
  const admin = adminClient();
  const rows = await admin.from("user_prs").select("pgs_id, matched").eq("file_id", fileId);
  expect(rows.error).toBeNull();
  const scores = await admin.from("prs_scores").select("pgs_id, name, n_variants");
  expect(scores.error).toBeNull();
  const byId = new Map((scores.data ?? []).map((score) => [score.pgs_id, score]));
  const panels = (rows.data ?? []).map((row) => {
    const score = byId.get(row.pgs_id);
    expect(score, `a seeded score for ${row.pgs_id}`).toBeTruthy();
    return { pgsId: row.pgs_id, name: score!.name, matched: row.matched as number, needed: score!.n_variants as number };
  });
  expect(panels.length, "one row per shipped score panel").toBe(scores.data!.length);
  return panels.sort((a, b) => a.name.localeCompare(b.name));
}

async function expectStateCHub(page: Page) {
  await expect(page.getByRole("heading")).toHaveText(HEADINGS);
  await expect(page.getByText("Start here", { exact: true })).toHaveCount(0);
  await expect(page.getByText(STATE_A_LEDE, { exact: true })).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="prepared-reports-title"]')).toHaveCount(0);
  await expect(page.getByText(PREPARED_REPORTS.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(STATE_C.justYou, { exact: true })).toBeVisible();
  await expect(page.getByText(STATE_C.noEmbryoFiles, { exact: true })).toBeVisible();
  // Both layers generated, so both count lines: the catalogue sizes with their
  // layer nouns, never summed, and no figure anywhere on the hub.
  const metricValues = page.locator("[data-metric-value]");
  await expect(metricValues.first()).toHaveText(`${seededTemplateCount("estimate")} ${COUNT_NOUNS.estimate.other}`);
  await expect(metricValues.nth(1)).toHaveText(`${seededTemplateCount("variant_call")} ${COUNT_NOUNS["variant-call"].other}`);
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAccessibleName(PRIMARY.openReports);
  await expect(primary).toHaveAttribute("href", REPORTS);
  await expect(page.locator("[data-overview-box] a[href]")).toHaveCount(9);
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();
}

/**
 * `/overview not-covered`. The hub with a prepared file that answers nothing:
 * every purpose was chosen and generated, and the file supports no report, no
 * score panel and no region estimate.
 *
 * What separates it from its neighbours is asserted from both sides. Not
 * `empty`: the file exists and is prepared. Not `awaiting-choice`: nothing is
 * left to choose, and the choose-your-reports section is absent. Not
 * `partial-coverage`: that state's starter list — the reports the file DOES
 * support — is replaced here by the sentence that none of the starter reports
 * is covered, and the ancestry line reads the too-few-markers sentence because
 * zero of the panel's markers were read. The counts still render, because they
 * are catalogue sizes, not results; the page carries no figure and offers the
 * same one primary action, which is the honest thing to offer.
 */
test("/overview not-covered: a prepared file that supports no report, no score panel and no region estimate shows the no-starter sentence and the too-few-markers line", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, NOTHING.email, NOTHING.password);
  nothingFileId = await uploadOwnFilePrepared(page, NOTHING_FIXTURE, { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, nothingFileId, ["reports.monogenic", "reports.polygenic", "ancestry"]);

  // The cause, from the database: one prepared file, and the polygenic layer
  // read zero of every panel's positions. Without this the assertions below
  // would pass just as well for an account that uploaded nothing.
  const file = await preparedFile(nothingAccountId);
  expect(file.id).toBe(nothingFileId);
  const panels = await panelCoverage(nothingFileId);
  for (const panel of panels) {
    expect(panel.matched, `${panel.pgsId} read no position`).toBe(0);
    expect(panel.needed).toBeGreaterThan(0);
  }

  // And the other half of "supports nothing": zero usable ancestry markers,
  // stated by the ancestry page in the panel's own words, with the stored note
  // that no region share was computed and no raw numbers to disclose.
  await page.goto(ANCESTRY);
  const regional = page.locator('[data-slot="regional-ancestry"]');
  await expect(regional.locator('[data-slot="grey-state"]')).toHaveText(regionalBelowMinimum(0, PANEL_MARKERS));
  await expect(regional.locator('[data-slot="stored-support-note"]')).toHaveText(REGIONAL_EMPTY_NOTE);
  await expect(regional.locator('[data-slot="raw-numbers"]')).toHaveCount(0);
  await expect(regional.locator('[data-figure-kind="coverage"]')).toHaveCount(0);

  await page.goto(OVERVIEW);
  await expectStateCHub(page);

  // The reports layer is generated and covers nothing: the starter section is
  // the sentence for exactly that, with no report linked under it.
  const starter = page.locator('section[aria-labelledby="starter-title"]');
  await expect(starter).toHaveCount(1);
  await expect(starter.locator("#starter-title")).toHaveText(STARTER.none);
  await expect(starter.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(STARTER.five, { exact: true })).toHaveCount(0);

  // The ancestry line: the one sentence Overview renders about a result that
  // could not be estimated, and no number standing in for it.
  await expect(page.getByText(STATE_C.ancestryTooFew, { exact: true })).toBeVisible();
});

/**
 * `/genome/[subject]/reports not-covered`. Both layers generated on a file that
 * carries no report position: the covered count reads zero against the library
 * total in each layer, and every card's pill says the file does not cover it.
 *
 * This is the whole-page state, not one card's. `/genome/[subject]/reports
 * complete` was proven on a file whose estimate group has covered cards beside
 * a zero-covered Medicines group, and a reader could ask whether a list with
 * one empty group is already this state. It is not: `complete` there means
 * both layers granted and generated with no group absent for want of a source,
 * and coverage absences ride along. Here every group in every layer is
 * uncovered, and the count line says so before a single card is read.
 *
 * Not `processing` and not `empty`: the preparing sentence and the add-a-file
 * sentence are both absent, and the pills read "Not covered", never "Awaiting
 * your data", which is what the same cards show while nothing has been read.
 */
test("/genome/[subject]/reports not-covered: both layers generated on a file with no report position, so each covered count reads zero and every card's pill says not covered", async ({
  page,
}) => {
  await signIn(page, NOTHING.email, NOTHING.password);
  expect(nothingFileId, "the NOTHING account's prepared file").toBeTruthy();

  for (const [layer, layerClass, noun, query] of [
    ["estimate", "estimate", COUNT_NOUNS.estimate.other, ""],
    ["variant_call", "variant-call", COUNT_NOUNS["variant-call"].other, "?layer=variant_call"],
  ] as const) {
    await page.goto(`${REPORTS}${query}`);
    await expect(page.locator("main h1")).toHaveText("Reports");
    await expect(page.getByText(REPORTS_PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.getByText(LIST_NO_FILE, { exact: true })).toHaveCount(0);

    // The layer's own count line: zero covered, then the library total.
    const counts = page.locator(`main header [data-slot="count"][data-figure-class="${layerClass}"]`);
    await expect(counts).toHaveCount(2);
    await expect(counts.first()).toHaveText(`0 ${noun} covered by your file`);
    await expect(counts.nth(1)).toHaveText(`${seededTemplateCount(layer)} ${noun}`);

    // Every card in the open group carries the not-covered pill, and no card
    // carries any other: the count above is what the cards add up to.
    const library = page.locator(`[data-library-layer="${layerClass}"]`);
    await expect(library).toHaveCount(1);
    const cards = library.locator("li[data-card]");
    const cardCount = await cards.count();
    expect(cardCount, `${layer} cards`).toBeGreaterThan(0);
    await expect(library.locator('[data-coverage-status="not-covered"]')).toHaveCount(cardCount);
    await expect(library.locator('[data-coverage-status="covered"]')).toHaveCount(0);
    await expect(library.locator('[data-coverage-status="awaiting"]')).toHaveCount(0);
    await expect(page.locator("[data-personal-preview]")).toHaveCount(0);
    await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  }
});

/**
 * `/genome/[subject]/data/browser not-covered`. One rsID the reference knows
 * and the file does not carry: the answer is the not-covered sentence with the
 * gene, no results table and no result figure, while the search box stays —
 * the file is prepared and searchable; this one position is simply not in it.
 * The page still renders the region around the position, with the track's own
 * sentence that its emptiness is coverage, and the provenance panel, which on
 * every render with a checked file carries that file's read-rate figures (the
 * same figures the route's `complete` proof reads there) and here says in
 * words that the file supplied no record at this position. Those figures are
 * about the file, not the search: the proof holds every figure on the page to
 * that panel and refuses a genotype or a result-coverage figure anywhere. The
 * first CI run of this file measured exactly that — two read-rate figures
 * where a bare "no figure" had been asserted.
 *
 * The expected sentence is built from the reference row the page itself reads,
 * so the gene in it comes from the database rather than from this test. Not
 * `partial-coverage`: a gene search lists every reference position and marks
 * the missing ones cell by cell; this is one position, and it renders no table
 * at all. Not `empty` and not `processing`: neither of the two no-search
 * sentences is on the page, and the search box is.
 */
test("/genome/[subject]/data/browser not-covered: an rsID the reference knows and the file lacks answers with the not-covered sentence, no table and no result figure", async ({
  page,
}) => {
  await signIn(page, NOTHING.email, NOTHING.password);
  expect(nothingFileId, "the NOTHING account's prepared file").toBeTruthy();
  const reference = await adminClient().from("ref_variants").select("gene_symbol").eq("rsid", CAFFEINE_RSID).maybeSingle();
  expect(reference.error).toBeNull();
  expect(reference.data, "the reference store knows the caffeine position").toBeTruthy();

  await page.goto(`${BROWSER}?q=rs${CAFFEINE_RSID}`);
  await expect(page.locator("main h1")).toHaveText("Genome browser");
  await expect(page.getByLabel(SEARCH_LABEL)).toHaveValue(`rs${CAFFEINE_RSID}`);
  await expect(page.getByText(BROWSER_NO_FILE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(BROWSER_PREPARING, { exact: true })).toHaveCount(0);

  await expect(page.getByText(rsidNotCovered(CAFFEINE_RSID, reference.data!.gene_symbol), { exact: true })).toBeVisible();
  await expect(page.locator("#results")).toHaveCount(0);
  await expect(page.locator("[data-claim-block] table")).toHaveCount(0);

  // No result figure: no genotype and no result-coverage figure anywhere, and
  // nothing outside the provenance panel carries a figure at all. The panel's
  // figures are the file's read-rates, and its sentence for this file is the
  // absent one; the region's track says its emptiness is coverage.
  await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  await expect(page.locator('[data-provenance="computed:genome/browser"]')).toHaveCount(0);
  await expect(page.locator('main [data-figure-kind]:not([data-provenance="computed:genome/input-provenance"])')).toHaveCount(0);
  const provenance = page.locator('[data-slot="browser-input-provenance"]');
  await expect(page.locator("[data-figure-kind]")).toHaveCount(await provenance.locator("[data-figure-kind]").count());
  await expect(provenance.locator('[data-slot="table-input-provenance"]').getByText(INPUT_PROVENANCE_COPY.checkedAbsent, { exact: true })).toBeVisible();
  // The track reads its region after the page loads, as the `complete` proof
  // waits for its canvas: the same allowance here.
  await expect(page.getByText(BROWSER_EMPTY_REGION, { exact: true })).toBeVisible({ timeout: 60_000 });
});

/**
 * `/genome/[subject]/data partial-coverage`, the coverage reading (register
 * `stateDefinitions.partial-coverage`): the file does not carry positions the
 * page would otherwise report, and the page names which part and why — one
 * coverage figure per score, reading how many of the panel's positions the
 * file supplied against how many it needs, with the panel, the absent interval
 * and the resolution limit beside it.
 *
 * Every number is compared against the row the page reads rather than pinned:
 * `user_prs.matched` per score, `prs_scores.n_variants` per panel, and the
 * assertion that each read count is strictly between zero and the panel size
 * — which is what makes this partial rather than the zero-of-N the NOTHING
 * account renders on the same page, or a full read.
 */
test("/genome/[subject]/data partial-coverage: a file carrying some of every score panel's positions renders one coverage figure per score reading that count against the panel size", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, PARTIAL.email, PARTIAL.password);
  partialFileId = await uploadOwnFilePrepared(page, PARTIAL_FIXTURE, { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, partialFileId, ["reports.polygenic"]);
  const panels = await panelCoverage(partialFileId);
  for (const panel of panels) {
    expect(panel.matched, `${panel.pgsId} read some positions`).toBeGreaterThan(0);
    expect(panel.matched, `${panel.pgsId} read fewer than it needs`).toBeLessThan(panel.needed);
  }

  await page.goto(DATA);
  await expect(page.locator("main h1")).toHaveText("Data and methods");
  for (const sentence of [SCORE_COVERAGE_NONE, SCORE_COVERAGE_NO_FILE, SCORE_COVERAGE_PREPARING]) {
    await expect(page.getByText(sentence, { exact: true })).toHaveCount(0);
  }

  const items = page.locator('section[aria-labelledby="score-panel-coverage"] li[data-slot="score-panel-result"]');
  await expect(items).toHaveCount(panels.length);
  for (const [index, panel] of panels.entries()) {
    const item = items.nth(index);
    await expect(item.locator('[data-slot="score-panel-name"]')).toHaveText(panel.name);
    await expect(item.locator('[data-slot="score-panel-id"]')).toHaveText(panel.pgsId);
    const figure = item.locator(':scope > [data-claim-block] [data-figure-kind="coverage"]');
    await expect(figure).toHaveCount(1);
    await expect(figure.locator('[data-slot="figure-value"]')).toHaveText(
      `read ${panel.matched} of the ${panel.needed} positions this needs`,
    );
  }
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
});

/**
 * `/overview complete`. The hub with nothing left to say "not yet" about: a
 * prepared file that covers the whole ancestry panel and the catalogue's
 * positions, every purpose generated. Both count lines render, the ancestry
 * line that names a shortfall is absent because there is none, and the
 * starter section carries its five linked reports.
 *
 * `complete` here is the register's everything-it-can-honestly-show: the same
 * hub as `/overview partial-coverage`, which was proven on a file that covers
 * one ancestry marker and so renders the too-few-markers sentence beside the
 * counts. The two titles differ in exactly that sentence and in the starter
 * section, which is why the absence of the sentence is asserted rather than
 * left to inference — and why the ancestry page is read first, so that the
 * absence rests on a measured 168-of-168 read rather than on the hub's
 * silence.
 */
test("/overview complete: a prepared file covering the whole ancestry panel and the catalogue renders both counts, five starter reports and no shortfall sentence", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, FULL.email, FULL.password);
  fullFileId = await uploadOwnFilePrepared(page, FULL_FIXTURE, { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fullFileId, ["reports.monogenic", "reports.polygenic", "ancestry"]);
  const file = await preparedFile(fullAccountId);
  expect(file.id).toBe(fullFileId);

  // The measured reason the shortfall sentence is absent: every marker read.
  await page.goto(ANCESTRY);
  const regional = page.locator('[data-slot="regional-ancestry"]');
  await expect(regional).toHaveCount(1);
  await expect(regional.locator('[data-figure-kind="coverage"] [data-slot="figure-value"]'))
    .toHaveText(`read ${PANEL_MARKERS} of the ${PANEL_MARKERS} positions this needs`);
  await expect(regional.locator('[data-slot="grey-state"]')).toHaveCount(0);

  await page.goto(OVERVIEW);
  await expectStateCHub(page);
  await expect(page.getByText(STATE_C.ancestryTooFew, { exact: true })).toHaveCount(0);

  const starter = page.locator('section[aria-labelledby="starter-title"]');
  await expect(starter).toHaveCount(1);
  await expect(starter.locator("#starter-title")).toHaveText(STARTER.five);
  await expect(page.getByText(STARTER.none, { exact: true })).toHaveCount(0);
  const links = starter.locator("ol").getByRole("link");
  await expect(links).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await expect(links.nth(index)).toHaveAttribute("href", /^\/genome\/me\/reports\/[a-z0-9-]+$/);
  }
});
