// Generates e2e/fixtures/carrier-pair-grch38.vcf: a synthetic single-sample
// GRCh38 VCF that lets `e2e/family-health-picture.spec.ts` reach every branch
// of the carrier rule (src/lib/family/carrier-pair.ts). It describes no real
// person: every position and every genotype below is written here by hand,
// none was read from anyone, and the four classified positions use reserved
// synthetic rsIDs that exist in no public catalogue.
//
//   pnpm exec tsx e2e/fixtures/generate-carrier-pair-vcf.ts
//
// The file carries three kinds of row and nothing else:
//
//   1. four rows at the synthetic rsIDs 999999001–999999004, each one changed
//      copy and one unchanged copy (GT 0/1), so both accounts that ingest this
//      file read one changed copy at each of the four positions the spec
//      classifies through the admin client;
//   2. two short pairs of same-reading rows, so the file's runs of
//      homozygosity are measurable at all and sit far below both thresholds
//      the brief states — without them the file would list only differences
//      and the rule would refuse the arithmetic (src/lib/family/roh.ts);
//   3. the four positions of `tiny-grch38.vcf`, so the side-by-side table has
//      the same covered reports the other Family specs use.
//
// After writing, the script parses the output with the real VCF parser and
// runs the real runs measure over the parsed autosomal records, and refuses
// to leave a file behind that the surface would not accept.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";
import {
  belowRohThreshold,
  measureRunsOfHomozygosity,
  type RohCall,
  type RohMeasure,
} from "../../src/lib/family/roh";
import {
  CARRIER_ALT,
  CARRIER_POSITIONS,
  CARRIER_REF,
  CARRIER_RSIDS,
} from "./carrier-pair-positions";

export const FIXTURE_NAME = "carrier-pair-grch38.vcf";

interface Row {
  chrom: string;
  pos: number;
  id: string;
  ref: string;
  alt: string;
  gt: string;
}

/** Two same-reading rows a kilobase apart make one short measurable run. */
const SAME_READING_PAIRS: readonly number[] = [5_000_000, 6_000_000];

/** The four positions `tiny-grch38.vcf` covers, so the table has its rows. */
const TINY_ROWS: readonly Row[] = [
  { chrom: "chr2", pos: 135_851_076, id: "rs4988235", ref: "G", alt: "A", gt: "1/1" },
  { chrom: "chr11", pos: 66_560_624, id: "rs1815739", ref: "C", alt: "T", gt: "0/1" },
  { chrom: "chr12", pos: 111_803_962, id: "rs671", ref: "G", alt: "A", gt: "0/0" },
  { chrom: "chr15", pos: 74_749_576, id: "rs762551", ref: "A", alt: "C", gt: "0/1" },
];

export function buildRows(): Row[] {
  const rows: Row[] = [];
  for (const start of SAME_READING_PAIRS) {
    for (const pos of [start, start + 1_000]) {
      rows.push({ chrom: "chr1", pos, id: ".", ref: "A", alt: "G", gt: "1/1" });
    }
    // A differing row after each pair, so the two pairs stay two short runs
    // rather than joining across the gap between them.
    rows.push({ chrom: "chr1", pos: start + 500_000, id: ".", ref: "C", alt: "T", gt: "0/1" });
  }
  // Differing rows across chromosome 1, so the span the runs are measured
  // against is the whole of what this file reports.
  for (let pos = 10_000_000; pos <= 190_000_000; pos += 10_000_000) {
    rows.push({ chrom: "chr1", pos, id: ".", ref: "C", alt: "T", gt: "0/1" });
  }
  CARRIER_RSIDS.forEach((rsid, index) => {
    rows.push({
      chrom: "chr1",
      pos: CARRIER_POSITIONS[index],
      id: `rs${rsid}`,
      ref: CARRIER_REF,
      alt: CARRIER_ALT,
      gt: "0/1",
    });
  });
  rows.push(...TINY_ROWS);
  return rows.sort((left, right) =>
    left.chrom === right.chrom
      ? left.pos - right.pos
      : left.chrom.localeCompare(right.chrom, "en"),
  );
}

export function buildCarrierPairVcf(): string[] {
  const rows = buildRows();
  return [
    "##fileformat=VCFv4.2",
    "##source=Inherit deterministic synthetic fixture; no real person",
    "##reference=GRCh38",
    "##contig=<ID=chr1,length=248956422>",
    "##contig=<ID=chr2,length=242193529>",
    "##contig=<ID=chr11,length=135086622>",
    "##contig=<ID=chr12,length=133275309>",
    "##contig=<ID=chr15,length=101991189>",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE1",
    ...rows.map((row) =>
      [row.chrom, row.pos, row.id, row.ref, row.alt, 50, "PASS", ".", "GT", row.gt].join("\t"),
    ),
  ];
}

async function* asLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

export interface FixtureCheck {
  ok: boolean;
  measure: RohMeasure;
  carrierGenotypes: Record<number, string | undefined>;
  reasons: string[];
}

/** The two properties the browser spec depends on, checked with the real code. */
export async function verify(lines: readonly string[]): Promise<FixtureCheck> {
  const parsed = await parseVcf(asLines(lines));
  const calls: RohCall[] = parsed.records.map((record) => ({
    chrom: record.chrom,
    pos: record.pos,
    genotype: record.genotype,
  }));
  const measure = measureRunsOfHomozygosity(calls);
  const byRsid = new Map(parsed.records.map((record) => [record.rsid, record.genotype]));
  const carrierGenotypes = Object.fromEntries(
    CARRIER_RSIDS.map((rsid) => [rsid, byRsid.get(rsid)]),
  );
  const reasons: string[] = [];
  if (parsed.build !== "GRCh38") reasons.push(`the parser read build ${parsed.build}, not GRCh38`);
  for (const rsid of CARRIER_RSIDS) {
    const genotype = byRsid.get(rsid);
    const expected = [CARRIER_REF, CARRIER_ALT].sort().join("/");
    if (genotype !== expected) {
      reasons.push(`rs${rsid} parsed as ${String(genotype)}, not one changed copy (${expected})`);
    }
  }
  if (!belowRohThreshold(measure)) {
    reasons.push(
      `the runs measure is ${measure.status === "measured" ? "above the threshold" : measure.reason}: the rule would refuse the arithmetic`,
    );
  }
  return { ok: reasons.length === 0, measure, carrierGenotypes, reasons };
}

async function main() {
  const lines = buildCarrierPairVcf();
  const check = await verify(lines);
  if (!check.ok) {
    console.error(`fixture check failed:\n  - ${check.reasons.join("\n  - ")}`);
    process.exitCode = 1;
    return;
  }
  const text = `${lines.join("\n")}\n`;
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_NAME);
  fs.writeFileSync(target, text);
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  console.log(
    `wrote ${path.relative(process.cwd(), target)} (${text.length} bytes, ${lines.length - 10} rows)`,
  );
  if (check.measure.status === "measured") {
    console.log(
      `runs: ${check.measure.runCount} totalling ${check.measure.totalRunBases} bases over a span of ${check.measure.coveredSpanBases}; F_ROH ${check.measure.fRoh.toExponential(2)}`,
    );
  }
  console.log(
    `classified positions: ${CARRIER_RSIDS.map((rsid) => `rs${rsid} ${String(check.carrierGenotypes[rsid])}`).join(", ")}`,
  );
  console.log(`sha256: ${sha256}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
