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

# Release notes: `20261120130000_subject_copilot_scope.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 19 November 2026, "G8.5: Copilot for another adult's record opens" (`docs/protocol/decisions.md`): the self-hosted part, as the register describes it (`policyResolvers.scope-derived-v1.cases.subject:adult.principalRelationshipCases.uploader-or-grantee`). The cloud path is not built: `cloudProvider` stays `absolute-deny` and every hosted runtime renders the registered unavailable page. Nothing in this release opens in production: the scope runs only on a server-attested same-host local model (`copilot-transport-availability-v1`), which no hosted runtime is, and it needs `third_party_adult_analysis`, which no real jurisdiction permits; Path B, whose grant door it widens, is test-mode only.

## What it changes

- Six new functions, all `security definer`, `search_path=''`:
  - `private.subject_copilot_uploader_grant_v1(uuid,text,uuid,uuid,bigint,bigint,uuid,uuid,uuid,bigint)`, stable, `{postgres=X/postgres}`: one exact current grant of `copilot.local`, `reports.monogenic` or `reports.polygenic` from a Path B person to the uploader: signer and data subject the person's own current principal, signature theirs at the record's binding and their jurisdiction revision, current hash-verified `consent.share-with-adult`, direction to this recipient over this exact `uploader` relationship and revision.
  - `private.subject_copilot_authority_v1(uuid,uuid,uuid)`, `{postgres=X/postgres}`, and its service door `public.subject_copilot_scope_v1(uuid,uuid,uuid)`, `{postgres=X/postgres,service_role=X/postgres}`: the scope for one record, `ready` (with the exact authority a turn is bound to), `held`, `permission-missing`, or 42501 `not_found`. Grantee (another account's own `self` record): the Family recipient endpoints (no pause, the current `family_member` relationship), that person's `copilot.local` to the asker (`private.family_copilot_directional_grant_v1`, unchanged), then each report layer through `private.family_report_recipient_v1` (canonical only). Uploader (a confirmed Path B `other_adult` record the asker owns and its person holds with their own account): `private.other_adult_mitigation_v1` at `model-context-before-retrieval` first (anything but `allow` is `held`, or not found for the decision's own not-found), then the person's `copilot.local`, then each layer whose `private.path_b_result_read_v1` is ready, with its grant. No ancestry or variant projection.
  - `private.subject_copilot_prune_v1(uuid,uuid)`, `{postgres=X/postgres}`: deletes a conversation's first ended turn and its suffix (`private.family_copilot_turn_state_v1`, unchanged); a conversation is unreadable while a pause stands or, for an `other_adult` record, while the mitigation decision at `derived-write-and-read` is not `allow`, with nothing deleted.
  - `public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)`, `{postgres=X/postgres,service_role=X/postgres}`: `check`, `list`, `history`, `commit`, modelled on `public.family_copilot_chat_v1`. A conversation is a `chats` row with `scope_kind 'subject'`, the record's id and `canonical_authority.scope 'subject-adult'` (with its relationship and provider); the asker's provider must be `local` and their exact current Copilot authority; the page's context token is single use; every turn pair carries `retrieved_subject_ids [record]`, `retrieved_purpose_keys` (`copilot.local` and each layer read) and one `copilot_turn_dependencies` row per record, grant and source; citations are the Family group scope's closed set.
  - `private.purge_subject_copilot_chats_v1()`, `{postgres=X/postgres}`, and trigger `purge_subject_copilot_chats` (after update of lifecycle on `public.subjects`, an `other_adult` record turning `purged`): every account's turns that read the record go through `private.delete_pair_derived_rows_v1`, then the record's subject conversations are deleted whole.
- One body patched in place, md5-guarded, one anchor, successor md5 and unchanged ACL, volatility and owner asserted: `private.grant_path_b_purpose_v1` (`9489db2b7f1295f4d1ec114b6c40402a` → `31c75e79e6660f3ab92d2e640fca693f`, `{postgres=X/postgres,service_role=X/postgres}`): `copilot.local` is accepted, in the `uploader` direction only. Everything else of the door (the person's own session and principal, the mitigation decision at `purpose-grant-create`, the one-time presentation, `consent.share-with-adult` and its four statements, the superseding of an older pair) is unchanged; its public wrapper queues no report job for it. It is withdrawn by the existing `revoke_directional_purpose_with_nonce_v1`.
- Pinned, not changed: `private.other_adult_mitigation_v1` (`c5d5145da3cd9d178ebc87ea6c19702a`), `private.family_copilot_directional_grant_v1` (`b3a2114bf265870a2fad94337087d733`), `private.family_copilot_turn_state_v1` (`ecaa3458595f82351127ec80e26cd4c2`), `private.family_report_recipient_v1` (`692a52e391045b96addc465c8afbce0e`), `private.family_report_endpoints_v1` (`70683c77cef0f00c9803414a394fbd64`), `private.path_b_result_read_v1` (`d39c35dab17636d453a18f41bde4ede4`), `private.delete_pair_derived_rows_v1` (`8a094ce1d0a7ff92e00260204008dc07`), and `chats_scope_target_check` (`62a1bbb1b82b05d2e9267e691f28cf99`), which already admits a `subject` chat with its record and no other target.
- No table, column, constraint or grant on an existing object changes. Fingerprint effect: 6 more rows in `functions`, 1 `def_md5` changes, 1 trigger added on `public.subjects`.

## Which releases must come first

1. Release 1 for the Family group scope (`20260929140000`) and Path B's reading layer and saved reports (`20260930220000`, `20260930236000`); release 2 for the subject delete (`20261016181000`) and transfer (`20261016221000`).
2. `20261120120000` (D-141) in this release: the uploader case reads the mitigation decision as it leaves it; without it every uploader of an account created after the request stays held.
3. This migration. It does not touch the objects of `20261120100000` or `20261120110000`. Locally it was applied forward to the shared database after `20261120110000`, which had not been applied there; that one was applied forward first, in file order, and recorded.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)','9489db2b7f1295f4d1ec114b6c40402a','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.other_adult_mitigation_v1(uuid,uuid,text)','c5d5145da3cd9d178ebc87ea6c19702a','{postgres=X/postgres}'),
   ('private.family_copilot_directional_grant_v1(uuid,uuid,uuid,jsonb,text)','b3a2114bf265870a2fad94337087d733','{postgres=X/postgres}'),
   ('private.family_copilot_turn_state_v1(uuid,uuid,uuid)','ecaa3458595f82351127ec80e26cd4c2','{postgres=X/postgres}'),
   ('private.family_report_recipient_v1(uuid,uuid,uuid,text)','692a52e391045b96addc465c8afbce0e','{postgres=X/postgres}'),
   ('private.family_report_endpoints_v1(uuid,uuid,uuid,boolean)','70683c77cef0f00c9803414a394fbd64','{postgres=X/postgres}'),
   ('private.path_b_result_read_v1(uuid,uuid,text)','d39c35dab17636d453a18f41bde4ede4','{postgres=X/postgres}'),
   ('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)','8a094ce1d0a7ff92e00260204008dc07','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_8_bodies_as_reviewed,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='public.chats'::regclass
   and c.conname='chats_scope_target_check' and c.contype='c' and c.convalidated)
   ='62a1bbb1b82b05d2e9267e691f28cf99' as must_be_true_chat_target_check_as_reviewed,
 (select count(*) from pg_proc where proname in ('subject_copilot_uploader_grant_v1','subject_copilot_authority_v1',
   'subject_copilot_scope_v1','subject_copilot_prune_v1','subject_copilot_chat_v1','purge_subject_copilot_chats_v1'))
   as must_be_zero_new_functions_present,
 (select count(*) from pg_trigger where tgrelid='public.subjects'::regclass and tgname='purge_subject_copilot_chats')
   as must_be_zero_purge_trigger,
 (select count(*) from public.chats where scope_kind='subject') as context_subject_chats,
 (select count(*) from public.purpose_grants where purpose='copilot.local' and revoked_at is null) as context_live_copilot_local_grants,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, in the predecessor state rebuilt inside a rolled-back transaction (this migration's objects dropped and the patched body restored), every `must_be_*` held; the patched body's predecessor and successor md5s and the two Family helpers' md5s are also recomputed from source by `scripts/subject-copilot-scope-migration.test.ts`. `context_subject_chats` is expected to be 0 in production (no code before this release writes a `subject` chat), and `context_live_copilot_local_grants` 0 too (no real jurisdiction lets anyone sign one).

## Locks and duration

`create trigger` takes SHARE ROW EXCLUSIVE on `public.subjects`; everything else is catalog work, and the patch replaces one function body. Measured locally inside a rolled-back transaction that first rebuilt the predecessor state: about 16 ms, the predecessor checks included.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** The deployed code calls none of the new doors. The Path B grant door accepts `copilot.local` for the uploader direction, but the deployed body schema and presentation refuse that purpose before the database, so nothing can write one. The trigger runs on every purge of an `other_adult` record and finds no subject conversation to delete. Nothing opens early.
- **Code deployed, migration not yet applied.** On a self-hosted local-model deployment under the test jurisdiction, the one-record page calls `subject_copilot_scope_v1`; PostgREST answers that it does not exist, and the page answers the same 404 as for no relationship; the Family person page and the Files page show no Copilot link (their probe fails closed). The Path B choices list a Copilot row whose turning on the database refuses (`22023 invalid_request`, answered 422; nothing is written). No token is minted, so the chat route reads nothing. On the hosted service every one of these pages renders the registered unavailable page, or no link, before any of this is read. Nothing opens early.

## What a person sees

Only on a self-hosted install with a local model and the test jurisdiction. A person who shares with someone on the Family pages sees no new wording: the "Copilot" row's consequence was already "They can ask Copilot about the reports you share, on a model that runs on their own computer."; turning it on with at least one report type now lets that person's Copilot answer about them, with no Health picture needed. The person who receives the share sees "Ask Copilot about {name}" on that person's Family page and a page headed "Ask about {name}" whose answers name whose results they used. A Path B person sees one more choice, "Copilot", for the person who added their file; that person sees "Ask Copilot about {name}" beside the shared reports on Files. Every new string is a draft for the owner. On the hosted service nothing changes: the same address shows "Copilot for other people is not open here".

## Browser runs (local, this container)

`e2e/copilot-subject.spec.ts` (6 tests) against one production build, on the `copilot-local` project (port 3103) and, for its hosted check, the main variant (port 3100): 6 of 6 passed. The canonical fixture daemon runs only in the isolated CI container (its TLS face listens on a container-only address); here a host-loopback stand-in started the same reviewed provider (`e2e/fixtures/canonical-copilot-provider.ts`, unchanged) on plain `127.0.0.1:8127` and answered the daemon's control protocol on `127.0.0.1:8130`. No CI flag was set and no network configuration changed. With it, on the same build: `copilot-family`, `copilot-cohort`, `copilot-redteam`, `copilot-group-scopes`, `copilot-scope-states`, `copilot-group-scopes.nojurisdiction`, `genome-family.nojurisdiction` and `family`, 100 of 100 in all; and the three Path B journeys of `other-adult-upload.spec.ts` that reach the person's choices, 3 of 3. No browser test ran the uploader case: its fixtures live inside `e2e/other-adult-upload.spec.ts` and drive the global Path B workers; `supabase/tests/subject_copilot_path_b.sql` drives it through the same database doors.

# Release notes: `20261122100000_uploader_withdrawal_hands_record_to_adult.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 22 November 2026, "An uploader's withdrawal hands a record its adult holds to that adult" (`docs/protocol/decisions.md`): when an uploader withdraws its permission for another adult's file and that adult holds the record with their own account, the withdrawal moves the record and the files the adult confirmed to the adult through the existing transfer (`lifecycleDispositionContracts.subject-ownership-transfer-v1`), on the uploader's act; the uploader's consent ends, unconfirmed files are deleted and the uploader keeps no access. **Built closed.** The transfer's one switch, `private.subject_transfer_open_v1()`, still answers false and this migration does not change it, so nothing changes for anyone until the owner approves the transfer's three notices. Path B, the only way such a record exists, is TEST-LOCAL only; nothing here is reachable in production in any order of apply and deploy.

## What it changes

- `invitation_terminal_notices_notice_kind_check` gains five kinds, the transfer's three notices for each of its two acts: `subject-transfer-new-owner`, `subject-transfer-former-owner` (the person's own act), `withdrawal-transfer-new-owner`, `withdrawal-transfer-former-owner` (the uploader's withdrawal) and `subject-transfer-access-revoked` (any other account whose access ended, either act). Existing rows hold only the six earlier kinds.
- One new function, `private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])`, `security definer`, `search_path=''`, `{postgres=X/postgres}` (no API role may call it): called only by the transfer, in its own transaction, it queues one account notice per transfer, kind and account through the terminal-notice queue and its existing worker, bound to the request the person accepted, for seven days. A transfer whose new or former owner cannot be addressed is refused whole (55000 `subject_transfer_notice_unavailable`).
- Three bodies patched in place, md5-guarded, one anchor per patch, successor md5 and unchanged ACL asserted:
  - `private.transfer_subject_v1`, eight patches (`3707a210e8fab9361b15a1ab6adbe8e0` → `e481de5f5eab53b6c596da66bc7b30fa`, `{postgres=X/postgres}`): the second actor case (the owning uploader, only when the withdrawal door names the record in the transaction-local marker `inherit.subject_transfer_withdrawal`; its account need not be current for analysis; it spends its `subject_delete` code; every file the person has not confirmed ends `withdrawn` through the unchanged `private.end_other_adult_held_upload_v1`; then the transfer's unchanged steps run for the person); D-147 (the uploader's `upload_class` consent ends, `withdrawn` on its withdrawal and `superseded` on the person's own act, and is kept); D-151 (each export attempt still holding or writing objects is stopped through `public.export_archive_cleanup_v1('stop')` before the record's exports are revoked, as `20261120100000` does); any one-record Copilot context of another account that still names the record is deleted (a defensive step: the shared purge the transfer already runs deletes those of every account whose turn read the record, so in every flow tested it finds none; the statement's own comment says "unredeemed", which is narrower than what it deletes); the notices are queued; the audit event names the act (the withdrawal's is on `api.subject-delete`, outcome `withdrawn`, attributed to the uploader as the transfer's event is).
  - `public.withdraw_other_adult_upload_v1` (`caa3a80ce5b8c21aaafa83138575de39` → `c00c31ee8ba5848c95ea4b2384d07e61`, `{postgres=X/postgres,service_role=X/postgres}`): the account-held branch is refused as before (`42501 other_adult_withdrawal_account_held`) while the switch is closed; once open it runs the transfer under the marker and answers `{"case":"adult"}`. Nothing else of the door changes.
  - `public.other_adult_withdrawal_readiness_v1` (`de43608630ccda660633c0f36626254c` → `29f041df82ed5defc7d4cc48fcb12e0f`, stable): the account-held branch reads `account-held` while the switch is closed (as before) and `hand-over` once it is open.
- Pinned, not changed: `private.subject_transfer_open_v1()` (`c4b160e966711cf513e267673c4b5e2f`; it must answer false before and after), `public.transfer_subject_v1` (`0fb41099ef95025c011084190ed1555f`), `public.export_archive_cleanup_v1` (`25fa3ce71b73fb0c371d1bb9af836bd7`), `private.end_other_adult_held_upload_v1` (`0d5e9e5784297e1a1cb77aacfbe54a43`), `private.legal_audit_actor_principal_v1` (`7d74f4fc739c03a14c928b5c529ca83a`), the queue's insert trigger function (`689008df933e852391c20f6e8b3afd4a`) and its recipient check (`e0728613189f2cbdfa05029c962767a5`).
- No table, column, index, trigger, policy or grant on an existing object changes. Fingerprint effect: 1 more row in `functions`, 3 `def_md5` change, 1 check constraint's definition changes.

## Which releases must come first

1. Release 2 for the transfer and its switch (`20261016221000`) and the subject delete (`20261016181000`); release 1 for the terminal-notice queue (`20260906053451`) and the export cleanup door (`20260923123240`).
2. In this release, `20261119160000` (the door and the read it patches), `20261120100000` (whose pattern it follows; it touches none of its bodies) and `20261120120000` (the notice kinds it widens), in file order. Locally it was applied forward to the shared database after `20261120130000`, with `supabase migration up --local`, and recorded.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','3707a210e8fab9361b15a1ab6adbe8e0','{postgres=X/postgres}'),
   ('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)','caa3a80ce5b8c21aaafa83138575de39','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.other_adult_withdrawal_readiness_v1(uuid,uuid)','de43608630ccda660633c0f36626254c','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.subject_transfer_open_v1()','c4b160e966711cf513e267673c4b5e2f','{postgres=X/postgres}'),
   ('public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','0fb41099ef95025c011084190ed1555f','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)','25fa3ce71b73fb0c371d1bb9af836bd7','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.end_other_adult_held_upload_v1(uuid,text)','0d5e9e5784297e1a1cb77aacfbe54a43','{postgres=X/postgres}'),
   ('private.legal_audit_actor_principal_v1(text,text)','7d74f4fc739c03a14c928b5c529ca83a','{postgres=X/postgres}'),
   ('private.enqueue_invitation_terminal_notice_v1()','689008df933e852391c20f6e8b3afd4a','{postgres=X/postgres}'),
   ('private.invitation_notice_recipient_current_v1(uuid)','e0728613189f2cbdfa05029c962767a5','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_10_bodies_as_reviewed,
 (select private.subject_transfer_open_v1()) as must_be_false_transfer_switch,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.invitation_terminal_notices'::regclass
   and c.conname='invitation_terminal_notices_notice_kind_check' and c.contype='c' and c.convalidated)
   ='1d03e86f7fe7caed9c52b9df695bb46d' as must_be_true_notice_kinds_as_reviewed,
 (select count(*) from pg_proc where proname='queue_subject_transfer_notices_v1') as must_be_zero_new_function_present,
 (select count(*) from public.subjects where subject_class='other_adult' and upload_class='adult' and lifecycle='active'
   and subject_account_id is not null and owner_account_id is distinct from subject_account_id) as context_records_held_by_their_person,
 (select count(*) from public.subjects where ownership_transferred_at is not null) as context_transferred_records,
 (select count(*) from private.invitation_terminal_notices) as context_terminal_notices,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, before the migration was applied forward, every `must_be_*` held (10, false, true, 0); the three patched bodies' predecessor and successor md5s, and the switch's, the person's door's, the cleanup door's and the held-upload ending's, are also recomputed from source by `scripts/uploader-withdrawal-hand-over-migration.test.ts`. No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. `context_records_held_by_their_person` and `context_transferred_records` are expected to be 0 in production (Path B is TEST-LOCAL); locally they were 10 and 0, left by browser runs.

## Locks and duration

`alter table private.invitation_terminal_notices drop constraint … add constraint …` takes ACCESS EXCLUSIVE on that table to commit and scans it once to validate; everything else is catalog work and three function bodies replaced. The terminal mail worker waits on that lock while it is held. Measured locally inside a rolled-back transaction: about 37 ms, the predecessor checks and postflight included.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed (the expected order).** The switch is closed, so the door refuses the account-held branch with the same error as before and the read answers `account-held` as before; the deployed card shows the same sentence and no request. The person's own transfer door is closed as before. Nothing queues the new notice kinds, and the deployed mail worker, which does not know them, never meets one. Nothing changes.
- **Code deployed, migration not yet applied.** The new card knows a `hand-over` answer, which the old read never gives; the new mail worker and template know five more kinds that nothing queues. The route's code is unchanged. Nothing changes.
- **Both, with the switch closed (this release).** As the first window. In production Path B is not open, so none of this is reachable in any window.

## What a person sees

Nothing changes while the switch is closed: on a record the person holds with their own account the uploader's card still says "You cannot withdraw your permission for {name} here yet. Nothing has changed." and offers no request. Once the owner approves the wording and the switch is opened (below), and only under the test jurisdiction: the card says the record becomes the person's, the confirmation lists what moves, what is deleted and what the uploader loses, the receipt says the record is now theirs, and the emails go out (to the person, to the uploader, and to any other account whose access ended). Every one of those strings is a draft for the owner; none is approved.

## What opening the switch requires

The owner's approval of the five notices' wording and of the card's hand-over wording (`src/copy/upload/subject-transfer-notices.ts`; `OTHER_ADULT_HAND_OVER_COPY` in `src/copy/upload/other-adult-withdrawal.ts`), recorded in `docs/protocol/decisions.md`; then one later guarded migration that replaces `private.subject_transfer_open_v1()` with a body answering true (from exactly `c4b160e966711cf513e267673c4b5e2f`, ACL `{postgres=X/postgres}` and `immutable` kept, its predecessor block pinning this migration's three successor md5s and the new function), with the register amended to say the transfer and its second actor case are open and their notices approved. That one change opens both acts at once: the person's own `api.subject-transfer` and the uploader's hand-over through `api.subject-delete`. Before it ships: a browser spec for the open branch (the hand-over through the screens, the emails through the mail drain, the relocation worker), the relocation worker's schedule where the transfer can run (its doors refuse outside TEST-LOCAL), and the owner's answers to the questions in the wording draft. Until Path B opens to a real jurisdiction, opening the switch reaches nobody in production.

## Browser runs (local, this container)

`e2e/other-adult-upload-withdrawal.spec.ts` (2 tests) against one production build of this change, with this migration applied forward to the shared local database (the switch closed): 2 of 2 passed ("E2E contract passed: 2 result(s), no skips, no retries"; 3 browser uploads crossed the provider proxy). The second test is the closed branch: on a record its person holds with their own account the card shows the same sentence and offers no request, and nothing changes. No browser test runs the opened branch: the switch opens only by a migration; `supabase/tests/uploader_withdrawal_hand_over.sql` opens it inside its own rolled-back transaction.

# Release notes: `20261122110000_adult_acceptance_inviter_reads.sql`

Local work only. Nothing here was run against production or any hosted database. D-156 (`docs/protocol/defects.md`), owner decision of 22 November 2026, "The 72-hour hold covers an inviter's reads of the invited adult's own record" (`docs/protocol/decisions.md`): until 72 hours have passed and the second notice has been accepted by the mail provider, and from 30 days until the reminder has been accepted, the inviter sees nothing the new adult shares with them, through every Family reader and Copilot; the adult's own use of their record is not held. Path A's own-account acceptance is reached only under the test jurisdiction, and every Family read of another adult needs `third_party_adult_analysis`, which no real jurisdiction permits: in production no acceptance clock exists and no reader meets one.

## What it changes

- Two new functions, both `security definer`, stable, `search_path=''`:
  - `private.adult_acceptance_inviter_held_v1(uuid,uuid)`, `{postgres=X/postgres}`: the one question. True only when the subject is another account's `self` record, the reader is the inviter (`subject_invitations.inviter_principal_id`) of an accepted `adult_subject` invitation whose `other_adult` record that account holds and has no draft (Path A; a Path B record keeps its confirmed draft), and that acceptance's clocks, read through `private.adult_acceptance_clock_state_v1`, hold it: an account recorded as created from the invitation until 72 hours after acceptance and until the second notice's provider acceptance; every account acceptance from 30 days until the reminder's. An acceptance with no clock (recorded before `20261120120000`) keeps the creation-time comparison `other-adult-mitigation-state-v1` keeps for it and is never released. A notice that ended unsent (failed or cancelled phase) never releases. The adult themselves, any other grantee and the inviter reading anyone else's record are never held.
  - `public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])`, `{postgres=X/postgres,service_role=X/postgres}`: of up to 1,000 named records, the ones the account reads as not shared now (22023 `invalid_request` for a missing account or a longer list). No reason is returned.
- Five bodies patched in place, md5-guarded with their reviewed ACL, one anchor each, successor md5, unchanged ACL, volatility and owner asserted; each adds one call to the question at the reader's existing grant checkpoint and answers exactly as with no grant:
  - `private.family_report_recipient_v1` (`692a52e391045b96addc465c8afbce0e` → `5e36eec0ee7f83911fd0966730081145`): 42501 `not_found`. Through it: `public.family_shared_report_results_v1`, `public.confirm_family_shared_report_results_v1`, `public.confirm_family_shared_readiness_v1`, the Family group Copilot's members (`private.family_copilot_member_v1`, so `public.family_copilot_scope_v1` and every `family_copilot_chat_v1` check and commit) and the one-record Copilot's grantee layers (`private.subject_copilot_authority_v1`, which then answers `permission-missing`).
  - `private.family_ancestry_recipient_v1` (`5d379a615e41ef4a05ce84f1c8455d51` → `9ba008dab0144ba55a6ac57fb68f7172`): 42501 `not_found` (the shared ancestry read and its confirmation).
  - `private.health_picture_direction_v1` (`5433a806e2f7ff6319dd2989a677b130` → `d496bc699608053982ded60110a64628`): 42501 `not_found` for the viewer's own inbound direction only (`p_account=p_viewer`), so the adult's own Health picture beside the inviter is never held. Through it: `private.health_picture_context_v1`, `public.health_picture_results_v1`, `public.confirm_health_picture_results_v1`.
  - `private.family_portrait_authority_v1` (`1ff3da517b6bc473985e8fd3e073bcaa` → `437d6400ed4b83a6cb1da08be2195abf`): null, asked about the reader's counterpart only, so the adult's own view of the pair is never held. Through it: `public.family_portrait_navigation_v1`, `public.family_portrait_source_readiness_v1`, `public.family_portrait_carrier_calls_v1`, `private.export_subject_portrait_rows_v1`.
  - `private.family_copilot_turn_state_v1` (`ecaa3458595f82351127ec80e26cd4c2` → `3ed921e9d872a5c557389a126a1af7ff`, still STABLE): a turn that read the held record reads `paused`, as during a pause: the Family group and one-record conversations are unreadable and unlisted, nothing is deleted, and the subject export leaves those turns out.
- Pinned, not changed: `private.adult_acceptance_clock_state_v1` (`6f566115c807f64e1c2a9413f2669fe1`). `private.family_source_*` take no reader (the data subject's own authority over their own source) and are reached only through the recipients above.
- Application code, same change: the Family graph (`src/lib/family/graph.ts`) asks the door once per read for the records that share with the viewer and leaves their grants out before anything is decided, so every page built on it (the Family hub, person and permissions pages, Health picture, the overview, `/genome/s-…` including the raw-browse pages, which read through the graph alone) shows what it shows when nothing is shared; the Portrait page's own pair read (`src/lib/family/portrait.ts`) asks the same for the other person's grant. Either fails closed: an unanswered question reads every record that shares with the viewer as not shared.
- No table, column, constraint, trigger, grant on an existing object, queue, job or wording changes. Fingerprint effect: 2 more rows in `functions`, 5 `def_md5` values change; `tables` unchanged.

## Which releases must come first

1. Release 1 for the Family readers it patches (`20260907124212`, `20260907153506`, `20260915120846`, `20260923101135`, `20260929140000`).
2. `20261120120000` (D-141) in this release: the clocks the question reads. `20261120130000` in this release: it pins the report recipient and the turn state at the md5s this migration starts from, so it must run first (its own pre-check would refuse after this one).
3. This migration. It does not touch the objects of `20261122100000` (another change of the same day: the transfer, the other-adult withdrawal door, the subject delete and the one-record Copilot purge); locally it was applied forward after that one, which another session had already applied, and recorded.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.family_report_recipient_v1(uuid,uuid,uuid,text)','692a52e391045b96addc465c8afbce0e'),
   ('private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)','5d379a615e41ef4a05ce84f1c8455d51'),
   ('private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)','5433a806e2f7ff6319dd2989a677b130'),
   ('private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)','1ff3da517b6bc473985e8fd3e073bcaa'),
   ('private.family_copilot_turn_state_v1(uuid,uuid,uuid)','ecaa3458595f82351127ec80e26cd4c2'),
   ('private.adult_acceptance_clock_state_v1(uuid)','6f566115c807f64e1c2a9413f2669fe1')
  ) as x(signature,body) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text='{postgres=X/postgres}') as must_be_6_bodies_as_reviewed,
 (select count(*) from pg_proc where proname in ('adult_acceptance_inviter_held_v1','adult_acceptance_inviter_held_subjects_v1'))
   as must_be_zero_new_functions_present,
 (select count(*) from public.subject_invitations i where i.invitation_kind='adult_subject' and i.status='accepted'
   and not exists(select 1 from public.adult_subject_drafts d where d.subject_id=i.target_id)) as context_accepted_path_a_invitations,
 (select count(*) from public.directional_grants where status='current' and direction='subject_to_recipient')
   as context_current_person_to_person_grants,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, before the forward apply and again in the predecessor state rebuilt inside a rolled-back transaction (each patch reversed to its predecessor md5, the two functions dropped), every `must_be_*` held (6, 0; the shared database's context was 8 and 12). The six md5s are also recomputed from source by `scripts/adult-acceptance-inviter-reads-migration.test.ts`. No pinned header prints a `public` type. Both `context_*` counts are expected to be 0 in production; a non-zero `context_accepted_path_a_invitations` means acceptances exist whose inviters the question now asks about, under the rules above.

## Locks and duration

Catalog work only: two `create function` and five `create or replace function` (each takes a lock on its own `pg_proc` row); no table is locked or scanned. Measured locally inside a rolled-back transaction: about 30 ms, the pre-checks included.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed.** Every database reader answers a held inviter as with no grant. The deployed Family graph does not ask, so on a test-jurisdiction deployment the held inviter sees the adult's grants as on: the person page then gets `not_found` from the report read and answers the 404 page (not the "has not shared anything with you yet" state), Health picture and Portrait answer their unavailable or 404 states, both Copilot pages answer as with nothing shared, the permissions page shows the adult's rows as On, and the raw-browse pages (`/genome/s-…/data`, `/data/browser`), which the graph alone gates, still open the adult's variants. Nothing changes in production, where no acceptance clock exists.
- **Code deployed, migration not yet applied.** The graph and the Portrait read call `adult_acceptance_inviter_held_subjects_v1` only when some record shares with the viewer; PostgREST answers that it does not exist, and both read every record that shares with that viewer as not shared, everyone's, not only an invitee's, while the old database readers answer as before: both Copilot scopes (which take their members from the database) still read a held invitee's reports on a self-hosted local-model deployment. In production no record shares with anyone (no jurisdiction permits it), so no call is made and nothing changes.
- Both windows are closed by applying the migration and deploying the code together; neither opens anything in production.

## What a person sees

Only in test mode. No new wording: during the hold, and from 30 days until the reminder is accepted, the inviter sees on each surface exactly what it shows when the adult shares nothing, and the adult sees no change at all.

- `/family`: the adult's card reads "Waiting for {name} to share".
- `/family/s-{record}`: "{name} has not shared anything with you yet. You will see nothing here until they do." (`data-state="empty"`), and no "Ask Copilot about {name}" link.
- `/family/s-{record}/permissions`: every row of the adult's column reads Off; the inviter's own column is unchanged.
- `/genome/s-{record}`, its reports, report, ancestry, carrier, data and data browser pages: the not-found page, as for a person who shares none of the page's purposes.
- `/family/health-picture` and the overview: the adult is not a column ("This page needs two people who have both agreed to be seen side by side. So far there is 1." when no one else is).
- `/family/portrait/{pair}`: "Portrait is waiting for {name}" with "{name} has not: turned on Portrait from their own account".
- `/copilot/family`: the adult is not under "Who Copilot can read" ("No one has let Copilot read what they share with you." when no one else is); `/copilot/s-{record}`: "{name} has not let Copilot read what they share with you." and "Only {name} can turn this on. They need Copilot and at least one report type on for you."; an earlier conversation that read the adult is not listed and its history answers 404, and returns whole once the reminder is accepted.

Those sentences say the adult has not shared, which is not so during the hold; that is what "reads exactly as nothing shared" requires, and the owner may want to see it. When the clock clears, the next read shows what the adult shares: no job, queue or other step is needed.

## Browser runs (local, this container)

One production build of this change (test jurisdiction on), served by the standard runner (`scripts/run-upload-browser.mts --full`, the real Storage provider proxy) on the shared local database with this migration applied. `e2e/family.spec.ts`, whose Path A journey's invited adult has an account created before the invitation (no hold, and well inside 30 days), 13 of 13; `e2e/family-health-picture.spec.ts` 15 of 15; `e2e/portrait-no-file.spec.ts` (the Portrait pair read) 3 of 3; each "E2E contract passed … no skips, no retries". A first run of all three specs in one invocation passed `portrait-no-file` and the first four `family` tests, then stopped `family` and `family-health-picture` at the same early step: the invited adult's mailed review link answered "This link is unavailable. It may have expired or already been used." on `/withdraw/request`, before the acceptance and before anything this change reads. Both passed whole when run again, each on its own; the cause of that first refusal was not found. No browser journey drives the hold itself: a held acceptance needs an account created after the invitation and its clocks aged by 72 hours or 30 days, which `supabase/tests/adult_acceptance_inviter_reads.sql` does through the same database doors and `src/lib/family/graph-read.test.ts` checks on the application side.

# Release notes: `20261122120000_subject_transfer_open.sql`

Local work only. Nothing here was run against production or any hosted database. Owner decision of 22 November 2026, "The transfer notices are approved, with one added line, and the transfer is switched on" (`docs/protocol/decisions.md`): the strings of `docs/evidence/uploader-hand-over-20261122/transfer-wording.md` are approved, the two emails to the person who now holds the record gain "Any download copy of this record has stopped working. You can make a new one." (an app string; the queue carries only each notice's kind), and one guarded migration switches the transfer on. **This opens both acts at once**: the person's own "move this record into my account" (`api.subject-transfer`, `public.transfer_subject_v1`) and the uploader's withdrawal for a record the person holds with their own account (`api.subject-delete`, `public.withdraw_other_adult_upload_v1`), which hands the record to the person; the page's read (`public.other_adult_withdrawal_readiness_v1`) answers `hand-over`. Path B, the only way such a record exists, is TEST-LOCAL only; nothing here is reachable in production in any order of apply and deploy (below).

## What it changes

- One body replaced, `private.subject_transfer_open_v1()` (`c4b160e966711cf513e267673c4b5e2f` → `8d2e22d1e0c41c8bce0e43b9e45378d3`): `select false` → `select true`. Same signature, `immutable`, `search_path=''`, not `security definer`; `create or replace` keeps its ACL `{postgres=X/postgres}` (no API role may call it). Its three readers are unchanged: the person's door, the withdrawal door and the page's read.
- Pinned before (and the transfer, its two doors, the read and the notice queue again after), not changed: `public.transfer_subject_v1` (`0fb41099ef95025c011084190ed1555f`), `public.withdraw_other_adult_upload_v1` (`c00c31ee8ba5848c95ea4b2384d07e61`), `public.other_adult_withdrawal_readiness_v1` (`29f041df82ed5defc7d4cc48fcb12e0f`), `private.transfer_subject_v1` (`e481de5f5eab53b6c596da66bc7b30fa`), `private.queue_subject_transfer_notices_v1` (`341a5dcd5f5d4dd8592efe4d4cc487eb`), the notice-kind check as `20261122100000` widened it (`13f8b2c8222dfff225325f6b0bb152c5`), the queue's insert trigger function (`689008df933e852391c20f6e8b3afd4a`) and recipient check (`e0728613189f2cbdfa05029c962767a5`), the terminal mail worker's claim (`3524eba4d0dd916bef2c4dac1e5c25cb`) and authorize (`5ba9fd2ef4bfa2c36ec0e2be4b97aeb5`) doors, `public.export_archive_cleanup_v1` (`25fa3ce71b73fb0c371d1bb9af836bd7`), `private.end_other_adult_held_upload_v1` (`0d5e9e5784297e1a1cb77aacfbe54a43`), `private.legal_audit_actor_principal_v1` (`7d74f4fc739c03a14c928b5c529ca83a`), `private.delete_pair_derived_rows_v1` (`8a094ce1d0a7ff92e00260204008dc07`) and the relocation worker's six service doors (`subject_transfer_relocation_work_v1` `b41281a0b8093cb6b08088d43b024404`, `claim_subject_transfer_relocation_v1` `b372f540becd7d760fefcc31b36338d6`, `swap_subject_transfer_relocation_v1` `bc2a13cbc7522274795eba64ac24c87d`, `fence_subject_transfer_relocation_v1` `df65b2547b006b73029821bed37eaf63`, `claim_subject_transfer_retirement_v1` `cfc2104768e444abd345e714a148d3d3`, `finish_subject_transfer_retirement_v1` `dba5d0a0e592ff7d34d38dc2ff11c566`). Any difference, or a switch that already answers true, refuses the whole migration (55000 `subject transfer open prerequisite differs`) before anything changes; the postflight asserts the new body, its ACL and that it answers true (55000 `subject transfer open successor differs`).
- No table, column, index, trigger, check, policy or grant changes. Fingerprint effect: 1 `def_md5` changes.

## Which releases must come first

1. Release 2 for the transfer and its switch (`20261016221000`); release 1 for the terminal-notice queue (`20260906053451`) and the export cleanup door (`20260923123240`).
2. In this release, `20261119160000`, `20261120120000`, `20261120130000` and `20261122100000` (every body it pins), in file order. Locally it was applied forward to the shared database after `20261122110000` (above) and recorded in `supabase_migrations.schema_migrations` as one statement whose text is the file's (md5 `79167f038f8caec65ece98340bd0c05f`, equal to the file's).

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.subject_transfer_open_v1()','c4b160e966711cf513e267673c4b5e2f','{postgres=X/postgres}'),
   ('public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','0fb41099ef95025c011084190ed1555f','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)','c00c31ee8ba5848c95ea4b2384d07e61','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.other_adult_withdrawal_readiness_v1(uuid,uuid)','29f041df82ed5defc7d4cc48fcb12e0f','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','e481de5f5eab53b6c596da66bc7b30fa','{postgres=X/postgres}'),
   ('private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])','341a5dcd5f5d4dd8592efe4d4cc487eb','{postgres=X/postgres}'),
   ('private.enqueue_invitation_terminal_notice_v1()','689008df933e852391c20f6e8b3afd4a','{postgres=X/postgres}'),
   ('private.invitation_notice_recipient_current_v1(uuid)','e0728613189f2cbdfa05029c962767a5','{postgres=X/postgres}'),
   ('public.claim_invitation_terminal_mail_v1()','3524eba4d0dd916bef2c4dac1e5c25cb','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.authorize_invitation_terminal_mail_v1(uuid,smallint)','5ba9fd2ef4bfa2c36ec0e2be4b97aeb5','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)','25fa3ce71b73fb0c371d1bb9af836bd7','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.end_other_adult_held_upload_v1(uuid,text)','0d5e9e5784297e1a1cb77aacfbe54a43','{postgres=X/postgres}'),
   ('private.legal_audit_actor_principal_v1(text,text)','7d74f4fc739c03a14c928b5c529ca83a','{postgres=X/postgres}'),
   ('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)','8a094ce1d0a7ff92e00260204008dc07','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.subject_transfer_relocation_work_v1(boolean)','b41281a0b8093cb6b08088d43b024404','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.claim_subject_transfer_relocation_v1(uuid,text,boolean)','b372f540becd7d760fefcc31b36338d6','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.swap_subject_transfer_relocation_v1(uuid,text,uuid,bigint,text,boolean)','bc2a13cbc7522274795eba64ac24c87d','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.fence_subject_transfer_relocation_v1(uuid,text,boolean)','df65b2547b006b73029821bed37eaf63','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.claim_subject_transfer_retirement_v1(uuid,text,boolean)','cfc2104768e444abd345e714a148d3d3','{postgres=X/postgres,service_role=X/postgres}'),
   ('public.finish_subject_transfer_retirement_v1(uuid,text,boolean)','dba5d0a0e592ff7d34d38dc2ff11c566','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_20_bodies_as_reviewed,
 (select private.subject_transfer_open_v1()) as must_be_false_transfer_switch,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.invitation_terminal_notices'::regclass
   and c.conname='invitation_terminal_notices_notice_kind_check' and c.contype='c' and c.convalidated)
   ='13f8b2c8222dfff225325f6b0bb152c5' as must_be_true_notice_kinds_as_reviewed,
 (select count(*) from public.subjects where subject_class='other_adult' and upload_class='adult' and lifecycle='active'
   and subject_account_id is not null and owner_account_id is distinct from subject_account_id) as context_records_a_transfer_could_reach,
 (select count(*) from public.subjects where ownership_transferred_at is not null) as context_transferred_records,
 (select count(*) from private.invitation_terminal_notices where notice_kind like 'subject-transfer-%' or notice_kind like 'withdrawal-transfer-%')
   as context_transfer_notices,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, with the switch put back to its closed body inside a rolled-back transaction (the shared database already holds this migration), every `must_be_*` held (20, false, true); after the apply the same query reads 19 (the switch is the body that changed), true, true. The pinned md5s are recomputed from source by `scripts/subject-transfer-open-migration.test.ts` (those `20261122100000` patched by replaying its patches; those several migrations wrote, traced to the md5 the last of them asserts). No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. `context_records_a_transfer_could_reach` read 14 locally (left by browser runs) and is expected to be 0 in production; the other two context counts read 0.

## Locks and duration

`create or replace function` on one SQL function: catalog work only, no table lock; the predecessor and postflight read the catalog and call the switch once each. Measured locally inside a rolled-back transaction, with the switch first put back to its closed body: 8 to 12 ms, both checks included. Every call that starts after the commit reads the new body (the pgTAP suites replace the switch inside their own transactions and see the new answer at once).

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed (the expected order).** The switch is open, so the person's door transfers, the uploader's card (already deployed with `20261122100000`'s code) reads `hand-over` and shows the approved hand-over strings, and the withdrawal hands the record over. The notices are queued and the deployed mail worker sends them with the words deployed before this change: the two emails to the person who now holds the record lack the added line and say nothing about download copies; every other string is as approved. (The code of `20261122100000`, which knows the five kinds, ships before this migration is applied.)
- **Code deployed, migration not yet applied.** The emails carry the added line, but nothing queues them: the switch is closed, the doors refuse as before, and the card reads `account-held` and offers nothing. Nothing changes.
- **Both.** As approved. In production Path B is not open, so none of this is reachable in any window.

## Production reachability

Nothing opens in production, for three independent reasons. (1) Production's database does not hold the transfer at all: on 20 November its migration ledger, read through the Supabase connector, stopped at `20261011010251` (`docs/protocol/decisions.md`, "PR 324's release: the Supabase connector reads production, and what it cannot carry"), before `20261016221000` and every later release; this migration reaches it only through the guarded release, after releases 1 and 2 and this release's earlier migrations. (2) A record either act can reach must be a confirmed Path B record (`adult_subject_drafts.adult_flow` one of the two Path B flows, state `confirmed`, checked by `private.transfer_subject_v1`), and Path B is created only under the test jurisdiction: `otherAdultUploadAvailable` requires `INHERIT_TEST_JURISDICTION=1` and the `third_party_adult_analysis` capability, which no real jurisdiction permits, and `next.config.ts` refuses to build a production deployment with `INHERIT_TEST_JURISDICTION=1`. (3) The relocation worker's doors refuse outside TEST-LOCAL (`p_test_jurisdiction`). The pre-check's `context_records_a_transfer_could_reach` is the receipt for (2) on the day of the release.

## What a person sees

Only under the test jurisdiction. The uploader's card for a person who holds the record with their own account says the record becomes theirs; the confirmation lists what moves, what is deleted and what the uploader loses; the receipt says the record is now theirs. The emails go to the person who now holds the record, to the uploader, and to any other account whose permission or link on the record ended (none in practice: no door lets a Path B person share with a third account). The person's own move has a route (`api.subject-transfer`) and no page yet: no page renders its one-time code.

## Checked before the line was added

- Every download copy that holds the record stops, the person's own included (`supabase/tests/subject_transfer_open.sql`): the export of the record is stopped through the cleanup door and revoked, and every whole-account export the record is part of (the person's, the uploader's, and another account's that holds its link to the record) fails `private.export_archive_current_v1`, which every open and every chunk of a copy runs, because the record's row changed; live download sessions of the record, its files or its exports are revoked.
- **Not true with this migration alone: "You can make a new one."** After either act, the export authority refuses the person a new export of the record and of their whole account (42501 from `private.path_b_person_v1`, reached through `private.export_account_path_b_file_v1`, which still reads the record's files as Path B files once the person owns them), before and after the relocation worker swaps the file; "Download your data" (`GET /api/export`) lists none of the record's files either (D-162). `20261122160000` (below) makes the sentence true; the two land in this release together. The approved wording is unchanged.

## Browser runs (local, this container)

See the test-diff register entry drafted with this change for the runs against one production build of this change, with this migration applied forward to the shared local database.

# Release notes: `20261122130000_file_delete_live_exports_only.sql` (D-152, both halves)

Local work only. Nothing here was run against production or any hosted database. Two owner decisions of 22 November 2026 (`docs/protocol/decisions.md`) close D-152 (`docs/protocol/defects.md`):

- "Only a live download copy blocks deleting a single file": deleting one file from Files (`api.file-delete`) was refused for good while the record had any download copy the self emptying had not retired, expired, failed and ended ones included. Now only a live copy blocks.
- "Withdrawing consent for one's own file ends a finished download copy too": the own-file withdrawal ended the account's whole-account copies only while queued or building, so a finished (READY) one that includes the file stayed READY. Now it ends at once too.

## What it changes

Two bodies, each patched once in place, md5-guarded, one anchor per patch, successor md5 and unchanged ACL asserted.

- `private.prepare_genome_file_deletion_body_v1`, the per-file guard (`c78d66691786e656a063b2dfe7b78a28` → `9753a5d9d38d09f6b17664826247f070`, `{postgres=X/postgres}`). Only the export clause changes. A copy of the record (a `public.generated_exports` row whose target is the record, `target_kind='subject'`, from either door that makes one: the record's own export, `api.subject-export`, or an approved claimant's, `api.future-person-export`) blocks the file shortcut (`file_delete_shared_graph`, the route's 409 `file_delete_subject_unavailable`) only while it is live: it has its job (`private.export_archive_jobs`), the job's deadline is ahead, and it is `queued` or `building` (being made) or `ready` with `expires_at` ahead (downloadable). A `failed`, `revoked`, `expired` or `purged` copy, any copy past its job's deadline, a READY copy past its expiry and a row with no job no longer block. Before (D-144), every copy blocked unless it was `revoked` with no attempt still `writing` or `bytes_complete`.
- `private.empty_self_subject_v1`, the self emptying the own-file withdrawal runs (`5c35b1a9eafbfe7fd3e16f54b648dee7` → `768b5433d639f9c8578fbd59a5a0d703`, `{postgres=X/postgres}`). Before the record's own copies end (D-144) and before the files are prepared, every whole-account copy of the account (`target_kind='account'`, `target_id` the account) whose parts (`subject_partitions`) include the record and that is `queued`, `building` or `ready` is locked; each of its attempts still `writing` or `bytes_complete` is stopped through `public.export_archive_cleanup_v1('stop')` (objects queued for disposal behind the attempt's own fence, the lease plus 30 seconds; its download rows revoked; a READY completion cleared; a worker refused at its next step), as D-144 ends the record's copies and D-151 a transferred record's; then the copy is `revoked`, and any `download_sessions` row bound to it (`target_kind='export'`, the legacy form) is revoked. The old statement that revoked the account's `queued` or `building` copies by status alone stays, after it, unchanged. A copy whose parts do not include the record, and a failed or already revoked one, is not touched by the new step. Nothing is deleted; the audit event and its payload are unchanged.
- Where "live" is read from, each door pinned and not changed:
  - `private.export_archive_current_v1` (`707ebdae8b497640dafeb37e666d01f6`), which every worker step, poll, open and chunk read runs, refuses a copy with no job, in any status but `queued`, `building` or `ready`, or past its job's deadline;
  - opening a READY copy is refused at or past `expires_at`: `public.export_archive_request_v1` 'open-ready' (`f22a82e34511040aab5f8b8f68f671d0`) and `private.future_person_ready_export_v1` (body `b46d1c068bf5d0121187fc76d00fee27`); a download session never outlives its copy;
  - every READY chunk issue and acknowledgement passes `private.account_archive_r2_completed_context_v1` (body `34ecde85fc7566b3f775ce953834a092`), which refuses past `expires_at` or the deadline, and a copy no longer READY; completion sets `expires_at` no later than the deadline;
  - the legacy session authorizer `private.download_target_authorized_v1` (`23296f5b259f177732c47a43bf4ef20f`) needs READY and `expires_at` ahead; only `private.authorize_download_range_v1` calls it, nothing calls that, and the `private` schema is not exposed by the API;
  - nothing turns a copy live again: the only status writes are `building` (begin, from queued or building), `ready` (completion, from building), `failed` (the cleanup door's stop) and `revoked`; no statement moves a job's deadline; `expires_at` is written only by completion and cleared by the stop (`scripts/file-delete-live-exports-migration.test.ts` lists every such write in every migration).
  - Two of these are pinned by their body (`md5(prosrc)`), because their headers print table types the search path qualifies or not; the two patched bodies and the other doors are pinned by `pg_get_functiondef`, whose headers print no `public` or `private` type.
- Also pinned, not changed: `public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)` (`25fa3ce71b73fb0c371d1bb9af836bd7`, `{postgres=X/postgres,service_role=X/postgres}`), unchanged since `20260923123240`, which the emptying calls; and `private.own_export_source_v1` (`27abc582be0eb4a227a7cdeb57c29d6f`), which the race rests on.
- The race (no lock added or reordered): every door of an account's own copies, of a record or of the whole account, reaches `private.own_export_source_v1` through the currentness check. It locks the account's profile row FOR UPDATE, the row the guard locks first, so creating, building, completing, opening or reading a copy is serialised with preparing and finishing a file deletion on the same account. A copy committed first is seen by the guard and, while live, refuses the deletion. Once a deletion is prepared, the file's stored object is `purge_queued`, `own_export_source_v1` answers null for it and every capture refuses (55000 `export_source_unavailable`), so no copy of the record or of the account can start while the file waits for its finish; the finish runs the guard again; and no copy the guard read as not live can become live. A copy started after the check therefore never includes a file being deleted. An approved claimant's copy is of a record whose one file no account holds, so it never meets this guard's file.
- Mid-download: an ended copy's download rows are revoked and the delivery, issue and acknowledgement of every chunk refuse it (`42501`). A chunk issue holds the copy's row lock through its storage read, so a withdrawal arriving then waits for that one chunk's issue to commit; that chunk may finish streaming, its acknowledgement is refused, and no further chunk is issued.
- A whole-account copy is not read by the guard, before or after (see "For the owner").
- No table, column, constraint, trigger, grant, function, audit event, route or wording changes. Fingerprint effect: 2 `def_md5` change; `functions` row count and `tables` unchanged.

## Which releases must come first

1. The migrations that last defined the pinned doors and the two bodies' base: `20260831224124`, `20260909001117`, `20260923123240`, `20261016181000`, `20261016196000` and `20261016211000`, all in earlier releases.
2. In this release, `20261120100000` (D-144), whose successors of the guard and the emptying are this migration's patch predecessors. Applied before it, this migration refuses (55000 `file delete live exports prerequisite differs`) and changes nothing. No migration pins either body at D-144's successor (`20261120110000` neither calls nor pins the guard; `20261119150000` pins their earlier bodies and runs before D-144), so nothing in the release refuses because this one ran.
3. The 22 November migrations (`20261122100000`, and the locally recorded `20261122110000` and `20261122120000`) patch none of what it pins, in any order. Locally it was applied forward to the shared database after `20261122120000`, in one transaction, and recorded in `supabase_migrations.schema_migrations` with the file's text as its one statement. (An earlier local version of this migration, the guard's patch alone, was applied the same way; it was undone in one transaction, each body checked back to its predecessor md5, its history row removed, and this version applied and recorded in the same transaction.)

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.prepare_genome_file_deletion_body_v1(uuid,uuid)','def','c78d66691786e656a063b2dfe7b78a28','{postgres=X/postgres}'),
   ('private.empty_self_subject_v1(uuid,uuid)','def','5c35b1a9eafbfe7fd3e16f54b648dee7','{postgres=X/postgres}'),
   ('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)','def','25fa3ce71b73fb0c371d1bb9af836bd7','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.export_archive_current_v1(uuid,text)','def','707ebdae8b497640dafeb37e666d01f6','{postgres=X/postgres}'),
   ('public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)','def','f22a82e34511040aab5f8b8f68f671d0','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.future_person_ready_export_v1(text,uuid,text)','src','b46d1c068bf5d0121187fc76d00fee27','{postgres=X/postgres}'),
   ('private.account_archive_r2_completed_context_v1(uuid,text,boolean)','src','34ecde85fc7566b3f775ce953834a092','{postgres=X/postgres}'),
   ('private.download_target_authorized_v1(uuid,text,uuid,text,bigint,bigint)','def','23296f5b259f177732c47a43bf4ef20f','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.own_export_source_v1(uuid,uuid,uuid)','def','27abc582be0eb4a227a7cdeb57c29d6f','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,kind,body,acl) on p.oid=to_regprocedure(x.signature)
   and (case x.kind when 'def' then md5(pg_get_functiondef(p.oid)) else md5(p.prosrc) end)=x.body
   and p.proacl::text=x.acl) as must_be_9_bodies_as_reviewed,
 (select count(*) from pg_class where oid=to_regclass('private.export_archive_jobs')) as must_be_1_job_table,
 (select count(*) from public.generated_exports e join public.subjects s on s.id=e.target_id
   where e.target_kind='subject' and s.subject_class='self') as context_self_record_copies,
 (select count(*) from public.generated_exports e join public.subjects s on s.id=e.target_id
   join private.export_archive_jobs j on j.export_id=e.id
   where e.target_kind='subject' and s.subject_class='self' and j.deadline>clock_timestamp()
    and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp()))) as context_live_self_record_copies,
 (select count(*) from public.generated_exports e left join private.export_archive_jobs j on j.export_id=e.id
   where e.target_kind='subject' and j.export_id is null and e.status in ('queued','building')) as context_jobless_copies_being_made,
 (select count(*) from public.generated_exports where target_kind='account' and status='ready') as context_ready_account_copies,
 (select count(*) from private.genome_file_deletions) as context_pending_file_deletions,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, on the predecessor state rebuilt inside a rolled-back transaction (both patches undone on the live bodies, each md5 checked back to its predecessor): `must_be_9_bodies_as_reviewed` 9, `must_be_1_job_table` 1 and every `context_*` count 0, under the default search path and under `search_path=''` alike; the md5s are also recomputed from source by `scripts/file-delete-live-exports-migration.test.ts`. The counts say how many records the change reaches at once: `context_self_record_copies` is every self record with a copy, `context_live_self_record_copies` those whose files would still be refused, `context_jobless_copies_being_made` legacy rows that blocked before and no longer do, `context_ready_account_copies` the finished whole-account copies a withdrawal would now end. `api.subject-export` and `api.export` answer 503 before they create anything unless a generation capability is configured, and only the TEST one exists (`approvedAccountArchiveGeneration()` returns null), so all are expected to be 0 in production.

## Locks and duration

Catalog work only: two `create or replace function` statements run from the patch block, and catalog reads. No lock on any table (checked: the session held only `AccessShareLock` on `pg_proc` and its indexes and `RowExclusiveLock` on `pg_proc`'s TOAST relation and index). Measured locally inside rolled-back transactions: 7 to 12 ms in four runs, the predecessor checks and postflight included. At run time the guard reads the job of each copy of the record under the locks it already holds and takes no new lock; the emptying additionally locks the account's whole-account copies that include the record, in id order, then each job and attempt it stops, in the order every export worker and the cleanup sweep take them (export, job, attempt), after the subject it already holds and before the record's own copies.

## Deployed code between apply and deploy

This migration ships no application code and changes no route, page or string, so either order gives the same two windows, and the deployed code of either side behaves the same in each:

- **Migration not yet applied.** As before: one file is refused while the record has any copy the emptying has not retired; the withdrawal revokes the account's queued or building whole-account copies and leaves a READY one READY.
- **Migration applied.** One file is refused only while a copy of the record is live. The withdrawal also ends every READY whole-account copy that includes the record. Every other answer of `api.file-delete` and of the withdrawal is unchanged.

## What a person sees

Nothing changes in production, where no copy of a person's record or account exists (exports are made only in test mode; the `context_*` counts are expected to be 0). Under the test jurisdiction: a person whose record has only an expired, failed or ended copy can now delete one file from Files; while a copy is being made or can still be downloaded, Delete still answers "This file cannot be deleted here. It was not deleted." That sentence gives no reason, so it stays true. A person who withdraws consent for their own file now also loses any finished whole-account copy, as the confirmation already says: "Any copy of your record we prepared for you to download. Its download link stops working." No wording changed.

## For the owner (not changed here)

- A live whole-account copy does not block deleting one file, before or after this migration, and deleting the file then stops that copy: its currentness check refuses while the file waits for its finish (55000 `export_source_unavailable`) and after it (42501 `not_found`), so it cannot be built further or opened, and an open download of it serves nothing more. `supabase/tests/file_delete_live_exports_only.sql` shows it for a queued and an opened READY whole-account copy. Unlike the withdrawal, the single-file deletion does not end the copy (it stays READY and its objects wait for the deadline sweep). Whether a live whole-account copy should block deleting one file, like the record's own, or be ended by it, is not decided.
- Found while building the second half: before this migration, a READY whole-account copy already stopped serving after the withdrawal, for the same reason (its capture no longer matched once the record's files were prepared), but it stayed READY, its download rows and any legacy download session stayed active, and its stored objects waited for the deadline sweep. `supabase/tests/self_withdrawal_ends_finished_copies.sql`, run on the predecessor state, shows exactly that (the refusals come as 55000 `export_source_unavailable` instead of 42501, the row stays READY). Now the copy is ended explicitly and its objects are queued for disposal at once.
- Read from the code, not exercised concurrently: a capture takes the record's `subjects` row FOR SHARE before the profile, the deletion the profile before the record. When both run at once on one account the capture waits at most its 250 ms lock timeout and is refused (55P03); it never makes a copy with a file being deleted.

## Browser runs

None. No browser spec deletes a single file while the record has a copy, or withdraws while a copy exists: the browser suite has no generation capability (`e2e/subject-export.spec.ts` asserts no copy is made), and `e2e/file-deletion.spec.ts`, `e2e/own-file-controls.spec.ts` and the withdrawal specs make none. The two pgTAP suites above drive every state through the database's doors.

# Release notes: `20261122140000_adult_acceptance_inviter_archive_reads.sql`

Local work only. Nothing here was run against production or any hosted database. D-156 (`docs/protocol/defects.md`), owner decision of 22 November 2026, "The 72-hour hold covers an inviter's reads of the invited adult's own record" (`docs/protocol/decisions.md`): during either window the inviter sees nothing the adult shares with them. `20261122110000` (above) held the Family readers and Copilot; this migration holds the third read of what the adult shares, the inviter's own account archive. Through `export.share-link` and `raw.export` the native complete archive carries another person's saved reports, scores, ancestry and raw genotypes; for the held inviter it now answers exactly as when the adult has granted them nothing. The native complete archive runs only while `private.account_archive_r2_configuration` is enabled (the TEST archive, off by default and off in production), and Path A's own-account acceptance is reached only under the test jurisdiction: in production no acceptance clock exists and no archive meets one.

## What it changes

- No new function. Four bodies of the native complete archive (`20261010190500`) patched in place under the md5-guarded convention (the exact predecessor md5 and ACL `{postgres=X/postgres}`, one anchor each, the successor md5 and unchanged ACL, volatility and owner asserted, 55000 otherwise). Each asks `private.adult_acceptance_inviter_held_v1(account, record)` (unchanged; pinned at `bd8cde3a947a35f7ae07d24175418515`) at its existing grant checkpoint:
  - `private.account_archive_complete_subjects_v1(jsonb)` (`43920b19954c11add72cf3a2949cdaa1` → `f63e4c494c07b5c2055a6570df1f4a13`): the adult's record is not listed through its grants to the inviter. A record listed by another link (the inviter's own, one the inviter owns, an embryo cohort, a family pair) is still listed, as it would be with no grant.
  - `private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)` (`5ee7f9ac82e3bb982e213f675bdb2e43` → `6982e98c2b441d2e7eda98eabd5a002d`): a listed record the inviter is held from has no live export permission: `excluded`, reason `export-recipient-consent-required`, no raw authority, as with none. This is the case of a family pair: when either person's Portrait choice lists the adult's record, its member counts appear as excluded, exactly as for a pair with no grant from the adult.
  - `private.account_archive_export_recipient_v1(jsonb,uuid)` (`26872ed747d7fd37b3824d61a7fa563d` → `8ca5bc23ad2ae076b417ef39f414dd99`) and `private.account_archive_raw_authority_v1(jsonb,uuid)` (`13ee8d5c3055d3dd2aef841fb14060ed` → `4100fff709c7e10d486d135b5f418a6d`): 42501 `not_found`, the answer each gives when no grant is found. The member census and every member page (through `private.account_archive_complete_member_rows_v1` and its related science rows) re-ask the recipient authority; the raw file inventory, raw file rows, originals and prepared members (through `private.account_archive_raw_source_v1`) re-ask the raw authority.
- **An archive already queued, building or ready when a hold or a due reminder starts.** Nothing is added for it: the archive's own currentness rule already refuses it. The archive's authority receipt is the digest of the whole capture (`private.account_archive_complete_capture_v1`: its record list, every record's authority, the censuses and the files). Every build call (`public.export_archive_account_complete_v1`) recomputes the capture and refuses a different one; the status check, the download opening (`public.export_archive_request_v1` `check` and `open-ready`), readiness and completion (`private.account_archive_test_ready_v1`, `private.complete_test_account_archive_v1`), delivery (`private.account_archive_test_delivery_context_v1`, `…_download_context_v1`), every manifest page (`private.account_archive_test_manifest_page_v1`) and every chunk (`private.current_account_archive_test_object_v1`, asked before and again after the stored bytes are read, then `private.issue_account_archive_test_chunk_v1` and `private.ack_account_archive_test_chunk_v1`) recompute it through `private.export_archive_current_v1`, which answers 42501 `not_found` when the receipt no longer matches. A capture made while the adult's export was permitted (the 30-day window starts after such an archive could have been made) no longer matches while the inviter is held, so that archive can neither finish nor be downloaded: no chunk leaves the server during the window. Once the reminder is accepted the same capture is current again, byte for byte, and the same archive builds and downloads with no job run. Only a chunk whose last check (the issue) passed before the boundary is still sent.
- **Unchanged.** The preserved account export (the native archive off) reads nothing another account shares: it refuses any account holding a live recipient grant (0A000 `export_partition_projection_unavailable`), held or not. The inviter's own class of grants received (`directional_grants` in the account's class census and rows) still counts the adult's grants to them: those rows carry no purpose and name no record, and the pgTAP suite proves they are the one difference from an archive with no grant. The adult's own archive, and every other recipient's, are unchanged.
- No table, column, constraint, trigger, grant, queue, job or wording changes. Fingerprint effect: 4 `def_md5` values change; the `functions` and `tables` counts are unchanged.

## Which releases must come first

1. `20261010190500_account_archive_complete.sql`, carried by the PR 323 guarded apply (`docs/evidence/pr323-production-apply-20261016/`): the four bodies this migration patches, at the predecessor md5s above. No later migration patches them, and the production fingerprint recorded after that apply (`results/run-2026-10-22/fp-after-merge.json`) carries all four.
2. `20261122110000` (above): the question it asks. Without it the predecessor block refuses (55000, `adult acceptance inviter archive reads prerequisite differs`).
3. This migration. It does not touch the objects of `20261122120000` (the record transfer opens) or `20261122130000` (single-file delete), both of the same day; locally it was applied forward after both, which other sessions had already applied, and recorded.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.account_archive_complete_subjects_v1(jsonb)','43920b19954c11add72cf3a2949cdaa1'),
   ('private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)','5ee7f9ac82e3bb982e213f675bdb2e43'),
   ('private.account_archive_export_recipient_v1(jsonb,uuid)','26872ed747d7fd37b3824d61a7fa563d'),
   ('private.account_archive_raw_authority_v1(jsonb,uuid)','13ee8d5c3055d3dd2aef841fb14060ed'),
   ('private.adult_acceptance_inviter_held_v1(uuid,uuid)','bd8cde3a947a35f7ae07d24175418515')
  ) as x(signature,body) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text='{postgres=X/postgres}') as must_be_5_bodies_as_reviewed,
 (select coalesce(bool_or(enabled),false) from private.account_archive_r2_configuration) as context_native_archive_enabled,
 (select count(*) from public.generated_exports where target_kind='account' and status in ('queued','building','ready'))
   as context_open_account_archives,
 (select count(*) from public.subject_invitations i where i.invitation_kind='adult_subject' and i.status='accepted'
   and not exists(select 1 from public.adult_subject_drafts d where d.subject_id=i.target_id)) as context_accepted_path_a_invitations,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, before the forward apply, `must_be_5_bodies_as_reviewed` was 5 (and 1 after the migration, inside a rolled-back transaction: only the question still matches); the context was `false`, 0 and 11. The five md5s are also recomputed from source by `scripts/adult-acceptance-inviter-archive-reads-migration.test.ts`. No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. `context_native_archive_enabled` is expected to be `false` and both counts 0 in production; with the native archive off nothing this migration patches is reached.

## Locks and duration

Catalog work only: four `create or replace function` through `execute`, each taking a lock on its own `pg_proc` row; no table is locked or scanned. Measured locally inside a rolled-back transaction: about 15 ms, the pre-checks included.

## Deployed code between apply and deploy

No application code changes with this migration: the archive is built, delivered and checked entirely through the database doors above. Applied, every window answers as described; not applied, the archive answers as before. Nothing changes in production, where the native archive is off and no acceptance clock exists.

## What a person sees

Only in test mode, with the TEST archive on. No new wording.

- **The inviter, during either window.** A new account archive covers what the inviter would get if the adult had shared nothing: their own data, records they own, and their own list of grants received (which names no record and no purpose). An archive the inviter requested before the hold or before the 30-day point, not yet finished or ready and not yet downloaded, cannot be finished, opened or downloaded until the clock clears: its status check, its download opening and every chunk are refused as not found, so the settings page shows the export control's existing failure wording and no file is written. When the reminder is accepted the same archive is current again and can be downloaded until it expires; the inviter can also request a new one.
- **The adult, and anyone else the adult shares with.** Nothing changes.

## Pinned tests (local, this container)

`supabase/tests/adult_acceptance_inviter_archive_reads.sql` (36 tests) builds a Path A account acceptance with the adult's own upload and grants of `export.share-link` and `raw.export` to the inviter and to a third account, and drives the archive through the hold, a family pair, the preserved export, the release at 72 hours and the second notice, a real archive requested a minute before 30 days and built, the 30-day boundary (the same archive can no longer be built or delivered), and the reminder (the capture is equal byte for byte and the archive is current again with no job run). `scripts/adult-acceptance-inviter-archive-reads-migration.test.ts` (8) rebuilds the four predecessors and the question from their migrations, recomputes the five pinned md5s and replays each patch to its successor. Every suite that reads the archive or the export doors (102 others) gives the same result with and without this migration. No browser journey drives an archive download during a hold: a held acceptance needs an account created after the invitation and its clocks aged, which the suite does through the same database doors.

# Release notes: `20261122150000_file_delete_live_account_copies.sql` (D-152, follow-up)

Local work only. Nothing here was run against production or any hosted database. Owner decision of 22 November 2026, "Only a live download copy blocks deleting a single file" (`docs/protocol/decisions.md`), as offered and chosen: "A copy that is still being made or can still be downloaded keeps blocking, so nothing in a live download goes missing". `20261122130000` made the guard read only the record's own copies; a whole-account copy whose parts include the record is a download copy of that record too, and deleting one file then made such a live copy unusable (its capture no longer matched), which the decision forbids.

## What it changes

- `private.prepare_genome_file_deletion_body_v1`, the per-file guard (`9753a5d9d38d09f6b17664826247f070` → `da3c101a8a28000656359a91254a6643`, `{postgres=X/postgres}`), one patch in place, md5-guarded, one anchor, successor md5 and unchanged ACL asserted. The record's own clause stays word for word; a second clause follows it: a whole-account copy (`target_kind='account'`, `target_id` the account deleting the file) whose `subject_partitions` include the record blocks the file shortcut while live by the same rule (with its job, before the job's deadline, `queued` or `building`, or `ready` before `expires_at`), with the existing refusal (`file_delete_shared_graph`, the route's 409 `file_delete_subject_unavailable`). A whole-account copy whose parts do not include the record, one of another account, and an expired, failed, revoked or purged one do not block.
- The own-file withdrawal is not blocked: the self emptying (`private.empty_self_subject_v1`, pinned at `768b5433d639f9c8578fbd59a5a0d703`) ends every whole-account copy that includes the record before it prepares the files through this guard.
- The race is unchanged and covers these copies: a whole-account capture, its worker steps, polls, opens and chunk reads reach `private.own_export_source_v1`, which locks the account's profile row FOR UPDATE, the row the guard locks first; once a deletion is prepared every capture of the account refuses (55000 `export_source_unavailable`), and the finish runs the guard again. The pgTAP suite reads, on the live database, the FOR UPDATE row lock a whole-account capture holds on the profile row.
- Pinned, not changed: the emptying; `private.export_archive_current_v1` (`707ebdae8b497640dafeb37e666d01f6`); `public.export_archive_request_v1` (`f22a82e34511040aab5f8b8f68f671d0`); `private.account_archive_r2_completed_context_v1` (body `34ecde85fc7566b3f775ce953834a092`; its header prints a table type); `private.own_export_source_v1` (`27abc582be0eb4a227a7cdeb57c29d6f`). It pins nothing `20261122120000` or `20261122140000` changes.
- The register's `file-delete-v1.subjectUnavailable.when` names the account's copies inside its existing `registered-2026-11-22-D-152` mark. No table, column, constraint, trigger, grant, function, audit event, route or wording changes. Fingerprint effect: 1 `def_md5` changes.

## Which releases must come first

`20261122130000` (D-152), whose successor of the guard is this patch's predecessor; applied before it, this migration refuses (55000 `file delete live account copies prerequisite differs`) and changes nothing. Any order against `20261122120000` and `20261122140000`. Locally it was applied forward to the shared database after `20261122140000`, in one transaction, and recorded with the file's text as its one statement.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.prepare_genome_file_deletion_body_v1(uuid,uuid)','def','9753a5d9d38d09f6b17664826247f070','{postgres=X/postgres}'),
   ('private.empty_self_subject_v1(uuid,uuid)','def','768b5433d639f9c8578fbd59a5a0d703','{postgres=X/postgres}'),
   ('private.export_archive_current_v1(uuid,text)','def','707ebdae8b497640dafeb37e666d01f6','{postgres=X/postgres}'),
   ('public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)','def','f22a82e34511040aab5f8b8f68f671d0','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.account_archive_r2_completed_context_v1(uuid,text,boolean)','src','34ecde85fc7566b3f775ce953834a092','{postgres=X/postgres}'),
   ('private.own_export_source_v1(uuid,uuid,uuid)','def','27abc582be0eb4a227a7cdeb57c29d6f','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,kind,body,acl) on p.oid=to_regprocedure(x.signature)
   and (case x.kind when 'def' then md5(pg_get_functiondef(p.oid)) else md5(p.prosrc) end)=x.body
   and p.proacl::text=x.acl) as must_be_6_bodies_as_reviewed,
 (select count(*) from pg_class where oid=to_regclass('private.export_archive_jobs')) as must_be_1_job_table,
 (select count(*) from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
   join public.subjects s on s.subject_account_id=e.target_id and s.subject_class='self' and e.subject_partitions @> jsonb_build_array(s.id)
   where e.target_kind='account' and j.deadline>clock_timestamp()
    and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp()))) as context_live_account_copies_with_a_self_record,
 (select count(*) from private.genome_file_deletions) as context_pending_file_deletions,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, before the migration was applied forward: `must_be_6_bodies_as_reviewed` 6, `must_be_1_job_table` 1 and both `context_*` counts 0, under the default search path and under `search_path=''` alike; the md5s are also recomputed from source by `scripts/file-delete-live-account-copies-migration.test.ts`. `context_live_account_copies_with_a_self_record` is how many accounts would now be refused a single-file deletion; `api.export` answers 503 before it creates anything unless a generation capability is configured, and only the TEST one exists, so it is expected to be 0 in production.

