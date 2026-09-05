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
  rohCallsFromParse,
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

/**
 * One real run of homozygosity by the cited definition (McQuillan et al.
 * 2008; src/lib/family/roh.ts): thirty rows called homozygous for the
 * reference (GT 0/0), 60 kb apart, from 5.00 Mb to 6.74 Mb on chromosome 1
 * — at least 25 calls spanning at least 1.5 Mb, well under the brief's
 * 100 Mb in total, and the reference calls that make the file measurable
 * at all. Against the 185 Mb the file covers on chromosome 1 the run puts
 * F_ROH near 0.009, below the brief's 0.0156.
 */
const RUN_START = 5_000_000;
const RUN_STEP = 60_000;
const RUN_CALLS = 30;

/** The four positions `tiny-grch38.vcf` covers, so the table has its rows. */
const TINY_ROWS: readonly Row[] = [
  { chrom: "chr2", pos: 135_851_076, id: "rs4988235", ref: "G", alt: "A", gt: "1/1" },
  { chrom: "chr11", pos: 66_560_624, id: "rs1815739", ref: "C", alt: "T", gt: "0/1" },
  { chrom: "chr12", pos: 111_803_962, id: "rs671", ref: "G", alt: "A", gt: "0/0" },
  { chrom: "chr15", pos: 74_749_576, id: "rs762551", ref: "C", alt: "A", gt: "0/1" },
];

export function buildRows(): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < RUN_CALLS; index++) {
    rows.push({
      chrom: "chr1",
      pos: RUN_START + index * RUN_STEP,
      id: ".",
      ref: "A",
      alt: "G",
      gt: "0/0",
    });
  }
  // Heterozygous rows every 10 Mb across chromosome 1: they end the run,
  // keep every other same-reading row on its own, and make the span the
  // run is measured against the whole of what this file reports.
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

/** The properties the browser spec depends on, checked with the real code. */
export async function verify(lines: readonly string[]): Promise<FixtureCheck> {
  const parsed = await parseVcf(asLines(lines));
  // The same calls the processing route measures: the variant records and
  // the reference calls the parser kept, in the file's own build.
  const measure = measureRunsOfHomozygosity(rohCallsFromParse(parsed));
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
  if (measure.status === "measured" && measure.runCount < 1) {
    reasons.push("the file holds no run by the cited definition, so the measure is not exercised");
  }
  return { ok: reasons.length === 0, measure, carrierGenotypes, reasons };
}
