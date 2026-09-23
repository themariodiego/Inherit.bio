# Sample data provenance

Active test inputs are synthetic and describe no real person. Historic public
reference material remains identified below. No real individual's private genome
is or may ever be committed to this repository; current tests also exclude
public benchmark genotypes as inputs.

## synthetic-pipeline-grch38.vcf.gz

- Classification: independently invented single-sample VCF. No person's
  genotype or benchmark record is read by its generator or tests.
- Generator: `scripts/generate-synthetic-vcf-fixtures.ts`. It creates 120,000
  arithmetic filler positions, 40,000 each on chr20, chr21 and chr22,
  starting at 3000001 and spaced 257 bases apart. REF cycles A/C/G/T and ALT
  is the next letter; GT is 1/1 at every third index and 0/1 elsewhere.
  These filler alleles are invented parser inputs, not reference-aligned calls.
- Public report metadata comes only from `data/templates/*.json`: sort the
  146 unique rsIDs numerically, include the 73 at even zero-based indices,
  and leave the other 73 absent. At included positions, keep the catalogue
  coordinate/REF/ALT and invent GT alternating 0/1 and 1/1. Conflicting
  catalogue identities or coordinate collisions cause generation to fail.
- Total: 120,073 variant records, including the catalogue's CFTR indel.
  Listed-call provenance counts 120,072 supported calls and one unsupported
  indel. The pipeline test retains the greater-than-100,000-record and
  every-template-resolution assertions, adds an exact total and rsID set,
  and checks explicit genotyped and not-covered outcomes across all templates.
  This is parser/report integration evidence, not biological accuracy or
  hosted processing capacity evidence.
- Regenerate or verify with
  `corepack pnpm exec tsx scripts/generate-synthetic-vcf-fixtures.ts [--check]`.
  Gzip level 9, timestamp zero, no optional header fields and OS byte 255
  (unspecified), following [RFC 1952](https://www.rfc-editor.org/rfc/rfc1952).
  This fixes the platform-dependent header byte without changing the VCF or
  compressed payload; 499,855 compressed / 4,481,882 decoded bytes.
  No decoded artifact is written. The adjacent receipt pins
  every catalogue source hash, included/absent rsID sets and output hashes.
- Repository SHA-256:
  `46c46da43500f3b1ad5f01524c4ac9bcb52b2bd9a1dcc5b3c33aa8dbbc6a2b44`.

## HG001_GRCh38_chr20-22.vcf.gz

- Historical artifact only: no current browser or pipeline test uses this file
  as genetic input.
  Its old extraction utility remains available for historical reproduction
  and is not invoked by tests or CI. The synthetic pipeline fixture above
  replaces its active parser role as of 15 September 2026.
- Repository SHA-256:
  `3717fc164ef9137a4eec6a2ab48711f2478881ca55fbb230964764be48a78a83`.

- Source: NIST Genome in a Bottle (GIAB), sample HG001 / NA12878 —
  a consented, openly published reference cell line widely used for
  benchmarking.
- Upstream file: `HG001_GRCh38_1_22_v4.2.1_benchmark.vcf.gz`
  from
  <https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/NA12878_HG001/NISTv4.2.1/GRCh38/>
- Upstream SHA-256:
  `93bc4c2c696eaf13515ab058caecc064bfed704f85bac7482330ca91bc730daa`
- Retrieved: 2026-08-28.
- Transformation: header preserved verbatim; body filtered to chromosomes
  chr20, chr21, chr22 (187,130 variant records); recompressed with gzip.
  Reproduce:
  `zcat HG001_...benchmark.vcf.gz | awk '/^#/ {print; next} $1=="chr20"||$1=="chr21"||$1=="chr22" {print}' | gzip -9`
- License/terms: GIAB data are U.S. government works released into the public
  domain (NIST public data; see
  <https://www.nist.gov/programs-projects/genome-bottle>).

## synthetic_23andme.txt

- Repository SHA-256: `77717ccaac2e048a6ca556aace51062e3ad319f47297918577f2d69e4634d0db`.
- Fully synthetic, describing no person. GRCh37 coordinates in 23andMe v5
  text format exercise the shipped liftover path.
- `synthetic-array-recipe.json` pins the original 135 report call rows and the
  filler seed. Its `originalFixtureSha256` identifies the pre-repair file.
  All 2,135 rsIDs and genotypes and all 135 report coordinates are preserved.
- On 22 September 2026, D-133 was repaired by replacing 850 invented filler
  coordinates that the bundled chain could not map. The generator uses a
  separate seeded stream bounded by each chromosome's chain-header length;
  it accepts only mapped, non-colliding positions outside report loci. No
  public benchmark sample or network lookup is used in the repair.
- `corepack pnpm exec tsx scripts/generate-synthetic-sample.ts --check`
  reproduces the committed bytes offline. Omit `--check` to regenerate.
  `scripts/generate-synthetic-sample.test.ts` verifies format detection,
  2,135 parsed records, zero skipped records and zero liftover losses, plus
  the three T1 loci and all eleven deliberately absent T3 medicine loci.
- These are transport and task fixtures, not evidence of biological accuracy
  for all catalogue entries. The original report rows are retained even where
  catalogue coordinates or indel representations need a separate audit.
  The hash-pinned density baseline remains the original capture and is not
  regenerated by this repair. A real browser journey is added in
  `e2e/synthetic-array.spec.ts`; its CI result is pending.
