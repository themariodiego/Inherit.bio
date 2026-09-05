import { genotypeKey } from "@/lib/genome/reports";
import type { Db } from "@/lib/genome/load";
import type { ParseResult } from "@/lib/genome/types";

/**
 * Runs of homozygosity, measured inside ONE file (design §5; brief §4 §5.3;
 * ADR 0017 §7, D-030, D-040).
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
 * A run is what McQuillan et al. 2008 call one (American Journal of Human
 * Genetics 83(3):359–372, doi:10.1016/j.ajhg.2008.08.007): a stretch of
 * consecutive reported autosomal calls in which all but at most one call
 * read the same on both copies, counted only when it holds at least 25
 * calls and spans at least 1.5 Mb (span = last call position − first call
 * position of the run). A gap between reported positions does not break a
 * run: the paper tolerates missing calls. The thresholds the surface
 * applies are the brief's own (line 1349): 100 Mb of runs, F_ROH 0.0156.
 * F_ROH is the sum of run lengths over the autosomal span the file covers
 * (first to last reported position on each autosome). The denominator is
 * Inherit's choice, not the paper's, which divides by the autosomal length
 * its panel covers: applied to a sparse file it can only make F_ROH larger,
 * so it can only refuse more, never less. No genome length is assumed.
 *
 * The measure is taken once, at ingest, from the parsed calls the
 * processing route already holds, and stored on `genome_files` (migration
 * `20260903200000_genome_files_runs_of_homozygosity.sql`). Readers never
 * re-derive it from `user_variants` (D-030). What cannot be measured is
 * said, never guessed: a file that reports no call homozygous for the
 * reference lists only its differences, and the positions between its rows
 * are unrecorded, not identical, so it is stored as `not_measurable` and
 * the surface above refuses the arithmetic with that reason rather than
 * assuming the file is safe to compute from.
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
 * The least a run may span, in bases: 1.5 Mb (McQuillan et al. 2008,
 * doi:10.1016/j.ajhg.2008.08.007).
 */
export const ROH_MIN_RUN_BASES = 1_500_000;

/**
 * The fewest calls a run may hold: 25 contiguous homozygous SNPs (McQuillan
 * et al. 2008, doi:10.1016/j.ajhg.2008.08.007).
 */
export const ROH_MIN_RUN_CALLS = 25;

/**
 * How many calls inside a run may read differently on the two copies: one
 * heterozygous call per window (McQuillan et al. 2008,
 * doi:10.1016/j.ajhg.2008.08.007).
 */
export const ROH_MAX_HETEROZYGOUS_IN_RUN = 1;

/**
 * Why a file cannot be measured. `no-autosomal-calls`: the file reports no
 * autosomal call at all. `no-reference-calls`: the file reports no call
 * homozygous for the reference, the shape of a differences-only VCF, whose
 * unrecorded positions cannot be read as identical. `no-runs-reported`:
 * the file covers no autosomal stretch at all (one reported position per
 * autosome), so it could report no run and has no denominator. These are
 * the values `genome_files.roh_reason` admits.
 */
export const ROH_UNMEASURABLE_REASONS = [
  "no-runs-reported",
  "no-autosomal-calls",
  "no-reference-calls",
] as const;
export type RohUnmeasurableReason = (typeof ROH_UNMEASURABLE_REASONS)[number];

/**
 * One call as this measure reads it: an autosome, a position, the letters
 * and, where the parser carries it, the reference allele at that position.
 */
export interface RohCall {
  chrom: number;
  pos: number;
  genotype: string;
  /**
   * The reference allele, or null / absent where the file carries none. A
   * VCF record and a VCF reference call carry it; an array record carries
   * null, because the vendors' files list no reference allele.
   */
  ref?: string | null;
}

