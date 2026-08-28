// Streaming VCF / gVCF parser (single-sample: FORMAT + first sample column).

import type { Build, ParseResult, VariantRecord } from "../types";
import { chromToNumber, parseRsid } from "../types";

// chr1 lengths pin the reference build.
const CHR1_LEN_GRCH38 = 248956422;
const CHR1_LEN_GRCH37 = 249250621;

function buildFromHeader(line: string): Build | null {
  if (line.startsWith("##reference=")) {
    if (/GRCh38|hg38/i.test(line)) return "GRCh38";
    if (/GRCh37|hg19|b37/i.test(line)) return "GRCh37";
    return null;
  }
  if (line.startsWith("##contig=")) {
    const id = /[<,]ID=(?:chr)?1[,>]/.exec(line);
    const len = /[<,]length=(\d+)[,>]/.exec(line);
    if (id && len) {
      const n = Number(len[1]);
      if (n === CHR1_LEN_GRCH38) return "GRCh38";
      if (n === CHR1_LEN_GRCH37) return "GRCh37";
    }
  }
  return null;
}

/**
 * Parse decoded VCF/gVCF lines into variant records.
 * - Genotype comes from the first sample's GT, resolved against REF/ALT.
 * - Only GT-referenced ALT alleles are kept (multiallelic rows keep just the
 *   called alleles).
 * - "./." (or any missing allele) is a no-call, counted in `skipped`.
 * - Homozygous-reference rows and <NON_REF>-only gVCF blocks are reference,
 *   not variants: dropped without counting.
 */
export async function parseVcf(
  lines: AsyncIterable<string>
): Promise<ParseResult> {
  const records: VariantRecord[] = [];
  let skipped = 0;
  let build: Build = "unknown";

  for await (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") continue;
    if (line.startsWith("##")) {
      if (build === "unknown") build = buildFromHeader(line) ?? "unknown";
      continue;
    }
    if (line.startsWith("#")) continue; // #CHROM column header

    const f = line.split("\t");
    if (f.length < 10) {
      skipped++;
      continue;
    }
    const chrom = chromToNumber(f[0]);
    const pos = Number(f[1]);
    if (chrom === null || !Number.isInteger(pos) || pos <= 0) {
      skipped++;
      continue;
    }
    const gtIndex = f[8].split(":").indexOf("GT");
    if (gtIndex === -1) {
      skipped++;
      continue;
    }
    const gt = f[9].split(":")[gtIndex];
    if (gt === undefined || gt === "") {
      skipped++;
      continue;
    }
    const alleleIdx = gt.split(/[/|]/);
    if (alleleIdx.some((i) => i === ".")) {
      skipped++; // no-call (./., .)
      continue;
    }

    const ref = f[3];
    const alts = f[4] === "." ? [] : f[4].split(",");
    const alleles = [ref, ...alts];
    const gtAlleles: string[] = [];
    let malformed = false;
    for (const i of alleleIdx) {
      const a = alleles[Number(i)];
      if (a === undefined) {
        malformed = true;
        break;
      }
      gtAlleles.push(a);
    }
    if (malformed) {
      skipped++;
      continue;
    }

    // Reference rows / gVCF blocks: nothing but REF or <NON_REF> called.
    const calledAlts = [
      ...new Set(gtAlleles.filter((a) => a !== ref && a !== "<NON_REF>")),
    ];
    if (calledAlts.length === 0) continue;
    if (gtAlleles.includes("<NON_REF>")) continue; // half-block oddity

    const genotype =
      gtAlleles.length === 1
        ? gtAlleles[0]
        : gtAlleles.slice().sort().join("/");

    records.push({
      rsid: parseRsid(f[2]),
      chrom,
      pos,
      ref,
      alt: calledAlts.join(","),
      genotype,
    });
  }

  return { build, records, skipped };
}
