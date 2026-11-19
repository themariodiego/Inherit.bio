# Guarded production release of PR 324's 25 migrations

Production gets the 25 migrations that `538dcee6` adds over main `12f24475`, in four
atomic batches, **before** PR 324 merges. Main is already in production: PR 323's 90
migrations were applied on 22 October 2026 through
`../../pr323-production-apply-20261016/`, and this kit follows that kit closely. Each
batch is one `DO` statement, built in the same way:

1. integrity checks;
2. predecessor checks;
3. the migrations, verbatim;
4. a postcheck;
5. the ledger rows.

Its `-dry-run.sql` twin is byte-identical except for one line that raises
`DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, so it rolls back.

The transport is the Supabase Management API SQL endpoint (`../api/RUNBOOK.md`).

Everything here was generated and rehearsed locally, on an isolated Supabase stack
(project `rel324`, port 55322). The shared stack on 54322 was only read. No
production or remote database was contacted.

## Files

| File | Role |
| --- | --- |
| `generate.py` | Reproducible generator: `python3 -I generate.py [--head REV] measure`, `record <psql output>`, `final`, `list`. It reads every migration with `git show 538dcee6:<path>` from the repository it lives in. It derives the 25 from `git ls-tree` of 538dcee6 against 12f24475, cross-checked against `git diff --name-only 12f24475...538dcee6 -- supabase/migrations`. It refuses if any of main's 245 files differs or is missing at 538dcee6, and refuses unless `--head` (default `HEAD`) has exactly 538dcee6's `supabase/migrations` tree (`d8bfc25a…`). |
| `batch-k-apply.sql`, `batch-k-dry-run.sql` | The four batches and their dry runs (regenerated, not committed; see `.gitignore`). |
| `all-batches-dry-run.sql` | All four batches, each with its postcheck and ledger rows, in one transaction that ends in the dry-run raise. Proves every batch against production's data before batch 1 commits. Never an apply. |
| `expected-summaries.json` | Per batch: versions, expected pre- and post-state fingerprint summaries. |
| `fingerprint.sql` | Byte copy of `../fingerprint.sql`, the reviewed read-back query of PR 323 (SHA-256 `d5c4d245…916e`). It is embedded verbatim, md5-checked, in every block. |
| `check-readback.py` | Compares a `fingerprint.sql` read-back with a batch's expected pre/post summary. |
| `production-readonly-prechecks.sql` | One read-only SELECT covering session, ledger, the 12 production `md5(prosrc)` guards, every data or definition predicate a guard or statement depends on, registry md5s, sizes and context. |
| `SHA256SUMS` | SHA-256 of every file above, of `local/expected-summaries.json` and of the four `local/` probes (not of this README). |
| `local/` | Local only: `measure-all.sql`, per-batch lock probes, measured summaries. Never for production. |
| `../rehearsal/` | Local evidence: the scripts that built the mirror and ran the rehearsal (`scripts/`), and their results (`data/`). |
| `../compat-analysis.md` | The deploy-window compatibility analysis. |

## What each block does, in order

As in PR 323's kit:

1. **Session guards.** Refuses unless `current_user` is `postgres` and the session's
   `statement_timeout` is set and at most 180 s. A `SET` inside the block cannot
   bound the statement that is already running; the Management API session has
   2min. Then `lock_timeout` is set to `10s`, along with the six deparse settings
   `fingerprint.sql` pins.
2. **Integrity.** The md5 of the embedded `fingerprint.sql` and of every embedded
   migration must equal the file's. Every migration sits in its own dollar quote,
   `$inherit_m_<version>$`, and the generator asserts that no tag occurs in any
   embedded text.
3. **Predecessors.** The ledger row count and max version must be exactly as
   expected for the batch: 248 rows / max `20261011010251` before batch 1, which is
   production after PR 323. No version of this or a later batch may be present,
   and every earlier batch's (version, name) must be present. Then the full
   fingerprint summary, computed in the block, must equal the expected pre-state:
   for batch 1, production's summary read back on 22 October after PR 323 merged;
   for later batches, the rehearsed post-state of the previous batch.
4. **The migrations**, verbatim, in filename order. Before each one the session
   values of the pinned settings are restored, and `lock_timeout` is re-set to 10 s.
5. **Postcheck.** The in-block summary must equal the post-state measured on the
   rehearsal mirror.
6. **Ledger rows** `(version, name, array[migration text])`, in filename order.

## Batches

Cut: **#1-#5, #6-#11, #12-#24, #25.** No migration breaks main's production-reachable
code (`../compat-analysis.md`), so the cut follows the locks each batch holds until
commit:

- Batch 1 holds the only `auth.users` lock: SHARE ROW EXCLUSIVE, from #2's foreign keys.
- Batch 2 holds the `genome_files`, `download_sessions`, subject-draft and Path B
  principal locks. These are the subjects endpoints, including #7's file-deletion
  guard, the one production-reachable behaviour change.
- Batch 3 is the consents and rights set (200000-208000) and the correction and
  reviewed-document slices.
- Batch 4 is #25 alone. It takes the one ACCESS EXCLUSIVE lock on `public.subjects`,
  patches five production bodies in place, and rebuilds the account operation check.

| Batch | Migrations | Versions | Migration bytes | `batch-k-apply.sql` (bytes, SHA-256) | `batch-k-dry-run.sql` SHA-256 |
|---|---|---|---|---|---|
| 1 | #1-#5 (5) `20261016120000_embryo_table_mapping_route.sql` .. `20261016175000_future_person_claimant_contact_730_days.sql` | 20261016120000 .. 20261016175000 | 102,815 | 129,756 `e532c0daf6a24339cc7657098af4187151f2f7c05df7de90ad721626aa55ebe3` | `781d54ea3e463ccfe257f645287ecffdbf1af3fa886d44b430eb90f2110cde43` |
| 2 | #6-#11 (6) `20261016180000_subject_sharing_stop.sql` .. `20261016196000_subject_export.sql` | 20261016180000 .. 20261016196000 | 311,375 | 339,600 `275200012621740bb4da2a90c01cfa1e24b147643511a7efda1444cc79768261` | `a1d41c46fb3824e75ca6f5ea564f8a0652697f07f6007de5358f08b3eda00a4a` |
| 3 | #12-#24 (13) `20261016200000_consents_revoke_all.sql` .. `20261016220000_subject_delete_reviewed_document.sql` | 20261016200000 .. 20261016220000 | 145,015 | 180,784 `12ae9ddc3267232f439e27d35170fd4aabac37a7eb7285cf63f671d477d48321` | `112a0d09bead4effa9a37264a7d0760a4bb148eb2967544a5132deedfc58cab0` |
| 4 | #25 (1) `20261016221000_subject_transfer.sql` | 20261016221000 | 67,501 | 91,099 `13efea8b1537b68813d9d416c079b2f6fa51c2879346ba0a04dec421138ffc3d` | `09d88b5762f5653405e9f477e761887f362224c6e19da9cbfae6748e6f77cedc` |

`all-batches-dry-run.sql`: 679,208 bytes, SHA-256
`0d504fa0404e65c3d6ba441dab16f179160d467052cda7b19f51ae628cf5299f`. As a Management
API request it is 689,812 bytes. On 22 October the endpoint accepted 2.9 MB.

| Batch | Expected pre-state summary (count/md5 prefix) | Expected post-state summary, measured on the mirror |
|---|---|---|
| 1 | extensions 6/5c2a24b5 functions 1245/9964c1ef schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 251/72e64110 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1274/207d7bbf schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 253/51c71b0a types 5/12d5c675 views 0/d7517139 |
| 2 | extensions 6/5c2a24b5 functions 1274/207d7bbf schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 3/e9ba83ea storage_policies 1/83f978bf tables 253/51c71b0a types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1354/5fe9c4b7 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 262/1deae94c types 5/12d5c675 views 0/d7517139 |
| 3 | extensions 6/5c2a24b5 functions 1354/5fe9c4b7 schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 262/1deae94c types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1378/3fce0ddb schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 264/4a8bee01 types 5/12d5c675 views 0/d7517139 |
| 4 | extensions 6/5c2a24b5 functions 1378/3fce0ddb schema_acls 2/61bd2caa sequences 8/d1c66042 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 264/4a8bee01 types 5/12d5c675 views 0/d7517139 | extensions 6/5c2a24b5 functions 1397/979c1436 schema_acls 2/61bd2caa sequences 9/dbbac443 storage_buckets 4/08130193 storage_policies 1/83f978bf tables 267/fb3edb51 types 5/12d5c675 views 0/d7517139 |

The batch-1 pre-state is production's summary from
`../../pr323-production-apply-20261016/results/run-2026-10-22/fp-after-merge.json`
(`generate.py` refuses if its constant differs from that file). Full md5 values are in
`expected-summaries.json`, and in each file's header and block. The measured batch-4
post-state equals the final state of an independent run of the 25 files with
`psql -1 -f`, one after another.

## Function bodies, definitions and the comment-stripping drift

**Background.** The read-only fingerprint of 15/16 October found 8 production
function bodies that differ from a fresh build only by stripped full-line SQL
comments:

- `private.claim_next_own_preparation_v1`
- `current_adult_subject_invitation_v1`
- `own_report_generation_v1`
- `own_subject_purpose_grant_v1`
- `read_own_upload_finalization_checkpoint_v1`
- `write_own_upload_finalization_checkpoint_v1`
- `public.claim_due_research_publication_v1`
- `record_blocked_embryo_response_v1`

PR 323 did not touch them, so they are still stripped.

**Did PR 323's API path keep comments?** Yes. Production's full read-back after
PR 323 merged (`fp-after-merge.json`, `def_md5 = md5(pg_get_functiondef)` of all
1,245 functions) is equal, function for function, to the mirror. The mirror built
PR 323's 638 new and 49 replaced functions from the verbatim files, comments
included. So the API transport stored every body exactly as sent. Two of the
guarded bodies below prove it directly: both were created by PR 323 through the
API, both contain comment lines, and both match.
- `private.confirm_claim_document_objects_deleted_v1`: 3 comment lines.
- `private.other_adult_mitigation_before_public_appeal_v1`: 1 comment line.

**The 31 `md5(prosrc)` guards in the 25 migrations** (step analysis on the mirror,
`../rehearsal/data/guard-map.json`):

- 12 check a body production holds now. None is one of the 8 stripped functions.
  Each body's production `def_md5` equals the mirror's, so production's `prosrc` is
  byte-identical and every guard passes there.
  - 4 of them contain full-line comments:
    - `prepare_genome_file_deletion_body_v1`: 4 lines.
    - `confirm_claim_document_objects_deleted_v1`: 3 lines.
    - `path_b_result_read_v1`: 3 lines.
    - `other_adult_mitigation_before_public_appeal_v1`: 1 line.

    These four are exactly the guards a comment-stripping path would make refuse.
  - On the mirror, stripping one of them, `prepare_genome_file_deletion_body_v1`, in
    a rolled-back transaction made the precheck report
    `guarded_bodies_not_as_rehearsed = 1`, with the stripped md5. #7's guard refused
    with `subject delete file guard predecessor differs`.
- 4 check a body an earlier migration of this release writes from its verbatim text.
- 15 check the successor body a patch must produce.

| # | Migration :line | Function | Expected predecessor md5(prosrc) | Body from | Also checked by the guard |
|---|---|---|---|---|---|
| 03 | `20261016153100_future_person_claimant_erasure_completion` :25 | `private.confirm_claim_document_objects_deleted_v1` | `997f8d07edb464cf2999af1b408cb5ca` | production (created by PR 323) | security definer, plpgsql, owner postgres, `search_path=""`, ACL exactly postgres + service_role |
| 05 | `20261016175000_future_person_claimant_contact_730_days` :55 | `private.queue_future_person_release_v1` | `f1f5e9786d47a0a6102b43276012ae31` | production (created by PR 323) | anchor once; ACL unchanged after |
| 05 | `20261016175000_future_person_claimant_contact_730_days` :74 | `private.purge_future_person_contact_phase_v1` | `7d06d5f13edc7882cfe4d5a4a73f1922` | production (created by PR 323) | anchor once; ACL unchanged after |
| 07 | `20261016181000_subject_delete` :43 | `private.prepare_genome_file_deletion_body_v1` | `687df80d56b38d2aabeacd4bc1350154` | production (unchanged by PR 323) | security definer, `search_path=""` |
| 10 | `20261016195000_embryo_table_call_hash` :44 | `private.embryo_call_value_hash_v1` | `4d2c2b593507c9770df523fca19a93e6` | production (created by PR 323) | anchor once; a sample hash unchanged |
| 16 | `20261016204000_path_b_no_account_uploader_gate` :85 | `private.other_adult_mitigation_before_public_appeal_v1` | `a877304153a110c6710edf20019cb647` | production (created by PR 323) | anchor once; ACL, volatility, owner unchanged after |
| 20 | `20261016208000_rights_reissue` :260 | `public.activate_rights_session_v1` | `b9dcb56fbe06146e7b55e98f5f68a25b` | production (replaced by PR 323) | anchor once; ACL unchanged after |
| 23 | `20261016212000_future_person_correction_provenance` :58 | `private.correction_review_provenance_v1` | `f1e03b8db0a2966c0969d461fcfb5f10` | in-release (#21) | two anchors once |
| 24 | `20261016220000_subject_delete_reviewed_document` :40 | `public.delete_subject_v1` | `39abbfe9f403ac173f1b56b38494b66f` | in-release (#7) | anchor once |
| 25 | `20261016221000_subject_transfer` :133 | `private.record_subject_operation_nonce_v1` | `8ca7925a33003ca56d0d96921ee35693` | in-release (#7) | anchor once |
| 25 | `20261016221000_subject_transfer` :264 | `private.guard_structural_file_identity_v1` | `1081b5ccc70375acffe4f9d61bbce652` | production (replaced by PR 323) | not security definer, `search_path=pg_catalog` |
| 25 | `20261016221000_subject_transfer` :307 | `private.end_path_b_normalized_revision_v1` | `c363f202cabc481aa74f270ebaff56de` | production (unchanged by PR 323) | |
| 25 | `20261016221000_subject_transfer` :592 | `private.path_b_result_read_v1` | `6a11b090fe19408849eef67b55e456e6` | production (unchanged by PR 323) | anchor once |
| 25 | `20261016221000_subject_transfer` :610 | `private.path_b_report_results_v1` | `15fba855b30040199449da320428e26c` | production (unchanged by PR 323) | |
| 25 | `20261016221000_subject_transfer` :677 | `private.path_b_report_read_ready_v1` | `ae73cb79432cb38b5db4b575c08a0a0b` | production (unchanged by PR 323) | |
| 25 | `20261016221000_subject_transfer` :992 | `public.delete_subject_v1` | `09f00c92c9b1016ef554a297d02b632d` | in-release (#24) | anchor once; security definer, `search_path=""` after |

Successor md5s:

| Migration | Function | Successor md5 |
|---|---|---|
| #3 | `confirm_claim_document_objects_deleted_v1` | `8d6cab2c…` |
| #5 | `queue_future_person_release_v1` | `4bf007b7…` |
| #5 | `purge_future_person_contact_phase_v1` | `3ead2302…` |
| #10 | `embryo_call_value_hash_v1` | `2286a0c4…` |
| #16 | `other_adult_mitigation_before_public_appeal_v1` | `29c74c79…` |
| #20 | `activate_rights_session_v1` | `f4c47723…` |
| #23 | `correction_review_provenance_v1` | `c971b5e0…` |
| #24 | `delete_subject_v1` | `09f00c92…` |
| #25 | `record_subject_operation_nonce_v1` | `846078ad…` |
| #25 | `guard_structural_file_identity_v1` | `2639f2ff…` |
| #25 | `end_path_b_normalized_revision_v1` | `64fe2b45…` |
| #25 | `path_b_result_read_v1` | `d229cc3d…` |
| #25 | `path_b_report_results_v1` | `58217447…` |
| #25 | `path_b_report_read_ready_v1` | `53d9878b…` |
| #25 | `delete_subject_v1` | `3dd7e58c…` |

Each patch rewrites `pg_get_functiondef(target)` with `replace(...)` or a full body
and re-executes it. A successor md5 covers `prosrc` only, so it does not depend on
the session's `search_path`.

**Other definition reads:**

- **#06 (180000)** requires the account operation check to contain
  `other_adult_upload_artifact_sign`. In production that is
  `CHECK ((operation = ANY (ARRAY['account_delete'::text, 'account_delete_cancel'::text, 'own_upload_artifact_sign'::text, 'own_account_completion'::text, 'other_adult_upload_artifact_sign'::text])))`:
  the IN/ARRAY rendering of `20260928150000_other_adult_held_upload.sql:139-142`,
  which PR 323 left unchanged. Its constraint md5 is inside the matched
  `tables` summary.
- **#07** re-adds the check with a 7-value IN list, which holds all 5 current values.
- **#12 (200000)** parses the IN/ARRAY form and re-adds the check as an array
  literal.
- **#25 (221000)** reads both renderings, as the rehearsal shows:
  - the IN/ARRAY form `'x'::text`;
  - the array-literal form `'{x,...}'::text[]` that #12 leaves.

  It re-adds the union as an IN list: `account_delete, account_delete_cancel,
  consents_revoke_all, other_adult_upload_artifact_sign, own_account_completion,
  own_upload_artifact_sign, subject_delete, subject_sharing_stop, subject_transfer`.

  Both of 221000's parses, applied to production's text as it is now, yield the
  5 values. The pre-checks show this (`definitions.parsed_like_200000`, `parsed_like_221000`). Neither parse
  sees a value outside `[a-z_]+`. Such a value would fail #12 loudly, or fail the
  re-added check's validation; it could not vanish silently.
- **#21 (210000)** compares `correction_assignments_decision_check` exactly with
  `CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text, 'close'::text])))`,
  which is production's text.
- **#24 (220000)** needs `path-b-reviewed-document` in
  `adult_subject_drafts_adult_flow_check`, which only #08 (batch 2) adds.
- **#03 (153100)** is the migration whose guard refuses on the shared local database.
  The shared DB already holds its successor body (`8d6cab2c…`) and its new functions,
  with no ledger row (read-only check, 246 rows, max `20261016120000`): another
  session applied it there. On the mirror and in production the target holds the
  predecessor `997f8d07…`, with security definer, plpgsql, owner `postgres`,
  `search_path=""` and ACL `{postgres=X/postgres,service_role=X/postgres}`. Its
  three new functions are absent, and its registry row and four prerequisite
  functions are present. The pre-checks re-run every one of those predicates.

## Pre-check stop rules

Run `production-readonly-prechecks.sql` first (`../api/RUNBOOK.md` step 4). Stop
unless all of the following hold. The expected values are the mirror's
(`../rehearsal/data/prechecks-on-mirror-pre.json`).

- `session.current_user` is `postgres`.
- `ledger` is 248 rows, max `20261011010251`, `above_main_max` 0 and
  `release_versions_present` 0.
- All 12 `guards` entries are `ok: true`, each with `have_md5` equal to `want_md5`
  (the table above).
- Every `must_be_zero` value is 0. There are 19 keys: `guarded_bodies_not_as_rehearsed`,
  `prerequisites_missing` (67 functions and tables), the seven `release_*_present`
  counts, the `legal-evidence` bucket and its policies, running 24-month claimant
  clocks, the consent-reaffirm issuer, `required_registry_rows_missing` (9 rows),
  `subject-original-download` sessions, the three constraint-text checks, and account
  operations outside #07's list.
- The six `registry_md5` values equal the mirror's:

  | Registry | md5 |
  |---|---|
  | `purge_target_stores` | `cd71da9b3bed2b543b288ae0edde4313` |
  | `purge_targets` | `c3099e1f82193b86bf928f4aeb05be2b` |
  | `retention_phase_registry` | `071aa0741f422cad5b3c69a5adadf167` |
  | `retention_registry` | `d87d020175cc871f9e64d4cc9fd3a29c` |
  | `rights_purpose_matrix` | `23d8794b7e1c5eb2204e68a392814faf` |
  | `rights_session_purposes` | `e9d23f763a990a7f62dcc50c91163bae` |

  A difference means the registry rows the guards read are not the rehearsed ones,
  even if the nine required rows are present.
- `definitions` are as quoted above. Both parsed lists are the five values
  `account_delete, account_delete_cancel, other_adult_upload_artifact_sign,
  own_account_completion, own_upload_artifact_sign`.

Read before choosing the window:

- `session.search_path`: the mirror had `"$user", public, extensions`. Record what
  the endpoint has. PR 323's batches ran under it and read back EQUAL.
- `sizes`, which bound validation and lock time.
- `context`: `account_archive_r2_enabled`, `embryo_split_enabled` and
  `pgt_table_ingest_sessions` decide whether the TEST-only items in
  `../compat-analysis.md` can occur, and `family_pairs_ended` counts the files #7 can
  newly let through.

## Production commands

The transport, probes and exact command sequence are in `../api/RUNBOOK.md`. The same
files run under psql over a session-level connection with the command shape below,
which the rehearsal used:

```sh
PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '180s'" -f batch-$k-dry-run.sql   # rc=3, exactly one ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED
```

Order: pre-checks and the pre-state read-back (EQUAL batch 1 pre); the whole-release
dry run (sentinel), then a read-back (EQUAL batch 1 pre). Then, for k = 1..4: the
dry run (sentinel), a read-back (EQUAL k pre), the apply (rc 0), a read-back
(EQUAL k post), and the ledger.

The expected ledger after each batch:

| After batch | Rows | Max version |
|---|---|---|
| 1 | 253 | `20261016175000` |
| 2 | 259 | `20261016196000` |
| 3 | 272 | `20261016220000` |
| 4 | 273 | `20261016221000` |

## Stop rules

- Any `SHA256SUMS` line not OK, or `generate.py --head <PR 324 head>` refusing:
  stop.
- Any pre-check stop rule above: stop.
- A pre-state read-back that is not EQUAL: stop; production is not what was
  rehearsed.
- A dry run with rc other than 3, without the exact sentinel, or with any other
  `ERROR:`: stop and do not apply. Read back; it must still be EQUAL to the
  pre-state.
- An apply with rc other than 0: the statement rolled back as a whole. Read back: the
  summary must equal the batch's **pre**-state and the ledger must be unchanged.
  Retry only `canceling statement due to lock timeout` or `deadlock detected`, at a
  quieter time, starting again from that batch's dry run. Anything else: stop.
- No response (rc 124): assume nothing. Wait two minutes for the server's statement
  timeout, then read back. The state must be exactly the batch's pre-state or exactly
  its post-state, with the ledger to match. Anything else: stop.
- A post read-back that is not EQUAL: stop. Do not run the next batch; do not merge.
- Stopping after any batch is safe for the deployed main code
  (`../compat-analysis.md`). Resume later from the next batch's dry run. PR 324
  cannot deploy until batch 4 is in.
- Never run `supabase db push` or apply any migration file directly in between.

## The production mirror the batches were rehearsed on

1. **Fresh main.** An isolated stack (`supabase start -x` everything but the
   database, project `rel324`, port 55322, from a scratch copy of 12f24475's
   `supabase/`) applied 245 migrations, auth and storage schemas initialised as on the
   shared stack. Its fingerprint is byte-identical to the earlier fresh build of
   PR 323's tree (`fp-B-merge.json`, SHA-256 `8860eee4…`).
2. **Ledger.** 3 stand-in rows (`00000000000001`-`00000000000003`) for production's 3
   rows without a repository file, giving 248 rows with max `20261011010251`.
3. **The 8 drifted bodies.** Each was stripped of its full-line `--` lines by
   PR 323's `strip_comments.py` and re-run as `CREATE OR REPLACE`. Owner, ACL,
   security definer and config were compared before and after: identical. Their
   per-line hashes equal `prod-linehash.txt` (read from production on 15 October).
4. **`pg_cron` 1.6.4** in `pg_catalog`.
5. **Comparison with production.** The mirror's full fingerprint equals production's
   2026-10-22 read-back object for object, in all nine categories: all 1,245
   functions with `def_md5`, ACL and config; all 251 tables with columns,
   constraints, indexes, triggers and policies. The summary is exact. The API's JSON
   renders sequence bounds as doubles, so those are compared after the same rounding.
   The mirror was built four times; every fingerprint was byte-identical
   (`../rehearsal/data/mirror-vs-production-2026-10-22.txt`).

`production-readonly-prechecks.sql` on the mirror's pre-state gave the values in the
stop rules, with `sizes` and `context` all 0 or false (no user data):
`../rehearsal/data/prechecks-on-mirror-pre.json`.

## Rehearsal results (this cut, on the mirror)

Command shape: `PGCLIENTENCODING=UTF8 timeout 190 psql "$DB" -X -v ON_ERROR_STOP=1 -c
"set statement_timeout = '180s'" -f <file>`. The whole-release dry run used `'2min'`,
the Management API session's value. Local seconds include psql start-up
(`../rehearsal/data/rehearsal-results.tsv`).

**Whole-release dry run** on the pre-state: rc 3, exactly one `ERROR:
DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 1.90 s. The fingerprint and ledger were unchanged
afterwards, and the read-back EQUAL batch 1 pre. It was repeated from the final
`SHA256SUMS` state on a rebuilt mirror: rc 3, the sentinel, 1.60 s, unchanged.

