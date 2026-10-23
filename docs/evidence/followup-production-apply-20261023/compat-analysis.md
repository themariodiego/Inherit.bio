# Deploy-window compatibility: the 7 follow-up migrations of 77d04563 over PR 324

The release applies the 7 migrations that the follow-up integration head
`77d04563e3d568571215284afb8a3aae47b02d56` (`local/followup`) adds over PR 324's
migration tree (`538dcee6`, carried unchanged by PR 324's head `cf79b1b6`). It runs
after PR 324's guarded release and merge, and before the follow-up merges. Between its
batches and the follow-up's deployment, production runs **PR 324's code** (`cf79b1b6`)
against the new schema. Everything below was observed locally on an isolated Supabase
stack (CLI 2.116.0, PostgreSQL 17.6, project `relfu` on port 56322, never the shared
stack on 54322). No production or remote system was contacted.

## What "old code" means here

PR 324's runtime at `cf79b1b6`: the Next.js app in `src/` with the Vercel crons, the
self-host worker and the Cloudflare `workers/`. The production gates that decide what
it can reach are PR 324's (`../pr324-production-apply-20261022/compat-analysis.md`,
"What old code means here"), plus two that matter for this release:

- `approvedAccountArchiveGeneration()` returns `null`
  (`src/lib/exports/account-archive-generation.ts:20`), and the TEST archive needs
  `private.account_archive_r2_configuration.enabled`. Without a generation capability
  the settings page shows no account or one-record export control
  (`src/lib/exports/account-export-controls.ts:11`, `subject-export-controls.ts:33`),
  `create` answers 503 (`account-export-http.ts:153`, `subject-export-http.ts:161`), and
  the export worker route refuses (`src/app/api/jobs/account-export/route.ts`).
- `INHERIT_TEST_JURISDICTION` is not set, so the Path B and rights-session routes,
  among them `api.adult-subject-bind` (`src/app/api/subjects/bind/session/route.ts:39`),
  answer not-found.

The pre-checks read the counts that make each item below reachable
(`guarded/production-readonly-prechecks.sql`, `compat_must_be_zero` and `context`).

## Method

