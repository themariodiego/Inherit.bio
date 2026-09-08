# Selected own-report generation checkpoint

Local implementation checkpoint, 6 September 2026; not a hosted rollout or a
whole-plan acceptance claim. ADR 0024 registers the deliberately bounded
synchronous exception to the generic queued-analysis architecture.

## Useful result and scope

The bodyless file process route now prepares a newly finalized self source,
then generates only its currently selected supported report families. Selecting
`reports.polygenic` enables estimate-layer reports, including the existing
MCM6/lactase interpretation. `reports.monogenic` independently enables
variant-call findings. The existing template resolver produces these results;
the implementation does not invent new interpretations or risk calibration.

Each chosen family gets an exact-source, exact-grant completed record in
`private.own_analysis_runs`. Saving a choice alone does not unlock reports.
Readers require current authority and the matching completion record, not a
global `annotated` flag. The source remains `stored`. Revocation removes that
grant's interpretations and PGS rows without deleting the stored source or an
independent report family's work.

The strict receipt is `{fileId,status:"processed"|"already_processed",
analysisState:"active"}` after supported selected work completes. With no
supported selection, the strict normalization-complete/not-generated receipt
remains unchanged. Ancestry-only selection is saved but not generated here.
Legacy files retain their prior route branch.

## Evidence

- 34 focused runtime tests passed: 12 generation tests and 22 browser-helper
  contract tests. The real template resolver interprets MCM6 AG; provider and
  database boundaries are mocked in these unit tests.
- 34 rollback SQL assertions passed using actual normalization, canonical legal
  artifact signing, independent grant pairs and generation RPCs. No authorization
  resolver is mocked. They cover pre-generation denial, independent purposes,
  claim exclusivity, exact source revision, atomic completion, idempotence and
  withdrawal. GRCh37 observed rows are selected by normalized GRCh38 coordinates;
  distinct raw/decoded hashes demonstrate that gzip provenance uses the raw hash.
  Account lifecycle revision changes invalidate completion; authenticated session
  refresh alone does not require generating results again.
- Existing API column privileges explicitly deny raw scores, z-scores,
  percentiles and coverage fractions; safe matched-position counts remain
  available. PGS writes do not create validated personal numeric outputs.
- Application typecheck and focused ESLint passed. Local security advisors
  reported no warnings or errors.
- Real-browser results are recorded separately by the browser-verification
  owner; the SQL/runtime checks above do not substitute for that evidence.

```sh
corepack pnpm exec vitest run src/lib/uploads/own-report-generation.test.ts src/lib/uploads/subject-upload-browser.test.ts --maxWorkers=2
corepack pnpm exec supabase test db supabase/tests/own_report_generation.sql --local
corepack pnpm exec tsc --noEmit --pretty false
corepack pnpm exec eslint src/lib/uploads/own-report-generation.ts src/lib/uploads/own-report-generation.test.ts
corepack pnpm exec supabase db advisors --local --type security --level warn --fail-on error
```

Migration `20260906143041_own_analysis_generation.sql` was applied to the shared
local `supabase_db_sequence` database after the read-authority prerequisite.
The first attempt rolled back completely on an operator-precedence syntax
error; corrected parenthesized JSON context subtraction then committed once.
No migration history was changed. Do not rerun this migration or reset the shared
database. The completion matcher was subsequently replaced once with its exact
`CREATE OR REPLACE FUNCTION` definition to retain account-revision matching.
No hosted schema, real genome or real account file was accessed.

## Remaining boundary

This is not an ancestry dispatcher, queued worker implementation, other-person
or embryo journey, calibrated polygenic risk model, or report-ready email path.
The prior normalization checkpoint's retry-free scheduled unknown-build object
cleanup and hosted operational gates still need separate evidence. The user can
get supported chosen reports through this slice; those remaining areas must not
be described as finished because the synchronous receipt exists.
