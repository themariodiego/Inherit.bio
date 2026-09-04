/**
 * The trade-off panel (design §2.4; brief §4 §6.8, §2 §6.2, §3 §8.5, G4.5,
 * X10.3). Every line ships character-for-character where the brief quotes
 * it; the panel renders no count, no composite and no "best".
 */

/** Character-for-character (brief line 1027), always the first line. */
export const TRADEOFF_LINE_ONE =
  "The embryo with the lowest estimate for one condition often does not have the lowest estimate for another.";

/** Character-for-character (G4.5, brief line 2632). */
export const NO_RANKING_STATEMENT = "Inherit does not rank embryos and does not recommend one.";

/** Character-for-character (brief line 1412). */
export const CANNOT_HAVE_BEST_OF_EACH =
  "If you care about more than one condition, you cannot have the best of each. Choosing for one moves the others.";

/** Character-for-character (brief line 391); copy id embryo.tradeoffs.exists. */
export const TRADEOFFS_EXISTS = "No embryo is first on every row.";

/** Copy id embryo.tradeoffs.none-measurable. */
export const TRADEOFFS_NONE_MEASURABLE =
  "There is no trade-off to show: too little could be measured to set one row against another.";

/** Character-for-character (brief line 1411), one line per real conflict. */
export function conflictLine(embryoLabel: string, lowest: string, highest: string): string {
  return `${embryoLabel} has the lowest ${lowest} risk and the highest ${highest} risk.`;
}

/** The availability statement (brief §9 item 19). */
export function availabilityStatement(n: number): string {
  const embryos = n === 1 ? "1 embryo" : `${n} embryos`;
  const files = n === 1 ? "1 file" : `${n} files`;
  return `This page shows ${embryos} because the laboratory sent ${files}. Inherit shows nothing about any embryo it has no file for.`;
}