## Locks and duration

Catalog work only: one `create or replace function` from the patch block, and catalog reads; the session held only `AccessShareLock` on `pg_proc` and its indexes and `RowExclusiveLock` on `pg_proc`'s TOAST relation and index. Measured locally inside a rolled-back transaction: about 5 ms, the predecessor checks and postflight included. At run time the guard reads the account's whole-account copies and their jobs under the locks it already holds; it takes no new lock.

## Deployed code between apply and deploy

No application code, route, page or string changes, so either order gives the same two windows:

- **Migration not yet applied.** A live whole-account copy does not block deleting one file; the deletion then makes that copy unusable.
- **Migration applied.** A live whole-account copy that includes the record blocks deleting one file of it (409 `file_delete_subject_unavailable`), as the record's own live copy does; the copy keeps working. The withdrawal is unchanged.

## What a person sees

Nothing in production, where no whole-account copy exists. Under the test jurisdiction: while a whole-account copy of a person's account is being made or can still be downloaded, Delete on one of their files answers "This file cannot be deleted here. It was not deleted.", as it does for the record's own copy; once the copy has expired, failed or ended, the file can be deleted. No wording changed.

## Browser runs

None applies: no browser spec deletes a single file while a whole-account copy exists (the browser suite has no generation capability). `supabase/tests/file_delete_live_account_copies.sql` drives every state through the database's doors.

