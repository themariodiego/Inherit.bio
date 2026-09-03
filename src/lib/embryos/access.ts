import "server-only";

import {
  familyCapability,
  resolveCapability,
  type AccountResolveOptions,
  type CapabilityDecision,
  type JurisdictionCapability,
} from "@/lib/legal/jurisdictions";
import type { EmbryoCohortView } from "./cohorts";
import type { EmbryoStatus } from "./policy";

/**
 * What an Embryo surface may show, and to whom (design §1.4).
 *
 * Two independent questions, answered in this order and never merged:
 *   1. jurisdiction — the acting account and every required upload principal
 *      are resolved against `data/jurisdictions.json` through the one shared
 *      reader (G5.1b, X12.2), and the strictest answer wins with the
 *      register's own copy. A principal with no account has declared no
 *      jurisdiction, so the capability reads as `unreviewed`;
 *   2. consent — a result is readable only when every required upload
 *      principal holds a live `embryo.analysis` grant on the cohort.
 *
 * The route guard is `embryo_analysis`; the result layers add their own
 * capabilities. A refusal is never a blank: the caller renders the
 * decision's `userFacingCopy` or the consent-required sentence.
 */

export { permits } from "@/lib/family/access";
export type { CapabilityDecision, JurisdictionCapability } from "@/lib/legal/jurisdictions";

/** The capability every Embryo route is guarded by. */
export const EMBRYO_ANALYSIS: JurisdictionCapability = "embryo_analysis";

/** The register's response guards, per result layer. */
export const RESULT_LAYER_CAPABILITIES = {
  "single-locus": ["embryo_analysis", "embryo_single_locus"],
  "statistical-estimate": ["embryo_analysis", "embryo_statistical_estimate"],
  "carrier-match": ["embryo_analysis", "embryo_single_locus", "carrier_match"],
} as const satisfies Record<string, readonly JurisdictionCapability[]>;

/** G5.1b over accounts: the viewer plus every contributor, through the shared reader. */
export function embryoCapability(
  viewerAccountId: string,
  contributorAccountIds: readonly string[],
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  return familyCapability(viewerAccountId, contributorAccountIds, capability, options);
}

/**
 * The same question for one cohort: the viewer and every required upload
 * principal. A principal without an account cannot have declared a
 * jurisdiction, so the decision is `unreviewed` with the default copy —
 * fail closed, never inferred.
 */
export async function cohortCapability(
  viewerAccountId: string,
  cohort: Pick<EmbryoCohortView, "requiredUploadPrincipalAccountIds" | "requiredUploadPrincipalsWithoutAccount">,
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  const contributors = cohort.requiredUploadPrincipalAccountIds.filter((id) => id !== viewerAccountId);
  const decision = await embryoCapability(viewerAccountId, contributors, capability, options);
  if (cohort.requiredUploadPrincipalsWithoutAccount > 0 && decision.status === "permitted") {
    return { ...resolveCapability(null, capability, { ...options, testJurisdiction: false }), source: "unset" };
  }
  return decision;
}

export type AnalysisConsent = "granted" | "waiting-for-you" | "waiting-for-other";

/** Whose grant is missing, so the card can say so without naming anyone. */
export function analysisConsent(
  cohort: Pick<EmbryoCohortView, "analysisGranted" | "viewerAnalysisGranted">,
): AnalysisConsent {
  if (cohort.analysisGranted) return "granted";
  if (cohort.viewerAnalysisGranted === false) return "waiting-for-you";
  return "waiting-for-other";
}

/** The states a result surface can be in, in the order a reader meets them. */
export type ResultSurfaceState =
  | "jurisdiction-unavailable"
  | "empty"
  | "processing"
  | "consent-required"
  | "gated"
  | "complete";

export interface SurfaceStateInput {
  decision: CapabilityDecision;
  cohort: EmbryoCohortView | null;
  /** The one embryo the detail page names; the compare page passes none. */
  embryoStatus?: EmbryoStatus;
  acknowledged: boolean;
}

/**
 * The one order for `/embryos/compare` and `/embryos/[embryoId]` (design
 * §1.4, §1.5): the jurisdiction refuses before anything else; no cohort is
 * the empty state; a file still being checked is the processing state; a
 * missing grant blocks before the gate, because a gate in front of nothing
 * says less than the sentence it would hide; and the Tier-2 gate stands in
 * front of every derived read.
 */
export function resolveResultSurfaceState(input: SurfaceStateInput): ResultSurfaceState {
  if (input.decision.status !== "permitted") return "jurisdiction-unavailable";
  if (!input.cohort) return "empty";
  if (input.cohort.status === "ingesting" || input.embryoStatus === "pending") return "processing";
  if (input.cohort.status === "upload_pending") return "empty";
  if (!input.cohort.analysisGranted) return "consent-required";
  if (!input.acknowledged) return "gated";
  return "complete";
}
