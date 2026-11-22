# Production read-backs

Nothing in this directory comes from production yet. No production or remote
database was contacted while this kit was built and rehearsed.

This release's production pre-state is PR 324's rehearsed batch-4 post-state
(`../../pr324-production-apply-20261022/guarded/expected-summaries.json`). PR 324's
release has not run yet; when it does, its `results/run-<UTC date>/` must show the
batch-4 post read-back EQUAL and the ledger 273 rows, max `20261016221000`, before
this release starts (`../api/RUNBOOK.md`, step 0).

The release session adds its own `run-<UTC date>/` directory here
(`../api/RUNBOOK.md`, step 8).
