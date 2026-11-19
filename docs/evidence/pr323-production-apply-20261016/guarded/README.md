# Guarded production release of PR 323's 90 migrations

Production gets the 90 migrations that `08a33a0b` adds over main `c993dea8`, in four
atomic batches, **before** PR 323 merges. Each batch is one `DO` statement built like
the 25 September precedent
(`docs/evidence/export-persistence-production-apply-20260925/`): integrity, predecessor
checks, the migrations verbatim, a postcheck, then the ledger rows. Its
`-dry-run.sql` twin is byte-identical except for one line that raises
`DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, so it rolls back.

Everything here was generated and rehearsed locally. No production or remote system
was contacted.

## Files

| File | Role |
| --- | --- |
| `generate.py` | Reproducible generator (`python3 -I generate.py measure`, `record <psql output>`, `final`). Reads every migration with `git -C /home/user/Inherit.bio show 08a33a0b:<path>`, derives the 90 from `git ls-tree` of 08a33a0b against c993dea8 (and refuses if any of main's 155 files differs). |
| `batch-k-apply.sql`, `batch-k-dry-run.sql` | The four batches and their dry runs. |
| `all-batches-dry-run.sql` | All four batches, each with its postcheck and ledger rows, in one transaction that ends in the dry-run raise. Lets production prove every batch against its own data before batch 1 commits. Never an apply. |
| `expected-summaries.json` | Per batch: versions, expected pre- and post-state fingerprint summaries. |
| `fingerprint.sql` | Byte copy of the reviewed read-back query (SHA-256 `d5c4d245…916e`), embedded verbatim (md5-checked) in every block. |
| `check-readback.py` | Compares a `fingerprint.sql` read-back with a batch's expected pre/post summary. |
| `production-readonly-prechecks.sql` | One read-only SELECT: session, ledger, the data predicates that would make a migration refuse, registry md5s, table sizes, and context counts. |
| `SHA256SUMS` | SHA-256 of every file above and of the four `local/` probes (not of this README). |
| `local/` | Local-only: `measure-all.sql`, per-batch lock probes, measured summaries. Never for production. |
| `../rehearsal/` | Local evidence: mirror build, rehearsal and stage scripts, logs (`logs/`), and the rejected preferred-cut files and logs (`default-cut/`). |
| `../compat-analysis.md` | The deploy-window compatibility analysis. |

## What each block does, in order

1. **Session guards.** Refuses unless `current_user` is `postgres` (#68 refuses
   otherwise too) and the session's `statement_timeout` is set and at most 180 s.
   Then `set_config('statement_timeout','180s',true)` and `lock_timeout` `10s`, and
   the six deparse settings `fingerprint.sql` pins. Observed locally: a
   `statement_timeout` set inside a DO block does not bound the DO already running
   (a 3 s sleep under an in-block 1 s timeout completed), while `lock_timeout` set
   in-block does apply. And when `timeout` kills `psql`, the server keeps going:
   a DO that slept 5 s after its client was killed at 2 s still committed. So the
   180 s bound has to be armed by the session before the statement starts, which is
   what the guard enforces.
2. **Integrity.** md5 of the embedded `fingerprint.sql` and of every embedded
   migration must equal the file's. Every migration sits in its own dollar quote,
   `$inherit_m_<version>$`; the generator asserts no tag occurs in any embedded text.
3. **Predecessors.** Ledger row count and max version exactly as expected for the
   batch (158 rows / max 20260930236000 before batch 1; the full version list is never
   asserted because early production versions differ from file names), no version of
   this or a later batch present, and every earlier batch's (version, name) present.
   Then the full fingerprint summary, computed in the block, must equal the expected
   pre-state: for batch 1 the production summary read on 15 October, for later batches
   the rehearsed post-state of the previous batch.
4. **The migrations**, verbatim, in filename order. Before each one the session values
   of the pinned settings are restored (so `search_path` is `"$user", public,
   extensions` as under the CLI) and `lock_timeout` is re-set to 10 s.
5. **Postcheck.** The in-block summary must equal the post-state measured on the
   rehearsal mirror.
6. **Ledger rows** `(version, name, array[migration text])`, in filename order, like
   the precedent.

Nothing persists from the fingerprint reads: the query runs through `EXECUTE ... INTO`
(no temporary function).

## Batches

Cut: **#1-#2, #3-#58, #59-#89, #90** (the preferred #1-21/#22-50/#51-89/#90 cut was rehearsed too and rejected; see the deploy-window conclusions and `../compat-analysis.md`).

| Batch | Migrations | Versions | Migration bytes | `batch-k-apply.sql` (bytes, SHA-256) | `batch-k-dry-run.sql` SHA-256 |
|---|---|---|---|---|---|
| 1 | #1-#2 (2) `20260929112000_embryo_ingest_route_doors.sql` .. `20260929143000_cohort_copilot_scope.sql` | 20260929112000 .. 20260929143000 | 27,416 | 52,111 `c0b848ecd72443af436dce8c0c55c9f60d5cb250610a9d4d494b87e7eab391e8` | `c86ac8d42ddef3ab56c560905a9467dbdbbbbd2617161c8f85f7cbcc3d9cc15e` |
| 2 | #3-#58 (56) `20260929150000_rights_purpose_matrix.sql` .. `20261001032000_refused_cleanup_owner_authority.sql` | 20260929150000 .. 20261001032000 | 1,372,416 | 1,454,652 `b49b536cf844335b64ba8286c0cf057072b8d0e7c4194a2c4ca3bb6d08050524` | `0f4d7e3e2e769e878b92537e2d2e8ab531f80349d06b868246c1759c378d9aa0` |
| 3 | #59-#89 (31) `20261001033000_future_person_native_keyless_release.sql` .. `20261010190500_account_archive_complete.sql` | 20261001033000 .. 20261010190500 | 1,252,718 | 1,310,386 `f428eb8f2f8d07d1c9f35b6c3b5259ff650aa3975f5c0be87e664982ccca41ee` | `900ca0f73fc6054f57ccd19a7c415eb308563887966a195792274d4bc5b755c2` |
| 4 | #90-#90 (1) `20261011010251_embryo_pending_input_read.sql` .. `20261011010251_embryo_pending_input_read.sql` | 20261011010251 .. 20261011010251 | 5,456 | 32,293 `9d296018de2e8477c683de8eae8e2a5217b8d0943e210c63ab5663454ae47aae` | `3f4b9f269fe1ba59b293e755065726e306f8b8c24f1b0367cdcaa7503694d712` |

| Batch | Expected pre-state summary (count/md5 prefix) | Expected post-state summary, measured on the mirror |
|---|---|---|
| 1 | extensions 6/5c2a24b5 functions 607/43181ce7 schema_acls 2/61bd2caa sequences 6/80c97cbe storage_buckets 2/25e9a0c1 storage_policies 1/83f978bf tables 199/3dd5a8c3 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 617/4d88c3ae schema_acls 2/61bd2caa sequences 6/80c97cbe storage_buckets 2/25e9a0c1 storage_policies 1/83f978bf tables 199/b6488f77 types 5/12d5c675 views 0/d7517139 |
| 2 | extensions 6/5c2a24b5 functions 617/4d88c3ae schema_acls 2/61bd2caa sequences 6/80c97cbe storage_buckets 2/25e9a0c1 storage_policies 1/83f978bf tables 199/b6488f77 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 950/37b9fb81 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 228/d6b5fe7f types 5/12d5c675 views 0/d7517139 |
| 3 | extensions 6/5c2a24b5 functions 950/37b9fb81 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 228/d6b5fe7f types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1243/b9495798 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 251/72e64110 types 5/12d5c675 views 0/d7517139 |
| 4 | extensions 6/5c2a24b5 functions 1243/b9495798 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 251/72e64110 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1245/9964c1ef schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 251/72e64110 types 5/12d5c675 views 0/d7517139 |

Full md5 values: `expected-summaries.json`, and each file's header and block.

## Production commands

Run from this directory, as `postgres`, over a **session-level** connection (the direct
connection, or the session pooler on port 5432; never the transaction pooler on 6543,
where the `SET` would not reach the `DO`). The connection string lives only in an
environment variable and is never echoed.

```sh
cd guarded
sha256sum -c SHA256SUMS                     # every line must say OK
export PGCLIENTENCODING=UTF8
# export INHERIT_PROD_DB_URL=...            # set out of band; do not print it

