/**
 * Pure presentation arithmetic for ancestry shares (brief §4.6, A.8, G4.4,
 * X16.5): the band a share falls in, the lower bound that drives fill
 * opacity and the well-supported toggle, the one-decimal display values
 * apportioned so that shown + unassignable + hidden = 100.0 exactly, and the
 * accessible name of a region path. No React, no I/O.
 *
 * Bands, lower bounds and opacity use the continuous stored proportion;
 * display rounding never feeds back into them.
 */
import { ANCESTRY_RANGE_UNAVAILABLE } from "@/lib/figures/contract";
import { POPS, type AdmixtureResult, type Pop } from "@/lib/genome/admixture";
import { REGIONS, type Region } from "./regions";

export type Band = "a large part" | "a noticeable part" | "a small part" | "possible but not established";

export const BAND_LARGE = 0.3;
export const BAND_NOTICEABLE = 0.1;
export const BAND_SMALL = 0.02;

/** Half-open bands on the continuous share (brief §4.6). */
export function band(share: number): Band {
  if (share >= BAND_LARGE) return "a large part";
  if (share >= BAND_NOTICEABLE) return "a noticeable part";
  if (share >= BAND_SMALL) return "a small part";
  return "possible but not established";
}

export interface ShareRange {
  low: number;
  high: number;
}

export interface Share {
  point: number;
  /** Absent until an interval can be computed (G4.4: the page then says so). */
  range?: ShareRange;
}

/** The interval's lower bound, or the point itself while no interval exists. */
export function lowerBound(share: Share): number {
  return share.range ? share.range.low : share.point;
}

export const OPACITY_FLOOR = 0.15;

/**
 * Fill opacity ∝ the lower bound with a floor of 0.15 (X16.5). Returns null
 * for a lower bound of exactly 0: such a region renders as a dashed hairline
 * with no fill, because its (degenerate) range includes zero.
 */
export function fillOpacity(lower: number): number | null {
  if (lower <= 0) return null;
  return Math.max(OPACITY_FLOOR, Math.min(1, lower));
}

/** Hatch only when a real interval is wider than 0.10; never while no interval exists. */
export function hatched(share: Share): boolean {
  if (!share.range) return false;
  // Widths are compared at 3 dp, the precision the stored proportions carry.
  const width = Math.round((share.range.high - share.range.low) * 1000) / 1000;
  return width > 0.1;
}

/** "Show only what's well supported" hides regions whose lower bound is below this. */
export const WELL_SUPPORTED_MIN = BAND_SMALL;

export function wellSupported(share: Share): boolean {
  return lowerBound(share) >= WELL_SUPPORTED_MIN;
}

/** The key of the unassignable remainder in the apportioned set. */
export const UNASSIGNABLE = "u";

/**
 * Largest-remainder apportionment of shares (fractions summing to 1) to
 * tenths of a percent, so the displayed values sum to exactly 1,000 tenths.
 * Each entry gets the floor of its exact tenths; the leftover tenths go to
 * the largest remainders (ties in key order). An entry at exactly 0 never
 * receives a tenth. Every value is within one tenth of naive rounding.
 */
export function apportionShares<K extends string>(shares: Record<K, number>): Record<K, number> {
  const keys = Object.keys(shares) as K[];
  const values = keys.map((key) => shares[key]);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("shares must be finite and non-negative");
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-6) throw new Error(`shares must sum to 1, got ${total}`);

  // Round away float noise (0.432 × 1000 is not an integer in binary) before flooring.
  const exact = values.map((value) => Math.round(value * 1000 * 1e6) / 1e6);
  const tenths = exact.map((value) => Math.floor(value));
  let leftover = 1000 - tenths.reduce((sum, value) => sum + value, 0);

  const eligible = keys
    .map((_, index) => index)
    .filter((index) => values[index] > 0)
    .sort((a, b) => exact[b] - tenths[b] - (exact[a] - tenths[a]) || a - b);
  if (leftover > 0 && eligible.length === 0) throw new Error("no share can receive the leftover tenths");
  for (let cursor = 0; leftover > 0; cursor = (cursor + 1) % eligible.length) {
    tenths[eligible[cursor]] += 1;
    leftover -= 1;
  }

  const out = {} as Record<K, number>;
  keys.forEach((key, index) => {
    out[key] = tenths[index];
  });
  return out;
}

