import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { enhanceIgvInteractions } from "../src/components/browse/igv-interactions";
import { enhanceIgvPopovers } from "../src/components/browse/igv-popovers";
import { IGV_CONTROL_LABELS } from "../src/copy/genome/data";
import { installKeyboardAudit, tabThrough } from "../e2e/keyboard-traversal";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(width: number, theme: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://fixture.invalid") return route.abort();
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
    if (url.pathname === "/sizes") return route.fulfill({ contentType: "text/plain", body: readFileSync("public/genomes/hg38.chrom.sizes") });
    if (url.pathname !== "/") return route.abort();
    return route.fulfill({ contentType: "text/html", body: `<html lang="en"><head><title>Genome controls</title></head>`
      + `<body style="margin:8px;${theme === "dark" ? "color:#eee;background:#171f1a" : "color:#222;background:white"}"><main>`
      + '<h1>Genome controls</h1><button>Before</button><div id="widget" style="width:100%;overflow-x:auto"></div><button>After</button></main></body></html>' });
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
        locus: "chr15:74749500-74751500", tracks: [{ name: "Synthetic positions", type: "annotation", format: "bed",
          displayMode: "EXPANDED", color: "#2e5c45", features: [{chr:"chr15",start:74750500,end:74750501,name:"Synthetic A/G"}] }],
      });
      document.body.dataset.ready = "true";
    ` });
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    await page.evaluate(`globalThis.__name = value => value;
      (${labelIgvControls.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)});
      window.disposeInteractions = (${enhanceIgvInteractions.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);
      window.disposePopovers = (${enhanceIgvPopovers.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);`);
    await run(page);
  } finally { await context.close(); }
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
  for (const control of await page.locator("[data-igv-popup-action]").all()) {
    if (!await control.isVisible()) continue;
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

const focused = (element: Element) => element === (element.getRootNode() as ShadowRoot).activeElement;

describe("installed genome widget transient surfaces", () => {
  it.each([320, 390, 1280].flatMap(width => ["light", "dark"].map(theme => ({ width, theme }))))(
    "opens track details and the context menu by keyboard at $width px in $theme", async ({ width, theme }) => {
      await fixture(width, theme, async page => {
        const label = page.getByRole("button", { name: "Track details: Synthetic positions", exact: true });
        await label.focus(); await page.keyboard.press("Enter");
        const details = page.getByRole("dialog", { name: "Synthetic positions", exact: true });
        await details.waitFor(); await audit(page);
        if (width === 320 && theme === "dark") await page.screenshot({ path: "/tmp/inherit-track-details-320.png" });
        const close = details.getByRole("button", { name: "Close dialog", exact: true });
        expect(await close.evaluate(focused)).toBe(true);
        await page.keyboard.press("Tab"); expect(await close.evaluate(focused)).toBe(true);
        await page.keyboard.press("Shift+Tab"); expect(await close.evaluate(focused)).toBe(true);
        await page.keyboard.press("Escape"); await details.waitFor({ state: "hidden" });
        expect(await label.evaluate(focused)).toBe(true);
        await page.keyboard.press("Space"); await details.waitFor();
        await close.press("Enter"); await details.waitFor({ state: "hidden" });
        expect(await label.evaluate(focused)).toBe(true);

        const track = page.getByRole("group", { name: "Track actions: Synthetic positions", exact: true });
        await track.focus(); await page.keyboard.press("Shift+F10");
        const menu = page.getByRole("menu", { name: "Track actions", exact: true });
        await menu.waitFor(); await audit(page);
        expect(await menu.locator(":scope > div:last-child > .context-menu[role=menuitem]").first().evaluate(focused),
          JSON.stringify(await menu.evaluate(element => ({ text: element.textContent, active: (element.getRootNode() as ShadowRoot).activeElement?.outerHTML })))).toBe(true);
        await page.keyboard.press("End");
        expect(await menu.getByRole("menuitem", { name: "Save Image (SVG)", exact: true }).evaluate(focused)).toBe(true);
        await page.keyboard.press("Home");
        expect(await menu.getByRole("menuitem", { name: "Close menu", exact: true }).evaluate(focused)).toBe(true);
        await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" });
        expect(await track.evaluate(focused)).toBe(true);
        await page.evaluate(installKeyboardAudit);
        expect(await tabThrough(page)).toMatchObject({ exit: "left-document", violations: [], unreached: [] });
      });
    }, 30_000);

  it("keeps the library message dialog operable across repeated opening and cleanup", async () => {
    await fixture(320, "dark", async page => {
      const label = page.getByRole("button", { name: "Track details: Synthetic positions", exact: true });
      await label.click(); await page.keyboard.press("Escape");
      for (let i = 0; i < 2; i++) {
        await page.evaluate('window.testIgv.alert.present("Synthetic track message")');
        const dialog = page.getByRole("dialog", { name: "Track message", exact: true });
        await dialog.waitFor(); await audit(page);
        const ok = dialog.getByRole("button", { name: "OK", exact: true });
        expect(await ok.evaluate(focused)).toBe(true);
        await page.keyboard.press(i ? "Escape" : "Enter");
        await dialog.waitFor({ state: "hidden" });
        expect(await label.evaluate(focused)).toBe(true);
      }
      await label.press("Enter");
      await page.getByRole("dialog", { name: "Synthetic positions", exact: true }).waitFor();
      await page.evaluate("window.disposePopovers()");
      expect(await page.locator("dialog[data-igv-popup], [data-igv-popup-action], [data-igv-track-context]").count()).toBe(0);
      await page.evaluate(`(${enhanceIgvPopovers.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv)`);
      await page.getByRole("dialog", { name: "Synthetic positions", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await label.press("Enter");
      await page.getByRole("dialog", { name: "Synthetic positions", exact: true }).waitFor();
      await page.keyboard.press("Escape");
    });
  }, 30_000);

  it("uses the existing image download callbacks and closes a pointer-opened feature popover by keyboard", async () => {
    await fixture(390, "light", async page => {
      const track = page.getByRole("group", { name: "Track actions: Synthetic positions", exact: true });
      for (const format of ["PNG", "SVG"]) {
        await track.focus(); await page.keyboard.press("Shift+F10");
        const item = page.getByRole("menuitem", { name: `Save Image (${format})`, exact: true });
        await item.focus();
        const downloadPromise = page.waitForEvent("download");
        await page.keyboard.press("Enter");
        const download = await downloadPromise;
        expect(download.suggestedFilename().toLowerCase()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
        expect(await download.failure()).toBeNull();
        expect(await track.evaluate(focused)).toBe(true);
      }
      const bounds = (await track.boundingBox())!;
      await track.click({ position: { x: bounds.width / 2, y: 15 } });
      const details = page.getByRole("dialog", { name: "Position details", exact: true });
      await details.waitFor(); await audit(page);
      await page.keyboard.press("Escape"); await details.waitFor({ state: "hidden" });
      expect(await track.evaluate(focused)).toBe(true);
    });
  }, 30_000);
});
