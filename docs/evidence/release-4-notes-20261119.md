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

# Release notes: `20261119120000_session_csrf_purpose_kinds.sql` (joins release 4)

Local work only. Nothing here was run against production or any hosted database. Release 4 now holds two migrations, applied in file order: `20261119110000` (above), then this one. Every figure above that counts release 4 as one migration is superseded here: after both, the ledger has 286 rows, max `20261119120000`; the functions count is one higher than after `20261119110000` alone; the tables fingerprint is the same as after `20261119110000`.

## What it changes

- One function is added, nothing is altered: `public.consume_session_csrf_v2(p_route_id text, p_session_kind text, p_token_hash text, p_expires_at timestamptz, p_account_id uuid default null, p_session_id uuid default null, p_cookie_hash text default null, p_purpose_session_id uuid default null) returns boolean`, `security definer`, `search_path ''`, ACL `{postgres=X/postgres,service_role=X/postgres}`, `def_md5` `13570c4a4b77de1fbc6e3fcfe2d40636`. The body repeats the service-role check.
- It spends a one-time `X-Inherit-CSRF` token of eight session kinds into `private.session_csrf_token_uses`, the table `20261024220000` created and `public.consume_session_csrf_v1` writes, so one hash is spent once across both doors. The three kinds of v1 (`authenticated`, `token`, `token-candidate`) keep v1's rules exactly; the five added kinds are each held to their session's live row: `reviewer` (v1's live `auth.sessions` row and undeleted user), `upload-session` (the `public.embryo_ingest_sessions` row of that id and cookie hash, status `open`, `mapping_required` or `failure_pending`), `evidence-session` (a claim, appeal or permission document session row of that id and cookie hash), `claim-session` (a `private.future_person_claim_intakes` row of that session hash that `private.claim_intake_live_v1` calls live) and `reset-session` (an unexpired `private.auth_recovery_sessions` row of an undeleted account).
- Pinned, not changed: `public.consume_session_csrf_v1` (`ae9a75327090d06a46456efce17625a3`, ACL as above), `private.claim_intake_live_v1(private.future_person_claim_intakes)` (`f76e353669c3f7ff70c66e78e34317a1`, `{postgres=X/postgres}`), the columns the checks read, and `embryo_ingest_sessions_status_check`.
- Re-runnable: a second apply finds the successor exactly as reviewed, replaces it with itself and passes the postflight (applied twice locally). Any other `public.consume_session_csrf_v2` overload or body refuses with 55000 before anything is written.
- No table, column, constraint, policy, grant on an existing object, or wording changes. Fingerprint effect: one row added to `functions` (`public.consume_session_csrf_v2`), none changed; `tables` unchanged.

## Read-only pre-checks (one SELECT; run under the release session, the same `search_path`)

Stop unless every `must_be_*` holds. `context_*` values are for the operator and the owner.

```sql
select
 (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
   where p.oid=to_regprocedure('public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)'))
   = 'ae9a75327090d06a46456efce17625a3 {postgres=X/postgres,service_role=X/postgres}' as must_be_true_v1_as_reviewed,
 (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
   where p.oid=to_regprocedure('private.claim_intake_live_v1(private.future_person_claim_intakes)'))
   = 'f76e353669c3f7ff70c66e78e34317a1 {postgres=X/postgres}' as must_be_true_claim_liveness_rule_as_reviewed,
 (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema='private' and table_name='session_csrf_token_uses')
   = array['expires_at','route_id','token_hash'] as must_be_true_spend_table_as_reviewed,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='consume_session_csrf_v2') as must_be_0_successor_absent,
 (select count(*) from pg_constraint c where c.conrelid='public.embryo_ingest_sessions'::regclass
   and c.conname='embryo_ingest_sessions_status_check' and c.convalidated) as must_be_1_ingest_status_check,
 (select count(*) from private.session_csrf_token_uses) as context_spent_hashes,
 (select count(*) from private.auth_recovery_sessions where expires_at>clock_timestamp()) as context_live_reset_sessions,
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

The three md5s are search-path independent only while `private` is not on the session's `search_path` (`claim_intake_live_v1` prints its argument type schema-qualified); the fingerprint's pinned `pg_catalog` setting and the session's `"$user", public, extensions` both give the values above, which were read from a local build at `20261119110000`.

## Locks and duration

1. `$predecessor$`: catalog and `information_schema` reads. No table lock.
2. `create or replace function`: a catalog row; no table is locked, and nothing calls v2 yet.
3. `revoke`/`grant` on the new function only; `$postflight$`: catalog reads; `notify pgrst`.

It holds no lock on any table and can run while the app serves requests. Measured locally: 26.9 ms of statement time for the whole file (a re-apply, inside a transaction that was rolled back).

## Order against the code, and what a person sees in each window

The app code of this stage calls v1 for the three earlier kinds, as before, and v2 for the five added ones. While v2 is absent from the database (PostgREST answers `PGRST202`, Postgres `42883`), it spends the token through v1 instead under the kind whose rule it shares: a reviewer's as an `authenticated` token (the same live auth-session check), a cookie kind's as a `token` (spent once by its hash, as a rights token is). Any other error refuses. `src/lib/security/session-csrf.test.ts` holds this to that rule.

- **Migration applied, earlier code still deployed.** Nothing earlier calls v2, and v1 is unchanged; the seventeen routes' earlier code checked its own digests and called neither door. Nobody sees a difference.
- **This stage's code deployed, migration not yet applied (the normal order: code merges, the guarded release comes later).** Every route works. Each of the seventeen routes' tokens is still verified for its kind, session, route and expiry and spent once (through v1), so nobody sees a difference; what is missing until the migration is the live-row check of the four cookie kinds, which each route's own handler and database call still make for its session. The reviewer kind loses nothing.
- **This stage's code deployed before `20261024220000` (follow-up 2, batch 1).** Already forbidden since stage one, and unchanged by this migration: neither door exists, every token route refuses every state-changing request (an account route's 403 `request_forbidden`, a session route's 404). For a person: every save, upload, review decision, objection and password change fails; a password reset form says the link has expired. Constraint, unchanged: follow-up 2's batch 1 before this branch's code deploys.
- **Pages open across the code deploy.** A page rendered by the earlier code sends its earlier value (a 64-hex digest) and is refused once with the route's 403 or 404 until it is reloaded; a reload renders the tokens. Two cases where reloading is not enough: an evidence upload in flight fails and must be sent again from the reloaded page; and a password reset whose link was opened in the 15 minutes before the deploy keeps the earlier digest in its Lax cookie, so its form says the link has expired and the person asks for a new link. A refused request writes nothing; the chunks of an interrupted upload that were written before the deploy are removed by retention, as any abandoned upload's are.

So the migration and this code can go in either order once follow-up 2's batch 1 is applied.

## Rollback

Dropping `public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)` returns the database to `20261119110000`'s state; the code of this stage then falls back to v1 as above. The spent hashes it recorded stay in `private.session_csrf_token_uses` and expire on their own.

# Release notes: `20261119160000_other_adult_upload_consent_withdrawal.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 19 November 2026, "An uploader's withdrawal for another adult's file deletes it, unless that adult holds the record themselves" (`docs/protocol/decisions.md`); design section 2 of `docs/evidence/consent-withdrawal-design-20261119/design.md`. Path B is TEST-LOCAL: no hosted database holds a Path B record the control could act on.

