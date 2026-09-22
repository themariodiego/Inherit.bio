import { readFileSync } from "node:fs";
import { chromium, type Browser, type CDPSession, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function listeners(session: CDPSession) {
  const count = async (expression: string, type: string) => {
    const target = await session.send("Runtime.evaluate", { expression });
    const result = await session.send("DOMDebugger.getEventListeners", { objectId: target.result.objectId! });
    return result.listeners.filter(listener => listener.type === type).length;
  };
  return { keyup: await count("document", "keyup"), resize: await count("window", "resize") };
}

async function fixture(entry: "esm" | "umd", run: (page: Page, session: CDPSession) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [], requests: string[] = [];
  const metadata = JSON.parse(readFileSync("node_modules/igv/package.json", "utf8")) as { main: string; module: string; browser: string };
  expect(metadata.main).toBe(metadata.module);
  const installedEntry = entry === "esm" ? metadata.module : metadata.browser;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    requests.push(url.origin + url.pathname);
    if (url.origin !== "http://fixture.invalid") return route.abort();
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync(`node_modules/igv/${installedEntry}`) });
    return route.fulfill({ contentType: "text/html", body: '<div id="live" style="width:1000px"></div><div id="failed" style="width:1000px"></div>' });
  });
  try {
    await page.goto("http://fixture.invalid");
    const session = await context.newCDPSession(page);
    await session.send("Runtime.enable");
    expect(await listeners(session)).toEqual({ keyup: 0, resize: 0 });
    if (entry === "umd") await page.addScriptTag({ url: "http://fixture.invalid/igv.js" });
    else await page.addScriptTag({ type: "module", content: 'import igv from "/igv.js"; window.igv = igv;' });
    await page.waitForFunction("typeof window.igv?.createBrowser === 'function'");
    await page.evaluate(`window.config = name => ({
      loadDefaultGenomes: false, search: false, queryParametersSupported: false,
      reference: { id: 'synthetic-grch38', format: 'chromsizes',
        fastaURL: new File(['chr15\\t101991189\\n'], 'synthetic.chrom.sizes') },
      locus: 'chr15:74749500-74751500', tracks: [{ name, type: 'annotation', format: 'bed',
        features: [{ chr: 'chr15', start: 74750500, end: 74750501, name: 'SYNTHETIC_A/G' }] }]
    });`);
    await run(page, session);
    expect(errors).toEqual([]);
    expect(requests).toEqual(["http://fixture.invalid/", "http://fixture.invalid/igv.js"]);
  } finally { await context.close(); }
}

describe.each(["esm", "umd"] as const)("installed %s viewer cleanup", entry => {
  it("releases a rejected native reference read and preserves the other live viewer", async () => {
    await fixture(entry, async (page, session) => {
      await page.evaluate("window.igv.createBrowser(document.querySelector('#live'), window.config('Kept viewer')).then(browser => { window.live = browser; })");
      expect(await listeners(session)).toEqual({ keyup: 1, resize: 1 });
      expect(await page.evaluate(`class RefusedReference extends File {
        async arrayBuffer() { throw new Error('synthetic reference read failure'); }
      }
      const config = window.config('Failed viewer');
      config.reference.fastaURL = new RefusedReference(['chr15\\t101991189\\n'], 'synthetic.chrom.sizes');
      window.igv.createBrowser(document.querySelector('#failed'), config)
        .then(() => 'unexpected success', error => error.message);`)).toBe("synthetic reference read failure");
      expect(await listeners(session)).toEqual({ keyup: 1, resize: 1 });
      await expect.poll(() => page.locator("#failed .igv-container").count()).toBe(0);
      expect(await page.locator("#live .igv-container").count()).toBe(1);
      expect(await page.locator("#live canvas").count()).toBeGreaterThan(0);
      expect(await page.evaluate("window.live.root.isConnected")).toBe(true);
      expect(await page.evaluate("window.live.search('chr15:74750000-74751000')")).toBe(true);
      expect(await page.evaluate(`window.live.trackViews.find(({ track }) => track.name === 'Kept viewer')
        .track.featureSource.getFeatures({ chr: 'chr15', start: 74749500, end: 74751500, bpPerPixel: 1 })
        .then(features => features.map(feature => feature.name))`)).toEqual(["SYNTHETIC_A/G"]);
      await page.evaluate("window.igv.removeBrowser(window.live)");
      expect(await listeners(session)).toEqual({ keyup: 0, resize: 0 });
    });
  });

  it("removes native keyboard and resize callbacks across repeated normal disposal", async () => {
    await fixture(entry, async (page, session) => {
      for (let index = 0; index < 3; index++) {
        await page.evaluate("window.igv.createBrowser(document.querySelector('#live'), window.config('Synthetic viewer')).then(browser => { window.live = browser; })");
        expect(await listeners(session)).toEqual({ keyup: 1, resize: 1 });
        expect(await page.locator("#live canvas").count()).toBeGreaterThan(0);
        await page.evaluate("window.igv.removeBrowser(window.live)");
        expect(await listeners(session)).toEqual({ keyup: 0, resize: 0 });
        expect(await page.locator("#live .igv-container").count()).toBe(0);
      }
    });
  });
});
