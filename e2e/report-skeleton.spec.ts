import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConfirmedUser, ingestFileAs, seededTemplateCount, signIn } from "./helpers";
import { FIXTURE_NAME, buildMedicinesVcf, verify } from "./fixtures/medicines-fixture";
import type { ReportTemplate } from "../src/lib/genome/reports";
import { readStudyContext } from "../src/lib/genome/study-context";

// Report skeleton and figure contract (brief X4, X5, X13) on the My Genome
// surfaces, against the tiny GRCh38 VCF fixture (rs762551 het → A/C; APOE
// positions absent → not covered) and, for the Medicines category (ADR
// 0021), against a second account whose only file carries one changed copy
// at every Medicines position (e2e/fixtures/medicines-grch38.vcf).
//
// Pins: the six fixed h2s in order; one attributed claim block carrying one
// observed genotype figure; the exact partial-state sentence and no
// percentile anywhere; the exact not-diagnostic line; breadcrumb, subject
// bar and chip row; footer links; the not-covered strings at full ink; the
// list page's one layer definition per group, layer-labelled counts, the
// layer tabs, the nine categories across the two groups with Medicines
// rendered like any other and no absence paragraph; a covered Medicines
// report's variant-call genotype figure, its Medicines "What you can do"
// string, the DPYD lead sentence and the absence of every forbidden word;
// and the hub's three tiles and single primary.

// Fresh identities isolate this suite from files left by an earlier local run.
const RUN_ID = randomUUID();
const USER = { email: `skeleton-user-${RUN_ID}@e2e.local`, password: "e2e-skeleton-pw" };
/** A second account whose only file covers every Medicines position. */
const MEDICINES_USER = {
  email: `skeleton-medicines-${RUN_ID}@e2e.local`,
  password: "e2e-skeleton-medicines-pw",
};

const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const APOE_REVEALED = "/genome/me/reports/apoe-e4-alzheimers-risk?reveal=1";
const VKORC1_SLUG = "vkorc1-rs9923231-one-position";
const DPYD_SLUG = "dpyd-rs3918290-one-position";
const MEDICINES_FIXTURE = path.join(process.cwd(), "e2e/fixtures", FIXTURE_NAME);

const HEADINGS = [
  "What this is",
  "Your result",
  "What this doesn’t mean",
  "How sure we are",
  "What you can do",
  "Where this comes from",
];
const HEADING_SELECTOR =
  "h2#what-this-is, h2#your-result, h2#what-this-doesnt-mean, h2#how-sure-we-are, h2#what-you-can-do, h2#where-this-comes-from";

const NOT_DIAGNOSTIC =
  "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.";
const NO_RANGE_YET = "We can’t put a range on this yet, so we don’t show a single number.";
const NOT_COVERED_VCF_FIRST_SENTENCE = "Your file does not cover this variant.";
const LIMIT_OF_FILE = "This is a limit of your file, not a result about you.";
const ESTIMATE_DEFINITION =
  "Links between DNA and traits found in studies. Some reports use one spot; polygenic scores combine many. Neither says what will happen to you.";
const VARIANT_CALL_DEFINITION =
  "A result about one or a few exact spots in your DNA, read against an outside clinical classification.";
const DOESNT_MEAN_GENERIC = "It does not say what will happen to you.";
const DOESNT_MEAN_NOT_COVERED = "A missing result is not a negative result.";
/** Brief line 630's fixed string, rendered on every category but Medicines. */
const NOTHING_TO_DO =
  "There is nothing you need to do about this result. It does not change what any doctor would advise for you today.";
/** The Medicines "What you can do" string (ADR 0021), rendered for that category only. */
const WHAT_YOU_CAN_DO_MEDICINES =
  "Inherit does not say what any doctor should do with this result. You can show it to any doctor you choose.";
/** The evidence sentence a variant_call report renders (ADR 0021). */
const VARIANT_CALL_EVIDENCE =
  "This position is named by a published prescribing guideline. Inherit reads the letters only.";