# 0. Read-only pre-checks and the pre-state read-back.
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql -o prechecks.json
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f fingerprint.sql -o fp-pre.json
python3 -I check-readback.py fp-pre.json 1 pre          # must print EQUAL

# 1. Whole-release dry run (all four batches, rolled back).
timeout 190 psql "$INHERIT_PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f all-batches-dry-run.sql > all-dry-run.log 2>&1; echo "rc=$?"
#    require rc=3 and exactly one ERROR line, ending in "ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED"
grep -c 'ERROR:' all-dry-run.log; grep -c 'ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED$' all-dry-run.log   # 1 and 1
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f fingerprint.sql -o fp-after-all-dry.json
python3 -I check-readback.py fp-after-all-dry.json 1 pre  # EQUAL: nothing persisted

# 2. For k = 1, 2, 3, 4 in turn:
k=1
timeout 190 psql "$INHERIT_PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-dry-run.sql > dry-run-$k.log 2>&1; echo "rc=$?"
grep -c 'ERROR:' dry-run-$k.log; grep -c 'ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED$' dry-run-$k.log  # 1 and 1, rc=3
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f fingerprint.sql -o fp-$k-after-dry.json
python3 -I check-readback.py fp-$k-after-dry.json $k pre  # EQUAL
timeout 190 psql "$INHERIT_PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-apply.sql > apply-$k.log 2>&1; echo "rc=$?"
#    require rc=0; the log is "SET" then "DO" (batch 3 also prints one NOTICE:
#    constraint "subject_principals_check" ... does not exist, skipping, from #75)
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f fingerprint.sql -o fp-$k-post.json
python3 -I check-readback.py fp-$k-post.json $k post     # EQUAL
psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 \
  -c "select count(*)||' '||max(version) from supabase_migrations.schema_migrations"
