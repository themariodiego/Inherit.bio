# Browser-test genome fixture provenance

These fixtures are deterministic synthetic test data. They describe no real
person and must never be replaced with customer, patient, or personal genome
data.

## tiny-grch38.vcf

- Classification: synthetic VCF assembled solely from four public variant
  coordinates and invented genotype calls.
- Repository SHA-256:
  `14b26f8edac8d3697802afac5e0fc63e303afcd4a9173cb274984941f57d556b`.

## tiny.bam

- Classification: synthetic 14 MiB compressed byte stream used only to test
  interrupted and resumed upload transport. It is not a biological alignment.
- The file is intentionally ignored by Git and generated afresh in
  `e2e/tier2-upload.spec.ts`; there is no committed binary fixture to hash.
