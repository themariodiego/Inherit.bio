# Production read-backs

Nothing in this directory comes from production yet. No production or remote
database was contacted while this kit was built and rehearsed.

The kit's production pre-state comes from the PR 323 release run of 22 October 2026,
`../../pr323-production-apply-20261016/results/run-2026-10-22/`:

- `fp-after-merge.json`: production's full fingerprint after PR 323 merged, EQUAL to
  PR 323's batch-4 post-state. It is this release's batch-1 pre-state.
- `ledger-4.body`: 248 rows, max `20261011010251`.
- `prechecks.json`: production's table sizes at the time.

The release session adds its own `run-<UTC date>/` directory here
(`../api/RUNBOOK.md`, step 8).