#    expected: 160 20260930236000 | 216 20261001032000 | 247 20261010190500 | 248 20261011010251
```

After batch 4 reads back EQUAL, merge PR 323 and let the deploy go out promptly (see
the deploy-window conclusions).

## Stop rules

- Any `SHA256SUMS` line not OK: stop.
- Pre-checks: stop unless `session.current_user` is `postgres`, the ledger is 158 rows
  with max `20260930236000` and `release_versions_present` 0, every `must_be_zero`
  value is 0, and the three `registry_md5` values equal the mirror's
  (`purge_target_stores` `d55408117bf236f8fea09eddd62f6ca7`, `purge_targets`
  `c3099e1f82193b86bf928f4aeb05be2b`, `retention_phase_registry`
  `e70eaa4475ca151399966c427b335686`). Read `sizes` and `context` before choosing the
  window; `session.supautils_*` true means batch 2 will hold every auth and storage
  table (as rehearsed).
- A pre-state read-back that is not EQUAL: stop; production is not what was rehearsed.
- A dry run with rc other than 3, without the exact line
  `ERROR:  DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, or with any other `ERROR:` line: stop
  and do not apply. Read back; it must still be EQUAL to the pre-state.
- An apply with rc other than 0: the statement rolled back as a whole. Read back: the
  summary must equal the batch's **pre**-state and the ledger must be unchanged. Only
  `canceling statement due to lock timeout` or `deadlock detected` may be retried, at
  a quieter time, starting again from that batch's dry run. Anything else: stop.
- rc 124 (`timeout` killed psql): assume nothing. The server finishes or cancels the
  statement on its own (locally, a DO kept running and committed after its client was
  killed); the session-level 180 s `statement_timeout` bounds it. Wait until
  `pg_stat_activity` shows no such statement, then read back: the state must be exactly
  the batch's pre-state or exactly its post-state (with the ledger to match). Anything
  else: stop.
- A post read-back that is not EQUAL: stop. Do not run the next batch; do not merge.
- Stopping after batch 1 or batch 2 is safe for the deployed code; resume later from
  the next batch's dry run. After batch 3, #85 breaks main's Path B notice parsing until
  PR 323 deploys, so run batch 4 straight after and deploy promptly.
- Never run `supabase db push` or apply any migration file directly in between.

## The production mirror the batches were rehearsed on

1. Fresh main: `supabase db reset --local` (CLI 2.116.0) from a detached worktree of
   c993dea8 applied 155 migrations; its fingerprint is byte-identical to
   `fp-main-local.json`.
2. Ledger: 3 stand-in rows (versions `00000000000001`-`00000000000003`) for
   production's 3 rows that have no repository file, giving 158 rows with max
   `20260930236000` as in production.
3. The 8 drifted functions: each local `pg_get_functiondef` (under the pinned settings)
   with its full-line `--` comment lines removed (2, 2, 4, 3, 4, 6, 2 and 4 lines), re-run
   as `CREATE OR REPLACE`. Owner, ACL, SECURITY DEFINER and `proconfig` were compared
   before and after: identical. The per-line md5-prefix lists of all 8 now equal
   `prod-linehash.txt` exactly (`diff` empty).
