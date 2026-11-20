begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G8.5, api.file-delete (20261120110000_file_delete_operation_nonce.sql;
-- owner decision of 19 November 2026, "G8.5: where the register is stricter,
-- engineering codes to it"). The door records the hash of the one-time value
-- the Files page rendered for this account, session and file, in the same
-- transaction as the deletion's first write and before it: a replayed,
-- expired, foreign or malformed value writes nothing, a refused deletion
-- spends nothing, and the genuine value starts the deletion once.
--
-- Every account, session, file and object is synthetic, and everything rolls
-- back. The route verifies the value's MAC (account, session, operation and
-- file) before it reaches this door (src/lib/person-operation-nonce-core.ts);
-- the hashes here are synthetic.
insert into auth.users(id,email,raw_user_meta_data) values
 ('8e1d0000-0000-4000-8000-000000000001','file-nonce-owner@example.invalid','{}'),
 ('8e1d0000-0000-4000-8000-000000000002','file-nonce-other@example.invalid','{}');
insert into auth.sessions(id,user_id,aal) values
 ('8e1d0000-0000-4000-8000-000000000011','8e1d0000-0000-4000-8000-000000000001','aal1'),
 ('8e1d0000-0000-4000-8000-000000000012','8e1d0000-0000-4000-8000-000000000001','aal1'),
 ('8e1d0000-0000-4000-8000-000000000021','8e1d0000-0000-4000-8000-000000000002','aal1');
insert into storage.buckets(id,name) values('genomes','genomes') on conflict do nothing;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select ('8e1d0000-0000-4000-8000-00000000003'||n)::uuid,owner_account_id,id,
 '8e1d0000-0000-4000-8000-000000000001/synthetic-'||n,'synthetic-'||n||'.txt','array_ancestry',1,1,'annotated'
from public.subjects, generate_series(1,2) n
where owner_account_id='8e1d0000-0000-4000-8000-000000000001' and subject_class='self';
insert into storage.objects(bucket_id,name)
select 'genomes','8e1d0000-0000-4000-8000-000000000001/synthetic-'||n from generate_series(1,2) n;
insert into public.user_variants(user_id,subject_id,file_id,chrom,pos,genotype)
select user_id,subject_id,id,1,100,'AG' from public.genome_files where user_id='8e1d0000-0000-4000-8000-000000000001';

create function pg_temp.owner() returns uuid language sql immutable as $$ select '8e1d0000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.other() returns uuid language sql immutable as $$ select '8e1d0000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.session(n integer) returns uuid language sql immutable as $$
 select (case n when 1 then '8e1d0000-0000-4000-8000-000000000011' when 2 then '8e1d0000-0000-4000-8000-000000000012'
  else '8e1d0000-0000-4000-8000-000000000021' end)::uuid $$;
create function pg_temp.file(n integer) returns uuid language sql immutable as $$ select ('8e1d0000-0000-4000-8000-00000000003'||n)::uuid $$;
create function pg_temp.hash(label text) returns text language sql immutable as $$ select encode(extensions.digest(convert_to(label,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.soon() returns timestamptz language sql as $$ select clock_timestamp()+interval '5 minutes' $$;
create function pg_temp.door(account uuid,session uuid,file uuid,nonce text,expires timestamptz default null) returns jsonb language sql as $$
 select public.prepare_own_prepared_file_cleanup_with_nonce_v1(account,session,file,pg_temp.hash(nonce),coalesce(expires,pg_temp.soon()));
$$;
-- What a refusal must leave as it was: the file readable, no deletion record, its variants.
create function pg_temp.untouched(n integer) returns boolean language sql as $$
 select (select status::text from public.genome_files where id=pg_temp.file(n))='annotated'
  and not exists(select 1 from private.genome_file_deletions where file_id=pg_temp.file(n))
  and (select count(*) from public.user_variants where file_id=pg_temp.file(n))=1;
$$;
create function pg_temp.recorded(nonce text) returns bigint language sql as $$
 select count(*) from public.account_operation_nonces where nonce_hash=pg_temp.hash(nonce);
$$;

-- 1. Who may call it.
select ok(has_function_privilege('service_role','public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)','execute'),
 'the service role may call the door');
select ok(not has_function_privilege(r,'public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)','execute'),
 r||' may not call the door') from unnest(array['anon','authenticated','inherit_upload_only']) r;
select ok(not has_function_privilege(r,'private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)','execute'),
 r||' may not call the recorder') from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r;
select is((select proacl::text from pg_proc where oid='public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','the door''s ACL is exactly owner and service role');

-- 2. Refusals of the value write nothing and spend nothing.
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),'expired',clock_timestamp()-interval '1 second')$$,
 '22023','invalid_operation_nonce','an expired value is refused');
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),'distant',clock_timestamp()+interval '11 minutes')$$,
 '22023','invalid_operation_nonce','an expiry beyond ten minutes is refused');
