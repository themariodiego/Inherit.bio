// The owner's density rule corrections of 2026-10-22 (docs/protocol/decisions.md,
// "Density rule corrections (G2.5)"): how the text-only floor is produced, how
// the three corrected readings are taken, and how the evaluator applies them.
// Every number below is an invented unit value or a synthetic page, never a
// captured measurement or acceptance.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTH_FLOW_TEN_CONTROL_ROUTE_IDS, DENSITY_CORRECTED_READINGS_MODULE_SHA256, evaluateDensityCapture, requiredDensityCaptures,
  SIGNED_LEGAL_DOCUMENT_ROUTE_IDS, TEXT_BOUND_ALLOWANCE_OF_PREDECESSOR, TEXT_ONLY_FLOOR_VARIANT_SHA256, verifyCurrentDensity,
  type DensityContract, type DensityCurrentPacket, type DensityRegister,
} from "./density-current";
import { captureTextOnlyFloor, readCorrectedDensity, TEXT_ONLY_FLOOR_CSS } from "./density-corrected-readings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const registerBytes = readFileSync(path.join(root, "docs/route-register.json"));
const register = JSON.parse(registerBytes.toString()) as DensityRegister;
const contract = JSON.parse(readFileSync(path.join(root, "docs/density-baseline.json"), "utf8")) as DensityContract & {
  measurementSelectors: Record<string, string>;
};
const required = requiredDensityCaptures(register);
type Capture = DensityCurrentPacket["captures"][number];
const environment: DensityCurrentPacket["captureEnvironment"] = {
  browserName: "chromium", browserVersion: "synthetic-unit-only", platform: "synthetic-unit-only",
  fontManifestSha256: "3".repeat(64), theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC",
};

