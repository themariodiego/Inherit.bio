import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArray } from "@/lib/genome/parsers/array";
import { parseVcf } from "@/lib/genome/parsers/vcf";
import {
  F_ROH_THRESHOLD,
  ROH_MAX_HETEROZYGOUS_IN_RUN,
  ROH_MIN_RUN_BASES,
  ROH_MIN_RUN_CALLS,
  ROH_TOTAL_THRESHOLD_BASES,
  belowRohThreshold,
  isReferenceHomozygous,
  measureRunsOfHomozygosity,
  readsTheSameOnBothCopies,
  rohCallsFromParse,
  rohColumns,
  storedRohMeasure,
  subjectRunsBelowThreshold,
  type RohCall,
  type StoredRohMeasure,
} from "./roh";

/**
 * The within-one-file measure and its storage (design §5, §6.1; ADR 0017
 * §7, D-040). A run is McQuillan et al. 2008's: at least 25 contiguous
 * same-reading autosomal calls spanning at least 1.5 Mb, at most one
 * heterozygous call inside. Every fixture here is one file's own calls:
 * nothing in this suite pairs two files, and nothing the module exports
 * could.
 */

/** A synthetic stretch: `count` calls of `genotype` from `start`, `step` apart. */
function stretch(chrom: number, start: number, step: number, count: number, genotype: string): RohCall[] {
  return Array.from({ length: count }, (_, index) => ({
    chrom,
    pos: start + index * step,
    genotype,
  }));
}

/** A wide heterozygous background on one autosome, so a run has a span to sit in. */
function background(chrom: number): RohCall[] {
  return stretch(chrom, 100_000_000, 10_000_000, 12, "C/T");
}

const MEASURED_AT = "2026-09-03T12:00:00.000Z";

describe("the cited constants", () => {
  it("are McQuillan et al. 2008's, and the thresholds the brief's", () => {
    expect(ROH_MIN_RUN_BASES).toBe(1_500_000);
    expect(ROH_MIN_RUN_CALLS).toBe(25);
    expect(ROH_MAX_HETEROZYGOUS_IN_RUN).toBe(1);
    expect(ROH_TOTAL_THRESHOLD_BASES).toBe(100_000_000);
    expect(F_ROH_THRESHOLD).toBe(0.0156);
  });
});

describe("zygosity of one call", () => {
  it("reads two identical letters as the same on both copies and nothing else", () => {
    expect(readsTheSameOnBothCopies("A/A")).toBe(true);
    expect(readsTheSameOnBothCopies("C/C")).toBe(true);
    expect(readsTheSameOnBothCopies("A/G")).toBe(false);
    // A single letter does not say how many copies were read, and a no-call
    // says nothing at all: neither extends a run.
    expect(readsTheSameOnBothCopies("A")).toBe(false);
    expect(readsTheSameOnBothCopies("--")).toBe(false);
    expect(readsTheSameOnBothCopies("")).toBe(false);
  });

  it("reads a reference call from what the parser exposes", () => {
    // A VCF call carries its reference allele.
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A/A", ref: "A" })).toBe(true);
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "G/G", ref: "A" })).toBe(false);
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A/G", ref: "A" })).toBe(false);
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A", ref: "A" })).toBe(false);
    // An array call carries none: a same-reading call is a reported non-difference position.
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A/A", ref: null })).toBe(true);
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A/A" })).toBe(true);
    expect(isReferenceHomozygous({ chrom: 1, pos: 1, genotype: "A/G" })).toBe(false);
  });
});

