/**
 * Locus queries for the genome browser: `chr15:74749576`, `15:74,749,576`,
 * `chrX:1000-2000`, `MT:100-200`. A single position is shown as a window
 * centred on it; a range is shown as typed (ends swapped when reversed).
 * Chromosome names follow src/lib/genome/types.ts (1–22, X, Y, MT or M);
 * anything else that still looks like a locus is reported as an unknown
 * chromosome, so the page can say so instead of treating it as a gene.
 *
 * Positions are 1-based GRCh38 integers and format without thousands
 * grouping (`chr15:74744576-74754576`), the same form the report page and
 * the search syntax use.
 */
import { chromToName, chromToNumber } from "./types";

export interface Locus {
  chrom: number;
  start: number;
  end: number;
}

export type LocusQuery = { kind: "locus"; locus: Locus } | { kind: "unknown-chromosome" } | null;

/** Half-width of the window shown around a single position (an rsID hit or `chr:pos`). */
export const LOCUS_HALF_WINDOW = 5_000;

/** Padding either side of the outermost positions of a gene's variants. */
export const GENE_PADDING = 10_000;

const LOCUS_PATTERN = /^(chr)?([0-9XYMT]+):([\d,]+)(?:-([\d,]+))?$/i;

function digits(value: string): number {
  return Number(value.replace(/,/g, ""));
}

/** Parses a locus query; null when the text is not locus-shaped at all. */
export function parseLocusQuery(query: string): LocusQuery {
  const match = LOCUS_PATTERN.exec(query.trim());
  if (!match) return null;
  const chrom = chromToNumber(match[2]);
  if (chrom === null) return { kind: "unknown-chromosome" };
  const first = digits(match[3]);
  if (match[4] === undefined) return { kind: "locus", locus: locusAround(chrom, first) };
  const second = digits(match[4]);
  return {
    kind: "locus",
    locus: {
      chrom,
      start: Math.max(1, Math.min(first, second)),
      end: Math.max(first, second),
    },
  };
}

/** The window centred on one position. */
export function locusAround(chrom: number, pos: number): Locus {
  return { chrom, start: Math.max(1, pos - LOCUS_HALF_WINDOW), end: pos + LOCUS_HALF_WINDOW };
}

/** The padded span of several positions on one chromosome; null with no positions. */
export function locusSpanning(chrom: number, positions: readonly number[]): Locus | null {
  if (positions.length === 0) return null;
  return {
    chrom,
    start: Math.max(1, Math.min(...positions) - GENE_PADDING),
    end: Math.max(...positions) + GENE_PADDING,
  };
}

/** `chr15:74744576-74754576`: the chromosome name and the range, no grouping. */
export function formatLocus(locus: Locus): string {
  return `chr${chromToName(locus.chrom)}:${locus.start}-${locus.end}`;
}
