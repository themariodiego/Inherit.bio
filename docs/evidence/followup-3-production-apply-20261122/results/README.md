# Production read-backs

Nothing in this directory comes from production yet. No production, hosted or remote
database was contacted while this kit was built and rehearsed: no Supabase API, no
`supabase link`, no Management API request, no token. Nothing here is a production result
or an approval.

The kit was rehearsed on an isolated local stack only (`relk4`, 127.0.0.1:58322), against
a mirror that reproduces release 3's recorded post-state byte for byte, production's
recorded drift included (`../guarded/README.md`, "The mirror the batches were rehearsed
on"). Every one of the 21 migrations applied there in order, and every batch read back
EQUAL.

This release's production pre-state is release 3's rehearsed batch-2 post-state
(`../../followup-2-production-apply-20261119/guarded/expected-summaries.json`). None of
releases 1, 2 and 3 has run yet. When release 3 runs, its `results/run-<UTC date>/` must
show the batch-2 post read-back EQUAL and the ledger 284 rows, max `20261025400000`, and
code carrying its migration tree must be merged and deployed with the fingerprint still
EQUAL, before this release starts (`../api/RUNBOOK.md`, step 0).

The release session adds its own `run-<UTC date>/` directory here
(`../api/RUNBOOK.md`, step 8).
