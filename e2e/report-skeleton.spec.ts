import { expect, test } from "@playwright/test";
import path from "node:path";
import { createConfirmedUser, ingestFileAs, seededTemplateCount, signIn } from "./helpers";

// Report skeleton and figure contract (brief X4, X5, X13) on the My Genome
// surfaces, against the tiny GRCh38 VCF fixture (rs762551 het → A/C; APOE
// positions absent → not covered).
//
// Pins: the six fixed h2s in order; one attributed claim block carrying one
// observed genotype figure; the exact partial-state sentence and no
// percentile anywhere; the exact not-diagnostic line; breadcrumb, subject
// bar and chip row; footer links; the not-covered strings at full ink; the
// list page's single layer definition, layer-labelled count, nine-category
// order (Medicines absent), and the hub's three tiles and single primary.

const USER = { email: "skeleton-user@e2e.local", password: "e2e-skeleton-pw" };

const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const APOE_REVEALED = "/genome/me/reports/apoe-e4-alzheimers-risk?reveal=1";

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
  "A model that adds up small effects. It is an estimate, not a reading. Scientists call these polygenic scores.";

const CATEGORY_HEADINGS_ON_SEED = [
  "Everyday traits",
  "Food, drink and metabolism",
  "Heart and circulation",
  "Immune system and allergies",
  "Brain, memory and mood",
  "Cancer",
  "Having children",
  "Ageing and longevity",
];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

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

  // The six fixed h2s, in DOM order, with their fixed ids.
  await expect(page.locator(HEADING_SELECTOR)).toHaveText(HEADINGS);

  // Exactly one claim block, attributed to the subject.
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);

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

  // Breadcrumb "My Genome / {name} / Reports / {report}" with the full name.
  const name = (await page.locator('[data-slot="subject-name"]').textContent())?.trim();
  expect(name).toBeTruthy();
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText(`My Genome / ${name} / Reports / `);
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

  // "What this doesn’t mean" and "How sure we are" are never empty.
  await expect(
    page.locator('section[aria-labelledby="what-this-doesnt-mean"] li'),
  ).toHaveCount(2);
  const howSure = page.locator('section[aria-labelledby="how-sure-we-are"]');
  await expect(howSure).toContainText("2 supporting studies");
  await expect(howSure).toContainText(
    "Your file covered 0 of the 2 positions this estimate uses.",
  );
  await expect(page.getByTestId("report-disclaimer")).toHaveText(NOT_DIAGNOSTIC);
});

test("the reports list renders one layer definition, a layer-labelled count and the nine-category order", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.goto("/genome/me/reports");

  await expect(page.locator("main h1")).toHaveText("Reports");

  // The definition sentence renders once, at the top of the group.
  await expect(page.getByText(ESTIMATE_DEFINITION)).toHaveCount(1);

  // The count is layer-labelled and never merged (fixture auto-e2e-* slugs
  // are excluded from the library by isFixtureSlug).
  const seeded = seededTemplateCount();
  const count = page.locator(
    `[data-slot="count"][data-figure-class="estimate"][data-metric-value="${seeded}"]`,
  );
  await expect(count).toHaveText(`${seeded} statistical estimates`);
  await expect(page.locator('[data-slot="count"]:not([data-figure-class])')).toHaveCount(0);

  // Category sections in taxonomy order; Medicines absent while empty.
  await expect(page.locator('h2[id$="-heading"]')).toHaveText(CATEGORY_HEADINGS_ON_SEED);
  await expect(page.locator("#cancer")).toHaveCount(1);
  await expect(page.locator("#medicines")).toHaveCount(0);

  // No percentile, no "Polygenic scores" section, no percent sign in any h2.
  await expect(page.locator('[data-figure-kind="percentile"]')).toHaveCount(0);
  await expect(page.getByText("Polygenic scores", { exact: true })).toHaveCount(0);
  const headings = await page.locator("h2").allTextContents();
  expect(headings.filter((text) => text.includes("%"))).toEqual([]);
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
