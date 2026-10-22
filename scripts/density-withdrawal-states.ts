import type { DensityStateCase } from "./density-capture-plan";

export type WithdrawalDensityRecipe = "refuse-pending" | "refused";
export function withdrawalDensityRecipe(row: DensityStateCase): WithdrawalDensityRecipe | null {
  if (row.route.id !== "rights.withdraw" || row.route.path !== "/withdraw/[token]"
    || row.route.stateProfile !== "public-rights-flow" || row.route.auth !== "public") return null;
  return row.state === "processing" ? "refuse-pending" : row.state === "complete" ? "refused" : null;
}
