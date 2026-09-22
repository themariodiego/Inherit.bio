import { readFileSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureIgvNavigation } from "../src/components/browse/igv-navigation";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

describe("installed genome navigation configuration", () => {
  it.each([false, true, undefined])("honors multi-track selection visibility %s through resize", async setting => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const external: string[] = [];
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://fixture.invalid") { external.push(url.origin); return route.abort(); }
      if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
      return route.fulfill({ contentType: "text/html", body: '<main><h1>Genome controls</h1><div id="widget"></div></main>' });
    });
    try {
      await page.goto("http://fixture.invalid");
      await page.addScriptTag({ type: "module", content: `
        import igv from "/igv.js";
        window.testIgv = await igv.createBrowser(document.querySelector("#widget"), {
          loadDefaultGenomes: false, search: false, queryParametersSupported: false,
          showMultiSelectButton: ${String(setting)}, showChromosomeWidget: false,
          reference: { id: "synthetic", format: "chromsizes", fastaURL: new File(["chr1\\t100000\\n"], "sizes") },
          locus: "chr1:100-1000", tracks: [{ name: "Synthetic positions", type: "annotation", format: "bed",
            features: [{ chr: "chr1", start: 500, end: 501, name: "Synthetic A/G" }] }],
        });
        document.body.dataset.ready = "true";
      ` });
      await page.waitForFunction(() => document.body.dataset.ready === "true");
      await page.evaluate(`globalThis.__name = value => value; (${configureIgvNavigation.toString()})(window.testIgv);`);
      const selection = page.getByTitle("Select Tracks", { exact: true });
      for (const width of [1280, 320, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate("window.testIgv.boundWindowResizeHandler()");
        expect(await selection.isVisible()).toBe(setting !== false);
        expect(await page.locator("input.igv-search-input").isVisible()).toBe(true);
      }
      if (setting !== false) {
        await selection.click();
        expect(await page.evaluate("window.testIgv.navbar.getEnableTrackSelection()")).toBe(true);
        await selection.click();
        expect(await page.evaluate("window.testIgv.navbar.getEnableTrackSelection()")).toBe(false);
      }
      expect(external).toEqual([]);
    } finally { await context.close(); }
  }, 20_000);
});
