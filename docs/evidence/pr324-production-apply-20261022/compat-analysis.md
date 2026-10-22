# Deploy-window compatibility: the 25 migrations of 538dcee6 over main 12f24475

The release applies the 25 migrations that PR 324 (`538dcee6`) adds over main
`12f24475094653afe8f9935b75f352d76012b1b4` before PR 324 merges. Until PR 324
deploys, production keeps running main's code against the new schema (and,
between batches, against each intermediate state). Everything below was observed
locally on an isolated Supabase stack (CLI 2.116.0, PostgreSQL 17.6, project
`rel324` on port 55322, never the shared stack on 54322). No production or remote
system was contacted.

## What "old code" means here

Main's runtime at `12f24475` is PR 323's merge (`97a13f10`) plus PR 325, which
changed only Cloudflare build tooling (`scripts/cloudflare-docker-shim.sh` and its
test). The runtime surfaces are those of PR 323's analysis
(`../pr323-production-apply-20261016/compat-analysis.md`): the Next.js app in
`src/` with the Vercel crons, the self-host worker, and the Cloudflare `workers/`.

Production gates that decide what main can reach, read from
`../pr323-production-apply-20261016/results/run-2026-10-22/vercel-production-env-names.txt`
(names only):

- `INHERIT_TEST_JURISDICTION` is not set. Path B, claims and every TEST-LOCAL
  route return not-found
  (`src/lib/legal/jurisdictions.ts:165`; `src/lib/uploads/path-b-respond.ts:31`;
  `src/lib/uploads/other-adult-upload-server.ts:48,174,245`).
- `INHERIT_EMBRYO_R2_ORIGIN` and `INHERIT_EMBRYO_R2_BUCKET` are not set, so
  embryo fragment storage cannot work (`src/lib/embryos/fragment-storage.ts:89,102`).
  The split worker claims nothing until `private.embryo_split_config` is enabled
  (`src/lib/embryos/split-worker.ts:17`).
- The TEST R2 account archive runs only while
  `private.account_archive_r2_configuration.enabled` is true.

The pre-checks read the last two flags, and the counts that make each item below
reachable (`guarded/production-readonly-prechecks.sql`, `context`).

## Method

1. **Measured object changes.** On the production mirror (fresh main plus
   production's drift, equal to production's 2026-10-22 read-back object for
   object), each migration was applied alone, in filename order, and the catalog
   fingerprint was taken after each one. Every object that exists in main was then
   diffed step to step.
   - 53 existing functions change body. None changes signature, return type,
     language, security, `SET` clause or grants. No existing function is removed,
     and no migration adds an overload of an existing name, so PostgREST resolves
     main's RPC calls as before.
   - 10 existing tables change.
   - The full pre/post text of every changed object was diffed.
2. **Statement scan** of all 25 files: every top-level statement and every DO
   block classified. There is one top-level data statement (the `legal-evidence`
   bucket insert), one `REINDEX`, one `DROP NOT NULL`, no policy statement, no
   `DROP TRIGGER`, no change to `auth` or `storage` tables, and no registry insert.
3. **Old-code usage.** Every changed function and table was searched in
   `12f24475`'s runtime code (`src/`, `worker/`, `workers/`, `scripts/`; tests,
   fixtures and generated types excluded). For tables that gain columns, every
   `.from(...)` read and every function returning a whole row (`to_jsonb(row)`,
   a row return type) was checked.
4. **The old contract, executed.** Main's own pgTAP suite (201 files, 13,549
   tests) ran against the mirror before any batch and after every batch of the
   chosen cut (`guarded/README.md`, "Rehearsal results").
5. **Locks.** Every migration was traced in one rolled-back transaction, which
   attributed each relation lock to the migration that first takes it. Every
   batch was also probed for the locks it holds at its end.

## Result

| Class | Migrations |
| --- | --- |
| additive-safe (new objects only, or in-release objects only) | 10: #02, #13, #14, #15, #17, #18, #19, #22, #23, #24 |
| safe-with-reason | 15: #01, #03-#12, #16, #20, #21, #25 |
| BREAKS-OLD-CODE | 0 |

