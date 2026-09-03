import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";

// Ancestry surface (`/genome/[subject]/ancestry`; brief §4.6, A.8, G4.4,
// X16.5; acceptance 30–34) over the REAL processing route and the local
// Supabase stack, on two users:
//
// - the tiny GRCh38 fixture covers none of the marker panel, so the page
//   renders the grey state: the exact mandated sentence with the counts,
//   no chips, no toggle, no visible percent sign outside the disclosure,
//   the lineage empty states, `#neanderthal`, no `archaic-hominin`, and
//   zero serious or critical axe violations in both themes;
// - the synthetic 168-marker fixture (`e2e/fixtures/aims-mixed-grch38.vcf`,
//   describing no real person) renders the shown state: the figure-unit
//   contract on every ancestry share and no other percent text node, the
//   sum rule in both toggle states with both chips present, the toggle
//   changing the visible rows and paths, Tab order equal to descending
//   share, the click panel's open/close/focus contract, the label denylist,
//   the gradient feather contract, the first-viewport interactive budget at
//   1280×800, and first-party origins only with no request to `/geo/`.
//
// Nothing numeric is retyped: the panel size comes from `data/ref/aims.json`
// and the forbidden words from `data/ref/regions/label-denylist.json`.

const GREY_USER = { email: "ancestry-grey@e2e.local", password: "e2e-ancestry-grey-pw" };
const SHOWN_USER = { email: "ancestry-shown@e2e.local", password: "e2e-ancestry-shown-pw" };

const ANCESTRY = "/genome/me/ancestry";
const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";
const MIXED_FIXTURE = "e2e/fixtures/aims-mixed-grch38.vcf";

/** The shipped marker panel's size, read from the panel file. */
const PANEL_SIZE = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/ref/aims.json"), "utf8")) as unknown[]
).length;

/** The public label denylist: demonyms and ethnonyms, whole-word, case-insensitive, after NFKD fold. */
const DENYLIST = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/ref/regions/label-denylist.json"), "utf8"),
) as { words: string[] };

const GREY_SENTENCE = `Your file covers only 0 of ${PANEL_SIZE} ancestry markers — too few to draw a map. This is a limit of the file, not a result about you.`;
const RAW_NUMBERS_SUMMARY = "Show the unreliable raw numbers anyway";
const TOGGLE_LABEL = "Show only what’s well supported";
const CHIP_UNASSIGNABLE = "Not assignable to any region:";
const CHIP_HIDDEN = "Hidden as not well supported:";
const NO_RANGE_YET = "no range yet";
const NO_Y_LEAD =
  "Your file has no Y-chromosome data, so no father’s line can be read from it. This says nothing about who your father was.";
const CLOSE = "Close";

const SHARE_VALUE = /^\d+\.\d%$/;
const RANGE_UNIT = /^\(\d+\.\d–\d+\.\d%\)$/;
const PERCENT_TEXT = /\d+(\.\d+)?%/;
/** Fill opacity ∝ the lower bound; the feather is at least this share of the bbox width (X16.5). */
const MIN_FEATHER = 0.15;

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3100", // the app itself
  "http://127.0.0.1:54321", // this deployment's own Supabase API
]);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(GREY_USER.email, GREY_USER.password);
  await createConfirmedUser(SHOWN_USER.email, SHOWN_USER.password);
});

/** Upload and process a fixture, then wait for the row to be annotated (the pattern of overview.spec.ts). */
async function ingestAndWait(page: Page, user: { email: string; password: string }, fixture: string) {
  const fileId = await ingestFileAs(page, user.email, user.password, path.join(process.cwd(), fixture), "vcf");
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
  return fileId;
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function deniedWordIn(label: string): string | null {
  const folded = fold(label);
  for (const word of DENYLIST.words) {
    const escaped = fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(folded)) return word;
  }
  return null;
}

/**
 * X6.1 basis, identical to scripts/density-baseline/capture.mjs and
 * e2e/overview.spec.ts: rendered interactive elements whose top edge is
 * inside the first viewport, excluding persistent navigation (anything
 * inside a `nav`), the skip link and the Copilot entry control.
 */
async function firstViewportInteractives(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.matches('a[href="#main"]')) continue;
      if (element.closest("nav,[data-copilot-entry]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element.getClientRects().length === 0) continue;
      if (rect.top >= window.innerHeight) continue;
      found.push(`${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 40)}`);
    }
    return found;
  });
}

/**
 * Text nodes whose text contains a percent sign. `visibleOnly` skips nodes
 * with no rendered box (a closed `details`, a `hidden` row); `outside` skips
 * nodes inside elements matching that selector.
 */
