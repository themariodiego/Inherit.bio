import { chromToNumber } from "../types";
import { ReadFileError } from "./binary";
import type { ReferenceSequence } from "./alignment";
import type { CallerLocus } from "./caller";

/**
 * The product's positions, as `scripts/generate-read-calling-panel.ts`
 * writes them to `data/ref/read-calling-loci.json`, and the two checks that
 * decide whether a read file can be asked about them at all.
 */

export interface ReadCallingPanel {
  schemaVersion: 1;
  version: string;
  build: "GRCh38";
  loci: readonly (readonly [number, number, string, readonly string[], number | null, readonly string[]])[];
}

const CHR1_GRCH38 = 248_956_422;
const CHR1_GRCH37 = 249_250_621;

/**
 * The genome build the reads were aligned to, from the file's own sequence
 * dictionary: the length of chromosome 1 and any `AS` assembly tag. Every
 * claim must agree on GRCh38; anything else, including no claim at all, is
 * `unsupported_build`. The panel holds GRCh38 positions only, and Inherit
 * does not move read alignments between builds.
 */
export function assertGrch38(references: readonly ReferenceSequence[]): void {
  const claims = new Set<string>();
  for (const reference of references) {
    if (chromToNumber(reference.name) === 1) {
      claims.add(reference.length === CHR1_GRCH38 ? "GRCh38" : reference.length === CHR1_GRCH37 ? "GRCh37" : "other");
    }
    if (reference.assembly) {
      claims.add(/^(?:GRCh38|hg38)\b/i.test(reference.assembly) ? "GRCh38" : "other");
    }
  }
  if (claims.size !== 1 || !claims.has("GRCh38")) throw new ReadFileError("unsupported_build");
}

/** The panel's positions on this file's own sequence names. A chromosome the
 * file does not declare simply contributes no position. */
export function panelLoci(panel: ReadCallingPanel, references: readonly ReferenceSequence[]): CallerLocus[] {
  const names = new Map<number, string>();
  for (const reference of references) {
    const chrom = chromToNumber(reference.name);
    if (chrom !== null && !names.has(chrom)) names.set(chrom, reference.name);
  }
  const loci: CallerLocus[] = [];
  for (const [chrom, position, ref, alts, rsid] of panel.loci) {
    const contig = names.get(chrom);
    if (contig) loci.push({ contig, position, ref, alts, rsid });
  }
  return loci;
}