4. `create extension if not exists pg_cron`: available locally at 1.6.4 and installed
   into `pg_catalog`; the extension list now reads
   `pg_cron@pg_catalog@1.6.4,pg_stat_statements@extensions@1.11,pgcrypto@extensions@1.3,plpgsql@pg_catalog@1.0,supabase_vault@vault@0.3.1,uuid-ossp@extensions@1.1`,
   equal to `prod-extensions.txt`.
5. The mirror's fingerprint summary equals the production summary in all nine
   categories, extensions included. The mirror was rebuilt three times; each rebuild
   produced a byte-identical fingerprint.

Expected final state: `fp-B-merge.json` with the 8 functions' entries replaced by the
production-shaped ones and pg_cron in the extension list. Derived independently from
those two inputs (`rehearsal/derive-final.sql`), it equals the measured batch-4
post-state: functions 1,245 / `9964c1ef8459c3e25677d47b5a2ad1cc`, extensions 6 /
`5c2a24b528337a3bf52348d5c2c8ac8a`, tables 251 / `72e64110a4954bffafdac22c66bb4fc3`,
sequences 8 / `d1c660422dcc33967578c00a63a1b3e5`, storage_buckets 3 /
`e9ba83ea6ffdf8a041ff16ab32bb6019`, types, views, schema_acls and storage_policies
unchanged. The full final fingerprint differs from `fp-B-merge.json` in exactly the 8
function `def_md5` values and the pg_cron extension row.

`production-readonly-prechecks.sql` on the mirror's pre-state: `current_user` postgres,
ledger 158 / `20260930236000` / 0 release versions, every `must_be_zero` value 0, both
`session.supautils_*` flags true, and the registry md5s quoted in the stop rules (the
mirror holds no user data, so `sizes` and `context` are all 0 there).

## Rehearsal results (this cut, on the mirror)

