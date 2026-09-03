/**
 * Reference-group wording and the three retained terms of art (brief §X4.2).
 * Strings here are user copy: plain English, grade ≤ 9, each definition
 * ≤ 20 words. The vocabulary constants themselves live in
 * src/lib/figures/contract.ts; this module only adds words around them.
 */
import { REFERENCE_GROUP_SHORT, type RetainedTerm } from "@/lib/figures/contract";

export { REFERENCE_GROUP_SHORT };

export const TERM_DEFINITIONS: Record<RetainedTerm, string> = {
  baseline: "The usual chance for people like you, before your DNA is taken into account.",
  percentile: "Where your score sits compared with 100 people like you.",
  haplogroup: "A branch of the family tree of all humans, traced through one parent line.",
};

export function definitionFor(term: RetainedTerm): string {
  return TERM_DEFINITIONS[term];
}

export interface MatchedFacts {
  sex?: "female" | "male";
  /** Already worded, e.g. "40 to 49". */
  ageBand?: string;
  /** Already worded, e.g. "ancestry like yours". */
  ancestryLabel?: string;
}

/**
 * The once-per-surface expansion of "people like you", naming what was
 * matched on: "people like you — women aged 40 to 49 with ancestry like yours".
 */
export function expandedReferenceGroup(matched: MatchedFacts): string {
  const { sex, ageBand, ancestryLabel } = matched;
  if (!sex && !ageBand && !ancestryLabel) {
    return `${REFERENCE_GROUP_SHORT} — not matched on sex, age or ancestry`;
  }
  const head = sex === "female" ? "women" : sex === "male" ? "men" : "people";
  const parts = [head];
  if (ageBand) parts.push(`aged ${ageBand}`);
  if (ancestryLabel) parts.push(`with ${ancestryLabel}`);
  return `${REFERENCE_GROUP_SHORT} — ${parts.join(" ")}`;
}

export const BASELINE_ABSENT =
  "Baseline not shown: Inherit does not know your sex and age band. Add them in Settings, or read the range on its own.";

export function NO_BASELINE_STATE(condition: string, subjectLabel: string): string {
  return `We cannot give you a number for ${condition}. The models for this condition have only been checked in groups that do not match ${subjectLabel}'s background, so any number we showed would be wrong in a direction we cannot measure.`;
}
