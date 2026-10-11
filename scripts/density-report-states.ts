import type { DensityStateCase } from "./density-capture-plan";
export type ReportDensityRecipe = "tiny" | "nothing" | "partial" | "full" | "ancestry-shown" | "ancestry-off" | "reports-off";
export const REPORT_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, ReportDensityRecipe>>>> = {
  "app.overview": { "partial-coverage": "tiny", complete: "full", "not-covered": "nothing" },
  "genome.subject": { complete: "tiny" },
  "genome.reports": { complete: "tiny", "partial-coverage": "tiny", "not-covered": "nothing", "consent-required": "reports-off" },
  "genome.report": { complete: "tiny", "partial-coverage": "tiny", "not-covered": "nothing" },
  "genome.data": { complete: "tiny", "partial-coverage": "partial" },
  "genome.browser": { complete: "tiny", "partial-coverage": "tiny", "not-covered": "nothing" },
  "genome.ancestry": { complete: "ancestry-shown", "not-covered": "nothing", "consent-required": "ancestry-off" },
};
export function reportDensityRecipe(row: DensityStateCase): ReportDensityRecipe | null {
  return Object.hasOwn(REPORT_DENSITY_STATES, row.route.id)
    && Object.hasOwn(REPORT_DENSITY_STATES[row.route.id], row.state)
    ? REPORT_DENSITY_STATES[row.route.id][row.state] : null;
}
