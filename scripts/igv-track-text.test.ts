import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VariantRecord } from "../src/lib/genome/types";
import { createLoadedTrack, observeTrackText, type TrackTextSnapshot } from "../src/components/browse/igv-track-data";
import { TrackTextAlternative } from "../src/components/browse/track-text-alternative";
import { configureIgvNavigation } from "../src/components/browse/igv-navigation";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { enhanceIgvInteractions } from "../src/components/browse/igv-interactions";
import { enhanceIgvPopovers } from "../src/components/browse/igv-popovers";
import { IGV_CONTROL_LABELS, TRACK_OUTSIDE_NOTE, TRACK_REMOVED_NOTE, TRACK_TRUNCATED_NOTE } from "../src/copy/genome/data";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
const subjectId = "12345678-1234-4234-8234-000000000001";
const variants: VariantRecord[] = [
  { rsid: 1, chrom: 15, pos: 74750001, ref: "A", alt: "G", genotype: "A/G" },
  { rsid: 2, chrom: 15, pos: 74750501, ref: "C", alt: "T", genotype: "T/T" },
  { rsid: null, chrom: 15, pos: 74751001, ref: null, alt: null, genotype: "--" },
];

async function ready(page: Page) {
  await page.waitForFunction("window.snapshot?.status === 'ready'");
  return page.evaluate<TrackTextSnapshot>("window.snapshot");
}

async function renderText(page: Page, truncated = false) {
  const snapshot = await page.evaluate<TrackTextSnapshot>("window.snapshot");
  const html = renderToStaticMarkup(createElement(TrackTextAlternative, {
    subjectId, loadedRange: "chr15:74749500-74751500", truncated, snapshot,
  }));
  await page.locator("#text").evaluate((element, markup) => { element.innerHTML = markup; }, html);
  return snapshot;
}

async function fixture(width: number, theme: string, run: (page: Page) => Promise<void>, data = variants) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5_000);
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://fixture.invalid") { external.push(url.href); return route.abort(); }
    if (url.pathname === "/igv.js") return route.fulfill({ contentType: "text/javascript", body: readFileSync("node_modules/igv/dist/igv.esm.js") });
    if (url.pathname !== "/") { external.push(url.href); return route.abort(); }
    return route.fulfill({ contentType: "text/html", body: `<html lang="en"><head><title>Track calls</title><style>
      body{margin:8px;color:${theme === "dark" ? "#eee;background:#171f1a" : "#222;background:white"}}
      figure{margin:0} [data-track-feature]{overflow-wrap:anywhere} #widget{width:100%;overflow-x:auto}
      </style></head><body><main><h1>Track calls</h1><figure aria-label="Calls drawn in this view"><div id="widget"></div><div id="text"></div></figure></main></body></html>` });
  });
  const loaded = createLoadedTrack(data);
  try {
    await page.goto("http://fixture.invalid");
    await page.addScriptTag({ type: "module", content: `
      import igv from '/igv.js';
      globalThis.__name = value => value;
      window.features = ${JSON.stringify(loaded.features)};
      const records = ${JSON.stringify(loaded.features.map(feature => loaded.rows.get(feature)))};
      window.rows = new WeakMap(window.features.map((feature, index) => [feature, records[index]]));
      window.testIgv = await igv.createBrowser(document.querySelector('#widget'), {
        loadDefaultGenomes:false, search:false, queryParametersSupported:false,
        showChromosomeWidget:false, showSVGButton:false, showSampleNameButton:false,
        showMultiSelectButton:false, showTrackLabelButton:false, showCenterGuideButton:false, showCursorTrackingGuideButton:false,
        reference:{id:'hg38-positions',format:'chromsizes',fastaURL:new File([${JSON.stringify(readFileSync("public/genomes/hg38.chrom.sizes", "utf8"))}], 'sizes')},
        locus:'chr15:74749500-74751500', tracks:[{id:'calls',name:'Synthetic calls',type:'annotation',format:'bed',displayMode:'EXPANDED',features:window.features}]
      });
      (${configureIgvNavigation.toString()})(window.testIgv);
      (${labelIgvControls.toString()})(document.querySelector('#widget'), ${JSON.stringify(IGV_CONTROL_LABELS)});
      (${enhanceIgvInteractions.toString()})(document.querySelector('#widget'), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);
      (${enhanceIgvPopovers.toString()})(document.querySelector('#widget'), ${JSON.stringify(IGV_CONTROL_LABELS)}, window.testIgv);
      let initialReady;
      const initial = new Promise(resolve => { initialReady = resolve; });
      window.stopText = (${observeTrackText.toString()})(window.testIgv, 'calls', {
        chromosome:'chr15',start:74749500,end:74751500,rows:window.rows
      }, snapshot => { window.snapshot = snapshot; if (snapshot.status === 'ready') initialReady(snapshot); });
      window.initialSnapshot = await initial;
      await window.testIgv.search('chr15:74749500-74751500');
      document.body.dataset.ready = 'true';
    ` });
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await ready(page).catch(async error => {
      throw new Error(`${String(error)}; ${JSON.stringify({ errors, external, state: await page.evaluate(`({
        snapshot:window.snapshot, tracks:window.testIgv?.trackViews.map(view=>({id:view.track.config?.id,type:view.track.type})),
        keys:window.testIgv?.trackViews.find(view=>view.track.config?.id==='calls')?.track.featureSource?.getAllFeatures()
      })`) })}`);
    });
    await run(page);
    expect(errors).toEqual([]); expect(external).toEqual([]);
  } finally { await context.close(); }
}