describe("the text-only floor variant is pinned and touches no layout", () => {
  it("is exactly the pinned stylesheet in the pinned readings module", () => {
    expect(sha256(TEXT_ONLY_FLOOR_CSS)).toBe(TEXT_ONLY_FLOOR_VARIANT_SHA256);
    expect(sha256(readFileSync(path.join(root, "scripts/density-corrected-readings.mjs"))))
      .toBe(DENSITY_CORRECTED_READINGS_MODULE_SHA256);
  });
  it("sets only colour, fill, shadow and visibility properties, each important, and never the glyph colour", () => {
    const rules = [...TEXT_ONLY_FLOOR_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
      selector: selector.trim(), declarations: body.split(";").filter(Boolean).map(text => text.split(":")[0].trim()),
      important: body.split(";").filter(Boolean).every(text => text.trim().endsWith("!important")),
    }));
    expect(rules.map(rule => rule.selector)).toEqual([
      "*,*::before,*::after", "svg,img,picture,canvas,video,iframe,hr", "html,body"]);
    expect(rules.every(rule => rule.important)).toBe(true);
    expect(rules.flatMap(rule => rule.declarations).sort()).toEqual([
      "background-color", "background-color", "background-image", "border-color", "box-shadow",
      "outline-color", "text-decoration-color", "visibility"]);
    expect(TEXT_ONLY_FLOOR_CSS).not.toMatch(/(?:^|[;{])\s*(?:color|opacity|display|font[\w-]*|width|height|margin[\w-]*|padding[\w-]*|border-width|line-height|letter-spacing|position|transform|content|text-decoration\s*:)/u);
    expect(TEXT_ONLY_FLOOR_CSS).toContain("html,body{background-color:#f7f8f1!important}");
  });
});

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });
async function page(html: string, width = 1280, height = 800) {
  const value = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await value.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px/1.5 sans-serif;background:#f7f8f1;color:#14201b}
    main{padding:24px}</style></head><body><main>${html}</main></body></html>`);
  return value;
}
const boxes = (target: Page) => target.evaluate(() => [...document.querySelectorAll("body *")].map(element => {
  const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].join(",");
}).join(";") + "|" + [...document.querySelectorAll("body *")].flatMap(element => [...element.childNodes]
  .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent!.trim()).map(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    return [...range.getClientRects()].map(rect => [rect.x, rect.y, rect.width].join(",")).join(" ");
  })).join(";"));

describe("the text-only floor capture", () => {
  const decorated = `<header style="border-bottom:1px solid #76857b;padding:8px">Inherit <svg width="20" height="20"><circle cx="10" cy="10" r="9"/></svg></header>
    <p>A paragraph with <a href="/x" style="text-decoration:underline 2px">an underlined link</a>.</p>
    <button style="background:#2e5c45;color:#fff;border:2px solid #2e5c45;border-radius:999px;height:44px;padding:0 20px">Start</button>
    <div style="border:1px solid #76857b;background:#eef1e4;box-shadow:0 2px 6px #000;padding:16px">A card</div><hr>`;
  it("keeps every box and every glyph where it was while it is applied", async () => {
    const target = await page(decorated);
    try {
      const before = await boxes(target);
      await target.addStyleTag({ content: TEXT_ONLY_FLOOR_CSS });
      expect(await boxes(target)).toBe(before);
      const styles = await target.evaluate(() => {
        const button = getComputedStyle(document.querySelector("button")!);
        const card = getComputedStyle(document.querySelector("div")!);
        return { buttonBackground: button.backgroundColor, buttonBorder: button.borderTopColor, buttonText: button.color,
          cardShadow: card.boxShadow, cardBorder: card.borderTopColor, svg: getComputedStyle(document.querySelector("svg")!).visibility,
          link: getComputedStyle(document.querySelector("a")!).textDecorationColor, text: getComputedStyle(document.querySelector("p")!).color };
      });
      expect(styles).toEqual({ buttonBackground: "rgba(0, 0, 0, 0)", buttonBorder: "rgba(0, 0, 0, 0)", buttonText: "rgb(255, 255, 255)",
        cardShadow: "none", cardBorder: "rgba(0, 0, 0, 0)", svg: "hidden", link: "rgba(0, 0, 0, 0)", text: "rgb(20, 32, 27)" });
    } finally { await target.close(); }
  });
  it("returns the floor PNG and restores the page exactly", async () => {
    const target = await page(decorated);
    try {
      const before = await boxes(target);
      const product = await target.screenshot({ type: "png" });
      const floor = await captureTextOnlyFloor(target);
      expect(floor.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(sha256(floor)).not.toBe(sha256(product));
      expect(await boxes(target)).toBe(before);
      expect(await target.evaluate(() => getComputedStyle(document.querySelector("button")!).backgroundColor)).toBe("rgb(46, 92, 69)");
      expect(sha256(await target.screenshot({ type: "png" }))).toBe(sha256(product));
    } finally { await target.close(); }
  });
});

describe("the corrected readings on synthetic pages", () => {
  it("excludes one-line link paragraphs and link lists, and still reads a short real prose paragraph", async () => {
    const target = await page(`<p style="text-align:center">Forgot your password? <a href="/f">Reset it</a></p>
      <p><a href="/back">Back to Inherit</a></p>
      <ul><li><a href="/a">Privacy policy</a></li><li><a href="/b">Terms</a></li></ul>
      <p style="width:600px">${"A long prose paragraph with a link to <a href='/c'>the charter</a> that sets on several lines. ".repeat(4)}</p>
      <p style="width:300px">A real prose paragraph in a narrow column is still prose, and the floor still reads it.</p>`);
    try {
      const readings = await readCorrectedDensity(target, contract.measurementSelectors);
      expect(readings.excludedOneLineLinkParagraphCount).toBe(2);
      expect(readings.proseParagraphCount).toBe(2);
      // The narrow paragraph is the minimum and is under the floor: planted defect.
      expect(readings.minProseParagraphMeasureCh).toBeGreaterThan(25);
      expect(readings.minProseParagraphMeasureCh).toBeLessThan(45);
    } finally { await target.close(); }
  });
  it("reads side-by-side panes as one row and CSS-reordered sections in visual order", async () => {
    const target = await page(`<div style="display:flex;gap:24px"><section style="flex:1;height:200px">A</section>
      <section style="flex:1;height:240px">B</section></div><section style="margin-top:100px;height:100px">C</section>
      <div style="display:flex;flex-direction:column;gap:70px;margin-top:120px">
      <section style="order:2;height:80px">late in DOM, first on screen? no: second</section>
      <section style="order:1;height:80px">first on screen</section></div>`, 1280, 800);
    try {
      const readings = await readCorrectedDensity(target, contract.measurementSelectors);
      expect(readings.topLevelSectionRowCount).toBe(4);
      expect(readings.minimumVisualSectionGapPx).toBe(70);
      const { measure } = await import("./density-baseline/measure.mjs");
      const frozen = await measure(target, contract.measurementSelectors);
      expect(frozen.minimumAdjacentSectionGapPx).toBeLessThan(0);
    } finally { await target.close(); }
  });
  it("counts the visible part of a pre-formatted node, where the frozen count takes all of it", async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `Signed line ${index + 1} of the legal text.`).join("\n");
    const target = await page(`<h1>Signed document</h1><p style="white-space:pre-wrap">${lines}</p>`, 390, 844);
    try {
      const readings = await readCorrectedDensity(target, contract.measurementSelectors);
      const { measure } = await import("./density-baseline/measure.mjs");
      const frozen = await measure(target, contract.measurementSelectors);
      expect(frozen.visibleTextCharacters).toBeGreaterThan(6_000);
      expect(readings.aboveFoldTextCharacterCount).toBeGreaterThan(400);
      expect(readings.aboveFoldTextCharacterCount).toBeLessThan(2_000);
    } finally { await target.close(); }
  });
});

// Pure evaluator cases on invented metrics.
function capture(routeId: string, state: string, viewport: "390x844" | "1280x800", ink: number): { row: typeof required[number]; value: Capture } {
  const row = required.find(entry => entry.route.id === routeId && entry.state === state && entry.viewport === viewport)!;
  expect(row).toBeDefined();
  const [width, height] = viewport.split("x").map(Number);
  const pixels = width * height, inkPixelCount = Math.round(pixels * ink);
  const inkCoverageRatio = Number((inkPixelCount / pixels).toFixed(6));
  return { row, value: { routeId, state, viewport, measurementPath: row.route.path.replace(/\[[^\]]+\]/gu, "synthetic-unit"),
    metrics: { screenshotSha256: "4".repeat(64), screenshotWidthPx: width, screenshotHeightPx: height,
      includedPixelCount: pixels, excludedPixelCount: 0, inkPixelCount, inkCoverageRatio,
      whiteSpaceRatio: Number((1 - inkCoverageRatio).toFixed(6)), interactiveElementCount: 1, rawInteractiveElementCount: 11,
      rawDecoratedElementCount: 2, budgetedDecoratedElementCount: 2, visibleTextCharacterCount: 200,
      statusView: ({ "auth.sign-in": "Welcome back", "auth.sign-up": "Create your account" } as Record<string, string>)[routeId] ?? "Synthetic",
      proseElementCount: 1, maxProseMeasureCh: 60, minProseMeasureCh: 50,
      topLevelSectionCount: 1, minimumAdjacentSectionGapPx: null, primaryContentLeftPaddingPx: 24,
      primaryClaimTextElementCount: null, primaryClaimFigureCount: null, horizontalScroll: false, horizontalOverflowPx: 0 },
    predecessor: null } };
}
function withPredecessor(entry: ReturnType<typeof capture>, predecessorInk: number) {
  const baselineRoute = contract.relativeComparison.routes.find(item => item.successorRouteId === entry.row.route.id)!.baselineRoute;
  entry.value.predecessor = { baselineCommit: "864736979c92a08ba77e8580d61946eba6864918", baselineRoute,
    state: contract.routes.find(item => item.route === baselineRoute)!.state, captureEnvironment: { ...environment },
    screenshotSha256: "5".repeat(64), inkCoverageRatio: predecessorInk };
  return entry;
}
function withFloor(entry: ReturnType<typeof capture>, floorInk: number) {
  const m = entry.value.metrics, inkPixelCount = Math.round(m.includedPixelCount * floorInk);
  entry.value.textOnlyFloor = { variantSha256: TEXT_ONLY_FLOOR_VARIANT_SHA256, screenshotSha256: "6".repeat(64),
    screenshotWidthPx: m.screenshotWidthPx, screenshotHeightPx: m.screenshotHeightPx,
    includedPixelCount: m.includedPixelCount, excludedPixelCount: m.excludedPixelCount, inkPixelCount,
    inkCoverageRatio: Number((inkPixelCount / m.includedPixelCount).toFixed(6)) };
  return entry;
}
function withReadings(entry: ReturnType<typeof capture>, readings: Partial<NonNullable<Capture["correctedReadings"]>> = {}) {
  entry.value.correctedReadings = { moduleSha256: DENSITY_CORRECTED_READINGS_MODULE_SHA256, proseParagraphCount: 1,
    excludedOneLineLinkParagraphCount: 0, minProseParagraphMeasureCh: 50, topLevelSectionRowCount: 1,
    minimumVisualSectionGapPx: null, aboveFoldTextCharacterCount: 200, ...readings };
  return entry;
}
const evaluate = (entry: ReturnType<typeof capture>, rules: "contract" | "corrected-2026-10-22" = "corrected-2026-10-22") =>
  evaluateDensityCapture(entry.row, entry.value, contract, environment, rules);

describe("decision 1: a text-bound row passes within 0.05 of its predecessor above its own floor", () => {
  const predecessorInk = 0.08;
  it("passes at the allowance and not under the contract rules", () => {
    const entry = withFloor(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0748), predecessorInk), 0.0712);
    expect(entry.value.textOnlyFloor!.inkCoverageRatio / predecessorInk).toBeGreaterThan(0.6);
    const corrected = evaluate(entry).relative!;
    expect(corrected).toMatchObject({ within: true, textBound: true });
    expect(corrected.ratio - corrected.floorRatio!).toBeLessThanOrEqual(TEXT_BOUND_ALLOWANCE_OF_PREDECESSOR);
    expect(evaluate(entry, "contract").relative).toMatchObject({ within: false, textBound: false });
  });
  it("planted defect: a page 0.06 of its predecessor over its floor fails", () => {
    const entry = withFloor(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0712 + 0.06 * predecessorInk), predecessorInk), 0.0712);
    expect(evaluate(entry).relative).toMatchObject({ within: false, textBound: false });
  });
  it("planted defect: a floor at or under the ceiling grants nothing above the ceiling", () => {
    const entry = withFloor(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0496), predecessorInk), 0.0472);
    expect(entry.value.textOnlyFloor!.inkCoverageRatio).toBeLessThanOrEqual(predecessorInk * 0.6);
    expect(evaluate(entry).relative).toMatchObject({ within: false });
  });
  it("planted defects: a floor from another variant or another exclusion set is refused", () => {
    const foreign = withFloor(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0752), predecessorInk), 0.0712);
    foreign.value.textOnlyFloor!.variantSha256 = "7".repeat(64);
    expect(() => evaluate(foreign)).toThrow(/Inconsistent text-only floor/u);
    const excluded = withFloor(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0752), predecessorInk), 0.0712);
    excluded.value.textOnlyFloor!.excludedPixelCount = 10; excluded.value.textOnlyFloor!.includedPixelCount -= 10;
    expect(() => evaluate(excluded)).toThrow(/Inconsistent text-only floor/u);
  });
  it("leaves the unchanged 0.6 ceiling in force for a row without a floor", () => {
    expect(evaluate(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.049), predecessorInk)).relative)
      .toMatchObject({ within: false });
    expect(evaluate(withPredecessor(capture("legal.privacy", "complete", "390x844", 0.0478), predecessorInk)).relative)
      .toMatchObject({ within: true, textBound: false });
  });
});

describe("decisions 3 to 6, each with a planted defect", () => {
  it("3: the 45ch floor reads prose paragraphs only, and a real short prose paragraph still fails", () => {
    const linkLines = capture("legal.privacy", "complete", "1280x800", 0.03);
    linkLines.value.metrics.minProseMeasureCh = 10.8;
    expect(evaluate(linkLines, "contract").budgetBreaches).toContain("proseMin");
    expect(evaluate(withReadings(linkLines, { minProseParagraphMeasureCh: 52 })).budgetBreaches).not.toContain("proseMin");
    expect(evaluate(withReadings(linkLines, { proseParagraphCount: 0, minProseParagraphMeasureCh: null })).budgetBreaches).not.toContain("proseMin");
    expect(evaluate(withReadings(linkLines, { minProseParagraphMeasureCh: 44.9 })).budgetBreaches).toContain("proseMin");
  });
  it("4: section gaps read in visual order, and a real narrow gap still fails", () => {
    const panes = capture("legal.artifact-diff", "complete", "1280x800", 0.03);
    panes.value.metrics.topLevelSectionCount = 2; panes.value.metrics.minimumAdjacentSectionGapPx = 0;
    expect(evaluate(panes, "contract").budgetBreaches).toContain("sectionGap");
    expect(evaluate(withReadings(panes, { topLevelSectionRowCount: 1, minimumVisualSectionGapPx: null })).budgetBreaches).not.toContain("sectionGap");
    expect(evaluate(withReadings(panes, { topLevelSectionRowCount: 2, minimumVisualSectionGapPx: 95 })).budgetBreaches).toContain("sectionGap");
  });
  it("5: signed legal documents count characters above the fold; other pages keep the frozen count", () => {
    expect(SIGNED_LEGAL_DOCUMENT_ROUTE_IDS).toEqual(["legal.artifact", "legal.artifact-version", "legal.artifact-diff",
      "legal.consent", "legal.consent-version", "legal.consent-diff", "legal.insurance-and-discrimination"]);
    const signed = capture("legal.insurance-and-discrimination", "complete", "390x844", 0.03);
    signed.value.metrics.visibleTextCharacterCount = 1913;
    expect(evaluate(signed, "contract").budgetBreaches).toContain("visibleCharacters");
    expect(evaluate(withReadings(signed, { aboveFoldTextCharacterCount: 700 })).budgetBreaches).not.toContain("visibleCharacters");
    expect(evaluate(withReadings(signed, { aboveFoldTextCharacterCount: 701 })).budgetBreaches).toContain("visibleCharacters");
    const unsigned = withReadings(capture("legal.privacy", "complete", "390x844", 0.03), { aboveFoldTextCharacterCount: 600 });
    unsigned.value.metrics.visibleTextCharacterCount = 701;
    expect(evaluate(unsigned).budgetBreaches).toContain("visibleCharacters");
  });
  it("5: every signed legal document route renders its signed text as a pre-formatted node", () => {
    const pages: Record<string, string> = {
      "legal.artifact": "src/app/(marketing)/legal/[artifact]/page.tsx",
      "legal.artifact-version": "src/app/(marketing)/legal/[artifact]/versions/[version]/page.tsx",
      "legal.artifact-diff": "src/app/(marketing)/legal/[artifact]/diff/[from]/[to]/page.tsx",
      "legal.consent": "src/app/(marketing)/legal/consent/[key]/page.tsx",
      "legal.consent-version": "src/app/(marketing)/legal/consent/[key]/v/[version]/page.tsx",
      "legal.consent-diff": "src/app/(marketing)/legal/consent/[key]/diff/[from]/[to]/page.tsx",
      "legal.insurance-and-discrimination": "src/app/(marketing)/legal/insurance-and-discrimination/page.tsx",
    };
    expect(Object.keys(pages)).toEqual([...SIGNED_LEGAL_DOCUMENT_ROUTE_IDS]);
    const documentComponent = readFileSync(path.join(root, "src/components/legal/artifact-document.tsx"), "utf8");
    expect(documentComponent).toContain("whitespace-pre-wrap");
    for (const [id, file] of Object.entries(pages)) {
      const route = register.routes.find(entry => entry.id === id)!;
      expect(route.auth).toBe("public");
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source.includes("whitespace-pre-wrap") || source.includes("ArtifactDocument")).toBe(true);
    }
  });
  it("6: sign-in and sign-up carry up to 10 controls; the eleventh fails, and other flows keep 7", () => {
    expect(AUTH_FLOW_TEN_CONTROL_ROUTE_IDS).toEqual(["auth.sign-in", "auth.sign-up"]);
    for (const id of AUTH_FLOW_TEN_CONTROL_ROUTE_IDS) {
      const entry = capture(id, "initial-form", "390x844", 0.02);
      entry.value.metrics.interactiveElementCount = 10;
      expect(evaluate(entry).budgetBreaches).not.toContain("interactive");
      expect(evaluate(entry, "contract").budgetBreaches).toContain("interactive");
      entry.value.metrics.interactiveElementCount = 11;
      expect(evaluate(entry).budgetBreaches).toContain("interactive");
    }
    const forgot = capture("auth.forgot-password", "initial-form", "390x844", 0.02);
    forgot.value.metrics.interactiveElementCount = 8;
    expect(evaluate(forgot).budgetBreaches).toContain("interactive");
  });
  it("judges a capture without its corrected readings on the contract basis, never more leniently", () => {
    const entry = capture("legal.insurance-and-discrimination", "complete", "1280x800", 0.03);
    entry.value.metrics.visibleTextCharacterCount = 1952; entry.value.metrics.minProseMeasureCh = 29.2;
    expect(evaluate(entry).budgetBreaches).toEqual(evaluate(entry, "contract").budgetBreaches);
    const stale = withReadings(capture("legal.privacy", "complete", "390x844", 0.03));
    stale.value.correctedReadings!.moduleSha256 = "8".repeat(64);
    expect(() => evaluate(stale)).toThrow(/Inconsistent corrected density readings/u);
  });
  it("keeps the contract rules the default of the verifier", () => {
    expect(verifyCurrentDensity.length).toBe(4);
  });
});