const MEDICINES_DESCRIPTION =
  "The letters your file shows at single DNA positions that prescribing guidelines name.";
/** The sentence the DPYD report leads with (the research note's fact). */
const DPYD_SENTENCE =
  "This is one of the positions guidelines list for DPYD. C on both copies here says nothing about the other positions, which this report does not read.";
/** §6.4's rows and ADR 0021's phenotype and response words: none may appear on a Medicines surface. */
const FORBIDDEN_IN_MEDICINES =
  /\bdosage\b|\bsupplement\b|we recommend you take|metaboli[sz]er|\brespon(?:d|ds|ded|ding|se|ses|sive)\b/i;
const SKELETON_H2 = '[data-slot="report-skeleton"] h2';

const NINE_CATEGORIES = [
  "Everyday traits",
  "Food, drink and metabolism",
  "Heart and circulation",
  "Immune system and allergies",
  "Medicines",
  "Brain, memory and mood",
  "Cancer",
  "Having children",
  "Ageing and longevity",
];
/** The estimate group on the seed: every category but Medicines, which has no estimate. */
const ESTIMATE_CATEGORY_HEADINGS = NINE_CATEGORIES.filter((label) => label !== "Medicines");

interface MedicinesTemplate {
  slug: string;
  title: string;
  summary: string;
  variants: {
    rsid: number;
    gene: string;
    chrom: number;
    pos38: number;
    ref: string;
    alt: string;
    interpretations: Record<string, string>;
  }[];
  citations: { pmid: string; label: string }[];
}

/** The shipped Medicines templates, read from the seed so no assertion hard-codes them. */
const MEDICINES = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/templates/medicines.json"), "utf8"),
) as MedicinesTemplate[];

/** The report name is the title up to its gene suffix (the page's reportNameOf). */
function reportName(title: string): string {
  const index = title.indexOf(" · ");
  return index === -1 ? title : title.slice(0, index);
}

/** One changed copy renders as the sorted pair of letters (reports.ts genotypeKey → genotypeLetters). */
function hetLetters(variant: { ref: string; alt: string }): string {
  return [variant.ref, variant.alt].sort().join("/");
}

function hetKey(variant: { ref: string; alt: string }): string {
  return [variant.ref, variant.alt].sort().join("");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
  await createConfirmedUser(MEDICINES_USER.email, MEDICINES_USER.password);
});

test("all five contextual reports show each source without inventing personal findings", async ({ page }) => {
  await signIn(page, USER.email, USER.password);
  const templates = ["basic-traits", "gastrointestinal", "lifestyle-wellness"].flatMap((category) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), `data/templates/${category}.json`), "utf8")) as ReportTemplate[],
  ).filter((template) => template.citations.some((citation) => citation.studyContext));
  expect(templates.map((template) => template.slug).sort()).toEqual([
    "alcohol-flush-aldh2-rs671", "bitter-taste-tas2r38",
    "caffeine-metabolism-cyp1a2-rs762551", "earwax-type-abcc11",
    "lactase-persistence-lct-rs4988235",
  ]);
  for (const template of templates) {
    await page.goto(`/genome/me/reports/${template.slug}`);
    await expect(page.locator(HEADING_SELECTOR)).toHaveText(HEADINGS);
    const citations = template.citations.filter((source) => source.studyContext);
    await expect(page.locator('[data-slot="study-context"]')).toHaveCount(citations.length);
    for (const [index, citation] of citations.entries()) {
      const panel = page.locator('[data-slot="study-context"]').nth(index);
      await expect(panel).toContainText("not a personal result");
      for (const entry of Object.values(readStudyContext(citation)!)) {
        if (entry === null) {
          await expect(panel).toContainText("Not recorded in this study summary.");
        } else {
          await expect(panel).toContainText(entry.text);
          await expect(panel).toContainText(entry.locator);
        }
      }
      await expect(page.getByRole("link", { name: new RegExp(`PMID ${citation.pmid}`) })).toHaveAttribute("href", `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`);
    }
    await expect(page.locator('time[datetime="2026-09-05"]')).toHaveCount(citations.length);
    await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  }
});