describe("native current-track text equivalence", () => {
  it.each([320, 390, 1280].flatMap(width => ["light", "dark"].map(theme => ({ width, theme }))))(
    "exposes every call without an action at $width px in $theme", async ({ width, theme }) => {
      await fixture(width, theme, async page => {
        const snapshot = await renderText(page);
        expect(snapshot.views[0].outsideLoadedRange).toBe(false);
        expect(await page.evaluate('window.initialSnapshot.views[0].outsideLoadedRange')).toBe(false);
        expect(snapshot.views[0].rows.map(row => row.genotype)).toEqual(["A/G", "T/T", "--"]);
        expect(await page.locator('[data-track-feature]').count()).toBe(3);
        expect(await page.locator('[data-track-feature] [data-slot="figure-value"]').allTextContents()).toEqual(["A/G", "T/T", "--"]);
        expect(await page.locator('[data-subject-id]').getAttribute('data-subject-id')).toBe(subjectId);
        expect(await page.locator('#text button, #text input, #text [tabindex], #text details, #text [hidden]').count()).toBe(0);
        expect(await page.locator('#text [data-provenance="computed:genome/browser"]').count()).toBe(3);
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(audit.violations.map(item => item.id)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
    }, 30_000);

  it("keeps a pointer feature popup's full source identity in the text", async () => {
    await fixture(1280, "light", async page => {
      await renderText(page);
      const track = page.getByRole('group', { name: 'Track actions: Synthetic calls', exact: true });
      const x = await page.evaluate<number>(`(() => {
        const frame = window.testIgv.trackViews.find(view => view.track.config?.id === 'calls').viewports[0].referenceFrame;
        return (74750000.5 - frame.start) / frame.bpPerPixel;
      })()`);
      await track.click({ position: { x, y: 15 } });
      const dialog = page.getByRole('dialog', { name: 'Position details', exact: true });
      await dialog.waitFor();
      expect(await dialog.textContent()).toContain('rs1 A/G (A→G)');
      expect(await dialog.textContent()).toContain('chr15:74,750,001-74,750,001');
      const row = page.locator('[data-track-feature="15:74750001:0"]');
      expect(await row.textContent()).toContain('rs1');
      expect(await row.textContent()).toContain('chr15:74750001 A→G');
      expect(await row.locator('[data-slot="figure-value"]').textContent()).toBe('A/G');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    });
  });

  it("updates after pointer pan, keyboard zoom, locus search and resize without a new region request", async () => {
    await fixture(1280, "light", async page => {
      const original = (await ready(page)).views[0].range;
      const track = page.getByRole('group', { name: 'Track actions: Synthetic calls', exact: true });
      const box = (await track.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
      await page.waitForFunction(range => Reflect.get(window, "snapshot")?.views[0]?.range !== range, original);
      const panned = await ready(page);
      expect(panned.views[0].range).not.toBe(original);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).press('Enter');
      await page.waitForFunction(range => Reflect.get(window, "snapshot")?.views[0]?.range !== range, panned.views[0].range);
      const input = page.getByRole('textbox', { name: 'Search by position', exact: true });
      await input.fill('chr15:74750400-74750600'); await input.press('Enter');
      await page.waitForFunction("window.snapshot?.status === 'ready' && window.snapshot.views[0].rows.length === 1");
      expect((await renderText(page)).views[0].rows[0].rsid).toBe(2);
      await page.setViewportSize({ width: 390, height: 844 });
      await ready(page); await renderText(page);
      expect(await page.locator('[data-track-range]').textContent()).toBe((await ready(page)).views[0].range);
    });
  }, 30_000);

  it("preserves whole-genome identities and separate multi-locus view counts", async () => {
    await fixture(1280, "light", async page => {
      await page.evaluate("window.testIgv.search('chr15:74749900-74750100 chr15:74750400-74750600')");
      let snapshot = await ready(page);
      expect(snapshot.views.map(view => view.rows.map(row => row.rsid))).toEqual([[1], [2]]);
      await renderText(page);
      expect(await page.locator('[data-track-count]').evaluateAll(elements => elements.map(element => element.getAttribute('data-track-count')))).toEqual(['1', '1']);
      await page.evaluate("window.testIgv.search('all')");
      snapshot = await ready(page);
      expect(snapshot.views[0].rows.map(row => row.key)).toEqual(['15:74750001:0', '15:74750501:1', '15:74751001:2']);
      expect(snapshot.views[0].outsideLoadedRange).toBe(true);
      await renderText(page, true);
      expect(await page.getByText(TRACK_OUTSIDE_NOTE, { exact: true }).isVisible()).toBe(true);
      expect(await page.getByText(TRACK_TRUNCATED_NOTE, { exact: true }).isVisible()).toBe(true);
    });
  });

  it("reports an unloaded view and track removal without a false empty-file claim", async () => {
    await fixture(390, "dark", async page => {
      await page.evaluate("window.testIgv.search('chr1:100-1000')");
      expect((await ready(page)).views[0]).toMatchObject({ rows: [], outsideLoadedRange: true });
      await renderText(page);
      expect(await page.getByText(TRACK_OUTSIDE_NOTE, { exact: true }).isVisible()).toBe(true);
      expect(await page.locator('#text').textContent()).not.toContain('Your file has no variants');
      await page.evaluate("window.testIgv.removeTrack(window.testIgv.trackViews.find(view => view.track.config?.id === 'calls').track)");
      await page.waitForFunction("window.snapshot.status === 'removed'");
      await renderText(page);
      expect(await page.locator('[data-track-feature]').count()).toBe(0);
      expect(await page.getByRole('status').textContent()).toBe(TRACK_REMOVED_NOTE);
    });
  });

  it("restates all 500 loaded rows, including calls beyond the search table's separate limit", async () => {
    const data = Array.from({ length: 500 }, (_, index) => ({ ...variants[0], rsid: index + 1, pos: 74750001 + index }));
    await fixture(1280, "light", async page => {
      const snapshot = await renderText(page, true);
      expect(snapshot.views[0].rows.map(row => row.rsid)).toEqual(data.map(row => row.rsid));
      expect(await page.locator('[data-track-feature]').count()).toBe(500);
      expect(await page.locator('[data-track-count]').getAttribute('data-track-count')).toBe('500');
      expect(await page.locator('[data-track-feature]').last().textContent()).toContain('rs500');
      expect(await page.getByText(TRACK_TRUNCATED_NOTE, { exact: true }).isVisible()).toBe(true);
    }, data);
  }, 30_000);

  it("keeps an empty first region distinct from an unqueried region and emits no result figures", async () => {
    await fixture(320, "light", async page => {
      const snapshot = await renderText(page);
      expect(snapshot.views[0]).toMatchObject({ rows: [], outsideLoadedRange: false });
      expect(await page.evaluate('window.initialSnapshot.views[0]')).toMatchObject({ rows: [], outsideLoadedRange: false });
      expect(await page.locator('#text [data-figure-kind]').count()).toBe(0);
      expect(await page.locator('[data-track-count]').getAttribute('data-track-count')).toBe('0');
      expect(await page.locator('#text').textContent()).toContain('No variants from this track are in this view.');
      expect(await page.getByText(TRACK_OUTSIDE_NOTE, { exact: true }).count()).toBe(0);
    }, []);
  });
});
