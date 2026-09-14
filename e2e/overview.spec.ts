import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  createConfirmedUser,
  firstViewportInteractives,
  seededTemplateCount,
  signIn,
} from "./helpers";
import { uploadOwnFilePrepared, uploadOwnFileWithChosenReports } from "./own-report-helpers";

// Overview (`/overview`) — brief §2 §3 and X9: one h1 and three domain h2s
// (four headings, never more), nine entry boxes whose accessible names are
// exactly their labels, exactly one primary button per state, counts that
// always carry a unit noun and a short note, no dash placeholders, no
// figures, and the X6.1 interactive-element budget in the first viewport at
// 1280×800 and 390×844 (≤7 empty, ≤12 populated). The phone navigation is a
// fixed 64px bottom bar with five labelled, 44px-tall items.

const USER = { email: `overview-${randomUUID()}@e2e.local`, password: "e2e-overview-pw" };

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

test.afterEach(async ({ page }, info) => {
  if (info.status !== "passed") return;
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: info.outputPath(`overview-${viewport.name}.png`), fullPage: true });
  }
});

const HEADINGS = ["Overview", "My Genome", "Family", "Embryos"];

const BOX_LABELS = [
  "Reports",
  "Ancestry",
  "Copilot",
  "Individual risks",
  "Portrait",
  "Copilot",
  "Upload",
  "Compare your embryos",
  "Copilot",
];

const STATE_A_LEDE =
  "Inherit is free to use and sells nothing. Sequencing, if you need it, is bought from a provider directly.";
const VARIANT_CALL_DEFINITION =
  "A result about one or a few exact spots in your DNA, read against an outside clinical classification.";
const ESTIMATE_DEFINITION =
  "Links between DNA and traits found in studies. Some reports use one spot; polygenic scores combine many. Neither says what will happen to you.";
const NOT_DIAGNOSTIC =
  "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.";
const ANCESTRY_TOO_FEW =
  "Ancestry: your file covers too few markers to estimate regions.";

// Canonical observed calls preserve rs671 G/G, so the ALDH2 flush report
// joins both ACTN3 reports, caffeine and lactase in the deterministic five-item
// starter. Reference observations count as evidence; the cap and exclusions
// still apply. Ordered by category rank, then slug.
const STARTER_LINE =
  "Five reports to read first. They’re the clearest ones your file supports.";
const STARTER_SLUGS = [
  "muscle-composition-actn3-rs1815739",
  "sprint-power-actn3",
  "alcohol-flush-aldh2-rs671",
  "caffeine-metabolism-cyp1a2-rs762551",
  "lactase-persistence-lct-rs4988235",
];

async function expectNoFiguresOrDashes(page: Page) {
  await expect(page.locator("[data-figure-kind]")).toHaveCount(0);
  const values = await page.locator("[data-metric-value]").allTextContents();
  for (const value of values) {
    expect(value.trim()).not.toBe("");
    expect(value.trim()).not.toMatch(/^(?:[-–—]|N\/A)$/);
    // The five-item starter wording spells Five; other counts use numerals.
    expect(value.trim()).toMatch(/(?:\d+|Five) \S+/);
  }
  const notes = page.locator("[data-metric-value] + [data-metric-note]");
  // X9.1's short metric note belongs to domain tiles. The newly classified
  // starter count instead retains §7.2's exact full sentence and layer link.
  const domainValues = page.locator("#my-genome [data-metric-value], #family [data-metric-value], #embryos [data-metric-value]");
  expect(await notes.count()).toBe(await domainValues.count());
  for (const note of await notes.allTextContents()) {
    const words = note.trim().split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(1);
    expect(words).toBeLessThanOrEqual(12);
  }
}

async function expectNineBoxes(page: Page) {
  const boxes = page.locator("[data-overview-box] a[href]");
  await expect(boxes).toHaveCount(9);
  for (let i = 0; i < BOX_LABELS.length; i++) {
    await expect(boxes.nth(i)).toHaveAccessibleName(BOX_LABELS[i]);
  }
  // Every box is one link containing one label and one description line.
  for (let i = 0; i < 9; i++) {
    await expect(page.locator("[data-overview-box]").nth(i).locator("a[href]")).toHaveCount(1);
    await expect(boxes.nth(i)).toContainText(BOX_LABELS[i]);
    const description = (await boxes.nth(i).innerText())
      .replace(BOX_LABELS[i], "")
      .trim();
    expect(description.length).toBeGreaterThan(0);
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(12);
  }
  // Never a dead link: every box target renders (no redirect, no 404).
  const hrefs = new Set(await boxes.evaluateAll((links) => links.map((a) => a.getAttribute("href")!)));
  for (const href of hrefs) {
    const res = await page.request.get(href, { maxRedirects: 0 });
    expect(res.status(), `${href} answered ${res.status()}`).toBe(200);
  }
}

