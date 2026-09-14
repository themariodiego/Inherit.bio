import type { ChromosomalSexValue } from "@/lib/family/chromosomal-sex";

/**
 * The one home of the chromosomal-sex declaration's words (D-031).
 *
 * Three things have to be true of this copy, and each sentence below is here
 * because one of them is:
 *
 *   1. It is optional, and leaving it blank costs you one thing only. The
 *      body names that one thing rather than implying the whole product works
 *      better with it.
 *   2. Inherit does not work it out. A reader who knows their file holds X and
 *      Y positions will assume Inherit already knows; the body says plainly
 *      that it does not look, so recording it is a choice and not a formality.
 *   3. Recording it can change what a family member sees. That is the whole
 *      point of recording it, and it is stated before the control rather than
 *      discovered afterwards.
 */

/**
 * "Sex chromosomes" rather than "chromosomal sex": the heading names the thing
 * the four values are about, in words already in the plain vocabulary. The
 * register gained exactly two words for this — `sex` and `chromosomes`, the
 * plural of a word it already held — and not `chromosomal`, which is jargon
 * and stays out of every short label.
 */
export const CHROMOSOMAL_SEX_HEADING = "Sex chromosomes";

export const CHROMOSOMAL_SEX_BODY =
  "Inherit uses this for one thing: working out the chances for a pregnancy when a change sits on the X chromosome. Nothing else reads it, and no report shows it.";

export const CHROMOSOMAL_SEX_NOT_DERIVED =
  "Inherit does not work this out from your file. You record it or it stays blank.";

export const CHROMOSOMAL_SEX_SHARING =
  "If you record this, a family member you share carrier results with can see the split for a change on the X. That split shows which parent carries the change. Remove it here and that stops.";

/** The five choices, in the order the control renders them. */
export const CHROMOSOMAL_SEX_CHOICES: readonly { value: ChromosomalSexValue; label: string }[] = [
  { value: "XX", label: "XX" },
  { value: "XY", label: "XY" },
  { value: "other", label: "Another pattern" },
  { value: "unknown", label: "I do not know" },
];

export const CHROMOSOMAL_SEX_NOT_RECORDED = "Not recorded";

export const CHROMOSOMAL_SEX_REMOVE = "Remove this";

export const CHROMOSOMAL_SEX_LEGEND = "Your sex chromosomes";

/** What "Another pattern" covers, said without listing a diagnosis. */
export const CHROMOSOMAL_SEX_OTHER_NOTE =
  "Choose another pattern if yours is not XX or XY. Inherit will say that it does not work the split out for that, rather than treating you as one of the two.";

export const CHROMOSOMAL_SEX_SAVE_FAILED =
  "That did not save. Nothing changed. Try again.";
