# Deploy-window compatibility: the 4 migrations of d8dcb61a over the follow-up's tree

The release applies the 4 migrations that the follow-up branch head
`d8dcb61a0beb4f4616046b38a03ab5ed4d9c666c` (`claude/followup-after-pr324`) adds over the
follow-up release's migration tree (`77d04563`, tree `259a56dd`):

| # | File | Added by |
| --- | --- | --- |
| 1 | `20261024110000_copilot_settings_delete_nonce.sql` | `6f9ca860` (Settings → AI DELETE nonce, G8.5) |
| 2 | `20261024220000_session_csrf_tokens.sql` | `92c10c58` (session X-Inherit-CSRF token, G8.5) |
| 3 | `20261025200000_consent_revoke_provider_nonce.sql` | `d2362f80` (consent revoke nonces, G8.5) |
| 4 | `20261025400000_path_a_account_accept_typed_name.sql` | `73c30779` (Path A typed name, D-103); its predecessor guard revised after this kit's first rehearsal (D-136) |

It runs after the follow-up's guarded release and after code carrying exactly the
follow-up's migration tree is merged and deployed, and before a head carrying the
rehearsed migration tree (`be49d283`: `d8dcb61a`'s with #4's revised guard) merges. Between its batches and that merge's
deployment, production runs **the follow-up's code** against the new schema. Everything
below was observed locally on the one local Supabase stack this machine runs (CLI
2.116.0, PostgreSQL 17.6, project `sequence` on port 54322). No production or remote
system was contacted.

**Re-checked after #4's guard was revised** (`guarded/README.md`, "The defect the first
rehearsal found, and the fix"). The first rehearsal measured #4 on a fresh build, because
it refused on the mirror; the revised file applies on the mirror, and it makes the same
changes there (+2 functions, one existing body patched to the same successor
`99dfdec6…`). The revision widens only which pre-state the file accepts, so nothing
below changed; it was confirmed, not assumed: the step analysis, the lock trace and the
follow-up's suite after both batches were all run again.

## What "old code" means here

