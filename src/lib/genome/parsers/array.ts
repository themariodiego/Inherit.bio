// Streaming parser for consumer array raw files (23andMe, AncestryDNA,
// MyHeritage, FamilyTreeDNA).

import type { Build, ParseResult, VariantRecord } from "../types";
import { chromToNumber, parseRsid } from "../types";

export type ArrayKind =
  | "array_23andme"
  | "array_ancestry"
  | "array_myheritage"
  | "array_ftdna";

/** AncestryDNA chrom numbering: 23=X, 24=Y, 25=PAR (treated as X), 26=MT. */
function ancestryChrom(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n >= 1 && n <= 24) return n;
  if (n === 25) return 23; // PAR -> X
  if (n === 26) return 25; // MT
  return null;
}

function stripQuotes(field: string): string {
  return field.startsWith('"') && field.endsWith('"') && field.length >= 2
    ? field.slice(1, -1)
    : field;
}

/**
 * Normalize a raw genotype string ("AG", "A", "CA") to sorted diploid "A/C"
 * or haploid "A" (homozygous pairs on Y/MT collapse to haploid).
 * Returns null for no-calls, insertion/deletion pseudo-genotypes ("DD", "II",
 * "DI") and anything unparseable — callers count those as skipped.
 */
function normalizeGenotype(raw: string, chrom: number): string | null {
  const g = raw.toUpperCase();
  if (!/^[ACGT]{1,2}$/.test(g)) return null; // --, 00, D/I pseudo-genotypes, junk
  if (g.length === 1) return g;
  if ((chrom === 24 || chrom === 25) && g[0] === g[1]) return g.charAt(0);
  return g.split("").sort().join("/");
}

/**
 * Parse decoded lines of an array raw file. All four vendors ship GRCh37
 * unless a header comment says build 38.
 */
export async function parseArray(
  lines: AsyncIterable<string>,
  kind: ArrayKind
): Promise<ParseResult> {
  const records: VariantRecord[] = [];
  let skipped = 0;
  let build: Build = "GRCh37";

  for await (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (/build\s*38|GRCh38/i.test(line)) build = "GRCh38";
      continue;
    }

    const fields =
      kind === "array_myheritage" || kind === "array_ftdna"
        ? line.split(",").map(stripQuotes)
        : line.split("\t");

    // Non-comment column-header row (AncestryDNA, MyHeritage, FTDNA).
    if (fields[0]?.toLowerCase() === "rsid") continue;

    let rsidRaw: string, posRaw: string, genotypeRaw: string;
    let chrom: number | null;
    if (kind === "array_ancestry") {
      if (fields.length < 5) {
        skipped++;
        continue;
      }
      const [r, c, p, a1, a2] = fields;
      rsidRaw = r;
      posRaw = p;
      chrom = ancestryChrom(c);
      genotypeRaw = a1 + a2;
    } else {
      if (fields.length < 4) {
        skipped++;
        continue;
      }
      const [r, c, p, g] = fields;
      rsidRaw = r;
      posRaw = p;
      chrom = chromToNumber(c);
      genotypeRaw = g;
    }

    const pos = Number(posRaw);
    if (chrom === null || !Number.isInteger(pos) || pos <= 0) {
      skipped++;
      continue;
    }
    const genotype = normalizeGenotype(genotypeRaw, chrom);
    if (genotype === null) {
      skipped++;
      continue;
    }
    records.push({
      rsid: parseRsid(rsidRaw),
      chrom,
      pos,
      ref: null,
      alt: null,
      genotype,
    });
  }

  // Every probed position is a record, differing from the reference or not;
  // the vendors' files carry no reference allele, so nothing can be told
  // apart as a reference call here (src/lib/family/roh.ts reads a
  // same-reading array call as a reported non-difference position).
  return { build, records, referenceCalls: [], skipped };
}
