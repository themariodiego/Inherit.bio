import type { RegionalPop } from "@/lib/genome/regional-admixture";
import registry from "../../../data/ref/regions/regions-v3.json";

/** Display metadata only: safe to import from a client component. */
export const REGIONAL_REGION_RELEASE = registry;
export const REGIONAL_REGIONS: readonly { code: RegionalPop; name: string }[] = [...registry.regions]
  .sort((a, b) => a.sort_order - b.sort_order)
  .map(region => ({ code: region.code as RegionalPop, name: region.display_name }));
export const REGIONAL_COMBINED_CODE = "EUR-MID-CSA";
export const REGIONAL_COMBINED_NAME = "Europe, Middle East / North Africa, and Central–South Asia";
export const REGIONAL_SPLIT_CODES = ["EUR", "MID", "CSA"] as const;

export interface RegionalReferenceFacts {
  populationCount: number;
  referenceSampleCount: number;
  regions: readonly {
    code: RegionalPop;
    populationCount: number;
    referenceSampleCount: number;
  }[];
}
