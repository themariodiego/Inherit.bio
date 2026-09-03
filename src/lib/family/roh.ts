import { genotypeKey } from "@/lib/genome/reports";
import type { Db } from "@/lib/genome/load";

/**
 * Runs of homozygosity, measured inside ONE file (design §5; brief §4 §5.3).
 *
 * **This is not a relatedness quantity.** It is a fact about a single file:
 * how much of what that file reports is made of long stretches where both
 * copies read the same letter. Two files are never read together here, the
 * two answers are never subtracted, divided, averaged or combined, and
 * nothing in this module or its callers produces shared DNA, a centimorgan
 * length, an IBD segment, a kinship coefficient or a relationship label.
 * `evaluateCarrierPairs` takes two measures and asks each one, on its own,
 * whether it is below the threshold; it never compares them (X15, brief
 * line 348, acceptance 20).
 *
 * The only numbers here are the two the brief states at line 1349 — a total
 * of 100 Mb of runs, and an F_ROH of 0.0156 — and the positions the file
 * itself reports. No genome length is assumed: the denominator is the
 * autosomal span the file covers (first to last reported position on each
 * autosome), so the quantity is about the file that was read rather than
 * about a reference genome nobody uploaded.
 *
 * What cannot be measured is said, never guessed. A file that lists only
 * the places where a reader differs from the reference reports no stretch
 * of same-reading positions at all: between its rows the genome is
 * unrecorded, not identical. Such a file answers `not_measurable`, and the
 * surface above refuses the arithmetic with that reason rather than
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
 * A read budget, not a biological threshold. A file with more autosomal
 * calls than this is never measured from a truncated read: it answers
 * `not_measurable`, which the surface renders as "Inherit could not check…".
 * No number is ever produced from a partial file.
 */
export const MAX_CALLS_READ = 20_000;

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
      /** totalRunBases / coveredSpanBases; 0 when the file covers no span. */
      fRoh: number;
      /** True when either threshold the brief states is exceeded. */
      aboveThreshold: boolean;
    }
  | { status: "not_measurable"; reason: "no-runs-reported" | "too-many-calls-to-read" };

/** Autosomes only: 1–22 (23 = X, 24 = Y, 25 = MT are never counted). */
function isAutosome(chrom: number): boolean {
  return Number.isInteger(chrom) && chrom >= 1 && chrom <= 22;
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
 * here so the answer does not depend on the order rows came back in.
 */
export function measureRunsOfHomozygosity(calls: readonly RohCall[]): RohMeasure {
  const byChrom = new Map<number, RohCall[]>();
  for (const call of calls) {
    if (!isAutosome(call.chrom) || !Number.isFinite(call.pos)) continue;
    const bucket = byChrom.get(call.chrom);
    if (bucket) bucket.push(call);
    else byChrom.set(call.chrom, [call]);
  }

  let runCount = 0;
  let totalRunBases = 0;
  let coveredSpanBases = 0;

  for (const bucket of byChrom.values()) {
    const sorted = [...bucket].sort((left, right) => left.pos - right.pos);
    coveredSpanBases += sorted[sorted.length - 1].pos - sorted[0].pos;

    let runStart: number | null = null;
    let runEnd = 0;
    let runLength = 0;
    const closeRun = () => {
      if (runStart !== null && runLength >= 2) {
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

  const fRoh = coveredSpanBases > 0 ? totalRunBases / coveredSpanBases : 0;
  return {
    status: "measured",
    runCount,
    totalRunBases,
    coveredSpanBases,
    fRoh,
    aboveThreshold: totalRunBases > ROH_TOTAL_THRESHOLD_BASES || fRoh > F_ROH_THRESHOLD,
  };
}

/** True only when the file was measured and sits below both thresholds. */
export function belowRohThreshold(measure: RohMeasure): boolean {
  return measure.status === "measured" && !measure.aboveThreshold;
}

/**
 * Reads one subject's autosomal calls and measures them. The count is asked
 * for first, so a file too large for the read budget refuses without
 * transferring anything; the surface then states that it could not check.
 */
export async function measureSubjectRuns(
  supabase: Db,
  subjectId: string,
  fileIds: readonly string[],
): Promise<RohMeasure> {
  if (fileIds.length === 0) return { status: "not_measurable", reason: "no-runs-reported" };
  const { count } = await supabase
    .from("user_variants")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", subjectId)
    .in("file_id", [...fileIds])
    .lte("chrom", 22)
    .gte("chrom", 1);
  if (count === null || count > MAX_CALLS_READ) {
    return { status: "not_measurable", reason: "too-many-calls-to-read" };
  }

  const PAGE = 1_000;
  const calls: RohCall[] = [];
  for (let from = 0; from < count; from += PAGE) {
    const { data } = await supabase
      .from("user_variants")
      .select("chrom, pos, genotype")
      .eq("subject_id", subjectId)
      .in("file_id", [...fileIds])
      .lte("chrom", 22)
      .gte("chrom", 1)
      .order("chrom")
      .order("pos")
      .range(from, from + PAGE - 1);
    for (const row of data ?? []) {
      calls.push({ chrom: row.chrom, pos: row.pos, genotype: row.genotype });
    }
  }
  return measureRunsOfHomozygosity(calls);
}