/**
 * Adjacent top-level sections keep the baseline gap at 1280×800
 * (docs/density-baseline.json adjacentTopLevelSectionGapPx.atOrAbove1024Min
 * = 96px; measured as next.top − previous.bottom in DOM order, the same
 * arithmetic as e2e/overview.spec.ts).
 */
async function expectBaselineSectionGaps(page: Page, selector: string, expectedCount: number) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  const sections = page.locator(selector);
  await expect(sections).toHaveCount(expectedCount);
  const rects = [] as { y: number; height: number }[];
  for (let i = 0; i < expectedCount; i++) {
    const rect = await sections.nth(i).boundingBox();
    expect(rect).not.toBeNull();
    rects.push({ y: rect!.y, height: rect!.height });
  }
  for (let i = 1; i < rects.length; i++) {
    const gap = rects[i].y - (rects[i - 1].y + rects[i - 1].height);
    expect(gap, `gap between top-level sections ${i - 1} and ${i}`).toBeGreaterThanOrEqual(95.5);
  }
}

test("a covered estimate report renders the six headings, one attributed genotype figure and no percentile", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  await page.goto(CAFFEINE);

  // The six fixed h2s, in DOM order, with their fixed ids; nothing else in
  // the skeleton is an h2 (the support panel, when present, sits after it).
  await expect(page.locator(HEADING_SELECTOR)).toHaveText(HEADINGS);
  await expect(page.locator(SKELETON_H2)).toHaveCount(6);
  // The six sections keep the baseline's 96px gap at 1280 (defect D-011).
  await expectBaselineSectionGaps(
    page,
    '[data-slot="report-skeleton"] [data-density-top-level-section]',
    6,
  );

  // The report name is the title up to its gene suffix; the eyebrow above it
  // is the nine-category label, never the legacy one.
  await expect(page.locator("main h1")).toHaveText("Caffeine metabolism");
  await expect(page.locator("main article header p").first()).toHaveText(
    "Food, drink and metabolism",
  );

  // Exactly one claim block, attributed to the subject, named by its locus,
  // and the page's primary claim for density measurement.
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);
  await expect(
    page.locator('[data-claim-block][aria-label="CYP1A2 rs762551"][data-density-primary-claim="true"]'),
  ).toHaveCount(1);
  // A single-variant report has no per-variant locus line in "Your result".
  await expect(
    page.locator('section[aria-labelledby="your-result"] [data-slot="variant-locus"]'),
  ).toHaveCount(0);

  // One observed genotype figure with the four contract attributes.
  const genotype = page.locator(
    '[data-figure-kind="genotype"][data-figure-class="estimate"][data-figure-basis="observed"][data-provenance^="computed:"]',
  );
  await expect(genotype).toHaveCount(1);
  await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText("A/C");

  // The partial state is the only statement about a risk number.
  await expect(page.getByText(NO_RANGE_YET)).toBeVisible();
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);

  // The one not-diagnostic line.
  await expect(page.getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC);

  // "What this doesn’t mean": the one generic bullet on a covered report.
  await expect(
    page.locator('section[aria-labelledby="what-this-doesnt-mean"] li'),
  ).toHaveText([DOESNT_MEAN_GENERIC]);

  // "What you can do": brief line 630's fixed string on every category but
  // Medicines (ADR 0021).
  await expect(page.locator('section[aria-labelledby="what-you-can-do"] p')).toHaveText(
    NOTHING_TO_DO,
  );

  // "Where this comes from": the Sources h3 above the citations, then the
  // variant provenance row whose rsID links to dbSNP.
  const whereFrom = page.locator('section[aria-labelledby="where-this-comes-from"]');
  await expect(whereFrom.getByRole("heading", { level: 3, name: "Sources" })).toBeVisible();
  await expect(whereFrom.getByRole("link", { name: "rs762551" })).toHaveAttribute(
    "href",
    "https://www.ncbi.nlm.nih.gov/snp/rs762551",
  );
  await expect(whereFrom).toContainText("CYP1A2 · rs762551 · chr15:74749576 C→A");

  // Breadcrumb "My Genome / {name} / Reports / {report}" with the full name.
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText(`My Genome / ${name} / Reports / Caffeine metabolism`);
  await expect(breadcrumb.getByRole("link", { name: "My Genome" })).toHaveAttribute(
    "href",
    "/genome/me",
  );
  await expect(breadcrumb.getByRole("link", { name: "Reports" })).toHaveAttribute(
    "href",
    "/genome/me/reports",
  );

  // Subject bar: kind chip and file count.
  const bar = page.locator("[data-subject-bar]");
  await expect(bar.locator('[data-slot="subject-kind"]')).toHaveText("You");
  await expect(bar.getByRole("link", { name: "1 file" })).toHaveAttribute("href", "/files");

  // Chip row: layer word and evidence word.
  await expect(page.locator('[data-chip="layer"]')).toHaveText("Statistical estimates");
  await expect(page.locator('[data-chip="evidence"]')).toHaveText(/^(Emerging|Preliminary)$/);

  // Footer links.
  await expect(page.getByRole("link", { name: "Data and methods" })).toHaveAttribute(
    "href",
    "/genome/me/data",
  );
  await expect(page.getByRole("link", { name: "Ask about this" })).toHaveAttribute(
    "href",
    "/copilot/me?report=caffeine-metabolism-cyp1a2-rs762551",
  );
});