**Negative checks** before batch 1 (state unchanged afterwards). Each gave rc 3:

| Check | Error |
|---|---|
| Batch-1 dry run without a session `statement_timeout` | `session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)` |
| Batch-1 dry run with `statement_timeout = '190s'` | the same |
| Batch-2 dry run before batch 1 | `predecessor: ledger has 248 rows, max 20261011010251; expected 253 rows, max 20261016175000` |
| Batch-4 apply before batch 1 | `predecessor: ledger has 248 rows, max 20261011010251; expected 272 rows, max 20261016220000` |

In a separate rolled-back test, a comment-stripped
`prepare_genome_file_deletion_body_v1` made the pre-check report
`guarded_bodies_not_as_rehearsed = 1`, and #7's guard refused.

**Per batch:**

| Batch | Lock probe | Dry run (output, local seconds, state after, read-back) | Apply (output, local seconds, read-back) | Ledger after | Re-apply |
|---|---|---|---|---|---|
| 1 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 `ERROR: DRY_RUN_COMPLETE_ALL_CHECKS_PASSED`, 0.641 s, unchanged, EQUAL 1 pre | rc 0 `SET DO`, 0.670 s, EQUAL 1 post | 253 rows, max 20261016175000 | rc 3 `predecessor: ledger has 253 rows, max 20261016175000; expected 248 rows, max 20261011010251`, unchanged |
| 2 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.776 s, unchanged, EQUAL 2 pre | rc 0 `SET DO`, 0.739 s, EQUAL 2 post | 259 rows, max 20261016196000 | rc 3 `predecessor: ledger has 259 rows ...; expected 253 rows ...`, unchanged |
| 3 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.708 s, unchanged, EQUAL 3 pre | rc 0 `SET DO`, 0.712 s, EQUAL 3 post | 272 rows, max 20261016220000 | rc 3 `predecessor: ledger has 272 rows ...; expected 259 rows ...`, unchanged |
| 4 | rc 3, 1 PROBE_LOCKS line, unchanged | rc 3 sentinel, 0.770 s, unchanged, EQUAL 4 pre | rc 0 `SET DO`, 0.790 s, EQUAL 4 post | 273 rows, max 20261016221000 | rc 3 `predecessor: ledger has 273 rows ...; expected 272 rows ...`, unchanged |

