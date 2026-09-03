// Builds the ancestry map's region geometry from Natural Earth 1:110m physical
// data — build time only; the app imports none of the packages used here.
//
//   pnpm exec tsx scripts/build-region-geometry.ts [--source <dir>]
//
// Inputs (fetched from the Natural Earth vector repository into
// node_modules/.cache/natural-earth/ unless --source names a directory holding
// them; every read is verified against the SHA-256 pinned below):
//   ne_110m_land.geojson                    the land basemap
//   ne_110m_geography_regions_polys.geojson named physical features, used only
//                                           as masks (continents, a peninsula,
//                                           an isthmus, island groups, a range,
//                                           a plateau, two islands)
// No administrative dataset is read: no country, state or border file is
// fetched or opened (brief §4.6).
//
// Outputs:
//   public/geo/regions.topo.json          objects: `land` (the 110m land outside
//                                         every region) plus one per region code
//   public/geo/GEOMETRY_PROVENANCE.md     sources, hashes, recipes, parameters,
//                                         counts and the projection constants
//   data/ref/regions/regions.json         only `centroid_lon` / `centroid_lat`
//                                         per region (projected bbox centre)
//
// The pipeline is deterministic: running it twice yields byte-identical files.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as clipping from "polygon-clipping";
import { quantize } from "topojson-client";
import { topology } from "topojson-server";
import { filter, filterWeight, planarTriangleArea, presimplify, simplify } from "topojson-simplify";
import {
  LAT_MAX,
  LAT_MIN,
  LON_MAX,
  LON_MIN,
  SCALE_X,
  SCALE_Y,
  STANDARD_PARALLEL_DEG,
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  bboxCentre,
  pathBBox,
  unproject,
} from "../src/lib/geo/project";
import { polygonsOf, type Topology } from "../src/lib/geo/topojson";

type Ring = clipping.Ring;
type Polygon = clipping.Polygon;
type MultiPolygon = clipping.MultiPolygon;

// ---------------------------------------------------------------------------
// Pinned sources
// ---------------------------------------------------------------------------

/** The day the pinned hashes were taken; every later run re-verifies them. */
const RETRIEVED = "2026-09-03";
/** Content of the repository's VERSION file on that day. */
const NATURAL_EARTH_VERSION = "5.2.0-pre";
const REPOSITORY = "https://github.com/nvkelso/natural-earth-vector";
const RAW_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
/** The official download host the naturalearthdata.com links resolve to (same dataset, shapefile zips). */
const S3_BASE = "https://naturalearth.s3.amazonaws.com/110m_physical/";

interface SourceSpec {
  file: string;
  sha256: string;
}

const SOURCES: SourceSpec[] = [
  {
    file: "ne_110m_land.geojson",
    sha256: "9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9",
  },
  {
    file: "ne_110m_geography_regions_polys.geojson",
    sha256: "4182af773bcc891f8ddbf4b34ac02e87f17b35456269695e07258cf0b4877ec9",
  },
];

// ---------------------------------------------------------------------------
// Recipe constants (every one is a mapping decision, recorded in the provenance)
// ---------------------------------------------------------------------------

/** Land polygons lying entirely south of this parallel (Antarctica) are not shipped. */
const ANTARCTICA_CUT_LAT = -60;
/** Africa south of the Sahara: only land south of this parallel through the Sahel. */
const SAHEL_CUT_LAT = 17;
/** East and Southeast Asia: the stated box, west/south/east/north in degrees. */
const EAST_ASIA_BOX = { west: 97, south: 8, east: 146, north: 46 };
/** South Asia: the land polygon whose bbox centre lies within this radius of the point (Sri Lanka). */
const SRI_LANKA = { lon: 80.7, lat: 7.9, radiusDeg: 1 };
/**
 * The named features are drawn at a finer resolution than the 110m land, so
 * their coastlines sit inside or outside the coarse coastline by small
 * offsets. Each mask is first simplified (Visvalingam, degrees²) and then
 * dilated outward by this many degrees (union of nine translated copies), so
 * that it covers the whole 110m coastline near it and only its interior cut
 * lines — the continental divisions — decide where a region ends on land.
 */
