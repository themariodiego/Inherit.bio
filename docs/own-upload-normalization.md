# Own-upload preparation checkpoint

Local implementation checkpoint, 6 September 2026. This is not a hosted release,
whole-journey acceptance receipt, or proof that reports have been generated.

## User-visible behavior

Newly finalized, structurally verified own-account sources use a separate,
bodyless `POST /api/files/[id]/process` path. Current upload/store consent covers
file preparation; no analytic-purpose checkbox is required to normalize a file.
The closed success receipt is:

```json
{"fileId":"opaque-file-id","status":"normalization_complete","analysisState":"not_generated"}
```

An idempotent request returns the same receipt without parsing the source again.
The file remains `stored`, not `annotated`. Its exact `upload_revision` is recorded
in `normalization_source_revision`, together with `normalization_completed_at`.
This deliberately does not activate legacy report readers that consider
`annotated` to mean results are available. Historical files with a null structural
verification timestamp retain the existing legacy processing path.

## Source and authorization boundaries

- The server resolves the current account and signed session; the caller cannot
  supply a source path, bucket, build, processing kind, or a purpose.
- A service-only, operation-specific database RPC verifies the current own
  account/store authority, exact source object reference, byte count, raw and
  decoded hashes, source revision, and a five-minute exclusive processing claim.
- Both source passes use exact partial-content reads of at most the canonical
  4,000,000-byte chunk limit, rechecking live authority before every range. Raw
  and decoded byte hashes must match the finalized source on both passes.
- The first pass resolves build metadata without constructing genotypes. The
  second parses the same source, with a server-resolved decompressed byte ceiling
  and bounded line size. GRCh37 calls use the bundled chain, with the canonical
  registered unmapped-fraction limit rather than a route-local threshold.
- Each canonical batch is authorized again in its database transaction. Partial
  batches remain in private, file-owned staging tables; they are not canonical
  rows. One final transaction checks authority, source identity and exact batch
  counts, then publishes the whole normalized source.
- Normalization does not create grants, worker jobs, ancestry results, PRS,
  runs-of-homozygosity measurements, report-ready status, or mail.

## Failure and recovery

A normal failure discards only the exact run's unpublished batches and makes
preparation retryable. An uncertain terminal response cannot discard committed
canonical rows. The existing retention POST invokes a bounded reaper for at most
five expired runs, removing private genetic working rows while preserving source
objects and completed siblings. Both private stores are registered in the
source/variant purge catalog and cascade with file deletion.

An unknown-build source is rejected before the genetic parse pass. Its exact
object is frozen as a cleanup target, made non-current, removed through Storage,
and independently checked for metadata absence. Only then does the route return
the canonical `build_unknown` refusal. An interrupted removal can resume through
the same process route without fetching the source again. The rejected file
keeps a closed `build_unknown` error and a purged object reference, not a current
source or normalized rows.

## Verification at this checkpoint

Commands run locally:

```sh
corepack pnpm exec vitest run src/app/api/jobs/retention/route.test.ts src/lib/uploads/normalization-cleanup.test.ts src/lib/uploads/subject-normalization.test.ts --maxWorkers=2
corepack pnpm exec supabase test db supabase/tests/own_upload_normalization.sql --local
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm exec eslint src/lib/uploads/subject-normalization.ts src/lib/uploads/subject-normalization.test.ts src/lib/uploads/normalization-cleanup.ts src/lib/uploads/normalization-cleanup.test.ts src/app/api/jobs/retention/route.ts src/app/api/jobs/retention/route.test.ts
corepack pnpm exec supabase db advisors --local --type security
```

Results: 32 focused runtime tests and 37 rollback-only SQL assertions passed;
application typecheck and scoped lint passed; security advisors reported no
issues. SQL tests use synthetic metadata, not physical user files. Runtime tests
mock provider boundaries and do not replace real browser/Storage verification.
The parallel real-provider browser test is a separate receipt.

Migration `20260906134636_own_upload_normalization.sql` was applied once to the
shared local `supabase_db_sequence` database using direct SQL in one transaction.
The subsequently appended finite reaper functions were applied separately, once.
There are **no migration-history entries** for these applications. Do not rerun
the whole migration or reset the shared database. No hosted schema or service
was changed, and no real genome or account file was read, reprocessed or deleted.

## Remaining release gates

1. Current self-purpose grants must lead to their independently authorized,
   source-bound analytic jobs. Neither normalization nor the purpose grant
   handler currently supplies a complete analytic dispatcher. Do not label this
   checkpoint as report generation or full-plan acceptance.
2. Rejected-build object cleanup has request retry, but a retry-free scheduled
   drain for interrupted provider deletion is still required. The finite private
   batch reaper does not remove source objects and must not be represented as
   covering that separate operation.
3. Hosted signing/capacity configuration, a verified machine invocation schedule
   for the existing retention POST, broader source/account purge behavior, and
   end-to-end physical Storage cleanup need their own release evidence.
4. Generated database types still need reconciliation with both parallel
   migrations. The normalization runtime currently uses a narrow typed adapter
   exposing only its named service RPCs; it does not broaden client permissions.
