# Deploy-window compatibility: release 4's 21 migrations over release 3's tree

Release 4 applies the 21 migrations that the branch `claude/stoic-turing-su2ka8`, at
`fe8c69d1` (migration tree `d43b12a8`), adds over release 3's migration tree (`be49d283`,
first carried by `a2a4d8e9`, last on this branch by `6252566a`):

| # | File | Batch |
| --- | --- | --- |
| 1 | `20261119110000_dropped_bucket_literals_and_guard.sql` | 1 |
| 2 | `20261119120000_session_csrf_purpose_kinds.sql` | 1 |
| 3 | `20261119134500_path_a_sealed_invitation_note.sql` | 2 |
| 4 | `20261119150000_own_upload_consent_withdrawal.sql` | 2 |
| 5 | `20261119160000_other_adult_upload_consent_withdrawal.sql` | 2 |
| 6 | `20261119170000_embryo_uploader_consent_withdrawal.sql` | 2 |
| 7 | `20261120100000_self_withdrawal_deletes_exports.sql` | 2 |
| 8 | `20261120110000_file_delete_operation_nonce.sql` | 3 |
| 9 | `20261120120000_adult_acceptance_hold_and_renotice.sql` | 4 |
| 10 | `20261120130000_subject_copilot_scope.sql` | 4 |
| 11 | `20261122100000_uploader_withdrawal_hands_record_to_adult.sql` | 4 |
| 12 | `20261122110000_adult_acceptance_inviter_reads.sql` | 4 |
| 13 | `20261122120000_subject_transfer_open.sql` | 4 |
| 14 | `20261122130000_file_delete_live_exports_only.sql` | 4 |
| 15 | `20261122140000_adult_acceptance_inviter_archive_reads.sql` | 4 |
| 16 | `20261122150000_file_delete_live_account_copies.sql` | 4 |
| 17 | `20261122160000_transferred_record_exports.sql` | 4 |
| 18 | `20261122170000_inviter_grants_and_reviewed_document_decision.sql` | 4 |
| 19 | `20261122180000_path_b_reviewed_document_readers.sql` | 4 |
| 20 | `20261122190000_reviewed_document_person_access.sql` | 4 |
| 21 | `20261122200000_reviewed_document_person_appeal.sql` | 4 |

It runs after releases 1-3 are applied, merged and deployed, and before a head carrying
`d43b12a8` merges. Between its batches and that merge's deployment, production runs
**release 3's code** (a commit carrying `be49d283`; the last one on this branch is
`6252566a`) against the new schema. Everything below was observed locally on the
isolated stack `relk4` (CLI 2.116.0, PostgreSQL 17.6, 127.0.0.1:58322). No production
or remote system was contacted.

