# DNA-based chromosomal-sex result

Owner decision, 22 September 2026: retain X/Y source calls and show a
chromosomal-sex result. The owner delegated the choice of initial formats and
method. This supersedes the earlier retention-only scope and the old blanket
ban on this result. It does not authorize ranking or selecting embryos.

## Initial formats and method

Start with the multi-sample VCF/gVCF and structured PGT genotype tables already
handled by the embryo transports. An uploaded sex, gender or karyotype column
is not evidence computed from DNA. Original sample labels remain transient;
the result belongs to the exact canonical source and neutral embryo ordinal.

The initial candidate method combines non-pseudoautosomal X heterozygosity
with valid Y call count/rate over a specified assay panel. X uses
`1 - observed heterozygous calls / sum(2p(1-p))`, with reference-population
frequencies at the called loci. Both chromosome signals must agree before a
result can be reported. PLINK documents the need for suitable frequencies,
marker selection and data-derived thresholds; its generic defaults are not
an embryo-biopsy validation. Source: PLINK 2.0 documentation, “Basic statistics,”
“Sex check,” read 22 September 2026.

GRCh37/38 pseudoautosomal exclusions use the published assembly coordinates.
The implementation keeps only positions strictly between the two PAR regions
for each chromosome, also excluding the uninformative terminal sequence.
[Genome Reference Consortium](https://www.ncbi.nlm.nih.gov/grc/human).

`src/lib/embryos/chromosomal-sex-evidence.ts` implements the evidence arithmetic,
not a qualified caller. It distinguishes explicit no-calls from absent rows,
includes reference calls, rejects duplicate loci and allele mismatches, and
does not infer a Y denominator from the number of variant records present.
Heterozygous Y calls remain an explicit discordance. No thresholds, reference
frequencies, confidence percentages or performance claims have been invented.

## Qualification and display contract still to implement

Each enabled assay needs a pinned build, panel, reference-frequency source,
supported source/export revision, tested quality limits and independently
reviewed calibration evidence. Validation must cover the sample preparation
used for embryo DNA, including amplification, dropout, contamination and
discordant signals. PGT guidance treats validation and assay limitations as
part of the examination process. [ESHRE recommendations](https://doi.org/10.1093/hropen/hoaa017).

The planned closed result is `consistent-with-XX`, `consistent-with-XY`, or
`not-determined`, with its method revision, source binding and reason. These
are estimates, not a full karyotype, chromosome-count diagnosis or a statement
about gender. Display it on the embryo detail and comparison surfaces with
the method, quality and source attribution; a low-information file must show
the indeterminate state. Do not derive XX from omitted Y rows, or silently
reuse declared adult demographics. No confidence percentage without measured
calibration. Mosaicism or an unexpected pattern must not be forced into a
binary result.

This needs a narrowly registered `chromosomal_sex_result` child shape, source-
bound worker output, database read/write authority, current participant
consent, jurisdiction handling, revocation/deletion/export treatment, and
browser evidence. Keep unknown-key and ranking protections; do not remove
all forbidden-field checks to let one result through. Existing sex-combined
disease models remain unchanged. No production profile or completed runtime
for this result exists yet; the new arithmetic tests use invented data only
and do not establish clinical accuracy.