select throws_ok($$select public.prepare_own_prepared_file_cleanup_with_nonce_v1(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),'not-a-hash',pg_temp.soon())$$,
 '22023','invalid_operation_nonce','a malformed hash is refused');
select throws_ok($$select public.prepare_own_prepared_file_cleanup_with_nonce_v1(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),null,pg_temp.soon())$$,
 '22023','invalid_operation_nonce','no value is refused');
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(3),pg_temp.file(1),'foreign-session')$$,
 '42501','file_delete_unauthorized','a session of another account is refused');
select ok(pg_temp.untouched(1) and pg_temp.untouched(2),'none of the refusals touched either file');
select is((select pg_temp.recorded('expired')+pg_temp.recorded('distant')+pg_temp.recorded('foreign-session')),0::bigint,
 'and none of them recorded a value');

-- 3. A refused deletion rolls the spend back with it; the same value works once the refusal is cleared.
update public.genome_files set status='parsing' where id=pg_temp.file(2);
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(2),'two-first')$$,
 '55000','file_delete_processing','a file still processing is refused');
select is(pg_temp.recorded('two-first'),0::bigint,'the refused deletion spent nothing');
update public.genome_files set status='annotated' where id=pg_temp.file(2);
select throws_ok($$select pg_temp.door(pg_temp.other(),pg_temp.session(3),pg_temp.file(1),'not-yours')$$,
 'P0002','file_delete_not_found','another account''s file is not found');
select is(pg_temp.recorded('not-yours'),0::bigint,'and the not-found refusal spent nothing');
select ok(pg_temp.untouched(1) and pg_temp.untouched(2),'both files are still untouched');

-- 4. The genuine value starts the deletion and is recorded consumed, once, in the same transaction.
create temporary table started as select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),'one') as plan;
select is((select plan->'original'->>'name' from started),'8e1d0000-0000-4000-8000-000000000001/synthetic-1',
 'the door answers the unchanged cleanup plan with the exact database-owned target');
select is((select plan->>'version' from started),'own-prepared-file-cleanup-v1','the plan is the unchanged door''s');
select is((select status::text from public.genome_files where id=pg_temp.file(1)),'failed','the file is unreadable: the deletion started');
select is((select count(*) from private.genome_file_deletions where file_id=pg_temp.file(1)),1::bigint,'its deletion record exists');
select ok(exists(select 1 from public.account_operation_nonces where nonce_hash=pg_temp.hash('one') and account_id=pg_temp.owner()
  and session_id=pg_temp.session(1) and operation='file_delete' and consumed_at is not null),
 'the value is recorded consumed for this account, session and operation');
select is(pg_catalog.current_setting('inherit.legal_audit_actor',true),pg_temp.owner()::text,
 'and its spend names the account as the transaction''s actor');
select ok(pg_temp.untouched(2),'the other file is untouched');