test("a not-covered report keeps the not-covered strings at full ink and every section populated", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto(APOE_REVEALED);

  await expect(page.locator(HEADING_SELECTOR)).toHaveText(HEADINGS);
  await expect(page.locator(SKELETON_H2)).toHaveCount(6);
  await expect(page.locator("main h1")).toHaveText("Alzheimer's disease");

  // The support panel renders with the result, after the skeleton, never
  // inside "How sure we are".
  await expect(page.getByTestId("support-panel")).toBeVisible();
  await expect(
    page.locator('[data-slot="report-skeleton"] [data-testid="support-panel"]'),
  ).toHaveCount(0);

  // Two variants: each block in "Your result" is labelled by its locus.
  await expect(
    page.locator('section[aria-labelledby="your-result"] [data-slot="variant-locus"]'),
  ).toHaveText(["APOE · rs429358", "APOE · rs7412"]);

  const notCovered = page.getByText(NOT_COVERED_VCF_FIRST_SENTENCE).first();
  const limit = page.getByText(LIMIT_OF_FILE).first();
  await expect(notCovered).toBeVisible();
  await expect(limit).toBeVisible();

  // Full visual weight: the same colour as body text (--ink), not muted.
  for (const locator of [notCovered, limit]) {
    const [colour, bodyColour] = await locator.evaluate((element) => [
      getComputedStyle(element).color,
      getComputedStyle(document.body).color,
    ]);
    expect(colour).toBe(bodyColour);
  }

  // No genotype, no percentile, no number for a position the file lacks.
  await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);

  // "What this doesn’t mean" and "How sure we are" are never empty: the
  // generic bullet plus the missing-result bullet when a position is not
  // covered.
  await expect(
    page.locator('section[aria-labelledby="what-this-doesnt-mean"] li'),
  ).toHaveText([DOESNT_MEAN_GENERIC, DOESNT_MEAN_NOT_COVERED]);
  const howSure = page.locator('section[aria-labelledby="how-sure-we-are"]');
  await expect(howSure).toContainText("2 cited sources");
  await expect(howSure).not.toContainText("supporting studies");
  await expect(howSure).toContainText(
    "Your file covered 0 of the 2 positions this estimate uses.",
  );
  await expect(page.getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC);
});

