# Read-calling test files: provenance

Every file here is invented. No read, letter, position or name comes from a
person, a customer file, a benchmark sample or a real genome. They exist to
test Inherit's targeted read caller (G7.4, ADR 0038), and nothing in the
product reads them.

## The matrix (in-repository generator)

`scripts/generate-read-calling-fixtures.ts` writes these four files. Rerun it
with `--check` to verify them:
`corepack pnpm exec tsx scripts/generate-read-calling-fixtures.ts --check`.
`scripts/read-calling-fixtures.test.ts` checks that the committed bytes equal
a fresh run, and that each receipt pins its file's SHA-256.

- `synthetic-reference.fa` holds three invented 1,500-letter contigs, named
  `chr20`, `chr21` and `chr22`, from a seeded pseudo-random generator
  (mulberry32, seed `0x1a2b3c`). The names are only labels that the VCF path
  accepts. The letters are not those chromosomes, and the sequence
  dictionary's assembly tag says `synthetic-reference-v1`, so the caller
  refuses these contigs as GRCh38.
- `synthetic-matrix.bam` and `synthetic-matrix.cram` hold the same 167
  planted reads. The BAM uses BGZF with stored (uncompressed) DEFLATE blocks.
  The CRAM is CRAM 3.0 with raw blocks, made against the reference above.
  Both are therefore byte-deterministic on any zlib.
- `synthetic-matrix.receipt.json` holds the file hashes, the thresholds the
  truth assumes, and the planted truth for ten positions: 0/0; 0/1 at a second
  alternate; 0/1; 1/1; too few reads; low-quality and flagged reads that must
  not count; no reads; paired reads that count once; a deletion across the
  position; and a fraction between the bands. The generator writes the truth
  from its plan, never by running the caller.

## The htslib cross-check (`htslib/`)

htslib is an independent BAM/CRAM implementation. These files were written
by htslib once, on 22 October 2026, so that Inherit's readers are tested
against files they did not write. The writer was pysam 0.24.1 from PyPI
(htslib 1.24, samtools 1.24), in a scratch virtual environment outside the
repository and outside every CI job. `htslib/recipe.py` is the exact recipe.
Its sources are the matrix BAM and reference above.

- `htslib-matrix.bam` holds the matrix reads, compressed by htslib.
- `htslib-matrix-3.0.cram` holds the matrix reads as CRAM 3.0. It uses gzip
  and rANS order-0 blocks, which is htslib's CRAM 3.0 default.
- `htslib-matrix-3.1.cram` holds the matrix reads as CRAM 3.1, with rANS
  4x16. Inherit's reader must refuse it by name.
- `htslib-qualities-3.0.cram` holds 6,000 invented reads copied from the
  invented reference. Their qualities drift, so htslib chooses rANS order 1
  for the quality block.

`htslib/htslib-cross-check.json` pins each file's SHA-256, its record count
and the SHA-256 of htslib's own reading of its records.
`src/lib/genome/reads/readers.test.ts` requires Inherit's readers to produce
the same digest. The recipe replaces each CRAM header with the source's own
header, so no local path is stored, and writes by bare name, so the CRAM file
id holds no path either.
