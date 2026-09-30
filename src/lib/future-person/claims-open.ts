import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";

/**
 * Whether this deployment accepts Future Person claims. A claim needs a
 * record to claim, and records can only be made where embryo analysis runs:
 * today that is the TEST-LOCAL jurisdiction and nowhere real. Elsewhere the
 * page explains that claims are not open and accepts nothing.
 *
 * This is not a jurisdiction gate on the claimant, whose right is never
 * blocked by where they live (rights.future-person-claim.policy
 * .jurisdictionBypass). It is the fact that no record can exist yet. When a
 * real jurisdiction first permits `embryo_analysis`, this must open with it.
 */
export function futurePersonClaimsOpen(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isTestJurisdictionEnabled(env);
}
