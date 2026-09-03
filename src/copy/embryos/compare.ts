/**
 * `/embryos/compare` — the comparison (design §2.4; brief §2 §6.2, §4 §6,
 * §3 §8.5, A.10, X4, X10.3, X13). Every user-visible string of that page
 * lives here, with the cell words and the comparator strings the finding
 * renderer will use once a condition is registered.
 *
 * Export names carry the readability role: `*_HEADING`, `*_LABEL`, `*_TH`
 * (a table header) and `*_STATUS` are short roles checked word by word
 * against data/plain-vocabulary.json; everything else is body copy graded
 * at ≤ 9 when it reaches fifteen words.
 */
import { STATE_E } from "@/copy/overview";
import { REPORT_HEADINGS } from "@/copy/reports/headings";
import { NO_RANGE_YET, NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { PERCENTAGE_POINTS_GLOSS } from "@/lib/figures/natural-frequency";

/** Character-for-character (brief line 536). */
export const COMPARE_H1 = "Compare embryos";

export const SIDE_BY_SIDE_HEADING = "Side by side";
export const QUALITY_CHECK_HEADING = "Quality check";
/** Two of the six fixed report headings, from their one home. */
export const HOW_SURE_HEADING = REPORT_HEADINGS[3];
export const WHERE_FROM_HEADING = REPORT_HEADINGS[5];

/**
 * The governing sentence (brief line 1376), character-for-character; copy
 * id embryo.standing-statement. Rendered once above the table on every load
 * and never inside a collapsible.
 */
export const STANDING_STATEMENT =
  "No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.";

// ---------------------------------------------------------------------------
// The context strip: three counts only, each with a note of 1–12 words.
// ---------------------------------------------------------------------------

export function contextAnalysed(n: number): string {
  return n === 1 ? "1 embryo analysed" : `${n} embryos analysed`;
}

export function contextPassed(p: number): string {
  return STATE_E.passed(p);
}

export function contextNotMeasurable(q: number): string {
  return `${q} not measurable`;
}

export const CONTEXT_ANALYSED_NOTE = "Every embryo with a finished quality check.";
export const CONTEXT_PASSED_NOTE = STATE_E.passedNote;
export const CONTEXT_NOT_MEASURABLE_NOTE = STATE_E.notMeasuredNote;

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

/** The sticky first column's header: a row is one measured thing. */
export const ROW_LABEL_TH = "What is measured";

/** The footer row's header. */
export const POSITIONS_READ_TH = "Positions read";

/** The honest sentence in place of the rows while the registry is empty (design §2.4). */
export const NO_ROWS_SENTENCE =
  "Inherit has no calibrated model registered for embryos yet, so no condition row can be shown. What you see is the quality check for each file.";

/** The blocking state with zero cohorts (register `embryos.compare.queryContract.absent`). */
export const NO_COHORT_SENTENCE = "No embryo files added yet.";

/** The closed cell words (design §2.4 cell contract). */
export const CELL_WORDS = {
  /** Every qcReasonId (brief line 392). */
  notMeasurable: "Not measurable",
  /** `coverageFailureFinding` (glyph + word `missing`). */
  notRead: "Not read",
  /** `coverage_state: partial` (§3 §3.2 glyph + word). */
  partlyRead: "Partly read",
  /** `sex_combined_model_unavailable`. */
  noPopulationFigure: "No population figure",
  /** `within_family_validation_unavailable`. */
  notTestedBetweenSiblings: "Not tested between siblings",
  /** `source_call_disputed`, `qc_review_required`. */
  underReview: "Under review",
  /** Character-for-character (brief line 390), with the ≈ glyph beside it. */
  tooCloseToTellApart: "Too close to tell apart",
} as const;

export const TIE_GLYPH = "≈";

/** The carrier-status words (design §2.4 item 2). */
export const CARRIER_WORDS = {
  carrier: "one copy found",
  not_detected: "no copy found at the positions covered",
  two_variants: "two copies found",
} as const;

/** Character-for-character (brief line 389); copy id embryo.within-family.not-tested. */
export const WITHIN_FAMILY_NOT_TESTED =
  "No one has measured whether this estimate holds up between brothers and sisters. It is a population estimate used where it has not been tested.";

/** Character-for-character (brief line 2242). */
export const NOT_DISTINGUISHABLE =
  "These embryos are not distinguishable for this trait using this data.";

/** Character-for-character (brief line 1318); rendered only when a not_measured score renders. */
export const NOT_MEASURED_COMPARISON =
  "This comparison is between people who share most of their DNA. This score has never been tested that way, so the difference below may be smaller than it looks — possibly much smaller.";

/** The lead comparator's sentence ending (brief line 1386). */
export const COMPARED_WITH_RANDOM = "compared with picking one of these embryos at random.";

/** The three other comparators sit under this label (brief line 1386). */
export const OTHER_WAYS_LABEL = "Other ways of comparing";

/** Character-for-character (brief line 1386). */
export const OTHER_WAYS_INTRO =
  "These four numbers describe the same embryo. They differ because they compare it with different things.";

/** Character-for-character (brief line 1388). */
export function nnsSentence(n: number): string {
  return `About ${n} couples would need to choose this way for one case to be avoided.`;
}

/** Character-for-character (brief line 1388), from its home beside the difference figure. */
export { PERCENTAGE_POINTS_GLOSS };

/** Copy id embryo.result.insufficient-coverage (brief line 1306 reworded per line 400). */
export function insufficientCoverage(matched: number, total: number): string {
  return `Too little of this score is in the file the laboratory sent to give a number. ${matched} of ${total} positions were found.`;
}

/** The comparator group inside every finding block (brief line 400). */
export const GENERAL_POPULATION_GROUP = "people in the general population";

// ---------------------------------------------------------------------------
// The states of §1.4.
// ---------------------------------------------------------------------------

/** The closed-shape failure (design §4): the page names itself, and no value shows. */
export const SHAPE_BLOCKED_SENTENCE =
  "Inherit blocked this page because its data did not match the safety shape it must have. Nothing was shown. Try again later.";

export const SHAPE_BLOCKED_HEADING = "This page did not open";

/** Under "Where this comes from" while no condition is registered. */
export const REGISTRY_EMPTY_SENTENCE =
  "The list of conditions Inherit may report for embryos is empty on this site. No model and no source is cited until one is registered and reviewed.";

/** The §4 §1 sentence, once per layer table, from its home. */
export { NO_RANGE_YET, NOT_DIAGNOSTIC };

/** The subject group of a finding's natural-frequency pair: this embryo, by its label. */
export function embryoGroup(label: string): string {
  return `for ${label}`;
}

/** The first sentence of the insufficient-coverage entry; the measured share follows it as a figure. */
export const INSUFFICIENT_COVERAGE_INTRO =
  "Too little of this score is in the file the laboratory sent to give a number.";

/** The words after the measured share. */
export const INSUFFICIENT_COVERAGE_SUFFIX = "of this score’s positions were found.";
