import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installKeyboardAudit } from "../e2e/keyboard-traversal";
import { auditTextAlternatives } from "../e2e/text-alternatives";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(html: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  try {
    await page.setContent(html);
    await page.evaluate(installKeyboardAudit);
    await run(page);
  } finally { await page.close(); }
}

describe("text alternatives across the composed chart tree", () => {
  it("detects unnamed shadow canvases and refuses an unrelated search table", async () => {
    await fixture('<table><tr><td>Other search results</td></tr></table><div id="viewer" data-testid="genome-browser"></div>', async page => {
      await page.evaluate(() => {
        document.querySelector("#viewer")!.attachShadow({ mode: "open" }).innerHTML = "<div><canvas></canvas></div>";
      });
      const result = await page.evaluate(auditTextAlternatives);
      expect(result).toMatchObject({ checked: 1, canvases: 1, genomeCanvases: 1, disclosures: [] });
      expect(result.findings).toEqual([
        "canvas: no caption and no accessible name",
        "canvas: the picture exposes a canvas and no list or table restates them",
      ]);
    });
  });

  it("groups nested shadow and slotted canvases with their light-DOM figure and list", async () => {
    await fixture('<figure><figcaption>Current track</figcaption><div id="viewer" data-testid="genome-browser">'
      + '<canvas></canvas></div><dl><dt>chr15:74750501</dt><dd>A/G</dd></dl></figure>', async page => {
      await page.evaluate(() => {
        const root = document.querySelector("#viewer")!.attachShadow({ mode: "open" });
        root.innerHTML = '<slot></slot><div id="nested"></div>';
        root.querySelector("#nested")!.attachShadow({ mode: "open" }).innerHTML = "<canvas></canvas>";
      });
      expect(await page.evaluate(auditTextAlternatives)).toEqual({
        checked: 1, canvases: 2, genomeCanvases: 2, findings: [], disclosures: [],
      });
    });
  });

  it("accepts a same-shadow IDREF list itself and rejects a cross-shadow ID collision", async () => {
    await fixture('<p id="caption">Unrelated outside name</p><dl id="list"><dt>Outside</dt><dd>Value</dd></dl>'
      + '<div id="viewer"></div>', async page => {
      await page.evaluate(() => {
        document.querySelector("#viewer")!.attachShadow({ mode: "open" }).innerHTML =
          '<section><canvas aria-labelledby="caption" aria-details="list"></canvas></section>';
      });
      expect((await page.evaluate(auditTextAlternatives)).findings).toHaveLength(2);
      await page.evaluate(() => {
        document.querySelector("#viewer")!.shadowRoot!.innerHTML +=
          '<p id="caption">Current calls</p><dl id="list"><dt>rs1</dt><dd>A/G</dd></dl>';
      });
      expect((await page.evaluate(auditTextAlternatives)).findings).toEqual([]);
    });
  });

  it("ignores hidden graphics and unnamed SVG icons, but counts every visible canvas", async () => {
    await fixture('<div aria-hidden="true"><canvas></canvas></div><canvas hidden></canvas>'
      + '<svg><path d="M0 0"></path></svg><canvas aria-label="Calls"></canvas>', async page => {
      const result = await page.evaluate(auditTextAlternatives);
      expect(result).toMatchObject({ checked: 1, canvases: 1, genomeCanvases: 0 });
      expect(result.findings).toEqual(['canvas "Calls": the picture exposes a canvas and no list or table restates them']);
    });
  });

  it("rejects a hidden equivalent and never substitutes another figure's list", async () => {
    await fixture('<section><figure id="chart"><figcaption>Calls</figcaption><canvas></canvas>'
      + '<dl hidden><dt>rs1</dt><dd>A/G</dd></dl></figure>'
      + '<figure><figcaption>Other chart</figcaption><dl><dt>Other</dt><dd>Value</dd></dl></figure></section>', async page => {
      const first = await page.evaluate(auditTextAlternatives);
      expect(first.findings).toHaveLength(1);
      expect(first.findings[0]).toContain("is in the DOM but is not rendered");
      await page.locator("#chart dl").evaluate(element => element.remove());
      const second = await page.evaluate(auditTextAlternatives);
      expect(second.findings).toHaveLength(1);
      expect(second.findings[0]).toContain("no list or table restates them");
    });
  });

  it("opens nested shadow disclosures in keyboard order and rejects an absent summary", async () => {
    await fixture('<figure><figcaption>Calls</figcaption><canvas></canvas><div id="viewer"></div></figure>', async page => {
      await page.evaluate(() => {
        document.querySelector("#viewer")!.attachShadow({ mode: "open" }).innerHTML =
          '<details><summary>Calls</summary><details><summary>Raw calls</summary>'
          + '<dl><dt>rs1</dt><dd>A/G</dd></dl></details></details>';
      });
      const result = await page.evaluate(auditTextAlternatives);
      expect(result.findings).toEqual([]);
      expect(result.disclosures.map(disclosure => disclosure.index)).toEqual([0, 1]);
      for (const disclosure of result.disclosures) {
        await page.locator(`[data-g113b-disclosure="${disclosure.index}"]`).focus();
        await page.keyboard.press("Enter");
      }
      expect(await page.locator("dl").isVisible()).toBe(true);
      await page.evaluate(() => {
        document.querySelector("#viewer")!.shadowRoot!.innerHTML =
          '<details><dl><dt>rs1</dt><dd>A/G</dd></dl></details>';
      });
      expect((await page.evaluate(auditTextAlternatives)).findings.join("\n"))
        .toContain("no keyboard-reachable <summary>");
    });
  });

  it("allows a truly empty grey SVG only with visible prose outside its caption", async () => {
    await fixture('<section><figure><figcaption>Map</figcaption><svg aria-hidden="true"></svg></figure></section>', async page => {
      expect((await page.evaluate(auditTextAlternatives)).findings.join("\n"))
        .toContain("no sentence beside it");
      await page.locator("section").evaluate(element => element.insertAdjacentHTML("beforeend", "<p>Too few calls were read.</p>"));
      expect((await page.evaluate(auditTextAlternatives)).findings).toEqual([]);
    });
  });

  it("rechecks the actual equivalent after opening a disclosure, catching content that stays hidden", async () => {
    await fixture('<figure><figcaption>Calls</figcaption><canvas></canvas><details><summary>Raw calls</summary>'
      + '<dl hidden><dt>rs1</dt><dd>A/G</dd></dl></details></figure>', async page => {
      const closed = await page.evaluate(auditTextAlternatives);
      expect(closed.disclosures).toHaveLength(1);
      await page.locator('[data-g113b-disclosure="0"]').focus();
      await page.keyboard.press("Enter");
      expect(await page.locator("details").evaluate(element =>
        element instanceof HTMLDetailsElement && element.open)).toBe(true);
      const opened = await page.evaluate(auditTextAlternatives);
      expect(opened.disclosures).toEqual([]);
      expect(opened.findings.join("\n")).toContain("is in the DOM but is not rendered");
      await page.locator("dl").evaluate(element => element.removeAttribute("hidden"));
      expect((await page.evaluate(auditTextAlternatives)).findings).toEqual([]);
    });
  });
});
