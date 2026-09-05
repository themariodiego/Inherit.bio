// Shared genome-domain types. Chromosomes are stored numerically:
// 1-22 autosomes, 23 = X, 24 = Y, 25 = MT.

export type FileKind =
  | "array_23andme"
  | "array_ancestry"
  | "array_myheritage"
  | "array_ftdna"
  | "vcf"
  | "gvcf"
  | "bam"
  | "cram";

export type Build = "GRCh37" | "GRCh38" | "unknown";

export interface VariantRecord {
  /** Numeric part of the rsID (rs12345 -> 12345); null when unknown. */
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  /** Diploid "A/G", haploid "A", or "--" for a no-call. */
  genotype: string;
}

/**
 * A row the file called homozygous for the reference (a VCF `0/0` row). It
 * is not a variant and never becomes a variant row; it is evidence of what
 * the file recorded between its differences, which the runs-of-homozygosity
 * measure needs (src/lib/family/roh.ts, D-040).
 */
export interface ReferenceCall {
  chrom: number;
  pos: number;
  /** Diploid "A/A" (the reference letter on both copies) or haploid "A". */
  genotype: string;
  ref: string;
}

export interface ParseResult {
  build: Build;
  records: VariantRecord[];
  /**
   * Rows called homozygous for the reference, kept apart from the variants.
   * The VCF parser fills it from `0/0` rows; the array parsers leave it
   * empty, because an array file lists every probed position in `records`
   * whether or not it differs from the reference and carries no reference
   * allele to say which.
   */
  referenceCalls: ReferenceCall[];
  /** Report-only literal single-position evidence; never an analysis input. */
  observedCalls?: import("./observed-calls").ObservedCall[];
  /** Lines skipped as unparseable or no-calls, for honest reporting. */
  skipped: number;
}

export const CHROM_BY_NAME: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 1; i <= 22; i++) m[String(i)] = i;
  m.X = 23;
  m.Y = 24;
  m.MT = 25;
  m.M = 25;
  return m;
})();

/** Normalizes "chr1", "1", "chrM", "MT" etc.; returns null for scaffolds. */
export function chromToNumber(raw: string): number | null {
  const name = raw.replace(/^chr/i, "").toUpperCase();
  return CHROM_BY_NAME[name] ?? null;
}

export function chromToName(chrom: number): string {
  if (chrom === 23) return "X";
  if (chrom === 24) return "Y";
  if (chrom === 25) return "MT";
  return String(chrom);
}

export function parseRsid(raw: string): number | null {
  const m = /^rs(\d+)$/i.exec(raw.trim());
  return m ? Number(m[1]) : null;
}
