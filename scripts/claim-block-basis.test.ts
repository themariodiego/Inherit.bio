import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimBlockBasisFindings, collectClaimBlocks, renderedBases } from "../e2e/claim-block-basis";
import { collectFigures } from "../e2e/figure-collector";
import { ClaimBlock } from "@/components/figures/claim-block";
import { RelativeFigure } from "@/components/figures/relative-figure";
import { DATA_ATTRIBUTES, EXACT_MARKER, MODELLED_MARKER } from "@/lib/figures/contract";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";

/**
 * The G4.2 audit `e2e/figures-cross-surface.spec.ts` runs on every surface it
 * visits, here on markup from the real <ClaimBlock> and <RelativeFigure>, the
 * only two components that emit figures. Unplanted, every basis passes. Each
 * planted defect, one at a time, yields exactly the finding that names it, so
 * the browser assertion `expect(findings).toEqual([])` fails on it.
 */
const subject = { subjectId: "09000000-0000-4000-8000-000000000001" };
const share = (value: number): StandaloneFigureSpec => ({ kind: "ancestry-share", class: "ancestry", basis: "modelled",
  provenance: { kind: "computed", module: "src/lib/genome/regional-admixture.ts" }, share: value, range: { unavailable: true } });
const sourceCalls: StandaloneFigureSpec = { kind: "coverage", class: "quality", basis: "observed",
  provenance: { kind: "computed", module: "genome/input-provenance" }, read: 168, needed: 168, wording: "listed-calls" };
const genotype: StandaloneFigureSpec = { kind: "genotype", class: "variant-call", basis: "observed",
  provenance: { kind: "computed", module: "genome/reports" }, genotype: "A/G", label: "Your two letters at this position" };
const crossing = (value: number): StandaloneFigureSpec => ({ kind: "natural-frequency", class: "variant-call", basis: "exact",
  provenance: { kind: "computed", module: "family/mendel" }, value });

const SURFACE = renderToStaticMarkup(h("main", {},
  h("div", { "data-slot": "regional-ancestry" },
    h(ClaimBlock, { subject, "aria-label": "Ancestry", figures: [share(0.6), share(0.3), share(0.1), sourceCalls] })),
  h(ClaimBlock, { subject, "aria-label": "Report", figures: [genotype] }),
  h(ClaimBlock, { subject, "aria-label": "Crossing", figures: [crossing(0.25), crossing(0.5), crossing(0.25)] }),
  h(RelativeFigure, { subject, "aria-label": "Relative", relative: { text: "About twice as likely.", value: 2 },
    absoluteBefore: 0.05, absoluteAfter: 0.1, groups: { before: "people in general", after: "people like you" },
    provenance: { kind: "citation", id: "pmid:1" } }),
  h(ClaimBlock, { subject, "aria-label": "Prose", figures: [] }, h("p", {}, "No result is shown for this condition.")),
  h("details", {}, h("summary", {}, "Raw numbers"),
    h(ClaimBlock, { subject, "aria-label": "Raw", figures: [share(0.5), share(0.5)] })),
  h(ClaimBlock, { subject, "aria-label": "Outer", figures: [share(0.7)] },
    h(ClaimBlock, { subject, "aria-label": "Inner", figures: [share(0.2)] })),
));

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function audit(plant?: (page: Page) => Promise<unknown>) {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  try {
    await page.setContent(SURFACE);
    await plant?.(page);
    return { census: await page.evaluate(collectClaimBlocks, DATA_ATTRIBUTES), figures: await page.evaluate(collectFigures) };
  } finally { await page.close(); }
}

const ANCESTRY = "block 0 · Ancestry · regional-ancestry";
const modelledMarker = (page: Page, block: string) => page.locator(`[aria-label="${block}"] > [data-modelled-marker]`);