**Timings.** Measured inside the block, the migrations take 0.45 s, 0.34 s, 0.30 s and
0.34 s, about 1.4 s in all. The binding limit in production is the endpoint's
2-minute `statement_timeout` (the guard allows up to 180 s). Locally, every batch
finishes in under 1 % of that limit. Production adds lock waits, which `lock_timeout` 10 s bounds,
and data: production's rows of the touched tables are counted in `sizes`, and on
22 October, before PR 323's batches, production had 45 subjects and 33 genome files
(`../../pr323-production-apply-20261016/results/run-2026-10-22/prechecks.json`).

**Old contract.** Main's (12f24475) pgTAP suite, 201 files and 13,549 tests, was run
after each step:

| State | Result |
|---|---|
| Pre-state | PASS |
| After batch 1 | FAIL: `embryo_split_worker` 67, `export_member_plan` 2-3 and 13, `future_person_claim_contact_retention` 58, `other_adult_held_upload` 63 |
| After batch 2 | adds `drop_generated_artifacts_bucket` 2, `drop_genomes_staging_bucket` 2, `embryo_qc_precise_json` 57 and 59, `other_adult_held_upload` 69 |
| After batch 3 | adds `other_adult_held_upload` 68 |
| After batch 4 | adds `export_member_plan` 9 and 30 |

