/**
 * Embryo quality policy — the one home of the X10.4 thresholds, the QC bands
 * of brief A.7, the null rules and the interval-widening factor
 * (docs/canonical-artifacts.md: "no consumer may restate the numbers"). The
 * worker, the RSC projections, the exports and the science page all resolve
 * through these functions; none carries a threshold of its own.
 *
 * Pure: no database, no React. `contextStrip` implements the register's
 * `qcProjection.contextStrip` definitions exactly, so the compare strip and
 * the Overview's State E count the same embryos as "not measurable".
 */

/** The published numbers (X10.4). Never relaxed; a stricter set needs the §11.12 review. */
export const QC_THRESHOLDS = {
  /** Below this call rate the embryo produces no figure (marginal band begins here). */
  callRateNoFigure: 0.95,
  /** Below this call rate the embryo produces no results at all. */
  callRateFail: 0.85,
  /** Below this parent concordance the embryo is marginal. */
  concordanceMarginal: 0.95,
  /** Below this parent concordance the embryo fails. */
  concordanceFail: 0.9,
  /** Below this score coverage the score produces no figure. */
  scoreCoverageFloor: 0.8,
  /** Above this allelic dropout no polygenic result is reportable. */
  dropoutCeiling: 0.1,
  /** Every interval widens by this factor when dropout was not measured. */
  dropoutUnmeasuredWidening: 1.5,
  /** Above this contamination estimate the embryo produces no results. */
  contaminationCeiling: 0.05,
} as const;

export const QC_BANDS = ["pass", "marginal", "fail"] as const;
export type QcBand = (typeof QC_BANDS)[number];

/** The register's `qcProjection.qcReasonIds`, in its order. */
export const QC_REASON_IDS = [
  "embryo_call_rate",
  "embryo_parent_discordant",
  "contamination",
  "dropout_too_high",
  "qc_review_required",
] as const;
export type QcReasonId = (typeof QC_REASON_IDS)[number];

/** The register's `resultNotReportableReasonIds`: the QC reasons plus the four result-level states. */
export const RESULT_NOT_REPORTABLE_REASON_IDS = [
  ...QC_REASON_IDS,
  "insufficient_coverage",
  "source_call_disputed",
  "within_family_validation_unavailable",
  "sex_combined_model_unavailable",
] as const;
export type ResultNotReportableReasonId = (typeof RESULT_NOT_REPORTABLE_REASON_IDS)[number];

/** The register's copy ids for the QC projection, resolved to strings in src/copy/embryos. */
export const QC_COPY_IDS = {
  headerChip: "embryo.qc.quality-check-not-passed",
  nullMetric: "embryo.qc.not-measurable-from-file",
  sourceNotStated: "embryo.qc.source-not-stated",
  dropoutNotMeasured: "embryo.qc.dropout-not-measured",
  reviewRequired: "embryo.qc.review-required",
} as const;

/** The measured metrics the gates read. Null means the source did not report it. */
export interface QcMetrics {
  call_rate: number;
  parent_a_concordance: number | null;
  parent_b_concordance: number | null;
  allelic_dropout_estimate: number | null;
  contamination_estimate: number | null;
}

function presentConcordances(qc: QcMetrics): number[] {
  return [qc.parent_a_concordance, qc.parent_b_concordance].filter(
    (value): value is number => value !== null,
  );
}

/** A.7's bands, and X10.4's contamination ceiling as a fail. */
export function qcBand(qc: QcMetrics): QcBand {
  const concordances = presentConcordances(qc);
  if (qc.call_rate < QC_THRESHOLDS.callRateFail) return "fail";
  if (concordances.some((value) => value < QC_THRESHOLDS.concordanceFail)) return "fail";
  if (qc.contamination_estimate !== null && qc.contamination_estimate > QC_THRESHOLDS.contaminationCeiling) {
    return "fail";
  }
  if (qc.call_rate < QC_THRESHOLDS.callRateNoFigure) return "marginal";
  if (concordances.some((value) => value < QC_THRESHOLDS.concordanceMarginal)) return "marginal";
  return "pass";
}

