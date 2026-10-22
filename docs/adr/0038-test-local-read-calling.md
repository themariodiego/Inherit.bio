# ADR 0038: Calling genotypes from BAM or CRAM reads on the device, under TEST-LOCAL only

- Status: Accepted for TEST-LOCAL by owner decision (16 October 2026, "BAM/CRAM
  read calling and the Neanderthal estimate (G7.4)"); production stays off.
- Date: 2026-10-22
- Narrowly extends ADR 0016 (closed genetic formats) and ADR 0031 (local
  browser handling before upload). Server formats, transport, consent,
  authority and limits do not change.

## Context

ADR 0016 closed the genetic formats. BAM, CRAM and FASTQ are not accepted, and
"alignment, variant calling, BAM/CRAM storage, FASTQ ingestion, and a Tier-3
worker are outside the accepted product contract unless a later ADR and
route-register change add a closed format, authority, lifecycle, and verified
execution path". The capability register row "Sequence ingest (BAM, CRAM)"
was `not shipped` for that reason.

The owner decided to build BAM/CRAM calling instead of withholding it, and to
test it on synthetic data. The capability stays TEST-LOCAL only. Production
keeps today's behaviour: the file is refused before any upload session is
issued, and the reason is shown.

The product reads genotypes at fixed positions only. Nothing downstream needs
reads, or genome-wide variant discovery. It needs canonical observed calls at
the positions its reports, ancestry panel and carrier rules use.

## Decision

1. **Where it runs.** On the person's device, in the own-DNA picker, only when
   the server page says `readCallingBuilt()` (that is,
   `isTestJurisdictionEnabled()`). The browser reads the BAM, or the CRAM and
   the reference FASTA chosen with it. It calls genotypes and hands the
   resulting single-sample VCF to the unchanged upload. The reads and the
   reference are never sent or stored. No server route, declared format,
   format list, size limit or migration of the ingest path changes.
   `api.file-upload-session` still refuses `BAM` and `CRAM` declarations with
   422, and finalization still refuses and cleans up a misdeclared BAM or CRAM
   with 415.
2. **What it reads.** BAM is read front to back with no index
   (`src/lib/genome/reads/bam.ts`). CRAM 3.x is read the same way
   (`src/lib/genome/reads/cram.ts`), with raw, gzip and rANS 4x8 blocks. These
   are what htslib writes for CRAM 3.0 by default. Any other block method
   (CRAM 3.1's rANS 4x16, arithmetic coder, fqzcomp and name tokeniser, or
   bzip2 or lzma) is refused by name. A CRAM is rebuilt only against the
   reference whose sequences match every `@SQ` M5 and length.
3. **Where it calls.** Only at `data/ref/read-calling-loci.json`, which
   `scripts/generate-read-calling-panel.ts` builds and a unit test pins. It
   holds 2,024 GRCh38 positions: every single-letter report-template variant
   (145), every ancestry marker (168) and every single-letter carrier
   assertion (1,716). Only reads aligned to GRCh38 are called, judged by the
   file's own chromosome 1 length and `AS` tags. The panel is GRCh38, and
   Inherit does not move alignments between builds.
4. **How it calls.** The rule and thresholds are in
   `src/lib/genome/reads/thresholds.ts`:
   - a read counts only if it is mapped, primary, not a duplicate, not a
     quality-check failure and not supplementary, with mapping quality 20 or
     more;
   - a base counts only if its quality is 20 or more;
   - two reads of one fragment count once;
   - at least 10 counted reads are needed;
   - no more than a tenth of the reads may show other letters;
   - the alternate fraction decides the call: 0/0 at 0.10 or less, 0/1 from
     0.25 to 0.75, and 1/1 at 0.90 or more;
   - anything else is `./.`.

   A position that no read overlaps is left out of the VCF, so the product
   says "not covered" there, as it does for any VCF that does not list a
   position. These thresholds are **engineering defaults pending scientific
   review**. No scientist has reviewed them, and nothing presents them as
   reviewed: `reviewed` is the literal `false`.
5. **What it says.** The VCF header names Inherit's read caller, the input
   format and every threshold. It says in plain words that Inherit called
   these genotypes from sequencing reads it did not generate. The server's
   normalization records a closed `readCalls` object in the canonical
   provenance only when two things hold: the deployment is TEST-LOCAL, and
   the header is the caller's exact three lines, once each. Production never
   records it. Migration `20261022110000_read_called_input_provenance.sql` is
   an md5-guarded in-place patch, approved by the integrating session on 22
   October 2026. It projects that object into
   `private.read_own_input_sources_v1`'s display object, and only in its
   closed shape. The report surfaces then say "Inherit called these genotypes
   on your device from sequencing reads it did not create", give the
   thresholds and say they are not reviewed. They do not say "Inherit did not
   create these files" for that source.

## Why production stays off

- **The reference.** A CRAM is a set of differences from one exact reference.
  For a human file that is usually the GRCh38 analysis set, about 3.1 GB
  (`GRCh38_full_analysis_set_plus_decoy_hla.fa`, or the assembly the file's
  M5 values name). A browser tab cannot hold it, and this reader keeps a
  reference in memory and caps it at 64 MB. Fetching sequences by M5 from a
  public reference server would send identifiers off the device. Hosting the
  analysis set, or reading an indexed FASTA (`.fai`) in ranges, are both open
  engineering work. The synthetic tests use an invented 4.5 kB reference.
- **The thresholds.** They are unreviewed engineering defaults.
- **Scale.** A whole-genome BAM is 50 to 150 GB. Reading it front to back in a
  tab, with no `.bai` or `.crai` index, has not been measured, and has not
  been shown to be workable.
- **Validation.** Only invented reads have been called. No real
  laboratory file and no truth set has been compared.

## Not covered by this decision (open work)

- Polygenic-score positions. The score files name an effect letter and
  another letter without saying which one is the GRCh38 reference.
- Lineage markers on Y and MT. These are one-copy calls, which this diploid
  rule does not make.
- Carrier assertions that are not single letters, and the 64 single-letter
  ones without an rsID. A reference call there is not listed as an observed
  call, as in any VCF without an ID.
- CRAM 3.1 codecs.
- Indexed range reading.
- GRCh37 alignments.
- The Family and health-picture readers. They show a relative's sources
  without the canonical display read, so for a read-called file under
  TEST-LOCAL they still show `INPUT_PROVENANCE_COPY.external`.

## Alternatives

- **Server-side calling from a stored BAM.** Rejected for this slice. It needs
  BAM/CRAM as declared formats, a new stored-source representation and new
  file types across issuance, finalization, normalization, preparation and
  about eight readers that refuse any `file_type` outside the VCF and array
  set. It would also store reads, which ADR 0016 excludes.
- **Withholding.** The owner chose to build instead.

## Verification

- **Planted truth.** `src/lib/genome/reads/caller.test.ts` compares every
  planted position of the invented matrix with its truth, for the in-repo BAM,
  the in-repo CRAM and htslib's CRAM.
- **Sensitivity.** Loosening any threshold or filter breaks the truth.
- **Readers.** `src/lib/genome/reads/readers.test.ts` reads htslib's BAM and
  CRAM 3.0 (gzip, rANS order 0 and order 1) exactly as htslib reads them, and
  refuses CRAM 3.1.
- **Pipeline.** `src/lib/genome/reads/read-calls.test.ts` hands the VCF to the
  server's structural validator, listed-call counter and incremental
  normalizer, and compares the staged canonical rows.
- **Upload.** `src/lib/uploads/subject-upload-read-calls.test.ts` shows that
  only the VCF is declared and sent.
- **Provenance writer.**
  `src/lib/uploads/subject-normalization-read-calls.test.ts` shows that
  production never writes `readCalls`.
- **Database.** `supabase/tests/read_called_input_provenance.sql` shows the
  projection is byte-identical for ordinary sources and drops every malformed
  shape.
- **Browser.** `e2e/read-calls.spec.ts` uploads the synthetic BAM and renders
  the reports. `e2e/read-calls.nojurisdiction.spec.ts` shows that production
  still refuses.
