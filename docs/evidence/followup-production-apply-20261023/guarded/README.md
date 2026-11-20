# Guarded production release of the follow-up's 7 migrations

Production gets the 7 migrations that the follow-up integration head `77d04563`
(`local/followup`) adds over PR 324's migration tree (`538dcee6`), in two atomic
batches, **after PR 324's release and merge and before the follow-up merges**. The
pre-state is PR 324's rehearsed post-state
(`../../pr324-production-apply-20261022/guarded/`, batch 4), so nothing here can run
until PR 324's release has read back EQUAL to it. PR 324 has not been applied to
production yet. This kit follows PR 324's closely. Each batch is one `DO` statement,
built in the same way:

1. integrity checks;
2. predecessor checks;
3. the migrations, verbatim;
4. a postcheck;
5. the ledger rows.

Its `-dry-run.sql` twin is byte-identical except for one line that raises
`DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, so it rolls back.

The transport is the Supabase Management API SQL endpoint (`../api/RUNBOOK.md`).

Everything here was generated and rehearsed locally, on an isolated Supabase stack
(project `relfu`, container `supabase_db_relfu`, port 56322). The shared stack on
54322 was not used. No production or remote database was contacted, and nothing here
is a production result or an approval.

## Files

| File | Role |
| --- | --- |
| `generate.py` | Reproducible generator: `python3 -I generate.py [--head REV] measure`, `record <psql output>`, `final`, `list`. It reads every migration with `git show 77d04563:<path>` from the repository it lives in. It derives the 7 from `git ls-tree` of 77d04563 against 538dcee6, cross-checked against `git diff --name-only 538dcee6 77d04563 -- supabase/migrations`, and checks that each is headed `PRODUCTION RELEASE: GUARDED`. It refuses if any of 538dcee6's 270 files differs or is missing at 77d04563, and refuses unless `--head` (default `HEAD`) has exactly 77d04563's `supabase/migrations` tree (`259a56dd…`, pinned). It also refuses unless PR 324's kit still gives the pinned pre-state summary and the 273-row ledger. |
| `batch-k-apply.sql`, `batch-k-dry-run.sql` | The two batches and their dry runs (regenerated, not committed; see `.gitignore`). |
| `all-batches-dry-run.sql` | Both batches, each with its postcheck and ledger rows, in one transaction that ends in the dry-run raise. Proves every batch against production's data before batch 1 commits. Never an apply. |
| `expected-summaries.json` | Per batch: versions, expected pre- and post-state fingerprint summaries. |
| `fingerprint.sql` | Byte copy of `../fingerprint.sql`, the reviewed read-back query of PR 323 and PR 324 (SHA-256 `d5c4d245…916e`). It is embedded verbatim, md5-checked, in every block. |
| `check-readback.py` | Byte copy of PR 324's: compares a `fingerprint.sql` read-back with a batch's expected pre/post summary. |
| `production-readonly-prechecks.sql` | One read-only SELECT: session, ledger, the 19 md5 guards on bodies that exist before this release, every prerequisite, the operation check and its parse, the compatibility stop rule, sizes and context. Written by `../rehearsal/scripts/make-prechecks.py`. |
| `SHA256SUMS` | SHA-256 of every file above, of `local/expected-summaries.json`, of the two `local/` probes and of `../api/api-run.py` (not of this README). |
| `local/` | Local only: `measure-all.sql`, per-batch lock probes, measured summaries. Never for production. |
| `../rehearsal/` | Local evidence: the scripts that built the mirror and ran the rehearsal (`scripts/`), and their results (`data/`). |
| `../compat-analysis.md` | The deploy-window compatibility analysis (PR 324's code against the new schema). |

## What each block does, in order

As in PR 324's kit:

1. **Session guards.** Refuses unless `current_user` is `postgres` and the session's
   `statement_timeout` is set and at most 180 s. A `SET` inside the block cannot bound
   the statement that is already running; the Management API session has 2min. Then
   `lock_timeout` is set to `10s`, along with the six deparse settings `fingerprint.sql`
   pins.
2. **Integrity.** The md5 of the embedded `fingerprint.sql` and of every embedded
   migration must equal the file's. Every migration sits in its own dollar quote,
   `$inherit_m_<version>$`, and the generator asserts that no tag occurs in any
   embedded text.
3. **Predecessors.** The ledger row count and max version must be exactly as expected
   for the batch: 273 rows / max `20261016221000` before batch 1, which is production
   after PR 324's release (248 + 25; PR 324 kit, "The expected ledger after each
   batch"). No version of this or a later batch may be present, and every earlier
   batch's (version, name) must be present. Then the full fingerprint summary, computed
   in the block, must equal the expected pre-state: for batch 1, PR 324's rehearsed
   batch-4 post-state; for batch 2, the rehearsed post-state of batch 1.
4. **The migrations**, verbatim, in filename order. Before each one the session values
   of the pinned settings are restored, and `lock_timeout` is re-set to 10 s. So every
   `md5(pg_get_functiondef)` guard is computed under the session's `search_path`, as the
   pre-checks compute it.
5. **Postcheck.** The in-block summary must equal the post-state measured on the
   rehearsal mirror.
6. **Ledger rows** `(version, name, array[migration text])`, in filename order.

## Batches

Cut: **#1-#4, #5-#7.** No migration breaks PR 324's production-reachable code
(`../compat-analysis.md`), so the cut follows the locks each batch holds until commit
and the dependencies between the files:

- Batch 1 (#1-#4) replaces, creates and drops functions only. It holds no lock on any
  table. #4 patches three bodies #3 writes and drops the function #3 creates, so the
  two stay in one batch.
- Batch 2 (#5-#7) holds the release's only strong table locks: ACCESS EXCLUSIVE on
  `public.account_operation_nonces` for #5's and #6's check rebuilds, and SHARE ROW
  EXCLUSIVE for #5's trigger. #6 needs #5's consumer function and trigger. #7 takes no
  table lock and must follow #6 in filename order; a third batch for one function body
  would add a state and two round trips for no lock benefit.

| Batch | Migrations | Versions | Migration bytes | `batch-k-apply.sql` (bytes, SHA-256) | `batch-k-dry-run.sql` SHA-256 |
|---|---|---|---|---|---|
| 1 | #1-#4 (4) `20261022100000_neanderthal_ancestry_content.sql` .. `20261023110000_export_completeness.sql` | 20261022100000 .. 20261023110000 | 55,587 | 81,191 `1dd0c275b08b756ee6978452b02db095e375dda551f5a9c3fac0e8af2aff9a96` | `d8768ada74927ef23fa48530462ed7ce5b36ce11e7168500d8123d9fbbb205f0` |
| 2 | #5-#7 (3) `20261023120000_legal_audit_attribution_completeness.sql` .. `20261023140000_review_download_clock.sql` | 20261023120000 .. 20261023140000 | 35,178 | 60,225 `a9a8d3d348a80e86e08c4d8c109fc8cbf908272332771ed582a6da22d844d401` | `72a861d44e1b9317d07b308e1da2284d000304ae0213b130f9d76323bc0fde71` |

`all-batches-dry-run.sql`: 120,277 bytes, SHA-256
`2e89806d019792d2e0013c1f92da70dafae18dac4f002302b8a32433eca70774`. As a Management
API request it is 122,391 bytes (batch 1: 82,780). On 22 October the endpoint
accepted 2.9 MB.

| Batch | Expected pre-state summary (count/md5 prefix) | Expected post-state summary, measured on the mirror |
|---|---|---|
| 1 | extensions 6/5c2a24b5 functions 1397/979c1436 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/fb3edb51 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1402/a974a89a schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/fb3edb51 types 5/12d5c675 views 0/d7517139 |
| 2 | extensions 6/5c2a24b5 functions 1402/a974a89a schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/fb3edb51 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1417/130b1314 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/3d1bbd05 types 5/12d5c675 views 0/d7517139 |

The batch-1 pre-state is PR 324's rehearsed batch-4 post-state
(`../../pr324-production-apply-20261022/guarded/expected-summaries.json`; `generate.py`
refuses if its constant differs from that file). Full md5 values are in
`expected-summaries.json`, and in each file's header and block. Each measured
post-state equals the summary the step analysis read after the same files applied one
by one with `psql -1 -f` (after #4 and after #7), and the final state equals a fresh
77d04563 build (below).

## The md5 guards: what they check, and where the bodies come from

The 7 files hold 27 md5 predecessor guards (2 `md5(prosrc)`, 25
`md5(pg_get_functiondef)` with the exact `proacl::text`), every one followed by a
successor check. All 50 md5 literals of the 7 files are accounted for
(`../rehearsal/scripts/guards.py`, `../rehearsal/data/guard-map.json`). On the mirror
of PR 324's rehearsed post-state:

- **5 check a body production holds today.** Each body's `def_md5` in production's
  read-back after PR 323 (`../../pr323-production-apply-20261016/results/run-2026-10-22/fp-4-post.json`)
  equals the mirror's, and PR 324 does not change it, so each guard passes there.
- **14 check a body PR 324's release writes.** Production does not hold them yet:
  10 functions PR 324 creates, and 4 PR 324 replaces. Each expected md5 equals the body
  on PR 324's rehearsed post-state (the mirror's fingerprint is byte-identical to PR
  324's rehearsed final mirror, `4d2a2747…`).
- **4 check a body an earlier migration of this release writes** (#3 for #4, #5 for #6),
  and **4 a body the previous patch in the same block writes**.
- **None is one of the 8 comment-stripped production bodies**, and no follow-up file
  names any of the 8.
- **None depends on `search_path`.** Every guarded function's `pg_get_functiondef`
  is the same under the psql session's `"$user", public, extensions` and the pinned
  `pg_catalog` (its argument and result types are all in `pg_catalog`), so the
  fingerprint's `def_md5` is the guard's md5.
- **No guard refuses on PR 324's rehearsed post-state, and none needs a fix.** The step
  analysis applied the 7 files one by one on that state and every predecessor, ACL,
  anchor and successor held.

| # | Migration :line (patch) | Function | Guard | Expected predecessor md5 | Body from | Production today (fp-4-post) |
|---|---|---|---|---|---|---|
| 01 | `20261022100000` :96 | `private.validate_own_ancestry_content_v1` | md5(prosrc) | `901478e0f2a5123e13d72b1cbbb47e08` | production | holds it (def_md5 `02c935d0`) |
| 02 | `20261022110000` :55 | `private.read_own_input_sources_v1` | md5(prosrc) | `5f6d4777cf080f59ffa0d7d5e888fc8b` | production | holds it (def_md5 `18cedabb`) |
| 03 | `20261023100000` :163 (1) | `private.export_subject_joint_results_v1` | functiondef+ACL | `767354cddd9908bebbf8e244a0dedb76` | PR 324 | absent (PR 324 creates it) |
| 03 | `20261023100000` :174 (2) | `private.export_subject_class_inventory_v1` | functiondef+ACL | `ee769c5811458dfb4031f2c464c5256f` | PR 324 | absent (PR 324 creates it) |
| 03 | `20261023100000` :190 (3) | `private.export_account_owned_capture_pre_requester_v1` | functiondef+ACL | `ca9b6bcefc719018f196f0d4f8e4e73f` | PR 324 | PR 323 body (def_md5 `173069ff`); PR 324 replaces it |
| 03 | `20261023100000` :195 (4) | `public.export_archive_account_classes_v1` | functiondef+ACL | `42f4a34ba7a127e89130617a4a005a35` | PR 324 | PR 323 body (def_md5 `359215e1`); PR 324 replaces it |
| 03 | `20261023100000` :199 (5) | `public.export_archive_account_classes_v1` | functiondef+ACL | `b4f96665cdfcecca503ad676a0c1498b` | this migration, patch 4 | n/a (written by this release) |
| 04 | `20261023110000` :178 (1) | `private.export_subject_joint_results_v1` | functiondef+ACL | `387df71020e0de94355ae38cc2139d91` | follow-up #3 | n/a (written by this release) |
| 04 | `20261023110000` :199 (2) | `private.export_subject_scope_v1` | functiondef+ACL | `fe31c38687c4f5dba894d687c7e72d5c` | PR 324 | absent (PR 324 creates it) |
| 04 | `20261023110000` :205 (3) | `private.export_subject_graph_capture_v1` | functiondef+ACL | `23a4c87eb5002d72e9816009021079bd` | PR 324 | absent (PR 324 creates it) |
| 04 | `20261023110000` :214 (4) | `private.export_subject_graph_projection_v1` | functiondef+ACL | `b3d75d95193c0c6a752ba21ba23155e0` | PR 324 | absent (PR 324 creates it) |
| 04 | `20261023110000` :226 (5) | `private.export_subject_history_projection_v1` | functiondef+ACL | `59bb66b368b8769f0e4de3bc7cf87003` | PR 324 | absent (PR 324 creates it) |
| 04 | `20261023110000` :234 (6) | `private.export_subject_class_inventory_v1` | functiondef+ACL | `8eda83e8821d527d0f1985e38b893a80` | follow-up #3 | n/a (written by this release) |
| 04 | `20261023110000` :246 (7) | `private.export_account_owned_capture_pre_requester_v1` | functiondef+ACL | `be85c35c4d6996088bb0498856da1ff6` | follow-up #3 | n/a (written by this release) |
| 04 | `20261023110000` :250 (8) | `private.export_account_owned_capture_pre_requester_v1` | functiondef+ACL | `1fc9c2b4e5c05b72857e628c1854deb4` | this migration, patch 7 | n/a (written by this release) |
| 04 | `20261023110000` :261 (9) | `public.export_archive_account_content_v1` | functiondef+ACL | `25ab819a16105020897e9c0cf7e1fef1` | PR 324 | PR 323 body (def_md5 `1dfa6c13`); PR 324 replaces it |
| 04 | `20261023110000` :265 (10) | `public.export_archive_account_content_v1` | functiondef+ACL | `da176e225a91f83004f65d02f8375243` | this migration, patch 9 | n/a (written by this release) |
| 04 | `20261023110000` :289 (11) | `private.export_account_owned_capture_pre_member_frame_v1` | functiondef+ACL | `65c53bbe4787500a69c764f2bd50951f` | PR 324 | PR 323 body (def_md5 `4557556b`); PR 324 replaces it |
| 04 | `20261023110000` :312 (12) | `private.export_account_graph_capture_v1` | functiondef+ACL | `26513cf7d20ed98f3fb4316283a96e14` | production | holds it (def_md5 `26513cf7`) |
| 04 | `20261023110000` :325 (13) | `private.account_archive_complete_class_rows_v1` | functiondef+ACL | `bf340049d6858f1f7f8c6b21f0886bd7` | production | holds it (def_md5 `bf340049`) |
| 05 | `20261023120000` :240 (1) | `private.record_subject_operation_nonce_v1` | functiondef+ACL | `9539afdc5057346d44c1b8cd826b7ee2` | PR 324 | absent (PR 324 creates it) |
| 05 | `20261023120000` :246 (2) | `private.legal_audit_person_event_v1` | functiondef+ACL | `b566386791e9736ef744924a2d4d3039` | production | holds it (def_md5 `b5663867`) |
| 06 | `20261023130000` :162 (1) | `private.consume_account_operation_nonce_v1` | functiondef+ACL | `24176df7a1411cc624697c7c2596af36` | follow-up #5 | n/a (written by this release) |
| 06 | `20261023130000` :169 (2) | `public.bind_adult_subject_account_v1` | functiondef+ACL | `a7375f589e70ff54ced2b5b1d34b69cd` | PR 324 | absent (PR 324 creates it) |
| 06 | `20261023130000` :86 (derive) | `private.adult_subject_control_v1` | functiondef+ACL | `f6201a3830d82dcd8a95d2b8487b59ad` | PR 324 | absent (PR 324 creates it) |
| 07 | `20261023140000` :26 (1) | `public.open_permission_review_download_v1` | functiondef+ACL | `243f68d2eabb8a27013df14d87cddb6b` | PR 324 | absent (PR 324 creates it) |
| 07 | `20261023140000` :32 (2) | `public.open_permission_review_download_v1` | functiondef+ACL | `679b0ee2056c448043e66208f069d603` | this migration, patch 1 | n/a (written by this release) |

The ACL each `functiondef+ACL` guard requires is `{postgres=X/postgres}`, except
`public.export_archive_account_classes_v1` and `public.export_archive_account_content_v1`
and `public.bind_adult_subject_account_v1` (`{postgres=X/postgres,service_role=X/postgres}`)
and `public.open_permission_review_download_v1`
(`{postgres=X/postgres,authenticated=X/postgres}`). #01's guard also requires security
definer, volatile and `search_path=pg_catalog`. #06's derivation guard (line 86) also
requires that `private.adult_subject_control_for_account_v1` does not exist yet and
asserts the derived body's md5 `b1e3b29b…`.

**Comments matter here.** 11 of the 19 guarded bodies that exist before this release
contain full-line `--` comments: 4 production bodies (`validate_own_ancestry_content_v1`
23 lines, `read_own_input_sources_v1` 7, `export_account_graph_capture_v1` 3,
`account_archive_complete_class_rows_v1` 3) and 7 PR 324 bodies
(`export_archive_account_content_v1` 6, `export_subject_class_inventory_v1` 5,
`export_subject_graph_capture_v1` 3, `bind_adult_subject_account_v1` 3,
`export_subject_scope_v1` 2, `export_account_owned_capture_pre_member_frame_v1` 1,
`adult_subject_control_v1` 1). Two anchors are comment text themselves (#04 patches 3
and 12). A transport that dropped
full-line comments would make those guards refuse, which is the safe failure. PR 323's
and PR 324's API path keeps comments (PR 324 kit, "Function bodies"), and the
pre-state read-back (step 4 of the runbook: the full summary, every `def_md5`
included, EQUAL to PR 324's post-state) proves the 14 PR 324 bodies are byte-exact
before batch 1 starts. Rehearsed: stripping the 3 comment lines of
`private.export_subject_graph_capture_v1` made the pre-checks report
`guarded_bodies_not_as_rehearsed = 1`; the whole-release dry run refused at its first
check (`predecessor: fingerprint summary differs`, since every `def_md5` is in the
summary), and #3 then #4 run as files refused with `subject graph capture predecessor
differs` (`../rehearsal/data/negatives.tsv`).

**Other definition reads:**

- **#05 (120000)** parses `account_operation_nonces_operation_check` in both renderings
  (`'x'::text` and `'{x,...}'::text[]`) and refuses unless it holds `subject_transfer`,
  which PR 324's 221000 adds. After PR 324 it is
  `CHECK ((operation = ANY (ARRAY['account_delete'::text, 'account_delete_cancel'::text, 'consents_revoke_all'::text, 'other_adult_upload_artifact_sign'::text, 'own_account_completion'::text, 'own_upload_artifact_sign'::text, 'subject_delete'::text, 'subject_sharing_stop'::text, 'subject_transfer'::text])))`:
  nine values, all read by the parse. #05 re-adds the union with 10 new values as an
  IN list; #06 reads that text, refuses unless it holds `adult_invitation_create`, and
  adds 2 more (21 in all). A value outside `[a-z_]+` would not be read and would be
  dropped silently, so the pre-checks count every quoted literal the check holds that
  the parse does not read (`nonce_check_values_not_parsed`, rehearsed with an injected
  `'x2'`).
- **#05** refuses if the trigger `legal_audit_actor_on_consumed_insert` exists;
  **#06** refuses unless it exists (from #05) and PR 324's `legal_audit_actor_on_consume`
  exists on `public.embryo_operation_nonces`.

## Pre-check stop rules

Run `production-readonly-prechecks.sql` first (`../api/RUNBOOK.md` step 4), after PR
324's release. It names PR 324's tables, so before PR 324's release it fails with
`relation "private.permission_documents" does not exist`, which is itself a stop.
Stop unless all of the following hold. The expected values are the mirror's
(`../rehearsal/data/prechecks-on-mirror-pre.json`).

- `session.current_user` is `postgres`. Record `session.search_path` (the mirror had
  `"$user", public, extensions`); no guard depends on it.
- `ledger` is 273 rows, max `20261016221000`, `above_pr324_max` 0,
  `pr324_versions_present` 25 and `release_versions_present` 0.
- All 19 `guards` entries are `ok: true`, each with `have_md5` equal to `want_md5`
  (the table above, rows whose body comes from production or PR 324) and `proacl`
  equal to `want_acl`.
- Every `must_be_zero` value is 0. There are 9 keys:
  `guarded_bodies_not_as_rehearsed`, `prerequisite_signatures_missing` (10 exact
  signatures), `prerequisite_functions_missing` (44), `prerequisite_relations_missing`
  (22), `embryo_nonce_actor_trigger_missing`, `release_functions_present` (21 names),
  `release_trigger_present`, `nonce_check_without_subject_transfer`,
  `nonce_check_values_not_parsed`.
- `compat_must_be_zero.normalization_runs_with_read_calls` is 0
  (`../compat-analysis.md`, item 2).
- `definitions.parsed_like_120000` is the nine values above and `literal_count` 9.

Read before choosing the window:

- `sizes.account_operation_nonces`, which bounds batch 2's check validation under its
  ACCESS EXCLUSIVE lock.
- `context`: `account_archive_r2_enabled` and `export_archive_jobs` decide whether a
  TEST export job can be in flight across batch 1 (it would fail its next receipt
  check; `../compat-analysis.md`), and `unconsumed_account_operation_nonces`
  counts the nonce flows that may wait on batch 2's lock.

## Production commands

The transport, probes and exact command sequence are in `../api/RUNBOOK.md`. The same
files run under psql over a session-level connection with the command shape below,
which the rehearsal used:

```sh
PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-dry-run.sql   # rc=3, exactly one ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED
```

Order: pre-checks and the pre-state read-back (EQUAL batch 1 pre); the whole-release
dry run (sentinel), then a read-back (EQUAL batch 1 pre). Then, for k = 1, 2: the dry
run (sentinel), a read-back (EQUAL k pre), the apply (rc 0), a read-back (EQUAL k
post), and the ledger.

The expected ledger after each batch:

| After batch | Rows | Max version |
|---|---|---|
| (PR 324's release) | 273 | `20261016221000` |
| 1 | 277 | `20261023110000` |
| 2 | 280 | `20261023140000` |

## Stop rules

- Any `SHA256SUMS` line not OK, or `generate.py --head <follow-up head>` refusing: stop.
- PR 324's release not complete and EQUAL: stop. This release cannot start.
- Any pre-check stop rule above: stop.
- A pre-state read-back that is not EQUAL: stop; production is not what was rehearsed.
- A dry run with rc other than 3, without the exact sentinel, or with any other
  `ERROR:`: stop and do not apply. Read back; it must still be EQUAL to the pre-state.
- An apply with rc other than 0: the statement rolled back as a whole. Read back: the
  summary must equal the batch's **pre**-state and the ledger must be unchanged. Retry
  only `canceling statement due to lock timeout` or `deadlock detected`, at a quieter
  time, starting again from that batch's dry run. Anything else: stop.
- No response (rc 124): assume nothing. Wait two minutes for the server's statement
  timeout, then read back. The state must be exactly the batch's pre-state or exactly
  its post-state, with the ledger to match. Anything else: stop.
- A post read-back that is not EQUAL: stop. Do not run the next batch; do not merge.
- Stopping after batch 1 is safe for PR 324's deployed code (`../compat-analysis.md`).
  Resume later from batch 2's dry run. The follow-up cannot deploy until batch 2 is in.
- Never run `supabase db push` or apply any migration file directly in between.

## The mirror the batches were rehearsed on

1. **Production mirror before PR 324**, built exactly as PR 324's kit built it
   (`../rehearsal/scripts/build-mirror.sh`): fresh main 12f24475 (245 migrations,
   `supabase start -x` everything but the database, project `relfu`, from a scratch
   copy of 12f24475's `supabase/`), fingerprint byte-identical to the reference fresh
   build (`8860eee4…`); 3 ledger stand-ins (248 rows, max `20261011010251`); the 8
   comment-stripped bodies, whose per-line hashes equal `prod-linehash.txt` (read from
   production on 15 October); `pg_cron` 1.6.4. Its full fingerprint equals production's
   2026-10-22 read-back (`fp-after-merge.json`) object for object, in all nine
   categories.
2. **PR 324's four guarded batches** from its kit (`generate.py --head cf79b1b6 final`,
   its 19 `SHA256SUMS` lines OK), run as its runbook runs them
   (`../rehearsal/scripts/apply-pr324-kit.sh`): each dry run rc 3 with exactly the
   sentinel and read back EQUAL to its pre-state, each apply rc 0 and read back EQUAL to
   its post-state; ledger 273 / `20261016221000`. The resulting fingerprint is
   byte-identical to PR 324's rehearsed final mirror (`fp-final.json`, SHA-256
   `4d2a2747…`), so its summary is PR 324's batch-4 post-state exactly. The production
   mirror was built five times and PR 324's batches applied on four of them, every time
   with these fingerprints (`../rehearsal/data/mirror-builds.txt`).

`production-readonly-prechecks.sql` on this pre-state gave the values in the stop
rules, with `sizes` and `context` all 0 or false (no user data):
`../rehearsal/data/prechecks-on-mirror-pre.json`.

## Rehearsal results (this cut, on the mirror)

Command shape: `PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c
"set statement_timeout = '180s'" -f <file>`. The whole-release dry run used `'2min'`,
the Management API session's value. Local seconds include psql start-up
(`../rehearsal/data/rehearsal-results.tsv`).

**Pre-checks** on the pre-state: every `must_be_zero` and `compat_must_be_zero` value 0,
19 of 19 guards `ok` (`../rehearsal/data/prechecks-on-mirror-pre.json`).

**Whole-release dry run** on the pre-state: rc 3, exactly one `ERROR:
DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.70 s. The fingerprint and ledger were unchanged
afterwards, and the read-back EQUAL batch 1 pre. It was repeated from the final
`SHA256SUMS` state (14 of 14 lines OK) on a rebuilt mirror: rc 3, the sentinel, 0.79 s,
unchanged; both batches then applied and read back EQUAL
(`../rehearsal/data/final-pass.txt`).

