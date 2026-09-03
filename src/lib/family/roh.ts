import { genotypeKey } from "@/lib/genome/reports";
import type { Db } from "@/lib/genome/load";

/**
 * Runs of homozygosity, measured inside ONE file (design §5; brief §4 §5.3;
 * ADR 0017 §7, D-030).
 *
 * **This is not a relatedness quantity.** It is a fact about a single file:
 * how much of what that file reports is made of long stretches where both
 * copies read the same letter. Two files are never read together here, the
 * two answers are never subtracted, divided, averaged or combined, and
 * nothing in this module or its callers produces shared DNA, a centimorgan
 * length, an IBD segment, a kinship coefficient or a relationship label.
 * `evaluateCarrierPairs` asks each person's files, on their own, whether
 * every one of them is below the threshold; it never compares them (X15,
 * brief line 348, acceptance 20).
 *
 * The only numbers here are the two the brief states at line 1349 — a total
 * of 100 Mb of runs, and an F_ROH of 0.0156 — and the positions the file
 * itself reports. No genome length is assumed: the denominator is the
 * autosomal span the file covers (first to last reported position on each
 * autosome), so the quantity is about the file that was read rather than
 * about a reference genome nobody uploaded.
 *
 * The measure is taken once, at ingest, from the parsed calls the
 * processing route already holds, and stored on `genome_files` (migration
 * `20260903200000_genome_files_runs_of_homozygosity.sql`). Readers never
 * re-derive it from `user_variants`: a request-time read budget made every
 * real array or sequence file unmeasurable (D-030). What cannot be measured
 * is said, never guessed. A file that lists only the places where a reader
 * differs from the reference reports no stretch of same-reading positions
 * at all: between its rows the genome is unrecorded, not identical. Such a
 * file is stored as `not_measurable`, and the surface above refuses the
 * arithmetic with that reason rather than assuming the file is safe to
 * compute from.
 *
 * The module carries no `server-only` marker: it is pure arithmetic plus one
 * reader that takes its database client as a parameter, exactly as
 * `src/lib/genome/load.ts` does, so the browser-fixture generator can check a
 * fixture with the real measure rather than a copy of it.
 */

/** Total run length above which the brief refuses the arithmetic (brief line 1349). */
export const ROH_TOTAL_THRESHOLD_BASES = 100_000_000;

/** F_ROH above which the brief refuses the arithmetic (brief line 1349). */
export const F_ROH_THRESHOLD = 0.0156;

/**
 * Why a file cannot be measured. `no-runs-reported`: the file reports no
 * stretch of same-reading autosomal calls (a file of differences only).
 * `no-autosomal-calls`: the file reports no autosomal call at all. These
 * are the two values `genome_files.roh_reason` admits.
 */
export const ROH_UNMEASURABLE_REASONS = ["no-runs-reported", "no-autosomal-calls"] as const;
export type RohUnmeasurableReason = (typeof ROH_UNMEASURABLE_REASONS)[number];

/** One call as this measure reads it: an autosome, a position and the letters. */
export interface RohCall {
  chrom: number;
  pos: number;
  genotype: string;
}

export type RohMeasure =
  | {
      status: "measured";
      /** Number of runs of two or more consecutive same-reading calls. */
      runCount: number;
      /** Sum of the runs' spans, in bases. */
      totalRunBases: number;
      /** Sum over autosomes of (last reported position − first reported position). */
      coveredSpanBases: number;
      /** totalRunBases / coveredSpanBases. */
      fRoh: number;
      /** True when either threshold the brief states is exceeded. */
      aboveThreshold: boolean;
    }
  | { status: "not_measurable"; reason: RohUnmeasurableReason };

/** Autosomes only: 1–22 (23 = X, 24 = Y, 25 = MT are never counted). */
function isAutosome(chrom: number): boolean {
  return Number.isInteger(chrom) && chrom >= 1 && chrom <= 22;
}

/** The one rule both thresholds are applied by, for a fresh and a stored measure alike. */
export function exceedsRohThreshold(totalRunBases: number, fRoh: number): boolean {
  return totalRunBases > ROH_TOTAL_THRESHOLD_BASES || fRoh > F_ROH_THRESHOLD;
}

/**
 * Whether one call reads the same on both copies. A call that does not show
 * two readable letters (a no-call, or a single letter) is neither: it breaks
 * a run rather than extending it, because an unreadable position is not
 * evidence of anything.
 */
export function readsTheSameOnBothCopies(genotype: string): boolean {
  const key = genotypeKey(genotype);
  return key !== null && key.length === 2 && key[0] === key[1];
}

/**
 * The measure. Calls arrive in any order; autosomes are grouped and sorted
 * here so the answer does not depend on the order rows came back in. The
 * parsed records of the processing route are passed as they are: only
 * `chrom`, `pos` and `genotype` are read, the same three fields the variant
 * rows are built from.
 */
