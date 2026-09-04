/**
 * The Medicines fixture as data: the rows, the VCF text and the check the
 * generator (`generate-medicines-vcf.ts`) and the browser spec
 * (`../report-skeleton.spec.ts`) both run. A plain module with no
 * `import.meta`, so the spec can import it under Playwright's CommonJS
 * transform and derive its expectations from the same code that wrote the
 * committed file.
 *
 * The fixture describes no real person. It carries one row at each position
 * of `data/templates/medicines.json` — the GRCh38 coordinates, rsIDs,
 * reference and CPIC alternate alleles the research pass verified from
 * Ensembl, dbSNP and CPIC on 2026-09-03 (ADR 0021) — with every genotype
 * invented as one changed copy (GT 0/1), and nothing else. No genotype was
 * read from any person or sample.
 */
import fs from "node:fs";
import path from "node:path";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";
import { genotypeKey } from "../../src/lib/genome/reports";

export const FIXTURE_NAME = "medicines-grch38.vcf";

/** GRCh38 autosome lengths, for the `##contig` header of each chromosome the rows use. */
const CONTIG_LENGTHS: Record<number, number> = {
  1: 248956422,
  2: 242193529,
  3: 198295559,
  4: 190214555,
  5: 181538259,
  6: 170805979,
  7: 159345973,
  8: 145138636,
  9: 138394717,
  10: 133797422,
  11: 135086622,
  12: 133275309,
  13: 114364328,
  14: 107043718,
  15: 101991189,
  16: 90338345,
  17: 83257441,
  18: 80373285,
  19: 58617616,
  20: 64444167,
  21: 46709983,
  22: 50818468,
};

interface SeedVariant {
  rsid: number;
  gene: string;
  chrom: number;
  pos38: number;
  ref: string;
  alt: string;
}

interface SeedTemplate {
  slug: string;
  variants: SeedVariant[];
}

export interface Row {
  chrom: number;
  pos: number;
  rsid: number;
  ref: string;
  alt: string;
  gt: "0/1";
}

/** The seeded Medicines templates, read from the repository root. */
export function medicinesTemplates(): SeedTemplate[] {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data/templates/medicines.json"), "utf8"),
  ) as SeedTemplate[];
}

/** One row per Medicines position, one changed copy each, in chromosome then position order. */
export function buildRows(): Row[] {
  return medicinesTemplates()
    .flatMap((template) => template.variants)
    .map((variant) => ({
      chrom: variant.chrom,
      pos: variant.pos38,
      rsid: variant.rsid,
      ref: variant.ref,
      alt: variant.alt,
      gt: "0/1" as const,
    }))
    .sort((left, right) => (left.chrom === right.chrom ? left.pos - right.pos : left.chrom - right.chrom));
}

export function buildMedicinesVcf(): string[] {
  const rows = buildRows();
  const chromosomes = [...new Set(rows.map((row) => row.chrom))].sort((a, b) => a - b);
  for (const chrom of chromosomes) {
    if (!(chrom in CONTIG_LENGTHS)) throw new Error(`medicines fixture: no contig length for chromosome ${chrom}`);
  }
  return [
    "##fileformat=VCFv4.2",
    "##source=Inherit deterministic synthetic fixture; no real person; one changed copy at each position of data/templates/medicines.json",
    "##reference=GRCh38",
    ...chromosomes.map((chrom) => `##contig=<ID=chr${chrom},length=${CONTIG_LENGTHS[chrom]}>`),
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE1",
    ...rows.map((row) =>
      [`chr${row.chrom}`, row.pos, `rs${row.rsid}`, row.ref, row.alt, 50, "PASS", ".", "GT", row.gt].join("\t"),
    ),
  ];
}

async function* asLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

export interface FixtureCheck {
  ok: boolean;
  /** The parsed genotype at each Medicines rsID, as the parser reports it. */
  genotypes: Record<number, string | undefined>;
  reasons: string[];
}

/** The properties the browser spec depends on, checked with the real parser. */
export async function verify(lines: readonly string[]): Promise<FixtureCheck> {
  const parsed = await parseVcf(asLines(lines));
  const rows = buildRows();
  const byRsid = new Map(parsed.records.map((record) => [record.rsid, record.genotype]));
  const genotypes = Object.fromEntries(rows.map((row) => [row.rsid, byRsid.get(row.rsid)]));
  const reasons: string[] = [];
  if (parsed.build !== "GRCh38") reasons.push(`the parser read build ${parsed.build}, not GRCh38`);
  if (parsed.skipped !== 0) reasons.push(`the parser skipped ${parsed.skipped} row(s)`);
  if (parsed.records.length !== rows.length) {
    reasons.push(`the parser kept ${parsed.records.length} records, not ${rows.length}`);
  }
  for (const row of rows) {
    const genotype = byRsid.get(row.rsid);
    // One changed copy: the sorted key of the parsed letters is ref+alt sorted,
    // the same key reports.ts resolves against the template's interpretations.
    const expected = [row.ref, row.alt].sort().join("");
    const actual = genotype === undefined ? null : genotypeKey(genotype);
    if (actual !== expected) {
      reasons.push(`rs${row.rsid} parsed as ${String(genotype)} (key ${String(actual)}), not one changed copy (${expected})`);
    }
  }
  return { ok: reasons.length === 0, genotypes, reasons };
}
