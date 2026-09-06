/**
 * The quality check, in words (design §2.3, §2.4; brief §4 §6.6, A.6, A.7,
 * X10.4). Every user-visible string of the QC block, the QC table and the
 * compare column footers lives here; the numbers they sit beside render
 * through the figure contract and are never retyped.
 *
 * The register's copy ids `embryo.qc.*` resolve to the constants below
 * (src/copy/embryos/ids.ts). The per-reason sentences are the A.6 messages
 * of brief lines 2207-2209, split around the one measured number so that the
 * number renders as a figure; their one home is `src/copy/upload/errors.ts`
 * (docs/canonical-artifacts.md), whose halves this file spreads.
 */
import type { QcDto } from "@/lib/embryos/policy";
import { EMBRYO_REASON_PARTS } from "@/copy/upload/errors";
import type { QcReasonId } from "@/lib/embryos/qc-policy";

export const QC_PASSED = "Quality check passed";

export const QC_MARGINAL = "Passed, with a thinner file";

/** Character-for-character (brief line 2229). */
export const QC_MARGINAL_QUALIFIER = "The data for this embryo is thinner than we would like.";

/** Character-for-character (brief line 392); also the compare header chip. */
export const QC_FAILED_CHIP = "Quality check not passed";

/** Character-for-character (brief line 1398). */
export const NOT_STATED_BY_SOURCE = "Not stated by the source laboratory";

/** Character-for-character (brief line 2229). */
export const NOT_MEASURABLE_FROM_FILE = "not measurable from this file";

/** Character-for-character (brief line 1402). */
export const DROPOUT_NOT_MEASURED = "Not measured — the ranges below are wider because of this.";

/** The one collapsible a result page may carry (brief line 414). */
export const FULL_QC_TABLE_SUMMARY = "See the full quality table";

/** Imputation is never performed for an embryo; the row says so rather than printing a dash. */
/** A closed empty value: no guessed letters, no failed reason. Never a dash. */
export const NONE_WORD = "None";
export const NO_IMPUTATION_WORD = NONE_WORD;

/** The twenty QC fields, in plain words, in register order. */
export const QC_FIELD_LABELS: Record<keyof QcDto, string> = {
  source_facts: "File source",
  sites_expected: "Positions this check needs",
  sites_called: "Positions the file could read",
  call_rate: "Share of positions read",
  autosomal_het_rate: "Positions where the two copies differ",
  mean_depth: "How many times each position was read",
  parent_a_concordance: "Agreement with one parent’s file",
  parent_b_concordance: "Agreement with the other parent’s file",
  allelic_dropout_estimate: "Letters the test may have missed",
  allelic_dropout_interval_low: "Missed letters, low end",
  allelic_dropout_interval_high: "Missed letters, high end",
  allelic_dropout_method: "How missed letters were counted",
  amplification_method: "How the DNA was copied before reading",
  source_laboratory: "Who made the file",
  source_assay: "Which test was used",
  imputation_performed: "Missing letters filled in by guessing",
  imputation_panel: "What the guessing was based on",
  contamination_estimate: "Signs of mixed DNA",
  qc_verdict: "Result of the quality check",
  qc_reasons: "Why the check did not pass",
  computed_at: "When the check ran",
};

/** The plain words for each closed reason id, for the QC table's reason row. */
export const QC_REASON_WORDS: Record<QcReasonId, string> = {
  embryo_call_rate: "Too few positions read",
  embryo_parent_discordant: "Does not match the parents’ files closely enough",
  contamination: "Signs of mixed DNA",
  dropout_too_high: "Too many missed letters",
  qc_review_required: "Needs a person to review it",
};

/**
 * The reason sentence for a failed or marginal column, around the one
 * measured number the sentence names (rendered as a figure between `before`
 * and `after`; `after` alone when the sentence names none). The embryo's
 * label leads each sentence, as the A.6 messages do.
 */
export interface ReasonSentence {
  before: string;
  after: string;
  /** Which measured metric renders between the two halves. */
  figure: "call_rate" | null;
}

export const QC_REASON_SENTENCES: Record<QcReasonId, ReasonSentence> = {
  // The three A.6 reasons read their halves from the refusals' one home
  // (src/copy/upload/errors.ts); only the call rate names a figure.
  embryo_call_rate: { ...EMBRYO_REASON_PARTS.embryo_call_rate, figure: "call_rate" },
  embryo_parent_discordant: { ...EMBRYO_REASON_PARTS.embryo_parent_discordant, figure: null },
  contamination: { ...EMBRYO_REASON_PARTS.contamination, figure: null },
  dropout_too_high: {
    before: "",
    after: "the test may have missed too many letters for a result to be trusted. We have not produced results.",
    figure: null,
  },
  qc_review_required: {
    before: "",
    after: "the quality check needs a person to look at it before any result can show.",
    figure: null,
  },
};

/** The date line under "Where this comes from". */
export function qcRunOn(date: string): string {
  return `Quality check run on ${date}.`;
}
