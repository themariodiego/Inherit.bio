import { readFileSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIgvBrowser } from "../src/components/browse/igv-lifecycle";
import { configureIgvNavigation } from "../src/components/browse/igv-navigation";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { enhanceIgvInteractions } from "../src/components/browse/igv-interactions";
import { enhanceIgvPopovers } from "../src/components/browse/igv-popovers";
import { enhanceIgvTrackScrolling } from "../src/components/browse/igv-track-scrolling";
import { IGV_CONTROL_LABELS } from "../src/copy/genome/data";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

describe("detached native genome viewer", () => {
  it("yields to route rendering and passive cleanup with a mutation already queued", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(5_000);
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://fixture.invalid") return route.abort();
      if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
      return route.fulfill({ contentType: "text/html", body: '<main><div id="widget" style="width:1000px"></div></main>' });
    });
    try {
      await page.goto("http://fixture.invalid");
      await page.addScriptTag({ type: "module", content: 'import igv from "/igv.js"; window.igv = igv;' });
      await page.waitForFunction("typeof window.igv?.createBrowser === 'function'");
      await page.evaluate(`globalThis.__name = value => value;
        window.controller = new AbortController();
        (${createIgvBrowser.toString()})(window.igv, document.querySelector('#widget'), {
          loadDefaultGenomes: false, search: false, queryParametersSupported: false,
          showChromosomeWidget: false, showSVGButton: false, showSampleNameButton: false,
          showMultiSelectButton: false, showTrackLabelButton: false, showCenterGuideButton: false,
          showCursorTrackingGuideButton: false,
          reference: { id: 'synthetic-grch38', format: 'chromsizes',
            fastaURL: new File(['chr15\\t101991189\\n'], 'synthetic.chrom.sizes') },
          locus: 'chr15:74749500-74751500', tracks: [{ name: 'Synthetic', type: 'annotation', format: 'bed',
            features: [{ chr: 'chr15', start: 74750500, end: 74750501, name: 'SYNTHETIC_A/G' }] }]
        }, window.controller.signal, 30_000).then(result => { window.viewer = result; });`);
      await page.waitForFunction("!!window.viewer");
      await page.evaluate(`
        // Bound a regression's infinite microtask loop so it reports a failed
        // assertion instead of hanging the test process. The cutoff must stay unused.
        const NativeObserver = window.MutationObserver;
        window.mutationCallbacks = 0; window.observerCutoff = false;
        window.MutationObserver = class extends NativeObserver {
          constructor(callback) {
            super((records, observer) => {
              if (++window.mutationCallbacks > 100) { window.observerCutoff = true; observer.disconnect(); return; }
              callback(records, observer);
            });
          }
        };
        const { browser, element } = window.viewer;
        (${configureIgvNavigation.toString()})(browser);
        (${labelIgvControls.toString()})(element, ${JSON.stringify(IGV_CONTROL_LABELS)});
        window.disposeInteractions = (${enhanceIgvInteractions.toString()})(element, ${JSON.stringify(IGV_CONTROL_LABELS)}, browser);
        window.disposeScrolling = (${enhanceIgvTrackScrolling.toString()})(element, ${JSON.stringify(IGV_CONTROL_LABELS)}, browser);
        window.disposePopovers = (${enhanceIgvPopovers.toString()})(element, ${JSON.stringify(IGV_CONTROL_LABELS)}, browser);`);
      const position = page.getByRole("textbox", { name: "Search by position", exact: true });
      await position.fill("INHERIT_UNKNOWN_SYNTHETIC_POSITION");
      await position.press("Enter");
      await page.getByRole("dialog", { name: "Track message", exact: true })
        .getByRole("button", { name: "OK", exact: true }).click();
      const before = await page.evaluate("window.mutationCallbacks") as number;
      const outcome = await page.evaluate(`new Promise(resolve => {
        const host = document.querySelector('#widget');
        const viewport = window.viewer.element.shadowRoot.querySelector('.igv-viewport');
        // A native layout update can already be queued when React detaches the
        // old page. Passive-effect disposal runs in a later task, not this microtask.
        viewport.style.height = '101px';
        host.remove();
        setTimeout(() => {
          window.disposeInteractions(); window.disposeScrolling(); window.disposePopovers();
          window.controller.abort();
          const heading = document.createElement('h1'); heading.textContent = 'Next page';
          document.querySelector('main').appendChild(heading);
          resolve({ cutoff: window.observerCutoff, callbacks: window.mutationCallbacks,
            nativeRoots: window.viewer.element.shadowRoot.querySelectorAll('.igv-container').length });
        }, 0);
      })`) as { cutoff: boolean; callbacks: number; nativeRoots: number };
      expect(outcome.cutoff).toBe(false);
      expect(outcome.callbacks).toBeGreaterThan(before);
      expect(outcome.callbacks).toBeLessThanOrEqual(100);
      expect(outcome.nativeRoots).toBe(0);
      expect(await page.getByRole("heading", { name: "Next page", exact: true }).isVisible()).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
});
