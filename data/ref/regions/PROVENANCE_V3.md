# Seven-region display registry

`regions-v3.json` is the separately versioned threshold, display-name and map
registry for `aims-hgdp-tgp-168`, reference `hgdp-1kg-v3.1.2-cap30-168-v1`.
Historical `regions.json` remains frozen and belongs to the five-region method.

The minimum is 168 usable markers for every region. The accepted held-out
evaluation used the full panel; a partial panel has not earned a lower display
threshold. A fit below this minimum has a grey map and no shares by default.
Its unreliable raw derived rows remain behind a disclosure, as G5.3a requires,
with a coverage warning and the stored reporting caveat. No marker observations
means no fitted percentages at all.

Counts and source membership come from `data/ref/aims-seven-region-manifest.json`,
not a second copied list here. Reference construction, licences, held-out
measurement and its limits are documented in
`data/ref/AIMS_SEVEN_REGION_PROVENANCE.md`. Study-group names are not identities
assigned to readers. No inferred sample-site coordinates are supplied.

Each map recipe is only a broad locator using pinned Natural Earth physical
features. Arbitrary cuts and their limitations, including the North African
reference in MID and the Papuan/Melanesian-only OCE reference, are recorded in
`public/geo/REGIONAL_GEOMETRY_PROVENANCE.md`. Geometry generation preserves all
historical map files. The server sends decoded SVG paths, and the client imports
only this small display registry, never the ancestry marker table.

The saved reporting decision combines EUR/MID/CSA only when at least two fitted
shares exceed 0.10. It combines all three before rounding; a native disclosure
shows their fitted split with the stored caveat. This is a reporting policy,
not proof that a reader's mixed ancestry is an error. See the owner decision in
`docs/protocol/decisions.md`.