const MASK_SIMPLIFY_WEIGHT_DEG2 = 0.0005;
const MASK_DILATION_DEG = 0.4;
/** Polygons smaller than this (degrees²) after clipping are boundary slivers, not land. */
const MIN_POLYGON_AREA_DEG2 = 0.01;
/** Visvalingam threshold (degrees² of the triangle a point spans); 0.0025 deg² ≈ a 0.07° × 0.07° wiggle. */
const MIN_WEIGHT_DEG2 = 0.0025;
/** Snapping grid used only while the topology's shared arcs are identified (100,000 steps ≈ 0.0036°). */
const PRE_QUANTIZATION = 1e5;
/** Output quantization grid across the bounding box (10,000 steps ≈ 0.036° ≈ 0.16 viewBox units). */
const QUANTIZATION = 1e4;
/** brief:2318 — the committed geometry budget. */
const SIZE_BUDGET_BYTES = 180 * 1024;

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "node_modules/.cache/natural-earth");
const REGIONS_PATH = path.join(ROOT, "data/ref/regions/regions.json");
const TOPO_PATH = path.join(ROOT, "public/geo/regions.topo.json");
const PROVENANCE_PATH = path.join(ROOT, "public/geo/GEOMETRY_PROVENANCE.md");

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

interface RegionRow {
  code: string;
  display_name: string;
  sort_order: number;
  geometry_recipe: string;
  centroid_lon: number;
  centroid_lat: number;
}

interface RegionFile {
  regions: RegionRow[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function verified(buffer: Buffer, spec: SourceSpec, origin: string): Buffer {
  const actual = sha256(buffer);
  if (actual !== spec.sha256) {
    throw new Error(
      `${spec.file} from ${origin} has SHA-256 ${actual}, expected ${spec.sha256}. ` +
        "Upstream may have moved; review the new file before re-pinning the hash in this script.",
    );
  }
  return buffer;
}

async function loadSource(spec: SourceSpec, sourceDir: string | null): Promise<Buffer> {
  if (sourceDir) {
    const local = path.join(sourceDir, spec.file);
    return verified(fs.readFileSync(local), spec, local);
  }
  const cached = path.join(CACHE_DIR, spec.file);
  if (fs.existsSync(cached)) {
    const buffer = fs.readFileSync(cached);
    if (sha256(buffer) === spec.sha256) return buffer;
  }
  const url = RAW_BASE + spec.file;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  const buffer = verified(Buffer.from(await response.arrayBuffer()), spec, url);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cached, buffer);
  return buffer;
}

// ---------------------------------------------------------------------------
// Geometry helpers (planar, degrees)
// ---------------------------------------------------------------------------

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

function boxPolygon(box: Box): Polygon {
  const { west, south, east, north } = box;
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ];
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function polygonArea(polygon: Polygon): number {
  const [outer, ...holes] = polygon;
  return Math.abs(ringArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0);
}

function multiPolygonArea(multi: MultiPolygon): number {
  return multi.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

function multiPolygonPoints(multi: MultiPolygon): number {
  return multi.reduce((sum, polygon) => sum + polygon.reduce((s, ring) => s + ring.length, 0), 0);
}

function bboxOf(multi: MultiPolygon): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of multi) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (y < south) south = y;
        if (x > east) east = x;
        if (y > north) north = y;
      }
    }
  }
  return { west, south, east, north };
}

function formatBox(box: Box): string {
  const f = (v: number) => v.toFixed(1);
  return `${f(box.west)}, ${f(box.south)}, ${f(box.east)}, ${f(box.north)}`;
}

function toMultiPolygon(feature: GeoJsonFeature): MultiPolygon {
  const { geometry } = feature;
  const coordinates = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return coordinates as MultiPolygon;
}

interface SliverReport {
  kept: MultiPolygon;
  dropped: number;
}

/** Drop boundary slivers: polygons whose area falls below MIN_POLYGON_AREA_DEG2. */
function withoutSlivers(multi: MultiPolygon): SliverReport {
  const kept = multi.filter((polygon) => polygonArea(polygon) >= MIN_POLYGON_AREA_DEG2);
  return { kept, dropped: multi.length - kept.length };
}

function translate(multi: MultiPolygon, dx: number, dy: number): MultiPolygon {
  return multi.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as clipping.Pair)));
}

/** Visvalingam simplification of a multipolygon's rings through a throwaway topology. */
function simplifyMultiPolygon(multi: MultiPolygon, minWeight: number): MultiPolygon {
  const topo = topology({ m: { type: "MultiPolygon", coordinates: multi } as never });
  const simplified = simplify(presimplify(topo as never, planarTriangleArea), minWeight);
  const filtered = filter(simplified as never, filterWeight(simplified as never));
  return polygonsOf(filtered as unknown as Topology, "m").map((rings) =>
    rings.map((ring) => ring.map(([x, y]) => [x, y] as clipping.Pair)),
  );
}

