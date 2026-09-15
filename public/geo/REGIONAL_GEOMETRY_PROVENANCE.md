# Seven-region map geometry

This locator is version `hgdp-tgp-regions-v1`, paired with reference version
`hgdp-1kg-v3.1.2-cap30-168-v1`. It lives in `regions-v3.topo.json`; the historical
five-region `regions.topo.json`, generator, metadata and provenance are unchanged.

## What the map means

The seven shapes locate broad reference regions. They are **not** estimated
ancestral territories, sample sites, the range of a people, or political borders.
Study-group names are not assigned to the reader as personal identities.
The source reference combines 78 study groups, with different numbers and kinds
of samples in each region; its authoritative counts are in
`data/ref/aims-seven-region-manifest.json` and its sampling limitations are in
`data/ref/AIMS_SEVEN_REGION_PROVENANCE.md`.

The MID reference includes the North African Mozabite study group. The OCE
reference consists only of 17 Papuan and 13 Melanesian samples. Thus its locator
shows only land in western Melanesia, including New Guinea and nearby islands;
Australia, New Zealand and Polynesia are not shaded. The chosen geographic window
does not assert that any sample was taken at any specific location within it.
The Americas reference includes both Indigenous and admixed study groups; the
Africa reference includes diaspora samples. These simple shapes cannot depict
that history or all the places represented by those groups.

## Sources and licence

Both inputs are the same Natural Earth **1:110m physical** sources pinned for
the historical map on 2026-09-03, version `5.2.0-pre`. Natural Earth data is
[public domain](https://www.naturalearthdata.com/about/terms-of-use/).
No administrative, country or state dataset is fetched or read.

| Source | SHA-256 |
| --- | --- |
| [Land](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson) | `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9` |
| [Geographic regions](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_geography_regions_polys.geojson) | `4182af773bcc891f8ddbf4b34ac02e87f17b35456269695e07258cf0b4877ec9` |

The generator rejects any input whose hash changes, including later changes at
the source URLs. It caches physical inputs under `node_modules/.cache/natural-earth/`.

## Reproducible recipes

Run `corepack pnpm exec tsx scripts/build-regional-geometry.ts`. To use existing
verified inputs, append `--source /path/to/physical-inputs`. The generator writes
only the new topology and `regions-v3.manifest.json`; it never edits the historical
geometry or reference data. The manifest records source hashes, output hash,
size, parameters and arbitrary cut coordinates.

Every mask is clipped to the physical land basemap. Land entirely south of 60°S
is omitted. The continent and island masks are named Natural Earth physical
features. The cuts below are display choices, **not scientific boundaries**:

| Code | Recipe |
| --- | --- |
| AFR | AFRICA south of 17°N |
| AMR | NORTH AMERICA, SOUTH AMERICA and CENTRAL AMERICA |
| CSA | ASIA between 55–97°E and 0–50°N |
| EAS | ASIA east of 97°E |
| EUR | EUROPE |
| MID | AFRICA north of 17°N, plus ASIA west of 55°E and south of 42°N |
| OCE | MELANESIA within 129–157°E and 11°S–0°, excluding the physical AUSTRALIA mask |

Where physical masks overlap, precedence OCE → AMR → EUR → MID → CSA → EAS → AFR
makes the regions disjoint. Remaining land is a separate muted shape. Physical
coastlines in the two inputs differ slightly: each physical mask is widened by
0.4 degrees before clipping it back to land. This covers coarse coast edges;
it does not infer sample geography. This deliberately coarse locator cannot
represent each group's extent.

Masks use planar Visvalingam simplification at 0.0005 degrees², then the union of
nine copies shifted by −0.4, zero or +0.4 degrees in each direction. Clipped polygons
below 0.01 degrees² are discarded. Shared topology is built on a 100,000-step
grid, simplified at 0.0025 degrees² and quantized to 10,000 steps, within the
existing 180 KiB budget. Simplification can cross a small corner even when the
source masks are disjoint. The final output grid therefore receives a second
subtraction in the same precedence order, followed by remaining land. Newly cut
vertices retain their exact position within that grid rather than being snapped
again. Delta-encoded arcs may therefore include fractional grid steps at repaired
intersections. The committed geometry test requires zero overlapping area within
numerical tolerance; it does not excuse small map overlaps.

Projection uses the unchanged equirectangular 1600×900
map frame (`src/lib/geo/project.ts`). Soft radial fills fade over the outer
30 percent of each bounding-box radius; they do not draw hard ancestry borders.

When a saved result reports EUR/MID/CSA together, their disjoint polygons form
one focusable SVG path, with one combined share and one table row. Expansion
shows the fitted split and its caveat; it does not create another map boundary.
