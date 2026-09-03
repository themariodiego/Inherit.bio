import fs from "node:fs";
import path from "node:path";
import * as topojsonClient from "topojson-client";
import type { Topology as SpecTopology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import committed from "../../../public/geo/regions.topo.json";
import { REGIONS } from "@/lib/ancestry/regions";
import { feature, polygonsOf, type Topology } from "./topojson";

const FILE = path.join(process.cwd(), "public/geo/regions.topo.json");
const topology = committed as unknown as Topology;
const objectNames = Object.keys(topology.objects);

describe("public/geo/regions.topo.json", () => {
  it("is at or under the 180 KB budget (brief:2318)", () => {
    expect(fs.statSync(FILE).size).toBeLessThanOrEqual(180 * 1024);
  });

  it("holds exactly `land` plus the five region objects, named as regions.json names them", () => {
    const codes = REGIONS.map((region) => region.code);
    expect(codes).toHaveLength(5);
    expect([...objectNames].sort()).toEqual(["land", ...codes].sort());
  });

  it("is quantized: a transform and integer delta-encoded arcs", () => {
    expect(topology.transform?.scale).toHaveLength(2);
    expect(topology.transform?.translate).toHaveLength(2);
    expect(topology.arcs.length).toBeGreaterThan(0);
    for (const arc of topology.arcs) {
      expect(arc.length).toBeGreaterThanOrEqual(2);
      for (const point of arc) {
        expect(point).toHaveLength(2);
        expect(Number.isInteger(point[0]) && Number.isInteger(point[1])).toBe(true);
      }
    }
  });

  it("only uses MultiPolygon objects with no per-object properties", () => {
    for (const name of objectNames) {
      const object = topology.objects[name];
      expect(object.type).toBe("MultiPolygon");
      expect(object.properties).toBeUndefined();
    }
  });
});

describe("feature()", () => {
  it("equals topojson-client's feature() for every object in the committed file", () => {
    for (const name of objectNames) {
      const expected = topojsonClient.feature(topology as unknown as SpecTopology, name);
      expect(feature(topology, name), name).toEqual(expected);
    }
  });

  it("decodes closed rings of at least four positions inside the world", () => {
    for (const name of objectNames) {
      const polygons = polygonsOf(topology, name);
      expect(polygons.length, name).toBeGreaterThan(0);
      for (const rings of polygons) {
        for (const ring of rings) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          for (const [lon, lat] of ring) {
            expect(lon).toBeGreaterThanOrEqual(-180);
            expect(lon).toBeLessThanOrEqual(180);
            expect(lat).toBeGreaterThanOrEqual(-60);
            expect(lat).toBeLessThanOrEqual(84);
          }
        }
      }
    }
  });

  it("resolves reversed arc references, shared arcs and the transform on a hand-built topology", () => {
    // Two squares sharing one edge: arc 0 is the shared edge, walked forwards
    // by `a` and backwards (~0) by `b`. Quantized at scale 0.5 from (10, 20).
    const small: Topology = {
      type: "Topology",
      transform: { scale: [0.5, 0.5], translate: [10, 20] },
      arcs: [
        [[2, 0], [0, 2]], // (11,20) → (11,21): the shared edge
        [[2, 2], [-2, 0], [0, -2], [2, 0]], // (11,21) → (10,21) → (10,20) → (11,20)
        [[2, 0], [2, 0], [0, 2], [-2, 0]], // (11,20) → (12,20) → (12,21) → (11,21)
      ],
      objects: {
        a: { type: "Polygon", arcs: [[0, 1]] },
        b: { type: "MultiPolygon", arcs: [[[-1, 2]]], id: "b" },
      },
    };
    expect(feature(small, "a")).toEqual({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [11, 20],
            [11, 21],
            [10, 21],
            [10, 20],
            [11, 20],
          ],
        ],
      },
    });
    expect(feature(small, "b")).toEqual({
      type: "Feature",
      id: "b",
      properties: {},
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [11, 21],
              [11, 20],
              [12, 20],
              [12, 21],
              [11, 21],
            ],
          ],
        ],
      },
    });
    expect(feature(small, "a")).toEqual(topojsonClient.feature(small as unknown as SpecTopology, "a"));
    expect(feature(small, "b")).toEqual(topojsonClient.feature(small as unknown as SpecTopology, "b"));
  });

  it("throws for an object that does not exist", () => {
    expect(() => feature(topology, "antarctica")).toThrow(/does not exist/);
  });
});
