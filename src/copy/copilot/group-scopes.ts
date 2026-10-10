/**
 * Copilot's group scopes: the Family view and the embryo cohort. Every
 * user-visible string of those two branches of `/copilot/[scope]` lives here
 * (register `copilot-route-scope-v1`, `copilot-transport-availability-v1`).
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` a heading, `*_BUTTON` a button, `*_LABEL` a label, `*_STATUS`
 * and `*_NOTE` a status; everything else is running text.
 */
import { COPILOT_LOCAL_ONLY } from "@/copy/family/person";
import { LAYER_LABELS } from "@/copy/reports/strings";
import type { FindingLayer } from "@/lib/genome/taxonomy";

/** The thread header's subject for the Family scope (brief §5.7: "Asking about: your family view"). */
export const FAMILY_SCOPE_LABEL = "your family view";

/** Heading of the true non-self unavailable page. */
export const LOCAL_UNAVAILABLE_HEADING = "Copilot for other people is not open here";

/** Why, in the brief's own words (line 1924). */
export const LOCAL_UNAVAILABLE_REASON = COPILOT_LOCAL_ONLY;

/** What would make it available. */
export const LOCAL_UNAVAILABLE_REQUIREMENT =
  "It needs Inherit and that model to run together on your own computer. It is not switched on for this site.";

/** The back action's label; the register fixes its route to Overview. */
export const BACK_TO_OVERVIEW_BUTTON = "Back to Overview";

/**
 * The copy ids `copilot-transport-availability-v1.cases.true-non-self.
 * unavailablePageProjection` names, resolved to their one string each. The
 * page renders these and nothing else in that state.
 */
export const COPY_IDS = {
  "copilot.transport.local-unavailable.heading": LOCAL_UNAVAILABLE_HEADING,
  "copilot.transport.local-unavailable.reason": LOCAL_UNAVAILABLE_REASON,
  "copilot.transport.local-unavailable.requirement": LOCAL_UNAVAILABLE_REQUIREMENT,
  "actions.back": BACK_TO_OVERVIEW_BUTTON,
} as const;

export type GroupScopeCopyId = keyof typeof COPY_IDS;

/** The Family scope's first paragraph. */
export const FAMILY_COPILOT_LEDE =
  "Copilot answers from what each person below lets it read. It reads only the report types they chose for you, never their whole file.";

/** The list of people whose shared reports this thread may read. */
export const FAMILY_MEMBERS_HEADING = "Who Copilot can read";

/** One person in that list, with the report types they share. */
export function familyMemberLine(name: string, layers: readonly FindingLayer[]): string {
  return `${name}: ${layers.map((layer) => LAYER_LABELS[layer]).join(", ")}`;
}

/** Shown when nobody has let Copilot read what they share with this account. */
export const FAMILY_EMPTY_NOTE = "No one has let Copilot read what they share with you.";

/** How someone turns it on, for the empty state. */
export const FAMILY_HOW_TO_TURN_ON =
  "A person can turn this on from their own Permissions page. They need three rows on: Copilot, Health picture, and at least one report type.";

/** The empty state's one action. */
export const OPEN_FAMILY_BUTTON = "Open Family";

/** The composer's empty-thread hint. */
export const FAMILY_THREAD_HINT =
  "Ask about the reports shared with you. Each answer names whose results it used.";

/** The composer's placeholder. */
export const FAMILY_PLACEHOLDER_LABEL = "Ask about your family view…";

/** When this deployment can run a local model, but this account has not set one up and allowed it. */
export const FAMILY_NEEDS_LOCAL_MODEL =
  "Set Copilot to a model on this computer and allow it in Copilot settings. Then come back here.";

export const REVIEW_SETTINGS_BUTTON = "Review Copilot settings";

/** An answer's source line: whose shared results it read. */
export function sharedByLabel(name: string): string {
  return `Shared by ${name}`;
}

/** A shared report cited under an answer, named with the person it belongs to. */
export function sharedReportLabel(title: string, name: string): string {
  return `${title} (shared by ${name})`;
}

// ---------------------------------------------------------------------------
// The Embryo (cohort) scope, under the TEST-LOCAL acceptance row only.
// ---------------------------------------------------------------------------

/** The cohort scope's first paragraph. */
export const COHORT_COPILOT_LEDE =
  "Copilot answers from these embryos' quality checks. It cannot read any genotype, and it will not rank embryos, pick one or say anything about sex.";

/** The list of embryos this thread may read. */
export const COHORT_EMBRYOS_HEADING = "What Copilot can read";

/** One embryo in that list, with its status word. */
export function cohortEmbryoLine(label: string, status: string): string {
  return `${label}: ${status}`;
}

/** The composer's empty-thread hint. */
export const COHORT_THREAD_HINT =
  "Ask about these embryos' quality checks. There are no condition results to ask about yet.";

/** The composer's placeholder. */
export const COHORT_PLACEHOLDER_LABEL = "Ask about these embryos…";

/** When this deployment can run a local model, but this account has not set one up and allowed it. */
export const COHORT_NEEDS_LOCAL_MODEL = FAMILY_NEEDS_LOCAL_MODEL;

/** An answer's first source: the cohort's compare page, by that page's own title. */
export { COMPARE_H1 as COHORT_CITATION_LABEL } from "@/copy/embryos/compare";

/** The page's one link back to the compare page, in the embryos pages' own words. */
export { COMPARE_THESE_LINK as OPEN_COMPARISON_BUTTON } from "@/copy/embryos/index";