async function percentTextNodes(page: Page, options: { visibleOnly: boolean; outside: string }): Promise<string[]> {
  return page.evaluate(({ visibleOnly, outside, pattern }) => {
    const percent = new RegExp(pattern);
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textContent = node.textContent ?? "";
      if (!percent.test(textContent)) continue;
      const element = node.parentElement;
      if (!element) continue;
      // Script and style text is not rendered; the RSC payload carries the
      // accessible names, which contain a percent sign.
      if (element.closest("script, style, noscript, template")) continue;
      if (element.closest(outside)) continue;
      if (visibleOnly && (element.getClientRects().length === 0 || getComputedStyle(element).visibility === "hidden")) continue;
      found.push(textContent.trim());
    }
    return found;
  }, { ...options, pattern: PERCENT_TEXT.source });
}

async function shareValues(locator: Locator): Promise<number[]> {
  const texts = await locator.allTextContents();
  return texts.map((raw) => {
    const value = raw.trim();
    expect(value).toMatch(SHARE_VALUE);
    return Number(value.slice(0, -1));
  });
}

/** shown + unassignable + hidden = 100.0 ± 0.1 on the values the page prints. */
async function expectSumRule(page: Page) {
  const chips = page.locator('[data-slot="ancestry-chip"]');
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: CHIP_UNASSIGNABLE })).toHaveCount(1);
  await expect(chips.filter({ hasText: CHIP_HIDDEN })).toHaveCount(1);
  const rows = await shareValues(page.locator('[data-slot="region-row"]:not([hidden]) [data-slot="figure-value"]'));
  const chipValues = await shareValues(chips.locator('[data-slot="figure-value"]'));
  expect(chipValues).toHaveLength(2);
  const total = [...rows, ...chipValues].reduce((sum, value) => sum + value, 0);
  expect(Math.abs(total - 100), `rows ${rows.join("+")} + chips ${chipValues.join("+")} = ${total}`).toBeLessThanOrEqual(0.1);
}

/** A viewport point inside the path's fill, found by sampling its bbox with `isPointInFill`. */
async function interiorPoint(path: Locator): Promise<{ x: number; y: number }> {
  await path.scrollIntoViewIfNeeded();
  return path.evaluate((element) => {
    const shape = element as SVGPathElement;
    const box = shape.getBBox();
    const ctm = shape.getScreenCTM();
    if (!ctm) throw new Error("path has no screen CTM");
    for (let step = 4; step <= 128; step *= 2) {
      for (let i = 1; i < step; i++) {
        for (let j = 1; j < step; j++) {
          const point = new DOMPoint(box.x + (box.width * i) / step, box.y + (box.height * j) / step);
          if (!shape.isPointInFill(point)) continue;
          const screen = point.matrixTransform(ctm);
          if (screen.y < 0 || screen.y > window.innerHeight) continue;
          return { x: screen.x, y: screen.y };
        }
      }
    }
    throw new Error("no interior point found in the path");
  });
}

test("tiny VCF: the grey state — the exact sentence, no chips, no toggle, no visible percent outside the disclosure, lineage empty states, #neanderthal, axe in both themes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, GREY_USER.email, GREY_USER.password);
  await ingestAndWait(page, GREY_USER, TINY_FIXTURE);

  await page.goto(ANCESTRY);
  const admixture = page.getByTestId("admixture");
  await expect(admixture.locator('[data-slot="grey-state"]')).toHaveText(GREY_SENTENCE);
  await expect(admixture.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "grey");
  await expect(page.locator('[data-slot="ancestry-chip"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="well-supported-toggle"]')).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText(TOGGLE_LABEL)).toHaveCount(0);
  await expect(page.locator('[data-slot="ancestry-map"] path[tabindex="0"]')).toHaveCount(0);

  // Six headings: the h1 and the five h2s (regions, mother's line, father's line, Neanderthals, sources).
  await expect(page.locator("main :is(h1, h2, h3, h4, h5, h6)")).toHaveCount(6);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What your file supports");

  // No visible text node carries a percent sign while the disclosure is closed…
  expect(await percentTextNodes(page, { visibleOnly: true, outside: "details" })).toEqual([]);
  // …and the raw numbers stay one activation away: five items, each an ancestry share.
  const rawList = admixture.getByRole("list");
  await expect(rawList).toBeHidden();
  await admixture.getByText(RAW_NUMBERS_SUMMARY).click();
  await expect(rawList).toBeVisible();
  await expect(rawList.getByRole("listitem")).toHaveCount(5);
  await expect(rawList.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(5);
  expect(await percentTextNodes(page, { visibleOnly: true, outside: "details" })).toEqual([]);

  // The lineage cards keep their empty states.
  await expect(page.getByTestId("mtdna")).toContainText(/no mitochondrial positions/i);
  await expect(page.getByTestId("ydna")).toContainText(NO_Y_LEAD);
  await expect(page.getByTestId("ydna")).toContainText(/no Y-chromosome positions/i);
  await expect(page.getByTestId("ydna")).toContainText(/without a Y chromosome/i);

  await expect(page.locator("#neanderthal")).toBeVisible();
  await expect(page.locator("#neanderthal")).toContainText("How much of your DNA came from Neanderthals");
  expect(await page.content()).not.toContain("archaic-hominin");

  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(ANCESTRY);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({ id: violation.id, impact: violation.impact, theme, help: violation.help })),
    ).toEqual([]);
  }
});

