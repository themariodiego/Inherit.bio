/**
 * `/embryos/[embryoId]` — one embryo's page (design §2.3; brief §2 §6.3,
 * §5 §1.6, X13.1). Every user-visible string of that page lives here; the
 * six headings are the report skeleton's, in its embryo variant.
 *
 * The embryo copy variant of brief line 400 ships character-for-character:
 * the no-action string, the file-limit sentence and the population sentence.
 */
import { NAV_LABELS } from "@/copy/navigation";
import { WHAT_THIS_DOESNT_MEAN_NOT_COVERED } from "@/copy/reports/strings";

/** The document title's suffix. */
export const DETAIL_SECTION_LABEL = NAV_LABELS.embryos;

/** The one sentence under "Your result" while the registry is empty (design §2.3). */
export const NO_RESULTS_SENTENCE =
  "Inherit has no calibrated model registered for embryos yet, so it shows no result for any condition. The quality check below is real; the results are not built.";

/** The adult generic bullet re-pointed away from "you" (brief line 400). */
export const NOT_ABOUT_ANY_CHILD = "It does not say what will happen to any child.";

/** Character-for-character (brief line 400): the no-action string. */
export const NOTHING_SETS_APART = "There is nothing here that sets this embryo apart from the others.";

/** Character-for-character (brief line 400). */
export const LIMIT_OF_FILE_EMBRYO =
  "This is a limit of the file the laboratory sent, not a result about this embryo.";

/** The provenance line reworded for a laboratory file (design open decision 5). */
export const PROVENANCE_LINE_EMBRYO =
  "Inherit did not produce this data. It came from a laboratory that Inherit has not audited.";

/**
 * The population sentence (brief line 400), rendered on the block's own
 * denominator: `count` and `denominator` are the figure's rendered numerals.
 */
export function populationBaseline(count: string, denominator: string, source: string): string {
  return `About ${count} in ${denominator} people in the general population. Source: ${source}.`;
}

/** Character-for-character (brief line 400). */
export const NO_POPULATION_FIGURE = "Inherit has no population figure to compare this against.";

/** The states of §1.4. */
export const FILE_NOT_ADDED_SENTENCE = "The laboratory’s file for this embryo has not been added yet.";

/** From its home, when any finding is not covered. */
export { WHAT_THIS_DOESNT_MEAN_NOT_COVERED };