test("the reports list's estimate group renders its one layer definition, layer-labelled counts for both layers, the layer tabs and the eight estimate categories", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me/reports?layer=estimate");

  await expect(page.locator("main h1")).toHaveText("Reports");
  // All seeded estimates are single-locus, not unavailable polygenic scores.
  await expect(page.getByText(/of these reports cannot give you a number yet/)).toHaveCount(0);

  // The active group's definition sentence renders once, at the top of the
  // group; the other layer's definition does not render here.
  await expect(page.getByText(ESTIMATE_DEFINITION)).toHaveCount(1);
  await expect(page.getByText(VARIANT_CALL_DEFINITION)).toHaveCount(0);

  // The counts are layer-labelled and never merged (fixture auto-e2e-* slugs
  // are excluded from the library by isFixtureSlug): for each populated
  // layer, the covered count then the layer total, both carrying the layer's
  // own noun, whichever group is open.
  const seeded = seededTemplateCount("estimate");
  const count = page.locator(
    `[data-slot="count"][data-figure-class="estimate"][data-metric-value="${seeded}"]`,
  );
  await expect(count).toHaveText(`${seeded} statistical estimates`);
  const counts = page.locator('[data-slot="count"][data-figure-class="estimate"]');
  await expect(counts).toHaveCount(2);
  await expect(counts.first()).toHaveText(/^\d+ statistical estimates? covered by your file$/);
  const variantCounts = page.locator('[data-slot="count"][data-figure-class="variant-call"]');
  await expect(variantCounts).toHaveCount(2);
  await expect(variantCounts.first()).toHaveText(
    /^\d+ specific-variant reports? covered by your file$/,
  );
  await expect(variantCounts.nth(1)).toHaveText(
    `${seededTemplateCount("variant_call")} specific-variant reports`,
  );
  await expect(page.locator('[data-slot="count"]:not([data-figure-class])')).toHaveCount(0);
  await expect(page.getByText("Your file does not cover this variant.")).toHaveCount(0);

  // Two populated layers render the tabs, in layer order, with the open
  // group marked current and each linking its own query.
  const tabs = page.getByRole("navigation", { name: "Report groups" }).getByRole("link");
  await expect(tabs).toHaveText(["Specific variants", "Statistical estimates"]);
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(tabs.nth(0)).toHaveAttribute("href", "/genome/me/reports?layer=variant_call");
  await expect(tabs.nth(1)).toHaveAttribute("href", "/genome/me/reports?layer=estimate");

  // Category sections in taxonomy order. Medicines has no estimate, so it is
  // absent from this group and present in the Specific variants group;
  // nothing states an absence any more (ADR 0021).
  await expect(page.locator('h2[id$="-heading"]')).toHaveText(ESTIMATE_CATEGORY_HEADINGS);
  await expect(page.locator("#cancer")).toHaveCount(1);
  await expect(page.locator("#medicines")).toHaveCount(0);
  await expect(page.locator('[data-slot="category-absent"]')).toHaveCount(0);
  // Adjacent category sections keep the baseline's 96px gap at 1280.
  await expectBaselineSectionGaps(
    page,
    '[data-library-layer="estimate"] [data-density-top-level-section]',
    ESTIMATE_CATEGORY_HEADINGS.length,
  );

  // No percentile, no "Polygenic scores" section, no percent sign in any h2.
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
  await expect(page.getByText("Polygenic scores", { exact: true })).toHaveCount(0);
  const headings = await page.locator("h2").allTextContents();
  expect(headings.filter((text) => text.includes("%"))).toEqual([]);

  // The category strip is a collapsed "Filter reports" disclosure; the
  // labelled search box filters by title, gene or category client-side and
  // hides a category whose cards all filter out.
  const library = page.locator("[data-library-layer]");
  await expect(library.locator("details > summary")).toHaveText("Filter reports");
  await expect(library.locator("details > summary")).toBeVisible();
  const search = library.getByLabel("Search reports by title, gene, or category");
  await expect(search).toHaveAttribute("id", "report-search");
  await expect(search).toHaveAttribute("type", "search");
  await search.fill("cyp1a2");
  await expect(library.locator('a[href^="/genome/me/reports/"]')).toHaveCount(1);
  await expect(page.locator('h2[id$="-heading"]')).toHaveText(["Food, drink and metabolism"]);
  await search.fill("");
  await expect(page.locator('h2[id$="-heading"]')).toHaveText(ESTIMATE_CATEGORY_HEADINGS);
});