Whole-release dry run (`all-batches-dry-run.sql`) on the pre-state mirror: rc 3, `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 2.08 s; fingerprint unchanged afterwards.

Negative checks before batch 1: batch-1 dry-run without session statement_timeout: rc 3, `ERROR: session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)`; batch-2 dry-run before batch 1: rc 3, `ERROR: predecessor: ledger has 158 rows, max 20260930236000; expected 160 rows, max 20260930236000`; state unchanged afterwards.

| Batch | Lock probe | Dry run (output, local seconds, state after) | Apply (output, local seconds) | Post-state = expected | Ledger after | Main's suite on the post-state | Re-apply |
|---|---|---|---|---|---|---|---|
| 1 | rc=3, 1 PROBE_LOCKS line, unchanged | rc=3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` 0.256s unchanged | rc=0 `SET DO` 0.281s | EQUAL | 160 rows, max 20260930236000 | Files=118, Tests=5504 Result: PASS | rc=3 `ERROR:  predecessor: ledger has 160 rows, max 20260930236000; expected 158 rows, max 20260930236000` unchanged |
| 2 | rc=3, 1 PROBE_LOCKS line, unchanged | rc=3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` 0.863s unchanged | rc=0 `SET DO` 0.918s | EQUAL | 216 rows, max 20261001032000 | Files=118, Tests=5472 Result: FAIL | rc=3 `ERROR:  predecessor: ledger has 216 rows, max 20261001032000; expected 160 rows, max 20260930236000` unchanged |
| 3 | rc=3, 1 PROBE_LOCKS line, unchanged | rc=3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` 1.139s unchanged | rc=0 `SET NOTICE:  constraint "subject_principals_check" of relation "subject_principals" does not exist, skipping DO` 1.227s | EQUAL | 247 rows, max 20261010190500 | Files=118, Tests=5472 Result: FAIL | rc=3 `ERROR:  predecessor: ledger has 247 rows, max 20261010190500; expected 216 rows, max 20261001032000` unchanged |
| 4 | rc=3, 1 PROBE_LOCKS line, unchanged | rc=3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED` 0.367s unchanged | rc=0 `SET DO` 0.359s | EQUAL | 248 rows, max 20261011010251 | Files=118, Tests=5472 Result: FAIL | rc=3 `ERROR:  predecessor: ledger has 248 rows, max 20261011010251; expected 247 rows, max 20261010190500` unchanged |

Main's suite fails after batches 2-4 only in tests that also fail on the final state for non-breaking reasons (inventory assertions and the behaviour changes in the conclusions), plus, from batch 3, `other_adult_held_upload` 74 (#85). It passes after batch 1. Every suite run left the fingerprint and ledger unchanged.

Command shape in every run: `PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c "set statement_timeout = '180s'" -f <file>`. Local seconds include psql start-up; the 90 migrations themselves take about 2 s in one transaction on the empty mirror.

pgTAP of 08a33a0b (`pnpm exec supabase test db` from /home/user/Inherit.bio) on the rehearsed final mirror: 201 files, 13,549 tests, PASS (and 201 files, 13,549 tests, PASS on the final state of the first, preferred-cut rehearsal). Main's suite (c993dea8) on the pre-state mirror: 118 files, 5,504 tests, PASS.

## Deploy-window conclusions (details and file:line in `../compat-analysis.md`)

- 90 migrations: 37 additive-safe, 49 safe-with-reason, 4 BREAKS-OLD-CODE.
- **After batch 1 and after batch 2 of this cut the deployed main code is fully
  compatible**: main's own suite passes after batch 1, and after batch 2 fails only
  tests that also fail on the final state for non-breaking reasons (inventory
  assertions and the behaviour changes below). From batch 3 on, #85 applies (below).
  The preferred cut does not: after #21 and #50 main's Path B tests break (#3, #18 and
  #20 drop the held-revision rights/mail arms until #51) and after #50 its
  refused-invitation cleanup is denied `future_person_claim_objections` (#49, until #58).
  Hence #3-#58 in one batch.
- **From the batch 3 commit until the deploy** main sees one break, #85: the `adult-upload-notice`
  payload and `read_adult_upload_revision_v1` gain `uploaderName`, which main's strict
  parsers reject (src/app/api/jobs/mail/route.ts:58-64, :166-173;
  src/lib/uploads/other-adult-upload.ts:255-262). Path B only, which main enables only
  with `INHERIT_TEST_JURISDICTION=1`. Run batches 3 and 4 back to back, then merge and
  deploy promptly.
- Behaviour changes main will show in the window: cancelling an account deletion signs
  the user out everywhere (#23 :445); mail and rights functions error on lock waits over
  250 ms (#48 and successors); result-table writes lock the subject row and deletes run
  a per-row check (#26, #30, #47): main's legacy Tier-1 write shape measured 2-3x slower
  for inserts (194-298 ms -> 621-648 ms per 10,000 rows) and 17x for its delete
  (16 ms -> 284 ms per 30,000 rows).
- **Locks.** Batch 2 holds ACCESS EXCLUSIVE on every `auth.*` and `storage.*` table from
  its first policy/DROP TRIGGER statement (#10) to commit, through supautils'
  `policy_grants`/`drop_trigger_grants` hook: sign-ins, token refreshes and Storage
  calls wait meanwhile (0.92 s whole-batch apply locally). Batch 2 also holds ACCESS
  EXCLUSIVE on 18 existing tables (subjects, genome_files, rights_sessions, worker_jobs,
  embryos, consent_artifacts, generated_exports, ...) and SHARE ROW EXCLUSIVE on 91;
  batch 3 on 6 (subject_principals, encrypted_contact_references, appeal_intakes,
  embryo_scores, two export tables) and 9; batch 1 only on chat_messages. Dry runs take the same locks, and the
  whole-release dry run takes all of them at once. Choose a quiet time; a lock wait
  beyond 10 s cancels the batch (safe; retry later).
- **Data-dependent risks** are all caught by the dry runs and are pre-checked read-only
  by `production-readonly-prechecks.sql` (embryo subjects without owner, claimed
  subjects/embryos, duplicate split jobs or claimant principals, published embryo
  sessions with fragments, the `future-person-identity` bucket, registry md5s).
- The fingerprint does not cover the `auth` schema: #68 adds an AFTER UPDATE OF email
  trigger on `auth.users` that no postcheck verifies (on the rehearsed final mirror it is
  present: `zz_invalidate_verified_account_auth_contact`; its function is in `private`
  and is covered). Event triggers are outside the fingerprint too; none is added.

## Local state afterwards

The local stack was restored with `pnpm exec supabase db reset --local` from
/home/user/Inherit.bio: 245 migrations applied, ledger 245 rows / max
`20261011010251`, fingerprint byte-identical to `fp-B-merge.json`. The checkout's HEAD
had meanwhile moved to `ec734a87` (commits by another session touching CI files only);
`supabase/` there is identical to 08a33a0b's, which the restore script checks first. The
temporary c993dea8 worktree was removed; the checkout has no changes.
