# Release notes: `20261119110000_dropped_bucket_literals_and_guard.sql`

Local work only. Nothing here was run against production or any hosted database.

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

`20261119110000` sorts after all four (`20261024110000`, `20261024220000`, `20261025200000`, `20261025400000`) and touches none of their objects (`account_operation_nonces` and its consumer, `session_csrf_tokens`, the two revoke doors, the adult acceptance body and door), so in database terms the order is free. It cannot ride in follow-up 2's kit, though: that kit pins the migrations tree `be49d283` and its `generate.py --head` refuses any head whose `supabase/migrations` tree differs, which a head carrying this file does. So it needs its own guarded release after follow-up 2's batch 2 reads back EQUAL, with that kit's batch-2 post-state as its pre-state (functions 1,423 / `befdb108…`, tables 268 / `5926d879…`), a ledger of 285 rows / max `20261119110000` after it, and one batch (one migration). Committing this file onto the follow-up branch head before follow-up 2's release runs would make that kit refuse the head it is meant to merge; the owner should decide which commit merges when (the same open point follow-up 2's README records).