test("the reports list opens on the general library and its Specific variants tab shows Medicines like any other category, with no absence stated", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me/reports");

  // With no layer named the list opens on the general library (the estimate
  // group): its definition once, the other layer's not at all, its tab
  // marked current, and the tabs still in the taxonomy's layer order.
  await expect(page.getByText(ESTIMATE_DEFINITION)).toHaveCount(1);
  await expect(page.getByText(VARIANT_CALL_DEFINITION)).toHaveCount(0);
  const tabs = page.getByRole("navigation", { name: "Report groups" }).getByRole("link");
  await expect(tabs).toHaveText(["Specific variants", "Statistical estimates"]);
  await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#medicines")).toHaveCount(0);

  // The Specific variants tab opens its group: its definition once, the
  // other layer's not at all, and its tab marked current.
  await tabs.nth(0).click();
  await page.waitForURL(/\/genome\/me\/reports\?layer=variant_call$/);
  await expect(page.getByText(VARIANT_CALL_DEFINITION)).toHaveCount(1);
  await expect(page.getByText(ESTIMATE_DEFINITION)).toHaveCount(0);
  await expect(page.locator('[data-library-layer="variant-call"]')).toHaveCount(1);
  await expect(tabs.nth(0)).toHaveAttribute("aria-current", "page");

  // Medicines is the one category with a specific-variant report on the
  // seed: a section with the nine-category id and heading, its description
  // sentence, and no absence paragraph anywhere (ADR 0021).
  await expect(page.locator('h2[id$="-heading"]')).toHaveText(["Medicines"]);
  await expect(page.locator("#medicines")).toHaveCount(1);
  await expect(page.locator("#medicines-heading")).toHaveText("Medicines");
  await expect(page.locator("#medicines p").first()).toHaveText(MEDICINES_DESCRIPTION);
  await expect(page.locator('[data-slot="category-absent"]')).toHaveCount(0);
  await expect(page.getByText("Inherit does not offer reports about medicines.")).toHaveCount(0);

  // Across the two groups the nine categories render, in taxonomy order.
  expect([
    ...ESTIMATE_CATEGORY_HEADINGS.slice(0, 4),
    "Medicines",
    ...ESTIMATE_CATEGORY_HEADINGS.slice(4),
  ]).toEqual(NINE_CATEGORIES);

  // One row per shipped Medicines template, each linking its report by its
  // full title; the tiny VCF covers none of the eleven positions.
  const rows = page.locator('#medicines [data-card="variant-call"]');
  await expect(rows).toHaveCount(seededTemplateCount("variant_call"));
  expect(MEDICINES).toHaveLength(seededTemplateCount("variant_call"));
  for (const template of MEDICINES) {
    await expect(
      page.locator(`#medicines a[href="/genome/me/reports/${template.slug}"]`),
    ).toHaveText(template.title);
  }
  await expect(rows.locator('[data-coverage-status="not-covered"]')).toHaveCount(MEDICINES.length);

  // Nothing in the group is a phenotype, a response, a dose direction, a
  // §6.4 word, a frequency or an effect size.
  const groupText = await page.locator("#medicines").innerText();
  expect(groupText).not.toMatch(FORBIDDEN_IN_MEDICINES);
  expect(groupText).not.toMatch(/%/);
});

