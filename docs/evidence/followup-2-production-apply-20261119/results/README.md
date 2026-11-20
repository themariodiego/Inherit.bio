# Production read-backs

Nothing in this directory comes from production yet. No production or remote
database was contacted while this kit was built and rehearsed, and nothing here is a
production result or an approval.

The kit's first rehearsal found that `20261025400000` refused on the state production
will hold after the follow-up's release; the file's guard was revised and the kit
rehearsed again (`../guarded/README.md`, "The defect the first rehearsal found, and the
fix"). Both rehearsals were local.

This release's production pre-state is the follow-up kit's rehearsed batch-2
post-state (`../../followup-production-apply-20261023/guarded/expected-summaries.json`).
The follow-up's release has not run yet; PR 324's has not run either. When the
follow-up's release runs, its `results/run-<UTC date>/` must show the batch-2 post
read-back EQUAL and the ledger 280 rows, max `20261023140000`, and code carrying its
migration tree must be merged and deployed with the fingerprint still EQUAL, before
this release starts (`../api/RUNBOOK.md`, step 0).

The release session adds its own `run-<UTC date>/` directory here
(`../api/RUNBOOK.md`, step 8).