describe("the G4.2 claim-block audit", () => {
  it("passes real markup for every basis, a figureless block and a block in a closed disclosure", async () => {
    const { census, figures } = await audit();
    expect(claimBlockBasisFindings(census)).toEqual([]);
    expect(census.blocks.map(block => [block.name, block.visible, block.bases, block.modelledMarkers, block.exactMarkers])).toEqual([
      [ANCESTRY, true, ["modelled", "modelled", "modelled", "observed"], [{ text: MODELLED_MARKER, visible: true }], []],
      ["block 1 · Report", true, ["observed"], [], []],
      ["block 2 · Crossing", true, ["exact", "exact", "exact"], [], [{ text: EXACT_MARKER, visible: true }]],
      ["block 3 · Relative", true, ["modelled", "modelled", "modelled", "modelled", "modelled"], [{ text: MODELLED_MARKER, visible: true }], []],
      ["block 4 · Prose", true, [], [], []],
      ["block 5 · Raw", false, ["modelled", "modelled"], [{ text: MODELLED_MARKER, visible: false }], []],
      // A figure and a marker belong to their nearest block, so nesting counts neither twice.
      ["block 6 · Outer", true, ["modelled"], [{ text: MODELLED_MARKER, visible: true }], []],
      ["block 7 · Inner · claim-block", true, ["modelled"], [{ text: MODELLED_MARKER, visible: true }], []],
    ]);
    // The census reads the same figures the cross-surface collector reads.
    expect(census.blocks.flatMap(block => block.bases)).toHaveLength(figures.length);
    expect(census.looseFigures).toEqual([]);
    expect(census.looseMarkers).toEqual([]);
    expect(renderedBases([census])).toEqual(["exact", "modelled", "observed"]);
  });

  it.each<[string, (page: Page) => Promise<unknown>, string[]]>([
    ["a modelled block loses its marker",
      page => modelledMarker(page, "Ancestry").evaluate(node => node.remove()),
      [`${ANCESTRY}: holds 3 modelled figure(s) and renders the modelled marker 0 time(s), not once`]],
    ["the relative block loses its marker",
      page => modelledMarker(page, "Relative").evaluate(node => node.remove()),
      ["block 3 · Relative: holds 5 modelled figure(s) and renders the modelled marker 0 time(s), not once"]],
    ["an exact block loses its marker",
      page => page.locator('[aria-label="Crossing"] > [data-exact-marker]').evaluate(node => node.remove()),
      ["block 2 · Crossing: holds 3 exact figure(s) and renders the exact marker 0 time(s), not once"]],
    ["a figure loses its basis",
      page => page.locator('[aria-label="Report"] [data-figure-kind]').evaluate(node => node.removeAttribute("data-figure-basis")),
      ["block 1 · Report: 1 of its 1 figures declare no basis from the contract (null)"]],
    ["a figure declares a basis outside the contract",
      page => page.locator('[aria-label="Ancestry"] [data-figure-kind]').first()
        .evaluate(node => node.setAttribute("data-figure-basis", "measured")),
      [`${ANCESTRY}: 1 of its 4 figures declare no basis from the contract ("measured")`]],
    ["a modelled figure renders in a block that reads as measured",
      page => page.locator('[aria-label="Report"] [data-figure-kind]').evaluate(node => node.setAttribute("data-figure-basis", "modelled")),
      ["block 1 · Report: holds 1 modelled figure(s) and renders the modelled marker 0 time(s), not once"]],
    ["an observed block carries the modelled marker",
      page => page.locator('[aria-label="Report"]').evaluate(node => {
        const marker = document.createElement("p");
        marker.setAttribute("data-modelled-marker", "true");
        marker.textContent = "This is a model, not an observed outcome.";
        node.append(marker);
      }),
      ["block 1 · Report: holds no modelled figure but renders the modelled marker 1 time(s)"]],
    ["a figureless block carries the modelled marker",
      page => page.locator('[aria-label="Prose"]').evaluate(node => {
        node.append(document.querySelector('[aria-label="Ancestry"] > [data-modelled-marker]')!.cloneNode(true));
      }),
      ["block 4 · Prose: holds no modelled figure but renders the modelled marker 1 time(s)"]],
    ["the marker renders once per figure instead of once per block",
      page => modelledMarker(page, "Ancestry").evaluate(node => node.after(node.cloneNode(true))),
      [`${ANCESTRY}: holds 3 modelled figure(s) and renders the modelled marker 2 time(s), not once`]],
    ["the marker carries the sentence the decision rejected",
      page => modelledMarker(page, "Ancestry").evaluate(node => { node.textContent = "This is a modelled estimate, not a measurement."; }),
      [`${ANCESTRY}: its modelled marker reads "This is a modelled estimate, not a measurement.", `
        + `not "This is a model, not an observed outcome."`]],
    ["the marker is hidden on a visible block",
      page => modelledMarker(page, "Ancestry").evaluate(node => { (node as HTMLElement).hidden = true; }),
      [`${ANCESTRY}: its modelled marker is hidden while the block is visible`]],
    ["the marker is made invisible by style",
      page => modelledMarker(page, "Relative").evaluate(node => { (node as HTMLElement).style.visibility = "hidden"; }),
      ["block 3 · Relative: its modelled marker is hidden while the block is visible"]],
    ["a figure renders outside every block",
      page => page.locator('[aria-label="Ancestry"] [data-figure-kind]').first()
        .evaluate(node => document.querySelector("main")!.append(node)),
      ['a figure of kind "ancestry-share" renders outside every claim block']],
    ["the marker renders outside its block",
      page => modelledMarker(page, "Ancestry").evaluate(node => document.querySelector("main")!.append(node)),
      [`a basis marker renders outside every claim block: "${MODELLED_MARKER}"`,
        `${ANCESTRY}: holds 3 modelled figure(s) and renders the modelled marker 0 time(s), not once`]],
    ["an exact block gains a modelled figure",
      page => page.locator('[aria-label="Crossing"] [data-figure-kind]').first()
        .evaluate(node => node.setAttribute("data-figure-basis", "modelled")),
      ["block 2 · Crossing: mixes modelled and exact figures, so its two markers would contradict each other",
        "block 2 · Crossing: holds 1 modelled figure(s) and renders the modelled marker 0 time(s), not once"]],
  ])("finds the defect when %s", async (_defect, plant, expected) => {
    const { census } = await audit(plant);
    expect(claimBlockBasisFindings(census)).toEqual(expected);
  });

  it("judges a hidden block by its attributes and text, not by its visibility", async () => {
    const { census } = await audit(page => page.locator('[aria-label="Raw"] > [data-modelled-marker]').evaluate(node => node.remove()));
    expect(claimBlockBasisFindings(census)).toEqual(["block 5 · Raw: holds 2 modelled figure(s) and renders the modelled marker 0 time(s), not once"]);
  });
});