export type RohMeasure =
  | {
      status: "measured";
      /** Number of runs by the cited definition; zero is a measured answer. */
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
 * two readable letters (a no-call, or a single letter) is neither: it counts
 * against a run's tolerance like a heterozygous call, because an unreadable
 * position is not evidence of anything. (No-calls never reach this measure
 * as records — both parsers skip them — so in practice the calls that do
 * not read the same are heterozygous ones.)
 */
export function readsTheSameOnBothCopies(genotype: string): boolean {
  const key = genotypeKey(genotype);
  return key !== null && key.length === 2 && key[0] === key[1];
}

/**
 * Whether one call is homozygous for the reference: the file's own evidence
 * that it recorded a position which does not differ. What the parsers
 * expose decides how that is read:
 *   - a VCF record and a VCF reference call carry `ref`, so a same-reading
 *     call is reference-homozygous only when both letters are the
 *     reference (the parser keeps such `0/0` rows in `referenceCalls`;
 *     a `1/1` row is same-reading but is a difference);
 *   - an array record carries no reference allele (`ref` is null on every
 *     one, the vendors' files list none), and an array file lists every
 *     probed position whether or not it differs, so a same-reading array
 *     call is read as a reported non-difference position.
 */
export function isReferenceHomozygous(call: RohCall): boolean {
  const key = genotypeKey(call.genotype);
  if (key === null || key.length !== 2 || key[0] !== key[1]) return false;
  if (call.ref === null || call.ref === undefined) return true;
  const ref = call.ref.trim().toUpperCase();
  return ref.length === 1 && ref === key[0];
}

/**
 * The calls the measure reads from one parse: the variant records and the
 * reference calls the parser kept, each with the reference allele it
 * carries. The route calls this before any liftover, so both share the
 * file's own build.
 */
export function rohCallsFromParse(parsed: ParseResult): RohCall[] {
  const calls: RohCall[] = [];
  for (const record of parsed.records) {
    calls.push({ chrom: record.chrom, pos: record.pos, genotype: record.genotype, ref: record.ref });
  }
  for (const call of parsed.referenceCalls) {
    calls.push({ chrom: call.chrom, pos: call.pos, genotype: call.genotype, ref: call.ref });
  }
  return calls;
}

/**
 * The runs of one autosome, as spans. Every maximal stretch of consecutive
 * calls holding at most one call that does not read the same is a
 * candidate; a candidate is a run when, trimmed to start and end on a
 * same-reading call, it holds at least `ROH_MIN_RUN_CALLS` calls and spans
 * at least `ROH_MIN_RUN_BASES`. Candidates that qualify and overlap (they
 * can share the calls on either side of one tolerated call) are merged, so
 * no base is counted twice.
 */
function runsOfOneAutosome(sorted: readonly RohCall[]): { start: number; end: number }[] {
  const same = sorted.map((call) => readsTheSameOnBothCopies(call.genotype));
  const qualified: { start: number; end: number }[] = [];
  const consider = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start <= end && !same[start]) start++;
    while (end >= start && !same[end]) end--;
    if (end < start) return;
    const calls = end - start + 1;
    const span = sorted[end].pos - sorted[start].pos;
    if (calls >= ROH_MIN_RUN_CALLS && span >= ROH_MIN_RUN_BASES) {
      qualified.push({ start: sorted[start].pos, end: sorted[end].pos });
    }
  };

  // Every maximal window with at most ROH_MAX_HETEROZYGOUS_IN_RUN calls that
  // do not read the same: when one more arrives, the window so far is a
  // candidate, and the next window begins after the earliest tolerated one.
  let windowStart = 0;
  const tolerated: number[] = [];
  for (let index = 0; index < sorted.length; index++) {
    if (same[index]) continue;
    tolerated.push(index);
    if (tolerated.length > ROH_MAX_HETEROZYGOUS_IN_RUN) {
      consider(windowStart, index - 1);
      windowStart = tolerated[0] + 1;
      tolerated.shift();
    }
  }
  consider(windowStart, sorted.length - 1);

  // Candidates arrive in order of their start; merge any that overlap.
  const merged: { start: number; end: number }[] = [];
  for (const run of qualified) {
    const last = merged[merged.length - 1];
    if (last && run.start <= last.end) last.end = Math.max(last.end, run.end);
    else merged.push({ ...run });
  }
  return merged;
}

/**
 * The measure. Calls arrive in any order; autosomes are grouped and sorted
 * here so the answer does not depend on the order rows came back in. A
 * measurable file with no run is measured at zero: that is an answer, and
 * it is below both thresholds.
 */
export function measureRunsOfHomozygosity(calls: readonly RohCall[]): RohMeasure {
  const byChrom = new Map<number, RohCall[]>();
  let referenceCalls = 0;
  for (const call of calls) {
    if (!isAutosome(call.chrom) || !Number.isFinite(call.pos)) continue;
    if (isReferenceHomozygous(call)) referenceCalls++;
    const bucket = byChrom.get(call.chrom);
    if (bucket) bucket.push(call);
    else byChrom.set(call.chrom, [call]);
  }
  if (byChrom.size === 0) return { status: "not_measurable", reason: "no-autosomal-calls" };
  // A file that reports no position as identical to the reference lists
  // only its differences: between its rows the genome is unrecorded, not
  // identical, so no run in it could be read as one.
  if (referenceCalls === 0) return { status: "not_measurable", reason: "no-reference-calls" };

  let runCount = 0;
  let totalRunBases = 0;
  let coveredSpanBases = 0;
  for (const bucket of byChrom.values()) {
    const sorted = [...bucket].sort((left, right) => left.pos - right.pos);
    coveredSpanBases += sorted[sorted.length - 1].pos - sorted[0].pos;
    for (const run of runsOfOneAutosome(sorted)) {
      runCount++;
      totalRunBases += run.end - run.start;
    }
  }
  // No autosomal stretch at all: nothing a run could lie in, and no
  // denominator (the stored shape requires a positive covered span).
  if (coveredSpanBases === 0) return { status: "not_measurable", reason: "no-runs-reported" };

  // A run lies inside its autosome's span, so the fraction is in [0, 1]:
  // the shape `genome_files_roh_shape` requires.
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

export type SubjectRunsState = "below" | "above" | "unchecked";

/**
 * The same rule with its two failing answers told apart: `above` when a
 * measured file of this person sits above a threshold (the brief's line-1349
 * refusal is then true of a file Inherit measured), `unchecked` when no
 * measured file is above but some file was not measured, could not be, or
 * there is no file at all (nothing was established), `below` otherwise.
 */
export function subjectRunsState(files: readonly StoredRohMeasure[]): SubjectRunsState {
  if (files.some((file) => file.status === "measured" && !belowRohThreshold(file))) return "above";
  return subjectRunsBelowThreshold(files) ? "below" : "unchecked";
}

/** The stored measure of every annotated file of one subject, as the panel reads it. */
export async function readSubjectRuns(
  supabase: Db,
  subjectId: string,
  inputFileIds?: Set<string>,
): Promise<StoredRohMeasure[]> {
  const { data } = await supabase
    .from("genome_files")
    .select("id, roh_status, roh_reason, roh_total_bases, roh_covered_bases, roh_fraction")
    .eq("subject_id", subjectId)
    .eq("status", "annotated")
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => { inputFileIds?.add(row.id); return storedRohMeasure(row); });
}
