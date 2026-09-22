import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { escapeLeavesTheTrap, installKeyboardAudit, tabThrough } from "../e2e/keyboard-traversal";
import { labelIgvControls } from "../src/components/browse/igv-accessibility";
import { IGV_CONTROL_LABELS } from "../src/copy/genome/data";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  try {
    await page.setContent('<button id="before">Before</button><p id="hint">Press Escape to leave.</p>'
      + '<div id="widget" role="region" aria-label="Widget" aria-describedby="hint"></div>'
      + '<button id="after">After</button>');
    await page.evaluate(() => {
      document.querySelector("#widget")!.attachShadow({ mode: "open" }).innerHTML =
        '<button id="one">One</button><button id="two">Two</button>';
    });
    await page.evaluate(installKeyboardAudit);
    await run(page);
  } finally { await page.close(); }
}

describe("keyboard sweep using actual focused elements across shadow roots", () => {
  it("visits distinct controls instead of reporting their common shadow host as a trap", async () => {
    await fixture(async page => {
      const pass = await tabThrough(page);
      expect(pass).toMatchObject({ stops: 4, expected: 4, exit: "left-document", violations: [], unreached: [] });
      // Restore the previous reader: it mistakes the next inner control for
      // a repeat of the host, reproducing the ledger's former trap finding.
      await page.evaluate(() => { window.__keyboardAudit!.active = () => document.activeElement; });
      expect((await tabThrough(page)).exit).toBe("trapped");
    });
  });

  it("follows nested shadow roots and slotted controls in their rendered order", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        const widget = document.querySelector("#widget")!;
        widget.innerHTML = '<button id="slotted">Slotted</button>';
        widget.shadowRoot!.innerHTML = '<button id="one">One</button><div id="nested"></div><slot></slot>';
        widget.shadowRoot!.querySelector("#nested")!.attachShadow({ mode: "open" }).innerHTML =
          '<button id="nested-control">Nested</button>';
      });
      expect(await tabThrough(page)).toMatchObject({ stops: 5, expected: 5, violations: [], unreached: [] });
    });
  });

  it("still detects a real cycle inside a shadow root", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        const root = document.querySelector("#widget")!.shadowRoot!;
        root.querySelector("#two")!.addEventListener("keydown", event => {
          if ((event as KeyboardEvent).key === "Tab") {
            event.preventDefault();
            (root.querySelector("#one") as HTMLElement).focus();
          }
        });
      });
      const pass = await tabThrough(page);
      expect(pass.exit).toBe("trapped");
      expect(pass.violations.join("\n")).toContain('focus returned to button#one "One"');
      expect(pass.unreached).toContain('button#after "After"');
    });
  });

  it("still detects backward focus order across the shadow boundary", async () => {
    await fixture(async page => {
      await page.locator("#two").evaluate(element => element.setAttribute("tabindex", "1"));
      expect((await tabThrough(page)).violations.join("\n")).toContain("moves backwards in the DOM");
    });
  });

  it("names a skipped shadow control even when Tab eventually leaves the page", async () => {
    await fixture(async page => {
      await page.locator("#one").evaluate(element => element.addEventListener("keydown", event => {
        if ((event as KeyboardEvent).key === "Tab") {
          event.preventDefault();
          (document.querySelector("#after") as HTMLElement).focus();
        }
      }));
      const pass = await tabThrough(page);
      expect(pass.exit).toBe("left-document");
      expect(pass.unreached).toEqual(['button#two "Two"']);
    });
  });

  it("checks the advertised escape from within a shadow root, rejecting missing and backward escapes", async () => {
    await fixture(async page => {
      await page.locator("#one").focus();
      expect(await escapeLeavesTheTrap(page)).toContain("inside the trap");
      await page.evaluate(() => {
        document.querySelector("#widget")!.addEventListener("keydown", event => {
          if ((event as KeyboardEvent).key === "Escape") {
            const target = document.querySelector("#widget")!.getAttribute("data-escape") ?? "after";
            (document.getElementById(target) as HTMLElement).focus();
          }
        });
      });
      expect(await escapeLeavesTheTrap(page)).toBeNull();
      await page.locator("#widget").evaluate(element => element.setAttribute("data-escape", "before"));
      await page.locator("#one").focus();
      expect(await escapeLeavesTheTrap(page)).toContain("BACKWARDS");
      await page.locator("#widget").evaluate(element => element.removeAttribute("aria-describedby"));
      await page.locator("#one").focus();
      expect(await escapeLeavesTheTrap(page)).toContain("does not name a key");
    });
  });

  it.each([320, 800, 1200])("traverses the installed genome widget at %i px and exits normally", async width => {
    const page = await browser.newPage({ viewport: { width: width === 320 ? 390 : 1280, height: 844 } });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://fixture.invalid") return route.abort();
      if (url.pathname === "/igv.esm.js") return route.fulfill({ contentType: "text/javascript",
        body: readFileSync("node_modules/igv/dist/igv.esm.js") });
      if (url.pathname === "/sizes") return route.fulfill({ contentType: "text/plain",
        body: readFileSync("public/genomes/hg38.chrom.sizes") });
      if (url.pathname !== "/") return route.abort();
      return route.fulfill({ contentType: "text/html", body: '<button>Before</button>'
        + `<div id="widget" style="width:${width}px;overflow-x:auto"></div><button>After</button>` });
    });
    try {
      await page.goto("http://fixture.invalid");
      await page.addScriptTag({ type: "module", content: `
        import igv from "/igv.esm.js";
        await igv.createBrowser(document.querySelector("#widget"), {
          loadDefaultGenomes: false, showChromosomeWidget: false, showSVGButton: false,
          showSampleNameButton: false, showMultiSelectButton: false, showTrackLabelButton: false,
          showCenterGuideButton: false, showCursorTrackingGuideButton: false,
          reference: { id: "positions", format: "chromsizes", fastaURL: "/sizes" },
          locus: "chr1:10000-20000", tracks: [{
            name: "Synthetic positions", type: "annotation", format: "bed", displayMode: "EXPANDED",
            features: [{ chr: "chr1", start: 14999, end: 15000, name: "Synthetic A/G" }],
          }],
        });
        document.body.dataset.igvReady = "true";
      ` });
      await page.waitForFunction(() => document.body.dataset.igvReady === "true");
      await page.evaluate(installKeyboardAudit);
      expect(await tabThrough(page)).toMatchObject({ stops: width === 1200 ? 4 : 3,
        expected: width === 1200 ? 4 : 3, exit: "left-document", violations: [], unreached: [] });
      const search = page.locator("input.igv-search-input");
      expect((await search.boundingBox())!.height).toBeLessThan(44);
      // Evaluate the actual self-contained adapter in Chromium's DOM.
      await page.evaluate(`(${labelIgvControls.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)})`);
      // An effect can enhance the same subtree again; one key still means one action.
      await page.evaluate(`(${labelIgvControls.toString()})(document.querySelector("#widget"), ${JSON.stringify(IGV_CONTROL_LABELS)})`);
      const controls = page.locator('#widget input, #widget [role="button"]');
      for (const control of await controls.all()) {
        if (!await control.isVisible()) continue;
        const box = await control.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const accessible = await tabThrough(page);
      expect(accessible).toMatchObject({ exit: "left-document", violations: [], unreached: [] });
      expect(accessible.stops).toBe(accessible.expected);
      const stops = await page.evaluate(() => window.__keyboardAudit!.tab.names);
      expect(stops).toContain('div "Go to position"');
      if (width === 1200) {
        for (const name of ["Zoom out", "Zoom level", "Zoom in"]) {
          expect(stops.some(stop => stop.endsWith(`"${name}"`))).toBe(true);
        }
      }
      const go = page.getByRole("button", { name: IGV_CONTROL_LABELS.locusSubmit, exact: true });
      await go.evaluate(element => element.addEventListener("click", () => {
        element.setAttribute("data-activated", String(Number(element.getAttribute("data-activated") ?? 0) + 1));
      }));
      await go.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      expect(await go.getAttribute("data-activated")).toBe("2");
    } finally { await page.close(); }
  });
});