Each set contains the previous one, and the final set equals the run on the plain
post-25 state. All are inventory or exact-definition assertions, or TEST-only
behaviour changes (`../compat-analysis.md`, "Old-contract failures"). Every suite
run left the fingerprint and ledger unchanged.

**New contract.** PR 324's suite at its final head `044601be` (migration tree equal to
538dcee6) on the rehearsed final mirror: 228 files, 15,527 tests, PASS. The final state
was unchanged afterwards.

**Order equivalence** (`../rehearsal/data/equivalence.txt`). Dumps are pg_dump 17.6
`--schema-only`, normalised by dropping its two random `\restrict`/`\unrestrict` key
lines.

- **Fresh main + the 25 (`psql -1 -f` each, 3.36 s) against a fresh 538dcee6 build (270
  migrations).** The fingerprints are byte-identical (SHA-256 `03f66651…`) and the
  normalised dumps are identical (101,195 lines, SHA-256 `d089784e…`).
- **The rehearsed final mirror (production mirror + the four guarded batches) against
  fresh 538dcee6 with the same drift applied.** The fingerprints are byte-identical
  (`4d2a2747…`) and the normalised dumps are identical (101,273 lines, `ae97d7c4…`).
- **The final mirror against plain fresh 538dcee6.**
  - Fingerprint: only the 8 drifted `def_md5` values and the `pg_cron` row differ.
  - Dump: 27 lines are only in 538dcee6. They are the full-line comments of the 8
    bodies (2+2+4+3+4+6+2+4). 105 lines are only in the mirror, all of them pg_cron
    (the extension, its comment, and its `cron` grants).

