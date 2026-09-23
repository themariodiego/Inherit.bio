/** Client-safe figure derivations, also exported by the genome/browser module. */
import { GENOTYPE_LABEL } from "@/copy/reports/strings";
import type { ComputedModule } from "@/lib/figures/contract";
import type { GenotypeSpec } from "@/lib/figures/spec";

/** The public module every browser figure names as the origin of its number. */
export const BROWSER_MODULE = "genome/browser" satisfies ComputedModule;

const BROWSER_PROVENANCE = { kind: "computed", module: BROWSER_MODULE } as const;

export interface BrowserFigureHit {
  genotype: string | null;
  conflict: boolean;
}

function genotypeFigure(genotype: string): GenotypeSpec {
  return {
    kind: "genotype",
    class: "variant-call",
    basis: "observed",
    provenance: BROWSER_PROVENANCE,
    genotype,
    label: GENOTYPE_LABEL,
  };
}

/**
 * One observed genotype figure per row with a recorded value. figureIndex
 * preserves the source row order, including null for an uncovered position.
 */
export function genotypeFigures(hits: readonly BrowserFigureHit[]): {
  specs: GenotypeSpec[];
  figureIndex: (number | null)[];
} {
  const specs: GenotypeSpec[] = [];
  const figureIndex = hits.map((hit) => {
    if (hit.genotype === null) return null;
    specs.push(genotypeFigure(hit.genotype));
    return specs.length - 1;
  });
  return { specs, figureIndex };
}

/** No-calls, uncovered positions and conflicting files do not count as read. */
export function browserCoverage(hits: readonly BrowserFigureHit[]): {
  read: number;
  needed: number;
  module: typeof BROWSER_MODULE;
} {
  return {
    read: hits.filter((hit) => hit.genotype !== null && hit.genotype !== "--" && !hit.conflict).length,
    needed: hits.length,
    module: BROWSER_MODULE,
  };
}

/** The recorded calls of loaded rows in the current native view. */
export function loadedTrackFigures(rows: readonly { genotype: string }[]): GenotypeSpec[] {
  return rows.map((row) => genotypeFigure(row.genotype));
}
