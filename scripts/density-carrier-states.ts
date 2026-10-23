import type { DensityStateCase } from "./density-capture-plan";

/**
 * The six registered `genome.carrier` density states and how each is reached,
 * by the same path `e2e/own-carrier-status.spec.ts` uses: a fresh account, the
 * committed carrier-pair fixture through the real upload and preparation path,
 * the "Observed genetic variants" choice signed and generated in the person's
 * own Reports page, and a synthetic reviewed release imported and activated
 * only through the rule's own import and review doors. Nothing is written
 * into a person's data, and every synthetic condition is withdrawn afterwards.
 */
export type CarrierDensityRecipe =
  | "no-file" | "in-flight" | "no-reviewed-condition" | "choice-off" | "every-position-read" | "position-not-reported";
export type CarrierCondition = "one" | "two" | "three";

export const CARRIER_DENSITY_STATES: Readonly<Record<string, CarrierDensityRecipe>> = {
  empty: "no-file",
  processing: "in-flight",
  "not-covered": "no-reviewed-condition",
  "consent-required": "choice-off",
  complete: "every-position-read",
  "partial-coverage": "position-not-reported",
};

/** What each recipe needs: the active synthetic conditions, the file and the choice. */
export const CARRIER_DENSITY_RECIPES: Readonly<Record<CarrierDensityRecipe, {
  active: readonly CarrierCondition[]; file: "none" | "held" | "prepared"; monogenicChoice: boolean; pageState: string;
}>> = {
  "no-file": { active: ["one", "three"], file: "none", monogenicChoice: false, pageState: "empty" },
  "in-flight": { active: ["one", "three"], file: "held", monogenicChoice: false, pageState: "processing" },
  "no-reviewed-condition": { active: [], file: "prepared", monogenicChoice: false, pageState: "unavailable" },
  "choice-off": { active: ["one", "three"], file: "prepared", monogenicChoice: false, pageState: "consent-required" },
  "every-position-read": { active: ["one", "three"], file: "prepared", monogenicChoice: true, pageState: "complete" },
  "position-not-reported": { active: ["one", "two", "three"], file: "prepared", monogenicChoice: true, pageState: "partial-coverage" },
};

export function carrierDensityRecipe(row: DensityStateCase): CarrierDensityRecipe | null {
  if (row.route.id !== "genome.carrier") return null;
  if (row.route.path !== "/genome/[subject]/carrier" || row.route.kind !== "page")
    throw new Error("Unreviewed carrier density route");
  return Object.hasOwn(CARRIER_DENSITY_STATES, row.state) ? CARRIER_DENSITY_STATES[row.state] : null;
}