export function measureRunsOfHomozygosity(calls: readonly RohCall[]): RohMeasure {
  const byChrom = new Map<number, RohCall[]>();
  for (const call of calls) {
    if (!isAutosome(call.chrom) || !Number.isFinite(call.pos)) continue;
    const bucket = byChrom.get(call.chrom);
    if (bucket) bucket.push(call);
    else byChrom.set(call.chrom, [call]);
  }
  if (byChrom.size === 0) return { status: "not_measurable", reason: "no-autosomal-calls" };

  let runCount = 0;
  let totalRunBases = 0;
  let coveredSpanBases = 0;

  for (const bucket of byChrom.values()) {
    const sorted = [...bucket].sort((left, right) => left.pos - right.pos);
    coveredSpanBases += sorted[sorted.length - 1].pos - sorted[0].pos;

    let runStart: number | null = null;
    let runEnd = 0;
    let runLength = 0;
    // A run is a stretch: two or more same-reading calls at distinct
    // positions. Two rows at one position span no bases and are no run.
    const closeRun = () => {
      if (runStart !== null && runLength >= 2 && runEnd > runStart) {
        runCount++;
        totalRunBases += runEnd - runStart;
      }
      runStart = null;
      runLength = 0;
    };
    for (const call of sorted) {
      if (readsTheSameOnBothCopies(call.genotype)) {
        if (runStart === null) runStart = call.pos;
        runEnd = call.pos;
        runLength++;
        continue;
      }
      closeRun();
    }
    closeRun();
  }

  // A file that reports no stretch of same-reading positions cannot answer
  // the question at all: the space between its rows is unrecorded, not
  // identical. That is the shape of a file listing only differences.
  if (runCount === 0) return { status: "not_measurable", reason: "no-runs-reported" };

  // A run lies inside its autosome's span, so the span is positive here and
  // the fraction is in [0, 1]: the shape `genome_files_roh_shape` requires.
  const fRoh = totalRunBases / coveredSpanBases;
  return {
    status: "measured",
    runCount,
    totalRunBases,
    coveredSpanBases,
    fRoh,
    aboveThreshold: exceedsRohThreshold(totalRunBases, fRoh),
  };
}

// ---------------------------------------------------------------------------
// Storage: the six `genome_files` columns, written once by the processing
// route and read back by the carrier panel.
// ---------------------------------------------------------------------------

/** The six columns, in the shape `genome_files_roh_shape` admits. */
export interface RohColumns {
  roh_status: "measured" | "not_measurable";
  roh_reason: RohUnmeasurableReason | null;
  roh_total_bases: number | null;
  roh_covered_bases: number | null;
  roh_fraction: number | null;
  roh_measured_at: string;
}

/** The six columns as a row reads them back: every one nullable until processed. */
export interface RohRow {
  roh_status: string | null;
  roh_reason: string | null;
  roh_total_bases: number | null;
  roh_covered_bases: number | null;
  roh_fraction: number | null;
}

/** The measure as the processing route writes it, stamped with the time it was taken. */
export function rohColumns(measure: RohMeasure, measuredAt: string): RohColumns {
  if (measure.status === "measured") {
    return {
      roh_status: "measured",
      roh_reason: null,
      roh_total_bases: measure.totalRunBases,
      roh_covered_bases: measure.coveredSpanBases,
      roh_fraction: measure.fRoh,
      roh_measured_at: measuredAt,
    };
  }
  return {
    roh_status: "not_measurable",
    roh_reason: measure.reason,
    roh_total_bases: null,
    roh_covered_bases: null,
    roh_fraction: null,
    roh_measured_at: measuredAt,
  };
}

/**
 * One file's stored measure. `unmeasured` is a file processed before the
 * measure existed (every column null): it is not below threshold, because
 * nothing was measured, and the panel says it could not check.
 */
export type StoredRohMeasure =
  | { status: "measured"; totalRunBases: number; coveredSpanBases: number; fRoh: number }
  | { status: "not_measurable"; reason: RohUnmeasurableReason }
  | { status: "unmeasured" };

function isUnmeasurableReason(value: string | null): value is RohUnmeasurableReason {
  return (ROH_UNMEASURABLE_REASONS as readonly string[]).includes(value ?? "");
}

/** Reads the six columns of one row back into a measure; anything malformed is `unmeasured`. */
export function storedRohMeasure(row: RohRow): StoredRohMeasure {
  if (
    row.roh_status === "measured" &&
    row.roh_total_bases !== null &&
    row.roh_covered_bases !== null &&
    row.roh_fraction !== null
  ) {
    return {
      status: "measured",
      totalRunBases: Number(row.roh_total_bases),
      coveredSpanBases: Number(row.roh_covered_bases),
      fRoh: Number(row.roh_fraction),
    };
  }
  if (row.roh_status === "not_measurable" && isUnmeasurableReason(row.roh_reason)) {
    return { status: "not_measurable", reason: row.roh_reason };
  }
  return { status: "unmeasured" };
}

/** True only when the file was measured and sits below both thresholds. */
export function belowRohThreshold(measure: RohMeasure | StoredRohMeasure): boolean {
  return (
    measure.status === "measured" && !exceedsRohThreshold(measure.totalRunBases, measure.fRoh)
  );
}

/**
 * The rule for one person (ADR 0017 §7): every annotated file of theirs
 * was measured and sits below both thresholds. One unmeasurable or
 * unmeasured file, or no file at all, and the answer is no: the panel then
 * renders the `runs-unchecked` reason. Each file is asked on its own; no
 * file is ever read against another person's.
 */
export function subjectRunsBelowThreshold(files: readonly StoredRohMeasure[]): boolean {
  return files.length > 0 && files.every(belowRohThreshold);
}

/** The stored measure of every annotated file of one subject, as the panel reads it. */
export async function readSubjectRuns(
  supabase: Db,
  subjectId: string,
): Promise<StoredRohMeasure[]> {
  const { data } = await supabase
    .from("genome_files")
    .select("roh_status, roh_reason, roh_total_bases, roh_covered_bases, roh_fraction")
    .eq("subject_id", subjectId)
    .eq("status", "annotated")
    .order("created_at", { ascending: false });
  return (data ?? []).map(storedRohMeasure);
}
