import type { RegionalAdmixtureResult } from "@/lib/genome/regional-admixture";
import type { MapShapes, RegionShape } from "./geometry";
import type { RegionRowView } from "./view";
import { REGIONAL_COMBINED_CODE, REGIONAL_COMBINED_NAME, REGIONAL_REGIONS, REGIONAL_SPLIT_CODES } from "./regional-regions";

/** The existing display convention, not a measured confidence threshold. */
export const REGIONAL_DISPLAY_MIN = 0.02;

/** Largest remainders, with stable input-order ties and no mass assigned to zero. */
function apportion(values: number[], totalTenths: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);
  const exact = values.map(value => Math.round(value / total * totalTenths * 1e6) / 1e6);
  const tenths = exact.map(Math.floor);
  const eligible = values.map((_, i) => i).filter(i => values[i] > 0)
    .sort((a, b) => (exact[b] - tenths[b]) - (exact[a] - tenths[a]) || a - b);
  const left = totalTenths - tenths.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < left; i++) tenths[eligible[i % eligible.length]]++;
  return tenths;
}

function row(code: string, name: string, point: number, tenths: number): RegionRowView {
  const share = tenths / 1000;
  return {
    code, name, share, range: { unavailable: true },
    band: point >= 0.3 ? "a large part" : point >= 0.1 ? "a noticeable part"
      : point >= REGIONAL_DISPLAY_MIN ? "a small part" : "possible but not established",
    lowerBound: point, opacity: point > 0 ? Math.max(0.15, Math.min(1, point)) : null,
    hatched: false, wellSupported: point >= REGIONAL_DISPLAY_MIN,
    accessibleName: `${name}: ${Math.floor(share * 100 + 0.5)}% (no range yet)`,
    populations: [],
  };
}

export interface RegionalPresentation {
  rows: RegionRowView[];
  /** Present only when the stored reporting decision merges all three regions. */
  split: RegionRowView[];
}

/** Merge full precision first; round the disclosure into its displayed parent's budget. */
export function presentRegionalShares(result: RegionalAdmixtureResult): RegionalPresentation {
  const proportions = result.proportions;
  if (!proportions) return { rows: [], split: [] };
  const values = REGIONAL_REGIONS.map(region => proportions[region.code]);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)
      || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) {
    throw new Error("Regional shares must be finite, non-negative and sum to one");
  }
  const merged = result.reporting.merged;
  const members = new Set<string>(REGIONAL_SPLIT_CODES);
  const groups: { code: string; name: string; point: number }[] = REGIONAL_REGIONS.filter(region => !merged || !members.has(region.code))
    .map(region => ({ ...region, point: proportions[region.code] }));
  if (merged) groups.push({ code: REGIONAL_COMBINED_CODE,
    name: REGIONAL_COMBINED_NAME, point: REGIONAL_SPLIT_CODES.reduce((sum, code) => sum + proportions[code], 0) });
  const tenths = apportion(groups.map(group => group.point), 1000);
  const rows = groups.map((group, index) => row(group.code, group.name, group.point, tenths[index]))
    .sort((a, b) => b.lowerBound - a.lowerBound);
  const splitTenths = merged ? apportion(REGIONAL_SPLIT_CODES.map(code => proportions[code]), tenths.at(-1)!) : [];
  const split = merged ? REGIONAL_SPLIT_CODES.map((code, index) => row(code,
    REGIONAL_REGIONS.find(region => region.code === code)!.name, proportions[code], splitTenths[index])) : [];
  return { rows, split };
}

export function regionalChipShares(rows: RegionRowView[], wellSupportedOnly: boolean) {
  const hiddenTenths = rows.filter(row => wellSupportedOnly && !row.wellSupported)
    .reduce((sum, row) => sum + Math.round(row.share * 1000), 0);
  return { unassignable: 0, hidden: hiddenTenths / 1000 };
}

/** Disjoint region polygons share one interactive path when their reported row is combined. */
export function regionalReportingShapes(shapes: MapShapes, merged: boolean): MapShapes {
  if (!merged) return shapes;
  const members = new Set<string>(REGIONAL_SPLIT_CODES);
  const parts = shapes.regions.filter(shape => members.has(shape.code));
  if (parts.length !== members.size) throw new Error("Combined regional map needs EUR, MID and CSA geometry");
  const combined: RegionShape = { code: REGIONAL_COMBINED_CODE, d: parts.map(shape => shape.d).join(""), bbox: {
    x0: Math.min(...parts.map(shape => shape.bbox.x0)), y0: Math.min(...parts.map(shape => shape.bbox.y0)),
    x1: Math.max(...parts.map(shape => shape.bbox.x1)), y1: Math.max(...parts.map(shape => shape.bbox.y1)),
  } };
  return { land: shapes.land, regions: [...shapes.regions.filter(shape => !members.has(shape.code)), combined] };
}
