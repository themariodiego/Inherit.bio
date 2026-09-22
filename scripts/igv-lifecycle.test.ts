import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIgvBrowser } from "../src/components/browse/igv-lifecycle";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://fixture.invalid") { external.push(url.origin); return route.abort(); }
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
    return route.fulfill({ contentType: "text/html", body: '<div id="widget" style="width:1000px;height:400px"></div>' });
  });
  try {
    await page.goto("http://fixture.invalid");
    await page.evaluate(`globalThis.__name = value => value; window.createViewer = ${createIgvBrowser.toString()};`);
    await page.addScriptTag({ type: "module", content: `
      import igv from "/igv.js";
      window.igv = igv; window.records = []; window.reads = 0; window.creations = 0;
      window.api = {
        async createBrowser(element, config) {
          window.creations++;
          const native = await igv.createBrowser(element, config);
          const record = { native, removed: 0, keyup: 0, resize: 0, registry: 0 };
          // Observe only this fixture instance's callbacks, without replacing
          // any EventTarget, document, window or network methods.
          native.getSelectedTrackViews = () => { record.keyup++; return []; };
          native.calculateViewportWidth = () => 1000;
          native.updateReferenceFrames = () => { record.resize++; };
          native.updateViewportElements = () => {};
          native.syncUIState = async () => {};
          native.visibilityChange = async () => { record.registry++; };
          window.records.push(record); return native;
        },
        removeBrowser(native) { window.records.find(record => record.native === native).removed++; igv.removeBrowser(native); }
      };
      window.start = (name, delayed = false, timeout = 5000) => {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        class ReferenceFile extends File {
          async arrayBuffer() { if (delayed) { window.reads++; await held; } return super.arrayBuffer(); }
        }
        const reference = new ReferenceFile(['chr15\\t101991189\\n'], 'synthetic.chrom.sizes');
        const control = new AbortController();
        const config = { loadDefaultGenomes: false, search: false, queryParametersSupported: false,
          reference: { id: "synthetic-grch38", format: "chromsizes", fastaURL: reference },
          locus: "chr15:74749500-74751500", tracks: [{ name, type: "annotation", format: "bed",
            features: [{ chr: "chr15", start: 74750500, end: 74750501, name: "A/G" }] }] };
        const ready = window.createViewer(window.api, document.querySelector('#widget'), config, control.signal, timeout);
        const result = ready.then(value => ({ status: 'ready', value }), error => ({ status: 'error', error: error.message }));
        const attempt = { control, release, result }; window[name] = attempt; return attempt;
      };
      window.observe = async () => {
        for (const record of window.records) record.keyup = record.resize = record.registry = 0;
        document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
        window.dispatchEvent(new Event('resize')); await igv.visibilityChange();
        return window.records.map(record => ({ removed: record.removed, keyup: record.keyup,
          resize: record.resize, registry: record.registry, connected: record.native.root.isConnected }));
      };
      window.ready = true;
    ` });
    await page.waitForFunction(() => Reflect.get(window, "ready") === true);
    await run(page);
    expect(external).toEqual([]);
  } finally { await context.close(); }
}

const removed = { removed: 1, keyup: 0, resize: 0, registry: 0, connected: false };
const active = { removed: 0, keyup: 1, resize: 1, registry: 1, connected: true };

describe("installed genome viewer lifecycle", () => {
  it("releases the shadow root, registry and native listeners exactly once while preserving other listeners", async () => {
    await fixture(async page => {
      await page.evaluate(`window.start('first'); window.unrelated = { keyup: 0, resize: 0 };
        document.addEventListener('keyup', () => window.unrelated.keyup++);
        window.addEventListener('resize', () => window.unrelated.resize++);`);
      expect(await page.evaluate("window.first.result.then(result => result.status)")).toBe("ready");
      expect(await page.locator(".igv-container canvas").count()).toBeGreaterThan(0);
      await page.evaluate("window.first.control.abort(); window.first.control.abort();");
      expect(await page.evaluate("window.observe()")).toEqual([removed]);
      expect(await page.evaluate("window.unrelated")).toEqual({ keyup: 1, resize: 1 });
      expect(await page.locator("#widget > div").count()).toBe(0);
    });
  });

  it("disposes late initialization after unmount without removing the newer viewer", async () => {
    await fixture(async page => {
      await page.evaluate("window.start('old', true)");
      await page.waitForFunction(() => Reflect.get(window, "reads") === 1);
      await page.evaluate("window.old.control.abort();");
      expect(await page.locator("#widget > div").count()).toBe(0);
      await page.evaluate("window.start('next')");
      expect(await page.evaluate("window.next.result.then(result => result.status)")).toBe("ready");
      await page.evaluate("window.old.release()");
      await page.waitForFunction("window.records.length === 2 && window.records[1].removed === 1");
      expect(await page.evaluate("window.observe()")).toEqual([active, removed]);
      expect(await page.locator(".igv-container").count()).toBe(1);
      expect(await page.evaluate("window.old.result.then(result => result.status)")).toBe("error");
      await page.evaluate("window.next.control.abort()");
      expect(await page.evaluate("window.observe()")).toEqual([removed, removed]);
    });
  });

  it("detaches a timed-out host immediately and releases the native instance when it eventually finishes", async () => {
    await fixture(async page => {
      await page.evaluate("window.start('slow', true, 25)");
      await page.waitForFunction(() => Reflect.get(window, "reads") === 1);
      expect(await page.evaluate("window.slow.result")).toEqual({ status: "error", error: "igv.createBrowser timed out after 25ms" });
      expect(await page.locator("#widget > div").count()).toBe(0);
      await page.evaluate("window.slow.release()");
      await page.waitForFunction("window.records.length === 1 && window.records[0].removed === 1");
      expect(await page.evaluate("window.observe()")).toEqual([removed]);
      await page.evaluate("window.slow.control.abort()");
      expect(await page.evaluate("window.observe()")).toEqual([removed]);
    });
  });

  it("keeps one native viewer through repeated region replacements", async () => {
    await fixture(async page => {
      for (let index = 0; index < 3; index++) {
        await page.evaluate(`window.start('view${index}')`);
        expect(await page.evaluate(`window.view${index}.result.then(result => result.status)`)).toBe("ready");
        expect(await page.locator(".igv-container").count()).toBe(1);
        expect(await page.evaluate("window.observe()")).toEqual([...Array(index).fill(removed), active]);
        await page.evaluate(`window.view${index}.control.abort()`);
      }
      expect(await page.evaluate("window.observe()")).toEqual([removed, removed, removed]);
    });
  });

  it("does not start an already-cancelled creation", async () => {
    await fixture(async page => {
      expect(await page.evaluate(`window.createViewer(window.api, document.querySelector('#widget'), {}, AbortSignal.abort(), 5000)
        .then(() => 'ready', () => 'cancelled')`)).toBe("cancelled");
      expect(await page.evaluate("window.creations")).toBe(0);
      expect(await page.locator("#widget > div").count()).toBe(0);
    });
  });

  it("removes its empty host when initialization rejects", async () => {
    await fixture(async page => {
      expect(await page.evaluate(`window.createViewer({ createBrowser: async () => { throw new Error('synthetic refusal'); },
        removeBrowser: () => { throw new Error('no instance exists'); } }, document.querySelector('#widget'), {}, new AbortController().signal, 5000)
        .then(() => 'ready', error => error.message)`)).toBe("synthetic refusal");
      expect(await page.locator("#widget > div").count()).toBe(0);
    });
  });
});