The follow-up kit's code state, `77d04563`. The follow-up branch as it stands cannot be
the merge that follows the follow-up's release: its head `d8dcb61a` carries these 4
migrations, so the follow-up kit's `generate.py --head <follow-up head>` refuses it
(tree `151259da`, not `259a56dd`). The follow-up merge must be of a commit carrying tree
`259a56dd`: the linear range `77d04563` .. `e81bd2be` (the last commit before `6f9ca860`
adds #1). For every function these 4 files change or call, the runtime call sites at
`cf79b1b6` (PR 324), `77d04563` and `e81bd2be` are the same:

| Call | `77d04563` | Same at `cf79b1b6`, `e81bd2be` |
| --- | --- | --- |
| `remove_own_copilot_settings_v1` (Settings → AI DELETE) | `src/lib/copilot/own-settings.ts:44` | yes |
| `revoke_cloud_model_consent` (provider grant revoke) | `src/app/api/consents/[id]/revoke/route.ts:79` | yes (`:61` at `cf79b1b6`) |
| `revoke_own_copilot_v1` (own-Copilot permission revoke) | `src/lib/copilot/own-consent.ts:101` | yes |
| `respond_adult_subject_invitation_session_v1` (Path A confirm, refuse, delete) | `src/app/api/withdraw/session/route.ts:112-140` | yes (`:160` at `e81bd2be`) |

None of them calls `consume_session_csrf_v1`, any of the 5 new doors, or
`private.session_csrf_token_uses`. So the analysis holds for any of these code states,
PR 324's included.

Production gates that decide what that code can reach:

- `INHERIT_TEST_JURISDICTION` is not among Vercel's production variable names
  (`../pr323-production-apply-20261016/results/run-2026-10-22/vercel-production-env-names.txt`).
- `third_party_adult_analysis` is `unreviewed` for the default and for all 51 real
  jurisdictions in `data/jurisdictions.json` (identical at `77d04563` and HEAD), so
  `POST /api/subject-drafts`, the only creator of a Path A invitation, answers
  `jurisdiction_unavailable` (409 at `77d04563`, `src/app/api/subject-drafts/route.ts:54`;
  403 at `e81bd2be`, `:66`). No new Path A invitation can be created in production.

## Method

1. **Measured object changes.** On the mirror of the follow-up's rehearsed post-state
   (fingerprint byte-identical to the follow-up's rehearsed final mirror, `3a0f4d68…`),
   each migration was applied alone, in filename order, with `psql -1 -f`, and the
   fingerprint was read after each (`rehearsal/scripts/steps.py`, `stepdiff.py`;
   `rehearsal/data/step-changes.txt`; the first rehearsal, where #4 refused, in
   `rehearsal/data/first-rehearsal/`).
2. **Statement scan** of all 4 files.
3. **Old-code usage.** Every changed or called function, followed to the runtime callers
   in `src/`, `worker/`, `workers/` and `scripts/` at `77d04563`, `cf79b1b6` and `e81bd2be`
   (tests and generated types excluded), and the new code's callers at HEAD.
4. **The old contract, executed.** The follow-up's own pgTAP suite (`77d04563`) on the
   pre-state and after batch 1 (first rehearsal), and after both batches (second
   rehearsal) (`rehearsal/data/pgtap-summaries.txt`).
5. **Locks.** All 4 traced in one rolled-back transaction on the mirror; each batch
   probed for the locks it holds at its end.

## Result

| # | Old code on the new schema | New code on the old schema | Class |
| --- | --- | --- | --- |
| 1 | Unaffected. The operation check is rebuilt as a superset (21 values + `provider_setting_delete`), the consumer accepts one more operation, and the new door is unused. Settings → AI DELETE still calls `remove_own_copilot_settings_v1`, whose body the file guards and does not change. | Fails: `DELETE /api/llm-settings` calls `remove_own_copilot_settings_with_nonce_v1` (`src/lib/copilot/own-settings.ts:100`), which does not exist, so removing a model setting fails. | safe-with-reason |
| 2 | Unaffected: one new table and one new function, nothing existing is altered, and no old code calls either. | Fails closed everywhere: every one of the 38 routes in `SESSION_CSRF_ROUTES` (`src/lib/security/session-csrf-core.ts:55`; sign-out, account deletion, chat, uploads, …) spends its token through `consume_session_csrf_v1` and refuses when the call errors (`src/lib/security/session-csrf.ts:75-90`). Every state-changing request on them is refused. | additive-safe |
| 3 | Unaffected: two new doors; the two writers they wrap are guarded unchanged. | Fails: revoking a cloud-model provider grant (`src/app/api/consents/[id]/revoke/route.ts:94`) and the own-Copilot permission (`src/lib/copilot/own-consent.ts:120`) call doors that do not exist. | additive-safe |
| 4 | **Breaks Path A confirmation.** The shared body now answers `unavailable` to every `confirm` that has not declared a typed name, and only the new door declares one. The old `api.withdraw` adult confirm (`respond_adult_subject_invitation_session_v1`, `src/app/api/withdraw/session/route.ts:127`) expects `accepted` and answers 404 (`:139`). Refusing and deleting are unchanged. | Fails: `api.invitation-accept`'s adult body calls `accept_adult_subject_invitation_v1` (`src/lib/embryos/adult-subject-accept.ts:66`), which does not exist, so it answers 404. HEAD's `api.withdraw` no longer confirms Path A at all, so there is no Path A acceptance until #4 is in. | BREAKS-OLD-CODE (between batch 2 and the deployment) |

**Every one of the 4 is needed by the new code, so all 4 must be applied before the
merge.** Merging first would refuse every CSRF-bound request (#2): an outage of every
signed-in write, sign-out included.

**Only #4 breaks old code, and only Path A acceptance.** It is reachable in production
only through a pending, unexpired adult invitation and its active rights session. The
deployed code cannot create one there (gates above). Whether any exists now is a
production fact this rehearsal cannot read. The pre-checks count both
(`compat_must_be_zero.pending_adult_invitations`,
`.active_adult_invitation_rights_sessions`; 0 on the mirror). An invitation created
earlier, before the jurisdiction gate, would expire on its own clock; D-081's release
check already requires that none created before 13 September is still unexpired.

### Batch plan and the order against the merge

- **Batch 1 = #1-#3.** Nothing in it changes what the deployed code sees, at its
  boundary or after it. It holds the release's only strong lock on an existing table
  (ACCESS EXCLUSIVE on `public.account_operation_nonces`, #1's check rebuild). Stopping
  after batch 1 is safe; the merge cannot happen until batch 2.
- **Batch 2 = #4, alone and last**, because it is the only file that breaks the deployed
  code. The window opens when batch 2 commits and closes when the merge is deployed.
  Merge straight after batch 2 reads back EQUAL.
- Order: the follow-up's release, then the follow-up merge (a `259a56dd`-tree commit)
  and its deployment with the fingerprint still EQUAL, then batch 1, then batch 2, then
  the merge of the `151259da`-tree head, then its deployment.

The same window exists whichever code is deployed before this release (`cf79b1b6`,
`77d04563` or `e81bd2be`), because their Path A confirmation is the same call.

## Production-reachable changes the deployed code will see

1. **#1, `public.account_operation_nonces`.** The operation check is dropped and re-added
   with every value it holds plus `provider_setting_delete`, read the way follow-up #5
   reads it (both renderings). On the mirror the check holds 21 values and the parse reads
   all 21 (`definitions.literal_count` 21; `must_be_zero.nonce_check_values_not_parsed` 0).
   Every operation the deployed code writes is kept. Re-adding validates every row under
   ACCESS EXCLUSIVE (`sizes.account_operation_nonces` bounds it).
2. **#1, `private.consume_account_operation_nonce_v1`.** Its operation list gains
   `provider_setting_delete` (one anchor). Every operation the deployed code's doors pass
   is accepted as before; nothing else in the body changes.
3. **#4, `private.adult_subject_invitation_response_v1`** (four guarded patches). Inside
   the `confirm` branch, after the Path A check, it reads and clears the
   transaction-local `inherit.adult_subject_signing_name` and answers `unavailable` without
   one; it writes the ciphertext to `consent_signatures.signing_name_encrypted`; the
   `invitation.accepted` event names `api.invitation-accept` instead of `api.withdraw`.
   `api.invitation-accept` is already a live route id: co-parent acceptance events use it,
   and main's `20260929150000` registers `('invitation','adult_subject','accept','api.invitation-accept')`.
   The deployed code can no longer produce an `accepted` through this body, so it writes
   no event with the new route id.

## Changes the deployed code cannot reach

| # | Change | Why |
| --- | --- | --- |
| 1 | `public.remove_own_copilot_settings_with_nonce_v1` (service role) | New; no caller in the deployed code |
| 2 | `private.session_csrf_token_uses` (RLS on, no grant to any API role), `public.consume_session_csrf_v1` (service role) | New; no caller in the deployed code |
| 3 | `public.revoke_cloud_model_consent_with_nonce_v1`, `public.revoke_own_copilot_with_nonce_v1` (service role) | New; no caller in the deployed code |
| 4 | `private.accept_adult_subject_invitation_v1`, `public.accept_adult_subject_invitation_v1` (service role) | New; no caller in the deployed code |

No file grants anything to `anon`, `authenticated` or PUBLIC, touches an `auth` or
`storage` object, adds a policy or an event trigger, or writes data. #1, #3 and #4 end in
`notify pgrst, 'reload schema'`, which PostgREST receives at commit. #2 reads
`auth.sessions` and `auth.users` at run time only.

## Old-contract failures (the follow-up's suite after each batch)

The follow-up's suite (`77d04563`) on the pre-state: 235 files, 16,034 tests, PASS.

**After batch 1:** FAIL in 2 files, 4 assertions. Both files are ones HEAD itself updates
(`git diff 77d04563 d8dcb61a -- supabase/tests/...`), and none is a path the deployed
code reaches at run time:

| Follow-up test | Failing assertions | Cause | Kind |
| --- | --- | --- | --- |
| `export_member_plan` | 2, 3, 13 | `private.session_csrf_token_uses` (#2) is not in `77d04563`'s `docs/export-member-plan.json`; HEAD's plan classifies it `excluded-credential`. The plan is a static file; no runtime code compares it with the catalog (`src/lib/export/member-plan.ts` reads the JSON; the catalog check is this test, in CI) | inventory |
| `legal_audit_attribution_completeness` | 77 | pins `md5(pg_get_functiondef)` of `private.consume_account_operation_nonce_v1`, which #1 patches (`933df950…` to `6869593d…`) | exact definition |

Every other file passes after batch 1, among them `account_operation_nonce_rendered`,
`legal_audit_attribution`, `consents_revoke_all`, `consent_revoke_rights`,
`canonical_own_copilot_authority`, `adult_subject_invitation` and
`adult_subject_session_response`.

**After batch 2:** the same 4, plus 17 assertions in 6 files, every one of them the
predicted break: the old contract's Path A acceptance, through
`respond_adult_subject_invitation_v1` or `respond_adult_subject_invitation_session_v1`
without a declared name, now answers `unavailable` instead of `accepted`, and the
assertions that follow from an accepted subject fail with it. Two files stop early (no
plan) because later fixtures need that subject, so 15,904 of the 16,034 tests ran. All 6
files are ones `73c30779`, the commit that adds #4, updates to the new door:

| Follow-up test | Failing assertions | What they assert |
| --- | --- | --- |
| `adult_subject_invitation` | 18-20, 22 | the matching adult account accepts; control bound; subject active; consent artifact recorded |
| `adult_subject_session_response` | 8-11, 13-14 | the same through the rights session; the invitation answered; the session spent |
| `hmac_keyring_rotation` | 23 | the revision-1 session still accepts under the rotated keyring |
| `other_adult_held_upload` | 146-148 | Path A's account acceptance is unchanged; its subject and draft |
| `account_archive_complete` | 161-162, then stops | the person accepts the signed Path A scope; the variants scope recorded |
| `own_upload_account_completion` | 32, then stops | the fixture uses the actual adult acceptance transition |

The other assertions of these files pass, among them the refuse and delete answers that
`adult_subject_invitation` and `adult_subject_session_response` drive through the same
doors. No other file fails. On the final state
the 4 suites of these migrations pass (24, 30, 34, 52).

## Locks

Measured in one rolled-back transaction (`rehearsal/data/locktrace.txt`) and by the
two batch probes (`rehearsal/data/batch-lock-probes.txt`):

| Batch | Migration | Strong locks on existing tables, held until the batch commits |
| --- | --- | --- |
| 1 | #1 | `public.account_operation_nonces` ACCESS EXCLUSIVE (check rebuild, which validates every row) |
| 1 | #2 | none on an existing table (its new table's own locks) |
| 1 | #3 | none: functions only |
| 2 | #4 | none: one body patched in place, two functions created |

No `auth` or `storage` table is locked beyond ACCESS SHARE reads. While batch 1 runs,
every writer of `account_operation_nonces` waits: account deletion and its cancel, own
upload signing and completion, the other-adult upload artifact, consents revoke-all,
subject delete and sharing stop, and every account nonce door. The 4 migrations take
0.019 s locally; batch 1's whole statement 0.36 s and batch 2's 0.29 s with psql start-up. A lock wait beyond 10 s cancels the
batch, which rolls back whole and can be retried. The dry runs take the same locks.

## Data-dependent risks

Every guard and statement that could refuse or fail on production data is re-run
read-only by `guarded/production-readonly-prechecks.sql`:

- the 11 md5 predecessor bodies that exist before this release (10 production bodies, 1
  written by the follow-up), each with its exact ACL where the file requires one, and
  #4's `private.current_adult_subject_invitation_v1` with either of its two reviewed
  md5s. All 11 hold on the mirror (in the first rehearsal that one did not);
- #3's consumer predicate (`'consent_revoke'` in the body, exact ACL);
- the 12 exact signatures, 11 functions, 6 relations, 6 columns and 4 roles the files
  need, `auth.sessions.not_after` and `auth.users.deleted_at` among them (#2's door reads
  them at run time; its predecessor checks only that the tables exist);
- every object the release creates, which must be absent;
- the operation check text and its parse (#1);
- the pending adult invitations and active adult-invitation rights sessions that make
  the batch-2 window reachable (`compat_must_be_zero`).

The dry runs then prove each batch against production's data.
