import manifest from "../../../data/ref/aims-seven-region-manifest.json";
import { SEVEN_ANCESTRY_PANEL, regionalAdmixtureResultSchema } from "../uploads/own-ancestry-content-v3";
import { REGIONAL_REGIONS, type RegionalReferenceFacts } from "./regional-regions";
import { SOURCES, type PanelSource } from "./panel";

export const REGIONAL_REFERENCE: RegionalReferenceFacts = {
  populationCount: manifest.populationCount, referenceSampleCount: manifest.referenceSampleCount,
  regions: REGIONAL_REGIONS.map(({ code }) => {
    const facts = manifest.regions.find(region => region.code === code);
    if (!facts) throw new Error("ancestry_reference_region_missing");
    return { ...facts, code };
  }),
};

export function isSevenRegionPanel(row: { model_id: string | null; model_version: string | null } | undefined) {
  return row?.model_id === SEVEN_ANCESTRY_PANEL.id && row.model_version === SEVEN_ANCESTRY_PANEL.version;
}

/** Read a captured estimate only under its exact saved reference identity. */
export function sevenRegionResult(row: { model_id: string | null; model_version: string | null; result: unknown } | undefined) {
  if (!isSevenRegionPanel(row)) return null;
  const parsed = regionalAdmixtureResultSchema.safeParse(row?.result);
  return parsed.success ? parsed.data : null;
}

export const REGIONAL_SOURCES: readonly PanelSource[] = [
  ...SOURCES.slice(0, 3),
  { id: "doi:10.1101/gr.278378.123", title: "Koenig and colleagues, 2024",
    detail: "The harmonised HGDP+1kGP reference resource. This panel uses the gnomAD v3.1.2 release and its recorded metadata filter." },
  { id: "natural-earth:110m-physical-seven-v1", title: "Natural Earth 1:110m physical, public domain",
    detail: "The land beneath the seven broad region locators. The cuts are a guide to place, not sample sites or borders." },
];
