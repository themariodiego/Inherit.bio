/**
 * The versioned region set for the ancestry map (brief §4.6, X16.5): the one
 * home for region definitions, population mappings and minimum-marker
 * thresholds is `data/ref/regions/regions.json` (docs/canonical-artifacts.md);
 * this module types it, checks it against the shipped panel at load, and
 * answers the two questions a page asks — which region a reference
 * population maps to, and whether a region (or a whole tier) qualifies for
 * the markers a file supplied.
 */
import regionsJson from "../../../data/ref/regions/regions.json";
import { POPS, type Pop } from "@/lib/genome/admixture";
import { MIN_MARKERS, PANEL } from "./panel";

export type RegionTier = "continental" | "sub-continental";

export interface RegionPopulation {
  /** 1000 Genomes phase 3 population code. */
  code: string;
  /** People sampled, counted from the phase 3 sample panel. */
  n: number;
  /** A place, never a people. */
  sampled_in: string;
  /** Sampled away from the region the superpopulation is named for. */
  diaspora: boolean;
}

export interface Region {
  /** Satisfies `ref_regions.region_code`: `^[a-z0-9][a-z0-9._-]{1,79}$`. */
  code: string;
  /** A place-based name; never a demonym or ethnonym (`label-denylist.json`). */
  display_name: string;
  tier: RegionTier;
  superpop: Pop;
  /** Fewest usable markers before the region can be shown; equals MIN_MARKERS for the shipped panel. */
  min_markers: number;
  population_codes: string[];
  populations: RegionPopulation[];
  n_total: number;
  /** Label anchor: centre of the projected bounding box, written by the geometry build. */
  centroid_lon: number;
  centroid_lat: number;
  sort_order: number;
  citation_ids: string[];
  geometry_recipe: string;
}

export interface RegionRelease {
  /** Satisfies `ref_region_releases.release_id`: `^ancestry-regions-v[0-9]+$`. */
  release_id: string;
  name: string;
  provenance: string;
  panel: { id: string; version: string; markers: number; provenance: string };
  geometry: { file: string; provenance: string };
  regions: Region[];
}

function checked(release: RegionRelease): RegionRelease {
  const { panel } = release;
  if (panel.id !== PANEL.id || panel.version !== PANEL.version || panel.markers !== PANEL.markers) {
    throw new Error(
      `regions.json names panel ${panel.id} ${panel.version} (${panel.markers} markers); the shipped panel is ${PANEL.id} ${PANEL.version} (${PANEL.markers})`,
    );
  }
  for (const region of release.regions) {
    if (region.min_markers !== MIN_MARKERS) {
      throw new Error(`${region.code}.min_markers is ${region.min_markers}; the shipped panel derives ${MIN_MARKERS}`);
    }
    if (!(POPS as readonly string[]).includes(region.superpop)) {
      throw new Error(`${region.code}.superpop ${region.superpop} is not a panel superpopulation`);
    }
  }
  return release;
}

export const REGION_RELEASE: RegionRelease = checked(regionsJson as RegionRelease);

/** Every region of the release in `sort_order`. */
export const REGIONS: readonly Region[] = [...REGION_RELEASE.regions].sort((a, b) => a.sort_order - b.sort_order);

/** The region a reference superpopulation maps to. Every panel superpopulation has exactly one. */
export function regionForPop(pop: Pop): Region {
  const region = REGIONS.find((candidate) => candidate.superpop === pop);
  if (!region) throw new Error(`no region maps superpopulation ${pop}`);
  return region;
}

/** A region shows once the file supplied at least its minimum of usable markers. */
export function qualifies(region: Region, markersUsed: number): boolean {
  return markersUsed >= region.min_markers;
}

/** A tier's control renders only when at least one region in it qualifies (brief §4.6). */
export function tierQualifies(tier: RegionTier, markersUsed: number): boolean {
  return REGIONS.some((region) => region.tier === tier && qualifies(region, markersUsed));
}
