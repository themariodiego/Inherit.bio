/**
 * Pure equirectangular projection into the ancestry map's 16:9 viewBox
 * (brief §4.6, A.8: equirectangular, no tiles, no geocoder) and the SVG path
 * builder that turns projected polygons into `d` strings.
 *
 * x = (λ + 180) · 1600 / 360,  y = (84 − φ) · 900 / 140  with φ clamped to
 * [−56°, 84°]. The y/x scale ratio (≈ 1.446) makes this an equirectangular
 * projection with a standard parallel of ≈ 46.2° N/S, which fills the frame
 * without letterboxing. Antarctica is absent from the geometry file, so
 * nothing is drawn below Cape Horn; anything north of 84° collapses onto the
 * top edge.
 */
import type { PolygonRings, Position } from "./topojson";

export const VIEWBOX_WIDTH = 1600;
export const VIEWBOX_HEIGHT = 900;
export const VIEWBOX = `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;

export const LON_MIN = -180;
export const LON_MAX = 180;
export const LAT_MIN = -56;
export const LAT_MAX = 84;

/** viewBox units per degree of longitude / latitude. */
export const SCALE_X = VIEWBOX_WIDTH / (LON_MAX - LON_MIN);
export const SCALE_Y = VIEWBOX_HEIGHT / (LAT_MAX - LAT_MIN);

/** The parallel at which the projection is conformal: cos φ₁ = SCALE_X / SCALE_Y. */
export const STANDARD_PARALLEL_DEG = (Math.acos(SCALE_X / SCALE_Y) * 180) / Math.PI;

export type Point = [number, number];

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clampLat(lat: number): number {
  return Math.min(LAT_MAX, Math.max(LAT_MIN, lat));
}

/** Longitude/latitude in degrees to viewBox coordinates. */
export function project(lon: number, lat: number): Point {
  return [(lon - LON_MIN) * SCALE_X, (LAT_MAX - clampLat(lat)) * SCALE_Y];
}

/** viewBox coordinates back to longitude/latitude in degrees (inverse of `project` inside the frame). */
export function unproject(x: number, y: number): Point {
  return [x / SCALE_X + LON_MIN, LAT_MAX - y / SCALE_Y];
}

/** One decimal place: sub-pixel in a 1600-unit frame and compact in the RSC payload. */
function coordinate(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function projectRing(ring: Position[]): Point[] {
  return ring.map(([lon, lat]) => project(lon, lat));
}

/**
 * The SVG `d` for a set of polygons: each ring is one `M … L … Z` subpath.
 * Rings are rendered as given (the file's winding); use `fill-rule="evenodd"`
 * so holes stay holes.
 */
export function pathData(polygons: PolygonRings[]): string {
  const subpaths: string[] = [];
  for (const rings of polygons) {
    for (const ring of rings) {
      const points = projectRing(ring);
      if (points.length === 0) continue;
      const [first, ...rest] = points;
      let d = `M${coordinate(first[0])} ${coordinate(first[1])}`;
      for (const [x, y] of rest) d += `L${coordinate(x)} ${coordinate(y)}`;
      subpaths.push(`${d}Z`);
    }
  }
  return subpaths.join("");
}

/** Projected bounding box of a set of polygons, or null when they have no points. */
export function pathBBox(polygons: PolygonRings[]): BBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of projectRing(ring)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

export function bboxCentre(bbox: BBox): Point {
  return [(bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2];
}