**Negative checks** (state unchanged after each):

| Check | Result |
|---|---|
| Batch-1 dry run without a session `statement_timeout` | rc 3, `session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)` |
| Batch-1 dry run with `statement_timeout = '190s'` | the same |
| Batch-2 dry run before batch 1 | rc 3, `predecessor: ledger has 273 rows, max 20261016221000; expected 277 rows, max 20261023110000` |
| Batch-2 apply before batch 1 | the same |
| Whole-release dry run and batch-1 apply on the production mirror **before PR 324's release** | both `predecessor: ledger has 248 rows, max 20261011010251; expected 273 rows, max 20261016221000`; the pre-checks fail on `private.permission_documents` |
| `export_subject_graph_capture_v1` with its 3 comment lines stripped (rolled back) | pre-checks: `guarded_bodies_not_as_rehearsed = 1` (have `80d3cc69…`, want `23a4c87e…`); whole-release dry run: `predecessor: fingerprint summary differs`; #3 then #4 as files: `subject graph capture predecessor differs` |
| One extra grant on `export_subject_joint_results_v1` (rolled back) | pre-checks: `guarded_bodies_not_as_rehearsed = 1` (md5 equal, ACL differs); dry run: summary differs; #3 as a file: `subject joint results predecessor differs` |
| An operation check holding a value the parse cannot read (`'x2'`, rolled back) | pre-checks: `nonce_check_values_not_parsed = 1` |
| `generate.py` on a commit whose tree changes one earlier migration | `earlier migration changed or missing in f49bfc1e: supabase/migrations/20261016221000_subject_transfer.sql`; with `--head` that commit: `... is not the rehearsed 77d04563 tree 259a56dd…` |

