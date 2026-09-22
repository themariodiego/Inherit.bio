import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { enhanceIgvInteractions } from "../src/components/browse/igv-interactions";
import { enhanceIgvTrackScrolling } from "../src/components/browse/igv-track-scrolling";
import { IGV_CONTROL_LABELS } from "../src/copy/genome/data";
import { installKeyboardAudit, tabThrough } from "../e2e/keyboard-traversal";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(width: number, theme: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage(); page.setDefaultTimeout(5_000);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://fixture.invalid") return route.abort();
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
    if (url.pathname === "/sizes") return route.fulfill({ contentType: "text/plain", body: readFileSync("public/genomes/hg38.chrom.sizes") });
    if (url.pathname !== "/") return route.abort();
    return route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>Genome scrolling</title></head>'
      + `<body style="margin:8px;${theme === "dark" ? "color:#eee;background:#171f1a" : "color:#222;background:white"}"><main>`
      + '<h1>Genome scrolling</h1><button>Before</button><div id="widget" style="width:100%;overflow-x:auto"></div><button>After</button></main></body></html>' });
  });
  try {
    await page.goto("http://fixture.invalid");
    await page.addScriptTag({ type: "module", content: `
      import igv from "/igv.js";
      window.testIgv = await igv.createBrowser(document.querySelector("#widget"), {
        loadDefaultGenomes: false, showChromosomeWidget: false, showSVGButton: false,
        showSampleNameButton: false, showMultiSelectButton: false, showTrackLabelButton: false,
        showCenterGuideButton: false, showCursorTrackingGuideButton: false,
        reference: { id: "hg38-positions", name: "Reference positions", format: "chromsizes", fastaURL: "/sizes" },
        locus: "chr15:74749500-74751500", tracks: [{ name: "Dense synthetic positions", type: "annotation", format: "bed",
          displayMode: "EXPANDED", color: "#2e5c45", height: 100, autoHeight: false,
          // Overlapping synthetic annotations exercise the scrollable state.
          // Distinct non-overlapping positions pack into one row in igv.
          features: Array.from({length:40}, (_, i) => ({chr:"chr15",start:74750500,end:74750501,name:"Synthetic annotation " + i})) }],
      });
      window.track = window.testIgv.trackViews.find(view => view.track.type === "annotation");
      document.body.dataset.ready = "true";
    ` });
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    await page.evaluate(`globalThis.__name = value => value;
      (${labelIgvControls.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)});
      (${enhanceIgvInteractions.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);
      window.disposeScrolling = (${enhanceIgvTrackScrolling.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);`);
    await run(page);
  } finally { await context.close(); }
}

describe("installed genome widget vertical scrolling", () => {
  it.each([320, 390, 1280].flatMap(width => ["light", "dark"].map(theme => ({ width, theme }))))(
    "reaches both ends by keyboard and pointer at $width px in $theme", async ({ width, theme }) => {
      await fixture(width, theme, async page => {
        const slider = page.getByRole("slider", { name: "Scroll track: Dense synthetic positions", exact: true });
        await slider.waitFor();
        const bounds = (await slider.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBe(100);
        const max = Number(await slider.getAttribute("max")); expect(max).toBeGreaterThan(100);
        await slider.focus(); await page.keyboard.press("End");
        expect(await page.evaluate("window.track.viewports[0].getContentTop()")).toBe(max);
        await page.keyboard.press("Home");
        expect(await page.evaluate("window.track.viewports[0].getContentTop()")).toBe(0);
        await page.keyboard.press("ArrowDown");
        expect(await page.evaluate("window.track.viewports[0].getContentTop()")).toBe(1);
        await slider.click({ position: { x: 22, y: 96 } });
        expect(await page.evaluate("window.track.viewports[0].getContentTop()")).toBe(max);
        await slider.click({ position: { x: 22, y: 4 } });
        expect(await page.evaluate("window.track.viewports[0].getContentTop()")).toBe(0);
        await page.evaluate("window.track.scrollByPixels(50)");
        expect(await slider.inputValue()).toBe("50");
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(results.violations.map(item => item.id)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.evaluate(installKeyboardAudit);
        expect(await tabThrough(page)).toMatchObject({ exit: "left-document", violations: [], unreached: [] });
      });
    }, 30_000);

  it("tracks changed heights and removes the control when the content fits", async () => {
    await fixture(390, "light", async page => {
      const slider = page.getByRole("slider", { name: "Scroll track: Dense synthetic positions", exact: true });
      await slider.waitFor();
      await page.evaluate("window.track.setTrackHeight(200, true)");
      expect((await slider.boundingBox())!.height).toBe(200);
      await slider.focus(); await page.keyboard.press("End");
      expect(await page.evaluate("window.track.viewports[0].getContentTop()"))
        .toBe(await page.evaluate("window.track.maxViewportContentHeight() - 200"));
      await page.evaluate("window.track.setTrackHeight(window.track.maxViewportContentHeight(), true)");
      await slider.waitFor({ state: "hidden" });
      expect(await page.getByRole("button", { name: "Track settings: Dense synthetic positions", exact: true })
        .evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      await page.evaluate("window.disposeScrolling()");
      expect(await page.locator("[data-igv-scroll], [data-igv-native-scroll]").count()).toBe(0);
    });
  });
});
