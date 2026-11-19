# Release notes: `20261119110000_dropped_bucket_literals_and_guard.sql`

Local work only. Nothing here was run against production or any hosted database.

Release 4 holds two migrations, in this order: `20261119110000_dropped_bucket_literals_and_guard.sql` (this section and the four after it) and `20261119134500_path_a_sealed_invitation_note.sql` (D-139, the last section).

## What it changes

- Three bucket CHECKs, rewritten by name (drop + add, validated in place):
  - `public.account_deletion_storage_entries_bucket_id_check`: `genomes, genomes-staging, generated-artifacts, legal-evidence` → `genomes, legal-evidence`.
  - `public.embryo_ingest_delete_objects_bucket_id_check`: the same list → `genomes, legal-evidence`, `or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$'` unchanged.
  - `public.genome_storage_objects_bucket_id_check`: `genomes, generated-artifacts` → `genomes` (renders `CHECK ((bucket_id = 'genomes'::text))`).
- Three function bodies patched in place (md5-guarded, ACL `{postgres=X/postgres}` unchanged): `private.create_adult_subject_invitation_core_v1`, `private.create_embryo_cohort_draft_core_v1`, `private.create_embryo_draft_invitation_core_v1`. Each `if not p_test_jurisdiction` becomes `if p_test_jurisdiction is distinct from true`.
- Pinned, not changed: `public.claim_due_account_deletion_v1` and `public.prepare_embryo_ingest_unwind_v1`.
- No signature, grant, table, column or other constraint changes. Fingerprint effect: 3 `def_md5` values in `functions` and 3 constraint md5s in `tables` change; the function and table counts do not.

## Read-only pre-checks (one SELECT; run under the release session, the same `search_path`)

Stop unless every `must_be_*` holds. The `context_*` values are for the operator and the owner, not stops.

