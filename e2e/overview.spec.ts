import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  createConfirmedUser,
  firstViewportInteractives,
  ingestFileAs,
  seededTemplateCount,
  signIn,
} from "./helpers";

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

// The tiny fixture covers exactly four starter-eligible reports (all
// `emerging`, single-locus, outside brain/mood and cancer): rs1815739 het
// resolves the two ACTN3 templates (everyday traits), rs762551 het the
// caffeine template and rs4988235 hom-alt the lactase template (food, drink
// and metabolism); rs671 is hom-ref, dropped at parse, so both ALDH2
// templates stay uncovered. Ordered by category rank, then slug.
const STARTER_LINE =
  "4 reports to read first. They’re the clearest ones your file supports.";
const STARTER_SLUGS = [
  "muscle-composition-actn3-rs1815739",
  "sprint-power-actn3",
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

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("State A: four headings, the Start-here strip, nine box links, one primary button and the empty-hub budget", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
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

test("State C: after one processed file — split count with note, ancestry line, starter list, one primary button and the populated budget", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  const fileId = await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );
  // The process route answers once the file is annotated; confirm the row
  // rather than trusting the response shape.
  const admin = adminClient();
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("genome_files")
          .select("status")
          .eq("id", fileId)
          .single();
        return (data as { status: string } | null)?.status;
      },
      { timeout: 60_000 },
    )
    .toBe("annotated");

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
  await expect(page.getByText(ESTIMATE_DEFINITION, { exact: true })).toBeVisible();
  await expect(page.getByText(VARIANT_CALL_DEFINITION, { exact: true })).toBeVisible();
  // The tiny VCF covers 0 of the 168 ancestry markers.
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
