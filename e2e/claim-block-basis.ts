import { EXACT_MARKER, FIGURE_BASES, MODELLED_MARKER } from "../src/lib/figures/contract";

/**
 * G4.2 on a rendered surface, for every claim block on it.
 *
 * The rule has two halves, and this audit reads both from the page rather than
 * from the components that are supposed to produce them. In the data layer,
 * every figure node declares `data-figure-basis` from the contract's own
 * `FIGURE_BASES` (`observed`, `modelled`, or `exact` for Mendelian arithmetic,
 * W9 §3.1). On the surface, each block shows its basis once per block, never
 * once per figure. A block holding a modelled figure carries
 * `MODELLED_MARKER` exactly once. A block holding exact arithmetic carries
 * `EXACT_MARKER` exactly once. A block holding only observed figures carries
 * neither: having no marker is how a measurement looks, so a modelled figure in
 * a block without the sentence is a model presented as measured. The marker has
 * to be visible whenever its block is. A block that is itself hidden, such as
 * one inside a closed disclosure, is judged by its attributes and text only.
 *
 * A block that holds no figure, such as the prose-only cells the embryo
 * comparison attributes to a subject, declares no basis and so must carry no
 * marker. Every figure must sit inside a block, because the brief puts every
 * rendered figure in one `data-claim-block`. Every marker must too, because a
 * marker outside a block qualifies nothing.
 *
 * `e2e/ancestry.spec.ts` asserted this for one surface. This module turns that
 * walk into a census and a separate judgment. `e2e/figures-cross-surface.spec.ts`
 * runs it on every surface it visits, and `scripts/claim-block-basis.test.ts`
 * runs it on real renderer markup with each defect planted.
 */

/** The attribute names the census reads: pass `DATA_ATTRIBUTES` from the contract. */
export type ClaimBlockAttributes = {
  claimBlock: string;
  figureKind: string;
  figureBasis: string;
  modelledMarker: string;
  exactMarker: string;
};

export type ClaimBlockMarker = { text: string; visible: boolean };

export type CensusedClaimBlock = {
  /** Document position, accessible name and nearest named ancestor, for messages only. */
  name: string;
  visible: boolean;
  /** `data-figure-basis` of every figure whose nearest claim block is this one; null where absent. */
  bases: (string | null)[];
  modelledMarkers: ClaimBlockMarker[];
  exactMarkers: ClaimBlockMarker[];
};

export type ClaimBlockCensus = {
  blocks: CensusedClaimBlock[];
  /** The kind of every figure with no claim block around it. */
  looseFigures: string[];
  /** The text of every marker with no claim block around it. */
  looseMarkers: string[];
};

/**
 * Passed to `page.evaluate` with `DATA_ATTRIBUTES`, so it must be
 * self-contained: no imports and no closure over the test realm. A figure or
 * marker belongs to its nearest block, so a nested block's figures are never
 * counted twice.
 */
export function collectClaimBlocks(attributes: ClaimBlockAttributes): ClaimBlockCensus {
  const blockSelector = `[${attributes.claimBlock}]`;
  const text = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();
  const shown = (node: Element) => node.checkVisibility({ visibilityProperty: true });
  const owned = (block: Element, attribute: string) => [...block.querySelectorAll(`[${attribute}]`)]
    .filter(node => node.closest(blockSelector) === block);
  const loose = (attribute: string) => [...document.querySelectorAll(`[${attribute}]`)]
    .filter(node => node.closest(blockSelector) === null);
  const marker = (node: Element) => ({ text: text(node), visible: shown(node) });
  return {
    blocks: [...document.querySelectorAll(blockSelector)].map((block, index) => ({
      name: [`block ${index}`, block.getAttribute("aria-label"),
        block.parentElement?.closest("[data-slot]")?.getAttribute("data-slot")]
        .filter(part => part).join(" · "),
      visible: shown(block),
      bases: owned(block, attributes.figureKind).map(figure => figure.getAttribute(attributes.figureBasis)),
      modelledMarkers: owned(block, attributes.modelledMarker).map(marker),
      exactMarkers: owned(block, attributes.exactMarker).map(marker),
    })),
    looseFigures: loose(attributes.figureKind).map(figure => figure.getAttribute(attributes.figureKind) ?? ""),
    looseMarkers: [...loose(attributes.modelledMarker), ...loose(attributes.exactMarker)].map(text),
  };
}

const MARKERS = [
  { basis: "modelled", key: "modelledMarkers", sentence: MODELLED_MARKER },
  { basis: "exact", key: "exactMarkers", sentence: EXACT_MARKER },
] as const;

/** Every way the census breaks G4.2, one plain sentence each; empty when it holds. */
export function claimBlockBasisFindings(census: ClaimBlockCensus): string[] {
  const findings: string[] = [];
  for (const kind of census.looseFigures) {
    findings.push(`a figure of kind ${JSON.stringify(kind)} renders outside every claim block`);
  }
  for (const text of census.looseMarkers) {
    findings.push(`a basis marker renders outside every claim block: ${JSON.stringify(text)}`);
  }
  for (const block of census.blocks) {
    const undeclared = block.bases.filter(basis => !(FIGURE_BASES as readonly (string | null)[]).includes(basis));
    if (undeclared.length > 0) {
      findings.push(`${block.name}: ${undeclared.length} of its ${block.bases.length} figures declare no basis `
        + `from the contract (${undeclared.map(basis => JSON.stringify(basis)).join(", ")})`);
    }
    if (block.bases.includes("modelled") && block.bases.includes("exact")) {
      findings.push(`${block.name}: mixes modelled and exact figures, so its two markers would contradict each other`);
    }
    for (const { basis, key, sentence } of MARKERS) {
      const due = block.bases.filter(value => value === basis).length;
      const markers = block[key];
      if (due === 0) {
        if (markers.length > 0) {
          findings.push(`${block.name}: holds no ${basis} figure but renders the ${basis} marker ${markers.length} time(s)`);
        }
        continue;
      }
      if (markers.length !== 1) {
        findings.push(`${block.name}: holds ${due} ${basis} figure(s) and renders the ${basis} marker `
          + `${markers.length} time(s), not once`);
      }
      for (const shown of markers) {
        if (shown.text !== sentence) {
          findings.push(`${block.name}: its ${basis} marker reads ${JSON.stringify(shown.text)}, not ${JSON.stringify(sentence)}`);
        }
        if (block.visible && !shown.visible) {
          findings.push(`${block.name}: its ${basis} marker is hidden while the block is visible`);
        }
      }
    }
  }
  return findings;
}

/** The distinct bases a set of censuses rendered, so a run can show both sides of the rule were read. */
export function renderedBases(censuses: Iterable<ClaimBlockCensus>): string[] {
  return [...new Set([...censuses].flatMap(census => census.blocks.flatMap(block => block.bases)))]
    .map(basis => String(basis)).sort();
}
