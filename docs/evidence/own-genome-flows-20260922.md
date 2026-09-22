# Overview and own-genome upload audit

Owner request, 22 September 2026: verify `/overview` and `/genome/me`, including
the formats and sizes people can use. This is an in-progress audit, not a
production-readiness claim or evidence that all release rows are complete.

## Reproduced and repaired

- gVCF identification searched for a free-text `<NON_REF>` substring. It missed
  an explicit `##ALT=<ID=NON_REF,...>` declaration when the first data record
  was outside the sniff window, and did not recognize the standard `<*>`
  spelling. The detector now uses ALT declarations and data-column tokens.
- `<*>` reference blocks could become single-position reference calls. Both
  unspecified-allele spellings now follow the same parser rules. Interval
  metadata also prevents a reference anchor from becoming a point call.
  A called literal alternate remains available; an unresolved allele does not.
- A consumer CSV header split across decompression chunks could be recognized
  prematurely as a laboratory table. The detector now waits for the complete
  header before choosing either table format. The gzip FamilyTreeDNA case
  reproduced this failure before the fix.

The gVCF changes follow the [VCF specification, section 5.5](https://samtools.github.io/hts-specs/VCFv4.5.pdf)
and the [GATK gVCF format description](https://gatk.broadinstitute.org/hc/en-us/articles/360035531812-GVCF-Genomic-Variant-Call-Format).
They do not turn reference blocks into inferred genotypes or claim support for
all VCF structural-variant interpretations.

## Verification scope

Synthetic calls at three GRCh38 positions are represented in all four consumer
array formats, VCF, and both gVCF spellings. Unit tests exercise plain, gzip
and concatenated gzip members, exact original and decoded hashes, identical
genotypes, an exact decoded-size boundary and a one-byte-over refusal. Separate
regressions cover long headers, false format hints and block-only records.

The browser suite adds fourteen actual journeys: each representation in plain
and gzip form. They start from Overview or My Genome, follow the upload link,
complete consent, upload through the real Storage provider, prepare, check the
original bytes and absence of unchosen analysis grants, follow Overview's
report-choice link, explicitly generate a report, and read its exact synthetic
genotype through My Genome. Test discovery is not execution; their CI result
must be checked on the pushed head before claiming these journeys passed.

## Production observations and remaining work

Read-only queries of production configuration on 22 September 2026 returned:

| Setting | Observed value |
| --- | --- |
| Array file ceiling | 25,165,824 bytes (24 MiB) |
| VCF file ceiling | 25,165,824 bytes (24 MiB) |
| gVCF ceiling | null; uses the VCF ceiling |
| Account reservation ceiling | 134,217,728 bytes (128 MiB) |
| Concurrent uploads | 2 |
| Hosted preparation enabled | false |
| Hosted artifact cap | 104,857,600 bytes |
| Hosted job deadline | 900 seconds |

The queries selected only these configuration fields from
`private.upload_authorization_config` and `private.own_preparation_config`.
No production mutation, source read, upload or deployment was performed.
Disabled hosted preparation does not mean small-file synchronous preparation
is disabled; it means the large-file hosted path has not been activated.

The repository accepts extracted consumer text/CSV and gzip, not ZIP archives.
This matters because consumer downloads can arrive as ZIP-wrapped text files
(23andMe Customer Care, “Accessing Your Raw Genetic Data,” read 22 September 2026).
ZIP intake remains work to do. BAM/CRAM/FASTQ and BCF are not admitted by the
current upload contract; raw-read calling is a separate capability, not a file
extension to add to the picker.

Larger-file production readiness remains bounded by the hosted proof. PR #185
adds transport-safe disclosure/refusal without raising safety bounds; the
768 MiB journey remains skipped for missing preview credentials. Neither small
synthetic fixtures nor configuration reads prove large-file throughput, memory,
artifact capacity or deadlines. No size ceiling was raised in this change.