## What it changes

- `private.invitation_terminal_notices_notice_kind_check` gains `'upload-permission-withdrawn'` (drop and add, validated in place; the three existing kinds unchanged).
- Two bodies patched in place, md5-guarded with their reviewed ACL, one anchor each, successor md5 and unchanged ACL asserted:
  - `public.delete_subject_v1` (`2f2c32f48e4a223617ba6d31f493a92c` → `e994afb4410ad008aa959efc65726895`, `{postgres=X/postgres,service_role=X/postgres}`): its Path B branch refuses the owning uploader (42501 `not_found`) on a record whose person holds it with their own account. The self branch that 20261119150000 pins, the person's own delete, and the transferred and Path A branches are untouched.
  - `private.invitation_notice_recipient_current_v1` (`261f743d84e3615d4ae56ab2e4e26b9a` → `e0728613189f2cbdfa05029c962767a5`, `{postgres=X/postgres}`): a notice of the new kind is current only while the accepted request's contact HMAC is not under the global refusal bar, so the terminal mail worker's claim and authorization drop it once barred.
- Two new functions:
  - `public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)`, `{postgres=X/postgres,service_role=X/postgres}`: under the invitation-transition lock, refuses anything but a confirmed, active Path B record the caller owns and has not given away (42501 `not_found`), a record whose person holds it with their own account (42501 `other_adult_withdrawal_account_held`) and one whose notice cannot be addressed (55000 `withdrawal_notice_unavailable`); then runs `delete_subject_v1` unchanged (the uploader's Path B delete as `withdrawn`) and queues one `upload-permission-withdrawn` terminal notice, keyed by the spent nonce, to the person's contact ciphertext, bound to the request they accepted, for 7 days, unless that contact is barred.
  - `public.other_adult_withdrawal_readiness_v1(uuid,uuid)`, stable, `{postgres=X/postgres,service_role=X/postgres}`: `ready`, `account-held` or `unsupported`, from the door's predicates.
- Pinned, not changed: `private.delete_path_b_subject_for_route_v1` (`f30283fb54afaf87da2462c9a469c85f`), `private.enqueue_invitation_terminal_notice_v1` (`689008df933e852391c20f6e8b3afd4a`) and its trigger, `private.invitation_contact_barred_v1` (`78c6413be21d2c662e515764a39748b3`).
- Fingerprint effect: 2 more rows in `functions`, 2 `def_md5` values change, 1 constraint md5 in `tables` changes.

## Which releases must come first

1. Release 1 (PR 324): `20261016181000`, `20261016220000` and `20261016221000` make `delete_subject_v1` the body pinned above; without them the predecessor block refuses (55000, `other adult upload withdrawal prerequisite differs`).
2. Release 2's `20261023120000` (the subject-delete audit event names the person) and release 3's `20261024220000` (session CSRF tokens: the route is wrapped by `withAccountCsrf`).
3. `20261119150000` in this release (the route's self door; this migration does not touch its branch).
4. This migration.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)','2f2c32f48e4a223617ba6d31f493a92c','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.delete_path_b_subject_for_route_v1(uuid,text)','f30283fb54afaf87da2462c9a469c85f','{postgres=X/postgres}'),
   ('private.invitation_notice_recipient_current_v1(uuid)','261f743d84e3615d4ae56ab2e4e26b9a','{postgres=X/postgres}'),
   ('private.enqueue_invitation_terminal_notice_v1()','689008df933e852391c20f6e8b3afd4a','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_4_bodies_as_reviewed,
 (select count(*) from pg_proc p where p.oid=to_regprocedure('private.invitation_contact_barred_v1(text)')
   and md5(pg_get_functiondef(p.oid))='78c6413be21d2c662e515764a39748b3') as must_be_1_bar_as_reviewed,
 (select count(*) from pg_trigger t where t.tgrelid='private.invitation_terminal_notices'::regclass
   and t.tgname='enqueue_invitation_terminal_notice' and t.tgenabled='O') as must_be_1_notice_trigger,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.invitation_terminal_notices'::regclass
   and c.conname='invitation_terminal_notices_notice_kind_check' and c.convalidated)
   ='9a5c55221b44fc6b6b80079b9460b790' as must_be_true_notice_kind_check_as_reviewed,
 (select count(*) from pg_proc where proname in ('withdraw_other_adult_upload_v1','other_adult_withdrawal_readiness_v1'))
   as must_be_zero_new_functions_present,
 (select count(*) from public.subjects where subject_class='other_adult' and lifecycle='active' and ownership_transferred_at is null
   and owner_account_id is not null and subject_account_id is not null) as context_account_held_path_b_records,
 (select count(*) from private.invitation_terminal_notices) as context_terminal_notices,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, in the predecessor state rebuilt inside a rolled-back transaction, every `must_be_*` held; the md5s are also recomputed from source by `scripts/other-adult-upload-consent-withdrawal-migration.test.ts`, the door's through its two earlier patches. No pinned header prints a `public` type, so the md5s do not depend on `search_path`. Production holds none of release 1's functions yet, so the pins must be compared with release 1's read-back before this release's kit is built (D-136: a comment-stripped body is reviewed, not loosened).

## Locks and duration

The `alter table` takes ACCESS EXCLUSIVE on `private.invitation_terminal_notices` for the drop and the validating add (a scan of its rows; it holds only terminal notices, each at most 30 days old). Everything else is catalog work. Measured locally inside a rolled-back transaction that first rebuilt the predecessor state: 8.4 ms.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** Nothing deployed calls the two functions. No page sends `DELETE /api/subjects/[id]` for an other-adult record; the deployed route still sends one to `delete_subject_v1`, which now refuses the uploader on a record its person holds with their own account (the decision's branch) and otherwise deletes it as before, without the notice. Only a hand-made request reaches it.
- **Code deployed, migration not yet applied.** The upload page's card calls `other_adult_withdrawal_readiness_v1`; PostgREST answers that the function does not exist, and the card then says "You cannot withdraw here right now. Please try again." with no button. A hand-made request reaches the route, which sends the uploader's request only to `withdraw_other_adult_upload_v1`; the missing function's error is not one of the route's refusal codes, so it answers 503 `unavailable` and nothing is deleted. The route never falls back to `delete_subject_v1` for the uploader.
- **Before release 1.** As above: the read is missing, so the card offers nothing.

## What a person sees

Only in test mode: on `/files/upload`, the uploader's card for a confirmed person gains a "Your permission" section. For a person with no account of their own on the record, "Withdraw my permission" opens a confirmation that names what is deleted and that the person is told; after it the card shows only the receipt, and the person receives the `upload-permission-withdrawn` notice (subject "An invitation on Inherit has ended"). For a person who holds the record with their own account, the section says the permission cannot be withdrawn here yet and offers no button. The wording is a draft for the owner.

# Release notes: `20261119170000_embryo_uploader_consent_withdrawal.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 19 November 2026, "A non-parent uploader's withdrawal for an embryo upload stops analysis and deletes, as they signed" (`docs/protocol/decisions.md`); design section 3 of the same design file. Embryo ingest is closed in production (`EMBRYO_INGEST_AVAILABLE = false`; every draft and finalisation door is TEST-LOCAL), so no hosted database holds a non-parent upload.

## What it changes

- Two bodies patched in place under the same convention:
  - `private.restrict_embryo_cohort_core_v1` (`f2e6cb1f392308d4c834f7eef50d7abd` → `7b821beb4dffe9d039331941b4a8d8f2` → `ed617144a6aca603f29be372bd9bb484` → `006bfca91b8c66060681371e61333494`, `{postgres=X/postgres}`): the route list gains `api.consent-revoke`; on that route alone the actor must satisfy `private.embryo_uploader_basis_loss_v1` (refused 42501 `not the non-parent uploader`); on `api.cohort-restrict` and `api.withdraw` a current disposition authority is still required; the uploader's withdrawal deletes the sources as a `withdrawal`. Nothing else of the restriction changes.
  - `private.legal_audit_person_event_v1` (`56990e96581e5dc415222f44f09b5ac0` → `73bd0200b7e272bec503eab70499e877`, `{postgres=X/postgres}`): `('api.consent-revoke','embryo.upload-consent.withdrawn')` joins the person-caused events.
- Three new functions:
  - `private.embryo_uploader_basis_loss_v1(uuid,uuid)`, stable, `{postgres=X/postgres}`: the cohort's own current class-D non-parent uploader principal (the draft's `uploader_principal_id`, active, of the cohort owner's account), with its exact `consent.upload-embryo` uploader signature on the cohort's draft, in no participant set of the cohort, inside its own withdrawal (the transaction-local marker the door sets just before the core and the legal-audit actor its consumed nonce named).
  - `public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz)`, `{postgres=X/postgres,service_role=X/postgres}`, given the uploader's own signature. After finalisation it locks the cohort, checks it, spends the `consent_revoke` nonce, writes `embryo.upload-consent.withdrawn` (`{"phase":"cohort","actor_case":"nonparent-required-uploader-basis-loss"}`) and runs the restriction under that actor case (its own `embryo.cohort.restricted` event, now on `api.consent-revoke`, and its `cohort-restriction-notice` to every notice recipient). Before it, it takes the invitation-transition lock, locks the draft, refuses one finalised meanwhile (55000 `withdrawal_phase_changed`), spends the nonce, ends every pending invitation of the draft without a notice, cancels the draft and queues it through `private.queue_refused_invitation_draft_v1` on the draft purge the retention job already drains, and writes the event with `"phase":"draft"`.
  - `public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid)`, stable, `{postgres=X/postgres,service_role=X/postgres}`: `cohort` or `draft`, else 42501.
- Pinned, not changed: `private.queue_refused_invitation_draft_v1` (`54ab785feca9114bb097e5fbe1484dd9`), `private.consume_account_operation_nonce_v1` (`6869593d67ff37d93a6d4caea62f01c3`).
- No table, column, constraint, participant set or grant on an existing object changes. Fingerprint effect: 3 more rows in `functions`, 2 `def_md5` values change.
- `supabase/tests/legal_audit_attribution_completeness.sql` pinned the person-event list at its 20261023120000 successor; it now pins this migration's successor.

## Which releases must come first

1. The embryo restriction core (`20260930232000`) and the refusal draft purge (`20260906051253`): their hosted state is not recorded in this repository; the pre-check below reads them.
2. Release 2's `20261023120000`, the nonce recorder's last patch (`20261024110000`) and release 3's `20261024220000` (session CSRF tokens; `api.consent-revoke` is wrapped by `withAccountCsrf`).
3. `20261119160000` (this release), then this migration.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','f2e6cb1f392308d4c834f7eef50d7abd','{postgres=X/postgres}'),
   ('private.legal_audit_person_event_v1(text,text)','56990e96581e5dc415222f44f09b5ac0','{postgres=X/postgres}'),
   ('private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)','54ab785feca9114bb097e5fbe1484dd9','{postgres=X/postgres}'),
   ('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','6869593d67ff37d93a6d4caea62f01c3','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_4_bodies_as_reviewed,
 (select count(*) from pg_proc where proname in ('embryo_uploader_basis_loss_v1','withdraw_embryo_uploader_consent_v1',
   'embryo_uploader_withdrawal_readiness_v1')) as must_be_zero_new_functions_present,
 (select count(*) from public.embryo_cohorts where upload_class='embryo_third_party') as context_third_party_cohorts,
 (select count(*) from public.embryo_cohort_drafts where upload_class='embryo_third_party'
   and state in ('draft','evidence_pending','ready')) as context_open_third_party_drafts,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally every `must_be_*` held in the rebuilt predecessor state; the core's and the draft purge's md5s are recomputed from their source, and the other two read from the patch tables that made them, by `scripts/embryo-uploader-consent-withdrawal-migration.test.ts`. Both context counts are expected to be 0 in production.

## Locks and duration

Catalog work only: no relation lock beyond ACCESS SHARE (checked). Measured locally inside a rolled-back transaction that first rebuilt the predecessor state: 10.8 ms.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** Nothing deployed calls the three functions; the deployed `api.consent-revoke` resolves no signature and answers 404 for one. The core's two existing routes behave as before.
- **Code deployed, migration not yet applied.** `/embryos` and `/embryos/upload` call `embryo_uploader_withdrawal_readiness_v1`; PostgREST answers that it does not exist, and the control says "You cannot withdraw here right now. Please try again." with no button. A hand-made request reaches the route, which resolves the signature and calls `withdraw_embryo_uploader_consent_v1`; the missing function's error is neither 42501 nor 55000 nor a nonce refusal, so the route answers 503 `unavailable` (the registered `service-unavailable-v1`) and nothing is written.

## What a person sees

Only in test mode: the uploader who added embryo files with the genetic parents' permission sees "Your upload permission" on that cohort's card on `/embryos` and, before finalisation, on `/embryos/upload` once it has signed. The confirmation names what stops and is deleted, that the parents are told (after finalisation), and that it gives no parent role. A genetic parent never sees the control. The wording is a draft for the owner.

# Release notes: `20261120100000_self_withdrawal_deletes_exports.sql` (D-144; joins release 4)

Local work only. Nothing here was run against production or any hosted database. Defect D-144 (`docs/protocol/defects.md`): a saved export of a person's own record blocked the withdrawal of their upload consent for good, because `private.empty_self_subject_v1` refused (`subject_delete_unsupported_graph`) whenever any `generated_exports` row targeted the record, whatever its status. Brief §2.7: revoking the class artifact deletes every export artifact for that record; `export.generated-artifact-24h`: an export never outlives an earlier subject deletion.

## What it changes

An export with stored objects cannot be deleted: its archive segments and TEST R2 reservations are kept by design, and `private.guard_export_archive_delete_v1` refuses the row's deletion (`export_cleanup_incomplete`) even after disposal. So the emptying now retires each export of the record the way the export system itself does, through `public.export_archive_cleanup_v1('stop')` (the transition the cleanup sweep makes before the disposal runner removes an attempt's objects), and revokes it as the subject transfer revokes a record's exports. Five patches in place, each md5-guarded with its reviewed ACL, one anchor each, successor md5 and unchanged ACL asserted:

- `private.empty_self_subject_v1` (`85a9ab8159fa7e5bfb18deada62c1215` → `f524d4d33597e3938d9922f40ed3a115` → `022d38406f5ff240d32cdd460ebc4e96` → `5c35b1a9eafbfe7fd3e16f54b648dee7`, `{postgres=X/postgres}`): two declared variables; the export clause leaves the `subject_delete_unsupported_graph` refusal (a file another account holds on the record and a file tied to embryo records still refuse); before the files are prepared, every export of the record is locked, each of its attempts still `writing` or `bytes_complete` is stopped through the cleanup door (its objects queued for disposal behind the attempt's own fence, the lease plus 30 seconds; its download sessions revoked; its job's active attempt cleared, so a worker building it is refused at its next step), every export of the record is set `revoked` whatever its status was, and any `download_sessions` row bound to one of the record's exports (`target_kind='export'`, the legacy form) is revoked. No export row, segment or reservation is deleted. The audit event and its payload are unchanged.
- `private.prepare_genome_file_deletion_body_v1` (`e9f3f4692f0c6d10f6827410db8a0102` → `c78d66691786e656a063b2dfe7b78a28`, `{postgres=X/postgres}`): an export the emptying has retired (`revoked`, with no attempt still `writing` or `bytes_complete`) no longer blocks the file shortcut (`file_delete_shared_graph`); every other export of the record still does. Without this, every file the emptying prepares would be refused again at its finish, which reruns the guard. Nothing but the emptying revokes an export of a self record (`scripts/self-withdrawal-deletes-exports-migration.test.ts` lists every revoking statement), so `api.file-delete`, which shares the guard, answers exactly as before (409 `file_delete_subject_unavailable` while the record has any export) on every record that has not been emptied, as the register's `file-delete-v1` says.
- `public.self_subject_withdrawal_readiness_v1` (`81917a7dcc51887ab4cb06735cfca1a1` → `963586dade86d48a3f61d03b2403d41a`, stable, `{postgres=X/postgres,service_role=X/postgres}`): the export clause leaves `unsupported`, as it left the emptying's refusal.
- Pinned, not changed: `public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)` (`25fa3ce71b73fb0c371d1bb9af836bd7`, `{postgres=X/postgres,service_role=X/postgres}`), unchanged since `20260923123240`.
- No table, column, constraint, trigger, grant, function, audit event or wording changes. Fingerprint effect: 3 `def_md5` values change; `functions` row count and `tables` unchanged.

## Which releases must come first, and the order against `20261119150000`

1. `20260923123240_export_archive_persistence.sql` (the cleanup door and the archive tables; its production apply is recorded in `docs/evidence/export-persistence-production-apply-20260925/`) and release 1's `20261016181000_subject_delete.sql` (the two bodies patched here).
2. `20261119150000_own_upload_consent_withdrawal.sql`, earlier in this release. Its predecessor block pins `empty_self_subject_v1` and `prepare_genome_file_deletion_body_v1` at `85a9ab81…` and `e9f3f469…` and its postflight pins the first again: it must run before this migration, never after (it would then refuse, 55000 `own upload consent withdrawal prerequisite differs`). This migration cannot be applied first by mistake: it pins the readiness read that `20261119150000` creates and refuses without it (55000 `self withdrawal export prerequisite differs`). A pin of a later migration's input at its own time is not broken by a later migration that starts from exactly that body; this one names both pinned md5s as its patch predecessors (`scripts/own-upload-consent-withdrawal-migration.test.ts` now holds that, and `supabase/tests/own_upload_consent_withdrawal.sql` pins this migration's successor).
3. `20261119160000` and `20261119170000` touch none of these bodies; they may go before it in the same release, as their file order puts them.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.empty_self_subject_v1(uuid,uuid)','85a9ab8159fa7e5bfb18deada62c1215','{postgres=X/postgres}'),
   ('private.prepare_genome_file_deletion_body_v1(uuid,uuid)','e9f3f4692f0c6d10f6827410db8a0102','{postgres=X/postgres}'),
   ('public.self_subject_withdrawal_readiness_v1(uuid,uuid)','81917a7dcc51887ab4cb06735cfca1a1','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)','25fa3ce71b73fb0c371d1bb9af836bd7','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_4_bodies_as_reviewed,
 (select count(*) from pg_class where oid in (to_regclass('private.export_archive_attempts'),to_regclass('private.export_archive_jobs')))
   as must_be_2_archive_tables,
 (select count(*) from pg_trigger t where t.tgrelid='public.generated_exports'::regclass and t.tgname='guard_export_archive_delete'
   and t.tgenabled='O') as context_export_delete_guard,
 (select count(*) from public.generated_exports e join public.subjects s on s.id=e.target_id
   where e.target_kind='subject' and s.subject_class='self') as context_self_record_exports,
 (select count(*) from public.generated_exports e join public.subjects s on s.id=e.target_id
   where e.target_kind='subject' and s.subject_class='self' and e.status in ('queued','building','ready')) as context_live_self_record_exports,
 (select count(*) from private.export_archive_attempts a join public.generated_exports e on e.id=a.export_id
   join public.subjects s on s.id=e.target_id where e.target_kind='subject' and s.subject_class='self'
   and a.state in ('writing','bytes_complete')) as context_self_record_attempts_holding_objects,
 (select enabled from private.account_archive_r2_configuration) as context_test_r2_enabled,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, in the predecessor state rebuilt inside a rolled-back transaction (the five patches undone on the live bodies, each md5 checked back to its predecessor), `must_be_4_bodies_as_reviewed` was 4 and `must_be_2_archive_tables` 2; the md5s are also recomputed from source by `scripts/self-withdrawal-deletes-exports-migration.test.ts`. No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. The context counts say how many self records the change reaches at once. `api.subject-export` answers 503 before it creates anything unless a generation capability is configured, and only the TEST one exists (`approvedAccountArchiveGeneration` returns null), so all three self-record counts are expected to be 0 in production and `context_test_r2_enabled` false. `context_export_delete_guard` 1 is why nothing is deleted.

## Locks and duration

Catalog work only: three `create or replace function` statements run from the patch block, and catalog reads. No lock on any table (checked: the session held only `RowExclusiveLock` on `pg_proc`'s TOAST relation). Measured locally inside a rolled-back transaction that first rebuilt the predecessor state: 11.4, 12.1 and 16.0 ms in three runs. At run time the emptying additionally locks the record's export rows, then each job and attempt it stops, in the order every export worker and the cleanup sweep take them (export, job, attempt), after the subject it already holds.

## Deployed code between apply and deploy

This migration ships no application code; the code of release 4's own-file withdrawal (`20261119150000`'s branch) is the code that matters.

- **Migration applied, release-4 code deployed.** The intended state. A record whose only obstacle was an export reads `ready`; the withdrawal ends the record's exports with the rest, and the route's drain finishes each file. Deleting one file from `/files` is unchanged.
- **Migration applied, release-4 code not yet deployed.** No page offers the withdrawal; the deployed `DELETE /api/subjects/[id]` still sends a self record to `delete_subject_v1`, whose self case now ends the record's exports instead of refusing (only a hand-made request reaches it). Deleting one file is unchanged.
- **Release-4 code deployed, this migration not yet applied (also: `20261119150000` applied, this one not).** As before D-144: the read says `unsupported` for any record with an export, and the control shows "We cannot do this here yet, because of other data on your record. Nothing was deleted." with no button; a hand-made request is refused (55000, the route's opaque 404) and nothing is deleted.

## What a person sees

A person who has ever asked for an export of their own record now sees the withdrawal offered on Settings → Consents and on Files, where they saw the `unsupported` line before. After withdrawing, any download link of that record's exports stops at once: the poll answers 409 `state_conflict` while the record's file awaits its finish and 404 afterwards, and an open download serves no further chunk. The confirmation's list of what is deleted does not mention exports; no wording changed here (proposed wording is with the owner). Subject exports are made only in test mode, so in production nobody sees a difference until exports ship.

# Release notes: `20261120110000_file_delete_operation_nonce.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 19 November 2026, "G8.5: where the register is stricter, engineering codes to it" (`docs/protocol/decisions.md`); one of the examples the owner was given was deleting one file without the one-time confirmation the register requires for deletions. `api.file-delete` (`DELETE /api/files/[id]`, the Files page's Delete) is live in production, so this release changes a production path.

## What it changes

- `public.account_operation_nonces_operation_check` gains `'file_delete'` (drop and add, validated in place; the 22 values it holds are kept, read from the constraint as `20261024110000` reads them). Its definition md5 goes `7767adc7fcaf77800ca104be3ba0f121` → `c100e05a7cf3aca9ffcd33f386bdd3a4` (local).
- Two new functions:
  - `private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)`, `{postgres=X/postgres}` (no caller but the door), `def_md5` `60a0ae8a89aa24913a82d301afe3d9fc`: the account operation consumer's rule for this one operation. A malformed hash or an expiry not within the next 10 minutes is refused (22023 `invalid_operation_nonce`); a session that is not the account's live one is refused with the per-file door's own message (42501 `file_delete_unauthorized`); then the value's hash is inserted consumed, once (a hash already held, whatever its operation, is refused 22023). Inserting it consumed names the account as the transaction's legal-audit actor; no event the file deletion writes is on the person-event list, so no audit row changes.
  - `public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)`, `{postgres=X/postgres,service_role=X/postgres}`, `def_md5` `25c4025a77771334573f9594d73dc3ee`: records the value, then returns `public.prepare_own_prepared_file_cleanup_v1` unchanged, in the same transaction. That door's first write is the deletion's first write, so the value is spent exactly when a deletion starts: a refused deletion (not found, processing, shared graph, another record) rolls the spend back, and a replayed value writes nothing.
- Pinned, not changed: `public.prepare_own_prepared_file_cleanup_v1` (`8b6c62634d64e9058e2c503def867c4d`) and `public.prepare_genome_file_deletion_v1` (`8f2f2fd4b5d9dd017c5330907b42e137`), both `{postgres=X/postgres,service_role=X/postgres}`; both keep their grant (the subject-delete drain, this route's recheck after a prepared-artifact drain, and the deploy window below call the first). The per-file guard body, `private.prepare_genome_file_deletion_body_v1`, is deliberately not pinned: the door neither calls nor reads it, and `20261120100000` (D-144), earlier in this release, patches it.
- `private.consume_account_operation_nonce_v1` is not patched (20261119170000 pins it as its last word); the recorder is a separate function.
- Fingerprint effect: 2 more rows in `functions`, no `def_md5` changes; 1 constraint md5 in `tables` changes.

## Which releases must come first

1. Release 2's `20261023120000` (the legal-audit trigger `legal_audit_actor_on_consumed_insert`, which the predecessor block requires) and the check widening of `20261024110000` (`provider_setting_delete` must be in the check, or the widening refuses 55000 `account operation check unreadable`).
2. Release 3's `20261024220000` (the route is wrapped by `withAccountCsrf`).
3. Nothing else in release 4 is required. `20261120100000` (D-144) comes before this one in file order and patches the per-file guard body (to `c78d66691786e656a063b2dfe7b78a28`); this migration neither pins nor reads that body, so it applies with or without D-144 (checked locally on the shared database at `20261120100000`).

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)','8b6c62634d64e9058e2c503def867c4d','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)','8f2f2fd4b5d9dd017c5330907b42e137','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_2_doors_as_reviewed,
 (select count(*) from pg_trigger t where t.tgrelid='public.account_operation_nonces'::regclass
   and t.tgname='legal_audit_actor_on_consumed_insert' and not t.tgisinternal) as must_be_1_actor_trigger,
 (select count(*) from pg_constraint c where c.conrelid='public.account_operation_nonces'::regclass
   and c.conname='account_operation_nonces_operation_check' and c.convalidated
   and pg_get_constraintdef(c.oid) like '%''provider_setting_delete''%'
   and pg_get_constraintdef(c.oid) not like '%''file_delete''%') as must_be_1_check_before_widening,
 (select count(*) from pg_proc where proname in ('record_file_delete_nonce_v1','prepare_own_prepared_file_cleanup_with_nonce_v1'))
   as must_be_zero_new_functions_present,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='public.account_operation_nonces'::regclass
   and c.conname='account_operation_nonces_operation_check') as context_check_md5,
 (select count(*) from public.account_operation_nonces) as context_nonce_rows,
 (select count(*) from private.genome_file_deletions) as context_started_file_deletions,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally every `must_be_*` held before the migration; the two md5s are the same under `"$user", public, extensions` and under `pg_catalog` alone, and `scripts/file-delete-operation-nonce-migration.test.ts` recomputes both from source. `context_check_md5` read `7767adc7fcaf77800ca104be3ba0f121` locally; production's is compared, not assumed (the check has been widened by ten migrations, some not yet hosted).

## Locks and duration

The `alter table` takes ACCESS EXCLUSIVE on `public.account_operation_nonces` for the drop and the validating add (a scan of its rows: unexpired and consumed one-time values, each kept only until the next spend of its operation removes it once expired); every account operation that spends a value (Settings, consents, subject delete, account deletion) waits for it. Everything else is catalog work. Measured locally inside a rolled-back transaction: 23.0 ms, holding ACCESS EXCLUSIVE on that table only (checked in `pg_locks`).

## Deployed code between apply and deploy, and what a person sees

The route verifies the value before it asks the database anything (its MAC binds the account, the auth session, the operation `file_delete` and the file, and it expires within 10 minutes); a missing, malformed, expired or foreign value is refused 403 `request_forbidden`, which the Files page words "Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete." (existing copy). The route then calls the new door. Only when PostgREST or Postgres answers that the door does not exist (`PGRST202`, `42883`) does it call the unchanged door instead, as the session-CSRF stage falls back to v1; any other error refuses (503 `file_delete_failed`) and nothing is written.

- **Code deployed, migration not yet applied (the normal order).** Deleting a file works as today. The value is required and verified, but not spent, so within its 10 minutes the same request could be replayed for the same file by the same session: it can only repeat the deletion that person confirmed, of that one file, which is idempotent. A person sees no difference, except (as in every window once the code is deployed): a Files page left open more than 10 minutes answers its first Delete with the sentence above and renders itself again, and the second Delete works; and after any answer that is not a deletion the page renders again, so a row whose deletion started and stopped shows the database's own "File deletion is pending. Try Delete again." line without a reload.
- **Pages open across the code deploy.** A Files page rendered by the earlier code sends no value: its Delete is refused with the same sentence each time until the page is reloaded (the earlier client does not render itself again after a failure). Nothing is deleted or half-deleted.
- **Migration applied, code not yet deployed.** The deployed route calls the unchanged door, which keeps its grant: deleting works as today, with no value. Nobody sees a difference; the register's requirement is met only once the code is deployed.
- **Both.** Each request spends its own value in the transaction that starts (or continues) its deletion; a pending answer (202 `file_delete_pending`) carries the next value in its `X-Inherit-Operation-Nonce` header, which the client's repeat spends.
- A file deletion never half-happens because of this change: the spend and the deletion's first write commit together or not at all; after the first write the existing order (Storage removal, then finish, and the seven-day backstop) is unchanged.

## Rollback

Drop `public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)` and `private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)`; the deployed code then falls back to the unchanged door as in the first window. The `'file_delete'` value can stay in the check; to remove it, delete the rows with `operation='file_delete'` first (each is a spent value of a deletion that has already started or finished). Done locally after the browser runs: the check read back identical to its predecessor.

## Browser runs (local, this container)

`e2e/file-deletion.spec.ts` (its three tests that need no disposable stack) and `e2e/own-file-controls.spec.ts` ran against one local production build, twice: with the door absent (4 of 4 passed, through the fallback) and with this migration applied forward to the shared local database without recording it (4 of 4 passed; four `file_delete` values were recorded consumed, one per deletion, and none for the refused ones). The migration's objects were then dropped and the check restored.

# Release notes: `20261120120000_adult_acceptance_hold_and_renotice.sql`

Local work only. Nothing here was run against production or any hosted database. D-141 (`docs/protocol/defects.md`), coded to the signed register under the owner's rule of 19 November 2026, "G8.5: where the register is stricter, engineering codes to it" (`docs/protocol/decisions.md`): `policyResolvers.other-adult-mitigation-state-v1` (`account-created-from-invitation`, `all-class-b-re-notice`), `adult-subject-confirmation-v1.authenticatedTransaction`, `invitation-accepted-v1`, and `docs/retention.md` (`adult.acceptance-hold-72h`, `adult.re-notice-30d`). Path A's own-account acceptance and Path B are reached only under the test jurisdiction: in production no adult-subject invitation can be created, so no acceptance starts a clock and the executor finds nothing.

## What it changes

- `private.invitation_terminal_notices_notice_kind_check` gains `'adult-acceptance-second-notice'` and `'adult-revocation-renotice'` (drop and add, validated in place; the four existing kinds unchanged).
- Six bodies patched in place, md5-guarded with their reviewed ACL, one anchor each, successor md5, unchanged ACL, volatility and owner asserted:
  - `private.adult_subject_invitation_response_v1` (`99dfdec657617a2b4850f6632693ef51` → `bb4234666d681aeb85f3d41ed9e5121a`, `{postgres=X/postgres}`): Path A's confirm branch calls `private.start_adult_acceptance_clocks_v1` right after it marks the invitation accepted. Refusal and deletion are untouched.
  - `private.confirm_path_b_subject_account_core_v1` (`2b25a1fb389738bb23397c418612dd63` → `63c6c510a724cbe747af5db354cb344b`, `{postgres=X/postgres}`): the same call, for both Path B flows.
  - `private.other_adult_mitigation_before_public_appeal_v1` (`55892f3ffba0f229626ca024647c134a` → `8864524071b266426d978e106b6711d0` → `99b4ddcb5f80f2a4fb384b530b2c1502` → `4aa844173516d17aa462fb4ff2048e67` → `91dfb6e4abf766e3da6e5827d4381daf`, `{postgres=X/postgres}`, still STABLE): finds Path A's record by its own-account binding (its draft is consumed at acceptance), reads the clocks the acceptance recorded, holds an account recorded as created from the invitation until 72 hours after acceptance and until the second notice has provider submission acceptance (the uploader at every checkpoint; the person's own account at the six analysis and derived-read checkpoints only), and from 30 days denies the uploader until the re-notice has provider submission acceptance. An acceptance recorded before this migration keeps the old creation-time comparison and is never released. The no-account branch is unchanged.
  - `private.path_b_normalization_authority_v1` (`969bc88e9758fe1b2425289c6e4dd3a5` → `591fc9f913fb7177ed86144a7ce654f4`, `{postgres=X/postgres}`): its authority deadline is the uploader consent's own expiry (or none); the 30-day boundary is left to the decision it asks first at every checkpoint.
  - `public.claim_invitation_terminal_mail_v1` (`a725fd9deff71e8d32a3d76400112366` → `3524eba4d0dd916bef2c4dac1e5c25cb`) and `public.authorize_invitation_terminal_mail_v1` (`a4448da4d509e964b4cfe493dc6c8996` → `5ba9fd2ef4bfa2c36ec0e2be4b97aeb5`), both `{postgres=X/postgres,service_role=X/postgres}`: for the two new kinds only, the claim invalidates and the authorization refuses a notice whose record is no longer active, bound to the recipient account and untransferred, whose phase no longer waits on it, or whose invited address is under the global contact refusal bar. Every other kind reads as before.