Expected final production state: the batch-4 post-state above (functions 1,397 /
`979c1436…`, tables 267 / `fb3edb51…`, sequences 9 / `dbbac443…`, storage_buckets 4 /
`08130193…`, the rest unchanged).

## Deploy-window conclusions (details and file:line in `../compat-analysis.md`)

- **The 25 migrations: 10 additive-safe, 15 safe-with-reason, 0 BREAKS-OLD-CODE.**
  Main's production-reachable code is compatible at every batch boundary and after
  batch 4.
- **Behaviour changes main shows in the window:**
  - #7 lets a file whose only family pairs have ended, with no joint results,
    be deleted. That is the owner's Q6 decision.
  - #9 adds one `download_sessions` scan per deleted file, through the new
    foreign key.
- **Not reachable by main, because production does not configure or enable them:**
  - the pgt_table split (#1);
  - claimant clocks (#5);
  - Path B (#4, #8, #16, #25);
  - the TEST R2 subject export (#11);
  - the reviewer surfaces.
- **Locks.**
  - Batch 1 holds `auth.users` SHARE ROW EXCLUSIVE: sign-ins wait for its sub-second
    run.
  - Batch 2 holds ACCESS EXCLUSIVE on `account_operation_nonces`,
    `adult_subject_drafts` and `download_sessions`, and SHARE ROW EXCLUSIVE on
    `subjects`, `genome_files`, `subject_principals`, `subject_invitations` and
    `private.claim_reviewers`.
  - Batch 3 holds ACCESS EXCLUSIVE on `account_operation_nonces` and
    `correction_assignments`.
  - Batch 4 holds ACCESS EXCLUSIVE on `subjects`, `other_adult_held_uploads` and
    `account_operation_nonces`.

  No `auth` or `storage` table is locked beyond these, ACCESS SHARE reads, and
  batch 2's bucket-row insert. Dry runs take the same locks. Choose a quiet time.
  A lock wait beyond 10 s cancels the batch, which is safe to retry later.
- **Merge PR 324 straight after batch 4.** Its code needs all 25. Main's does not
  break meanwhile, so a delay is not an incident.
- **Outside the fingerprint.** It does not cover `auth`. #2's foreign keys from
  `private.auth_form_nonces` and `private.auth_recovery_sessions` to `auth.users`
  are part of those tables' constraints, which the fingerprint does cover. No
  migration adds a trigger, policy or column to an `auth` or `storage` table, or an
  event trigger.

## Local state afterwards

The isolated stack was stopped with `supabase stop --no-backup` for project `rel324`.
Its container, volume and network are gone. The shared stack (project `sequence`, 12
containers) was never modified; its ledger read 246 rows / max `20261016120000` before
and after. The large local fingerprints and dumps were deleted. Their SHA-256 values
are in `../rehearsal/data/equivalence.txt`.
