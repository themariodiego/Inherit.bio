import "server-only";

import {
  familyCapability as resolveFamilyCapability,
  type AccountResolveOptions,
  type CapabilityDecision,
  type JurisdictionCapability,
} from "@/lib/legal/jurisdictions";
import type { FindingLayer } from "@/lib/genome/taxonomy";
import type { FamilyPerson, Purpose } from "./graph";

/**
 * What a Family surface may show, and to whom (design §1.4).
 *
 * Two independent questions, answered in this order and never merged:
 *   1. jurisdiction — `familyCapability` resolves the acting account and
 *      every contributor against `data/jurisdictions.json` (G5.1b) and
 *      returns the strictest answer with the register's own copy;
 *   2. consent — a purpose is readable only through a live directional
 *      grant from that person's own account, and a current pause suspends
 *      every one of them without deleting a row (family-sharing-state-v1).
 *
 * A refusal is never a blank: the caller renders the decision's
 * `userFacingCopy` (jurisdiction) or the consent-required sentence.
 */

export {
  accountCapability,
  resolveCapability,
  familyCapabilityFromCodes,
  isTestJurisdictionEnabled,
  strictestDecision,
  type CapabilityDecision,
  type CapabilityStatus,
  type JurisdictionCapability,
} from "@/lib/legal/jurisdictions";

/** The capability every Family surface needs before it shows anything about another adult. */
export const THIRD_PARTY_ADULT_ANALYSIS: JurisdictionCapability = "third_party_adult_analysis";

/**
 * G5.1b over accounts: the viewer plus every contributor. Family reads it
 * through this one home so no surface resolves a jurisdiction itself.
 */
export function familyCapability(
  viewerAccountId: string,
  contributorAccountIds: readonly string[],
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  return resolveFamilyCapability(viewerAccountId, contributorAccountIds, capability, options);
}

/** The same question for one person: the viewer and that person's own account. */
export function personCapability(
  viewerAccountId: string,
  person: FamilyPerson,
  capability: JurisdictionCapability,
  options: AccountResolveOptions = {},
): Promise<CapabilityDecision> {
  return familyCapability(viewerAccountId, [person.counterpartAccountId], capability, options);
}

/** True when the decision lets the surface render a result. */
export function permits(decision: CapabilityDecision): boolean {
  return decision.status === "permitted";
}

/** The purpose that authorises each report layer (register `individualResultPurposeLayers`). */
export const LAYER_PURPOSES: Record<FindingLayer, Purpose> = {
  variant_call: "reports.monogenic",
  estimate: "reports.polygenic",
};

/**
 * The grants that are live for the viewer right now. A pause changes no
 * grant row, so the set is emptied here rather than in the graph: the
 * permissions page still shows each row as On, while every derived surface
 * denies on the next query (X3.4).
 */
export function liveGrantsToViewer(person: FamilyPerson): ReadonlySet<Purpose> {
  return person.sharing === "paused" ? new Set<Purpose>() : person.grantsToViewer;
}

/** Whether this viewer may read one purpose about this person, right now. */
export function viewerMaySee(person: FamilyPerson, purpose: Purpose): boolean {
  return liveGrantsToViewer(person).has(purpose);
}

/** The report layers this person has shared with the viewer, in layer order. */
export function grantedLayers(person: FamilyPerson): FindingLayer[] {
  return (["variant_call", "estimate"] as const).filter((layer) =>
    viewerMaySee(person, LAYER_PURPOSES[layer]),
  );
}

/** True when at least one report layer is live: the card may then speak about files. */
export function hasReportGrant(person: FamilyPerson): boolean {
  return grantedLayers(person).length > 0;
}
