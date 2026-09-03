/**
 * The map geometry as the page draws it: the committed, quantized TopoJSON
 * (`public/geo/regions.topo.json`, ADR 0013) decoded and projected once per
 * server process into SVG path data. The server passes these strings to the
 * client map, so the browser loads no geometry file and no map library.
 */
import committed from "../../../public/geo/regions.topo.json";
import { pathBBox, pathData, type BBox } from "@/lib/geo/project";
import { polygonsOf, type Topology } from "@/lib/geo/topojson";
import { REGIONS } from "./regions";

/** The object holding the land outside every region; the six objects tile the map. */
const LAND_OBJECT = "land";

export interface RegionShape {
  code: string;
  /** SVG path data in the 1600×900 viewBox. */
  d: string;
  bbox: BBox;
}

export interface MapShapes {
  /** One shape per region of the release, in `sort_order`. */
  regions: RegionShape[];
  /** The remaining land as one path. */
  land: string;
}

let cached: MapShapes | undefined;

export function mapShapes(): MapShapes {
  if (cached) return cached;
  const topology = committed as unknown as Topology;
  const regions = REGIONS.map((region): RegionShape => {
    const polygons = polygonsOf(topology, region.code);
    const bbox = pathBBox(polygons);
    if (!bbox) throw new Error(`region ${region.code} has no geometry in the committed topology`);
    return { code: region.code, d: pathData(polygons), bbox };
  });
  cached = { regions, land: pathData(polygonsOf(topology, LAND_OBJECT)) };
  return cached;
}
