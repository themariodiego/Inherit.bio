import { describe, expect, it } from "vitest";
import {
  LAT_MAX,
  LAT_MIN,
  SCALE_X,
  SCALE_Y,
  STANDARD_PARALLEL_DEG,
  VIEWBOX,
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  bboxCentre,
  pathBBox,
  pathData,
  project,
  unproject,
} from "./project";

const inside = ([x, y]: [number, number]) => x > 0 && x < VIEWBOX_WIDTH && y > 0 && y < VIEWBOX_HEIGHT;

describe("project", () => {
  it("is a 16:9 frame of 1600 × 900 (brief §4.6)", () => {
    expect(VIEWBOX).toBe("0 0 1600 900");
    expect(VIEWBOX_WIDTH / VIEWBOX_HEIGHT).toBeCloseTo(16 / 9, 10);
  });

  it("maps the four corners of the clamped world onto the viewBox corners", () => {
    expect(project(-180, LAT_MAX)).toEqual([0, 0]);
    expect(project(180, LAT_MAX)).toEqual([VIEWBOX_WIDTH, 0]);
    expect(project(-180, LAT_MIN)).toEqual([0, VIEWBOX_HEIGHT]);
    expect(project(180, LAT_MIN)).toEqual([VIEWBOX_WIDTH, VIEWBOX_HEIGHT]);
  });

  it("lands Ibadan and Tokyo inside the frame", () => {
    const ibadan = project(3.9, 7.4);
    const tokyo = project(139.7, 35.7);
    expect(inside(ibadan)).toBe(true);
    expect(inside(tokyo)).toBe(true);
    expect(ibadan[0]).toBeCloseTo((3.9 + 180) * SCALE_X, 6);
    expect(ibadan[1]).toBeCloseTo((84 - 7.4) * SCALE_Y, 6);
    expect(tokyo[0]).toBeGreaterThan(ibadan[0]);
    expect(tokyo[1]).toBeLessThan(ibadan[1]);
  });

  it("clamps latitude to [−56°, 84°] so the poles collapse onto the edges", () => {
    expect(project(0, 90)[1]).toBe(0);
    expect(project(0, -90)[1]).toBe(VIEWBOX_HEIGHT);
  });

  it("is equirectangular with a standard parallel of about 46°", () => {
    expect(SCALE_Y / SCALE_X).toBeCloseTo(1.4464, 3);
    expect(STANDARD_PARALLEL_DEG).toBeGreaterThan(46);
    expect(STANDARD_PARALLEL_DEG).toBeLessThan(46.5);
  });

  it("unproject inverts project inside the frame", () => {
    for (const [lon, lat] of [
      [0, 0],
      [-73.9, 40.7],
      [151.2, -33.9],
      [3.9, 7.4],
    ]) {
      const [x, y] = project(lon, lat);
      const [lon2, lat2] = unproject(x, y);
      expect(lon2).toBeCloseTo(lon, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });
});

describe("pathData", () => {
  const square = [
    [
      [-180, 84],
      [-90, 84],
      [-90, 14],
      [-180, 14],
      [-180, 84],
    ],
  ];

  it("renders each ring as one closed subpath with one-decimal coordinates", () => {
    expect(pathData([square])).toBe("M0 0L400 0L400 450L0 450L0 0Z");
    expect(pathData([[[[3.9, 7.4], [3.9, 7.5], [4, 7.5], [3.9, 7.4]]]])).toBe("M817.3 492.4L817.3 491.8L817.8 491.8L817.3 492.4Z");
  });

  it("renders holes and several polygons as further subpaths", () => {
    const hole = [
      [-160, 70],
      [-160, 30],
      [-110, 30],
      [-110, 70],
      [-160, 70],
    ];
    const d = pathData([[square[0], hole], square]);
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d.match(/Z/g)).toHaveLength(3);
  });

  it("returns an empty string for no polygons", () => {
    expect(pathData([])).toBe("");
  });

  it("measures the projected bounding box and its centre", () => {
    const bbox = pathBBox([square]);
    expect(bbox).toEqual({ x0: 0, y0: 0, x1: 400, y1: 450 });
    expect(bboxCentre(bbox!)).toEqual([200, 225]);
    expect(pathBBox([])).toBeNull();
  });
});
