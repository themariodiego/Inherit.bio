import type { DensityStateCase } from "./density-capture-plan";

export type FamilyDensityRecipe = "unshared" | "one-layer" | "both-layers" | "no-coverage"
  | "paused" | "preparing" | "permissions" | "grant-pending" | "jurisdiction"
  | "health-paused" | "portrait-missing" | "portrait-empty";
export const FAMILY_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, FamilyDensityRecipe>>>> = {
  "family.person": { empty: "unshared", "partial-coverage": "one-layer", complete: "both-layers",
    "not-covered": "no-coverage", "consent-required": "paused", processing: "preparing",
    "jurisdiction-unavailable": "jurisdiction" },
  "family.permissions": { complete: "permissions", processing: "grant-pending", "jurisdiction-unavailable": "jurisdiction" },
  "family.index": { processing: "preparing", complete: "both-layers" },
  "family.health-picture": { "consent-required": "health-paused" },
  "family.portrait": { "consent-required": "portrait-missing", empty: "portrait-empty" },
  "genome.subject": { "jurisdiction-unavailable": "jurisdiction" },
  "genome.reports": { "jurisdiction-unavailable": "jurisdiction" },
  "genome.report": { "jurisdiction-unavailable": "jurisdiction" },
  "genome.ancestry": { "jurisdiction-unavailable": "jurisdiction" },
  "genome.data": { "jurisdiction-unavailable": "jurisdiction" },
  "genome.browser": { "jurisdiction-unavailable": "jurisdiction" },
};

export function familyDensityRecipe(row: DensityStateCase): FamilyDensityRecipe | null {
  return Object.hasOwn(FAMILY_DENSITY_STATES, row.route.id)
    && Object.hasOwn(FAMILY_DENSITY_STATES[row.route.id], row.state)
    ? FAMILY_DENSITY_STATES[row.route.id][row.state] : null;
}
