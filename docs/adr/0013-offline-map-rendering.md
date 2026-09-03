# ADR 0013: Offline map rendering for the ancestry surface

- Status: Accepted
- Date: 2026-09-03

## Context

The ancestry page draws a world map of five broad regions shaded by the
share of a person's DNA that is common there (brief §4.6, A.8, X16.5). The
brief fixes the rendering contract: an inline SVG in a 16:9 frame, an
equirectangular projection, no tile server, no CDN, no geocoder, no
third-party origin at runtime (the network audit in `e2e/network-audit.spec.ts`
already fails any request outside the first-party allowlist), regions drawn
from physical geography and never from administrative boundaries, and a
committed geometry file inside a stated size budget (180 KB for the
geometry, 350 KB for the surface's static assets). One encoding carries the
result: fill opacity proportional to the interval's lower bound with a
floor of 0.15, a radial-gradient feather of at least 15% of the region's
bounding-box width, and a dashed hairline where the lower bound is 0.

The repository had no map library, no geometry and no projection code.
User genotypes never leave the deployment (ADR 0005), so nothing about a
person may be sent to a map service to be drawn.

## Decision

1. **Source.** Natural Earth 1:110m physical vectors (public domain; see
   `docs/dataset-licenses.md`): the land layer as the basemap and named
   physical features (continents, a peninsula, an isthmus, island groups, a
   range, a plateau, two islands) as masks. No country, state or border file
   is read.
2. **Build-time reduction.** `scripts/build-region-geometry.ts` fetches the
   two files, verifies their pinned SHA-256, cuts each region as
   `land ∩ mask` by the recipes recorded in `data/ref/regions/regions.json`,
   simplifies, quantizes and writes `public/geo/regions.topo.json` (objects:
   `land`, the land outside every region, plus one per region code, tiling
   the map without overlap) beside `public/geo/GEOMETRY_PROVENANCE.md`. The
   packages it uses are devDependencies; the app imports none of them. The
   output is byte-identical across runs and the build fails if any two
   regions overlap or the file exceeds its budget.
3. **Server-side decode.** `src/lib/geo/topojson.ts` (an in-repo reader
   whose output is unit-tested against `topojson-client`) and
   `src/lib/geo/project.ts` (the pure projection into the 1600 × 900
   viewBox) turn the committed file into SVG path data once per server
   process (`src/lib/ancestry/geometry.ts`). The page passes path strings to
   the client map component; the browser loads no geometry file and no map
   code, and no `/geo/` request is ever made.
4. **Rendering.** `src/components/results/ancestry/ancestry-map.tsx` draws
   one `<path>` per region over the remaining land, filled by a
   `<radialGradient gradientUnits="objectBoundingBox">` whose outer 30% of
   radius fades to `stop-opacity="0"` (15% of the bounding-box width), a
   dashed hairline at a lower bound of 0, and a grey outline mode below the
   reliability threshold. The `<svg>` carries
   `data-density-pixel-exclusion="map-tile"` so the density measurement
   treats it as a map, not as ink.

## Alternatives rejected

- **A map library with a tile server (Leaflet, MapLibre)** — tiles come from
  a third-party origin, which G1.7 and the network audit forbid, and they
  draw administrative boundaries the brief prohibits.
- **A projection library at runtime (d3-geo)** — weight in the client bundle
  for one fixed projection that is six lines of arithmetic.
- **Fetching `/geo/regions.topo.json` from the client** — adds a loading
  state and a same-origin request for data the server already holds.
- **Administrative boundaries as region outlines** — forbidden by brief
  §4.6; the five regions are physical features cut at stated parallels and
  boxes, recorded as mapping decisions.
- **A hand-drawn or approximated outline** — not reproducible and not
  attributable; the build script and its provenance document replace it.

## Consequences

- Regenerating the geometry requires the script and its devDependencies
  (`pnpm exec tsx scripts/build-region-geometry.ts`); the app's runtime has
  no map dependency at all.
- A new region set means a new release id in `data/ref/regions/regions.json`
  and a regenerated geometry file; the two are checked against each other
  and against the shipped marker panel at load and in unit tests.
- The density gate must exclude the map's pixels through the canonical
  `map-tile` selector; the baseline's ink ceiling is unreachable with any
  filled map.
- The label denylist (`data/ref/regions/label-denylist.json`) constrains
  every region name, path accessible name, chip and caption, and the E2E
  reads it from the file rather than repeating it.
