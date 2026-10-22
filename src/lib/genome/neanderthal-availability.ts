import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";

/**
 * Whether this deployment computes, stores and shows the Neanderthal estimate:
 * TEST-LOCAL only (owner decision 2026-10-16, G7.4). In production the
 * capability is OFF — the panel is never read, no estimate is stored, and the
 * card shows its production state. This mirrors `embryoIngestBuilt()`: a
 * TEST-LOCAL capability that production holds off, which the capability
 * register records as `shipped-degraded`.
 *
 * Unlike the Embryo routes, nothing here is jurisdiction-gated per subject
 * (Neanderthal is a Tier-0 surface); the flag is the release switch and
 * nothing more.
 */
export function neanderthalEstimateBuilt(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return isTestJurisdictionEnabled(env);
}

/**
 * Whether the Neanderthal comparison figure may be shown. It stays FALSE until
 * the owner's source review of the comparator and the panel's population
 * choice is recorded (`docs/neanderthal-source-review.md`). The card must not
 * render the comparator sentence while this is false, even under TEST-LOCAL
 * with an estimate on screen. It is a plain constant, not a flag, because no
 * review exists to turn it on.
 */
export const NEANDERTHAL_COMPARISON_REVIEWED = false as const;