describe("what is a run (McQuillan et al. 2008)", () => {
  const measured = (calls: RohCall[]) => {
    const measure = measureRunsOfHomozygosity(calls);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") throw new Error("unreachable");
    return measure;
  };

  it("does not count 24 same-reading calls spanning 1.6 Mb", () => {
    // 24 calls, 69,565 bases apart: 23 gaps, a span of 1,599,995 bases.
    const measure = measured([...stretch(1, 1_000_000, 69_565, 24, "A/A"), ...background(1)]);
    expect(measure.runCount).toBe(0);
    expect(measure.totalRunBases).toBe(0);
  });

  it("does not count 25 same-reading calls spanning 1.4 Mb", () => {
    // 25 calls, 58,333 bases apart: 24 gaps, a span of 1,399,992 bases.
    const measure = measured([...stretch(1, 1_000_000, 58_333, 25, "A/A"), ...background(1)]);
    expect(measure.runCount).toBe(0);
    expect(measure.totalRunBases).toBe(0);
  });

  it("counts 25 same-reading calls spanning exactly 1.5 Mb", () => {
    // 25 calls, 62,500 bases apart: 24 gaps, a span of exactly 1,500,000.
    const measure = measured([...stretch(1, 1_000_000, 62_500, 25, "A/A"), ...background(1)]);
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(1_500_000);
  });

  it("keeps a run with one heterozygous call inside, and breaks it with two", () => {
    const calls = stretch(1, 1_000_000, 62_500, 25, "A/A");
    const oneInside = calls.map((call, index) => (index === 12 ? { ...call, genotype: "A/G" } : call));
    const one = measured([...oneInside, ...background(1)]);
    expect(one.runCount).toBe(1);
    expect(one.totalRunBases).toBe(1_500_000);

    const twoInside = calls.map((call, index) =>
      index === 8 || index === 16 ? { ...call, genotype: "A/G" } : call,
    );
    const two = measured([...twoInside, ...background(1)]);
    expect(two.runCount).toBe(0);
    expect(two.totalRunBases).toBe(0);
  });

  it("is not broken by a gap between reported positions", () => {
    // Twelve calls, a 40 Mb gap, then thirteen more: one run of 25 calls.
    const calls = [
      ...stretch(1, 1_000_000, 10_000, 12, "A/A"),
      ...stretch(1, 41_000_000, 10_000, 13, "A/A"),
    ];
    const measure = measured([...calls, ...background(1)]);
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(41_120_000 - 1_000_000);
  });

  it("does not start or end a run on a heterozygous call", () => {
    // 25 same-reading calls with a heterozygous call on each edge: the
    // edges are not part of the run, so its span is the inner 1.5 Mb.
    const calls = [
      { chrom: 1, pos: 900_000, genotype: "A/G" },
      ...stretch(1, 1_000_000, 62_500, 25, "A/A"),
      { chrom: 1, pos: 2_600_000, genotype: "A/G" },
    ];
    const measure = measured([...calls, ...background(1)]);
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(1_500_000);
  });

  it("never counts a base twice where two candidate runs share the calls around one tolerated call", () => {
    // 30 same-reading calls, one heterozygous call, 30 more: the windows
    // either side of the heterozygous call overlap and merge into one run.
    const calls = [
      ...stretch(1, 1_000_000, 62_500, 30, "A/A"),
      { chrom: 1, pos: 2_850_000, genotype: "A/G" },
      ...stretch(1, 2_900_000, 62_500, 30, "A/A"),
    ];
    const measure = measured([...calls, ...background(1)]);
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(2_900_000 + 29 * 62_500 - 1_000_000);
  });

  it("measures one 120 Mb run as above the threshold the brief states", () => {
    // 121 calls a megabase apart, all reading the same: a 120 Mb run.
    const measure = measured(stretch(1, 1_000_000, 1_000_000, 121, "A/A"));
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(120_000_000);
    expect(measure.totalRunBases).toBeGreaterThan(ROH_TOTAL_THRESHOLD_BASES);
    expect(measure.aboveThreshold).toBe(true);
    expect(belowRohThreshold(measure)).toBe(false);
  });

  it("measures a measurable file with no run at zero, which is below both thresholds", () => {
    // Three same-reading calls are no run; the file is still measurable.
    const measure = measured([
      ...stretch(1, 1_000, 1_000, 3, "A/A"),
      ...stretch(1, 50_000_000, 1_000_000, 40, "A/G"),
      ...stretch(2, 1_000, 1_000_000, 40, "C/T"),
    ]);
    expect(measure.runCount).toBe(0);
    expect(measure.totalRunBases).toBe(0);
    expect(measure.fRoh).toBe(0);
    expect(measure.coveredSpanBases).toBe(89_000_000 - 1_000 + 39_000_000);
    expect(measure.aboveThreshold).toBe(false);
    expect(belowRohThreshold(measure)).toBe(true);
  });

  it("applies F_ROH over the span the file covers, which can only refuse more for a sparse file", () => {
    // A 3 Mb run over a 100 Mb covered span: F_ROH 0.03, above 0.0156
    // though far below 100 Mb of runs.
    const measure = measured([
      ...stretch(3, 1_000_000, 100_000, 31, "A/A"),
      { chrom: 3, pos: 101_000_000, genotype: "A/G" },
    ]);
    expect(measure.totalRunBases).toBe(3_000_000);
    expect(measure.coveredSpanBases).toBe(100_000_000);
    expect(measure.fRoh).toBeCloseTo(0.03, 12);
    expect(measure.aboveThreshold).toBe(true);
  });
});