export interface RegionShare {
  region: Region;
  pop: Pop;
  /** The stored 3-dp proportion. */
  point: number;
  range?: ShareRange;
  lowerBound: number;
  band: Band;
  /** null → dashed hairline, no fill. */
  opacity: number | null;
  hatched: boolean;
  wellSupported: boolean;
  /** Apportioned display value in tenths of a percent (43.2% → 432). */
  tenths: number;
}

export interface SharePresentation {
  /** Descending by point, ties by sort order. */
  rows: RegionShare[];
  /** Mass not assignable to any region: 1 − Σ proportions, 0 by construction for the shipped estimator. */
  unassignable: { point: number; tenths: number };
}

export interface PresentOptions {
  /** Intervals per superpopulation, when a method that produces them exists. */
  ranges?: Partial<Record<Pop, ShareRange>>;
}

/** Percent with one decimal, as the figure prints it (432 → 43.2). */
export function percentFromTenths(tenths: number): number {
  return tenths / 10;
}

/** The share fraction an `ancestry-share` spec carries (432 → 0.432). */
export function shareFromTenths(tenths: number): number {
  return tenths / 1000;
}

/**
 * Everything the regions section needs, computed once on the server from
 * the stored estimate. The toggle state is not an input: display values are
 * apportioned over the fixed set of the five regions plus the unassignable
 * remainder, so a region's value is identical in both toggle states.
 */
export function presentShares(
  result: Pick<AdmixtureResult, "proportions">,
  options: PresentOptions = {},
): SharePresentation {
  const assigned = POPS.reduce((sum, pop) => sum + result.proportions[pop], 0);
  const unassignablePoint = Math.max(0, Math.round((1 - assigned) * 1000) / 1000);

  const shares = { [UNASSIGNABLE]: unassignablePoint } as Record<string, number>;
  for (const pop of POPS) shares[pop] = result.proportions[pop];
  const tenths = apportionShares(shares);

  const rows: RegionShare[] = REGIONS.map((region) => {
    const pop = region.superpop;
    const share: Share = { point: result.proportions[pop], range: options.ranges?.[pop] };
    const lower = lowerBound(share);
    return {
      region,
      pop,
      point: share.point,
      range: share.range,
      lowerBound: lower,
      band: band(share.point),
      opacity: fillOpacity(lower),
      hatched: hatched(share),
      wellSupported: wellSupported(share),
      tenths: tenths[pop],
    };
  }).sort((a, b) => b.point - a.point || a.region.sort_order - b.region.sort_order);

  return { rows, unassignable: { point: unassignablePoint, tenths: tenths[UNASSIGNABLE] } };
}

export interface ChipValues {
  /** Σ display of the visible rows. */
  shownTenths: number;
  /** "Not assignable to any region". */
  unassignableTenths: number;
  /** "Hidden as not well supported": Σ display of hidden rows when the toggle is on, 0 when off. */
  hiddenTenths: number;
}

/** shown + unassignable + hidden = 1,000 tenths in both toggle states. */
export function chipValues(presentation: SharePresentation, wellSupportedOnly: boolean): ChipValues {
  let shown = 0;
  let hidden = 0;
  for (const row of presentation.rows) {
    if (wellSupportedOnly && !row.wellSupported) hidden += row.tenths;
    else shown += row.tenths;
  }
  return { shownTenths: shown, unassignableTenths: presentation.unassignable.tenths, hiddenTenths: hidden };
}

/** Whole percent, rounded half-up as A.8 specifies. */
function wholePercent(fraction: number): number {
  return Math.floor(fraction * 100 + 0.5);
}

/**
 * The accessible name of a region path (A.8): "{Region name}: {pct}% (range
 * {lo}% to {hi}%)" with whole numbers rounded half-up, or "{Region name}:
 * {pct}% (no range yet)". `share` is the apportioned fraction the row figure
 * prints, so the name mirrors the row.
 */
export function regionAccessibleName(displayName: string, share: Share): string {
  const pct = wholePercent(share.point);
  const range = share.range
    ? `range ${wholePercent(share.range.low)}% to ${wholePercent(share.range.high)}%`
    : ANCESTRY_RANGE_UNAVAILABLE;
  return `${displayName}: ${pct}% (${range})`;
}