- Six new functions and one trigger:
  - `private.start_adult_acceptance_clocks_v1(uuid)`, `{postgres=X/postgres}`: inside the acceptance, from `auth.users.created_at` and the invitation's `created_at` only, records `existing_account` for an account created before the invitation and `created_from_this_invitation` for any other (a missing time included); writes one `adult.re-notice-30d` retention row and due phase (`adult-revocation-renotice`, deadline acceptance + 30 days) for every account acceptance, and one `adult.acceptance-hold-72h` row and phase (`adult-acceptance-second-notice`, acceptance + 72 hours) for the second origin, both on `target_kind='invitation'`; the re-notice phase's envelope names the origin and the two times.
  - `private.adult_acceptance_clock_state_v1(uuid)`, stable, `{postgres=X/postgres}`: the decision's read of those clocks (null when none were recorded).
  - `private.adult_acceptance_notice_current_v1(uuid)`, stable, `{postgres=X/postgres}`: the send-time check above.
  - `private.settle_adult_acceptance_notice_v1()` and trigger `settle_adult_acceptance_notice` (after update of state or delete on `private.invitation_terminal_notices`, the two kinds only): provider acceptance makes the phase `succeeded` in the transaction that records it; a notice invalidated or removed unsent makes it `failed` and cancels its clock.
  - `public.run_due_adult_acceptance_notices_v1()`, `{postgres=X/postgres,service_role=X/postgres}`: called by `jobs.retention`; under the invitation-transition lock, queues each due notice once (idempotency key from the phase and the invitation) to the person's account (`recipient_kind='account'`, no contact copied), or cancels it with a coded reason; then, for a released clock, retries `private.enqueue_path_b_normalization_v1` for any revision the person confirmed while it held them back (`confirmed_blocked_current_gate`), each rechecking every gate.
  - `public.adult_subject_acceptance_origin_v1(uuid,uuid)`, stable, `{postgres=X/postgres,service_role=X/postgres}`: the recorded origin of the record's accepted invitation, for its own account only.