The per-migration deploy-window sections of `../release-4-notes-20261119.md` ("Deployed
code between apply and deploy", "Production reachability") are the basis of this
analysis. Each was checked against its file and against what the mirror measured: the
objects each file changes (`rehearsal/data/step-changes.txt`), the locks it takes
(`rehearsal/data/locktrace.txt`), and release 3's own pgTAP suite after the release
(`rehearsal/data/pgtap-summaries.txt`).

## What "old code" means here

Release 3's code: the commit merged after release 3, which must carry `be49d283`
(`api/RUNBOOK.md`, step 0). Its runtime callers of the functions these 21 files patch,
drop or recreate (tests and generated types excluded), at `6252566a`:

| Function (changed by) | Caller at `6252566a` | Reachable in production |
| --- | --- | --- |
| `public.create_adult_subject_invitation_with_nonce_v1` (#3: dropped, recreated with one more defaulted argument) | `src/app/api/subject-drafts/route.ts:115` | no: the route answers 403 before the RPC (`third_party_adult_analysis` is unreviewed for every real jurisdiction) |
| `public.delete_subject_v1` (#5: Path B branch) | `src/app/api/subjects/[id]/route.ts:72` | the route is live, but no page sends it; the changed branch needs a Path B record (TEST-LOCAL) |
| `public.prepare_own_prepared_file_cleanup_v1` (pinned by #8; its guard body patched by #7, #14, #16) | `src/lib/genome/prepared-source/cleanup-integration.ts:32,36` | **yes**: Files → Delete (`api.file-delete`) |
| `public.claim_invitation_terminal_mail_v1`, `public.authorize_invitation_terminal_mail_v1` (#9) | `src/lib/embryos/invitation-terminal-mail.ts:15,20,45` | the worker runs; the changed branches are for the two new notice kinds only |
| `public.transfer_subject_v1` (pinned; its core patched by #11, #17; opened by #13) | `src/app/api/subjects/[id]/transfer/route.ts:73` | no: a transfer needs a confirmed Path B record (TEST-LOCAL) |
| `public.own_subject_export_content_v1` (reads `private.own_export_source_v1`, patched by #17) | `src/lib/exports/own-subject-content.ts:30,63` | **yes**: "Download your data" |
| `public.consume_session_csrf_v1` (pinned by #2, unchanged) | `src/lib/security/session-csrf.ts:79` | yes, unchanged |

Release 3's code calls none of the 33 functions this release creates.

## Result

| # | Old code on the new schema | New code on the old schema | Class |
| --- | --- | --- | --- |
| 1 | Unaffected. The three bucket checks now refuse only `genomes-staging` and `generated-artifacts`, which no deployed writer produces; the three invitation cores treat a NULL test-jurisdiction flag as false, and every deployed caller passes `true` or `false`. | Unaffected: the code does not need it. | safe-with-reason (production tables rebuilt under ACCESS EXCLUSIVE) |
| 2 | Unaffected: one new function, nothing existing altered. | Every route works: the five new session kinds spend their token through v1 under the kind whose rule they share (`src/lib/security/session-csrf.ts`); only the four cookie kinds' live-row check waits for the migration. | additive-safe |
| 3 | Invitations are created as before (the old call resolves to the new function in named notation, `p_note_envelope` defaulting to null). A note the old route writes after the commit is refused by the new check and lost, never stored in plain text. Not reachable in production (the route answers 403 first). | Without a note, as before; with one, PGRST202 and a 503, nothing written. | safe-with-reason (not reachable in production) |
| 4 | Unaffected: three new functions. | The readiness read is missing, so the control offers nothing; a hand-made request answers 503 and deletes nothing. | additive-safe |
| 5 | `DELETE /api/subjects/[id]` refuses the uploader on a Path B record whose person holds it; no page sends that request, and Path B is TEST-LOCAL. | The card says it cannot withdraw; a hand-made request answers 503. | safe-with-reason (not reachable in production) |
| 6 | Unaffected: the restriction core's two existing routes behave as before. | Fails closed (503, nothing written). | additive-safe |
| 7 | The self emptying ends the record's exports instead of refusing (hand-made request only); `api.file-delete` answers as before on every record not emptied. | As before D-144: the read says `unsupported` where an export exists. | safe-with-reason |
| 8 | Files → Delete calls the unchanged door and works as today. | The route falls back to the unchanged door on PGRST202/42883 and works as today (the nonce is verified, not spent). | safe-with-reason (production path; check rebuilt under ACCESS EXCLUSIVE) |
| 9 | Every new account acceptance records its clocks; the deployed retention job does not run the executor, so nothing is released early. The terminal mail claim and authorization change only for the two new kinds, which nothing deployed queues. | The origin read is missing, so the route answers the held body; the retention job counts one failure per run for the missing executor. | safe-with-reason (TEST-LOCAL only) |
| 10 | Unaffected: the new doors have no deployed caller; the Path B grant door accepts `copilot.local`, which the deployed body schema refuses first; the new trigger finds no subject conversation. | 404 / no Copilot link; a Copilot choice the database refuses (422). | additive-safe |
| 11 | Unchanged answers: the hand-over is built closed (the switch answers false until #13). | Nothing changes. | additive-safe |
| 12 | The database readers answer a held inviter as with no grant; the deployed Family graph does not ask, so test-mode pages show their unavailable states. No acceptance clock exists in production. | The graph reads every share as not shared when the door is missing; in production nothing is shared. | safe-with-reason (TEST-LOCAL only) |
| 13 | **Opens the record transfer and the uploader's hand-over.** Release 3's `api.subject-transfer` route would transfer, and the notices of the five new kinds would be queued for a mail worker that does not know them. A transfer needs a confirmed Path B record, which exists only under the test jurisdiction, so none of this is reachable in production. | Nothing queues the notices; the doors stay closed. | safe-with-reason (not reachable in production) |
| 14 | One file is refused only while a copy of the record is live; the withdrawal also ends READY whole-account copies. No copy exists in production. | Same as old code (no application code). | safe-with-reason |
| 15 | The held inviter's account archive answers as with no grant; the native archive is off in production. | Same (no application code). | safe-with-reason |
| 16 | A live whole-account copy that includes the record also blocks deleting one of its files; none exists in production. | Same (no application code). | safe-with-reason |
| 17 | "Download your data" reads a transferred file as the person's own source; every other file reads as before. The hand-over's three "not now" refusals answer 55000, which the deployed route answers as its opaque 404, as before. | The route never meets the new code. | safe-with-reason |
| 18 | The class of grants received leaves out a held inviter's grants; the decision reads a reviewed-document Path B record as an e-signature one. Neither is reachable in production. | Same (no application code). | safe-with-reason |
| 19 | Fifteen readers take a reviewed-document Path B record as they take an e-signature one, among them account deletion's refusal of an account holding a Path B grant (`private.assert_account_path_b_deletion_supported_v1`), which is live; with no Path B record in production it answers as before. The deployed route classifier keeps sending such a record's pages to the ordinary resolver. | The new classifier sends those pages to the Path B reader, which answers not found until the migration. | safe-with-reason |
| 20, 21 | The person's own reads and the public appeal stop depending on the reviewed document's retention. Database only, TEST-LOCAL only. | Same (no application code). | safe-with-reason |

**No migration breaks release 3's production-reachable code**, so no batch has to sit
alone because of the deploy window, and stopping after any batch leaves production
serving correctly. The production-reachable paths that change are Files → Delete (#7,
#8, #14, #16: the same answers where no export copy exists, which is every record in
production) and "Download your data" (#17: the same answers for every file that has not
been transferred, which is every file in production).

**The new code needs the release.** Most of its new controls fail closed on the old
schema (no button, or 503 with nothing written), and the session-CSRF v2 door and the
file-delete nonce door have reviewed fallbacks; but the merge follows batch 4, as in
every earlier kit, so that the deployed code and the schema it was tested against arrive
together.

### Batch plan and the order against the merge

Batches are consecutive in filename order, and every file pins its predecessor's exact
output, so the order inside and across batches is fixed. The cut follows the locks each
batch holds until it commits (below) and the dependencies between the files:

- **Batch 1 = #1-#2.** ACCESS EXCLUSIVE on `genome_storage_objects` (production-hot: own
  upload finalization, genome download authorization, file deletion) and on the two
  storage manifest tables. #1 runs first in its transaction, so no earlier statement has
  written `genome_storage_objects` (its notes: deferred foreign-key events would make the
  `alter table` refuse). #2 takes no table lock.
- **Batch 2 = #3-#7.** ACCESS EXCLUSIVE on `mail_outbox` (production-hot: every mail
  enqueue and claim) for #3, and on `private.invitation_terminal_notices` for #5. #3
  pins the adult core at #1's successor; #7 patches the self emptying that #4 pins and
  needs #4's readiness read, so #4-#7 stay together.
- **Batch 3 = #8, alone.** ACCESS EXCLUSIVE on `account_operation_nonces`
  (production-hot: Settings, consents, subject delete, account deletion); it is also the
  one file whose route (`api.file-delete`) is live in production.
- **Batch 4 = #9-#21.** SHARE ROW EXCLUSIVE on `subjects` (#10's trigger:
  production-hot writes wait, reads do not), and the terminal-notice queue's locks (#9,
  #11). It keeps D-141's acceptance clocks (#9) with every reader that asks them (#10,
  #12, #15, #18), and the transfer switch (#13) with everything that makes its approved
  notice true: #17 (D-162, e-signature records), #19 and #20 (D-165, D-166,
  reviewed-document records) and #21 (the rest of D-166). No stop leaves the switch open
  without them.
- Order: release 3's release, merge (a `be49d283` commit) and deployment with the
  fingerprint still EQUAL; then batches 1 to 4; then the merge of the `d43b12a8` head and
  its deployment.

## Changes the deployed code cannot reach

33 new function signatures (`rehearsal/data/step-changes.txt`): 30 new names, and #3's
three doors recreated with one more defaulted argument (their old signatures dropped).
Every one has a fixed `search_path`; 31 are `security definer` (the other two are #3's
trigger function and `public.create_adult_subject_invitation_v1`, as before). The 15
public ones are granted to `service_role` only; of the 18 private ones, 17 to no API role
and `private.create_adult_subject_invitation_keyed_v1` to `service_role`, as it was
before #3 recreated it. No file grants anything to `anon`, `authenticated` or PUBLIC, adds a
table, column or policy, or touches an `auth` or `storage` object beyond reading
`storage.buckets` and `auth.users`. #3 adds one CHECK and one trigger on `mail_outbox`;
#9 one trigger on `private.invitation_terminal_notices`; #10 one trigger on
`public.subjects`. Data written: #3 removes a plain `note` key from ended invitation mail
rows (0 on the mirror; the pre-checks count them).

## Old-contract failures (release 3's suite before and after the release)

Release 3's whole suite (`6252566a`) on the pre-state: 239 files, 16,179 tests, PASS.

**After the four batches:** FAIL in 8 files, 16,003 of the tests run (4 files stop early,
no plan). Every one is a file the branch itself changes for this release (`git log
6252566a..fe8c69d1 -- supabase/tests/<file>`), and at the pinned head each passes on the
same final state (the 33 suites, 2,197 tests, PASS each). None is a path the deployed code
reaches in production. The cause column is read from the error each stopped file printed
and from the commit that updates each test, not from a trace of every assertion:

| Release 3 test | Failing / stops | Cause | Changed for this release by |
| --- | --- | --- | --- |
| `drop_generated_artifacts_bucket` | 17 | asserts the old bucket check text, which #1 tightens | `ef5552bb` (#1) |
| `path_a_account_accept_typed_name` | 2 | pins `private.adult_subject_invitation_response_v1` at `99dfdec6…`, which #9 patches | `499b94dc` (#9) |
| `path_b_no_account_uploader_gate` | 1, 35 | pins the mitigation decision, which #9 and #18 patch | `499b94dc`, `096fa926` |
| `other_adult_held_upload` | 68, 74 | pins bodies #9 and #19 patch | `499b94dc`, `ca6efbd2` |
| `account_path_b_request_refusal` | 29, then stops (`not_found`) | the D-141 hold (#9): an account created after its request is now held | `499b94dc` |
| `account_archive_member_frame` | stops (`file_delete_shared_graph`) | its fixture deletes a file while a whole-account copy is live, which #16 now refuses (D-152) | `059f2666` (#16) |
| `legal_audit_attribution_completeness` | stops (`function … create_adult_subject_invitation_with_nonce_v1(…) does not exist`) | names #3's door by its old signature, and pins the person-event list #6 and #17 extend | `7f625f4f`, `cebfbebc`, `f9014565` |
| `subject_transfer` | 14-16, 24-25, then stops (`not_found`) | expects the closed transfer switch and the old transfer body (#11, #13, #17) | `20f629d3`, `f9014565` |

Every other file of release 3's suite passes after the release.

## Locks

Measured in one rolled-back transaction (`rehearsal/data/locktrace.txt`) and by the four
batch probes (`rehearsal/data/batch-lock-probes.txt`):

| Batch | Migration | Strong locks on existing tables, held until the batch commits |
| --- | --- | --- |
| 1 | #1 | `public.genome_storage_objects`, `public.account_deletion_storage_entries`, `public.embryo_ingest_delete_objects` ACCESS EXCLUSIVE |
| 1 | #2 | none |
| 2 | #3 | `public.mail_outbox` ACCESS EXCLUSIVE (and the trigger's SHARE ROW EXCLUSIVE) |
| 2 | #5 | `private.invitation_terminal_notices` ACCESS EXCLUSIVE |
| 2 | #4, #6, #7 | none: functions only |
| 3 | #8 | `public.account_operation_nonces` ACCESS EXCLUSIVE |
| 4 | #9 | `private.invitation_terminal_notices` ACCESS EXCLUSIVE and SHARE ROW EXCLUSIVE |
| 4 | #10 | `public.subjects` SHARE ROW EXCLUSIVE |
| 4 | #11 | `private.invitation_terminal_notices` ACCESS EXCLUSIVE |
| 4 | #12-#21 | none: functions only |

No `auth` or `storage` table is locked beyond ACCESS SHARE reads. A lock wait beyond
10 s cancels the batch, which rolls back whole and can be retried. The dry runs take the
same locks.

## Data-dependent risks

Every guard and statement that could refuse or fail on production data is re-run
read-only by `guarded/production-readonly-prechecks.sql` (`guarded/README.md`, "Pre-check
stop rules"): the 87 function bodies and 5 constraint definitions the files pin that
exist before the release, each with its ACL; the refusals each file's notes list (#1's
dropped-bucket rows, #3's plain notes and payload shapes, #9's clocks and retention
classes, the transfer switch, #20's five callers); every object the release creates,
which must be absent; and every function and relation the files name. The dry runs then
prove each batch against production's data.