async function expectExactlyOnePrimary(page: Page, name: string, href: string) {
  // Scoped to main: the persistent chrome (theme toggle, sign out) is outside it.
  const primary = page.locator('main [data-variant="default"]');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAccessibleName(name);
  await expect(primary).toHaveAttribute("href", href);
}

test.describe.configure({ mode: "serial" });

/** Kept so the empty-state test can name the account whose files it counts. */
let accountId = "";

test.beforeAll(async () => {
  accountId = await createConfirmedUser(USER.email, USER.password);
});

/**
 * `/overview awaiting-choice`, the ninth state id and the only route that can
 * occupy it (register `stateDefinitions.awaiting-choice`, added 2026-09-14).
 *
 * THE SHAPE WAS UNNAMED, NOT MIS-NAMED, which is why the answer was a new id
 * rather than a correction. `needsReportChoice` in `overview/page.tsx` renders
 * when a file is prepared and neither a report nor an ancestry result exists:
 * every reader who uploads passes through it, and the ratchet had no name to
 * count it under. Folding it into `empty` would have been the cheaper move and
 * would have been false — an empty page has nothing to show AND no step this
 * reader can take, and this page has a prepared file and exactly one step.
 *
 * The account is its own rather than the shared one above, because the state
 * sits between that account's `empty` and `partial-coverage` and a serial file
 * would have to be uploaded and then left unused by the test that follows.
 *
 * What separates it from `empty` is asserted from BOTH sides, the way the
 * empty test establishes its own cause from the database: a prepared file
 * exists, and the Start-here strip that belongs to `empty` is absent.
 */
test("/overview awaiting-choice: a prepared file with nothing chosen shows the one step it names, and not the empty state's strip", async ({
  page,
}) => {
  const email = `overview-awaiting-${randomUUID()}@e2e.local`;
  const password = "e2e-overview-awaiting-pw";
  const ownAccountId = await createConfirmedUser(email, password);
  await signIn(page, email, password);
  await uploadOwnFilePrepared(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), {
    fileType: "vcf",
  });

  // The cause, from the database rather than from the rendered page: a file
  // that finished preparation and no report or ancestry result at all. Without
  // it these assertions would pass for an account still processing.
  const admin = adminClient();
  const { data: files, error } = await admin
    .from("genome_files")
    .select("id, single_logical_sample_verified_at")
    .eq("user_id", ownAccountId);
  expect(error).toBeNull();
  expect(files, "one file").toHaveLength(1);
  expect(files?.[0].single_logical_sample_verified_at, "prepared, not in flight").not.toBeNull();

  await page.goto("/overview");

  // The one step, named and linked, and nothing else offered.
  const prepared = page.locator('section[aria-labelledby="prepared-reports-title"]');
  await expect(prepared.locator("#prepared-reports-title")).toHaveText("Choose your reports");
  await expect(prepared).toContainText(
    "Your file is prepared. Choose report types and generate your results.",
  );
  await expectExactlyOnePrimary(page, "Choose reports", "/genome/me/reports");

  // Not `empty`: the strip and the lede that belong to State A are gone.
  await expect(page.getByText("Start here", { exact: true })).toHaveCount(0);
  await expect(page.getByText(STATE_A_LEDE, { exact: true })).toHaveCount(0);

  // Not `complete` and not `partial-coverage`: nothing has been generated, so
  // the page carries no count and no figure of any kind.
  await expect(page.locator("[data-metric-value]")).toHaveCount(0);
  await expectNoFiguresOrDashes(page);
  await expect(page.locator('section[aria-labelledby="starter-title"]')).toHaveCount(0);

  // The page is still the hub it always is.
  await expect(page.getByRole("heading")).toHaveText(HEADINGS);
  await expectNineBoxes(page);
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();
});

/**
 * RETITLED 2026-09-12, not rewritten. Every assertion below already proved
 * `/overview empty`; the title simply did not name the pair, so the route
 * gate could not count it. That is the `/family/[person] empty` case again —
 * a state implemented and never titled — and NOT the `/settings/people` case,
 * where a title certified a render the route could not produce. State A is
 * exactly what `empty` means in this register: the page works and there is no
 * content for it yet.
 *
 * ONE ASSERTION IS NEW, and it is what makes the title safe. `empty` and
 * `not-covered` render alike here — no figures, no numbers — and they mean
 * opposite things: nothing uploaded, versus a file that covered nothing. So
 * the test now establishes the cause from the database rather than inferring
 * it from the absence: this account has no file at all.
 */
