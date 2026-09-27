import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadIgvReference } from "../src/components/browse/igv-reference";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page, requests: string[]) => Promise<void>, failure?: "refused" | "redirect") {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    requests.push(url.origin + url.pathname);
    if (url.origin === "https://upload.invalid") return route.fulfill({
      headers: { "access-control-allow-origin": "*" }, body: "synthetic upload accepted",
    });
    if (url.origin !== "http://fixture.invalid") return route.abort();
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
    if (url.pathname === "/genomes/hg38.chrom.sizes") {
      if (failure === "refused") return route.fulfill({ status: 503, body: "unavailable" });
      if (failure === "redirect") return route.fulfill({ status: 302, headers: { location: "https://outside.invalid/reference" } });
      return route.fulfill({ contentType: "text/plain", body: readFileSync("public/genomes/hg38.chrom.sizes") });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="widget"></div>' });
  });
  try {
    await page.goto("http://fixture.invalid");
    await page.evaluate(`globalThis.__name = value => value;
      window.loadReference = ${loadIgvReference.toString()};
      window.originalOpen = XMLHttpRequest.prototype.open;
      window.originalSend = XMLHttpRequest.prototype.send;`);
    await run(page, requests);
  } finally { await context.close(); }
}

describe("first-party genome reference without a global upload guard", () => {
  it("renders the installed viewer without external requests and preserves uploads before and after removal", async () => {
    await fixture(async (page, requests) => {
      await page.addScriptTag({ type: "module", content: `
        import igv from "/igv.js";
        window.testModule = igv;
        const reference = await window.loadReference(new AbortController().signal);
        if (!(reference instanceof File)) throw new Error("Expected the native File transport");
        window.testBrowser = await igv.createBrowser(document.querySelector("#widget"), {
          loadDefaultGenomes: false, search: false, queryParametersSupported: false,
          reference: { id: "hg38-positions", format: "chromsizes", fastaURL: reference },
          locus: "chr15:74749500-74751500", tracks: [{ name: "Synthetic calls", type: "annotation", format: "bed",
            features: [{ chr: "chr15", start: 74750500, end: 74750501, name: "A/G" }] }],
        });
        window.ready = true;
      ` });
      await page.waitForFunction(() => Reflect.get(window, "ready") === true);
      expect(await page.locator("canvas").count()).toBeGreaterThan(0);
      expect(await page.evaluate('window.testBrowser.search("INHERIT_UNKNOWN_SYNTHETIC_POSITION")')).toBe(false);
      expect(await page.evaluate('window.testBrowser.search("chr15:74749500-74751500")')).toBe(true);
      expect(requests).toEqual([
        "http://fixture.invalid/", "http://fixture.invalid/igv.js", "http://fixture.invalid/genomes/hg38.chrom.sizes",
      ]);
      for (const removed of [false, true]) {
        if (removed) await page.evaluate("window.testModule.removeBrowser(window.testBrowser)");
        expect(await page.evaluate(`XMLHttpRequest.prototype.open === window.originalOpen
          && XMLHttpRequest.prototype.send === window.originalSend`)).toBe(true);
        const result = await page.evaluate(() => new Promise(resolve => {
          const request = new XMLHttpRequest();
          request.open("POST", "https://upload.invalid/synthetic");
          request.onload = () => resolve({ status: request.status });
          request.onerror = () => resolve({ error: "network" });
          request.send("synthetic bytes");
        }));
        expect(result).toEqual({ status: 200 });
      }
      expect(requests.filter(url => url === "https://upload.invalid/synthetic")).toHaveLength(2);
    });
  });

  it.each(["refused", "redirect"] as const)("refuses a %s reference without contacting a substitute host", async failure => {
    await fixture(async (page, requests) => {
      expect(await page.evaluate(`window.loadReference(new AbortController().signal).then(() => "loaded", () => "refused")`)).toBe("refused");
      expect(requests).toEqual(["http://fixture.invalid/", "http://fixture.invalid/genomes/hg38.chrom.sizes"]);
    }, failure);
  });

  it("honors cancellation without issuing a reference request", async () => {
    await fixture(async (page, requests) => {
      expect(await page.evaluate(`window.loadReference(AbortSignal.abort()).then(() => "loaded", () => "cancelled")`)).toBe("cancelled");
      expect(requests).toEqual(["http://fixture.invalid/"]);
    });
  });
});