# Release notes: `20261122160000_transferred_record_exports.sql`

Local work only. Nothing here was run against production or any hosted database. Three defect rows and owner decisions of 22 November 2026 (`docs/protocol/defects.md`, `docs/protocol/decisions.md`), all about the transfer that `20261122120000` (above) opens:

- **D-162.** After a transfer (the person's own move, or the uploader's hand-over) the person could make no new export of the record, nor of their whole account, and "Download your data" listed none of its files. The approved new-owner emails say "You can make a new one." This migration makes that true for the e-signature flow (below).
- **D-158**, owner decision "A hand-over refused for now says to try later (D-158)": when the uploader's hand-over is refused at that moment (a file still being validated, a file of an unexpected shape, the person's account gone), the card now says "This cannot be done right now. Nothing was deleted. Try again later." Every other refusal keeps its words.
- **D-159.** The hand-over records `subject.ownership_transferred` on `api.subject-delete`; that pair joins the closed list of person-caused events.

Path B, the only way a transferred record exists, is TEST-LOCAL only; nothing here is reachable in production in any order of apply and deploy (below).

## What it changes

- **Two new read helpers**, `security definer`, `search_path=''`, ACL `{postgres=X/postgres}` (revoked from `public`, `anon`, `authenticated`, `inherit_upload_only` and `service_role`): `private.transferred_export_person_v1(uuid,uuid,uuid)` and `private.transferred_export_confirmation_v1(uuid)`. For a record transferred to the caller they answer what `private.path_b_person_v1` and `private.path_b_subject_v1` answer before a transfer, in the same shape: the person's live session and current account, the record theirs by its one transfer row, the confirmed e-signature request as the uploader's account made it, the person's own active principal, its current contact and its confirmation signature. No uploader identity (`uploaderAccountId` and `uploaderPrincipalId` are null).
- **Five bodies patched in place** under the md5-guarded convention (the exact predecessor md5 and ACL, one anchor per patch, the successor md5 and unchanged ACL asserted, 55000 otherwise):
  - `private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)` (`611957debd6025a4f5c4710a596d67cf` → `583e9efa4a60f086e3875fc40e03f491`, two patches): the per-record and whole-account capture of a Path B record asks the two new helpers when the record is transferred, and finds the request under the account that made it. Every other record reads exactly as before.
  - `private.export_account_path_b_snapshot_v1(jsonb,uuid)` (`4cc6a1afc5be8b0d8163f3c14a6f23e8` → `b9ae87c681a443f9ac3fb1846a69520b`, three patches): for a transferred record, the person's own check, and their saved results read through the transferred reader's own currency check (`private.transferred_report_binding_current_v1`, as `private.path_b_report_results_v1` reads them after a transfer) instead of the uploader-bound report authority; a file without a saved result of the person's is no longer a refusal there (the transfer deleted every other result).
  - `private.own_export_source_v1(uuid,uuid,uuid)` (`27abc582be0eb4a227a7cdeb57c29d6f` → `a8000a6cccd2fce9c2b285ab268ed642`, five patches): a file transferred to the caller is their own source. The person's own principal and the transfer row stand in for the ordinary binding row a Path B record never has. Before the relocation worker's swap the file is read through the exact object the transfer recorded (its relocation row, still queued or copying, the same key, size and hash); after the swap, through its own storage object as before. Its Path B normalization counts. This serves "Download your data" (`own_subject_export_content_v1`) and every other own-source reader.
  - `private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)` (`e481de5f5eab53b6c596da66bc7b30fa` → `0bb151e8b9849da4f6671237efc3d4c4`, three patches): on the uploader's withdrawal only, the three refusals above raise 55000 `hand_over_not_now` instead of 42501 `not_found`. Nothing is written, as before. The person's own act and every other refusal are unchanged.
  - `private.legal_audit_person_event_v1(text,text)` (`73bd0200b7e272bec503eab70499e877` → `f06ad94838f724581b457e800162a6bb`, one patch): adds `('api.subject-delete','subject.ownership_transferred')`.
