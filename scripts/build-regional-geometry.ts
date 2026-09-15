/** Build the seven-region locator separately from the frozen five-region geometry.
 * corepack pnpm exec tsx scripts/build-regional-geometry.ts [--source directory]
 * Only pinned Natural Earth physical inputs are read. See REGIONAL_GEOMETRY_PROVENANCE.md.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as clipping from "polygon-clipping";
import { feature, quantize } from "topojson-client";
import { topology } from "topojson-server";
import { filter, filterWeight, planarTriangleArea, presimplify, simplify } from "topojson-simplify";
import type { Geometry, GeoJsonProperties, FeatureCollection, MultiPolygon } from "geojson";
import { REGIONAL_REGIONS } from "../src/lib/ancestry/regional-regions";
import { polygonsOf, type Topology } from "../src/lib/geo/topojson";

const ROOT = process.cwd();
const arg = process.argv.indexOf("--source");
const SOURCE = arg < 0 ? path.join(ROOT, "node_modules/.cache/natural-earth") : process.argv[arg + 1];
if (!SOURCE) throw new Error("--source requires a directory");
const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const SOURCES = [
  { file: "ne_110m_land.geojson", sha256: "9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9" },
  { file: "ne_110m_geography_regions_polys.geojson", sha256: "4182af773bcc891f8ddbf4b34ac02e87f17b35456269695e07258cf0b4877ec9" },
] as const;
const hash = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
async function source(spec: typeof SOURCES[number]): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
  const file = path.join(SOURCE, spec.file);
  if (!fs.existsSync(file)) {
    const response = await fetch(BASE + spec.file);
    if (!response.ok) throw new Error(`Natural Earth input failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== spec.sha256) throw new Error(`Natural Earth hash mismatch: ${spec.file}`);
    fs.mkdirSync(SOURCE, { recursive: true }); fs.writeFileSync(file, bytes);
  }
  const bytes = fs.readFileSync(file);
  if (hash(bytes) !== spec.sha256) throw new Error(`Natural Earth hash mismatch: ${spec.file}`);
  return JSON.parse(bytes.toString("utf8"));
}
type Polys = clipping.MultiPolygon;
function polygons(geometry: Geometry | null): Polys {
  if (geometry?.type === "Polygon") return [geometry.coordinates] as Polys;
  if (geometry?.type === "MultiPolygon") return geometry.coordinates as Polys;
  throw new Error("Expected polygonal physical geometry");
}
const geo = (coordinates: Polys): MultiPolygon => ({ type: "MultiPolygon", coordinates });
function box(west: number, south: number, east: number, north: number): Polys {
  return [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
}
function ringArea(ring: clipping.Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]; area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area / 2);
}
function meaningful(polys: Polys): Polys {
  return polys.filter(polygon => ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0) >= 0.01);
}
async function main() {
  const [landSource, physical] = await Promise.all(SOURCES.map(source));
  const land = landSource.features.flatMap(item => polygons(item.geometry))
    .filter(polygon => polygon.flat().some(point => point[1] > -60));
  function mask(name: string): Polys {
    const items = physical.features.filter(item => item.properties?.NAME === name);
    if (items.length !== 1) throw new Error(`Expected exactly one physical feature: ${name}`);
    const raw = topology({ mask: geo(polygons(items[0].geometry)) });
    const simplified = simplify(presimplify(raw as never, planarTriangleArea), 0.0005);
    const reduced = filter(simplified, filterWeight(simplified));
    const decoded = feature(reduced, reduced.objects.mask);
    if (decoded.type !== "Feature") throw new Error("Expected a physical feature");
    const exact = polygons(decoded.geometry);
    const shifted: Polys[] = [];
    for (const dx of [-0.4, 0, 0.4]) for (const dy of [-0.4, 0, 0.4]) {
      shifted.push(exact.map(polygon => polygon.map(ring => ring.map(([x, y]) => [x + dx, y + dy]))));
    }
    return clipping.union(shifted[0], ...shifted.slice(1));
  }
  const africa = mask("AFRICA"), asia = mask("ASIA"), europe = mask("EUROPE");
  const masks: Record<string, Polys> = {
    AFR: clipping.intersection(africa, box(-180, -60, 180, 17)),
    AMR: clipping.union(mask("NORTH AMERICA"), mask("SOUTH AMERICA"), mask("CENTRAL AMERICA")),
    CSA: clipping.intersection(asia, box(55, 0, 97, 50)),
    EAS: clipping.intersection(asia, box(97, -60, 180, 84)),
    EUR: europe,
    MID: clipping.union(clipping.intersection(africa, box(-180, 17, 180, 84)),
      clipping.intersection(asia, box(-180, -60, 55, 42))),
    OCE: clipping.difference(clipping.intersection(mask("MELANESIA"), box(129, -11, 157, 0)), mask("AUSTRALIA")),
  };
  // Explicit precedence resolves continent-mask overlap; every output region is disjoint.
  const priority = ["OCE", "AMR", "EUR", "MID", "CSA", "EAS", "AFR"];
  const disjointMasks = Object.fromEntries(priority.map((code, index) => [code,
    index === 0 ? masks[code] : clipping.difference(masks[code], ...priority.slice(0, index).map(prior => masks[prior]))]));
  const regions: Record<string, Polys> = Object.fromEntries(priority.map(code => [code, []]));
  const outside: Polys = [];
  for (const polygon of land) {
    const intersectingMasks: Polys[] = [];
    for (const code of priority) {
      let clipped: Polys;
      try { clipped = clipping.intersection([polygon], disjointMasks[code]); }
      catch (error) { throw new Error(`${code} land intersection: ${String(error)}`); }
      if (clipped.length) { regions[code].push(...meaningful(clipped)); intersectingMasks.push(disjointMasks[code]); }
    }
    // Subtract the original masks, not derived rings that duplicate rounded coast edges.
    outside.push(...(intersectingMasks.length ? clipping.difference([polygon], ...intersectingMasks) : [polygon]));
  }
  for (const code of priority) if (!regions[code].length) throw new Error(`Empty region ${code}`);
  const objects: Record<string, MultiPolygon> = { land: geo(outside) };
  for (const { code } of REGIONAL_REGIONS) objects[code] = geo(regions[code]);
  const built = topology(objects, 100_000);
  const simplified = simplify(presimplify(built as never, planarTriangleArea), 0.0025);
  const quantized = quantize(filter(simplified, filterWeight(simplified)), 10_000);
  // Simplification can cross a tiny corner even when input masks are disjoint.
  // Repair on the final grid, preserving newly cut vertices without resnapping.
  const grid = { ...quantized, transform: { scale: [1, 1], translate: [0, 0] } } as unknown as Topology;
  const repaired: Record<string, MultiPolygon> = {};
  const accepted: Polys[] = [];
  for (const code of [...priority, "land"]) {
    const original: Polys = polygonsOf(grid, code).map(polygon => polygon.map(ring =>
      ring.map((point): clipping.Pair => {
        if (point.length !== 2 || point.some(value => !Number.isFinite(value))) {
          throw new Error(`Invalid two-dimensional region coordinate: ${code}`);
        }
        return [point[0], point[1]];
      })));
    const disjoint = accepted.length ? clipping.difference(original, ...accepted) : original;
    repaired[code] = geo(disjoint); accepted.push(disjoint);
  }
  const ordered = Object.fromEntries(Object.keys(objects).map(code => [code, repaired[code]]));
  const repairedTopology = topology(ordered);
  const arcs = repairedTopology.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(point => { const delta = [point[0] - x, point[1] - y]; [x, y] = point; return delta; });
  });
  const output = { ...repairedTopology, bbox: quantized.bbox, transform: quantized.transform, arcs };
  const bytes = JSON.stringify(output) + "\n";
  if (Buffer.byteLength(bytes) > 180 * 1024) throw new Error("Regional map exceeds 180 KiB geometry budget");
  const outputPath = path.join(ROOT, "public/geo/regions-v3.topo.json");
  fs.writeFileSync(outputPath, bytes);
  const manifest = { version: "hgdp-tgp-regions-v1", referenceVersion: "hgdp-1kg-v3.1.2-cap30-168-v1",
    sources: SOURCES.map(spec => ({ ...spec, url: BASE + spec.file })),
    output: "public/geo/regions-v3.topo.json", outputSha256: hash(bytes), bytes: Buffer.byteLength(bytes),
    objects: Object.keys(objects), priority, cuts: { africaLatitude: 17, middleEastEast: 55, middleEastNorth: 42,
      centralSouthAsia: [55, 0, 97, 50], eastAsiaWest: 97, westernMelanesia: [129, -11, 157, 0] },
    parameters: { maskSimplificationDeg2: 0.0005, maskDilationDeg: 0.4, minimumPolygonAreaDeg2: 0.01,
      topologySimplificationDeg2: 0.0025, preQuantization: 100_000, quantization: 10_000,
      boundaryRepair: "subtract overlaps on the output grid without resnapping new vertices" },
  };
  fs.writeFileSync(path.join(ROOT, "public/geo/regions-v3.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ output: manifest.output, bytes: manifest.bytes, sha256: manifest.outputSha256 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
