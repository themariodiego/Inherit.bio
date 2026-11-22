# Neanderthal marker panel provenance

This is an engineering record of how `sites.json` was built and licence-checked.
It is not a scientific review. The population choice and the comparison figure
that uses this panel are listed for the owner's source review in
`docs/neanderthal-source-review.md`; nothing here is presented as reviewed.

## Source dataset

- **Dataset:** Browning, Sharon (2018), *Sprime results for 1000 Genomes
  non-African populations and SGDP Papuans*, Mendeley Data, V1.
- **DOI:** [10.17632/y7hyt83vxr.1](https://doi.org/10.17632/y7hyt83vxr.1)
- **Deposited files used** (downloaded by a person, verified against the
  repository's committed SHA-256 at build time; see `manifest.json`):
  - `CEU_sprime_results.tar.gz` — `f695e484db15d1974d0fb6bd15a3e8d769a872f2a3803908d9197a057b9472f0`
  - `CHB_sprime_results.tar.gz` — `345885d49379477ec48bb470bb8489bb339f24898db09676fcc10840e7337c05`
  - `GIH_sprime_results.tar.gz` — `e1c26d457bf04cab9e548b28446b7733d7ad7a61e690761ccc3ee39b1e701e48`
- **Accompanying paper** (cited, not the data licence): Browning SR, Browning
  BL, Zhou Y, Tucci S, Akey JM. *Analysis of Human Sequence Data Reveals Two
  Pulses of Archaic Denisovan Admixture.* Cell 2018;173(1):53-61.e9. PMID
  29551270, DOI 10.1016/j.cell.2018.02.031.

## Licence

- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>.
- **Retrieved:** 2026-10-22, from the Mendeley Data record's own API
  (`https://data.mendeley.com/public-api/datasets/y7hyt83vxr`), which states
  the `data_licence` for version 1.
- **Exact licence sentence, quoted from that record:** "You can share, copy and
  modify this dataset so long as you give appropriate credit, provide a link to
  the CC BY license, and indicate if changes were made, but you may not do so in
  a way that suggests the rights holder has endorsed you or your use of the
  dataset. Note that further permission may be required for any content within
  the dataset that is identified as belonging to a third party."
- **Verdict:** CC BY 4.0 permits redistribution and modification inside this
  AGPL-3.0 repository, with attribution and an indication of changes. Only the
  derived marker coordinates and the two alleles per site are shipped; no
  participant genotype is included.

### Attribution shipped

`sites.json` carries, in its `licence` field, and the About page's data-sources
list carries: *"Neanderthal-informative marker list derived from Browning,
Sharon (2018), Sprime results for 1000 Genomes non-African populations and SGDP
Papuans, Mendeley Data, V1, doi:10.17632/y7hyt83vxr.1, licensed CC BY 4.0.
Changes: a subset of sites was selected, reduced to one site per introgressed
segment, and lifted to GRCh38."*

## What was selected

The deposited Sprime output lists, per 1000 Genomes population and chromosome,
the putatively archaic alleles of each introgressed segment, with two added
columns giving each allele's match to the Altai Neanderthal (NMATCH) and the
Altai Denisovan (DMATCH) genomes (the dataset README). A site is kept when:

- NMATCH is `match` and DMATCH is `mismatch` — the allele matches the Altai
  Neanderthal and not the Altai Denisovan, so it is Neanderthal-informative
  rather than shared-archaic or Denisovan;
- both alleles are single A/C/G/T letters and the pair is not strand-ambiguous
  (not A/T or C/G), so a forward-strand read is unambiguous;
- the variant carries an rs identifier.

Of a segment's qualifying rows, the positional median is kept, so each
introgressed segment contributes exactly one site. The populations read are
**CEU, CHB and GIH** (1000 Genomes European, East Asian and South Asian
reference panels), chosen to cover the main non-African ancestries in which
Neanderthal-introgressed segments are called; **this choice is an engineering
default pending the owner's source review** (`docs/neanderthal-source-review.md`).

## Genome build conversion (GRCh37 -> GRCh38)

The Sprime positions are GRCh37 (1000 Genomes phase 3; the dataset README
states "build 37 for these data"). They were converted to GRCh38 by the
repository's own point liftover (`src/lib/genome/liftover.ts`, `buildLiftover`)
over the bundled Ensembl assembly chain:

- **Chain file:** `data/ref/chain/GRCh37_to_GRCh38.chain.gz`
  (SHA-256 `351de3cd4a01d9fcffd38881981767b697090d2eba876740891b96d5c546b100`),
  source <https://ftp.ensembl.org/pub/assembly_mapping/homo_sapiens/GRCh37_to_GRCh38.chain.gz>,
  retrieved 2026-08-28; Ensembl data are open/unrestricted (see
  `data/ref/chain/PROVENANCE.md` and the Ensembl row in `docs/dataset-licenses.md`).

Conversion outcome (recorded in `manifest.json`, `counts`):

- 3,296 sites selected across the three populations;
- 3,119 unique GRCh37 positions after merging duplicates between populations;
- 0 dropped for conflicting alleles between populations at one position;
- **9 dropped as unmapped or ambiguous by the liftover** (no single forward
  GRCh38 coordinate on the same chromosome);
- 0 dropped for a GRCh38 position or rsID collision after lifting;
- **3,110 sites** in the committed panel.

## Reproduce and verify offline

```
node --import tsx scripts/build-neanderthal-sites.ts --check     # offline: every site re-lifts, both hashes match
node --import tsx scripts/build-neanderthal-sites.ts --build /abs/dir   # rebuild from the downloaded tarballs
```

`scripts/build-neanderthal-sites.test.ts` runs `--check` with the network
mocked to reject, and pins the panel's SHA-256
(`21f0862ed04f21ddd3fc338b599088e8f5d24b1f928547b4b79030a1b4709e93`).