- Pinned and not changed: `private.export_account_path_b_file_v1` (`71e1c10e7b5410f4cb4b77c7ccc10577`), `private.path_b_person_v1` (`9f0434499b394a5c8ece4151838918e3`), `private.path_b_subject_v1` (`d174a83682e35479797ac7e738a65d79`), `private.transferred_report_binding_current_v1` (`07229b62253f40cc419a32c4b34b1099`) and `private.path_b_account_current_v1` (`6372a00f8c0f10e512a31dcf7455333b`). The predecessor block also refuses if either helper already exists (55000 `transferred record exports prerequisite differs`). The postflight asserts the five successors with their ACLs, and both helpers as `security definer`, `search_path=""` and `{postgres=X/postgres}` (55000 `transferred record exports successor differs`).
- No table, column, constraint, trigger, grant, queue or job changes. Fingerprint effect: 5 `def_md5` values change and the `functions` count rises by 2.
- **App, with this migration.** `api.subject-delete` answers 55000 `hand_over_not_now` with 409 `{"error":"try_later"}` (`hand-over-not-now-v1`, registered); every other refusal is still the opaque 404. The withdrawal client reads that 409 as "not now" only for a hand-over, and the card shows the approved line.

## What it does not cover: a record made from a reviewed permission document

The transfer accepts both Path B flows. A record made from a reviewed permission document (`path-b-reviewed-document`) and confirmed by its person with their own account could not be exported by that person before a transfer, and still cannot after one: the Path B export reads only the e-signature flow (`private.export_account_path_b_file_v1`), and the native archive's gate meets D-154's lookup. Probed locally inside a rolled-back transaction, with the suite's record relabelled as that flow: the per-record and whole-account captures refuse (42501) before and after the person's move, with the complete archive off and on; after the move "Download your data" lists the file. For that flow "You can make a new one." is not true. Drafted as a new defect for the orchestrator; it is not changed here.

