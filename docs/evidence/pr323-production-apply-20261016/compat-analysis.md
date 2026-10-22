# Deploy-window compatibility: the 90 migrations of 08a33a0b over main c993dea8

The release applies all 90 migrations to production before PR 323 merges, so main
`c993dea81da67e5af9ef6e7e836579a6aa283bdc` keeps serving against the new schema for
the length of the window (and against each intermediate batch state before that).
Everything below was observed locally (Supabase CLI 2.116.0, PostgreSQL 17.6, project
`sequence`); no production or remote system was contacted.

## What "old code" means here

Runtime code at c993dea8: the Next.js app in `src/` (routes and the Vercel crons in
`vercel.json`: `/api/jobs/mail` and `/api/cron/retention` every minute,
`/api/jobs/research-refresh` and `/api/jobs/annotation-refresh` daily), the
self-host worker `worker/src/index.ts` (direct Postgres, `worker_jobs`), and the
Cloudflare `workers/` (the prepared worker runs `scripts/prepared-worker.run.mts`).
Everything reaches the database through PostgREST as `service_role` or the signed-in
user (`public` and `graphql_public` exposed, supabase/config.toml:13), except the
self-host worker.

## Method

1. **Measured, not inferred, object changes.** Each migration was applied alone, in
   filename order, on a fresh main build, and the catalog fingerprint
   (`fingerprint.sql`) was taken after each one. Every object that exists in main was
   diffed step to step (`analysis/step-main-changes.txt`): 53 existing functions and
   107 existing tables change; no main function signature or table disappears at any
   step (the rename-and-wrap migrations give a function a new OID inside one migration
   but keep its signature and return type), and no step adds an overload of an existing
   function name, so PostgREST resolves main's RPC calls as before. Only six private
   functions change grants (service_role loses EXECUTE: the four refused-cleanup
   helpers in #58, `authorize_mail_submission_v1` in #48, `embryo_ingest_binding_failure_v1`
   in #78); every public function main calls keeps its grants.
2. **Statement scan** of all 90 files: every top-level statement classified, all 64 DO
   blocks listed with the statement kinds they contain and the ones touching existing
   objects or data read (the large function-patching blocks were checked through the
   measured step diffs rather than line by line), for DDL on existing objects, data
   statements, validations, rewrites and locks (`analysis/main-touching-statements.txt`,
   `analysis/do-blocks.txt`).
3. **Old-code usage**: every changed function name and every directly written table
   was searched in c993dea8's runtime code (tests excluded).
4. **The old contract, executed**: main's own pgTAP suite (118 files) was run against
   the production mirror before any batch, at the boundaries of the preferred cut
   (after #21 and #50), at the boundaries of the chosen cut (after #2, #58, #89) and on
   the final state.
5. **Locks**: every batch was probed in a rolled-back transaction listing the relation
   locks it holds at its end, and a per-migration trace attributed each new lock.
6. **Write-path timing**: main's legacy Tier-1 write shape timed before and after.

## Result

| Class | Migrations |
| --- | --- |
| additive-safe | 37 |
| safe-with-reason | 49 |
| BREAKS-OLD-CODE | 4 (#3, #18, #49 between batches only; #85 until the new code deploys) |

### BREAKS-OLD-CODE

1. **#85 `20261010063629_adult_upload_notice_context.sql`, lasts until PR 323 deploys.**
   It adds `uploaderName` to the `adult-upload-notice` mail payload
   (`private.complete_own_upload_finalization_v1`, :5, :45) and to the
   `public.read_adult_upload_revision_v1` result (:91-107). Main parses both with
   `.strict()` zod: `adultUploadNoticePayload` (src/app/api/jobs/mail/route.ts:58-64,
   used at :166-173) throws, the catch records `provider_or_payload_error` (:338) and
   the row backs off (1, 2, 4 ... minutes, `failed` after 10 attempts); and
   `adultUploadRevisionView` (src/lib/uploads/other-adult-upload.ts:255-262) rejects the
   read at src/lib/uploads/path-b-review.ts:212-215, so the held-file review shows
   nothing. Main's own test `other_adult_held_upload` 74 fails on exactly this key.
   Reachable only with Path B enabled: `INHERIT_TEST_JURISDICTION=1`
   (src/lib/legal/jurisdictions.ts:166-169; gates at
   src/lib/uploads/other-adult-upload-server.ts:48,174,245 and path-b-review.ts:209).
   Notices queued before the window carry no `uploaderName` and are unaffected.
2. **#3 + #18 + #20, repaired by #51 (between batches only).** #3 adds
   `rights_sessions_registered_purpose` (20260929150000_rights_purpose_matrix.sql:127)
   with a registry of two purposes (:85); main's `public.activate_rights_session_v1`
   also issues `adult-upload-confirmation` sessions. #18 (:337, :530, :566) and #20
   (:488, :942, :1029) replace `public.claim_mail_outbox`,
   `private.authorize_mail_submission_v1` and `public.activate_rights_session_v1`
   without the held-revision arm; #51 (20261001025000_path_b_future_rights_activation.sql:6,
   :59) restores the arms and registers the purpose. In between, main's mail cron gets
   `adult-upload-notice` rows without a delivery token (`fragmentUrl` throws,
   src/app/api/jobs/mail/route.ts:113-117) and held-upload links 404 at
   `/api/rights/activate` (src/app/api/rights/activate/route.ts:29). Observed: main's
   suite after #21 fails `other_adult_held_upload` (8 tests, aborted),
   `path_b_account_branch` (4), `path_b_normalization` (10), `path_b_queued_reports` (3)
   and `path_b_reading_layer` (3), all of which pass before the release; "the notice link
   opens a rights session without an account" is one of them. Path B only (gated as above).
3. **#49, repaired by #58 (between batches only).** #49 revokes every privilege of
   `service_role` on `public.future_person_claim_objections`
   (20261001023000_future_person_owner_objection_prerequisite.sql:44). Main's
   refused-invitation cleanup (retention cron, src/app/api/jobs/retention/route.ts:141
   -> src/lib/embryos/refused-invitation-cleanup.ts:19-23 ->
   `public.claim_refused_invitation_draft_purge_v1`, SECURITY INVOKER as `service_role`
   -> `private.assert_refused_evidence_exclusive_v1`, which reads that table) then fails
   with permission denied whenever a refused draft is due. #58
   (20261001032000_refused_cleanup_owner_authority.sql:6) makes the five public
   functions SECURITY DEFINER. Fail-closed: the drain counts a failure and retries next
   minute. Observed: main's suite after #50 aborts `refused_invitation_draft_cleanup` and
   `invitation_public_refusal` with `permission denied for table
   future_person_claim_objections`. In the same span #47 has revoked service_role's
   TRUNCATE on `user_variants` (restored by #58; main test `rls_truncate_not_bypassed` 8).

The chosen cut puts #3-#58 in one transaction, so items 2 and 3 are never visible to
the deployed code. Item 1 is in batch 3, so it is visible from the batch 3 commit until
the deploy.

### Behaviour changes main will see (not breaks)

- **Account-deletion cancellation signs the user out everywhere** (#23
  20260930238000_account_cohort_notices.sql:445 in `public.cancel_account_deletion_v1`,
  reached from src/app/api/account/delete/cancel/route.ts:36 via v2). Main's tests
  `account_operation_nonce_rendered` 20-21 fail for this reason.
- **Mail functions carry `lock_timeout=250ms`** (#48 and later wrappers): a lock wait
  over 250 ms in `claim_mail_outbox`, `complete_mail_attempt`,
  `record_resend_mail_event` or `activate_rights_session_v1` now errors instead of
  waiting (mail cron: 503 or break, retried next minute; Resend webhook: error, provider
  retry; rights activation: one failed click). Provider idempotency keys become per
  attempt (`private.mail_provider_attempt_key_v1`).
- **New mail templates for cohort-owning accounts** (`account-deletion-affected`,
  `-cancelled`, #23): main renders none of them (`mail_template_unknown`,
  src/app/api/jobs/mail/route.ts:212); only accounts that own embryo cohorts can produce
  them, and main refused deletion for those accounts (#21 lifts that refusal).
- **Result writes take a subject row lock** (#26) and **every delete runs a sealed-graph
  check** (#30); **user_variants/report_observed_calls statements bump
  `genome_files.export_content_revision`** under lock_timeout 250 ms (#47). Measured on
  main's legacy Tier-1 write shape (src/app/api/files/[id]/process/route.ts:212-246) as
  `service_role`: one 10,000-row `user_variants` INSERT took 194-298 ms before and
  621-648 ms after; deleting 30,000 rows of one file took 16 ms before and 284 ms after
  (`rehearsal/logs/perf-probe-{pre,post-b4}.log`). A 600,000-variant array file would
  spend roughly 25 s more inside the route's 270 s budget (route.ts:44).
- **Owner file listing hides cohort/embryo files** (#10 policy), **embryo
  restriction deletes canonical sources** (#16), **the generic job claim skips
  `score_embryo`** (#70, main test `embryo_ingest_unwind_storage` 113), **a refused
  restricted-cohort disposition says `embryo unavailable`** (#35, main test
  `embryo_cohort_runtime` 104). Embryo ingest is unavailable in main
  (`EMBRYO_INGEST_AVAILABLE = false`, src/copy/embryos/upload.ts:34) and the export
  archive is not wired to any route (src/lib/exports/archive-persistence.ts has no
  importer).
- Nullable `genome_files.user_id`, `embryos.cohort_id`, `generated_exports.account_id`
  (#20, #28): only claimed/independent rows that the new code creates can be NULL.

### Main's own suite on the final state

On the mirror before the release: 118 files, 5,504 tests, PASS. On the final state:
FAIL in 9 files. Besides the #85 break and the behaviour changes above (`account_operation_nonce_rendered`
20-21, `embryo_cohort_runtime` 104, `embryo_ingest_unwind_storage` 113,
`other_adult_held_upload` 74), the failures are inventory assertions that enumerate
buckets, tables, columns, purge stores or registry counts and now see the new objects
(`drop_generated_artifacts_bucket` 2, 6-7; `drop_genomes_staging_bucket` 2, 6;
`export_member_plan` 2-3, 9, 13, 30; `other_adult_held_upload` 61; `v2_contracts` 2, 5),
a fixture that inserts an embryo subject without `owner_account_id`
(`refused_evidence_write_fence`, now refused by `subjects_claimed_custody_shape`), and
`embryo_cohort_runtime` 149, where test-local DDL after DML meets the new deferred
constraint triggers (#21). PR 323 updates exactly these test files.

## Data-dependent statements

None of these can be proven on the empty mirror; each either passes trivially on the
rows main can have produced, or is listed with the read-only pre-check that decides it
(`guarded/production-readonly-prechecks.sql`, `must_be_zero` unless stated). Any of
them failing in production makes that batch's dry run fail; nothing commits.

| Where | Statement | Production dependency |
| --- | --- | --- |
| #2 :105-106 | re-add `chat_messages.canonical_chat_citations_valid` | validates every chat_messages row through plpgsql validators under ACCESS EXCLUSIVE; old OR new, so existing rows pass; cost ~ `sizes.chat_messages` |
| #5 :24, :28 | insert bucket `future-person-identity`, DO guard | guard refuses an existing incompatible bucket (`future_person_identity_bucket` 0) |
| #7 :36, :51 | 4 columns with UNIQUE/CHECK on `embryo_ingest_sessions`; partial UNIQUE index on `worker_jobs` | index build scans worker_jobs (SHARE lock); fails on duplicate split jobs (`duplicate_split_jobs_per_binding`) |
| #10 :122 | index on `embryo_variants` | build scan, SHARE lock (`sizes.embryo_variants`) |
| #13 :28 | DO guard | refuses published embryo sessions that still hold fragments (`published_embryo_sessions_with_fragments`) |
| #15 :27, :31; #75 :4-8, :31-34; #87 :503-504; #88 :5397-5398 | CHECKs replaced by supersets | re-validated over existing rows; supersets, so they pass |
| #20 :16-17, :31, :35 | new subjects CHECKs | every embryo subject must have `owner_account_id` (`embryo_subjects_without_owner`); no subject may already be claimed (`subjects_in_claimed_lifecycle`) |
| #20 :51 | `embryos_live_cohort_shape` | no embryo may already be `claimed_bound`, which main's CHECK allowed (`embryos_in_claimed_status`) |
| #20 :54 | GENERATED ... STORED column on `embryos` | rewrites `embryos` under ACCESS EXCLUSIVE (`sizes.embryos`) |
| #20 :101 | unique current principal per claimant | `duplicate_current_claimant_principals` |
| #22 :56 | DO moves two purge-store rows | refuses if frozen manifests already reference them |
| #25 :5 | DO guard | `private.claim_document_sessions` is created by #5, so it is empty |
| #28 :328, #33 :21, #37 :18, #46 :33/:43, #47 :4, #49 :35, #70 :485, #89 :14 | CHECKs over new NULL/constant-default columns | pass on any data; each validation scans its table |
| #4 :61, #5 :127, #6 :159, #17 :95, #77 :781/:995, #78 :176/:528, #79 :26, #81 :20, #83 :19 | `purge_target_stores` rows with explicit `store_order` | unique (target_id, store_order); the registry md5s must equal the mirror's (`registry_md5`) |
| #8, #10, #18, #20, #21, #30, #72-#75 | `purge_target_stores` rows at max(store_order)+1 | same registry |
| #30 :6 | `retention_phase_registry` row | same registry |
| #49 :18 | UPDATE future_person_claim_notices | filters on a column added by #46, so it matches no existing row |
| DO pins in #48, #51, #54, #56, #58-#73, #87-#89 | md5(prosrc)/definition/ACL pins on functions | production equals main except the 8 comment-stripped bodies, which no pin names (searched; the rehearsal mirror has the production bodies) |

No statement rewrites or backfills a large existing table except the `embryos` rewrite
(#20); constant ADD COLUMN defaults (#13, #20, #28, #33, #47) do not rewrite.

## Batch plan: why not #1-21 / #22-50 / #51-89 / #90

The preferred cut leaves two repair pairs split across batches, and main's own suite
shows the damage at those boundaries (rehearsed on the production mirror):

| State | Main's suite (118 files) |
| --- | --- |
| before the release | PASS, 5,504 tests |
| after #21 (preferred batch 1) | FAIL in 11 files: inventory/fixture failures of the kind the final state also has, plus Path B suites that pass both before the release and on the final state: `other_adult_held_upload` (8 failed, aborted), `path_b_account_branch` (4), `path_b_normalization` (10), `path_b_queued_reports` (3), `path_b_reading_layer` (3) |
| after #50 (preferred batch 2) | FAIL in 15 files: as after #21 (Path B still broken), plus `refused_invitation_draft_cleanup` and `invitation_public_refusal` aborted with `permission denied for table future_person_claim_objections`, and `rls_truncate_not_bypassed` 8 (service_role TRUNCATE on user_variants, revoked by #47, restored by #58) |
| after #2 (chosen batch 1) | PASS, 5,504 tests |
| after #58 (chosen batch 2) | FAIL: 8 files fail, all of them among the final-state failures (not yet failing: embryo_ingest_unwind_storage); `other_adult_held_upload` fails only its inventory test 61 here (test 74, the #85 break, fails from #89 on); Path B and refused-cleanup suites pass |
| after #89 (chosen batch 3) | FAIL: 9 files fail, all of them among the final-state failures |
| final (after #90) | FAIL in 9 files, all explained above (inventory assertions and the listed behaviour changes) |

The chosen cut is **#1-#2, #3-#58, #59-#89, #90**:

- #3 through #58 commit together, so the Path B dispatcher/registry gap (#3, #18, #20
  -> #51) and the claimant-objection privilege gap (#46/#47/#49 -> #58) are never
  visible to the deployed code.
- Only batch 2 contains policy DDL or DROP TRIGGER (#10, #13, #20, #41, #57). In this
  Supabase image those statements fire supautils' `policy_grants` /
  `drop_trigger_grants` hook, which takes ACCESS EXCLUSIVE on every table listed for
  `postgres` (all 16 `auth.*` tables, including `auth.users`, `auth.sessions`,
  `auth.refresh_tokens`, and 5 `storage.*` tables including `storage.objects` and
  `storage.buckets`) and holds them to commit. Observed: a bare
  `create policy ... using (true)` on a temporary table waited on
  `AccessExclusiveLock` for `auth.mfa_factors`; `supautils.policy_grants` and
  `supautils.drop_trigger_grants` list those tables. The preferred cut would take that
  hold three times (from #10, #41 and #57); the chosen cut takes it once, from #10 to
  the end of batch 2 (0.73 s of migration time locally, plus the postcheck). Whether
  production's supautils lists the same tables is reported by the read-only pre-check
  (`session.supautils_*`).
- Batch 1 (#1-#2) isolates the one full validation of `chat_messages` (ACCESS
  EXCLUSIVE on chat_messages only).

## Locks held at the end of each batch (local probe of the batch's own transaction)

| Batch | ACCESS EXCLUSIVE on existing public/private tables | ACCESS EXCLUSIVE on auth.*/storage.* | SHARE ROW EXCLUSIVE (writes blocked) | SHARE / EXCLUSIVE |
|---|---|---|---|---|
| 1 | 1: chat_messages | 0 | 1 | - |
| 2 | 18: consent_artifacts, embryo_ingest_delete_objects, embryo_ingest_sessions, embryo_ingest_unwinds, embryo_qc, embryos, future_person_claim_notices, future_person_claim_objections, future_person_claim_release_credentials, future_person_claim_review_packages, future_person_claimant_identity_hmacs, future_person_claimant_principals, future_person_identity, generated_exports, genome_files, rights_sessions, subjects, worker_jobs | 21 | 91 | - |
| 3 | 6: private.export_archive_attempts, private.export_archive_downloads, appeal_intakes, embryo_scores, encrypted_contact_references, subject_principals | 0 | 9 | - |
| 4 | 0: - | 0 | 0 | - |

Every lock is held until the batch commits (local apply times are in the README).
Within one batch, `lock_timeout` 10 s bounds each wait; a wait queues later requests
for that table behind it. The dry runs take exactly the same locks.

## Every migration

| # | Migration | Batch | Existing objects changed (measured) | Class | Notes (file:line in the migration unless a path is given) |
|---|---|---|---|---|---|
| 1 | `20260929112000_embryo_ingest_route_doors.sql` | 1 | none | additive-safe | New private/public embryo-ingest door functions only (TEST-LOCAL, `p_test`). |
| 2 | `20260929143000_cohort_copilot_scope.sql` | 1 | 2 table(s): chat_messages, purpose_grants | safe-with-reason | Drops and re-adds `chat_messages.canonical_chat_citations_valid` (:105-106) as the old OR-expression plus `valid_cohort_copilot_citations_v1`: every existing row still passes, but the re-add validates every `chat_messages` row by calling the plpgsql validators under ACCESS EXCLUSIVE (data-dependent cost). `purpose_grants` AFTER UPDATE OF revoked_at trigger (:141) acts only for `embryo.analysis`/`cohort` grants. |
| 3 | `20260929150000_rights_purpose_matrix.sql` | 2 | 1 table(s): rights_sessions | BREAKS-OLD-CODE | Adds BEFORE INSERT/UPDATE OF purpose,target_kind trigger `rights_sessions_registered_purpose` (:127) whose registry (:85) holds only adult-subject-invitation and co-parent-invitation. Main's `public.activate_rights_session_v1` also inserts `adult-upload-confirmation` sessions, which are refused until #51 registers that purpose. Old path: `/api/rights/activate` (src/app/api/rights/activate/route.ts) for a Path B held-upload link -> 404. TRANSIENT only; Path B is gated by INHERIT_TEST_JURISDICTION=1 (src/lib/uploads/other-adult-upload-server.ts:48). Closed by keeping #3-#51 in one batch. |
| 4 | `20260929150100_future_person_claim_intake.sql` | 2 | 1 function(s): hmac_key_revision_in_use_v1 | safe-with-reason | `private.hmac_key_revision_in_use_v1` replaced (:255; private, called inside DB); registry row in `purge_target_stores` with explicit store_order 9 (:61; data-dependent on the unique (target_id, store_order)). |
| 5 | `20260929151000_future_person_claim_documents.sql` | 2 | storage_buckets:future-person-identity | additive-safe | New private bucket `future-person-identity` (:24, ON CONFLICT DO NOTHING) and a DO guard (:28) that refuses if an incompatible bucket of that id exists (data-dependent); new tables/functions; registry rows (:127). |
| 6 | `20260929152000_future_person_claim_review.sql` | 2 | none | additive-safe | New tables/functions; registry rows (:159). |
| 7 | `20260930120000_embryo_ingest_completion.sql` | 2 | 2 table(s): embryo_ingest_sessions, worker_jobs; 1 function(s): assert_embryo_unwind_plannable_stores_v1 | safe-with-reason | `embryo_ingest_sessions` ADD COLUMN x4 with CHECK/UNIQUE/FK (:36, ACCESS EXCLUSIVE; unique indexes built), trigger (:75), partial UNIQUE index on `worker_jobs` (source_binding_id) WHERE kind='split_cohort_vcf' (:51; SHARE lock on worker_jobs while built; fails if two split jobs share a binding), private planner replaced (:158). Embryo ingest is unavailable in main (`EMBRYO_INGEST_AVAILABLE = false`, src/copy/embryos/upload.ts:34). |
| 8 | `20260930121000_embryo_split_worker.sql` | 2 | none | additive-safe | New tables/functions; registry rows (:109, :112). |
| 9 | `20260930122000_embryo_split_publication.sql` | 2 | none | additive-safe | New functions only. |
| 10 | `20260930123000_embryo_canonical_sources.sql` | 2 | 2 table(s): embryo_variants, genome_files | safe-with-reason | DO (:599) ALTERs policy `genome_files_select_own` to add `private.genome_file_owner_listable_v1(id)` (hides cohort/embryo files from the owner listing; one extra SQL function call per row for every authenticated `genome_files` read, e.g. src/app/api/files/[id]/process/route.ts:53-57). Policy DDL fires the supautils policy_grants hook, which locks every auth.* and storage.* table ACCESS EXCLUSIVE until commit (see lock section). Index on `embryo_variants` (:122, SHARE lock, build scan). |
| 11 | `20260930124000_embryo_publication_dates.sql` | 2 | 1 table(s): embryos | safe-with-reason | `embryos` AFTER UPDATE OF status trigger (:142), embryo only. |
| 12 | `20260930125000_own_upload_allowance_excludes_embryo.sql` | 2 | 2 function(s): issue_own_storage_upload_v1, own_upload_limits_v1 | safe-with-reason | `private.issue_own_storage_upload_v1` (:22) and `private.own_upload_limits_v1` (:72) replaced: the own-upload allowance stops counting embryo files. Reached by main's upload issuance (src/lib/uploads/subject-upload-issuance.ts, own-upload-limits.ts) through unchanged public doors; only more permissive. |
| 13 | `20260930130000_embryo_ingest_terminal_purge.sql` | 2 | 3 table(s): embryo_ingest_delete_objects, embryo_ingest_sessions, embryo_ingest_unwinds; 2 function(s): guard_embryo_ingest_inventory_v1, guard_embryo_ingest_unwind_state_v1 | safe-with-reason | DO guard (:28) refuses if any published embryo ingest session still has fragments (data-dependent); `embryo_ingest_unwinds` ADD COLUMN purpose NOT NULL DEFAULT 'abandoned' + CHECKs (:40, constant default, no rewrite); DROP TRIGGER on `embryo_ingest_delete_objects` (:105) fires the supautils drop_trigger_grants hook (auth/storage ACCESS EXCLUSIVE). Embryo only. |
| 14 | `20260930131000_embryo_purge_retained_review.sql` | 2 | 1 function(s): assert_embryo_unwind_plannable_stores_v1 | safe-with-reason | Private embryo planner replaced. |
| 15 | `20260930132000_embryo_canonical_part_disposal.sql` | 2 | 2 table(s): embryo_ingest_delete_objects, embryo_ingest_unwinds; 3 function(s): claim_embryo_ingest_object_disposals_v1, embryo_ingest_unwind_unresolved_v1, prepare_embryo_ingest_unwind_v1 | safe-with-reason | CHECK constraints on `embryo_ingest_delete_objects` (:27) and `embryo_ingest_unwinds` (:31) replaced by supersets (existing rows pass; re-validated); `public.prepare_embryo_ingest_unwind_v1` replaced (main caller src/lib/embryos/ingest-failure.ts:32, embryo ingest unavailable). |
| 16 | `20260930150000_embryo_restriction_deletes_sources.sql` | 2 | 1 function(s): restrict_embryo_cohort_v1 | safe-with-reason | `public.restrict_embryo_cohort_v1` replaced: restriction now also deletes the cohort's canonical sources. Main caller src/app/api/cohorts/[id]/restrict/route.ts; intended semantics, embryo only. |
| 17 | `20260930230000_future_person_claim_release.sql` | 2 | none | additive-safe | New tables/functions; registry rows (:95, explicit orders 16..). |
| 18 | `20260930232000_embryo_parent_withdrawal.sql` | 2 | 4 function(s): activate_rights_session_v1, authorize_mail_submission_v1, claim_mail_outbox, restrict_embryo_cohort_v1 | BREAKS-OLD-CODE | Replaces `public.claim_mail_outbox` (:337), `private.authorize_mail_submission_v1` (:530) and `public.activate_rights_session_v1` (:566) with versions that have no `adult-upload-confirmation` (Path B held-revision) arm; #51 restores it. Between the two: main's mail cron (src/app/api/jobs/mail/route.ts:252-351, claim at :278) gets `adult-upload-notice` rows with no delivery token -> `fragmentUrl` throws (:113-117, :166-173) -> `complete_mail_attempt(false)` and a burned attempt with backoff; held-upload rights links 404. TRANSIENT, Path B only (gated). Closed by the #3-#58 batch. |
| 19 | `20260930232100_embryo_upload_live_account_read.sql` | 2 | none | additive-safe | New function only. |
| 20 | `20260930233000_future_person_claim_custody.sql` | 2 | 9 table(s); 6 function(s) | safe-with-reason | Largest change to existing tables. `subjects`: 3 new columns (:11, FK), CHECK replaced/added (:16-17, :31, :35) and `subjects_check1` dropped (DO :23) - all validated over every subjects row; `subjects_claimed_custody_shape` requires every embryo subject to have owner_account_id NOT NULL (data-dependent; main's own `subjects_check` allowed NULL). `embryos`: cohort_id DROP NOT NULL (:45), status CHECK superset (:46-47), `embryos_live_cohort_shape` (:51; fails if any embryo already has status claimed_bound, which main's CHECK allowed), GENERATED ... STORED column `future_person_state` (:54: rewrites `embryos` under ACCESS EXCLUSIVE), trigger dropped/recreated (:71). `genome_files.user_id` DROP NOT NULL (:78) plus AFTER triggers (custody cardinality, claimed owner). Unique index on claimant principals (:101). Replaces the mail/rights dispatchers again without the Path B arm (:488, :942, :1029) and drops/recreates `rights_sessions_registered_purpose` (:1023). Old writers pass (main's suite passes the subject/file tests at this state); NULL user_id/cohort_id appear only on claimed rows that only the new code creates. |
| 21 | `20260930235000_account_cohort_purge.sql` | 2 | 3 table(s): embryo_ingest_sessions, subjects, worker_jobs; 6 function(s) | safe-with-reason | DEFERRABLE INITIALLY DEFERRED constraint triggers `embryo_part_provenance` on `worker_jobs`, `embryo_ingest_sessions` and `subjects` (DO :118): every write to those tables now queues a per-row check at commit (main's self-host worker updates worker_jobs: worker/src/index.ts:49,94,102). Account-deletion request/claim/storage/purge functions replaced to purge owned cohorts; retention cron callers (src/app/api/jobs/retention/route.ts) see the same signatures. Accounts that own cohorts could not request deletion on main, so pending requests take the old path. |
| 22 | `20260930237000_future_person_contact_retention.sql` | 2 | 3 table(s): purge_manifests, retention_due_phases, retention_rows | safe-with-reason | BEFORE UPDATE triggers on purge_manifests/retention_due_phases/retention_rows scoped to the new future-person retention ids; DO (:56) moves two store rows between purge targets (refuses if frozen manifests already reference them; data-dependent). |
| 23 | `20260930238000_account_cohort_notices.sql` | 2 | 3 function(s): cancel_account_deletion_v1, claim_due_account_deletion_v1, request_account_deletion_v1 | safe-with-reason | Replaces `public.request_account_deletion_v1`, `public.cancel_account_deletion_v1` (:320) and `public.claim_due_account_deletion_v1`. Behaviour change for main: cancellation now deletes every auth session of the account (:445), so a user who cancels through main's /api/account/delete/cancel (route.ts:36 -> cancel v2 -> cancel v1) is signed out everywhere (main test account_operation_nonce_rendered 20-21 fail for this reason). Accounts owning cohorts (newly accepted) also queue `account-deletion-affected(-cancelled)` mail that main's mail route cannot render (`mail_template_unknown`, src/app/api/jobs/mail/route.ts:212): attempts back off and the new route sends them after deploy; only reachable for cohort-owning accounts. |
| 24 | `20260930239000_mail_queue_creation_clock.sql` | 2 | 1 function(s): enqueue_embryo_principal_mail_v1 | safe-with-reason | Embryo principal mail enqueue replaced (creation clock). |
| 25 | `20260930240000_future_person_document_keys.sql` | 2 | none | additive-safe | New functions; DO guard (:5) refuses if `private.claim_document_sessions` (created by #5) is non-empty. |
| 26 | `20260930241000_future_person_analysis_stop.sql` | 2 | 11 table(s) | safe-with-reason | BEFORE INSERT/UPDATE row triggers on user_variants, user_prs, ancestry_results, ancestry_regions, report_artifacts, report_observed_calls, embryo_variants/qc/scores and worker_jobs (DO :69): per row, resolves the subject and takes SELECT ... FOR UPDATE on it. Main's legacy Tier-1 route (src/app/api/files/[id]/process/route.ts:212-246, 262, 342, 355, 374) and the self-host worker keep working but slower and now serialize on the subject row (measured below). |
| 27 | `20260930242000_future_person_export_source.sql` | 2 | none | additive-safe | New functions only. |
| 28 | `20260930243000_future_person_export_members.sql` | 2 | 2 table(s): embryo_variants, generated_exports; 2 function(s): export_archive_authority_v1, export_archive_nonce_v1 | safe-with-reason | `generated_exports`: ADD COLUMN origin_kind NOT NULL DEFAULT 'account' (:326), account_id DROP NOT NULL (:327), CHECK (:328), triggers; `private.export_archive_authority_v1` rename-and-wrap (:300-301). Main does not call the export archive (src/lib/exports/archive-persistence.ts is imported by no route). |
| 29 | `20260930244000_future_person_account_binding.sql` | 2 | none | additive-safe | New tables/functions. |
| 30 | `20260930245000_future_person_claimant_erasure.sql` | 2 | 102 table(s); 1 function(s): claim_retention_phase_v1 | safe-with-reason | BEFORE DELETE row trigger `future_person_sealed_graph_delete` on 89 existing tables (DO :1460): every deleted row runs an EXISTS over purge_manifest_entries/purge_manifests (measured: deleting 30,000 user_variants rows 16 ms -> 284 ms). Plan/writer triggers on the retention tables (:932, :969) scoped to the new phase; subjects FK re-created (:1049-1050); registry row in retention_phase_registry (:6). SHARE ROW EXCLUSIVE on all 89 tables until commit. |
| 31 | `20260930246000_future_person_export_delivery.sql` | 2 | none | additive-safe | New function only. |
| 32 | `20260930247000_future_person_export_audit.sql` | 2 | none | additive-safe | New functions only. |
| 33 | `20260930248000_future_person_identity_profile.sql` | 2 | 4 table(s): embryos, future_person_identity, hmac_key_versions, subjects; 1 function(s): legal_audit_person_event_v1 | safe-with-reason | `future_person_identity` columns + CHECK; AFTER UPDATE triggers on subjects/embryos that erase future-person profiles only for embryo-linked current profiles; `hmac_key_versions` BEFORE UPDATE hold; `private.legal_audit_person_event_v1` rename-and-wrap (:64-67). |
| 34 | `20260930249000_future_person_profile_controls.sql` | 2 | none | additive-safe | New function only. |
| 35 | `20260930250000_embryo_disposition_controls.sql` | 2 | 1 function(s): record_embryo_disposition_v1 | safe-with-reason | `public.record_embryo_disposition_v1` moved to private and renamed (:143-145); a new public function with the same signature and ACL (:149) delegates. Main's route (src/app/api/embryos/[id]/disposition/route.ts:38) resolves it by name; a refused restricted-cohort disposition now says `embryo unavailable` instead of `cohort unavailable` (same 42501; main test embryo_cohort_runtime 104). |
| 36 | `20261001010000_result_basis_capture.sql` | 2 | 1 function(s): validate_own_ancestry_content_v1 | safe-with-reason | `private.validate_own_ancestry_content_v1`: new schemaVersion 4 branch only; v3 content unchanged. |
| 37 | `20261001011000_embryo_qc_basis_capture.sql` | 2 | 1 table(s): embryo_qc | safe-with-reason | `embryo_qc` ADD COLUMN figure_basis + CHECK (NULL passes) + trigger. |
| 38 | `20261001012000_future_person_bound_source_reader.sql` | 2 | none | additive-safe | New functions only. |
| 39 | `20261001013000_future_person_bound_archive_source.sql` | 2 | none | additive-safe | New functions only. |
| 40 | `20261001014000_account_archive_owned_members.sql` | 2 | none | additive-safe | New functions only. |
| 41 | `20261001015000_immutable_consent_publication.sql` | 2 | 1 table(s): consent_artifacts | safe-with-reason | DROP TRIGGER `consent_artifacts_immutable` and re-create it on a new guard (:82): fires the supautils drop_trigger_grants hook (auth/storage ACCESS EXCLUSIVE). Main's consent tests pass on the final state. |
| 42 | `20261001016000_future_person_keyless_verification.sql` | 2 | none | additive-safe | New functions only. |
| 43 | `20261001017000_account_archive_audit_members.sql` | 2 | none | additive-safe | New functions only. |
| 44 | `20261001018000_future_person_documentary_recovery.sql` | 2 | none | additive-safe | New functions only. |
| 45 | `20261001019000_account_archive_content_wrapper.sql` | 2 | none | additive-safe | New function only. |
| 46 | `20261001020000_future_person_keyless_notice_package.sql` | 2 | 2 table(s): future_person_claim_notices, future_person_claim_review_packages | safe-with-reason | `future_person_claim_notices` and `future_person_claim_review_packages`: columns, FKs (SHARE ROW EXCLUSIVE on auth.users, subjects, subject_principals, ...), CHECKs, triggers, and service_role loses its table privileges (:84). Main has no direct reader of these tables. |
| 47 | `20261001021000_account_archive_member_frame.sql` | 2 | 3 table(s): genome_files, report_observed_calls, user_variants | safe-with-reason | `genome_files` ADD COLUMN export_content_revision NOT NULL DEFAULT 1 + CHECK (:4); statement-level AFTER triggers on user_variants and report_observed_calls advance it by UPDATE genome_files under lock_timeout 250ms; service_role loses TRUNCATE on both tables (user_variants restored by #58). Main's legacy route inserts now also update genome_files per statement (a concurrent >250 ms lock on that genome_files row fails the insert). |
| 48 | `20261001022000_future_person_notice_provider_execution.sql` | 2 | 4 function(s): authorize_mail_submission_v1, claim_mail_outbox, complete_mail_attempt, record_resend_mail_event | safe-with-reason | Rename-and-wrap of `public.claim_mail_outbox`, `public.complete_mail_attempt`, `public.record_resend_mail_event` and `private.authorize_mail_submission_v1`; `public.authorize_mail_submission_v1` becomes SECURITY DEFINER (:191). Same signatures/return types for main's mail cron (src/app/api/jobs/mail/route.ts:278-345) and Resend webhook (src/app/api/webhooks/resend/route.ts:46); the wrappers add lock_timeout=250ms, so a lock wait over 250 ms now errors (cron answers 503/breaks and retries next minute; the webhook errors and the provider retries). Per-attempt provider idempotency keys (`private.mail_provider_attempt_key_v1`) replace the stored key. |
| 49 | `20261001023000_future_person_owner_objection_prerequisite.sql` | 2 | 3 table(s): future_person_claim_notices, future_person_claim_objections, rights_sessions; 1 function(s): activate_rights_session_v1 | BREAKS-OLD-CODE | `future_person_claim_objections` columns/index/CHECK/trigger and service_role loses its table privileges (:44); rights_sessions column + trigger; `public.activate_rights_session_v1` rename-and-wrap (:172-175). Main's refused-invitation cleanup (retention cron src/app/api/jobs/retention/route.ts:141 -> src/lib/embryos/refused-invitation-cleanup.ts:19-23 -> `public.claim_refused_invitation_draft_purge_v1`, SECURITY INVOKER as service_role -> `private.assert_refused_evidence_exclusive_v1`, which reads future_person_claim_objections) fails with permission denied whenever a refused draft is due, until #58 makes the public functions SECURITY DEFINER. TRANSIENT; fail-closed (claim error -> failed++, break; retried next minute). Closed by the #3-#58 batch. |
| 50 | `20261001024000_account_archive_member_inventory.sql` | 2 | none | additive-safe | New functions only. |
| 51 | `20261001025000_path_b_future_rights_activation.sql` | 2 | none | safe-with-reason | Repair: DO (:6) patches the inherited dispatchers to restore the held-revision notice claim, pre-submit check and session issuer, and registers `adult-upload-confirmation` (:59). Closes the #3/#18/#20 gap. |
| 52 | `20261001026000_account_archive_original_source.sql` | 2 | none | additive-safe | New functions only. |
| 53 | `20261001027000_future_person_account_objection.sql` | 2 | none | additive-safe | New functions only. |
| 54 | `20261001028000_future_person_keyless_human_decisions.sql` | 2 | 2 function(s): authorize_mail_submission_v1, claim_mail_outbox | safe-with-reason | Rename-and-wrap of `public.claim_mail_outbox` (:182-185) and `private.authorize_mail_submission_v1` (:254-257) with pinned predecessor checks (DO :157, :232). |
| 55 | `20261001029000_account_archive_class_inventory.sql` | 2 | none | additive-safe | New functions only. |
| 56 | `20261001030000_account_path_b_request_refusal.sql` | 2 | 3 function(s): assert_supported_self_deletion_graph_v1, request_account_deletion_v1, request_account_deletion_v2 | safe-with-reason | DO (:5) patches `private.assert_supported_self_deletion_graph_v1`, `private.request_account_deletion_v2` and `public.request_account_deletion_v1`: a deletion request is refused for unsupported Path B state (main caller src/app/api/account/delete/route.ts:43; Path B is gated). |
| 57 | `20261001031000_source_file_owner_privacy.sql` | 2 | none | safe-with-reason | DO (:3) re-verifies the composed genome_files policy (no net change) using policy DDL on a temporary table, which fires the supautils policy_grants hook (auth/storage ACCESS EXCLUSIVE). |
| 58 | `20261001032000_refused_cleanup_owner_authority.sql` | 2 | 1 table(s): user_variants; 9 function(s) | safe-with-reason | Repair: the five public refused-invitation functions become SECURITY DEFINER and their private helpers lose service_role EXECUTE (DO :6); service_role TRUNCATE on user_variants restored. Main's cleanup works again (as definer). Closes the #49 gap. |
| 59 | `20261001033000_future_person_native_keyless_release.sql` | 3 | none | additive-safe | New functions; DO predecessor pins; temporary table. |
| 60 | `20261001034000_embryo_qc_precise_json.sql` | 3 | none | additive-safe | ALTER FUNCTION ... SET extra_float_digits on functions created in this release. |
| 61 | `20261001035000_historical_embryo_producer_clocks.sql` | 3 | 2 function(s): close_embryo_disposition_proposal_v1, enqueue_embryo_principal_mail_v1 | safe-with-reason | `private.close_embryo_disposition_proposal_v1` and `private.enqueue_embryo_principal_mail_v1` replaced (embryo); DO shape checks. |
| 62 | `20261001036000_claimed_provenance_last_consumer.sql` | 3 | none | additive-safe | Patches functions created in this release (pinned). |
| 63 | `20261001037000_account_export_due.sql` | 3 | none | additive-safe | New function; pinned predecessor. |
| 64 | `20261001038000_account_archive_graph_rows.sql` | 3 | none | additive-safe | New functions; pinned predecessor. |
| 65 | `20261001039000_account_archive_readable_graph.sql` | 3 | none | additive-safe | Patches functions created in this release. |
| 66 | `20261001040000_historical_account_request_clock.sql` | 3 | 1 function(s): request_account_deletion_v1 | safe-with-reason | DO (:6) patches `public.request_account_deletion_v1` (pinned); main requests deletion through v2. |
| 67 | `20261002071943_settings_read_lock_order.sql` | 3 | none | additive-safe | Patches functions created in this release. |
| 68 | `20261002080931_verified_own_account_contact.sql` | 3 | 2 table(s): contact_hmac_indexes, encrypted_contact_references | safe-with-reason | DO (:5): `encrypted_contact_references` column + CHECK + BEFORE INSERT/UPDATE server-only trigger; `contact_hmac_indexes` BEFORE INSERT/UPDATE trigger; AFTER UPDATE OF email, email_confirmed_at trigger on `auth.users` (:217; outside the fingerprint scope). Refuses unless current_user is postgres. |
| 69 | `20261002092244_settings_authority_lock_normalization.sql` | 3 | none | additive-safe | Patches functions created in this release. |
| 70 | `20261002132000_embryo_observed_carrier_producer.sql` | 3 | 2 table(s): embryo_scores, worker_jobs; 1 function(s): claim_worker_job_v2 | safe-with-reason | `embryo_scores` column/CHECK/trigger; `worker_jobs` BEFORE UPDATE freeze trigger; `private.claim_worker_job_v2` no longer claims `score_embryo` jobs (main test embryo_ingest_unwind_storage 113), embryo only. |
| 71 | `20261003030000_path_b_confirmed_array_normalization.sql` | 3 | 1 function(s): enqueue_path_b_normalization_v1 | safe-with-reason | `private.enqueue_path_b_normalization_v1` replaced with pinned predecessor/successor checks (Path B). |
| 72 | `20261009183314_account_requester_statement_members.sql` | 3 | 2 table(s): appeal_intakes, correction_requests | safe-with-reason | AFTER UPDATE OF state / AFTER DELETE triggers on appeal_intakes and correction_requests (capsule cleanup, no-op for rows without capsules); registry row. |
| 73 | `20261009184100_account_archive_r2_reservations.sql` | 3 | 1 function(s): export_archive_worker_v1 | safe-with-reason | `public.export_archive_worker_v1` rename-and-wrap (:153-156); not reached by main. |
| 74 | `20261009193600_new_correction_intake.sql` | 3 | 1 table(s): correction_requests | safe-with-reason | `correction_requests` AFTER UPDATE OF state trigger; registry row. |
| 75 | `20261009200845_new_public_appeal_intake.sql` | 3 | 2 table(s): appeal_intakes, subject_principals; 2 function(s): authorize_mail_submission_v1, claim_mail_outbox | safe-with-reason | `subject_principals` CHECKs replaced by supersets (:4-8) and guard trigger; `appeal_intakes` CHECK superset + new shape CHECK (:31-34, existing rows pass); mail dispatcher rename-and-wrap (:268, :280). |
| 76 | `20261009201500_account_archive_test_completion.sql` | 3 | 1 table(s): export_archive_attempts; 1 function(s): guard_segmented_export_publication_v1 | safe-with-reason | `private.export_archive_attempts` column + trigger; export publication guard replaced (export not wired in main). |
| 77 | `20261009204626_public_appeal_evidence_session.sql` | 3 | 1 table(s): rights_sessions; 1 function(s): activate_rights_session_v1 | safe-with-reason | `rights_sessions` BEFORE INSERT/UPDATE trigger; `public.activate_rights_session_v1` rename-and-wrap (:75-78). |
| 78 | `20261009224500_public_appeal_matched_review.sql` | 3 | 4 function(s): embryo_ingest_binding_failure_v1, export_archive_authority_v1, other_adult_mitigation_v1, resource_authorized_v1 | safe-with-reason | Rename-and-wrap of `private.resource_authorized_v1` (:130), `private.other_adult_mitigation_v1` (:144), `private.export_archive_authority_v1` (:155), `private.embryo_ingest_binding_failure_v1` (:535); main reaches resource_authorized_v1 through unchanged public doors (src/lib/family/portrait.ts). |
| 79 | `20261009224501_public_appeal_decision_notice_continuation.sql` | 3 | 1 table(s): rights_sessions; 3 function(s): activate_rights_session_v1, authorize_mail_submission_v1, claim_mail_outbox | safe-with-reason | `rights_sessions` trigger; rename-and-wrap of the mail dispatchers (:92, :110) and `public.activate_rights_session_v1` (:185). |
| 80 | `20261010000000_embryo_record_key_card_controls.sql` | 3 | 1 function(s): deliver_embryo_record_key_cards_v1 | safe-with-reason | `public.deliver_embryo_record_key_cards_v1` replaced (main route src/app/api/embryo-cohorts/[id]/record-key-cards/route.ts; embryo). |
| 81 | `20261010001000_public_appeal_final_rejection.sql` | 3 | none | additive-safe | New table/functions; registry row. |
| 82 | `20261010002000_public_appeal_prior_uphold.sql` | 3 | none | additive-safe | New/renamed functions created in this release. |
| 83 | `20261010003000_public_appeal_more_information.sql` | 3 | 1 function(s): activate_rights_session_v1 | safe-with-reason | `public.activate_rights_session_v1` rename-and-wrap (:230-232); registry row. |
| 84 | `20261010004000_public_appeal_prior_reversal.sql` | 3 | none | additive-safe | Functions created in this release. |
| 85 | `20261010063629_adult_upload_notice_context.sql` | 3 | 2 function(s): complete_own_upload_finalization_v1, read_adult_upload_revision_v1 | BREAKS-OLD-CODE | Adds `uploaderName` to the `adult-upload-notice` payload (private.complete_own_upload_finalization_v1, :5/:45) and to the `public.read_adult_upload_revision_v1` result (:91-107). Main parses both with `.strict()` zod schemas: the mail route's `adultUploadNoticePayload` (src/app/api/jobs/mail/route.ts:58-64, used at :166-173) throws, so every such notice fails with provider_or_payload_error (:338) and backs off; `adultUploadRevisionView` (src/lib/uploads/other-adult-upload.ts:255-262) rejects the read (src/lib/uploads/path-b-review.ts:212-215), so the held-file review page shows nothing (main test other_adult_held_upload 74). Lasts until the new code is deployed; Path B only (INHERIT_TEST_JURISDICTION=1, path-b-review.ts:209). |
| 86 | `20261010080500_embryo_carrier_library_coverage.sql` | 3 | none | additive-safe | New functions only. |
| 87 | `20261010090000_embryo_test_statistical_coverage.sql` | 3 | 2 table(s): embryo_scores, worker_jobs | safe-with-reason | `embryo_scores` CHECK replaced by a superset (:503-504, re-validated); `worker_jobs` freeze trigger. |
| 88 | `20261010155222_embryo_test_statistical_fit.sql` | 3 | 2 table(s): embryo_scores, worker_jobs | safe-with-reason | `embryo_scores` CHECK replaced by a superset (:5397-5398, re-validated); `worker_jobs` freeze trigger. |
| 89 | `20261010190500_account_archive_complete.sql` | 3 | 1 table(s): export_archive_downloads | safe-with-reason | `private.export_archive_downloads` columns + CHECK; patches export functions created in this release. |
| 90 | `20261011010251_embryo_pending_input_read.sql` | 4 | none | additive-safe | New functions only. |

The measured per-migration object changes are in `analysis/step-main-changes.txt`; the statements touching existing objects, with line numbers, in `analysis/main-touching-statements.txt`.
