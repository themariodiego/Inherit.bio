import { describe, expect, it } from "vitest";
import {
  F_ROH_THRESHOLD,
  ROH_TOTAL_THRESHOLD_BASES,
  belowRohThreshold,
  measureRunsOfHomozygosity,
  readsTheSameOnBothCopies,
  rohColumns,
  storedRohMeasure,
  subjectRunsBelowThreshold,
  type RohCall,
  type StoredRohMeasure,
} from "./roh";

/**
 * The within-one-file measure and its storage (design §5, §6.1; ADR 0017
 * §7). Every fixture here is one file's own calls: nothing in this suite
 * pairs two files, and nothing the module exports could.
 */

/** A synthetic sorted-genotype file: `homozygous` letters repeated at `step`. */
function run(chrom: number, start: number, step: number, count: number, genotype: string): RohCall[] {
  return Array.from({ length: count }, (_, index) => ({
    chrom,
    pos: start + index * step,
    genotype,
  }));
}

const MEASURED_AT = "2026-09-03T12:00:00.000Z";

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
});

describe("runs of homozygosity in one file", () => {
  it("measures one 120 Mb run as above the threshold the brief states", () => {
    // 121 calls a megabase apart, all reading the same: a 120 Mb run.
    const measure = measureRunsOfHomozygosity(run(1, 1_000_000, 1_000_000, 121, "A/A"));
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(120_000_000);
    expect(measure.totalRunBases).toBeGreaterThan(ROH_TOTAL_THRESHOLD_BASES);
    expect(measure.aboveThreshold).toBe(true);
    expect(belowRohThreshold(measure)).toBe(false);
  });

  it("measures a short run inside a wide span as below both thresholds", () => {
    const calls = [
      ...run(1, 1_000, 1_000, 3, "A/A"),
      ...run(1, 50_000_000, 1_000_000, 40, "A/G"),
      ...run(2, 1_000, 1_000_000, 40, "C/T"),
    ];
    const measure = measureRunsOfHomozygosity(calls);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(2_000);
    expect(measure.totalRunBases).toBeLessThan(ROH_TOTAL_THRESHOLD_BASES);
    expect(measure.fRoh).toBeLessThan(F_ROH_THRESHOLD);
    expect(measure.aboveThreshold).toBe(false);
    expect(belowRohThreshold(measure)).toBe(true);
  });

  it("refuses a file that lists only the places a reader differs", () => {
    // Every row is a difference, none reads the same on both copies, so no
    // stretch of same-reading positions exists to measure.
    const measure = measureRunsOfHomozygosity([
      { chrom: 1, pos: 1_000_000, genotype: "A/G" },
      { chrom: 1, pos: 40_000_000, genotype: "C/T" },
      { chrom: 7, pos: 5_000_000, genotype: "G/T" },
      { chrom: 12, pos: 900_000, genotype: "--" },
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-runs-reported" });
    expect(belowRohThreshold(measure)).toBe(false);
  });

  it("refuses a file with no autosomal call at all, by its own reason", () => {
    const measure = measureRunsOfHomozygosity([
      ...run(23, 1_000, 1_000, 30, "A/A"),
      ...run(25, 100, 10, 30, "C/C"),
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-autosomal-calls" });
    expect(measureRunsOfHomozygosity([])).toEqual({
      status: "not_measurable",
      reason: "no-autosomal-calls",
    });
  });

  it("does not count two same-reading rows at one position as a run", () => {
    // A run is a stretch with a length; rows at one coordinate span nothing.
    const measure = measureRunsOfHomozygosity([
      { chrom: 3, pos: 5_000, genotype: "A/A" },
      { chrom: 3, pos: 5_000, genotype: "A/A" },
      { chrom: 3, pos: 9_000, genotype: "A/G" },
    ]);
    expect(measure).toEqual({ status: "not_measurable", reason: "no-runs-reported" });
  });

  it("counts only autosomes and does not depend on the order rows arrive in", () => {
    const autosomal = run(1, 1_000, 1_000, 3, "A/A");
    const sex = run(23, 1_000, 1_000, 30, "A/A");
    const shuffled = [...sex, ...autosomal].reverse();
    const measure = measureRunsOfHomozygosity(shuffled);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.runCount).toBe(1);
    expect(measure.totalRunBases).toBe(2_000);
    expect(measure.coveredSpanBases).toBe(2_000);
  });

  it("reads the processing route's records as they are: only chrom, pos and genotype", () => {
    // The shape of a parsed VariantRecord, with the fields the measure ignores.
    const records = run(4, 10_000, 1_000, 3, "T/T").map((call) => ({
      ...call,
      rsid: null,
      ref: "T",
      alt: "C",
    }));
    const measure = measureRunsOfHomozygosity(records);
    expect(measure.status).toBe("measured");
    if (measure.status !== "measured") return;
    expect(measure.totalRunBases).toBe(2_000);
  });

  it("never combines two files: each measure answers for its own calls", () => {
    const one = measureRunsOfHomozygosity(run(1, 1_000, 1_000_000, 121, "A/A"));
    const other = measureRunsOfHomozygosity([
      ...run(1, 1_000, 1_000, 3, "A/A"),
      ...run(1, 50_000_000, 1_000_000, 40, "A/G"),
    ]);
    expect(belowRohThreshold(one)).toBe(false);
    expect(belowRohThreshold(other)).toBe(true);
    // The two answers stand apart; the module offers nothing that merges them.
    expect(Object.keys({ one, other })).toHaveLength(2);
  });
});

describe("storing the measure with the file", () => {
  const below = measureRunsOfHomozygosity([
    ...run(1, 1_000, 1_000, 3, "A/A"),
    ...run(1, 50_000_000, 1_000_000, 40, "A/G"),
  ]);
  const above = measureRunsOfHomozygosity(run(1, 1_000_000, 1_000_000, 121, "A/A"));
  const unmeasurable = measureRunsOfHomozygosity([{ chrom: 1, pos: 1, genotype: "A/G" }]);

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
    expect(columns.roh_total_bases).toBe(2_000);
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
      roh_reason: "no-runs-reported",
      roh_total_bases: null,
      roh_covered_bases: null,
      roh_fraction: null,
      roh_measured_at: MEASURED_AT,
    });
    expect(storedRohMeasure(columns)).toEqual({ status: "not_measurable", reason: "no-runs-reported" });
    expect(belowRohThreshold(storedRohMeasure(columns))).toBe(false);
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
        ...run(1, 1_000, 1_000, 3, "A/A"),
        ...run(1, 50_000_000, 1_000_000, 40, "A/G"),
      ]),
      MEASURED_AT,
    ),
  );
  const notMeasurable: StoredRohMeasure = { status: "not_measurable", reason: "no-runs-reported" };
  const unmeasured: StoredRohMeasure = { status: "unmeasured" };
  const aboveThreshold = storedRohMeasure(
    rohColumns(measureRunsOfHomozygosity(run(1, 1_000_000, 1_000_000, 121, "A/A")), MEASURED_AT),
  );

  it("is below threshold only when every annotated file is measured and below", () => {
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
