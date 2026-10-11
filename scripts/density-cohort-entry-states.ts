import type { DensityStateCase } from "./density-capture-plan";

export type CohortEntryDensityRecipe = "empty-hub" | "empty-compare" | "request-letter";
export const COHORT_ENTRY_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, CohortEntryDensityRecipe>>>> = {
  "embryos.index": { empty: "empty-hub" },
  "embryos.compare": { empty: "empty-compare" },
  "embryos.request-data": { complete: "request-letter" },
};
export function cohortEntryDensityRecipe(row: DensityStateCase): CohortEntryDensityRecipe | null {
  return Object.hasOwn(COHORT_ENTRY_DENSITY_STATES, row.route.id)
    && Object.hasOwn(COHORT_ENTRY_DENSITY_STATES[row.route.id], row.state)
    ? COHORT_ENTRY_DENSITY_STATES[row.route.id][row.state] : null;
}
