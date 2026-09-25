# Build-discriminating coordinate reference

Generated on 22 September 2026 from Ensembl release 116. This reference is
public variant-location metadata, not a genome or a set of participant
genotypes. Each row of `build-discriminating-sites.json` contains only the
numeric rsID, autosome, 1-based GRCh37 position and 1-based GRCh38 position.
It contains 61,617 coordinate pairs across all 22 autosomes.

## Sources and reuse

GRCh38 SNP coordinates came from the [Ensembl overlap REST endpoint](https://rest.ensembl.org/documentation/info/overlap_region),
filtered to its `all_chips` variant set. Ensembl describes this set as markers
with assays on commercial genotyping chips held in its database; it is a
marker-location selection, not a clinical validation or a promise that any
particular laboratory table contains these sites. See the
[release 116 set descriptions](https://jun2026.archive.ensembl.org/info/genome/variation/species/sets.html).
No assay sequences, vendor annotation prose, sample identifiers, participant
allele calls or population frequencies are shipped in this reference.

Attribution: Ensembl / EMBL-EBI for the location metadata and assembly mapping;
NCBI dbSNP for the rs identifiers. The [Ensembl terms](https://jun2026.archive.ensembl.org/info/about/legal/disclaimer.html)
impose no Ensembl restrictions on data use, but preserve possible third-party
constraints. The [NCBI molecular-data policy](https://www.ncbi.nlm.nih.gov/home/about/policies/)
likewise imposes no NCBI restriction on reuse or distribution, while making no
transfer of submitters' rights. The repository's existing dbSNP verdict applies
to these identifiers and coordinate facts. This is not a blanket CC0 licence
claim about genotyping arrays, assays or other fields in the source responses.
The scope and verdict are recorded in `docs/dataset-licenses.md`.

GRCh37 coordinates were derived through the inverse of the bundled Ensembl
assembly chain, not fetched from a second marker database. Its upstream URL
and retrieval date are in [chain/PROVENANCE.md](chain/PROVENANCE.md).

## Selection and reproducibility

For each autosome, the acquisition script uses the lengths in
`public/genomes/hg38.chrom.sizes`. For window index 1 through 10, the midpoint
is `floor(length * index / 11)`. The inclusive range from `midpoint - 499999`
through `midpoint + 500000` covers one million positions. The 220 requests
select `feature=variation` and `variant_set=all_chips`.

Only single-position variants with at least two single-base A/C/G/T alleles
are candidates. The script rejects repeated rsIDs, ambiguous inverse chain
locations, mappings to another chromosome, equal positions in both builds,
and every coordinate collision between any retained sites or builds. Each
inverse must map forward through the shipped liftover implementation to the
original GRCh38 coordinate. Counts for this acquisition:

- 62,010 candidate SNPs from the windows.
- 61,685 with unique rsIDs and a discriminating, round-tripping chain inverse.
- 61,617 after removing coordinate collisions.

`build-discriminating-sites.manifest.json` records all 220 request URLs, each
raw response's SHA-256, record count and cache-file retrieval timestamp, the
release returned before and after acquisition, and the output hashes:

- Reference SHA-256: `03c17745990c0396f4ca6020e963d6b359eef94350f99c4fe066224580c89d5e`.
- Chain SHA-256: `351de3cd4a01d9fcffd38881981767b697090d2eba876740891b96d5c546b100`.

Verify the committed reference offline:

```sh
corepack pnpm exec tsx scripts/build-discriminating-sites.ts --check
```

To acquire a replacement, use an absolute cache directory outside the checkout:

```sh
corepack pnpm exec tsx scripts/build-discriminating-sites.ts --fetch /tmp/inherit-build-reference
```

Acquisition permits four requests at once, caps each response at 8 MiB and
30 seconds, caps each window at 20,000 records, and refuses cached responses
from a different release or a release change during the run. It contacts the
current REST service; a future release can yield different bytes. Review the
new reference, manifest and provenance together. The offline check verifies
the committed bytes and chain pairs; it does not re-fetch or authenticate the
historical upstream responses. Raw responses are not runtime dependencies.

## Scope of the inference and its evidence

`src/lib/genome/build-inference.ts` consumes this reference only for the
registered embryo laboratory-table inference operation. It compares distinct
matched input coordinates, requires at least 1,000 of them and at least 99%
agreement for exactly one build, and otherwise returns `decision-required`.
Unknown coordinates and X/Y/MT provide no evidence. Duplicate embryo rows
cannot inflate the denominator. The scan finishes before deciding, so later
contradictions count, and the registered logical-record bound still applies.
It reads no genotype or source label and retains no input rows.

Tests use artificial coordinate sets assembled from this reference and test
chain fragments. They prove the threshold, ambiguity and bounded-scan rules;
they do not measure classification accuracy, clinical utility or coverage of
real laboratory files. In particular, neither 61,617 sites nor a successful
synthetic test guarantees 1,000 overlaps with an arbitrary input. Low overlap
must remain `decision-required` without lowering either threshold.

This component is not wired to an ingest route. Session-bound challenges,
source-format/build binding, physical Storage writer fencing, conclusive drain
and deletion evidence, and terminal cleanup remain separate prerequisites.
`EMBRYO_INGEST_AVAILABLE` remains false. No release acceptance row becomes YES
from this component alone.