## Which releases must come first

1. `20261001039000` (the two export bodies, carried by the PR 323 guarded apply), release 2's `20261016221000` (the transfer and its post-transfer readers) and `20260909001117` (the own-source body as later pinned).
2. In this release, in file order: `20261119170000` (the person-caused event list at `73bd0200…`), `20261122100000` (the transfer at `e481de5f…`), `20261122120000` (the switch), and `20261122130000` and `20261122150000` (above), each of which pins the own-source body at `27abc582…` and does not change it. Apply this migration in the same release as `20261122120000`: without it, the switch is open and the new-owner emails promise a new copy the person cannot make. Locally it was applied forward to the shared database after `20261122140000` and recorded in `supabase_migrations.schema_migrations` as one statement whose text is the file's (md5 `93297ca23d405a7ff4903d4bcf25b30f`, equal to the file's). `20261122150000` was applied to the shared database before this migration; `20261122170000` (below) patches neither a body this migration patches nor one it pins.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','611957debd6025a4f5c4710a596d67cf','{postgres=X/postgres}'),
   ('private.export_account_path_b_snapshot_v1(jsonb,uuid)','4cc6a1afc5be8b0d8163f3c14a6f23e8','{postgres=X/postgres}'),
   ('private.own_export_source_v1(uuid,uuid,uuid)','27abc582be0eb4a227a7cdeb57c29d6f','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','e481de5f5eab53b6c596da66bc7b30fa','{postgres=X/postgres}'),
   ('private.legal_audit_person_event_v1(text,text)','73bd0200b7e272bec503eab70499e877','{postgres=X/postgres}'),
   ('private.export_account_path_b_file_v1(uuid)','71e1c10e7b5410f4cb4b77c7ccc10577','{postgres=X/postgres}'),
   ('private.path_b_person_v1(uuid,uuid,uuid)','9f0434499b394a5c8ece4151838918e3','{postgres=X/postgres}'),
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.transferred_report_binding_current_v1(uuid,uuid)','07229b62253f40cc419a32c4b34b1099','{postgres=X/postgres}'),
   ('private.path_b_account_current_v1(uuid)','6372a00f8c0f10e512a31dcf7455333b','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl) as must_be_10_bodies_as_reviewed,
 (select count(*) from (values (to_regprocedure('private.transferred_export_person_v1(uuid,uuid,uuid)')),
   (to_regprocedure('private.transferred_export_confirmation_v1(uuid)'))) h(oid) where h.oid is not null) as must_be_0_new_helpers,
 (select count(*) from public.subjects where ownership_transferred_at is not null) as context_transferred_records,
 (select count(*) from private.subject_transfer_relocations where state in ('queued','copying')) as context_relocations_not_swapped,
 (select count(*) from public.generated_exports e join public.subjects s on s.id=e.target_id
   where e.target_kind='subject' and s.ownership_transferred_at is not null) as context_exports_of_transferred_records,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, in the predecessor state rebuilt inside a rolled-back transaction (the fourteen patches undone in reverse, each body back at its predecessor md5, the two helpers dropped), every `must_be_*` held (10, 0), under the default search path and under `search_path=''` alike; the same query after the forward apply reads 5 (the five patched bodies no longer match) and 2. The context was 1, 1 and 0: one transfer committed by a browser run of `e2e/other-adult-upload-withdrawal.spec.ts`, its relocation not yet swapped (no relocation worker runs locally). The four predecessor bodies this migration patches and has a single source for, and the two pinned helpers with one source, are recomputed from source by `scripts/transferred-record-exports-migration.test.ts` (the transfer by replaying `20261122100000`'s patches); the others are traced to the md5 the last migration that wrote them asserts. No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. All three context counts are expected to be 0 in production.

## Locks and duration

Catalog work only: two `create function`, five `create or replace function` through `execute` (each locks its own `pg_proc` row), two `revoke`; no table is locked or scanned. Measured locally inside a rolled-back transaction, from the rebuilt predecessor state: about 34 ms, the predecessor and postflight blocks included. Every call that starts after the commit reads the new bodies.

## Deployed code between apply and deploy

- **Migration applied, code not yet deployed (the expected order).** Exports and "Download your data" work for a transferred record at once (database only). The three hand-over refusals answer 55000 `hand_over_not_now`; the deployed route counts 55000 among its refusals and answers the opaque 404, so the deployed card shows "This did not work. Nothing was deleted. Please try again.", as before. The legal audit counts the hand-over's event as the person's. Nothing else changes.
- **Code deployed, migration not yet applied.** The route never meets `hand_over_not_now`, so the card shows the same words as before. If `20261122120000` is applied and this one is not, the person cannot yet make the new copy the emails promise (the reason this migration is in the same release).
- **Both.** As described above. In production Path B is not open, so none of this is reachable in any window.

## Production reachability

Nothing here is reachable in production, for the reasons given for `20261122120000` (above): production's database does not hold the transfer (its ledger stopped at `20261011010251` on 20 November), a transferred record must be a confirmed Path B record, and Path B is created only under the test jurisdiction (`next.config.ts` refuses a production build with `INHERIT_TEST_JURISDICTION=1`). The pre-check's `context_transferred_records` is the receipt on the day of the release.

## What a person sees

Only under the test jurisdiction.

- **The person who now holds the record.** At once after either act they can make a new copy of the record and of their whole account, each with the record in it, and open and read it; "Download your data" lists the record's confirmed file. This holds before and after the relocation worker moves the file. One limit, observed locally and not asserted: a whole-account copy made before the worker's move stops at the move (the account's own file rows change), while a per-record copy made then still works; a new one made after the move works. No code runs the relocation worker today (only its tests call it), so locally a transfer's file is never moved and that window never closes. (A record made from a reviewed permission document is not covered, above.)
- **The uploader who hands the record over, when it cannot be done at that moment.** The card says "This cannot be done right now. Nothing was deleted. Try again later." instead of "This did not work. Nothing was deleted. Please try again." Nothing changed, so they can try again.
- **The former uploader.** Still exports nothing of the record.

## Pinned tests (local, this container)

`supabase/tests/transferred_record_exports.sql` (57 tests) builds a confirmed e-signature record through the real doors and drives the person's own move and the uploader's hand-over. After each act it checks, before and after the relocation worker's swap: both captures, with the TEST complete account archive off and (inside a probe) on, each with the record in it; a new READY copy of each that opens and reads; "Download your data" listing the file through the exact object the transfer recorded, then its new object, with its variants and its check round trip; the former uploader and an outsider refused. It also checks the three D-158 refusals (nothing written) and that the person's own move and every other refusal stay opaque, and the D-159 list. `scripts/transferred-record-exports-migration.test.ts` (10) rebuilds every body it can from source, recomputes the pinned md5s and replays each of the fourteen patches to its asserted successor. Seven database plants (one patch undone each, or the D-158 refusal widened to the person's own act) and nine file plants were each caught and restored. Every other suite that reads the export doors, the own-source reads, the transfer or the audit passes with this migration (the register entry lists them, and the four whose assertions changed with it); each suite that fails on the shared local database fails identically with this migration undone inside its transaction.

## Browser runs (local, this container)

See the test-diff register entry drafted with this change.

# Release notes: `20261122170000_inviter_grants_and_reviewed_document_decision.sql`

Local work only. Nothing here was run against production or any hosted database. Two changes of 22 November 2026, each patched in place under the md5-guarded convention. Neither is reachable in production: Path A's own-account acceptance and both Path B flows need the test jurisdiction (every real jurisdiction is unreviewed for the capabilities that create an adult-subject invitation), so in production no acceptance clock exists, no inviter is held and no Path B record reaches the decision.

1. **D-156, the inviter's class of grants received.** Owner decision of 22 November 2026, "The 72-hour hold covers an inviter's reads of the invited adult's own record" (`docs/protocol/decisions.md`): during either window the inviter sees nothing the adult shares with them. After `20261122140000` the inviter's own account archive still listed the adult's grants in its class of grants received (`directional_grants`): their ids, revisions, status and times, while the Family permissions page shows them as Off. That class now leaves them out.
2. **D-154** (`docs/protocol/defects.md`). The mitigation decision found a Path B acceptance only through a confirmed `path-b-subject-esignature` draft, so a record made from a reviewed permission document (`path-b-reviewed-document`, `20261016190000`) answered `not-found` to its uploader and to its own person at every checkpoint, although the original download authority and the account export gate treat it as Path B. The decision now finds a confirmed draft of either Path B flow.

## What it changes

- No new function. Two bodies patched in place, each with the exact predecessor md5 and ACL `{postgres=X/postgres}`, one anchor, the successor md5 and unchanged ACL, volatility and owner asserted (55000 otherwise):
  - `private.export_account_class_projection_v1(uuid,uuid[],text)` (`d729235af961ceaf364b7127a00a89cb` → `f90fe19ebd711a84f020556cbb46373b`). Its `directional_grants` branch gains one condition: a grant on a record that the reading account is held from, as answered by `private.adult_acceptance_inviter_held_v1(account, record)` (unchanged), is not listed. Every other class, and this class for every account the question does not hold, is unchanged. Every caller inherits it without change: the class inventory (and through it the preserved export's capture), the legacy classes (the legacy capture), the complete archive's class census, source rows and class rows, and the subject and scoped class projections (the one-record export). For the held inviter the native complete archive's capture, and the legacy capture inside it, are now exactly the captures with no grant from the adult. Once the second notice or the reminder is accepted the grants are listed again, with no job run.
  - `private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)` (`91dfb6e4abf766e3da6e5827d4381daf` → `85be478145319e0c69dad7575e262941`, still STABLE SECURITY DEFINER with `search_path=pg_catalog`). The Path B lookup joins a confirmed draft whose `adult_flow` is `path-b-subject-esignature` or `path-b-reviewed-document`. A reviewed-document record now gets the e-signature record's answers at every checkpoint:
    - the 72-hour hold, which releases once the second notice is accepted by the provider;
    - the 30-day re-notice, which releases once the reminder is accepted;
    - for a confirmation with no account, the live 730-day clock and the 30-day boundary;
    - the person's own rights, which never wait, and their own analysis, which waits out the hold;
    - `not-found` for anyone else.

    D-141's clocks already covered these acceptances. The account branch (`private.confirm_path_b_subject_account_core_v1`, pinned) records the origin and starts both clocks for either flow, and both notices go to the person's account. The pgTAP suite proves this through the real doors.
- Pinned, not changed: `private.adult_acceptance_inviter_held_v1` (`bd8cde3a947a35f7ae07d24175418515`), `private.adult_acceptance_clock_state_v1` (`6f566115c807f64e1c2a9413f2669fe1`), `private.confirm_path_b_subject_account_core_v1` (`63c6c510a724cbe747af5db354cb344b`), and the draft table's flow check (constraint md5 `5c8b24f18ac62ac45cd1c1647bdd2466`).
- **Unchanged, and noted for the owner.**
  - The preserved account export (the native archive off) reads nothing another account shares. It refuses any account holding a live recipient grant (0A000 `export_partition_projection_unavailable`, `private.export_account_ordinary_readable_authority_v1`), and it refuses the held inviter as before. With no grant from the adult it would not refuse. That refusal is the one remaining difference from "no grant", and only with the native archive off.
  - The decision is one reader of a Path B record. Several other readers still join only `path-b-subject-esignature`, so a reviewed-document record still does not reach them:
    - the person's choices page and person read (`private.path_b_person_choices_v1`, `private.path_b_person_v1`). Without them the person has no page to share with the uploader, and the uploader's reads stop at the person's own grant;
    - the uploader's shares and report metadata (`private.path_b_uploader_shares_v1`, `private.path_b_report_metadata_v1`);
    - the held files (`private.subject_held_files_v1`);
    - the uploader's one-record Copilot (`private.subject_copilot_authority_v1`);
    - the account export of Path B files (`private.export_account_path_b_file_v1`, `private.export_account_path_b_snapshot_v1`);
    - the held-upload expiry and purged-grant cleanup (`public.expire_due_other_adult_held_uploads_v1`, `private.end_purged_path_b_grants_v1`).
- No table, column, constraint, trigger, grant, queue, job or wording changes. Fingerprint effect: 2 `def_md5` values change; the `functions` and `tables` counts are unchanged.

## Which releases must come first

1. `20261001029000_account_archive_class_inventory.sql`, carried by the PR 323 guarded apply (`docs/evidence/pr323-production-apply-20261016/`). The production fingerprint recorded after that apply (`results/run-2026-10-22/fp-after-merge.json`) carries the class projection at `d729235af961ceaf364b7127a00a89cb`, and no later migration patches it.
2. Release 1 (PR 324) for the reviewed-document flow (`20261016190000`). Release 4 for the decision and the clocks as `20261120120000` left them, and for the question (`20261122110000`). `20261122140000` (above) is not needed by the pre-check, but the releases run in order. Without them the predecessor block refuses (55000, `inviter grants and reviewed document decision prerequisite differs`).
3. This migration. It does not touch the objects of `20261122120000`, `20261122130000` or `20261122150000` (other changes of the same day). Locally it was applied forward after them, which other sessions had already applied, and recorded.

## Read-only pre-checks (one SELECT; the release session and its `search_path`)

Stop unless every `must_be_*` holds.

```sql
select
 (select count(distinct x.signature) from pg_proc p join (values
   ('private.export_account_class_projection_v1(uuid,uuid[],text)','d729235af961ceaf364b7127a00a89cb'),
   ('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','91dfb6e4abf766e3da6e5827d4381daf'),
   ('private.adult_acceptance_inviter_held_v1(uuid,uuid)','bd8cde3a947a35f7ae07d24175418515'),
   ('private.adult_acceptance_clock_state_v1(uuid)','6f566115c807f64e1c2a9413f2669fe1'),
   ('private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)','63c6c510a724cbe747af5db354cb344b')
  ) as x(signature,body) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text='{postgres=X/postgres}') as must_be_5_bodies_as_reviewed,
 (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='public.adult_subject_drafts'::regclass
   and c.conname='adult_subject_drafts_adult_flow_check' and c.contype='c' and c.convalidated)='5c8b24f18ac62ac45cd1c1647bdd2466'
   as must_be_true_draft_flows_as_reviewed,
 (select count(*) from public.directional_grants d join public.purpose_grants g using(grant_id)
   where g.target_kind='subject' and d.status='current' and d.recipient_account_id is not null
    and private.adult_acceptance_inviter_held_v1(d.recipient_account_id,g.target_id)) as context_current_grants_to_held_inviters,
 (select count(*) from public.adult_subject_drafts where adult_flow='path-b-reviewed-document' and state='confirmed')
   as context_confirmed_reviewed_document_records,
 (select count(*) from public.subject_invitations i join public.adult_subject_drafts d on d.subject_id=i.target_id
   and d.adult_flow='path-b-reviewed-document' and d.state='confirmed'
  where i.invitation_kind='adult_subject' and i.status='accepted') as context_accepted_reviewed_document_invitations,
 current_user as context_current_user,
 current_setting('search_path') as context_search_path;
```

Locally, before the forward apply, `must_be_5_bodies_as_reviewed` was 5 and `must_be_true_draft_flows_as_reviewed` true; after the migration, inside a rolled-back transaction, the count was 3 (the question, the clocks and the account core still match). Every `context_*` count was 0.The seven md5s are also recomputed from source by `scripts/inviter-grants-and-reviewed-document-migration.test.ts`. No pinned header prints a `public` or `private` type, so the md5s do not depend on `search_path`. Every `context_*` count is expected to be 0 in production. A non-zero `context_confirmed_reviewed_document_records` means reviewed-document records whose uploader and person this migration moves from `not-found` to the e-signature answers.

## Locks and duration

Catalog work only: two `create or replace function` through `execute`, each taking a lock on its own `pg_proc` row; no table is locked or scanned. Measured locally inside a rolled-back transaction: about 30 ms, the pre-checks included.

## Deployed code between apply and deploy

No application code changes. Every effect is in the two database bodies, so the deployed code reads them as soon as the migration is applied. Nothing changes in production, where no acceptance clock and no Path B record exist.

## What a person sees

Only in test mode. No new wording.

- **The inviter, during either window.** The account export's and archive's list of grants received no longer includes the adult's grants. With the TEST archive on, the whole archive is the one with no grant from the adult. No page shows this list. When a clock clears the grants are listed again.
- **The uploader of a reviewed-document record.** Until now every reader treated the record as not found, whatever its clocks. Now it gets an e-signature record's answers:
  - during the hold, the result pages stop at the hold and the account export leaves the record out;
  - once released, the reads stop only at the person's own grant, and the account export includes the record;
  - from 30 days until the reminder is accepted, the record is held again;
  - with no account, the record opens only while a confirmed file's 730-day clock is live, and never again from 30 days.

  Because the person's choices page still lists only e-signature records (above), a reviewed-document person cannot yet share with the uploader from that page, so the uploader's reads stay at the person's own grant until the person shares through another door.
- **The person on a reviewed-document record.** Their own rights now answer as the person's own rights do on an e-signature record (`subject-own-right-only`, never waiting). Their own analysis waits out the hold.

## Pinned tests (local, this container)

- `supabase/tests/inviter_grants_received.sql` (25 tests). It reads every caller of the class projection for every account in the database (the suite's five and every account other suites and browser runs left behind). It makes each read once with the patched body, and once with the predecessor rebuilt in place and swapped in. During the hold only the held inviter's reads differ, only in the reads of the class of grants received, and they equal the reads with the adult's grants deleted. Once released, nobody's reads differ. From 30 days until the reminder, the class again leaves the grants out.
- `supabase/tests/reviewed_document_decision.sql` (51 tests). It drives one record of each Path B flow through the real doors (the reviewed document uploaded, scanned, read and approved by a named reviewer, then finalized; each request mailed, opened and confirmed) in three cases: an account created after the request, an existing account, and no account. It checks the clocks each acceptance recorded. It shows D-154 with the predecessor swapped in. It then compares the two flows at every checkpoint, for the uploader and the person, through the hold, both notices, the 30-day boundary and the reminder.
- `scripts/inviter-grants-and-reviewed-document-migration.test.ts` (8). It rebuilds both predecessors and the three pinned bodies from the migrations that defined and patched them, recomputes every md5, and replays each patch to its successor. It also checks that the pgTAP suites reverse exactly this migration's anchors.
- `supabase/tests/adult_acceptance_inviter_archive_reads.sql` now asserts that the held inviter's class census is the one with no grant. Its old assertion said the class still counted the adult's two grants.

Before the forward apply, every suite that reads the archive, the exports, the class projection, Path B, the decision or the acceptance clocks (120 suites) was run without this migration and with it applied inside the suite's own transaction. 117 gave identical results both ways; the other three are this change's own suites and the archive suite whose assertion changed, which pass only with it. Twenty suites fail identically with and without it, from the shared local database's state, not from this change. After the forward apply: `inviter_grants_received` 25/25, `reviewed_document_decision` 51/51, `adult_acceptance_inviter_archive_reads` 36/36, `adult_acceptance_hold_and_renotice` 112/112, `path_b_no_account_uploader_gate` 37/37, `adult_acceptance_inviter_reads` 77/77 and `path_b_reviewed_document` 85/85.