**No migration breaks a code path main can reach in production, at any batch
boundary or after all 25.** Main's suite passes on the pre-state. After batch 1
it fails only assertions that also fail on the final state, all inventory or
exact-definition assertions or the TEST-only behaviour changes below
("Old-contract failures"). There is therefore no unsafe part to confine to the
last batch, and no requirement that the merge follow within minutes. PR 324
should still merge and deploy soon after batch 4, because its own code needs all
25.

## Production-reachable changes main will see, and why they are safe

1. **#07 `20261016181000_subject_delete.sql`: the per-file deletion guard
   narrows** (owner decision Q6, recorded in the migration header).
   `private.prepare_genome_file_deletion_body_v1` now blocks a file deletion on a
   family pair only while the pair is pending or current, or still has Portrait
   results or pair chat messages. Before, it blocked on any pair.
   - Main reaches it through `DELETE /api/files/[id]`
     (`src/app/api/files/[id]/route.ts:21`, via
     `src/lib/genome/prepared-source/cleanup-integration.ts:38`).
   - What changes is that a file whose only pairs ended without joint results
     now deletes, instead of answering 409 `file_delete_subject_unavailable`
     (`route.ts:28-30`). The returned plan, its token, bucket and name, and every
     error code are unchanged, so main handles the newly allowed deletion like
     any other.
   - `context.family_pairs_ended` counts the pairs this can affect.
2. **#09 `20261016191000_subject_original_download.sql`: `download_sessions`
   gains `file_id` with a foreign key to `genome_files` (`ON DELETE CASCADE`).**
   Main's file deletions now fire that foreign key's check. The partial index
   `download_sessions_subject_original_idx` does not serve it, so each deleted
   file costs one scan of `download_sessions` (`sizes.download_sessions`). The
   eight new columns are nullable, and the new CHECKs bind only purpose
   `subject-original-download`, which main never writes.
3. **#20 `20261016208000_rights_reissue.sql`: `public.activate_rights_session_v1`**
   (`src/app/api/rights/activate/route.ts:29`) gains a first arm that runs only
   for a token present in the new, empty `private.rights_recovery_candidates`.
   Every token main issues falls through to the unchanged body.
4. **#03 `20261016153100_future_person_claimant_erasure_completion.sql`:
   `private.confirm_claim_document_objects_deleted_v1`** accepts one more route id,
   `api.future-person-delete`. Main's three callers pass the existing ids
   (`src/app/api/jobs/retention/route.ts:200`,
   `src/app/api/evidence/[session]/complete/route.ts:116`,
   `src/lib/future-person/document-scan-worker.ts:76,91`), whose arms are
   unchanged.
5. **#08 `20261016190000_path_b_reviewed_document.sql`: the claim-document and
   review-download doors.** Main reaches these through:
   - `begin_`, `finish_`, `reserve_` and `settle_claim_document_*`
     (`src/app/api/evidence/[session]/...`);
   - `authorize_claim_review_chunk_v1` (`src/app/api/downloads/[session]/...`);
   - `open_claim_review_download_v1` and `review_document_domain_v1`
     (`src/app/api/legal-evidence/[id]/review-download/route.ts:43,48`).

   Each door gains a first arm for a session or document in a new, empty
   `private.permission_document_*` table, so every existing session takes the
   unchanged path. The new deferred constraint triggers on
   `subjects` (lifecycle) and `adult_subject_drafts` (state) look in that empty
   table and return. The `legal-evidence` bucket is private, with no policy,
   so no API role can list or touch it.
