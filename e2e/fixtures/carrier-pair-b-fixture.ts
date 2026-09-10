/**
 * The second carrier pair, as data: the rows, the VCF text and the same check
 * the first pair is held to (`carrier-pair-fixture.ts`, `verifyAgainst`).
 *
 * This is G8.3's seed B for `/family/health-picture`. That surface renders one
 * table per layer, one row per report and one column per person, and the whole
 * page is read from the files the two adults prepared — so a second seed there
 * is a second pair of files, not a second parameter. Both members of pair A
 * read `carrier-pair-grch38.vcf`; both members of pair B read this one, so the
 * only thing that changes between the two runs is which person's file the page
 * is describing.
 *
 * It describes no real person, and describes a different one from pair A. Every
 * coordinate and every genotype is written here by hand, none was read from
 * anyone, and the seven classified positions reuse the reserved synthetic rsIDs
 * of `carrier-pair-positions.ts`, which exist in no public catalogue.
 *
 * What differs from pair A, and why each difference is here — every one was
 * added because a specific figure would not otherwise move, found by running
 * the comparison rather than by reading the code:
 *
 *   - all four public report positions are called differently, and all four
 *     calls stay inside the letters those reports interpret, so the twelve
 *     genotype figures the six covered reports render move rather than the
 *     cells changing state and rendering different figures;
 *   - the run of homozygosity and the heterozygous rows are a different
 *     shape, so the file reports a different number of supported calls and
 *     the input-provenance figure — `calls in N of N listed, supported
 *     records`, rendered once per cell — moves with it;
 *   - the seven classified positions carry a different spread of the closed
 *     table's three readings, so a second pair is a second pair rather than
 *     pair A under another name.
 *
 * A report's own coverage figure is the one thing on that surface no second
 * pair can move; `docs/figures-register.json` states why, at shape level.
 */
import {
  CARRIER_ALT,
  CARRIER_FIXTURE_POSITIONS,
  CARRIER_OTHER_ALT,
  CARRIER_REF,
  type FixtureGenotype,
} from "./carrier-pair-positions";

export const FIXTURE_NAME_B = "carrier-pair-b-grch38.vcf";

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
 * 2008; src/lib/family/roh.ts), a different one from pair A's: thirty-two
 * rows called homozygous for the reference (GT 0/0), 55 kb apart, from
 * 5.00 Mb to 6.705 Mb on chromosome 1 — at least 25 calls spanning at least
 * 1.5 Mb, far under the brief's 100 Mb in total, and the reference calls that
 * make the file measurable at all. `verifyAgainstB` runs the real measure over
 * the real parser's output and refuses a file whose F_ROH is not below the
 * brief's 0.0156.
 */
const RUN_START = 5_000_000;
const RUN_STEP = 55_000;
const RUN_CALLS = 32;

/** Heterozygous rows every 8 Mb, none of them inside the run above. */
const HET_START = 8_000_000;
const HET_STEP = 8_000_000;
const HET_END = 192_000_000;

/**
 * The seven classified positions, at pair A's coordinates with this pair's
 * own readings: five of the seven differ from pair A's, and all three
 * readings the closed table names are still present (one changed copy, two
 * changed copies, and a changed copy of the other letter).
 */
export const CARRIER_B_GENOTYPES: readonly FixtureGenotype[] = [
  "1/1",
  "0/2",
  "0/1",
  "1/1",
  "0/1",
  "0/1",
  "0/2",
];

export const CARRIER_B_POSITIONS: readonly { rsid: number; pos: number; gt: FixtureGenotype }[] =
  CARRIER_FIXTURE_POSITIONS.map((entry, index) => ({
    rsid: entry.rsid,
    pos: entry.pos,
    gt: CARRIER_B_GENOTYPES[index]!,
  }));

/**
 * The four public report positions, called differently from pair A and still
 * inside the letters each report interprets, so the covered cells keep their
 * `letters` state and their genotype figures move rather than vanish:
 *
 *   rs4988235  pair A 1/1 (A/A)  → 0/1 (A/G), interpreted as AG
 *   rs1815739  pair A 0/1 (C/T)  → 1/1 (T/T), interpreted as TT
 *   rs671      pair A 0/0 (G/G)  → 0/1 (A/G), interpreted as AG
 *   rs762551   pair A 0/1 (A/C)  → 1/1 (A/A), interpreted as AA
 */
const TINY_ROWS: readonly Row[] = [
  { chrom: "chr2", pos: 135_851_076, id: "rs4988235", ref: "G", alt: "A", gt: "0/1" },
  { chrom: "chr11", pos: 66_560_624, id: "rs1815739", ref: "C", alt: "T", gt: "1/1" },
  { chrom: "chr12", pos: 111_803_962, id: "rs671", ref: "G", alt: "A", gt: "0/1" },
  { chrom: "chr15", pos: 74_749_576, id: "rs762551", ref: "C", alt: "A", gt: "1/1" },
];

export function buildRowsB(): Row[] {
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
  for (let pos = HET_START; pos <= HET_END; pos += HET_STEP) {
    rows.push({ chrom: "chr1", pos, id: ".", ref: "C", alt: "T", gt: "0/1" });
  }
  for (const entry of CARRIER_B_POSITIONS) {
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

export function buildCarrierPairBVcf(): string[] {
  const rows = buildRowsB();
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

/**
 * The public report positions this file calls, and the letters the parser
 * reads there. The two-seed spec asserts these against pair A's rather than
 * assuming they differ: two seeds that happen to agree at every report
 * position would leave twelve genotype figures unmoved and the run would say
 * so, but it would say it as a differencing failure rather than as what it is,
 * a fixture that was never a second person.
 */
export const CARRIER_B_REPORT_CALLS: readonly { rsid: number; genotype: string }[] = [
  { rsid: 4_988_235, genotype: "A/G" },
  { rsid: 1_815_739, genotype: "T/T" },
  { rsid: 671, genotype: "A/G" },
  { rsid: 762_551, genotype: "A/A" },
];