Details: `../rehearsal/data/negatives.tsv`, `generator-negatives.txt`.

**Per batch:**

| Batch | Lock probe | Dry run (output, local seconds, state after, read-back) | Apply (output, local seconds, read-back) | Ledger after | Re-apply |
|---|---|---|---|---|---|
| 1 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.516 s, unchanged, EQUAL 1 pre | rc 0 `SET DO`, 0.485 s, EQUAL 1 post | 277 rows, max 20261023110000 | rc 3 `predecessor: ledger has 277 rows, max 20261023110000; expected 273 rows, max 20261016221000`, unchanged |
| 2 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.533 s, unchanged, EQUAL 2 pre | rc 0 `SET DO`, 0.453 s, EQUAL 2 post | 280 rows, max 20261023140000 | rc 3 `predecessor: ledger has 280 rows ...; expected 277 rows ...`, unchanged |

**Timings.** Measured inside the block, batch 1's migrations and its postcheck
fingerprint take 0.19 s and batch 2's 0.20 s; the 7 migrations alone take 0.044 s
(`../rehearsal/data/locktrace.txt`). The longest local statement is the whole-release
dry run, 0.70-0.79 s with psql start-up. The binding limit in production is the
endpoint's 2-minute `statement_timeout`, 120 s (the guard allows up to 180 s); every
batch and the whole-release dry run finish locally in under 1 % of it. Production adds
lock waits, which `lock_timeout` 10 s bounds, and data: only batch 2's check rebuilds
scan a table (`sizes.account_operation_nonces`).

