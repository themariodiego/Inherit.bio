import type { RegionalReferenceFacts } from "@/lib/ancestry/regional-regions";

export const REGIONAL_MAP_LABEL = "Map of broad regions";
export const REGIONAL_MAP_CAPTION = "Broad reference regions. Soft shading is a guide to place, not a border or a map of your ancestors.";
export const REGIONAL_SPLIT_SUMMARY = "See the separate region estimates";
export const REGIONAL_FILTER_NOTE = "Here, “well supported” is a display rule: it hides shares below two percent. It does not test whether a share is real. Shading uses the estimated share because there is no tested range yet.";
export const REGIONAL_UNASSIGNABLE_NOTE = "The fit divides all its weight among these reference groups, so the unassigned share is zero. This does not mean the panel covers all of your DNA or all ancestry.";
export const REGIONAL_MAP_LIMIT = "The map uses broad cuts through land, not sample sites. The Middle East reference includes North Africa. Oceania uses only two study groups. Its map is limited to New Guinea and nearby islands; it cannot stand for all Oceania.";
export const REGIONAL_NO_RANGE = "This seven-region model has no tested range yet. Small shares may be noise. These groups do not cover all people or places.";
export const REGIONAL_FIT_LIMIT = "The fit reached its calculation limit. These shares may still change with more fitting steps.";
export const REGIONAL_NO_RESULT = "No usable region estimate is available for this file yet.";

export function regionalPanelLine(panel: { markers: number; version: string }, reference: RegionalReferenceFacts): string {
  return `The ${panel.markers}-marker panel uses ${reference.referenceSampleCount.toLocaleString("en-US")} reference samples from ${reference.populationCount} study groups in the gnomAD HGDP+1kGP release. Reference version: ${panel.version}. Study groups are comparison sets, not identities.`;
}
export function regionalBelowMinimum(read: number, needed: number): string {
  return `Your file covers only ${read} of ${needed} ancestry markers — too few to draw a map. This is a limit of the file, not a result about you.`;
}
