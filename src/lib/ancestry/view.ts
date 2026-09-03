/**
 * The serialisable view of the regions section: what the server hands the
 * client component after `presentShares()` has done the arithmetic. Every
 * number here is already the value a figure prints, so the client carries
 * neither the region file nor the marker table.
 */
import type { AncestryShareRange } from "@/lib/figures/spec";
import { chipValues, regionAccessibleName, shareFromTenths, type Band, type SharePresentation } from "./present";

export interface RegionPopulationView {
  /** 1000 Genomes phase 3 population code. */
  code: string;
  /** Where it was sampled: a place, never a people. */
  place: string;
}

export interface RegionRowView {
  code: string;
  name: string;
  /** The apportioned fraction the row figure prints (0.432 → "43.2%"). */
  share: number;
  /** The interval, or the explicit statement that none exists yet. */
  range: AncestryShareRange;
  band: Band;
  /** The interval's lower bound, or the point while no interval exists. */
  lowerBound: number;
  /** Fill opacity in [0.15, 1], or null for a dashed hairline. */
  opacity: number | null;
  hatched: boolean;
  wellSupported: boolean;
  /** "{Region name}: {pct}% (no range yet)" — the path's accessible name (A.8). */
  accessibleName: string;
  populations: RegionPopulationView[];
}

/** The two chip values as share fractions for one toggle state. */
export interface ChipShares {
  unassignable: number;
  hidden: number;
}

export interface ToggleChips {
  /** "Show only what’s well supported" on. */
  on: ChipShares;
  off: ChipShares;
}

export interface RegionsView {
  /** Descending by share. */
  rows: RegionRowView[];
  chips: ToggleChips;
}

function chipShares(presentation: SharePresentation, wellSupportedOnly: boolean): ChipShares {
  const values = chipValues(presentation, wellSupportedOnly);
  return {
    unassignable: shareFromTenths(values.unassignableTenths),
    hidden: shareFromTenths(values.hiddenTenths),
  };
}

export function regionsView(presentation: SharePresentation): RegionsView {
  const rows = presentation.rows.map((row): RegionRowView => {
    const share = shareFromTenths(row.tenths);
    return {
      code: row.region.code,
      name: row.region.display_name,
      share,
      range: row.range ? { low: row.range.low, high: row.range.high } : { unavailable: true },
      band: row.band,
      lowerBound: row.lowerBound,
      opacity: row.opacity,
      hatched: row.hatched,
      wellSupported: row.wellSupported,
      accessibleName: regionAccessibleName(row.region.display_name, { point: share, range: row.range }),
      populations: row.region.populations.map((population) => ({
        code: population.code,
        place: population.sampled_in,
      })),
    };
  });
  return {
    rows,
    chips: { on: chipShares(presentation, true), off: chipShares(presentation, false) },
  };
}