/** The closed reasons the metrics trigger, in register order. Empty for a clean pass. */
export function qcReasons(qc: QcMetrics): QcReasonId[] {
  const reasons: QcReasonId[] = [];
  if (qc.call_rate < QC_THRESHOLDS.callRateNoFigure) reasons.push("embryo_call_rate");
  if (presentConcordances(qc).some((value) => value < QC_THRESHOLDS.concordanceMarginal)) {
    reasons.push("embryo_parent_discordant");
  }
  if (qc.contamination_estimate !== null && qc.contamination_estimate > QC_THRESHOLDS.contaminationCeiling) {
    reasons.push("contamination");
  }
  if (qc.allelic_dropout_estimate !== null && qc.allelic_dropout_estimate > QC_THRESHOLDS.dropoutCeiling) {
    reasons.push("dropout_too_high");
  }
  return reasons;
}

/** Call rate at or above the no-figure floor. */
export function callRateProducesFigure(callRate: number): boolean {
  return callRate >= QC_THRESHOLDS.callRateNoFigure;
}

/** Whether this embryo produces any figure across the comparison (the strip's `not_measurable` complement). */
export function producesFigure(qc: QcMetrics): boolean {
  return qcBand(qc) !== "fail" && callRateProducesFigure(qc.call_rate);
}

/** Score coverage at or above the floor produces a figure for that score. */
export function scoreCoverageProducesFigure(coverage: number): boolean {
  return coverage >= QC_THRESHOLDS.scoreCoverageFloor;
}

/** Null dropout does not gate; above the ceiling no polygenic result is reportable. */
export function dropoutPermitsPolygenic(dropout: number | null): boolean {
  return dropout === null || dropout <= QC_THRESHOLDS.dropoutCeiling;
}

export interface Interval {
  low: number;
  point: number;
  high: number;
}

export interface WidenedInterval extends Interval {
  widened: boolean;
  /** Set exactly when the interval was widened for unmeasured dropout. */
  copyId: typeof QC_COPY_IDS.dropoutNotMeasured | null;
}

/**
 * When dropout was not measured every interval for the embryo widens by
 * exactly 1.5 about its point and the row says so (brief §4 §6.6). A measured
 * dropout leaves the interval untouched: Inherit never invents an estimate.
 */
export function widenForDropout(interval: Interval, dropout: number | null): WidenedInterval {
  if (dropout !== null) return { ...interval, widened: false, copyId: null };
  const factor = QC_THRESHOLDS.dropoutUnmeasuredWidening;
  return {
    point: interval.point,
    low: interval.point - (interval.point - interval.low) * factor,
    high: interval.point + (interval.high - interval.point) * factor,
    widened: true,
    copyId: QC_COPY_IDS.dropoutNotMeasured,
  };
}

export const CONFIDENCE_LEVELS = ["standard", "low_confidence", "not_reportable"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * The polygenic confidence for one embryo: a fail band or a dropout above the
 * ceiling is not reportable; a marginal band, or a null dropout or
 * contamination, caps it at low confidence without gating (A.7's null rule).
 */
export function polygenicConfidence(qc: QcMetrics): Confidence {
  if (qcBand(qc) === "fail") return "not_reportable";
  if (!dropoutPermitsPolygenic(qc.allelic_dropout_estimate)) return "not_reportable";
  if (qcBand(qc) === "marginal") return "low_confidence";
  if (qc.allelic_dropout_estimate === null || qc.contamination_estimate === null) return "low_confidence";
  return "standard";
}

/** Fail closed: anything that is not a registered reason maps to the generic review reason. */
export function mapQcReason(value: string): QcReasonId {
  return (QC_REASON_IDS as readonly string[]).includes(value) ? (value as QcReasonId) : "qc_review_required";
}

export interface ContextCounts {
  embryos_analysed: number;
  quality_check_passed: number;
  not_measurable: number;
}

/** One QC row as the strip reads it; `qc_verdict` is the stored band. */
export interface ContextStripRow extends QcMetrics {
  qc_verdict: string;
}

/**
 * The register's three counts and no other:
 *   - `embryos_analysed`: every terminal pass, marginal or fail row;
 *   - `quality_check_passed`: the pass band only;
 *   - `not_measurable`: every embryo for which the rules produce no figure,
 *     the call-rate marginal no-figure band and every fail row included.
 */
export function contextStrip(rows: readonly ContextStripRow[]): ContextCounts {
  const terminal = rows.filter((row) => (QC_BANDS as readonly string[]).includes(row.qc_verdict));
  return {
    embryos_analysed: terminal.length,
    quality_check_passed: terminal.filter((row) => row.qc_verdict === "pass").length,
    not_measurable: terminal.filter((row) => row.qc_verdict === "fail" || !producesFigure(row)).length,
  };
}