1. **Measured object changes.** On the mirror of PR 324's rehearsed post-state
   (fingerprint byte-identical to PR 324's rehearsed final mirror, `4d2a2747…`), each
   migration was applied alone, in filename order, and the fingerprint was taken after
   each one (`rehearsal/scripts/steps.py`, `stepdiff.py`;
   `rehearsal/data/step-changes.txt`).
   - 18 functions that exist after PR 324 change body (3 of them in both #03 and #04,
     so 21 step changes; `rehearsal/data/step-changes.txt`). None changes signature,
     return type, language, volatility, security, `SET` clause or grants. No existing
     function is removed or gains an overload.
   - 1 existing table changes: `public.account_operation_nonces` (its operation check
     is rebuilt twice, a superset each time, and it gains one trigger).
   - 20 functions are new: 6 private, owner-only; 14 public, `service_role` only. None
     is granted to `anon`, `authenticated` or PUBLIC. One more private function is
     created by #03 and dropped by #04, inside batch 1.
2. **Statement scan** of all 7 files. Apart from the two check rebuilds and the
   trigger there is no table, column, index, policy, grant on an existing object,
   data statement, `auth` or `storage` change, or event trigger. #05 and #06 end in
   `notify pgrst, 'reload schema'`, which PostgREST receives at commit.
3. **Old-code usage.** Every changed function was followed to the public entry points
   that reach it (`rehearsal/scripts/callers.sql`), and every entry point to PR 324's
   runtime callers (`src/`, `worker/`, `workers/`, `scripts/`; tests, fixtures and
   generated types excluded).
4. **The old contract, executed.** PR 324's own pgTAP suite (`cf79b1b6`) ran on the
   pre-state and after each batch (`guarded/README.md`, "Rehearsal results").
5. **Locks.** Every migration was traced in one rolled-back transaction, and each
   batch was probed for the locks it holds at its end.

## Result

| Class | Migrations |
| --- | --- |
| additive-safe (new objects only) | 0 |
| safe-with-reason | 7: #01-#07 |
| BREAKS-OLD-CODE | 0 |

Every file changes at least one body PR 324 installed or production holds, so none is
purely additive; #06 and #07 change only bodies PR 324's code cannot reach in
production, plus #06's check rebuild, which keeps every value.

**No migration breaks a code path PR 324's code can reach in production, at the batch
boundary or after both batches.** There is therefore no unsafe part to confine to the
last batch. The follow-up should still merge and deploy straight after batch 2,
because its own code needs all 7 (the `*_with_nonce_v1` doors of #05 and #06, the
`family-turns` content operation of #04, `own_export_writerless_rows_v1`).

## Production-reachable changes PR 324's code will see, and why they are safe

1. **#01 `20261022100000_neanderthal_ancestry_content`:
   `private.validate_own_ancestry_content_v1`** gains a branch for `schemaVersion` 5,
   placed before the unchanged v4 test. It is reached in production by the own-report
   generation and the ancestry readers (`own_report_generation_v1`,
   `own_ancestry_content_v1`, `family_shared_ancestry_results_v1`,
   `capture_own_report_catalog_v1`, the export readers). PR 324's code writes only
   revisions 1 to 4 (`own-ancestry-content-v1`..`v4`; `v5` appears only in the
   follow-up's `src/lib/uploads/own-ancestry-content-v5.ts`), and the validator refused
   v5 until now, so no stored v5 content can exist. Every v1-v4 content validates
   exactly as before.
2. **#02 `20261022110000_read_called_input_provenance`:
   `private.read_own_input_sources_v1`**, reached through the public wrapper by
   `src/lib/genome/canonical-input-sources.ts:39` (own genome source display). It adds
   `readCalls` to `snapshot` only when the stored provenance has a well-formed
   `readCalls` object; for every other source the object is byte-identical. PR 324's
   parser is strict (`canonical-input-sources.ts:12-24`), so a source with `readCalls`
   would make PR 324's reader drop its chunk of up to 100 sources. PR 324's code never
   writes `readCalls` (only the follow-up's TEST-LOCAL
   `src/lib/genome/reads/provenance.ts` does), and the stop rule
   `compat_must_be_zero.normalization_runs_with_read_calls = 0` proves none is stored.
3. **#03 and #04, the export slice.** The one-record export no longer refuses a family
   pair, a Portrait result or a cohort role (only a pair-anchored family conversation
   still refuses `export_joint_results_pending`), and the whole-account capture no
   longer refuses an owned embryo record or a live cohort role. PR 324's code reaches
   these only through the `capture` step of `POST /api/subjects/[id]/export` and of the
   account export, which runs before the CSRF and generation checks. In production no
   control is rendered and no CSRF proof can be minted, because there is no generation
   capability, so a hand-made request for such a record now ends in 403/422/503 instead
   of 422 `jointResults` or 503. No job is created either way. `capture` returns only
   the `authority` projection (`private.export_archive_account_authority_v1`), so the
   new `familyConversations` and `classInventory` keys never reach PR 324's strict
   `captureSchema` (`subject-export-http.ts:23-25`); only the opaque
   `authorityReceipt` value changes.
4. **#05 `20261023120000_legal_audit_attribution_completeness`:**
   - **The operation check** of `public.account_operation_nonces` is rebuilt from the
     values it holds plus 10 new ones. Every value PR 324's writers use is kept
     (`definitions.parsed_like_120000`; `must_be_zero.nonce_check_values_not_parsed`
     proves the parse reads every value).
   - **The new trigger `legal_audit_actor_on_consumed_insert`** notes the account of a
     nonce inserted already consumed. Of the writers PR 324's code reaches, only
     `private.record_subject_operation_nonce_v1` inserts that way, for
     `delete_subject_v1`, `stop_subject_sharing_v1` and the closed
     `transfer_subject_v1` (`src/app/api/subjects/[id]/route.ts`,
     `[id]/sharing/route.ts`). The note only sets the transaction-local
     `inherit.legal_audit_actor`; two different accounts give `conflict`, never an
     error (`private.note_legal_audit_actor_v1`).
   - **`private.legal_audit_person_event_v1`** gains PR 324's eight person-caused event
     codes. `private.legal_audit_actor_principal_v1` then names the actor only when the
     transaction proves one, and returns null otherwise, so no write can be refused.
     In the window, `subject.deleted` and `subject.emptied` (subject delete) and
     `consents.revoked-all` (`src/app/api/consents/revoke-all/route.ts`) events written
     by PR 324's production routes name the acting account's audit pseudonym (a new
     `audit_principals` row the first time); so does `purpose.reaffirmed`, whose route
     is TEST-only. That is the intended attribution; PR 324's code does not read it in
     production.
   - **`private.record_subject_operation_nonce_v1`** accepts two more operations; every
     operation PR 324 passes is accepted as before.
5. **Locks** (below): batch 2 holds `account_operation_nonces` ACCESS EXCLUSIVE.

## Changes PR 324's code cannot reach in production (safe with that reason)

| # | Change | Why PR 324's code cannot reach it in production |
| --- | --- | --- |
| #03, #04 | One-record export: Portrait rows, family-conversation turns, own cohort rows; classes and content doors gain `portrait_results` and `family-turns`; the TEST complete archive's Portrait rows | Job generation needs a generation capability (none in production; `context.account_archive_r2_enabled`). PR 324's worker never asks for `portrait_results` or `family-turns`. A TEST job created before batch 1 and read after it fails its receipt check (`context.export_archive_jobs`) |
| #06 | `bind_adult_subject_account_v1` records the rights-session nonce with the account (through the new `adult_subject_control_for_account_v1`) | `api.adult-subject-bind` is TEST-only and built closed; PR 324's route already passes the account and auth session it now uses |
| #06 | The operation check gains two values; `consume_account_operation_nonce_v1` accepts them; three nonce doors | New objects; PR 324's code calls none of them |
| #07 | `open_permission_review_download_v1` takes one clock reading | No runtime caller in `cf79b1b6`; permission documents are Path B (TEST-only, `sizes.permission_documents`) |

## Old-contract failures (PR 324's suite on the final state)

PR 324's suite on the pre-state: 229 files, 15,544 tests, PASS. After batch 1, and
unchanged after batch 2: FAIL in 3 files, 7 assertions. Every one is in a test file the
follow-up itself updates (`git diff cf79b1b6 77d04563 -- supabase/tests/...`), and the
follow-up's suite passes on the final state (235 files, 16,034 tests). None is a path
PR 324's code reaches in production:

| PR 324 test | Failing assertions | Cause | Kind |
| --- | --- | --- | --- |
| `subject_export` | 189-193: a live family pair, a pair appearing after the request, the request door, a revoked unpurged pair, a Portrait result: each "refused with the stated reason" `export_joint_results_pending` | #03/#04 project these instead of refusing (owner decisions of 16 and 23 October); 190's job now fails at its next read with `42501 not_found` (receipt changed) instead | intended behaviour change, not reachable in production (no generation capability) |
| `account_archive_graph_rows` | 166: "the original014 nonempty parent graph remains a whole refusal" | #04 patch 12: the whole-account archive carries the parent's own cohort records instead of refusing | intended behaviour change, TEST archive only |
| `other_adult_held_upload` | 71: "only the exact installed one-record class inventory may inspect the record's held custody" | pins `md5(prosrc)` of `export_subject_class_inventory_v1`, which #03 and #04 patch | exact definition |

Batch 2 adds no failure: every other file of PR 324's suite passes after it, among them
`legal_audit_attribution`, `subject_delete` (and its adult, embryo and reviewed-document
files), `subject_sharing_stop`, `subject_transfer`, `subject_original_download`,
`consents_revoke_all`, `consent_reaffirm` and `adult_subject_bind`.

## Locks

Measured in one rolled-back transaction on the mirror (`rehearsal/data/locktrace.txt`)
and by the two batch probes (`rehearsal/data/batch-lock-probes.txt`):

| Batch | Migration | Strong locks on existing tables, held until the batch commits |
| --- | --- | --- |
| 1 | #01-#04 | none: function bodies only (catalog row locks and ACCESS SHARE reads) |
| 2 | #05 | `public.account_operation_nonces` ACCESS EXCLUSIVE (check rebuild, which validates every row) and SHARE ROW EXCLUSIVE (the trigger) |
| 2 | #06 | `public.account_operation_nonces` ACCESS EXCLUSIVE again (check rebuild) |
| 2 | #07 | none |

No `auth` or `storage` table is locked beyond ACCESS SHARE reads. While batch 2 runs,
every writer of `account_operation_nonces` waits: account deletion and its cancel, own
upload signing and completion, the other-adult upload artifact, consents revoke-all,
subject delete and sharing stop. All 7 migrations take 0.044 s locally; batch 2's
whole statement takes under a second (`guarded/README.md`). A lock wait beyond 10 s
cancels the batch, which rolls back whole and can be retried. The dry runs take the
same locks.

## Data-dependent risks

Every guard and statement that could refuse or fail on production data is re-run
read-only by `guarded/production-readonly-prechecks.sql`:

- the 19 md5 predecessor bodies that exist before this release (5 production bodies,
  14 written by PR 324), each with its exact ACL and #01's extra predicates;
- the 10 exact signatures, 44 functions and 22 relations the files name;
- PR 324's `legal_audit_actor_on_consume` trigger on `embryo_operation_nonces`;
- the operation check text and its parse;
- every object the release creates, which must be absent;
- stored `readCalls` provenance (`compat_must_be_zero`).

The dry runs then prove each batch against production's data.