**pgTAP.** Each suite run left the fingerprint and ledger unchanged
(`../rehearsal/data/pgtap-summaries.txt`):

| State | Suite | Files | Tests | Result | Wall clock |
|---|---|---|---|---|---|
| Pre-state (PR 324's post-state) | PR 324, `cf79b1b6` | 229 | 15,544 | PASS | 529 s |
| After batch 1 | PR 324, `cf79b1b6` | 229 | 15,544 | FAIL 7: `account_archive_graph_rows` 166, `other_adult_held_upload` 71, `subject_export` 189-193 | 516 s |
| After batch 2 | PR 324, `cf79b1b6` | 229 | 15,544 | FAIL, the same 7 | 518 s |
| Final | the follow-up, `77d04563` | 235 | 16,034 | PASS | 528 s |

The 7 are the behaviour the follow-up changes on purpose (the one-record export's
lifted refusals, the whole-account parent-cohort refusal, one pinned body); the
follow-up's own versions of all three files pass. None is a production-reachable path
of PR 324's code (`../compat-analysis.md`, "Old-contract failures"). Batch 2 adds no
old-contract failure. The suites' wall clock is a local test run, not a release step;
no single test statement comes near either limit.

**Order equivalence** (`../rehearsal/data/equivalence.txt`). Dumps are pg_dump 17.6
`--schema-only`, normalised by dropping its two random `\restrict`/`\unrestrict` key lines.

- **Fresh 538dcee6 + the 7 (`psql -1 -f` each, 0.53 s) against a fresh 77d04563 build
  (277 migrations).** The fingerprints are byte-identical (SHA-256 `04c167c3…`) and the
  normalised dumps are identical (101,973 lines, `3c5fb9a4…`).
- **The rehearsed final mirror (production mirror + PR 324's four guarded batches +
  this kit's two) against fresh 77d04563 with the same drift applied.** The fingerprints
  are byte-identical (`3a0f4d68…`) and the normalised dumps are identical (102,051
  lines, `73b5d122…`).
- **The final mirror against plain fresh 77d04563.**
  - Fingerprint: only the 8 drifted `def_md5` values and the `pg_cron` row differ.
  - Dump: 27 lines are only in 77d04563, all full-line comments of the 8 bodies. 105
    lines are only in the mirror, all pg_cron (the extension, its comment and its
    `cron` grants, with their blank and `--` separator lines).

Expected final production state: batch 2's post-state above (functions 1,417 /
`130b1314…`, tables 267 / `3d1bbd05…`, the rest unchanged from PR 324's post-state).

## Deploy-window conclusions (details and file:line in `../compat-analysis.md`)

- **The 7 migrations: 0 additive-safe, 7 safe-with-reason, 0 BREAKS-OLD-CODE.** PR
  324's production-reachable code is compatible at the batch boundary and after batch 2.
- **Behaviour PR 324's code shows in the window:**
  - #01 and #02 change two production-reachable bodies, and both give byte-identical
    results for everything PR 324's code writes (ancestry content v1-v4; sources
    without `readCalls`, which `compat_must_be_zero` proves).
  - #05: legal audit events of PR 324's subject delete and consents revoke-all (and,
    TEST-only, consent reaffirmation) now name the acting account's pseudonym when the
    transaction proves one. No write can be refused by it.
  - #03/#04: a hand-made one-record or account export request for a record with joint
    results or cohort rows now passes `capture` and is refused later (CSRF, or no
    generation capability) instead of with `jointResults`. Nothing is created.