test("/overview empty: State A shows the Start-here strip, four headings, nine box links, one primary button and no number at all", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);

  // The reason this page is empty, stated rather than assumed. Without it the
  // assertions below would pass just as well for an account whose file was
  // prepared and covered nothing, which is a different state with a different
  // sentence owed to the reader.
  const { data: files, error } = await adminClient()
    .from("genome_files").select("id").eq("user_id", accountId);
  expect(error).toBeNull();
  expect(files, "State A because nothing was uploaded, not because nothing was covered").toEqual([]);

  await page.goto("/overview");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  await expect(page.getByRole("heading")).toHaveText(HEADINGS);
  await expect(page.getByText(STATE_A_LEDE, { exact: true })).toBeVisible();
  await expect(page.getByText("Start here", { exact: true })).toBeVisible();
  // The strip's items are links; the third (/example/report) waits for its route.
  await expect(page.getByRole("link", { name: "I don’t have one yet" })).toHaveAttribute(
    "href",
    "/providers",
  );
  await expect(page.locator('a[href="/example/report"]')).toHaveCount(0);

  await expectExactlyOnePrimary(page, "I have a DNA file", "/files/upload");
  await expectNineBoxes(page);
  await expectNoFiguresOrDashes(page);
  await expect(page.locator("[data-metric-value]")).toHaveCount(0);
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();
  await expect(page.locator("[data-density-primary-content]")).toHaveCount(1);
  await expect(page.locator("[data-density-top-level-section]")).toHaveCount(4);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const interactives = await firstViewportInteractives(page);
    expect(
      interactives.length,
      `${viewport.name}: ${interactives.join(" | ")}`,
    ).toBeLessThanOrEqual(7);
    // Every primary target is at least 44px tall.
    const primaryBox = await page.locator('main [data-variant="default"]').boundingBox();
    expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // At 1280×800 the strip and the first domain section open in the first
  // viewport; the Family section starts below it, and adjacent top-level
  // sections keep a ≥96px gap.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  const myGenomeHeading = await page.getByRole("heading", { name: "My Genome" }).boundingBox();
  expect(myGenomeHeading?.y ?? Infinity).toBeLessThan(800);
  const familyHeading = await page.getByRole("heading", { name: "Family" }).boundingBox();
  expect(familyHeading?.y ?? 0).toBeGreaterThanOrEqual(800);
  const sections = page.locator("[data-density-top-level-section]");
  const rects = [] as { y: number; height: number }[];
  for (let i = 0; i < (await sections.count()); i++) {
    const rect = await sections.nth(i).boundingBox();
    expect(rect).not.toBeNull();
    rects.push({ y: rect!.y, height: rect!.height });
  }
  for (let i = 1; i < rects.length; i++) {
    const gap = rects[i].y - (rects[i - 1].y + rects[i - 1].height);
    expect(gap, `gap between top-level sections ${i - 1} and ${i}`).toBeGreaterThanOrEqual(95.5);
  }
});