```sql
select
 -- Each is a refusal the migration would raise; stop if not 0.
 (select count(*) from public.account_deletion_storage_entries
   where bucket_id in ('genomes-staging','generated-artifacts')) as must_be_zero_account_deletion_entries_on_dropped_buckets,
 (select count(*) from public.embryo_ingest_delete_objects
   where bucket_id in ('genomes-staging','generated-artifacts')) as must_be_zero_embryo_unwind_entries_on_dropped_buckets,
 (select count(*) from public.genome_storage_objects
   where bucket_id in ('genomes-staging','generated-artifacts')) as must_be_zero_recorded_objects_on_dropped_buckets,
 (select count(*) from public.upload_sessions u where u.storage_bucket='genomes-staging'
   and (u.cohort_id is not null or exists(select 1 from public.subjects s
     where s.id=u.subject_id and s.cohort_id is not null))) as must_be_zero_legacy_staging_sessions_reachable_by_embryo_unwind,
 (select count(*) from storage.buckets where id in ('genomes-staging','generated-artifacts')) as must_be_zero_dropped_buckets_present,
 -- The predecessor block's two conditions; stop unless 5 and 3.
 (select count(distinct x.signature) from pg_proc p join (values
    ('public.claim_due_account_deletion_v1(text,integer)','a67a7a734a1e3bf392f5bdaf40678b6e','{postgres=X/postgres,service_role=X/postgres}'),
    ('public.prepare_embryo_ingest_unwind_v1(uuid,bigint)','370cf6155b34299765c50ef2a7fefdbc','{postgres=X/postgres,service_role=X/postgres}'),
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','8c330bee64e40182f7df90fdff39505d','{postgres=X/postgres}'),
    ('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)','5f87e19b0324a34ef2945c2f2158313d','{postgres=X/postgres}'),
    ('private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)','6bc9b8cda82896772859a4887ad888c1','{postgres=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl) as must_be_5_guarded_bodies_as_reviewed,
 (select count(*) from pg_constraint c join (values
    ('public.genome_storage_objects','genome_storage_objects_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''generated-artifacts''::text])))'),
    ('public.account_deletion_storage_entries','account_deletion_storage_entries_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])))'),
    ('public.embryo_ingest_delete_objects','embryo_ingest_delete_objects_bucket_id_check',
     'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')
   ) as x(relation,name,definition) on c.conrelid=to_regclass(x.relation) and c.conname=x.name
    and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid)=x.definition) as must_be_3_bucket_checks_as_reviewed,
 -- Context: the window and the lock.
 (select count(*) from public.upload_sessions where storage_bucket='genomes-staging') as context_legacy_staging_sessions,
 (select count(*) from public.upload_sessions where storage_bucket='genomes-staging'
   and status in ('issued','uploaded','validating','held')) as context_legacy_staging_sessions_live,
 (select count(*) from public.account_deletion_requests where state='delete_started') as context_account_deletions_in_progress,
 (select count(*) from public.genome_storage_objects) as context_rows_genome_storage_objects,
 (select count(*) from public.account_deletion_storage_entries) as context_rows_account_deletion_storage_entries,
 (select count(*) from public.embryo_ingest_delete_objects) as context_rows_embryo_ingest_delete_objects,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

The five md5s are search-path independent: each was computed on a fresh build under the session's `"$user", public, extensions` and under `pg_catalog` alone (the fingerprint's pinned setting), with the same result, because none of the five prints a type from `public`. Production's 2026-10-22 read-back (`docs/evidence/pr323-production-apply-20261016/results/run-2026-10-22/fp-after-merge.json`) holds exactly these five `def_md5` values and ACLs, and the three constraint md5s equal the local ones; no migration of PR 324's, the follow-up's or follow-up 2's sets touches any of these objects. None of the five is among the 8 comment-stripped bodies (`docs/evidence/followup-2-production-apply-20261119/rehearsal/scripts/drift.sh`).

### What a legacy `'genomes-staging'` row would mean

- **In `account_deletion_storage_entries`.** A deletion whose manifest was frozen while production's builder still carried the literal (before `20260930235000` reached production, which PR 323's release did) and that has not been finalized (`finalize_account_deletion_v1` deletes a deletion's entries). `20260930140000` refused to drop the bucket while such an entry was `pending`, so any survivor is `deleted` or `missing`: the record of a staging object removed from, or found absent in, the old bucket. The migration refuses on it. The remedy is to let that deletion finish, not to edit the row; and a non-zero count is evidence that production ran an account deletion over a legacy session, which the owner should see.
- **In `embryo_ingest_delete_objects`.** An embryo unwind planned before `20260929101000`. Embryo ingest has never been available in production (TEST-LOCAL only), so 0 is expected. Non-zero: stop; that unwind is unresolved for good (`unsupported`), and it is for the owner.
- **In `upload_sessions`.** Expected, if any upload happened before `20260906113021` reached production: every such row got `'genomes-staging'` from that migration's column default. Rows bound to an account's own or other-adult subject do not block, and they cannot reach a manifest: the account builder joins `storage.objects`, whose foreign key to `storage.buckets` makes an object in the dropped bucket impossible, and the embryo builder reads only cohort-bound sessions. A row bound to an embryo cohort or embryo subject blocks (`must_be_zero_legacy_staging_sessions_reachable_by_embryo_unwind`): the embryo leg copies the session's bucket without a Storage join, so after this migration such a cohort's unwind plan would refuse (23514) instead of writing an unsupported entry. The CHECK on `upload_sessions.storage_bucket` keeps admitting `'genomes-staging'` on purpose, for those historical rows.

So yes: the release's read-only pre-checks should count all four, and stop on any non-zero. The total of legacy sessions is context only.

## Locks and duration

1. `$predecessor$`: catalog reads and `storage.buckets` (ACCESS SHARE). No table lock.
2. `$tighten$`: `lock table public.account_deletion_storage_entries, public.embryo_ingest_delete_objects, public.genome_storage_objects in access exclusive mode` (that order: the account-deletion claim's manifest statement locks its target before `genome_storage_objects`), then four reads (`upload_sessions` and `subjects` under ACCESS SHARE only), then three `alter table ... drop constraint, add constraint` that each scan their table once. The three ACCESS EXCLUSIVE locks are held until the release's transaction commits.
3. `$patch_test_jurisdiction$`: three `create or replace function` on existing functions (catalog row locks, no table lock). A call already running finishes on the old body.
4. `$postflight$`: catalog reads.

Measured locally on a fresh build reset to `20261025400000` (`dbclean-timed-apply.sql`, the file run with `psql` inside one transaction): the whole file took 27.6 ms from `begin` to just before `commit`, and at that point the session held ACCESS EXCLUSIVE on exactly the three tables and no other table. The same run's three refusal cases (a completed legacy account-deletion entry, an embryo-unwind entry on `generated-artifacts`, a cohort-bound legacy session) each stopped at the tightening block with its own 55000 message, and the three checks, the three cores and the ledger read the same afterwards. In production the scan cost is the three tables' sizes (`context_rows_*`). While the locks are held, anything that reads or writes `genome_storage_objects` waits, even a plain read: own-upload finalization, genome download authorization, genome file deletion, subject transfer relocation, the account-deletion claim and storage batch; and the account-deletion worker on its entries. Embryo unwind does not run in production. A wait longer than the kit's `lock_timeout` (10 s) cancels the statement and rolls everything back; a deadlock with a concurrent account-deletion claim does the same. Both are safe to retry from the dry run, per the kit's stop rules. The transaction must not contain an earlier statement that wrote `genome_storage_objects` (deferred foreign-key events would make the `alter table` refuse with "pending trigger events"); none of the four earlier migrations does.

## Deployed code between apply and deploy

Nothing breaks, in either order, because nothing deployed can tell the difference:

- **The checks.** They now refuse only two names that no deployed writer produces. The account builder writes `gso.bucket_id` (already `genomes` only, by `genome_storage_objects_genomes_only` since `20260930140100`), the literal `'genomes'`, and `us.storage_bucket` only where an object exists in that bucket. The embryo writers (`prepare_embryo_ingest_unwind_v1`, `plan_embryo_published_cleanup_v1`, `plan_embryo_source_deletion_v1`) write fragment and part buckets their own checks limit to `genomes` or `inherit-embryo-*`, `'genomes'`, and `us.storage_bucket` of cohort-bound sessions, which the pre-check proves are not legacy. Every `genome_storage_objects` writer (finalization, relocation) writes `genomes`.
- **The guards.** The deployed routes (main `12f24475`, PR 324 `cf79b1b6`, and this head) pass the literal `p_test_jurisdiction: true` to `create_adult_subject_invitation_with_nonce_v1`, `create_embryo_cohort_draft_v2` and `create_embryo_draft_invitation_v1`. `true` and `false` behave exactly as before; only NULL changes, and no deployed caller sends NULL.
- No signature or grant changes, so PostgREST's schema is the same (the `notify pgrst` is the house's habit and harmless). The branch's code does not need this migration either: it can be applied before or after the branch deploys.

## Order with follow-up 2's four migrations

`20261119110000` sorts after all four (`20261024110000`, `20261024220000`, `20261025200000`, `20261025400000`) and touches none of their objects (`account_operation_nonces` and its consumer, `session_csrf_tokens`, the two revoke doors, the adult acceptance body and door), so in database terms the order is free. It cannot ride in follow-up 2's kit, though: that kit pins the migrations tree `be49d283` and its `generate.py --head` refuses any head whose `supabase/migrations` tree differs, which a head carrying this file does. So it needs its own guarded release after follow-up 2's batch 2 reads back EQUAL, with that kit's batch-2 post-state as its pre-state (functions 1,423 / `befdb108…`, tables 268 / `5926d879…`), a ledger of 285 rows / max `20261119110000` after it, and one batch (one migration). With D-139's migration, which joins this release after it (last section), the ledger after the release is 286 rows / max `20261119134500`. Committing this file onto the follow-up branch head before follow-up 2's release runs would make that kit refuse the head it is meant to merge; the owner should decide which commit merges when (the same open point follow-up 2's README records).

## `20261119134500_path_a_sealed_invitation_note.sql` (D-139)

Path A's optional invitation note reaches the database only as the envelope the route sealed, in the transaction that creates the invitation and queues its mail. It follows `20261119110000` and depends on it: its predecessor block pins the adult core at the D-140 successor md5 that migration produces (`72ea3d6e…`). It touches none of follow-up 2's objects.

### What it changes

- `public.mail_outbox`: one new CHECK, `mail_outbox_adult_invitation_note_sealed`, validated in place. An `adult-subject-invitation` row's payload holds only `request` (Path B) or `noteEnvelope` (Path A), never both; an envelope is exactly `{ version: 1, idempotencyKey, wrappedKey, ciphertext }`, its key equal to the row's own `idempotency_key`, the wrapped key 144 hex digits, the sealed note 58 to 3,056 hex digits, even. A plain `note` is refused, from any writer. Other templates are untouched.
- `public.mail_outbox`: one new BEFORE UPDATE trigger, `clear_adult_invitation_note_envelope`, with `private.clear_adult_invitation_note_envelope_v1()` (ACL `{postgres=X/postgres}`). It removes `noteEnvelope` when an invitation row leaves `queued`/`claimed`, in the transaction that moves it.
- Before the check: under ACCESS EXCLUSIVE on `mail_outbox`, the migration refuses (55000, `plain invitation note on a sendable row`, writing nothing) while any queued or claimed invitation row holds a plain `note`, and removes the `note` key from invitation rows that are submitted, delivered, failed, invalidated or expired.
- Three doors dropped and recreated, each with one trailing `p_note_envelope jsonb default null`; bodies otherwise as before (the keyed body restated with the envelope check, the replay test and the in-transaction write added):
  - `private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)` → `(…,jsonb,jsonb,jsonb)`, md5 `20bdaa2f…` → `d5234021…`;
  - `public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)` → `(…,jsonb,jsonb,jsonb)`, md5 `160df78e…` → `24cfb0d9…`;
  - `public.create_adult_subject_invitation_with_nonce_v1(…,text,timestamptz)` → `(…,text,timestamptz,jsonb)`, md5 `9819f581…` → `de553b25…`.
  ACLs unchanged: `{postgres=X/postgres,service_role=X/postgres}` on all three.
- Pinned, not changed: `private.create_adult_subject_invitation_core_v1` (`72ea3d6e…`) and the result of `private.mail_provider_attempt_key_v1` for one synthetic row (the worker checks an envelope's key against it).
- Fingerprint effect: `functions` loses three signatures and gains four (the three doors and the trigger function); `tables` changes only `mail_outbox` (one constraint, one trigger). No column, grant scope or other constraint changes.

### Read-only pre-checks (one SELECT; the release session and its `search_path`)

```sql
select
 -- The table block's refusal; stop if not 0. Production should hold none:
 -- every real jurisdiction is unreviewed for third_party_adult_analysis, so
 -- the route answers 403 before the RPC.
 (select count(*) from public.mail_outbox where template_id='adult-subject-invitation'
   and state in ('queued','claimed') and template_payload ? 'note') as must_be_zero_plain_notes_on_sendable_rows,
 -- What the new check would refuse once ended rows lose their plain note; stop if not 0.
 (select count(*) from public.mail_outbox where template_id='adult-subject-invitation'
   and (template_payload-array['request','note']<>'{}'::jsonb
     or (template_payload ? 'request' and template_payload ? 'note'))) as must_be_zero_invitation_payloads_outside_request_or_note,
 -- The predecessor block; stop unless 4, true and 0.
 (select count(distinct x.signature) from pg_proc p join (values
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','72ea3d6e8b41bfe74d8645259f7cfad7','{postgres=X/postgres}'),
    ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','20bdaa2fe113d92c696af0112fe072b5','{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','160df78ea5b4bce3a1680fa84cb2cec9','{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)','9819f58145dbbacb8926b651f983c8c2','{postgres=X/postgres,service_role=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl) as must_be_4_doors_and_core_as_reviewed,
 private.mail_provider_attempt_key_v1(jsonb_populate_record(null::public.mail_outbox,jsonb_build_object(
    'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3)))
   ='6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517' as must_be_true_provider_attempt_key_as_pinned,
 (select count(*) from pg_constraint where conrelid='public.mail_outbox'::regclass and conname='mail_outbox_adult_invitation_note_sealed')
  +(select count(*) from pg_trigger where tgrelid='public.mail_outbox'::regclass and tgname='clear_adult_invitation_note_envelope')
  +(select count(*) from pg_proc where proname='clear_adult_invitation_note_envelope_v1') as must_be_zero_created_objects_present,
 -- Context: what the table block will clean, and what the lock and the scan cost.
 (select count(*) from public.mail_outbox where template_id='adult-subject-invitation'
   and state not in ('queued','claimed') and template_payload ? 'note') as context_plain_notes_on_ended_rows,
 (select count(*) from public.mail_outbox where template_id='adult-subject-invitation') as context_invitation_rows,
 (select count(*) from public.mail_outbox) as context_rows_mail_outbox,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

The four md5s are search-path independent: none of the four functions prints a type from `public`. The successor md5s and the constraint's md5 (`7dad1be6…`) were computed under the default `"$user", public` path; the definitions print only `pg_catalog` types and functions. `context_plain_notes_on_ended_rows` is expected to be 0 in production; a non-zero count means plain notes were stored in production, which the owner should see, and the migration removes them.

### Locks and duration

1. `$predecessor$`: catalog reads only.
2. `$seal_table$`: `lock table public.mail_outbox in access exclusive mode`, one read, one update of ended invitation rows that hold a plain note (0 expected), and `alter table … add constraint` scanning `mail_outbox` once. The lock is held to commit.
3. The trigger, three `drop function` and four `create function` with their grants: catalog locks. A call already running finishes on the old body.
4. `$postflight$`: catalog reads and one read of `mail_outbox`.

Measured locally (the file run with `psql` inside one transaction, rolled back): 19.9 ms from `begin` to just before `rollback`, holding ACCESS EXCLUSIVE on `mail_outbox` and no other table. While the lock is held, everything that queues or claims mail waits: the mail worker's claim and completion, every invitation, notice and report-ready enqueue, account deletion notices, and Path A and Path B invitations. A wait past the kit's `lock_timeout` cancels the statement and rolls everything back; it is safe to retry. The check's scan cost is `context_rows_mail_outbox`.

### Deployed code between apply and deploy

A merge deploys the code, and the guarded release applies the migration later, so the first window below is the expected one. Either order is safe for stored data: the new code never sends a plain note, and after the migration the table refuses one. In production nothing in either window is reachable, because the route answers 403 before the RPC.

- **Code deployed, migration not yet applied (expected).** Without a note the new route sends no `p_note_envelope`, so the old function serves it as before. With a note the route sends `p_note_envelope`; no function takes that argument, so PostgREST answers PGRST202 before anything runs. The route answers 503 `invitation_unavailable`; no invitation, mail or nonce is written, and the person can try again. The note is not dropped. The new worker refuses a row holding a plain `note`, as an unrenderable payload: it is retried with backoff and fails after the tenth attempt. It is never sent, with or without its note. Rows like that exist only if the old route stored a note before the deploy, which production cannot have. The migration then refuses while any such row is still queued or claimed.
- **Migration applied, old code running** (if the release comes first). The old route calls `create_adult_subject_invitation_with_nonce_v1` with its ten arguments; the new function serves them (`p_note_envelope` defaults to null), so the invitation and its mail are created exactly as before, with `{}` as the payload. If the request carried a note, the old route then writes `{ note }` onto the queued row after the commit. The new check refuses that write (23514); the old route never reads the error and answers 202, so the invitation goes out without the note. In this window a note is lost, as it already could be in the race, but never stored in plain text. The old worker renders `{}` and `{ request }` rows as before and never meets an envelope, because only the new route writes one.
- **Between commit and PostgREST's schema reload** (`notify pgrst` at the end): old callers are executed in named notation and resolve to the new function. A new caller with a note may get PGRST202 until the reload, which is the same 503.

### What a person sees

Nothing changes in wording. An invitation with a note now always carries it. One whose note cannot be opened (a missing or rotated deployment key, a tampered or moved envelope) is not sent: the worker records `provider_or_payload_error`, retries with backoff (1, 2, 4 … 60 minutes) and marks the row failed after the tenth attempt, as for any unrenderable payload. A key restored within that window lets a later attempt send it.

### Not covered here

- The sealed note on a row that is still queued or claimed has no sweep of its own. The row's 30-day `expires_at` bounds it, and the trigger removes it when the claim marks the row expired. `mail_outbox` rows themselves are never deleted (D-139 says so), which this migration does not change.
- `pnpm test:invitation-locks` was not run against this migration: the shared local database does not hold it (every check here ran in rolled-back transactions). The keyed body takes the invitation transition lock first, as before (source test).

`20261119110000` sorts after all four (`20261024110000`, `20261024220000`, `20261025200000`, `20261025400000`) and touches none of their objects (`account_operation_nonces` and its consumer, `session_csrf_tokens`, the two revoke doors, the adult acceptance body and door), so in database terms the order is free. It cannot ride in follow-up 2's kit, though: that kit pins the migrations tree `be49d283` and its `generate.py --head` refuses any head whose `supabase/migrations` tree differs, which a head carrying this file does. So it needs its own guarded release after follow-up 2's batch 2 reads back EQUAL, with that kit's batch-2 post-state as its pre-state (functions 1,423 / `befdb108…`, tables 268 / `5926d879…`), a ledger of 285 rows / max `20261119110000` after it, and one batch (one migration). Committing this file onto the follow-up branch head before follow-up 2's release runs would make that kit refuse the head it is meant to merge; the owner should decide which commit merges when (the same open point follow-up 2's README records).

---

# Release notes: `20261119150000_own_upload_consent_withdrawal.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 19 November 2026, "Withdrawing consent for a person's own DNA file deletes the files and all made from them" (`docs/protocol/decisions.md`); design section 1 of `docs/evidence/consent-withdrawal-design-20261119/design.md`.

## What it changes

- Three new functions, nothing else:
  - `public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)`, `{postgres=X/postgres,service_role=X/postgres}`: the self case of `api.subject-delete` with the brief's confirmation email. It refuses a malformed envelope (22023) and any record that is not a self record (42501) before it reads or writes anything, then calls `public.delete_subject_v1` unchanged and queues the email in the same transaction.
  - `private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)`, `{postgres=X/postgres}`: one `mail_outbox` row, template and purpose `upload-consent-withdrawn`, target the record, to the account's own principal, at the address the route sealed (found or created in `encrypted_contact_references` as the own report-ready email does), payload `{"withdrawnAt": …}`, 7-day expiry, idempotency key from the spent nonce. No confirmed address (55000 `withdrawal_notice_unavailable`) or an address changed since the route read it (55000 `withdrawal_notice_recipient_stale`) rolls the whole withdrawal back.
  - `public.self_subject_withdrawal_readiness_v1(uuid,uuid)`, stable, `{postgres=X/postgres,service_role=X/postgres}`: the page's read, `unsupported` / `processing` / `ready`, from the emptying's own refusal predicates.
- Pinned, not changed: `private.empty_self_subject_v1` (`85a9ab8159fa7e5bfb18deada62c1215`, `{postgres=X/postgres}`), `private.prepare_genome_file_deletion_body_v1` (`e9f3f4692f0c6d10f6827410db8a0102`, `{postgres=X/postgres}`), and `public.delete_subject_v1` by its self branch (the exact fragment of `20261016181000`, once) and ACL rather than by md5, so a later patch of the door's adult or embryo branches does not block this migration.
- No table, column, constraint, trigger, grant on an existing object, audit event or existing body changes. Fingerprint effect: 3 more rows in `functions`; `tables` unchanged.

## Which releases must come first

The database half of the control needs, in order:

1. Release 1 (PR 324), which carries `20261016181000_subject_delete.sql` (the door and the self emptying, flagged in its own header) and the two later patches of the door, `20261016220000` and `20261016221000`. Without it the predecessor block refuses (55000, `own upload consent withdrawal prerequisite differs`), because the emptying and the door do not exist.
2. Release 2 (the follow-up), whose `20261023120000` makes `subject.emptied` a person's event attributed through the nonce. Not needed for the predecessor block to pass, but the releases run in order.
3. Release 3 (follow-up 2), whose `20261024220000_session_csrf_tokens.sql` adds `public.consume_session_csrf_v1`: the route is wrapped by `withAccountCsrf`, so without it every request is refused 403 before the handler runs.
4. This migration, in release 4 or later.

The control works in production only after all four are applied and read back EQUAL, and the branch carrying this code is deployed.

## Read-only pre-checks (one SELECT; run under the release session, the same `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(*) from pg_proc p where p.oid=to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='85a9ab8159fa7e5bfb18deada62c1215'
   and p.proacl::text='{postgres=X/postgres}') as must_be_1_self_emptying_as_reviewed,
 (select count(*) from pg_proc p where p.oid=to_regprocedure('private.prepare_genome_file_deletion_body_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='e9f3f4692f0c6d10f6827410db8a0102'
   and p.proacl::text='{postgres=X/postgres}') as must_be_1_file_guard_as_reviewed,
 (select count(*) from pg_proc p where p.oid=to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef
   and pg_get_functiondef(p.oid) like '%return private.empty_self_subject_v1(p_account_id,s.id);%') as must_be_1_door_with_its_self_branch,
 (select count(*) from pg_attribute where attrelid='public.profiles'::regclass and attname='mail_contact_revision'
   and not attisdropped) as must_be_1_mail_contact_revision_column,
 (select count(*) from pg_proc where proname in ('empty_self_subject_with_notice_v1','enqueue_self_withdrawal_notice_v1',
   'self_subject_withdrawal_readiness_v1')) as must_be_zero_new_functions_present,
 (select md5(pg_get_functiondef(p.oid)) from pg_proc p
   where p.oid=to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)')) as context_door_md5,
 (select count(*) from public.subject_consents where consent_type='upload_class' and revoked_at is null
   and subject_id in (select id from public.subjects where subject_class='self')) as context_live_self_upload_consents,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally (after the migration, so `must_be_zero_new_functions_present` read 3 there) the four `must_be_1_*` read 1 and `context_door_md5` read `2f2c32f48e4a223617ba6d31f493a92c`. The two pinned md5s were computed under `"$user", public, extensions` and under `pg_catalog` alone with the same result: neither header prints a `public` type. Production holds neither function yet, so the md5s must be compared with release 1's read-back before this release's kit is built; if release 1 leaves either body comment-stripped (as production holds 8 others, D-136), the pin must be reviewed against that body, not loosened.

## Locks and duration

Three `create function` statements, their grants, and two catalog-only `do` blocks. No table lock beyond ACCESS SHARE on the catalogs. Measured locally inside one rolled-back transaction: 7.5 ms, and the session held no relation lock other than ACCESS SHARE.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** Nothing deployed calls the three functions. No page sends `DELETE /api/subjects/[id]` today, so the self emptying stays reachable only as it was, through `delete_subject_v1`, without the email.
- **Code deployed, migration not yet applied.** The pages call `self_subject_withdrawal_readiness_v1`; PostgREST answers that the function does not exist, and the control then shows "You cannot withdraw here right now. Please try again." with no button, so no request is offered. A page rendered before the deploy has no control at all. If a request is sent anyway (a hand-made one), the route sends a self record only to `empty_self_subject_with_notice_v1`, which does not exist: the RPC error is not one of the route's refusal codes, so the route answers 503 `unavailable` and nothing is deleted; the control reads a 503 as "We do not know if this finished. Open this page again to see if your files were deleted." The route never falls back to `delete_subject_v1` for a self record, so the emptying never runs without its email.
- **Before release 1.** The same as above: the read is missing, so the control offers nothing.
