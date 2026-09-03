/**
 * A minimal TopoJSON reader for the committed region geometry
 * (`public/geo/regions.topo.json`): delta-decodes quantized arcs, applies the
 * transform, resolves reversed (`~i`) arc references and assembles polygon
 * rings. Its output is identical to topojson-client's `feature()` — the unit
 * test round-trips the committed file against that package — so the app
 * ships no map library and performs no fetch (brief A.8, ADR 0013).
 *
 * Only the geometry types the build script emits are supported: Polygon,
 * MultiPolygon and GeometryCollection. Points and lines are not map regions.
 */

export type Position = number[];
export type Ring = Position[];
export type PolygonRings = Ring[];

export interface TopoTransform {
  scale: [number, number];
  translate: [number, number];
}

interface TopoGeometryCommon {
  id?: string | number;
  bbox?: number[];
  properties?: Record<string, unknown>;
}

export interface TopoPolygon extends TopoGeometryCommon {
  type: "Polygon";
  arcs: number[][];
}

export interface TopoMultiPolygon extends TopoGeometryCommon {
  type: "MultiPolygon";
  arcs: number[][][];
}

export interface TopoGeometryCollection extends TopoGeometryCommon {
  type: "GeometryCollection";
  geometries: TopoGeometry[];
}

export type TopoGeometry = TopoPolygon | TopoMultiPolygon | TopoGeometryCollection;

export interface Topology {
  type: "Topology";
  transform?: TopoTransform;
  bbox?: number[];
  arcs: number[][][];
  objects: Record<string, TopoGeometry>;
}

export interface GeoPolygon {
  type: "Polygon";
  coordinates: PolygonRings;
}

export interface GeoMultiPolygon {
  type: "MultiPolygon";
  coordinates: PolygonRings[];
}

export interface GeoGeometryCollection {
  type: "GeometryCollection";
  geometries: GeoGeometry[];
}

export type GeoGeometry = GeoPolygon | GeoMultiPolygon | GeoGeometryCollection;

export interface GeoFeature {
  type: "Feature";
  id?: string | number;
  bbox?: number[];
  properties: Record<string, unknown>;
  geometry: GeoGeometry;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/**
 * Point decoder. A quantized topology stores each arc's first point as an
 * absolute quantized position and every later point as a delta from the
 * previous one; the transform maps quantized units back to degrees. The
 * running total resets at the start of each arc (`index === 0`).
 */
function pointDecoder(transform: TopoTransform | undefined): (input: Position, index: number) => Position {
  if (!transform) return (input) => input.slice();
  const [kx, ky] = transform.scale;
  const [dx, dy] = transform.translate;
  let x0 = 0;
  let y0 = 0;
  return (input, index) => {
    if (!index) x0 = y0 = 0;
    const output = input.slice();
    output[0] = (x0 += input[0]) * kx + dx;
    output[1] = (y0 += input[1]) * ky + dy;
    return output;
  };
}

/** Reverse the last `n` points of `points` in place (a `~i` arc is walked backwards). */
function reverseTail(points: Position[], n: number): void {
  let j = points.length;
  let i = j - n;
  while (i < --j) {
    const t = points[i];
    points[i++] = points[j];
    points[j] = t;
  }
}

function decodeGeometry(topology: Topology, geometry: TopoGeometry): GeoGeometry {
  const decodePoint = pointDecoder(topology.transform);
  const arcs = topology.arcs;

  function appendArc(index: number, points: Position[]): void {
    // Consecutive arcs share their join point; drop the duplicate.
    if (points.length) points.pop();
    const arc = arcs[index < 0 ? ~index : index];
    if (!arc) throw new Error(`TopoJSON arc ${index} does not exist`);
    for (let k = 0; k < arc.length; k++) points.push(decodePoint(arc[k], k));
    if (index < 0) reverseTail(points, arc.length);
  }

  function line(arcIndexes: number[]): Position[] {
    const points: Position[] = [];
    for (const index of arcIndexes) appendArc(index, points);
    if (points.length < 2) points.push(points[0]);
    return points;
  }

  function ring(arcIndexes: number[]): Ring {
    const points = line(arcIndexes);
    while (points.length < 4) points.push(points[0]);
    return points;
  }

  function polygon(ringArcs: number[][]): PolygonRings {
    return ringArcs.map(ring);
  }

  function geometryOf(g: TopoGeometry): GeoGeometry {
    switch (g.type) {
      case "GeometryCollection":
        return { type: "GeometryCollection", geometries: g.geometries.map(geometryOf) };
      case "Polygon":
        return { type: "Polygon", coordinates: polygon(g.arcs) };
      case "MultiPolygon":
        return { type: "MultiPolygon", coordinates: g.arcs.map(polygon) };
      default: {
        const unsupported = g as { type?: string };
        throw new Error(`Unsupported TopoJSON geometry type: ${String(unsupported.type)}`);
      }
    }
  }

  return geometryOf(geometry);
}

function toFeature(topology: Topology, geometry: TopoGeometry): GeoFeature {
  const { id, bbox } = geometry;
  const properties = geometry.properties == null ? {} : geometry.properties;
  const decoded = decodeGeometry(topology, geometry);
  if (id == null && bbox == null) return { type: "Feature", properties, geometry: decoded };
  if (bbox == null) return { type: "Feature", id, properties, geometry: decoded };
  return { type: "Feature", id, bbox, properties, geometry: decoded };
}

/**
 * Decode one named object into GeoJSON: a Feature, or a FeatureCollection
 * when the object is a GeometryCollection. Same shape as topojson-client's
 * `feature(topology, object)`.
 */
export function feature(topology: Topology, objectName: string): GeoFeature | GeoFeatureCollection {
  const object = topology.objects[objectName];
  if (!object) throw new Error(`TopoJSON object "${objectName}" does not exist`);
  if (object.type === "GeometryCollection") {
    return { type: "FeatureCollection", features: object.geometries.map((g) => toFeature(topology, g)) };
  }
  return toFeature(topology, object);
}

/**
 * Every polygon of one named object as a flat list of ring sets, whatever the
 * object's nesting (Polygon, MultiPolygon or a collection of either). This is
 * what the projection's path builder consumes.
 */
export function polygonsOf(topology: Topology, objectName: string): PolygonRings[] {
  const out: PolygonRings[] = [];
  function collect(g: GeoGeometry): void {
    if (g.type === "Polygon") out.push(g.coordinates);
    else if (g.type === "MultiPolygon") out.push(...g.coordinates);
    else g.geometries.forEach(collect);
  }
  const decoded = feature(topology, objectName);
  if (decoded.type === "FeatureCollection") decoded.features.forEach((f) => collect(f.geometry));
  else collect(decoded.geometry);
  return out;
}
