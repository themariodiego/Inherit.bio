import fs from "node:fs";
import { createHash } from "node:crypto";
import * as clipping from "polygon-clipping";
import { describe, expect, it } from "vitest";
import committed from "../../../public/geo/regions-v3.topo.json";
import manifest from "../../../public/geo/regions-v3.manifest.json";
import reference from "../../../data/ref/aims-seven-region-manifest.json";
import { polygonsOf, type Topology } from "@/lib/geo/topojson";
import { REGIONAL_REGIONS, REGIONAL_REGION_RELEASE } from "./regional-regions";
import { regionalMapShapes } from "./regional-geometry";

const topology = committed as unknown as Topology;
function clippingPolygons(code: string): clipping.MultiPolygon {
  return polygonsOf(topology, code).map(polygon => polygon.map(ring => ring.map(position => {
    expect(position).toHaveLength(2);
    return [position[0], position[1]];
  })));
}
function area(polygons: clipping.MultiPolygon): number {
  return polygons.reduce((sum, polygon) => sum + polygon.reduce((whole, ring, index) => {
    let twice = 0;
    for (let i = 0; i < ring.length - 1; i++) twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return whole + Math.abs(twice / 2) * (index === 0 ? 1 : -1);
  }, 0), 0);
}
describe("separately versioned seven-region locator", () => {
  it("matches its immutable manifest, reference and threshold registry within the geometry budget", () => {
    const bytes = fs.readFileSync("public/geo/regions-v3.topo.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.outputSha256);
    expect(bytes.length).toBe(manifest.bytes); expect(bytes.length).toBeLessThanOrEqual(180 * 1024);
    expect(manifest.referenceVersion).toBe(reference.referenceVersion);
    expect(REGIONAL_REGION_RELEASE.panel.manifest).toBe("data/ref/aims-seven-region-manifest.json");
    expect(REGIONAL_REGION_RELEASE.panel.minimum_markers).toBe(reference.markerCount);
    for (const region of REGIONAL_REGION_RELEASE.regions) expect(region.min_markers).toBe(reference.markerCount);
    expect(Object.keys(topology.objects)).toEqual(["land", ...REGIONAL_REGIONS.map(region => region.code)]);
  });
  it("has nonempty closed physical polygons and finite projected paths", () => {
    for (const code of Object.keys(topology.objects)) {
      expect(topology.objects[code].properties).toBeUndefined();
      for (const polygon of polygonsOf(topology, code)) for (const ring of polygon) {
        expect(ring.length).toBeGreaterThanOrEqual(4); expect(ring[0]).toEqual(ring.at(-1));
        for (const [lon, lat] of ring) { expect(lon).toBeGreaterThanOrEqual(-180); expect(lon).toBeLessThanOrEqual(180);
          expect(lat).toBeGreaterThanOrEqual(-60); expect(lat).toBeLessThanOrEqual(84); }
      }
    }
    for (const shape of regionalMapShapes().regions) {
      expect(shape.d).toMatch(/^M/); expect(shape.d).not.toMatch(/NaN|Infinity/);
      expect(shape.bbox.x1).toBeGreaterThan(shape.bbox.x0); expect(shape.bbox.y1).toBeGreaterThan(shape.bbox.y0);
    }
  });
  it("keeps all seven reported regions and remaining land disjoint, including shared EUR/MID/CSA edges", () => {
    const codes = ["land", ...REGIONAL_REGIONS.map(region => region.code)];
    for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i], b = codes[j];
      const overlap = clipping.intersection(clippingPolygons(a), clippingPolygons(b));
      expect(area(overlap), `${a}/${b} overlapping area`).toBeLessThanOrEqual(1e-9);
    }
  });
  it("limits Oceania to western Melanesia and includes North African land in MID", () => {
    const oce = polygonsOf(topology, "OCE").flat(2);
    for (const [lon, lat] of oce) { expect(lon).toBeGreaterThanOrEqual(128.96); expect(lon).toBeLessThanOrEqual(157.04);
      expect(lat).toBeGreaterThanOrEqual(-11.04); expect(lat).toBeLessThanOrEqual(0.04); }
    // A generous interior box in the Sahara is physical land, not a sampled location.
    const sahara: clipping.MultiPolygon = [[[[0, 25], [5, 25], [5, 30], [0, 30], [0, 25]]]];
    expect(area(clipping.intersection(clippingPolygons("MID"), sahara))).toBeGreaterThan(20);
    // The western Melanesian box also reaches the tip of Cape York; exclude Australia explicitly.
    const capeYork: clipping.MultiPolygon = [[[[142, -11], [143.2, -11], [143.2, -10], [142, -10], [142, -11]]]];
    expect(area(clipping.intersection(clippingPolygons("OCE"), capeYork))).toBeLessThanOrEqual(1e-9);
  });
});