/** Outward dilation by `delta` degrees: the union of the nine copies shifted by −δ, 0, +δ in x and y. */
function dilate(multi: MultiPolygon, delta: number): MultiPolygon {
  const copies: MultiPolygon[] = [];
  for (const dx of [-delta, 0, delta]) {
    for (const dy of [-delta, 0, delta]) copies.push(translate(multi, dx, dy));
  }
  return clipping.union(copies[0], ...copies.slice(1));
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

interface Mask {
  name: string;
  featurecla: string;
  /** As downloaded. */
  geometry: MultiPolygon;
  /** Simplified only: used where the feature is subtracted so an interior division stays put. */
  exact: MultiPolygon;
  /** Simplified and dilated: used where the feature selects land. */
  dilated: MultiPolygon;
  bbox: Box;
  points: number;
}

function maskLookup(regions: GeoJsonFeatureCollection): (name: string, featurecla: string) => Mask {
  const used = new Map<string, Mask>();
  const lookup = (name: string, featurecla: string): Mask => {
    const key = `${name}|${featurecla}`;
    const existing = used.get(key);
    if (existing) return existing;
    const matches = regions.features.filter(
      (feature) => feature.properties.NAME === name && feature.properties.FEATURECLA === featurecla,
    );
    if (matches.length !== 1) {
      throw new Error(`expected exactly one feature named ${name} (${featurecla}), found ${matches.length}`);
    }
    const geometry = toMultiPolygon(matches[0]);
    const exact = op(`simplify ${name}`, () => simplifyMultiPolygon(geometry, MASK_SIMPLIFY_WEIGHT_DEG2));
    const dilated = op(`dilate ${name}`, () => dilate(exact, MASK_DILATION_DEG));
    const mask = { name, featurecla, geometry, exact, dilated, bbox: bboxOf(geometry), points: multiPolygonPoints(geometry) };
    used.set(key, mask);
    return mask;
  };
  return lookup;
}

// ---------------------------------------------------------------------------
// Recipes (design §2.2)
// ---------------------------------------------------------------------------

function boxesIntersect(a: Box, b: Box): boolean {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

/** Name the failing step when polygon-clipping throws. */
function op<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Apply `fn` to each land polygon whose bounding box meets `extent` and
 * concatenate the results. Land polygons are disjoint, so their clipped
 * pieces are disjoint too and need no union; keeping every clip small also
 * keeps polygon-clipping's ring nesting shallow.
 */
function eachLand(land: MultiPolygon, extent: Box, fn: (polygon: Polygon) => MultiPolygon): MultiPolygon {
  const out: MultiPolygon = [];
  for (const polygon of land) {
    if (!boxesIntersect(bboxOf([polygon]), extent)) continue;
    out.push(...fn(polygon));
  }
  return out;
}

interface RegionMask {
  code: string;
  /** The combined mask M; the region is `land ∩ M` and the outside land is `land − ∪M`. */
  mask: MultiPolygon;
  /**
   * The exact (undilated) forms of the features that select this region. A
   * piece of `land ∩ M` that overlaps none of them lies only in the dilation
   * band — a neighbouring coast across a strait — and is returned to `land`.
   */
  selecting: MultiPolygon;
  masks: Mask[];
  operations: string;
}

interface BuiltRegion extends RegionMask {
  geometry: MultiPolygon;
  /** Pieces of `land ∩ M` that overlap no selecting feature; they belong to `land`. */
  returnedToLand: MultiPolygon;
  sliversDropped: number;
}

/**
 * Each region's mask M is combined from named features (and, for South Asia,
 * one whole land polygon) before any land is touched, so that regions
 * (`land ∩ M`) and the outside land (`land − ∪M`) are cut by the same edges.
 */
function regionMasks(land: MultiPolygon, mask: (name: string, featurecla: string) => Mask): RegionMask[] {
  const out: RegionMask[] = [];
  const asia = mask("ASIA", "Continent");
  const europe = mask("EUROPE", "Continent");
  const africa = mask("AFRICA", "Continent");

  {
    const madagascar = mask("MADAGASCAR", "Island");
    const halfPlane = boxPolygon({ west: LON_MIN, south: -90, east: LON_MAX, north: SAHEL_CUT_LAT });
    out.push({
      code: "africa-south-of-sahara",
      mask: op("africa mask", () =>
        clipping.difference(
          clipping.intersection(clipping.difference(africa.dilated, asia.exact, europe.exact), halfPlane),
          madagascar.dilated,
        ),
      ),
      selecting: africa.exact,
      masks: [africa, madagascar],
      operations: `land ∩ ((AFRICA⁺ − ASIA − EUROPE) ∩ half-plane φ ≤ ${SAHEL_CUT_LAT}°N − MADAGASCAR⁺)`,
    });
  }

  {
    const centralAmerica = mask("CENTRAL AMERICA", "Isthmus");
    const westIndies = mask("WEST INDIES", "Island group");
    const andes = mask("ANDES", "Range/mtn");
    out.push({
      code: "central-america-caribbean-andes",
      mask: op("central america mask", () =>
        clipping.union(centralAmerica.dilated, westIndies.dilated, andes.dilated),
      ),
      selecting: [...centralAmerica.exact, ...westIndies.exact, ...andes.exact],
      masks: [centralAmerica, westIndies, andes],
      operations: "land ∩ (CENTRAL AMERICA⁺ ∪ WEST INDIES⁺ ∪ ANDES⁺); no further clipping",
    });
  }

  {
    const tibet = mask("PLATEAU OF TIBET", "Plateau");
    const japan = mask("JAPAN", "Island group");
    out.push({
      code: "east-and-southeast-asia",
      mask: op("east asia mask", () =>
        clipping.union(
          clipping.difference(clipping.intersection(asia.dilated, boxPolygon(EAST_ASIA_BOX)), tibet.exact),
          japan.dilated,
        ),
      ),
      selecting: [...asia.exact, ...japan.exact],
      masks: [asia, tibet, japan],
      operations:
        `land ∩ (((ASIA⁺ ∩ box [${EAST_ASIA_BOX.west}°E, ${EAST_ASIA_BOX.east}°E] × ` +
        `[${EAST_ASIA_BOX.south}°N, ${EAST_ASIA_BOX.north}°N]) − PLATEAU OF TIBET) ∪ JAPAN⁺)`,
    });
  }

  {
    const iceland = mask("ICELAND", "Island");
    out.push({
      code: "europe",
      mask: op("europe mask", () =>
        clipping.difference(europe.dilated, asia.exact, africa.exact, iceland.dilated),
      ),
      selecting: europe.exact,
      masks: [europe, iceland],
      operations: "land ∩ (EUROPE⁺ − ASIA − AFRICA − ICELAND⁺)",
    });
  }

  {
    const india = mask("INDIA", "Pen/cape");
    const sriLanka = land.filter((polygon) => {
      const box = bboxOf([polygon]);
      const lon = (box.west + box.east) / 2;
      const lat = (box.south + box.north) / 2;
      return Math.hypot(lon - SRI_LANKA.lon, lat - SRI_LANKA.lat) <= SRI_LANKA.radiusDeg;
    });
    if (sriLanka.length !== 1) {
      throw new Error(`expected one land polygon centred near ${SRI_LANKA.lon}°E ${SRI_LANKA.lat}°N, found ${sriLanka.length}`);
    }
    out.push({
      code: "south-asia",
      mask: op("south asia mask", () => clipping.union(india.dilated, sriLanka)),
      selecting: [...india.exact, ...sriLanka],
      masks: [india],
      operations:
        `land ∩ (INDIA⁺ ∪ the land polygon whose bbox centre lies within ${SRI_LANKA.radiusDeg}° of ` +
        `${SRI_LANKA.lon}°E ${SRI_LANKA.lat}°N, taken whole)`,
    });
  }

  return out;
}

/** Does `piece` share any area with one of the `selecting` polygons? */
function overlapsAny(piece: Polygon, selecting: MultiPolygon): boolean {
  const box = bboxOf([piece]);
  for (const polygon of selecting) {
    if (!boxesIntersect(box, bboxOf([polygon]))) continue;
    if (multiPolygonArea(op("overlap", () => clipping.intersection([piece], [polygon]))) > 0) return true;
  }
  return false;
}

function buildRegions(land: MultiPolygon, mask: (name: string, featurecla: string) => Mask): BuiltRegion[] {
  return regionMasks(land, mask).map((region) => {
    const extent = bboxOf(region.mask);
    const { kept, dropped } = withoutSlivers(
      eachLand(land, extent, (polygon) => op(region.code, () => clipping.intersection([polygon], region.mask))),
    );
    const selected = kept.map((piece) => overlapsAny(piece, region.selecting));
    return {
      ...region,
      geometry: kept.filter((_, index) => selected[index]),
      returnedToLand: kept.filter((_, index) => !selected[index]),
      sliversDropped: dropped,
    };
  });
}

/** Planar area of the overlap between two multipolygons, computed polygon by polygon. */
function overlapArea(a: MultiPolygon, b: MultiPolygon): number {
  const boxB = bboxOf(b);
  let area = 0;
  for (const polygon of a) {
    if (!boxesIntersect(bboxOf([polygon]), boxB)) continue;
    area += multiPolygonArea(op("overlap", () => clipping.intersection([polygon], b)));
  }
  return area;
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

function arcPoints(topo: { arcs: number[][][] }): number {
  return topo.arcs.reduce((sum, arc) => sum + arc.length, 0);
}

function decodedPoints(topo: Topology, objectName: string): number {
  return polygonsOf(topo, objectName).reduce(
    (sum, rings) => sum + rings.reduce((s, ring) => s + ring.length, 0),
    0,
  );
}

function decodedPolygons(topo: Topology, objectName: string): number {
  return polygonsOf(topo, objectName).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ObjectReport {
  name: string;
  polygonsIn: number;
  pointsIn: number;
  polygonsOut: number;
  pointsOut: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf("--source");
  const sourceDir = sourceFlag === -1 ? null : path.resolve(args[sourceFlag + 1] ?? "");
  if (sourceFlag !== -1 && !sourceDir) throw new Error("--source needs a directory");

  const buffers = await Promise.all(SOURCES.map((spec) => loadSource(spec, sourceDir)));
  const [landFile, regionsFile] = buffers.map(
    (buffer) => JSON.parse(buffer.toString("utf8")) as GeoJsonFeatureCollection,
  );

  // Land basemap: every 110m land polygon except Antarctica.
  const landAll = landFile.features.map(toMultiPolygon).flat();
  const land = landAll.filter((polygon) => bboxOf([polygon]).north >= ANTARCTICA_CUT_LAT);
  const antarcticaDropped = landAll.length - land.length;
  const landPointsIn = multiPolygonPoints(landAll);

  const regionFile = JSON.parse(fs.readFileSync(REGIONS_PATH, "utf8")) as RegionFile;
  const rows = [...regionFile.regions].sort((a, b) => a.sort_order - b.sort_order);

  const mask = maskLookup(regionsFile);
  const builtByCode = new Map(buildRegions(land, mask).map((region) => [region.code, region]));
  const built = rows.map((row) => {
    const region = builtByCode.get(row.code);
    if (!region) throw new Error(`no geometry recipe for region ${row.code}`);
    return region;
  });
  const missingRecipe = [...builtByCode.keys()].filter((code) => !rows.some((row) => row.code === code));
  if (missingRecipe.length) throw new Error(`recipes without a regions.json row: ${missingRecipe.join(", ")}`);

  // Regions must be non-empty and pairwise disjoint.
  for (const region of built) {
    if (region.geometry.length === 0) throw new Error(`${region.code} has no polygons`);
  }
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const overlap = overlapArea(built[i].geometry, built[j].geometry);
      if (overlap > 1e-9) {
        throw new Error(`${built[i].code} and ${built[j].code} overlap by ${overlap} deg²`);
      }
    }
  }

  // Land outside every region (land − ∪M, cut by the same mask edges as the
  // regions), so the six objects tile without overlap.
  const maskBoxes = built.map((region) => bboxOf(region.mask));
  const landOutside = withoutSlivers(
    eachLand(land, bboxOf(land), (polygon) => {
      const box = bboxOf([polygon]);
      const clips = built.filter((_, index) => boxesIntersect(box, maskBoxes[index])).map((r) => r.mask);
      return clips.length === 0 ? [polygon] : op("land", () => clipping.difference([polygon], ...clips));
    }),
  );

  const landCoordinates = [...landOutside.kept, ...built.flatMap((region) => region.returnedToLand)];
  const objects: Record<string, { type: "MultiPolygon"; coordinates: MultiPolygon }> = {
    land: { type: "MultiPolygon", coordinates: landCoordinates },
  };
  for (const region of built) objects[region.code] = { type: "MultiPolygon", coordinates: region.geometry };

  const inputPoints = Object.values(objects).reduce((sum, o) => sum + multiPolygonPoints(o.coordinates), 0);

  // Topology: snap at construction so shared boundaries become common arcs;
  // presimplify de-quantizes and weights every point (degrees²); simplify drops
  // the light ones; filter removes rings that lost their area; quantize
  // delta-encodes the result on the output grid.
  const raw = topology(objects as unknown as Parameters<typeof topology>[0], PRE_QUANTIZATION);
  const arcsBefore = raw.arcs.length;
  const pointsBefore = arcPoints(raw);
  const simplified = simplify(presimplify(raw as never, planarTriangleArea), MIN_WEIGHT_DEG2);
  const filtered = filter(simplified as never, filterWeight(simplified as never));
  const finalTopology = quantize(filtered, QUANTIZATION) as unknown as Topology;
  const arcsAfter = finalTopology.arcs.length;
  const pointsAfter = arcPoints(finalTopology);

  const objectNames = Object.keys(finalTopology.objects);
  const expectedNames = ["land", ...built.map((region) => region.code)];
  if (JSON.stringify(objectNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`objects are ${objectNames.join(", ")}; expected ${expectedNames.join(", ")}`);
  }

  const json = `${JSON.stringify(finalTopology)}\n`;
  const bytes = Buffer.byteLength(json);

  // Label anchors: centre of each region's projected bounding box, back to degrees.
  const centroids = new Map<string, [number, number]>();
  for (const region of built) {
    const bbox = pathBBox(polygonsOf(finalTopology, region.code));
    if (!bbox) throw new Error(`${region.code} has no projected extent`);
    const [x, y] = bboxCentre(bbox);
    const [lon, lat] = unproject(x, y);
    centroids.set(region.code, [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
  }
  for (const row of regionFile.regions) {
    const centroid = centroids.get(row.code);
    if (!centroid) throw new Error(`no centroid for ${row.code}`);
    [row.centroid_lon, row.centroid_lat] = centroid;
  }

  const reports: ObjectReport[] = [
    {
      name: "land",
      polygonsIn: landCoordinates.length,
      pointsIn: multiPolygonPoints(landCoordinates),
      polygonsOut: decodedPolygons(finalTopology, "land"),
      pointsOut: decodedPoints(finalTopology, "land"),
    },
    ...built.map((region) => ({
      name: region.code,
      polygonsIn: region.geometry.length,
      pointsIn: multiPolygonPoints(region.geometry),
      polygonsOut: decodedPolygons(finalTopology, region.code),
      pointsOut: decodedPoints(finalTopology, region.code),
    })),
  ];

  const masksUsed = [...new Map(built.flatMap((r) => r.masks).map((m) => [`${m.name}|${m.featurecla}`, m])).values()];

  const provenance = provenanceMarkdown({
    sources: SOURCES.map((spec, index) => ({ ...spec, bytes: buffers[index].length })),
    landPolygons: landAll.length,
    landPointsIn,
    antarcticaDropped,
    masksUsed,
    built,
    rows,
    landSliversDropped: landOutside.dropped,
    inputPoints,
    arcsBefore,
    pointsBefore,
    arcsAfter,
    pointsAfter,
    reports,
    bytes,
    centroids,
  });

  for (const report of reports) {
    console.log(`  ${report.name}: ${report.polygonsOut} polygons, ${report.pointsOut} points (from ${report.pointsIn})`);
  }
  console.log(`  topology: ${arcsBefore} arcs / ${pointsBefore} points before simplification, ${arcsAfter} arcs / ${pointsAfter} points after`);
  if (bytes > SIZE_BUDGET_BYTES) {
    throw new Error(`regions.topo.json would be ${bytes} bytes, over the ${SIZE_BUDGET_BYTES}-byte budget; nothing written`);
  }

  fs.mkdirSync(path.dirname(TOPO_PATH), { recursive: true });
  fs.writeFileSync(TOPO_PATH, json);
  fs.writeFileSync(PROVENANCE_PATH, provenance);
  fs.writeFileSync(REGIONS_PATH, `${JSON.stringify(regionFile, null, 2)}\n`);

  console.log(`wrote ${path.relative(ROOT, TOPO_PATH)} (${bytes} bytes, ${arcsAfter} arcs, ${pointsAfter} points; ${pointsBefore} before simplification)`);
  console.log(`wrote ${path.relative(ROOT, PROVENANCE_PATH)}`);
  console.log(`updated centroids in ${path.relative(ROOT, REGIONS_PATH)}`);
}

// ---------------------------------------------------------------------------
// Provenance document
// ---------------------------------------------------------------------------

interface ProvenanceInput {
  sources: Array<SourceSpec & { bytes: number }>;
  landPolygons: number;
  landPointsIn: number;
  antarcticaDropped: number;
  masksUsed: Mask[];
  built: BuiltRegion[];
  rows: RegionRow[];
  landSliversDropped: number;
  inputPoints: number;
  arcsBefore: number;
  pointsBefore: number;
  arcsAfter: number;
  pointsAfter: number;
  reports: ObjectReport[];
  bytes: number;
  centroids: Map<string, [number, number]>;
}

function provenanceMarkdown(input: ProvenanceInput): string {
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);

  push(
    "# Region geometry provenance (`regions.topo.json`)",
    "",
    "Generated by `scripts/build-region-geometry.ts`; do not edit by hand. Every",
    "number below was measured by the run that wrote the file beside this one.",
    "",
    "## Source",
    "",
    `Natural Earth 1:110m physical vectors, version \`${NATURAL_EARTH_VERSION}\` (the repository's`,
    `\`VERSION\` file), public domain (Natural Earth terms of use; see`,
    "`docs/dataset-licenses.md`). Two files were read, as GeoJSON from the official",
    `vector repository (${REPOSITORY}, branch \`master\`), retrieved ${RETRIEVED}.`,
    "The same dataset is served as shapefile zips from the official download",
    `host, ${S3_BASE} (\`ne_110m_land.zip\`, \`ne_110m_geography_regions_polys.zip\`).`,
    "The build verifies each file's SHA-256 against the value pinned in the script",
    "on every run and refuses to build from anything else.",
    "",
    "| File | URL | Bytes | SHA-256 |",
    "| --- | --- | --- | --- |",
  );
  for (const source of input.sources) {
    push(`| \`${source.file}\` | ${RAW_BASE}${source.file} | ${source.bytes.toLocaleString("en-GB")} | \`${source.sha256}\` |`);
  }
  push(
    "",
    "**No administrative dataset was read.** The build opens no country, state,",
    "province or border file; the only inputs are the physical land layer and the",
    "named physical features listed below, used as masks.",
    "",
    "## Basemap",
    "",
    `\`ne_110m_land\`: ${input.landPolygons} polygons, ${input.landPointsIn.toLocaleString("en-GB")} points. The`,
    `${input.antarcticaDropped} polygon(s) lying entirely south of ${Math.abs(ANTARCTICA_CUT_LAT)}°S (Antarctica) are not shipped;`,
    `the projection clamps latitude to [${LAT_MIN}°, ${LAT_MAX}°] and draws nothing below Cape Horn.`,
    "",
    "## Masks (named physical features)",
    "",
    "Bounding boxes measured from the downloaded file: west, south, east, north in degrees.",
    "",
    "| Feature | Class | Points | Bounding box |",
    "| --- | --- | --- | --- |",
  );
  for (const mask of input.masksUsed) {
    push(`| ${mask.name} | ${mask.featurecla} | ${mask.points.toLocaleString("en-GB")} | ${formatBox(mask.bbox)} |`);
  }
  push(
    "",
    "## Recipes",
    "",
    "Each region is a subset of the 110m land polygons (`land ∩ mask`), so region",
    "outlines coincide with the coastline they are drawn over and share arcs with",
    "it. The parallels and the box are stated cuts, not natural or political",
    "edges; `data/ref/regions/PROVENANCE.md` records why each was chosen. After",
    `clipping, polygons smaller than ${MIN_POLYGON_AREA_DEG2} deg² (boundary slivers) are dropped.`,
    "",
    "",
    "Mask preparation: the named features are drawn at a finer resolution than",
    "the 110m land, so their coastlines sit a little inside or outside the coarse",
    `coastline. Each feature is simplified (Visvalingam, ${MASK_SIMPLIFY_WEIGHT_DEG2} deg²) and, where it`,
    `*selects* land (marked ⁺ below), dilated outward by ${MASK_DILATION_DEG}° — the union of nine copies`,
    "shifted by −δ, 0, +δ in longitude and latitude — so that it covers the whole",
    "coastline near it and only its interior edge decides where a region ends.",
    "Where a feature is *subtracted* to keep a continental division in place",
    "(ASIA and AFRICA from Europe, ASIA and EUROPE from Africa, PLATEAU OF TIBET",
    "from East and Southeast Asia) it is used simplified but not dilated, so the",
    "Urals/Caucasus line, the Suez line and the plateau's edge are Natural",
    "Earth's own. Interior edges of dilated features (the Andes' eastern foot,",
    "the isthmus's ends, the peninsula's northern edge) therefore sit up to",
    `${MASK_DILATION_DEG}° outside the named feature.`,
    "",
    "A piece of `land ∩ M` that overlaps none of the region's selecting features",
    "in their exact form lies only in the dilation band (a neighbouring coast",
    "across a strait) and is returned to `land`.",
    "",
    "| Region | Operations | Masks | Polygons | Slivers dropped | Pieces returned to land |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const region of input.built) {
    const masks = region.masks.map((mask) => `${mask.name} (${mask.featurecla})`).join(", ");
    push(
      `| \`${region.code}\` | ${region.operations} | ${masks} | ${region.geometry.length} | ${region.sliversDropped} | ${region.returnedToLand.length} |`,
    );
  }
  push(
    "",
    "Recipe text as recorded in `data/ref/regions/regions.json`:",
    "",
  );
  for (const row of input.rows) push(`- \`${row.code}\` — ${row.geometry_recipe}`);
  push(
    "",
    "`land` is the 110m land outside every region (`land − ∪ masks`, cut by the",
    `same mask edges as the regions, then ${input.landSliversDropped} sliver(s) dropped, plus the pieces`,
    "returned above), so the six objects tile the map without overlap; the build",
    "fails if any two regions overlap.",
    "",
    "## Simplification and quantization",
    "",
    `- \`topojson-server\` \`topology(objects, ${PRE_QUANTIZATION.toLocaleString("en-GB")})\`: shared boundaries`,
    `  are identified on a ${PRE_QUANTIZATION.toLocaleString("en-GB")}-step snapping grid and stored once as arcs.`,
    `- \`topojson-simplify\` \`presimplify(planarTriangleArea)\` then \`simplify(${MIN_WEIGHT_DEG2})\`:`,
    `  Visvalingam–Whyatt in degrees, dropping points whose effective triangle is below ${MIN_WEIGHT_DEG2} deg².`,
    "- `filter(filterWeight)`: rings that lost their area are removed.",
    `- \`topojson-client\` \`quantize(topology, ${QUANTIZATION.toLocaleString("en-GB")})\`: ${QUANTIZATION.toLocaleString("en-GB")} steps across the`,
    "  bounding box (≈ 0.036°, ≈ 0.16 viewBox units), delta-encoded integer arcs.",
    "",
    "| Stage | Arcs | Arc points |",
    "| --- | --- | --- |",
    `| Input polygons (GeoJSON, before topology) | — | ${input.inputPoints.toLocaleString("en-GB")} |`,
    `| Topology, quantized, before simplification | ${input.arcsBefore.toLocaleString("en-GB")} | ${input.pointsBefore.toLocaleString("en-GB")} |`,
    `| After simplification and filtering (shipped) | ${input.arcsAfter.toLocaleString("en-GB")} | ${input.pointsAfter.toLocaleString("en-GB")} |`,
    "",
    "Per object (points counted on the decoded rings, closing point included):",
    "",
    "| Object | Polygons in | Points in | Polygons shipped | Points shipped |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const report of input.reports) {
    push(
      `| \`${report.name}\` | ${report.polygonsIn} | ${report.pointsIn.toLocaleString("en-GB")} | ${report.polygonsOut} | ${report.pointsOut.toLocaleString("en-GB")} |`,
    );
  }
  push(
    "",
    `Output: \`public/geo/regions.topo.json\`, ${input.bytes.toLocaleString("en-GB")} bytes (budget ${SIZE_BUDGET_BYTES.toLocaleString("en-GB")}).`,
    "",
    "## Projection (`src/lib/geo/project.ts`)",
    "",
    `Equirectangular into a ${VIEWBOX_WIDTH} × ${VIEWBOX_HEIGHT} viewBox: x = (λ + ${-LON_MIN}) × ${SCALE_X.toFixed(4)},`,
    `y = (${LAT_MAX} − φ) × ${SCALE_Y.toFixed(4)}, φ clamped to [${LAT_MIN}°, ${LAT_MAX}°]. The y/x scale ratio`,
    `${(SCALE_Y / SCALE_X).toFixed(4)} makes the standard parallel ≈ ${STANDARD_PARALLEL_DEG.toFixed(1)}°. Label anchors`,
    "(`centroid_lon` / `centroid_lat` in `regions.json`) are the centre of each region's",
    "projected bounding box, mapped back to degrees and rounded to 0.01°:",
    "",
    "| Region | Anchor (lon, lat) |",
    "| --- | --- |",
  );
  for (const row of input.rows) {
    const [lon, lat] = input.centroids.get(row.code) ?? [0, 0];
    push(`| \`${row.code}\` | ${lon.toFixed(2)}, ${lat.toFixed(2)} |`);
  }
  push(
    "",
    "## Regeneration",
    "",
    "```",
    "pnpm exec tsx scripts/build-region-geometry.ts",
    "```",
    "",
    "Fetches the two files into `node_modules/.cache/natural-earth/` when they are",
    "not cached, verifies the pinned hashes, and rewrites this document, the",
    "TopoJSON and the two centroid fields per region in `regions.json`. Pass",
    "`--source <dir>` to read previously downloaded copies (still hash-verified).",
    "The output is byte-identical across runs.",
    "",
  );
  return lines.join("\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