test("a covered Medicines report renders the variant-call genotype figure, the Medicines “What you can do” string and no estimate strings", async ({
  page,
}) => {
  // The committed fixture is byte-identical to what the generator builds
  // from the seed, and the real parser reads GRCh38 and one changed copy at
  // every Medicines position from it.
  const lines = buildMedicinesVcf();
  expect(fs.readFileSync(MEDICINES_FIXTURE, "utf8")).toBe(`${lines.join("\n")}\n`);
  const check = await verify(lines);
  expect(check.reasons).toEqual([]);
  expect(check.ok).toBe(true);

  await signIn(page, MEDICINES_USER.email, MEDICINES_USER.password);
  await ingestFileAs(page, MEDICINES_USER.email, MEDICINES_USER.password, MEDICINES_FIXTURE, "vcf");

  const vkorc1 = MEDICINES.find((template) => template.slug === VKORC1_SLUG)!;
  const [variant] = vkorc1.variants;
  await page.goto(`/genome/me/reports/${VKORC1_SLUG}`);

  await expect(page.locator(HEADING_SELECTOR)).toHaveText(HEADINGS);
  await expect(page.locator(SKELETON_H2)).toHaveCount(6);
  await expect(page.locator("main h1")).toHaveText(reportName(vkorc1.title));
  await expect(page.locator("main article header p").first()).toHaveText("Medicines");
  await expect(page.locator('[data-chip="layer"]')).toHaveText("Specific variants");
  await expect(page.getByText(VARIANT_CALL_DEFINITION)).toHaveCount(1);
  await expect(page.locator('[data-chip="evidence"]')).toHaveText("Emerging");
  // The evidence sentence beside the chip and under "How sure we are" is the
  // guideline sentence, never one about replication (ADR 0021).
  await expect(page.getByText(VARIANT_CALL_EVIDENCE, { exact: false })).toHaveCount(2);
  await expect(page.getByText("Seen in more than one study")).toHaveCount(0);

  // Exactly one claim block, attributed to the subject and named by its
  // locus, carrying one observed genotype figure of class variant-call that
  // reads the fixture's one changed copy as the sorted pair of letters.
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);
  await expect(
    page.locator(
      `[data-claim-block][aria-label="${variant.gene} rs${variant.rsid}"][data-density-primary-claim="true"]`,
    ),
  ).toHaveCount(1);
  const genotype = page.locator(
    '[data-figure-kind="genotype"][data-figure-class="variant-call"][data-figure-basis="observed"][data-provenance^="computed:"]',
  );
  await expect(genotype).toHaveCount(1);
  await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText(hetLetters(variant));
  await expect(page.locator('[data-figure-class="estimate"]')).toHaveCount(0);
  // The reading beside the letters is the seed's own sentence for that genotype.
  await expect(page.locator('section[aria-labelledby="your-result"]')).toContainText(
    variant.interpretations[hetKey(variant)],
  );

  // No estimate strings on a variant call: no partial-state sentence, no
  // coverage sentence, no percentile; the citation count reads as usual.
  await expect(page.getByText(NO_RANGE_YET)).toHaveCount(0);
  const howSure = page.locator('section[aria-labelledby="how-sure-we-are"]');
  await expect(howSure).not.toContainText("positions this estimate uses");
  await expect(howSure).toContainText("1 cited source");
  await expect(howSure).not.toContainText("supporting study");
  await expect(howSure.locator('[data-call-state="interpreted"]')).toContainText("1");
  await expect(page.locator('[data-slot="report-method"]')).toContainText("It does not work out how a medicine will affect you.");
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);

  // "What this is" is the summary; "What you can do" is the Medicines string
  // and never brief line 630's; the generic bullet and the not-diagnostic
  // line are unchanged.
  await expect(page.locator('[data-slot="report-summary"]')).toHaveText(vkorc1.summary);
  await expect(page.locator('section[aria-labelledby="what-you-can-do"] p')).toHaveText(
    WHAT_YOU_CAN_DO_MEDICINES,
  );
  await expect(page.getByText(NOTHING_TO_DO)).toHaveCount(0);
  await expect(
    page.locator('section[aria-labelledby="what-this-doesnt-mean"] li'),
  ).toHaveText([DOESNT_MEAN_GENERIC]);
  await expect(page.getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC);

  // Sources: the verified guideline by its PMID, the dbSNP record and the
  // GRCh38 locus with the reference and CPIC alternate letters.
  const whereFrom = page.locator('section[aria-labelledby="where-this-comes-from"]');
  const [citation] = vkorc1.citations;
  await expect(
    whereFrom.getByRole("link", { name: `${citation.label} (PMID ${citation.pmid})` }),
  ).toHaveAttribute("href", `https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`);
  await expect(whereFrom.getByRole("link", { name: `rs${variant.rsid}` })).toHaveAttribute(
    "href",
    `https://www.ncbi.nlm.nih.gov/snp/rs${variant.rsid}`,
  );
  await expect(whereFrom).toContainText(
    `${variant.gene} · rs${variant.rsid} · chr${variant.chrom}:${variant.pos38} ${variant.ref}→${variant.alt}`,
  );

  // Nothing on the page is a phenotype, a response, a dose direction, a
  // §6.4 word, a frequency or an effect size.
  const article = await page.locator("main article").innerText();
  expect(article).not.toMatch(FORBIDDEN_IN_MEDICINES);
  expect(article).not.toMatch(/%/);
});

