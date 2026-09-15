import { test, expect, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import type { MapShapes } from "../src/lib/ancestry/geometry";
import { presentShares } from "../src/lib/ancestry/present";
import { regionsView } from "../src/lib/ancestry/view";
import { REGIONAL_RANGE_NOTE, regionalReporting } from "../src/lib/genome/regional-admixture";
import manifest from "../data/ref/aims-seven-region-manifest.json";

// Reuse the compiler already installed with tsx; no app, provider or network is
// involved in these component interactions. The full ancestry journeys stay separate.
const requireFromRepo = createRequire(path.resolve(process.cwd(), "package.json"));
const requireFromTsx = createRequire(requireFromRepo.resolve("tsx"));
const build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> = requireFromTsx("esbuild").build;
let client: string;
test.beforeAll(async () => {
  const bundled = await build({ entryPoints: ["e2e/fixtures/ancestry-panel.tsx"], bundle: true, write: false,
    absWorkingDir: process.cwd(), tsconfig: "tsconfig.json", platform: "browser", format: "iife", globalName: "ancestryPanelFixture",
    define: { "process.env.NODE_ENV": '"production"' } });
  client = bundled.outputFiles[0].text;
});

const cases = ["legacy", "combined", "separate"] as const;
/** Deterministic hit targets; these tests make no geographic/source claim. */
function shapes(codes: string[]): MapShapes {
  return { land: "", regions: codes.map((code, index) => {
    const x0 = 100 + index * 200, y0 = 100 + index * 70, x1 = x0 + 120, y1 = y0 + 160;
    return { code, d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, bbox: { x0, y0, x1, y1 } };
  }) };
}
function fixture(name: typeof cases[number]) {
  const common = { subjectId: "synthetic-panel-subject", initialWellSupportedOnly: false };
  if (name === "legacy") return { kind: "legacy", props: { ...common,
    shapes: shapes(["europe", "africa-south-of-sahara", "east-and-southeast-asia", "central-america-caribbean-andes", "south-asia"]), minMarkers: 42,
    panel: { markers: 168, version: "2026-08-28" }, result: { markersUsed: 168, shown: true, supportNote: "Synthetic result",
      view: regionsView(presentShares({ proportions: { EUR: .56, AFR: .25, EAS: .13, AMR: .04, SAS: .02 } })) } } };
  const proportions = name === "combined"
    ? { AFR: .1, AMR: .009, CSA: .17, EAS: .08, EUR: .38, MID: .26, OCE: .001 }
    : { AFR: .75, AMR: .009, CSA: .04, EAS: .08, EUR: .08, MID: .04, OCE: .001 };
  return { kind: "regional", props: { ...common, shapes: shapes(["AFR", "EUR", "MID", "CSA", "EAS", "AMR", "OCE"]), minMarkers: 168,
    panel: { markers: 168, version: manifest.referenceVersion }, reference: manifest,
    result: { proportions, markersUsed: 168, reporting: regionalReporting(proportions), note: REGIONAL_RANGE_NOTE,
      fit: { converged: true, iterations: 42 } } } };
}

/** Same interior-point strategy as the full ancestry journey; never dispatch a synthetic click. */
async function interiorPoint(path: Locator) {
  await path.scrollIntoViewIfNeeded();
  return path.evaluate(element => {
    const shape = element as SVGPathElement, box = shape.getBBox(), ctm = shape.getScreenCTM();
    if (!ctm) throw new Error("path has no screen CTM");
    for (let step = 4; step <= 128; step *= 2) for (let i = 1; i < step; i++) for (let j = 1; j < step; j++) {
      const point = new DOMPoint(box.x + box.width * i / step, box.y + box.height * j / step);
      if (!shape.isPointInFill(point)) continue;
      const screen = point.matrixTransform(ctm);
      if (screen.y >= 0 && screen.y <= innerHeight) return { x: screen.x, y: screen.y };
    }
    throw new Error("no interior point found in the path");
  });
}

for (const name of cases) test.describe(`ancestry panel interactions: ${name}`, () => {
  test.use({ hasTouch: true });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route("**/*", route => route.abort());
    // A focusable main matches AppShell. A tall header and below-map panel
    // exercise real browser scrolling without pretending to reproduce app CSS.
    await page.setContent(`<style>
      body { margin: 0; } main { width: 960px; margin: auto; padding-bottom: 800px; }
      header { height: 500px; } svg { width: 960px; height: 540px; }
      table { width: 100%; } th, td { padding: 12px; }
      [data-slot="region-panel"] { padding: 20px; } button { min-height: 44px; }
    </style><div id="root"></div>`);
    await page.addScriptTag({ content: client });
    await page.evaluate(value => {
      (window as unknown as { ancestryPanelFixture: { renderFixture: (data: unknown) => void } }).ancestryPanelFixture.renderFixture(value);
    }, fixture(name));
    await expect(page.locator('path[role="button"]').first()).toBeVisible();
  });

  test("outside plain content returns focus; another control keeps its chosen focus", async ({ page }) => {
    const first = page.locator('path[role="button"]').first(), close = page.getByRole("button", { name: "Close", exact: true });
    const point = await interiorPoint(first);
    await page.mouse.move(0, 0); await page.mouse.move(point.x, point.y);
    await expect(page.getByRole("dialog")).toBeVisible(); await expect(close).not.toBeFocused();
    await first.focus(); await first.press("Enter"); await expect(close).toBeFocused();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(first).toBeFocused();
    await first.press("Enter"); await expect(close).toBeFocused();
    const other = page.getByRole("button", { name: "Other control", exact: true });
    await other.locator("span").click();
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(other).toBeFocused();
    await first.focus(); await first.press("Enter"); await expect(close).toBeFocused();
    const toggle = page.getByRole("switch"); await toggle.click();
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await first.focus(); await first.press("Space"); await expect(close).toBeFocused();
    await close.click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(first).toBeFocused();
  });

  test("Escape and Close restore the map viewport so the identical pointer point opens the same region again", async ({ page }) => {
    const paths = page.locator('path[role="button"]'), first = paths.first();
    await first.focus();
    for (let index = 1; index < await paths.count(); index++) await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    const point = await interiorPoint(first), originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const code = await first.getAttribute("data-region");
    for (const dismissal of ["Escape", "Close"] as const) {
      await page.mouse.click(point.x, point.y);
      const panel = page.getByRole("dialog"), close = panel.getByRole("button", { name: "Close", exact: true });
      await expect(panel).toBeVisible(); await expect(close).toBeFocused();
      await expect(first).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => scrollY)).not.toBe(originalScroll.y);
      if (dismissal === "Escape") await close.press("Escape"); else await close.click();
      await expect(panel).toHaveCount(0); await expect(first).toBeFocused();
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(originalScroll);
    }
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("dialog")).toBeVisible(); await expect(first).toHaveAttribute("aria-expanded", "true");
    if (name !== "legacy") await expect(page.getByRole("dialog")).toHaveAttribute("data-region", code!);
  });

  test("one touch opens the panel and Close returns to the same map position", async ({ page }) => {
    const first = page.locator('path[role="button"]').first(), point = await interiorPoint(first);
    const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.touchscreen.tap(point.x, point.y);
    const panel = page.getByRole("dialog"), close = panel.getByRole("button", { name: "Close", exact: true });
    await expect(panel).toBeVisible(); await expect(close).toBeFocused();
    await close.tap(); await expect(panel).toHaveCount(0); await expect(first).toBeFocused();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(originalScroll);
  });
});