- **Not reachable by PR 324's code in production:** the export projections and doors
  (no generation capability), the bind change (TEST-only, built closed), the new nonce
  doors, and the review-download clock (no runtime caller).
- **Locks.** Batch 1 holds no table lock. Batch 2 holds ACCESS EXCLUSIVE and SHARE ROW
  EXCLUSIVE on `account_operation_nonces`: account deletion and its cancel, own upload
  signing and completion, the other-adult artifact, consents revoke-all, subject delete
  and sharing stop wait for its sub-second run. No `auth` or `storage` table is locked
  beyond ACCESS SHARE reads. Choose a quiet time for batch 2. A lock wait beyond 10 s
  cancels the batch, which is safe to retry later.
- **Merge the follow-up straight after batch 2.** Its code needs all 7. PR 324's code
  does not break meanwhile, so a delay is not an incident.
- **Outside the fingerprint.** It does not cover `auth`; no migration here touches an
  `auth` or `storage` object, adds a policy or an event trigger, or grants to `anon`,
  `authenticated` or PUBLIC. The 14 new public functions are `service_role` only.

## Local state afterwards

The isolated stack was stopped with `supabase stop --no-backup` for project `relfu`.
Its container, volume and network are gone. The shared stack (project `sequence`, 12
containers) was not used; a read-only ledger count there read 246 rows / max
`20261016120000` at the end, as PR 324's kit recorded. The scratch tree, fingerprints
and dumps were deleted; their SHA-256 values are in `../rehearsal/data/equivalence.txt`.
The PR 324 kit's batch files regenerated for the rehearsal (ignored by git) were removed.