test("every Medicines report carries the Medicines “What you can do” string and no forbidden word, and DPYD leads with its sentence", async ({
  page,
}) => {
  await signIn(page, MEDICINES_USER.email, MEDICINES_USER.password);

  for (const template of MEDICINES) {
    const [variant] = template.variants;
    await page.goto(`/genome/me/reports/${template.slug}`);
    await expect(page.locator("main h1")).toHaveText(reportName(template.title));
    await expect(page.locator("main article header p").first()).toHaveText("Medicines");
    await expect(page.locator('section[aria-labelledby="what-you-can-do"] p')).toHaveText(
      WHAT_YOU_CAN_DO_MEDICINES,
    );
    const genotype = page.locator(
      '[data-figure-kind="genotype"][data-figure-class="variant-call"][data-figure-basis="observed"]',
    );
    await expect(genotype).toHaveCount(1);
    await expect(genotype.locator('[data-slot="figure-value"]')).toHaveText(hetLetters(variant));
    await expect(page.getByText(NO_RANGE_YET)).toHaveCount(0);
    const article = await page.locator("main article").innerText();
    expect(article, template.slug).not.toMatch(FORBIDDEN_IN_MEDICINES);
    expect(article, template.slug).not.toMatch(/%/);
  }

  // DPYD: the first sentence a reader meets, in "What this is", is the
  // research note's fact for the highest-harm case, character-exact.
  const dpyd = MEDICINES.find((template) => template.slug === DPYD_SLUG)!;
  expect(dpyd.summary.startsWith(DPYD_SENTENCE)).toBe(true);
  await page.goto(`/genome/me/reports/${DPYD_SLUG}`);
  const whatThisIs = page.locator('[data-slot="report-summary"]');
  await expect(whatThisIs).toHaveText(dpyd.summary);
  await expect(whatThisIs).toContainText(DPYD_SENTENCE);
  expect((await whatThisIs.innerText()).startsWith(DPYD_SENTENCE)).toBe(true);
});

test("the hub is titled My Genome with three tiles and one primary button", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me");

  await expect(page.locator("main h1")).toHaveText("My Genome");
  await expect(page.locator("main article h2")).toHaveText(["Reports", "Ancestry", "Copilot"]);
  await expect(
    page.locator('main [data-slot="button"][data-variant="default"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('main [data-slot="button"][data-variant="default"]'),
  ).toHaveText("Add a file");
});