test("phone navigation: a fixed 64px bottom bar with five labelled 44px items and aria-current", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/overview");

  const navs = page.locator('nav[aria-label="App"]').filter({ visible: true });
  await expect(navs).toHaveCount(1);
  const nav = navs.first();
  const links = nav.getByRole("link");
  await expect(links).toHaveText(["Overview", "My Genome", "Family", "Embryos", "Settings"]);
  await expect(links.filter({ hasText: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator("button, [aria-expanded]")).toHaveCount(0);

  const navBox = await nav.boundingBox();
  expect(navBox?.height ?? 0).toBeGreaterThanOrEqual(64);
  expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBeLessThanOrEqual(844);
  for (let i = 0; i < 5; i++) {
    const link = links.nth(i);
    const box = await link.boundingBox();
    expect(box?.height ?? 0, `item ${i} height`).toBeGreaterThanOrEqual(44);
    const fontSize = await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(13);
  }
  // The active item is marked by weight as well as by ground and aria-current.
  const activeWeight = await links
    .filter({ hasText: "Overview" })
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  const idleWeight = await links
    .filter({ hasText: "Settings" })
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  expect(activeWeight).toBeGreaterThan(idleWeight);

  // The bar never hides page content: the last content block ends above it.
  const notDiagnostic = page.getByText(NOT_DIAGNOSTIC, { exact: true });
  await notDiagnostic.scrollIntoViewIfNeeded();
  const textBox = await notDiagnostic.boundingBox();
  expect((textBox?.y ?? 0) + (textBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0);
});

/**
 * `/overview partial-coverage`. The hub is not "the page with a file on it";
 * it is the page that has to say, in one view, what this file supports and
 * what it does not. This test already asserted both halves before it was
 * named: the two count lines are real and populated, and the ancestry line
 * reads the exact sentence "your file covers too few markers to estimate
 * regions" - no figure, no hedge, no number standing in for the estimate
 * that was not computed. `expectNoFiguresOrDashes` holds the second half
 * shut, since a dash or an empty metric would be the reassurance this state
 * exists to forbid.
 *
 * Not `complete`, and the distinction is the point: a hub that showed the
 * report counts and simply omitted the ancestry line would look finished and
 * would be lying by omission. Not `not-covered` either, because the reports
 * layer is genuinely covered and linked. Partial coverage is the state where
 * a file answers some questions and not others, and the product's job is to
 * be legible about which is which.
 */
test("/overview partial-coverage — State C: after one prepared file, the split count with its note, the too-few-markers ancestry line, the starter list, one primary button and the populated budget", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  await uploadOwnFileWithChosenReports(page,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.monogenic", "reports.polygenic", "ancestry"] });

  await page.goto("/overview");
  await expect(page.getByRole("heading")).toHaveText(HEADINGS);
  await expect(page.getByText("Start here", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Just you so far.", { exact: true })).toBeVisible();
  await expect(page.getByText("No embryo files added.", { exact: true })).toBeVisible();

  // The split string: one count line per populated layer on the seed — the
  // estimate half and, since ADR 0021, the specific-variant half — each with
  // its 1–12-word note and its definition sentence adjacent, never summed.
  const metricValues = page.locator("[data-metric-value]");
  const countLine = metricValues.first();
  await expect(countLine).toHaveText(`${seededTemplateCount("estimate")} statistical estimates`);
  await expect(countLine).toHaveText(/^\d+ statistical estimates$/);
  const variantCallLine = metricValues.nth(1);
  await expect(variantCallLine).toHaveText(
    `${seededTemplateCount("variant_call")} specific-variant reports`,
  );
  await expect(page.getByText(/specific-variant reports?$/)).toHaveCount(1);
  await expect(page.getByText("What studies found about DNA and traits.", { exact: true })).toBeVisible();
  await expect(page.getByText("Results read from one spot in your DNA.", { exact: true })).toBeVisible();
  // The full definition of each layer is one keyboard-operable disclosure
  // away, the pattern `/genome/[subject]/reports` already uses for these same
  // two sentences. Opened by focusing the summary and pressing Enter rather
  // than by clicking or by setting `open`, so this still proves the sentence
  // is REACHABLE and not merely present in the DOM — which is the claim the
  // earlier `toBeVisible()` made and which must not weaken.
  for (const [line, definition] of [
    [countLine, ESTIMATE_DEFINITION],
    [variantCallLine, VARIANT_CALL_DEFINITION],
  ] as const) {
    const summary = line.locator("xpath=ancestor::summary[1]");
    await expect(summary, "the count line is the disclosure's summary").toHaveCount(1);
    await expect(page.getByText(definition, { exact: true }), "closed before it is opened").toBeHidden();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(definition, { exact: true })).toBeVisible();
  }
  // The tiny VCF retains one observed reference call among 168 ancestry markers.
  await expect(page.getByText(ANCESTRY_TOO_FEW, { exact: true })).toBeVisible();

  await expectExactlyOnePrimary(page, "Open my reports", "/genome/me/reports");
  await expectNineBoxes(page);
  await expectNoFiguresOrDashes(page);

  const starter = page.locator('section[aria-labelledby="starter-title"]');
  await expect(starter.locator("#starter-title")).toHaveText(STARTER_LINE);
  const starterLinks = starter.locator("ol").getByRole("link");
  await expect(starter.getByRole("link", { name: "Statistical estimates", exact: true }))
    .toHaveAttribute("href", "#overview-estimate-definition");
  await expect(starterLinks).toHaveCount(STARTER_SLUGS.length);
  for (let i = 0; i < STARTER_SLUGS.length; i++) {
    await expect(starterLinks.nth(i)).toHaveAttribute(
      "href",
      `/genome/me/reports/${STARTER_SLUGS[i]}`,
    );
  }
  await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeAttached();

  // Own supported findings follow their definitions and precede unused domains
  // in both reading order and the desktop/phone layout.
  const sections = page.locator("[data-density-top-level-section]");
  await expect(sections).toHaveCount(4);
  expect(await sections.evaluateAll((items) => items.map((item) =>
    item.id || item.getAttribute("aria-labelledby"),
  ))).toEqual(["my-genome", "starter-title", "family", "embryos"]);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => document.fonts.ready);
    const rects = await sections.evaluateAll((items) => items.map((item) => {
      const { top, bottom } = item.getBoundingClientRect();
      return { top, bottom };
    }));
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].top, `${viewport.name}: section ${i} follows section ${i - 1}`)
        .toBeGreaterThanOrEqual(rects[i - 1].bottom);
    }
    const interactives = await firstViewportInteractives(page);
    expect(interactives.length, `${viewport.name}: ${interactives.join(" | ")}`).toBeLessThanOrEqual(12);
  }
});