6. **#25 `20261016221000_subject_transfer.sql`:**
   - **`genome_files` and `subjects`.** The `genome_files` identity trigger
     `private.guard_structural_file_identity_v1` gains an arm that admits only a
     row matched by `private.file_transfer_transition_matches_v1`. That needs a
     row in the new, empty `private.subject_ownership_transfers` or
     `private.subject_transfer_relocations` for the current transaction, so for
     main every update takes the same decisions in the same order as before.
     `subjects.ownership_transferred_at` is added and is null everywhere, so the
     replaced `subjects_self_or_claimant_owner_shape` has the same truth value
     on every existing row and every row main writes, and the new
     `subjects_ownership_transfer_shape` holds.
   - **Main's reads of `subjects`.** Main always names its columns
     (`src/lib/subjects.ts:47,85`, `src/lib/family/graph.ts:327,481,497`,
     `src/lib/family/portrait.ts:228`, `src/lib/export/subject-record.ts:98`,
     and the rest), so the new column never reaches a strict parser. The
     account archive's strict `subjects` history schema
     (`src/lib/exports/account-history-inventory.ts:15-17`) reads an explicit
     projection, not the whole row.
7. **Locks** (next section), and the account operation check, which #06, #07,
   #12 and #25 widen. Each widening keeps every value main writes, and
   `must_be_zero.nonces_outside_subject_delete_list` checks it.

## Changes main cannot reach in production (safe with that reason)

| # | Change | Why main cannot reach it in production |
| --- | --- | --- |
| #01 | The pgt_table split is opened: `claim_embryo_split_job_v1` claims laboratory-table sessions; `stage_` and `publish_embryo_split_v1` accept table rows; `embryo_split_variants.reference_allele` drops NOT NULL; mapping columns and an immutability trigger on `embryo_ingest_sessions` and `embryo_mapping_challenges` | No embryo R2 configuration in production; `context.embryo_split_enabled`, `context.pgt_table_ingest_sessions`. The new trigger and checks hold for null mapping fields, which is every row main writes |
| #04 | A 730-day retention row for a confirmed no-account Path B file (trigger on `other_adult_held_uploads`) | Path B needs `INHERIT_TEST_JURISDICTION`. No row comes due within two years |
| #05 | Claimant contact clock: 730 days instead of 24 months | Claims are TEST-only. The migration refuses while any such clock runs (`must_be_zero.claimed_unbound_24mo_clocks_running`) |
| #08 | Path B reviewed-document flow in 7 Path B functions | Path B is TEST-only. Every existing e-signature draft takes the unchanged branch |
| #10 | `embryo_call_value_hash_v1` hashes a missing reference allele; its index is rebuilt | The changed expression replaces only a null reference. The migration checks that a present allele still hashes as before. `sizes.embryo_split_variants` bounds the rebuild |
| #11 | The 24 account export doors and TEST R2 helpers also admit an ordinary subject target | The account branch is identical. `private.export_account_door_scope_v1` returns `account` for an account permit, and `private.account_archive_job_scope_v1` admits exactly the account job the old inline checks admitted. Main only ever requests `p_target_kind: "account"` (`src/lib/exports/account-export-http.ts:70`). TEST R2 needs `context.account_archive_r2_enabled` |
| #16 | No-account Path B uploader gate can allow | Path B is TEST-only |
| #21 | `correction_assignments` gains nullable columns and a `more_information` decision; `new_correction_intakes` gains a trigger that clears the new reason column on close | Existing decisions stay valid. The trigger updates only rows with a non-null new column |
| #25 | Path B result readers, held-revision ending, transfer doors | A transferred record needs `ownership_transferred_at`, which only the closed transfer door sets (`private.subject_transfer_open_v1()` returns false) |

New functions that browser roles can call: 8 are granted to `authenticated`.
They are the permission-document and correction reviewer surfaces. Four call
`private.claim_reviewer_step_up_v1()` directly. The other four reach it through
`private.correction_review_context_v1`, which also requires
`private.new_correction_intake_config` to be enabled. None is granted to `anon`
or PUBLIC. They are exposed from the apply onward, whether or not PR 324 has
deployed.

## Old-contract failures (main's suite on the final state)

Main's suite on the pre-state: 201 files, 13,549 tests, PASS. After all 25: FAIL in
7 files, 14 assertions. Every one is in a test file PR 324 itself updates, and none
is a runtime path:

