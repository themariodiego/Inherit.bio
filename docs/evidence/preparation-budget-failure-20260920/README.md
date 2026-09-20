# Artifact-budget failure release verification — 20 September 2026 (decision 31a)

**Status: prepared, not applied.** The preflight below was read against the
Inherit project and is clean; the DDL guard, the postflight expectation and the
rollback-only probe are written and reviewable. Nothing has been applied to
production and nothing here claims otherwise. The apply waits on PR #153
merging and on the deployment that carries the code reaching READY, because the
status response's schema is strict and the app must accept the new `reason` key
before the database can send it — the order the gVCF ceiling release set out.

## What the migration does

`supabase/migrations/20260920150000_own_preparation_budget_failure.sql` adds
`private.own_preparation_jobs.frozen_reason` (nullable text, closed set),
creates `fail_own_preparation_claim_v1` in both schemas so a claim holder can
end its own attempt and say why, and replaces two existing bodies: the identity
guard, which learns the new column and makes it write-once, and the status
function, which emits a `reason` key only when one is recorded.

Not additive in text, but additive in effect. Each replaced function gains
exactly one rule that no path can reach until the new function is called: the
write-once clause can only fire on a row that already carries a reason, and the
status answer stays byte-identical for every job without one. Production has
**zero** preparation jobs, so at apply time no row can carry either.

## The preflight found a fault, and it was in the migration

`preflight.json` records, for each replaced function, both the deployed
`md5(prosrc)` and the md5 of the repository source that should be deployed.
Both match, so production has not drifted.

That comparison is here because it caught a real fault. The guard replacement
was first written from `20260908185537_own_prepared_publication.sql` while
`20260908233337_own_prepared_r2_provider.sql` is what production runs.
`create or replace` takes whatever body it is given, so applying that draft
would have **reverted three protections** the later migration added: published
rows mutable again, a job publishable from a state other than `claimed`, and
`provider_version` and `provider_etag` out of the artifacts row's mutable set.
Nothing in the migration's diff would have shown it, because the whole body is
one replacement.

CI confirmed two of the three independently on run 35519879598 — the first run
to see that draft, after three pushes produced no run at all on a pull request
GitHub could not compute a merge commit for. `own_prepared_publication.sql`'s
test 41 "published job cannot be reopened" caught no exception where it wanted
`22023`, and the R2 ACK's own UPDATE began raising the guard, aborting
`own_prepared_r2_provider.sql`, `own_prepared_cleanup.sql` and
`own_prepared_original_retirement.sql`. Nothing failed for the third rule,
because `(new.state='published' and old.state<>'claimed')` is written only by
`publish_own_prepared_manifest_v1`, which publishes a job it has claimed; the
pgTAP file now carries the case that reaches it.

`docs/hosted-preparation-activation.md` gains the rule this produced: diff a
`create or replace` against the deployed body before applying it, and take the
*latest* migration defining the function, not the one it is most associated
with.

## Files

| File | What it is |
| --- | --- |
| `preflight.json` | The read-only reading, 2026-09-20T15:57:02Z. Ledger 117 rows ending `shared_report_readiness_completed_runs` (`20260918231857`); `20260920150000` absent; `frozen_reason` absent; `fail_own_preparation_claim_v1` absent from both schemas; the four grant roles present; `private` owned by `postgres`; **0 jobs, 0 artifacts**; preparation disabled at `max_artifact_bytes` 104,857,600, `max_job_seconds` 900, provider `supabase`. |
| `ddl-guard.sql` | Read-only. Raises unless the project still matches that preflight, including both replaced bodies by md5, length, ACL, owner, definer flag and `search_path`. Run in the same minute as the apply. |
| `expected-prosrc.json` | The md5 and length of all four bodies as the migration installs them, for the byte-equal postflight. |
| `probe.sql` | Bounded, rollback-only. 15 checks on random identities that match no row. Pins the three guard rules the wrong base would have dropped, the two it adds, the status function's conditional key, the column and its check constraint, the privileges, three refusals, and that nothing was written. |

The probe's authority refusal expects `55000 preparation_disabled`, not `42501
not_found`, because `check_own_preparation_claim_v1` tests the enabled flag
first and production is still disabled. The two argument refusals are checked
before authority and read the same either way.

## What remains

1. PR #153 merges on green CI, with an exact-head guard.
2. The production deployment of that commit reaches READY on `www.inherit.bio`.
3. `ddl-guard.sql` passes against the Inherit project.
4. The migration is applied; the postflight is read and compared to
   `expected-prosrc.json` byte for byte; the probe runs and its receipt is
   recorded here as `postflight.json` and `probe-receipt.json`.
5. This README's status line changes from *prepared* to *released*, with the
   merge commit, tree, deployment and hosted ledger version filled in.

Activation of the prepared path and the ceiling raise are a **separate**
release (`docs/hosted-preparation-activation.md` steps 8 and 9) and are not
part of this one. Applying this migration changes no limit, enables nothing and
moves no acceptance-matrix row.