- Pinned, not changed: `private.enqueue_path_b_normalization_v1` (`8299149090c6d48d6ec52cfe75ab1af6`), `private.invitation_contact_barred_v1` (`78c6413be21d2c662e515764a39748b3`, pinned by name), the notice-kind check as `20261119160000` left it (`237de83b1bd70e3587147bb307883b96`), the queue's single trigger, and the two registered retention classes and their phases.
- No table, column or grant on an existing object changes. Fingerprint effect: 6 more rows in `functions`, 6 `def_md5` values change, 1 constraint md5 changes and 1 trigger is added.

## Which releases must come first

1. Release 1 (PR 324) for the Path B account core and decision as `20261016190000` and `20261016204000` left them; release 2's `20261025400000` for Path A's body.
2. `20261119160000` in this release (the notice-kind check it widens).
3. This migration. It does not depend on `20261120100000` or `20261120110000` and touches neither's objects.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','99dfdec657617a2b4850f6632693ef51','{postgres=X/postgres}'),
   ('private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)','2b25a1fb389738bb23397c418612dd63','{postgres=X/postgres}'),
   ('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','55892f3ffba0f229626ca024647c134a','{postgres=X/postgres}'),
   ('private.path_b_normalization_authority_v1(uuid,text)','969bc88e9758fe1b2425289c6e4dd3a5','{postgres=X/postgres}'),
   ('public.claim_invitation_terminal_mail_v1()','a725fd9deff71e8d32a3d76400112366','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.authorize_invitation_terminal_mail_v1(uuid,smallint)','a4448da4d509e964b4cfe493dc6c8996','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.enqueue_path_b_normalization_v1(uuid)','8299149090c6d48d6ec52cfe75ab1af6','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_7_bodies_as_reviewed,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.invitation_terminal_notices'::regclass
   and c.conname='invitation_terminal_notices_notice_kind_check' and c.convalidated)
   ='237de83b1bd70e3587147bb307883b96' as must_be_true_notice_kind_check_as_reviewed,
 (select count(*) from pg_trigger t where t.tgrelid='private.invitation_terminal_notices'::regclass and not t.tgisinternal)
   as must_be_1_notice_trigger,
 (select count(*) from public.retention_rows where retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d'))
   as must_be_zero_clocks,
 (select count(*) from pg_proc where proname in ('start_adult_acceptance_clocks_v1','adult_acceptance_clock_state_v1',
   'adult_acceptance_notice_current_v1','settle_adult_acceptance_notice_v1','run_due_adult_acceptance_notices_v1',
   'adult_subject_acceptance_origin_v1')) as must_be_zero_new_functions_present,
 (select count(*) from public.subject_invitations where invitation_kind='adult_subject' and status='accepted')
   as context_accepted_adult_invitations,
 (select count(*) from private.invitation_terminal_notices) as context_terminal_notices,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, in the predecessor state rebuilt inside a rolled-back transaction, every `must_be_*` held; the seven md5s are also recomputed from source, each through every earlier patch, by `scripts/adult-acceptance-hold-migration.test.ts`. No pinned header prints a `public` type. `context_accepted_adult_invitations` is expected to be 0 in production; a non-zero count means acceptances exist that this migration does not backfill: they keep the old rule (below).

## Locks and duration

The `alter table` takes ACCESS EXCLUSIVE on `private.invitation_terminal_notices` for the drop and the validating add (a scan of its rows, each at most 30 days old), and `create trigger` SHARE ROW EXCLUSIVE on the same table. Everything else is catalog work. Measured locally inside a rolled-back transaction that first rebuilt the predecessor state: 30.4 ms, the predecessor checks included.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** Every new account acceptance records its origin and clocks. A held account stays denied: the deployed retention job does not run the executor, so no second notice or re-notice is queued and no clock is released; from 30 days every account acceptance's uploader is denied, as today. The deployed `api.invitation-accept` still answers the existing-account body for every Path A acceptance; its page reads only `invitationKind` and `status`. An acceptance recorded before the apply keeps the old comparison (an account created after its request is held for good; any other uploader is denied from 30 days). The normalization authority's snapshot changes once for every existing Path B normalization (test-local only): a source normalized before the apply reads as `subject-bound-source` until it is normalized again. Nothing opens early.
- **Code deployed, migration not yet applied.** `api.invitation-accept` calls `adult_subject_acceptance_origin_v1`; PostgREST answers that it does not exist, and the route answers the held body (`created_from_this_invitation`, `hold_72h`) for every Path A acceptance, which over-states a hold and changes nothing the page shows. `jobs.retention` counts one failure per run for the missing executor and runs every other queue. The mail worker knows two more kinds the database cannot yet hold. The database decides exactly as before: Path B denies an account created after its request for good, Path A answers not found. Nothing opens early.

## What a person sees

Only in test mode. No page changes. An adult who accepts through an account created after the invitation gets, 72 hours later, the email "Did you accept an invitation on Inherit?"; every adult who accepted through an account gets, 30 days after acceptance, "You can still change your mind on Inherit". Until the first is accepted by the provider, the uploader's sharing stays closed ("Sharing with the person who added your file is not open yet." on the person's choices, as before) and nothing is analysed; from 30 days until the second is accepted, the uploader sees nothing more. The wording of both emails is a draft for the owner (`src/copy/upload/other-adult-acceptance-notices.ts`).