| Main test | Failing assertions | Cause | Kind |
| --- | --- | --- | --- |
| `drop_generated_artifacts_bucket` | 2 | #08 adds the `legal-evidence` bucket | inventory |
| `drop_genomes_staging_bucket` | 2 | #08, the same bucket | inventory |
| `embryo_qc_precise_json` | 57, 59 | #11 changes `export_archive_account_members_v1`, whose exact body is asserted | exact definition |
| `embryo_split_worker` | 67 "a laboratory-table attempt ends with the closed format code" | #01 opens the table split | TEST-only behaviour change |
| `export_member_plan` | 2, 3, 9, 13, 30 | 16 new private tables and `subjects.ownership_transferred_at` are not in main's export plan (a literal in the test, checked in CI; no runtime reads it) | inventory |
| `future_person_claim_contact_retention` | 58 | #05: the deadline is created_at + 730 x 24 h, not + 24 months | TEST-only behaviour change |
| `other_adult_held_upload` | 63, 68, 69 | 63: new Path B functions in the held-table census (#04, #07, #11, #19, #25). 69: #08's new body of `assert_account_path_b_deletion_supported_v1`. 68: #20's new body of `public.activate_rights_session_v1` | inventory / exact definition |

The per-batch runs locate them: see `guarded/README.md`, "Rehearsal results".

## Locks

Measured in one rolled-back transaction on the mirror. The table lists strong
locks on tables that exist in production, held until the batch commits:

| Batch | Migration | Strong locks on existing tables |
| --- | --- | --- |
| 1 | #01 | `embryo_ingest_sessions`, `embryo_mapping_challenges`, `private.embryo_split_variants` ACCESS EXCLUSIVE |
| 1 | #02 | `auth.users` SHARE ROW EXCLUSIVE (foreign keys of the two new auth tables): sign-ins and other `auth.users` writes wait until batch 1 commits |
| 1 | #04 | `other_adult_held_uploads` SHARE ROW EXCLUSIVE |
| 2 | #06 | `account_operation_nonces` ACCESS EXCLUSIVE |
| 2 | #08 | `adult_subject_drafts` ACCESS EXCLUSIVE; `subjects`, `subject_principals`, `subject_invitations`, `private.claim_reviewers` SHARE ROW EXCLUSIVE |
| 2 | #09 | `download_sessions` ACCESS EXCLUSIVE; `genome_files` SHARE ROW EXCLUSIVE |
| 2 | #10 | `private.embryo_split_variants` SHARE (the reindex) |
| 3 | #20 | `token_hashes` SHARE ROW EXCLUSIVE |
| 3 | #21 | `correction_assignments` ACCESS EXCLUSIVE; `private.new_correction_intakes` SHARE ROW EXCLUSIVE |
| 3 | #12-#24 | `account_operation_nonces` ACCESS EXCLUSIVE again (#12) and `subject_principals` SHARE ROW EXCLUSIVE again (foreign keys), as batch 3's probe shows |
| 4 | #25 | `subjects` and `other_adult_held_uploads` ACCESS EXCLUSIVE (`account_operation_nonces` again) |

The batch probes confirm the table. Beyond these, the only `auth` or `storage`
locks are ACCESS SHARE reads, plus batch 2's ROW EXCLUSIVE on `storage.buckets`
for the bucket insert. Supautils' policy and drop-trigger hooks do not fire,
because no statement of that kind exists. PR 323's batch 2 held every `auth` and
`storage` table; this release holds none of them that way.
All 25 migrations take 0.33 s locally. A lock wait beyond 10 s cancels the batch,
which rolls back whole and can be retried. Batch 4's ACCESS EXCLUSIVE on
`subjects` blocks every page that reads a subject for as long as batch 4 runs.
The dry runs take the same locks.

## Data-dependent risks

Every guard and statement that could refuse or fail on production data is
re-run read-only by `guarded/production-readonly-prechecks.sql`:

- the 12 `md5(prosrc)` predecessor bodies, with each guard's extra predicates;
- the 67 prerequisite functions and tables;
- nine registry rows, and six registry md5s;
- the running 24-month claimant clocks;
- the consent-reaffirm issuer;
- the `legal-evidence` bucket and policies;
- `subject-original-download` sessions;
- the three constraint texts that guards read;
- account operation values outside #07's literal list;
- every object the release creates, which must be absent.

The dry runs then prove each batch against production's data.
