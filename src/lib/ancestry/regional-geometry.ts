/** Server-side decoding of the separately versioned seven-region locator. */
import "server-only";
import committed from "../../../public/geo/regions-v3.topo.json";
import { pathBBox, pathData } from "@/lib/geo/project";
import { polygonsOf, type Topology } from "@/lib/geo/topojson";
import type { MapShapes } from "./geometry";
import { REGIONAL_REGIONS } from "./regional-regions";

let cached: MapShapes | undefined;
export function regionalMapShapes(): MapShapes {
  if (cached) return cached;
  const topology = committed as unknown as Topology;
  cached = { land: pathData(polygonsOf(topology, "land")), regions: REGIONAL_REGIONS.map(({ code }) => {
    const polygons = polygonsOf(topology, code), bbox = pathBBox(polygons);
    if (!bbox) throw new Error(`Missing seven-region map geometry: ${code}`);
    return { code, d: pathData(polygons), bbox };
  }) };
  return cached;
}