-- 5. Replays: the spent value is refused for the same file and for any other, and writes nothing.
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),'one')$$,
 '22023','invalid_operation_nonce','a replay for the same file is refused');
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(2),'one')$$,
 '22023','invalid_operation_nonce','the spent value is refused for another file');
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(2),pg_temp.file(2),'one')$$,
 '22023','invalid_operation_nonce','and from the account''s other session');
select ok(pg_temp.untouched(2),'none of the replays touched the other file');
select is(pg_temp.recorded('one'),1::bigint,'the value is recorded once');

-- 6. Another operation's spent value is refused here, and this operation's is refused there.
select lives_ok($$select private.consume_account_operation_nonce_v1(pg_temp.owner(),pg_temp.session(1),'consent_revoke',pg_temp.hash('revoke'),pg_temp.soon())$$,
 'a consent revocation spends its own value');
select throws_ok($$select pg_temp.door(pg_temp.owner(),pg_temp.session(1),pg_temp.file(2),'revoke')$$,
 '22023','invalid_operation_nonce','a value another operation spent is refused');
select throws_ok($$select private.consume_account_operation_nonce_v1(pg_temp.owner(),pg_temp.session(1),'consent_revoke',pg_temp.hash('one'),pg_temp.soon())$$,
 '22023','invalid_operation_nonce','a value a file deletion spent is refused by another operation');
select throws_ok($$select private.consume_account_operation_nonce_v1(pg_temp.owner(),pg_temp.session(1),'file_delete',pg_temp.hash('consumer'),pg_temp.soon())$$,
 '22023','invalid_operation_nonce','the account operation consumer does not spend file_delete: only this door does');
select ok(pg_temp.untouched(2),'the other file is still untouched');

-- 7. A fresh value for the other file, from the account's other session, starts its deletion.
select is((select pg_temp.door(pg_temp.owner(),pg_temp.session(2),pg_temp.file(2),'two')->'original'->>'name'),
 '8e1d0000-0000-4000-8000-000000000001/synthetic-2','a fresh value for the other file starts its deletion');
select is((select count(*) from public.account_operation_nonces where operation='file_delete' and account_id=pg_temp.owner()),2::bigint,
 'two deletions, two values');

-- 8. The deletion finishes as before, through the unchanged finish.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name='8e1d0000-0000-4000-8000-000000000001/synthetic-1';
select lives_ok($$select public.finish_genome_file_deletion_v1(pg_temp.owner(),pg_temp.session(1),pg_temp.file(1),
  (select (plan->'original'->>'token')::uuid from started))$$,'the started deletion finishes');
select is((select count(*) from public.genome_files where id=pg_temp.file(1)),0::bigint,'the file is gone');
select is((select count(*) from public.user_variants where file_id=pg_temp.file(1)),0::bigint,'with its variants');

-- 9. The bodies: the wrapped doors unchanged, the consumer unchanged, the check widened.
-- The per-file guard body is not pinned: the door neither calls nor reads it.
select ok((select count(distinct x.s) from pg_proc p join (values
  ('public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)','8b6c62634d64e9058e2c503def867c4d','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)','8f2f2fd4b5d9dd017c5330907b42e137','{postgres=X/postgres,service_role=X/postgres}'),
  ('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','6869593d67ff37d93a6d4caea62f01c3','{postgres=X/postgres}'))
  x(s,m,a) on p.oid=x.s::regprocedure where md5(pg_get_functiondef(p.oid))=x.m and p.proacl::text=x.a)=3,
 'the wrapped doors and the account operation consumer are their reviewed bodies');
select ok(pg_get_constraintdef(c.oid) like '%''file_delete''%' and pg_get_constraintdef(c.oid) like '%''provider_setting_delete''%'
  and pg_get_constraintdef(c.oid) like '%''subject_transfer''%' and pg_get_constraintdef(c.oid) like '%''account_delete''%'
  and pg_get_constraintdef(c.oid) like '%''own_upload_artifact_sign''%' and c.convalidated,
 'the operation check gains file_delete and keeps the ones it held') from pg_constraint c
 where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';

select * from finish();
rollback;
