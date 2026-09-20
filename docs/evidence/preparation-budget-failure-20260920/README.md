# Artifact-budget failure release verification — 20 September 2026 (decision 31a)

**Status: released, 20 September 2026.** PR #153 merged as `75d71f7`, the
production deployment carrying it reached READY and took `www.inherit.bio`, the
DDL guard passed at 18:28:56 UTC, the migration applied as hosted version
`20260920182946`, and a rollback-only production probe passed **17/17** at
18:32:24 UTC. No limit moved, preparation is still disabled, and production held
zero preparation jobs and zero artifacts throughout.

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

## What was done, in order

| Step | Evidence |
| --- | --- |
| PR #153 merged | `75d71f7083448ba2e5acd83172160b8d60e04bab`, tree `1484d3e23d780c84e8b67261243652b639332968`, equal to the tested head `84691b6` |
| CI on that head | run 35524128507, green, including the pgTAP case for the guard rule nothing else covered |
| App deployed first | `dpl_8H7jmEUCuLfFoc22GQx2WBH8qJAC` (`75d71f7`) READY 18:11:40 UTC; then `dpl_Gw9U8hB6Axwse2HeezbeY6bXDMx4` (`a7a5003`, PR #156 on top) READY **18:13:30 UTC**, aliased to `inherit.bio` and `www.inherit.bio`, `aliasError: null`. The status schema in `src/lib/uploads/own-preparation.ts` is `.strict()` and carries `reason: z.literal("artifact_budget_exhausted").optional()`, so the app accepts the key before the database can send it |
| DDL guard | passed **18:28:56.617 UTC** — ledger 117 rows ending `shared_report_readiness_completed_runs`, both replaced bodies at their reviewed md5, the new function and column absent, four dependency functions and four grant roles present, `private` owned by `postgres`, **zero** jobs |
| Migration applied | hosted version **`20260920182946`**, name `own_preparation_budget_failure`, ledger 117 → 118. Source file SHA256 `fc4cccca25faf0a43b50bc134d0927c7bb3a337426f52b521008aad529749401`, 13,407 bytes |
| Postflight | read 18:30:04.727 UTC — **three of four byte-equal, one not**; corrected, then all four equal (below) |
| Probe | **17/17** at 18:32:24.333 UTC, `probe-receipt.json` |

## The postflight caught something, which is what it is for

On the first read, `private.fail_own_preparation_claim_v1` was **1,099 bytes at
md5 `2e6f412e740bbc715303ead0fcc699b5`** against the expected **1,754 at
`972630d8bcd79fd5c78933c7385df94e`**. The other three were byte-equal.

The cause was in the apply, not the migration: the statement sent to the
management API had the three explanatory comments dropped from inside that
function's body while the call was being composed. Comments inside a function
body are part of `prosrc`, so the deployed source differed from the repository
by 655 bytes **with identical behaviour** — no clause, no condition and no
refusal differed. `gate:schema-drift` compares exactly that text, so it would
have flagged the project as drifted on its next run.

Corrected with a `create or replace` carrying the repository body verbatim,
rather than a second migration: the migration was already in the ledger under
its own name, and a new ledger row with no file behind it is worse drift than
the one being fixed. `create or replace` preserves a function's privileges, so
`service_role` survived on both new functions, which the final read confirms.
All four bodies then matched `expected-prosrc.json` exactly.

It is recorded here rather than quietly fixed because a byte-equal postflight
that is only run when it is expected to pass is not a check.

## What this release did not do

Activation of the prepared path and the ceiling raise are a **separate**
release, `docs/hosted-preparation-activation.md` steps 8 and 9. This migration
changed no limit, enabled nothing and moved no acceptance-matrix row:
`own_preparation_config` is still `enabled=false` at `max_artifact_bytes`
104,857,600, and the matrix stands at 38 YES / 27 NO before and after.