describe("what cannot be measured", () => {
  it("refuses a file that lists only the places a reader differs", () => {
    // Every row is a difference, none is homozygous for the reference, so
    // the space between the rows is unrecorded, not identical.
    const measure = measureRunsOfHomozygosity([
      { chrom: 1, pos: 1_000_000, genotype: "A/G", ref: "A" },
      { chrom: 1, pos: 40_000_000, genotype: "C/T", ref: "C" },
      { chrom: 7, pos: 5_000_000, genotype: "G/T", ref: "G" },
      { chrom: 12, pos: 900_000, genotype: "--", ref: "T" },
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-reference-calls" });
    expect(belowRohThreshold(measure)).toBe(false);
  });

  it("refuses a differences-only VCF even where its 1/1 rows sit side by side", () => {
    // Thirty adjacent same-reading rows, every one a difference from the
    // reference: they would be a run in an array file, but nothing between
    // them is recorded here.
    const calls = stretch(1, 1_000_000, 62_500, 30, "G/G").map((call) => ({ ...call, ref: "A" }));
    expect(measureRunsOfHomozygosity([...calls, ...background(1).map((call) => ({ ...call, ref: "C" }))])).toEqual({
      status: "not_measurable",
      reason: "no-reference-calls",
    });
  });

  it("measures the same rows once one reference call is among them", () => {
    const calls = stretch(1, 1_000_000, 62_500, 30, "G/G").map((call) => ({ ...call, ref: "A" }));
    const measure = measureRunsOfHomozygosity([
      ...calls,
      { chrom: 1, pos: 5_000_000, genotype: "T/T", ref: "T" },
      ...background(1).map((call) => ({ ...call, ref: "C" })),
    ]);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.runCount).toBe(1);
  });

  it("refuses a file with no autosomal call at all, by its own reason", () => {
    const measure = measureRunsOfHomozygosity([
      ...stretch(23, 1_000, 1_000, 30, "A/A"),
      ...stretch(25, 100, 10, 30, "C/C"),
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-autosomal-calls" });
    expect(measureRunsOfHomozygosity([])).toEqual({
      status: "not_measurable",
      reason: "no-autosomal-calls",
    });
  });

  it("refuses a file that covers no autosomal stretch at all", () => {
    // One reported position per autosome: no span for a run to lie in and
    // no denominator.
    const measure = measureRunsOfHomozygosity([
      { chrom: 3, pos: 5_000, genotype: "A/A" },
      { chrom: 3, pos: 5_000, genotype: "A/A" },
      { chrom: 4, pos: 9_000, genotype: "A/A" },
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-runs-reported" });
  });
});

describe("the calls a parse gives the measure", () => {
  it("counts only autosomes and does not depend on the order rows arrive in", () => {
    const autosomal = stretch(1, 1_000, 1_000, 3, "A/A");
    const sex = stretch(23, 1_000, 1_000, 30, "A/A");
    const shuffled = [...sex, ...autosomal].reverse();
    const measure = measureRunsOfHomozygosity(shuffled);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.runCount).toBe(0);
    expect(measure.coveredSpanBases).toBe(2_000);
  });

  it("reads a parse's variant records and reference calls together, with the reference allele each carries", () => {
    const calls = rohCallsFromParse({
      build: "GRCh38",
      records: [
        { rsid: 1, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G" },
        { rsid: null, chrom: 1, pos: 200, ref: "G", alt: "A", genotype: "A/A" },
      ],
      referenceCalls: [{ chrom: 1, pos: 150, genotype: "T/T", ref: "T" }],
      skipped: 0,
    });
    expect(calls).toEqual([
      { chrom: 1, pos: 100, genotype: "A/G", ref: "A" },
      { chrom: 1, pos: 200, genotype: "A/A", ref: "G" },
      { chrom: 1, pos: 150, genotype: "T/T", ref: "T" },
    ]);
    expect(calls.filter(isReferenceHomozygous)).toEqual([{ chrom: 1, pos: 150, genotype: "T/T", ref: "T" }]);
  });

  it("finds a VCF's 0/0 rows through the real parser, and reads a differences-only VCF as unmeasurable", async () => {
    const header = [
      "##fileformat=VCFv4.2",
      "##reference=GRCh38",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS",
    ];
    const rows = (gt: string) =>
      Array.from({ length: 30 }, (_, index) =>
        ["chr1", 1_000_000 + index * 62_500, ".", "A", "G", 50, "PASS", ".", "GT", gt].join("\t"),
      );
    const tail = ["chr1", 200_000_000, ".", "C", "T", 50, "PASS", ".", "GT", "0/1"].join("\t");
    async function* lines(text: string[]) {
      for (const line of text) yield line;
    }

    const full = await parseVcf(lines([...header, ...rows("0/0"), tail]));
    expect(full.records).toHaveLength(1);
    expect(full.referenceCalls).toHaveLength(30);
    const measure = measureRunsOfHomozygosity(rohCallsFromParse(full));
    expect(measure.status).toBe("measured");
    if (measure.status === "measured") {
      expect(measure.runCount).toBe(1);
      expect(measure.totalRunBases).toBe(29 * 62_500);
      expect(belowRohThreshold(measure)).toBe(true);
    }

    const differences = await parseVcf(lines([...header, ...rows("1/1"), tail]));
    expect(differences.referenceCalls).toHaveLength(0);
    expect(measureRunsOfHomozygosity(rohCallsFromParse(differences))).toEqual({
      status: "not_measurable",
      reason: "no-reference-calls",
    });
  });

  it("measures the repository's synthetic 23andMe sample as below both thresholds", async () => {
    // A real array-shaped file through the real parser: measurable (an
    // array lists every probed position) and, with the cited definition of
    // a run, below both thresholds. The direction is asserted, not a number.
    const text = fs.readFileSync(
      path.join(process.cwd(), "data/samples/synthetic_23andme.txt"),
      "utf8",
    );
    async function* lines() {
      for (const line of text.split("\n")) yield line;
    }
    const parsed = await parseArray(lines(), "array_23andme");
    expect(parsed.records.length).toBeGreaterThan(1_000);
    expect(parsed.referenceCalls).toEqual([]);
    const measure = measureRunsOfHomozygosity(rohCallsFromParse(parsed));
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.totalRunBases).toBeLessThanOrEqual(ROH_TOTAL_THRESHOLD_BASES);
    expect(measure.fRoh).toBeLessThanOrEqual(F_ROH_THRESHOLD);
    expect(measure.aboveThreshold).toBe(false);
    expect(belowRohThreshold(measure)).toBe(true);
  });

  it("never combines two files: each measure answers for its own calls", () => {
    const one = measureRunsOfHomozygosity(stretch(1, 1_000, 1_000_000, 121, "A/A"));
    const other = measureRunsOfHomozygosity([
      ...stretch(1, 1_000, 1_000, 3, "A/A"),
      ...stretch(1, 50_000_000, 1_000_000, 40, "A/G"),
    ]);
    expect(belowRohThreshold(one)).toBe(false);
    expect(belowRohThreshold(other)).toBe(true);
    // The two answers stand apart; the module offers nothing that merges them.
    expect(Object.keys({ one, other })).toHaveLength(2);
  });
});

describe("storing the measure with the file", () => {
  const below = measureRunsOfHomozygosity([
    ...stretch(1, 1_000_000, 62_500, 25, "A/A"),
    ...stretch(1, 50_000_000, 1_000_000, 40, "A/G"),
  ]);
  const above = measureRunsOfHomozygosity(stretch(1, 1_000_000, 1_000_000, 121, "A/A"));
  const unmeasurable = measureRunsOfHomozygosity([{ chrom: 1, pos: 1, genotype: "A/G", ref: "A" }]);

  it("writes the six columns in the shape the table admits, and reads them back the same", () => {
    expect(below.status).toBe("measured");
    if (below.status !== "measured") return;
    const columns = rohColumns(below, MEASURED_AT);
    expect(columns).toEqual({
      roh_status: "measured",
      roh_reason: null,
      roh_total_bases: below.totalRunBases,
      roh_covered_bases: below.coveredSpanBases,
      roh_fraction: below.fRoh,
      roh_measured_at: MEASURED_AT,
    });
    // The shape `genome_files_roh_shape` and the column checks admit.
    expect(columns.roh_total_bases).toBe(1_500_000);
    expect(columns.roh_fraction).toBeGreaterThanOrEqual(0);
    expect(columns.roh_fraction).toBeLessThanOrEqual(1);
    expect(columns.roh_covered_bases).toBeGreaterThan(0);
    expect(storedRohMeasure(columns)).toEqual({
      status: "measured",
      totalRunBases: below.totalRunBases,
      coveredSpanBases: below.coveredSpanBases,
      fRoh: below.fRoh,
    });
    expect(belowRohThreshold(storedRohMeasure(columns))).toBe(belowRohThreshold(below));
  });

  it("writes an unmeasurable file with its reason and nothing else", () => {
    const columns = rohColumns(unmeasurable, MEASURED_AT);
    expect(columns).toEqual({
      roh_status: "not_measurable",
      roh_reason: "no-reference-calls",
      roh_total_bases: null,
      roh_covered_bases: null,
      roh_fraction: null,
      roh_measured_at: MEASURED_AT,
    });
    expect(storedRohMeasure(columns)).toEqual({ status: "not_measurable", reason: "no-reference-calls" });
    expect(belowRohThreshold(storedRohMeasure(columns))).toBe(false);
  });

  it("reads every stored reason back, the two older ones included", () => {
    for (const reason of ["no-runs-reported", "no-autosomal-calls", "no-reference-calls"] as const) {
      expect(
        storedRohMeasure({
          roh_status: "not_measurable",
          roh_reason: reason,
          roh_total_bases: null,
          roh_covered_bases: null,
          roh_fraction: null,
        }),
      ).toEqual({ status: "not_measurable", reason });
    }
  });

  it("reads a file processed before the measure existed as unmeasured, never as below threshold", () => {
    const stored = storedRohMeasure({
      roh_status: null,
      roh_reason: null,
      roh_total_bases: null,
      roh_covered_bases: null,
      roh_fraction: null,
    });
    expect(stored).toEqual({ status: "unmeasured" });
    expect(belowRohThreshold(stored)).toBe(false);
    // A malformed row is unmeasured too: no number is ever trusted alone.
    expect(
      storedRohMeasure({
        roh_status: "measured",
        roh_reason: null,
        roh_total_bases: 5,
        roh_covered_bases: null,
        roh_fraction: null,
      }),
    ).toEqual({ status: "unmeasured" });
  });

  it("applies the same two thresholds to a stored measure as to a fresh one", () => {
    const storedAbove = storedRohMeasure(rohColumns(above, MEASURED_AT));
    expect(belowRohThreshold(storedAbove)).toBe(false);
    const highFraction: StoredRohMeasure = {
      status: "measured",
      totalRunBases: 50_000_000,
      coveredSpanBases: 2_000_000_000,
      fRoh: 0.025,
    };
    expect(belowRohThreshold(highFraction)).toBe(false);
    const both: StoredRohMeasure = {
      status: "measured",
      totalRunBases: 50_000_000,
      coveredSpanBases: 5_000_000_000,
      fRoh: 0.01,
    };
    expect(belowRohThreshold(both)).toBe(true);
  });
});

describe("the rule for one person's files", () => {
  const measured = storedRohMeasure(
    rohColumns(
      measureRunsOfHomozygosity([
        ...stretch(1, 1_000, 1_000, 3, "A/A"),
        ...stretch(1, 50_000_000, 1_000_000, 40, "A/G"),
      ]),
      MEASURED_AT,
    ),
  );
  const notMeasurable: StoredRohMeasure = { status: "not_measurable", reason: "no-reference-calls" };
  const unmeasured: StoredRohMeasure = { status: "unmeasured" };
  const aboveThreshold = storedRohMeasure(
    rohColumns(measureRunsOfHomozygosity(stretch(1, 1_000_000, 1_000_000, 121, "A/A")), MEASURED_AT),
  );

  it("is below threshold only when every annotated file is measured and below", () => {
    expect(measured.status).toBe("measured");
    expect(subjectRunsBelowThreshold([measured])).toBe(true);
    expect(subjectRunsBelowThreshold([measured, measured])).toBe(true);
  });

  it("is not below threshold with any unmeasurable, unmeasured or above-threshold file", () => {
    expect(subjectRunsBelowThreshold([measured, notMeasurable])).toBe(false);
    expect(subjectRunsBelowThreshold([notMeasurable])).toBe(false);
    expect(subjectRunsBelowThreshold([measured, unmeasured])).toBe(false);
    expect(subjectRunsBelowThreshold([measured, aboveThreshold])).toBe(false);
  });

  it("is not below threshold with no file at all", () => {
    expect(subjectRunsBelowThreshold([])).toBe(false);
  });
});
