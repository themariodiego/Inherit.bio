import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureIgvNavigation } from "../src/components/browse/igv-navigation";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { enhanceIgvInteractions } from "../src/components/browse/igv-interactions";
import { IGV_CONTROL_LABELS } from "../src/copy/genome/data";
import { installKeyboardAudit, tabThrough } from "../e2e/keyboard-traversal";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(width: number, theme: string, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
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
      (${configureIgvNavigation.toString()})(window.testIgv);
      (${labelIgvControls.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)});
      window.disposeInteractions = (${enhanceIgvInteractions.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);`);
    await run(page);
    expect(pageErrors).toEqual([]);
  } finally { await context.close(); }
}

async function openMenu(page: Page, name = "Synthetic positions") {
  const gear = page.getByRole("button", { name: `Track settings: ${name}`, exact: true });
  await gear.focus(); await page.keyboard.press("Enter");
  await page.getByRole("menu").waitFor({ state: "visible" });
  return gear;
}

async function choose(page: Page, action: string) {
  const menu = page.getByRole("menu");
  const count = await menu.locator('[role^="menuitem"]').count();
  for (let i = 0; i < count; i++) {
    if (await menu.getByRole("menuitem", { name: action, exact: true }).evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)) {
      await page.keyboard.press("Enter"); return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`Keyboard could not reach ${action}`);
}

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
  for (const control of await page.locator('#widget [data-igv-action], #widget input, #widget [role="slider"], #widget dialog button').all()) {
    if (!await control.isVisible()) continue;
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

describe("installed genome widget menus and dialogs", () => {
  it.each(["light", "dark"])("keeps enlarged track controls inside a padded, resized host in %s", async theme => {
    await fixture(1280, theme, async page => {
      await page.locator("#widget").evaluate(element => {
        element.setAttribute("style", "box-sizing:border-box;width:100%;overflow-x:auto;padding:8px;border:1px solid #555;border-radius:12px");
      });
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await audit(page);
        const host = (await page.locator("#widget").boundingBox())!;
        for (const gear of await page.getByRole("button", { name: /^Track settings:/ }).all()) {
          const box = (await gear.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(host.x);
          expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width);
          const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          expect(await gear.evaluate((element, at) => {
            const root = element.getRootNode() as ShadowRoot;
            return element.contains(root.elementFromPoint(at.x, at.y));
          }, point)).toBe(true);
        }
      }
    });
  }, 30_000);

  it.each([390, 1280])("keeps all closed-widget controls in normal tab order at %i px", async width => {
    await fixture(width, "light", async page => {
      await page.evaluate(installKeyboardAudit);
      const traversal = await tabThrough(page);
      expect(traversal).toMatchObject({ exit: "left-document", violations: [], unreached: [] });
      expect(traversal.stops).toBe(traversal.expected);
    });
  });

  it.each([320, 390, 1280].flatMap(width => ["light", "dark"].map(theme => ({ width, theme }))))(
    "opens, edits, cancels and escapes through the keyboard at $width px in $theme", async ({ width, theme }) => {
      await fixture(width, theme, async page => {
        const gear = await (await openMenu(page)).elementHandle();
        await audit(page);
        const bounds = (await page.getByRole("menu").boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await choose(page, "Set track name");
        const dialog = page.getByRole("dialog", { name: "Track Name", exact: true });
        await dialog.waitFor();
        expect(await dialog.getByRole("textbox").evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
        await audit(page);
        await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type("Edited positions");
        await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
        await dialog.waitFor({ state: "hidden" });
        expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.name')).toBe("Edited positions");
        expect(await gear!.evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
        await openMenu(page, "Edited positions"); await choose(page, "Set track height");
        const height = page.getByRole("spinbutton", { name: "Track Height", exact: true });
        await height.fill("100"); await page.keyboard.press("Enter");
        expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.height')).toBe(100);
        await openMenu(page, "Edited positions"); await choose(page, "Set track name");
        await page.getByRole("textbox", { name: "Track Name" }).fill("Discarded edit");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.name')).toBe("Edited positions");
        await openMenu(page, "Edited positions"); await page.keyboard.press("Escape");
        await page.getByRole("menu").waitFor({ state: "hidden" });
        const renamedGear = page.getByRole("button", { name: "Track settings: Edited positions", exact: true });
        expect(await renamedGear.evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      });
    }, 30_000);

  it("uses palette and arbitrary typed colors without pointer-only gradients", async () => {
    await fixture(320, "dark", async page => {
      await openMenu(page); await choose(page, "Set track color");
      const dialog = page.getByRole("dialog", { name: "Set track color", exact: true });
      await dialog.waitFor(); await audit(page);
      const swatch = dialog.getByRole("button", { name: "Color rgb(0, 0, 0)", exact: true });
      await swatch.focus(); await page.keyboard.press("Space");
      expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.color')).toBe("rgb(0, 0, 0)");
      const more = dialog.getByRole("button", { name: "More colors", exact: true });
      await more.focus(); await page.keyboard.press("Enter");
      const editor = dialog.getByRole("textbox", { name: "Color name or code" });
      await editor.waitFor(); await editor.fill("#112233");
      await editor.press("Tab");
      await audit(page);
      await dialog.getByRole("button", { name: "Ok", exact: true }).press("Enter");
      expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.color')).toBe("rgb(17, 34, 51)");
      expect(await dialog.locator(".picker_wrapper").count()).toBe(0);
      expect(await more.evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    });
  }, 30_000);

  it("contains modal focus and rejects a track height smaller than its controls", async () => {
    await fixture(320, "light", async page => {
      await openMenu(page); await choose(page, "Set track height");
      const dialog = page.getByRole("dialog", { name: "Track Height", exact: true });
      const height = dialog.getByRole("spinbutton", { name: "Track Height", exact: true });
      await height.fill("20"); await height.press("Enter");
      expect(await dialog.isVisible()).toBe(true);
      expect(await height.evaluate(element => (element as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate(element => element.contains((element.getRootNode() as ShadowRoot).activeElement))).toBe(true);
      }
      await height.fill("44"); await height.press("Enter");
      await dialog.waitFor({ state: "hidden" });
      expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.height')).toBe(44);
      await openMenu(page); await page.keyboard.press("End"); await page.keyboard.press("ArrowDown");
      expect(await page.getByRole("menuitem", { name: "Close menu", exact: true }).evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      await page.keyboard.press("Tab"); await page.getByRole("menu").waitFor({ state: "hidden" });
    });
  }, 30_000);

  it("reorders the real tracks using the same operations as pointer dragging", async () => {
    await fixture(390, "light", async page => {
      const order = page.getByRole("slider", { name: "Track order: Synthetic positions", exact: true });
      expect(await order.getAttribute("aria-valuenow")).toBe("2");
      await order.focus(); await page.keyboard.press("ArrowUp");
      expect(await page.evaluate('window.testIgv.trackViews.filter(view => view.track.type !== "ruler").map(view => view.track.type)')).toEqual(["ideogram", "annotation", "sequence"]);
      expect(await order.getAttribute("aria-valuenow")).toBe("1");
      await page.keyboard.press("End");
      expect(await order.getAttribute("aria-valuenow")).toBe("2");
      expect(await order.evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      await audit(page);
    });
  }, 30_000);

  it("changes display modes, toggles reference controls and removes a track through its menu", async () => {
    await fixture(390, "light", async page => {
      for (const [name, mode] of [["Collapse", "COLLAPSED"], ["Squish", "SQUISHED"], ["Expand", "EXPANDED"]]) {
        await openMenu(page);
        const item = page.getByRole("menuitemradio", { name, exact: true });
        await item.focus(); await page.keyboard.press("Space");
        expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "annotation").track.displayMode')).toBe(mode);
        await openMenu(page);
        expect(await page.getByRole("menuitemradio", { name, exact: true }).getAttribute("aria-checked")).toBe("true");
        await page.keyboard.press("Escape");
      }
      await openMenu(page, "Reference positions"); await choose(page, "Reverse");
      expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "sequence").track.reversed')).toBe(true);
      await openMenu(page, "Reference positions"); await choose(page, "Three-frame Translate");
      expect(await page.evaluate('window.testIgv.trackViews.find(view => view.track.type === "sequence").track.frameTranslate')).toBe(true);
      await openMenu(page, "Reference positions"); await choose(page, "Close Translation");
      await audit(page);
      await openMenu(page); await choose(page, "Remove track");
      expect(await page.evaluate('window.testIgv.trackViews.some(view => view.track.type === "annotation")')).toBe(false);
      expect(await page.getByRole("textbox", { name: "Search by position", exact: true }).evaluate(element => element === (element.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    });
  }, 30_000);
});
