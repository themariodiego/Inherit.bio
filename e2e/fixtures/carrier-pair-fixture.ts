/**
 * The carrier-pair fixture as data: the rows, the VCF text and the check the
 * generator (`generate-carrier-pair-vcf.ts`) and the browser spec
 * (`../family-health-picture.spec.ts`) both run. It is a plain module with no
 * `import.meta`, so the spec can import it under Playwright's CommonJS
 * transform and derive its expectations from the same code that wrote the
 * committed file.
 *
 * The fixture describes no real person: every coordinate and every genotype
 * is written here by hand, none was read from anyone, and the seven
 * classified positions use reserved synthetic rsIDs that exist in no public
 * catalogue (see `carrier-pair-positions.ts` and PROVENANCE.md).
 */
import { parseVcf } from "../../src/lib/genome/parsers/vcf";
import {
  belowRohThreshold,
  measureRunsOfHomozygosity,
  type RohCall,
  type RohMeasure,
} from "../../src/lib/family/roh";
import {
  CARRIER_ALT,
  CARRIER_FIXTURE_POSITIONS,
  CARRIER_OTHER_ALT,
  CARRIER_REF,
  parsedGenotype,
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
  // against is the whole of what this file reports, and so no classified
  // row sits next to a same-reading one.
  for (let pos = 10_000_000; pos <= 190_000_000; pos += 10_000_000) {
    rows.push({ chrom: "chr1", pos, id: ".", ref: "C", alt: "T", gt: "0/1" });
  }
  for (const entry of CARRIER_FIXTURE_POSITIONS) {
    rows.push({
      chrom: "chr1",
      pos: entry.pos,
      id: `rs${entry.rsid}`,
      ref: CARRIER_REF,
      // The second ALT exists only where the row calls it (GT 0/2).
      alt: entry.gt === "0/2" ? `${CARRIER_ALT},${CARRIER_OTHER_ALT}` : CARRIER_ALT,
      gt: entry.gt,
    });
  }
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
    CARRIER_FIXTURE_POSITIONS.map((entry) => [entry.rsid, byRsid.get(entry.rsid)]),
  );
  const reasons: string[] = [];
  if (parsed.build !== "GRCh38") reasons.push(`the parser read build ${parsed.build}, not GRCh38`);
  for (const entry of CARRIER_FIXTURE_POSITIONS) {
    const genotype = byRsid.get(entry.rsid);
    const expected = parsedGenotype(entry.gt);
    if (genotype !== expected) {
      reasons.push(`rs${entry.rsid} parsed as ${String(genotype)}, not ${expected} (GT ${entry.gt})`);
    }
  }
  if (!belowRohThreshold(measure)) {
    reasons.push(
      `the runs measure is ${measure.status === "measured" ? "above the threshold" : measure.reason}: the rule would refuse the arithmetic`,
    );
  }
  return { ok: reasons.length === 0, measure, carrierGenotypes, reasons };
}
