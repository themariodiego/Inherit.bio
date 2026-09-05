# Observed reference calls in reports

This change recovers literal single-position VCF reference genotypes for report
interpretations and personal previews. A recorded `0/0` is an observation;
an absent position is not. It adds no disease claim or risk model.

`report_observed_calls` is a report-only projection, separate from
`user_variants` and the variant-only ancestry, carrier-pair and PRS inputs.
The original `referenceCalls`/ROH behavior is unchanged. Eligible alternate
observations are also projected so failed-quality or conflicting rows cannot
be hidden by a legacy variant row at the same report position.

## Evidence contract

- One declared sample; exact rsID; distinct literal A/C/G/T REF and ALT;
  positive point coordinate; diploid `0/0`, `0/1`, `1/0` or `1/1`, phased or
  unphased; a known GRCh37/38 source build.
- GRCh37 points use the existing strand-aware chain normalization to GRCh38.
  Source locus, REF/ALT and original GT remain alongside normalized evidence.
- Symbolic/multiallelic/indel ALT, interval END/SVLEN/LEN, undeclared or multiple
  samples and missing rsIDs produce no new supported reference finding. No
  gVCF interval expansion or inference from unmentioned positions occurs.
- Literal SNP rows with unusable GT or explicit site/sample FILTER failure
  remain unusable evidence. A report cannot use a duplicate good row to hide
  them. FILTER, FT, GQ and DP are retained when provided; missing optional
  quality stays unknown. No numerical quality threshold is invented, and a
  site PASS is not independent laboratory validation.
- This does not validate the legacy first-sample-only variant parser. Its
  existing outputs are not relabelled as newly validated observations.

The server hashes the original byte stream, before decompression. The file's
completion hash/version are cleared before source reads and set with its
annotated status only after all writes succeed. Readers require matching
completed hash, version and source build. Failed/partial extractions cannot
supply new findings. Deterministic pagination exhausts every matching file and
row; a later-page error discards the entire result rather than hiding conflicts.

## Ownership, deletion and delivery

The composite file/owner/subject FK prevents attaching evidence to another
file's identity and cascades exact file deletion. Direct client writes are
revoked; owner SELECT uses a caller-bound private predicate over current file
completion and active subject ownership. Admin report reads remain behind the
existing subject authorization. No source rows, GT quality or hashes are sent
in personal-preview client props.

These canonical observed genetic rows are registered under the existing
`variant-rows` source-retention target. Their subject/file joins and cascade
cover current and legacy paths without a Storage-prefix inference. They add no
new retention clock. The account deletion graph continues to accept the
file-owned child table.

Apply the additive migration before deploying the reader/writer. It performs
no historical data rewrite. New processing and the existing owner-authorized
process rerun populate the projection idempotently from retained source bytes.
No new route, reprocess button or automatic private-data backfill is introduced.
Legacy uploads require a deliberate rerun; derivative-only batch backfill,
gVCF blocks, ALT `.` records and missing-rsID coordinate lookup are follow-ups.
Data browser, carrier-pair and export's legacy per-file resolver are unchanged
and do not yet acquire the additional reference observations.

## Verification

On main59 plus this change, 1,635 unit tests, 752 rollback-only SQL assertions
and five production-build browser tests pass. Browser checks use invented
genotypes only and prove literal VCF reference results match supplied array
calls, with no reference rows entering variant-only analyses. The existing
alcohol GG test now expects the supported VCF result before its agreeing array
upload. Typecheck, scoped lint, fixture provenance/name/secret gates, template
validation and readability checks pass. No hosted migration or automatic
historical processing was performed.