test("synthetic marker fixture: the shown state — figure contract, sum rule, toggle, tab order, panel, denylist, gradient, budget and first-party origins", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, SHOWN_USER.email, SHOWN_USER.password);
  await ingestAndWait(page, SHOWN_USER, MIXED_FIXTURE);

  // Only first-party origins, and no request for the geometry file: the
  // server decodes the committed TopoJSON and hands the client path data.
  const origins = new Set<string>();
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    origins.add(url.origin);
    urls.push(request.url());
  });
  await page.goto(ANCESTRY);
  await page.waitForLoadState("networkidle");
  expect([...origins].filter((origin) => !ALLOWED_ORIGINS.has(origin))).toEqual([]);
  expect(urls.filter((url) => new URL(url).pathname.startsWith("/geo/"))).toEqual([]);

  const map = page.locator('[data-slot="ancestry-map"]');
  await expect(map).toHaveAttribute("data-mode", "shown");
  await expect(map).toHaveAttribute("data-density-pixel-exclusion", "map-tile");
  await expect(page.locator("main :is(h1, h2, h3, h4, h5, h6)")).toHaveCount(6);

  // X6.1: at most twelve interactive elements in the first viewport at 1280×800.
  const interactives = await firstViewportInteractives(page);
  expect(interactives.length, interactives.join(" | ")).toBeLessThanOrEqual(12);

  // G4.4, structural: every ancestry share prints a one-decimal value and
  // either a range or the explicit `no range yet`; no other text node on the
  // page carries a percent sign (hidden rows included).
  const shares = page.locator('[data-figure-kind="ancestry-share"]');
  const shareCount = await shares.count();
  expect(shareCount).toBeGreaterThanOrEqual(7); // five rows and two chips
  for (let index = 0; index < shareCount; index++) {
    const share = shares.nth(index);
    await expect(share).toHaveAttribute("data-figure-class", "ancestry");
    await expect(share).toHaveAttribute("data-figure-basis", "modelled");
    await expect(share).toHaveAttribute("data-provenance", /^computed:/);
    await expect(share.locator('[data-slot="figure-value"]')).toHaveText(SHARE_VALUE);
    const unit = ((await share.locator('[data-slot="figure-unit"]').textContent()) ?? "").trim();
    expect(unit === NO_RANGE_YET || RANGE_UNIT.test(unit), `unit ${JSON.stringify(unit)}`).toBe(true);
  }
  expect(await percentTextNodes(page, { visibleOnly: false, outside: '[data-figure-kind="ancestry-share"]' })).toEqual([]);
  await expect(page.locator("[data-claim-block][data-subject-id]")).toHaveCount(1);

  // The toggle: a labelled switch, on by default; the sum rule holds in both states.
  const toggle = page.locator('[data-slot="well-supported-toggle"]');
  await expect(toggle).toHaveRole("switch");
  await expect(toggle).toHaveText(TOGGLE_LABEL);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectSumRule(page);
  const visibleRows = page.locator('[data-slot="region-row"]:not([hidden])');
  const paths = map.locator('path[data-region][tabindex="0"]');
  const rowsOn = await visibleRows.count();
  const pathsOn = await paths.count();
  expect(pathsOn).toBe(rowsOn);
  await expect(page.locator('[data-slot="region-row"]')).toHaveCount(5);
  expect(rowsOn).toBeLessThan(5);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectSumRule(page);
  const rowsOff = await visibleRows.count();
  const pathsOff = await paths.count();
  expect(rowsOff).toBe(5);
  expect(pathsOff).toBe(5);
  expect(rowsOff).toBeGreaterThan(rowsOn);
  expect(pathsOff).toBeGreaterThan(pathsOn);

  // Descending share order in the table, and Tab order over the paths equal to it.
  const tableOrder = await visibleRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-region")));
  const tableValues = await shareValues(visibleRows.locator('[data-slot="figure-value"]'));
  expect([...tableValues].sort((a, b) => b - a)).toEqual(tableValues);
  const tabOrder: (string | null)[] = [];
  await paths.first().focus();
  for (let index = 0; index < pathsOff; index++) {
    tabOrder.push(await page.evaluate(() => document.activeElement?.getAttribute("data-region") ?? null));
    if (index < pathsOff - 1) await page.keyboard.press("Tab");
  }
  expect(tabOrder).toEqual(tableOrder);
  // Focus opened the panel without moving focus out of the map.
  await expect(page.locator('[data-slot="region-panel"]')).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("aria-hidden");

  // A.8 accessible names, and the denylist over every label the fixture constrains.
  const labels: string[] = [];
  labels.push(...(await page.locator('[data-slot="region-name"]').allTextContents()));
  labels.push(...(await page.locator('[data-slot="ancestry-chip"]').allTextContents()));
  labels.push(...(await page.locator('[data-slot="map-caption"]').allTextContents()));
  for (let index = 0; index < pathsOff; index++) {
    const label = (await paths.nth(index).getAttribute("aria-label")) ?? "";
    expect(label).toMatch(/^.+: \d+% \((no range yet|range \d+% to \d+%)\)$/);
    labels.push(label);
  }
  for (const label of labels) {
    expect(deniedWordIn(label), `${JSON.stringify(label)} contains a denied word`).toBeNull();
  }

  // The click panel: click opens it and moves focus to Close; Escape closes
  // it and returns focus to the path; a background click closes it too.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="region-panel"]')).toHaveCount(0);
  const first = paths.first();
  const firstRegion = await first.getAttribute("data-region");
  const firstName = (
    await page.locator(`[data-slot="region-row"][data-region="${firstRegion}"] [data-slot="region-name"]`).textContent()
  )?.trim();
  expect(firstName).toBeTruthy();
  const point = await interiorPoint(first);
  await page.mouse.click(point.x, point.y);
  const panel = page.locator('[data-slot="region-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "false");
  await expect(panel.locator('[data-slot="region-title"]')).toHaveText(firstName ?? "");
  await expect(panel.locator('[data-figure-kind="ancestry-share"]')).toHaveCount(1);
  const close = panel.getByRole("button", { name: CLOSE });
  await expect(close).toBeFocused();
  const closeBox = await close.boundingBox();
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(new URL(page.url()).pathname).toBe(ANCESTRY);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(first).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(ANCESTRY);

  await page.mouse.click(point.x, point.y);
  await expect(panel).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(panel).toHaveCount(0);

  // X16.5: every filled path references a radial gradient whose last stop is
  // transparent and whose feather covers at least 15% of the path's bbox width.
  const filled = map.locator("path[data-region][data-fill-opacity]");
  const filledCount = await filled.count();
  expect(filledCount).toBeGreaterThanOrEqual(3);
  for (let index = 0; index < filledCount; index++) {
    const measured = await filled.nth(index).evaluate((element) => {
      const shape = element as SVGPathElement;
      const id = /^url\(#(.+)\)$/.exec(shape.getAttribute("fill") ?? "")?.[1];
      const gradient = id ? document.getElementById(id) : null;
      if (!gradient || gradient.tagName.toLowerCase() !== "radialgradient") return null;
      const stops = [...gradient.querySelectorAll("stop")];
      const last = stops[stops.length - 1];
      const beforeLast = stops[stops.length - 2];
      const fraction = (raw: string | null) => Number((raw ?? "").replace("%", "")) / ((raw ?? "").includes("%") ? 100 : 1);
      const radius = fraction(gradient.getAttribute("r"));
      const featherStart = fraction(beforeLast?.getAttribute("offset") ?? null);
      const width = shape.getBBox().width;
      return {
        units: gradient.getAttribute("gradientUnits"),
        lastOpacity: last?.getAttribute("stop-opacity"),
        fillOpacity: Number(shape.getAttribute("data-fill-opacity")),
        feather: (1 - featherStart) * radius * width,
        width,
      };
    });
    expect(measured).not.toBeNull();
    expect(measured?.units).toBe("objectBoundingBox");
    expect(measured?.lastOpacity).toBe("0");
    expect(measured?.fillOpacity ?? 0).toBeGreaterThanOrEqual(0.15);
    expect(measured?.feather ?? 0).toBeGreaterThanOrEqual(MIN_FEATHER * (measured?.width ?? Infinity) - 1e-6);
  }
});
