# Seven-region frequencies for the 168-marker ancestry panel

## Identity and source

- Panel ID: `aims-hgdp-tgp-168`.
- Reference version: `hgdp-1kg-v3.1.2-cap30-168-v1`.
- Table: `data/ref/aims-seven-region.json`.
- Manifest and reproducibility hashes: `data/ref/aims-seven-region-manifest.json`.
- Generator committed before table generation:
  `2c465ee591b3c6905c78006ef2d2e99a7ced4dc1`.
- Source release: gnomAD v3.1.2 harmonised HGDP+1kGP callset, retrieved
  15 September 2026. The manifest records exact VCF and metadata URLs.
- Attribution: Koenig et al., *A harmonized public resource of deeply sequenced
  diverse human genomes*, Genome Research 34(5):796 (2024),
  [DOI 10.1101/gr.278378.123](https://doi.org/10.1101/gr.278378.123), and
  [gnomAD HGDP+1kGP downloads](https://gnomad.broadinstitute.org/downloads#v3-hgdp-1kg).

The allele-frequency use is covered by the HGDP+1kGP entry in
`docs/dataset-licenses.md`. The data-policy page was read in the browser on 15 September 2026: primary
exome/genome data are released under CC0 1.0, with attribution requested and
no participant reidentification allowed. Third-party annotations can have
separate restrictions; this table contains primary allele frequencies only.
The journal article's CC BY-NC 4.0 licence governs its text, not these data.
The earlier audit confused that article with its CC BY 4.0 preprint; see the
correction in the audit.

Every marker has the same rsid, chromosome, one-based GRCh38 position, REF and
ALT as `data/ref/aims.json`, in the same order. Marker ascertainment is inherited
from that panel; see `data/ref/AIMS_PROVENANCE.md`. Only its reference frequencies
change. The five-region table remains available for its original analysis
versions and is not reinterpreted as this reference.

## Exact runtime representation

The generator also emits `src/lib/genome/regional-reference-json.ts`, a compact
JSON string parsed by native `JSON.parse` when the seven-region estimator loads.
Generator `--check` and artifact tests bind this string to every value and the
row/key order in the committed table. The original table, reference version,
manifest hashes and measured fits are unchanged; the capture's full-content
integrity check still rejects any altered reference value.

A minimal Next.js 16.3.3 production build reproduced its Turbopack JSON import
changing 122 of the table's 1,176 frequency doubles while retaining all key
orders. For example, `rs6541030` / `OCE` changed from
`0.23333333333333334` (IEEE-754 hex `3fcdddddddddddde`) to
`0.23333333333333336` (`3fcddddddddddddf`). That changed the compact table hash
from the manifest's `54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163`
to `e82f4d148b9750695cdbd03a211633d0ee70fd5fab33fb932c228d915512406d` and correctly
stopped capture-module initialization. The generated string preserves the exact
decimal text through bundling; it does not round values to bypass that check.

## How frequencies are calculated

`scripts/ancestry-resolution/fetch-callset-frequencies.py` reads the callset's
public reference cohorts with `high_quality == true` and a named population in
the release metadata. This yields 4,097 reference samples in 78 populations.
Genotypes are reduced to per-population ALT-copy (`ac`) and called-copy (`an`)
counts before aggregate files are written. Sample identifiers and genotypes are
not part of the committed reference table.

These are counts of this exact metadata filter, not the publication's cohort.
The paper's abstract reports 4,094 genomes from 80 populations. The fetched
v3.1.2 metadata has 4,151 rows; the documented filter retains 4,097 across 78
named populations (3,166 1000 Genomes and 931 HGDP). Sixty-six panel markers
have all 8,194 called allele copies, supporting that aggregate sample count.
The inspected metadata does not identify the paper's exact cohort membership,
so the reason for the count difference remains unresolved. The selected set
also includes 717 samples marked related; it is not an unrelated-sample subset.
No alternative quality flag or population exclusion was silently substituted.
Changing membership would require a new reference and fresh measurement.

The source metadata assigns seven genetic-region codes: `AFR`, `AMR`, `CSA`,
`EAS`, `EUR`, `MID`, `OCE`. The generator preserves those assignments and includes
every fetched population. In particular, the AMR reference combines Indigenous
American and admixed American cohorts, AFR includes diaspora cohorts, and the
MID assignment includes a North African cohort. These reference categories do
not delineate a reader's nationality, ethnicity, birthplace or family history.
No additional population filter was introduced for this release.

At each marker and for each population:

```text
population frequency = ac / an
population weight = min(30, an / 2)
region frequency = sum(weight * population frequency) / sum(weight)
```

Thus the weight uses called diploid equivalents at that marker, not the total
number of metadata samples. A half-called genotype contributes its observed
allele count. The choice of cap 30 is recorded in `docs/protocol/decisions.md`
(14 September 2026). These are ALT frequencies. REF and ALT are never swapped
to make an input match. The generated table preserves full numeric precision
and does not clip frequencies; the estimator and measurement clip likelihood
frequencies to `[0.001, 0.999]` for numerical stability.

The committed generator rejects incomplete marker sets, duplicated identities,
allele mismatches, unknown regions, missing or extra populations at a marker,
zero called copies, non-integer counts, ALT copies above called copies, and
called copies above twice the source population's sample count. An incomplete
input stops generation; missing frequencies are not filled with zero or 0.5.

## Reproduce and verify

With the repository's existing Node and Python dependencies:

```sh
CALLSET_WORK=/path/to/task/work/callset python3 scripts/ancestry-resolution/fetch-callset-frequencies.py
node --import tsx scripts/ancestry-resolution/generate-seven-region-reference.mts
node --import tsx scripts/ancestry-resolution/generate-seven-region-reference.mts --check
node --import tsx scripts/ancestry-resolution/measure-accepted-adaptive-merge.mts --marker-sweep --include-ceiling --convergence-sensitivity --output=scripts/ancestry-resolution/accepted-adaptive-measurement.json
```

The fetched aggregate files remain gitignored. No real reader's file is needed.
Generation is deterministic: marker order comes from `aims.json`, population
names are sorted before summation, and region order is
`AFR, AMR, CSA, EAS, EUR, MID, OCE`. Source hashes use recursively sorted object
keys and preserve array order. `markerSha256` hashes `JSON.stringify(table)`
without spacing or a trailing newline, with each marker's properties emitted
as `rsid, chrom, pos38, ref, alt, freqs` in that order. `tableSha256` separately
hashes the exact formatted table file bytes. The generator's `--check` mode
requires regenerated files to match byte for byte.

## Adaptive reporting and measurement limits

The 15 September owner decision applies to unrounded shares. When at least two
of EUR, MID and CSA are **strictly greater than 0.10**, report all three together.
The combined row may disclose its uncertain fitted components. The prior
measurement used `>= 0.10` and combined only components meeting that threshold;
it is a different rule. Its earlier reported 21% figure does not validate this
release.

`scripts/ancestry-resolution/accepted-adaptive-measurement.json` records a fresh
comparison of both rules, the unmerged result, and a global all-three merge.
Its held-out scenario removes the entire source population before rebuilding
the reference. Held-out figures are the expectation; population-present figures
are labelled as the ceiling. Reference populations are equally sampled in this
simulation, so the merged fraction is not an estimate of real-reader prevalence.
The simulation assumes independent markers and is not a calibration of a real
person's confidence intervals. A combined row is easier to count as correct
because it covers a larger area; that does not validate the component split.

The marker-count sweep uses paired synthetic people and one deterministic,
nested missing-marker pattern at 42, 84, 126 and 168 observed markers. It does
not establish that any arbitrary set of 42 or 84 observed markers is adequate,
nor a calibrated reliability threshold. In particular, the older five-region
panel's 42-marker display threshold is not validation for this seven-region
reference. The measurement imports the production fitter directly and checks
its adaptive trigger on every draw.

With the production 50,000-step bound and early stop at a maximum component
change below `1e-7`, the accepted reporting rule measures as follows. Each row
contains 20 synthetic people per source population, 1,560 people in total.
"Top row" means the largest reported row contains the source metadata's region
label. Wrong-row tails count 69 non-AMR populations by their mean largest wrong
reported row; all 78 populations remain in fitting and simulation.

| Held-out markers | Top row contains source region | Cohorts with mean wrong row ≥10% / ≥20% / ≥30% |
| --- | --- | --- |
| 42 | 91.99% | 33 / 10 / 6 |
| 84 | 95.51% | 17 / 5 / 3 |
| 126 | 95.96% | 13 / 3 / 2 |
| 168 | 96.54% | 10 / 4 / 2 |

At 168 markers, the accepted rule merges 329 of 1,560 held-out synthetic people
(21.09%). The earlier hot-only rule merges the same number, but **265 reported
results differ** because the accepted rule always combines all three regions.
Mean largest wrong reported row is 0.0624 for the accepted rule, 0.0635 for the
earlier rule and 0.0609 for a global all-three merge. The global rule's broader
row loses separate detail for everyone; the adaptive fraction applies only to
this equally sampled reference simulation.

The population-present **ceiling**, at 168 markers, has 97.18% top-row agreement,
8 / 3 / 2 wrong-row tail counts, and 285 of 1,560 people merged (18.27%). These are
not the held-out expectation. All 7,800 fits across the four held-out sizes and
one full-panel ceiling scenario converged within the production bound.

Subgroup limitations remain substantial. Under full-panel hold-out, AMR top-row
agreement is 78.33%, and the largest non-AMR cohort mean wrong row is about 42%
for Uygur (assigned EAS in the source). This is a limitation of fitting these
cohort labels, not evidence that those people's ancestry is known to be wrong.
No new cohort exclusion is justified by those results. The sweep supplies no
calibrated cutoff for arbitrary missing-marker patterns; full-panel coverage is
a conservative release requirement, not a claim that full coverage is reliable
for every person.

The numerical-convergence comparison also matters: with the earlier 2,000-step
limit, 476 of 1,560 full-panel held-out draws reached the limit. Extending those
to 10,000 steps changed individual component shares by up to 1.94 percentage
points and left 24 unconverged. Those 24 all converged under a 50,000-step bound;
their additional component change reached 0.228 percentage points. Neither
extension changed a full-panel adaptive trigger in this simulation. Numerical
convergence does not establish ancestry accuracy, and future unconverged
results must retain their calculation-limit warning.

**The adaptive rule cannot distinguish genuine mixed ancestry from this panel's
confusion. It merges both, and people with mixed ancestry disproportionately
lose separate region detail.** This limitation must stay with the result,
disclosed components, saved content and exports. The numbers are model
components, not evidence of ancestry from each named region. The panel cannot
support confident population-level identity labels.
