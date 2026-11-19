begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/embryo_ingest_attempt.inc
-- 20261119110000_dropped_bucket_literals_and_guard.sql. Two dropped buckets
-- leave the bucket checks of the three tables a Storage manifest is built
-- from (D-130; docs/register-contract-divergence.json#allowlistedBucketNotCreated),
-- and three cores refuse a NULL jurisdiction flag (D-140).
--
--   1-2. The checks read as reviewed, refuse 'genomes-staging' and
--        'generated-artifacts', and admit every bucket that exists.
--   3.   The account-deletion manifest for a promoted session, a post-cutover
--        session still in flight, and a legacy session recorded under the
--        dropped bucket.
--   4.   The embryo-unwind manifest for an in-flight and a promoted session.
--   5.   The migration's own blocks, byte for byte (scripts/dropped-bucket-
--        literals-migration.test.ts holds the texts equal): the predecessor
--        block and the tightening block refuse, writing nothing, on every
--        state they must refuse, and apply on the reviewed one.
--   6.   The embryo-unwind manifest for a legacy session: the plan refuses.
--   7.   Each patched guard refuses NULL and false and admits true.
--   8.   The patches cannot be applied twice.
--
-- Every account, session, object name and digest is synthetic, and
-- everything rolls back.

-- ---------------------------------------------------------------------------
-- 1. The migration's state
-- ---------------------------------------------------------------------------
select is((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=x.relation::regclass and c.conname=x.name
  and c.contype='c' and c.convalidated),x.definition,x.name||' admits exactly the buckets that exist') from (values
 ('public.genome_storage_objects','genome_storage_objects_bucket_id_check','CHECK ((bucket_id = ''genomes''::text))'),
 ('public.account_deletion_storage_entries','account_deletion_storage_entries_bucket_id_check',
  'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])))'),
 ('public.embryo_ingest_delete_objects','embryo_ingest_delete_objects_bucket_id_check',
  'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')
) x(relation,name,definition);
select is_empty($$select c.conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace
 where n.nspname in ('public','private') and pg_get_constraintdef(c.oid) like '%generated-artifacts%'$$,
 'no constraint admits generated-artifacts');
select set_eq($$select c.conname::text from pg_constraint c join pg_namespace n on n.oid=c.connamespace
 where n.nspname in ('public','private') and pg_get_constraintdef(c.oid) like '%genomes-staging%'$$,
 array['upload_sessions_storage_bucket_check'],
 'genomes-staging survives only as the bucket a legacy upload session recorded');
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p where p.oid=x.signature::regprocedure),
 x.expected,x.signature||' is its reviewed body with its ACL') from (values
 ('public.claim_due_account_deletion_v1(text,integer)',
  'a67a7a734a1e3bf392f5bdaf40678b6e {postgres=X/postgres,service_role=X/postgres}'),
 ('public.prepare_embryo_ingest_unwind_v1(uuid,bigint)',
  '370cf6155b34299765c50ef2a7fefdbc {postgres=X/postgres,service_role=X/postgres}'),
 ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)',
  '72ea3d6e8b41bfe74d8645259f7cfad7 {postgres=X/postgres}'),
 ('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)',
  'f8f19fa7d430d55b00359703eee53faa {postgres=X/postgres}'),
 ('private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)',
  '4e6272c513d728aa62b5fba27916bcc7 {postgres=X/postgres}')
) x(signature,expected);
select is_empty($$select p.oid::regprocedure::text from pg_proc p where case when p.prokind in ('f','p')
 and 'p_test_jurisdiction'=any(p.proargnames) then pg_get_functiondef(p.oid) ~ 'if not p_test_jurisdiction' else false end$$,
 'no function that takes the jurisdiction flag guards it with not, which a NULL flag passes');

-- ---------------------------------------------------------------------------
-- 2. Each check refuses the dropped buckets and admits every bucket that
-- exists. Foreign keys and the inventory guard are off, so each insert
-- reaches only the checks; the admitted rows are removed again.
-- ---------------------------------------------------------------------------
set local session_replication_role=replica;
select throws_like(format($$insert into public.account_deletion_storage_entries(deletion_id,entry_ordinal,bucket_id,object_name,
 source_kind,source_id) values('7d2b0000-0000-4000-8000-000000000001',1,%L,'x','upload-staging',gen_random_uuid())$$,b),
 '%account_deletion_storage_entries_bucket_id_check%','an account-deletion entry cannot name '||b)
 from unnest(array['genomes-staging','generated-artifacts']) b;
select lives_ok(format($$insert into public.account_deletion_storage_entries(deletion_id,entry_ordinal,bucket_id,object_name,
 source_kind,source_id) values('7d2b0000-0000-4000-8000-000000000001',%s,%L,'x','canonical-source',gen_random_uuid())$$,n,b),
 'an account-deletion entry can still name '||b)
 from unnest(array['genomes','legal-evidence']) with ordinality x(b,n);
select throws_like(format($$insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,
 source_kind,source_id) values('7d2b0000-0000-4000-8000-000000000002',1,%L,'x','upload-staging',gen_random_uuid())$$,b),
 '%embryo_ingest_delete_objects_bucket_id_check%','an embryo-unwind entry cannot name '||b)
 from unnest(array['genomes-staging','generated-artifacts']) b;
select lives_ok(format($$insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,
 source_kind,source_id) values('7d2b0000-0000-4000-8000-000000000002',%s,%L,'x','ingest-fragment',gen_random_uuid())$$,n,b),
 'an embryo-unwind entry can still name '||b)
 from unnest(array['genomes','legal-evidence','inherit-embryo-test']) with ordinality x(b,n);
select throws_like(format($$insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,
 byte_count,object_revision,state) values(gen_random_uuid(),'7d2b0000-0000-4000-8000-00000000000%s',%L,gen_random_uuid(),
 repeat('a',64),1,1,'current')$$,n,b),'%genome_storage_objects_bucket_id_check%','a recorded object cannot name '||b)
 from unnest(array['genomes-staging','generated-artifacts']) with ordinality x(b,n);
select lives_ok($$insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,
 byte_count,object_revision,state) values('7d2b0000-0000-4000-8000-000000000003','7d2b0000-0000-4000-8000-000000000003',
 'genomes',gen_random_uuid(),repeat('a',64),1,1,'current')$$,'a recorded object can still name genomes');
delete from public.account_deletion_storage_entries where deletion_id='7d2b0000-0000-4000-8000-000000000001';
delete from public.embryo_ingest_delete_objects where unwind_id='7d2b0000-0000-4000-8000-000000000002';
delete from public.genome_storage_objects where object_id='7d2b0000-0000-4000-8000-000000000003';
set local session_replication_role=origin;

-- ---------------------------------------------------------------------------
-- 3. The account-deletion manifest, case by case (D-130)
-- ---------------------------------------------------------------------------
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email,email_confirmed_at) values('7d2b0000-0000-4000-8000-000000000101',
 'dropped-bucket-owner@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values('7d2b0000-0000-4000-8000-000000000110',
 '7d2b0000-0000-4000-8000-000000000101',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='7d2b0000-0000-4000-8000-000000000101';
create temporary table own_subject as select id from public.subjects
 where subject_account_id='7d2b0000-0000-4000-8000-000000000101' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select id from own_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select id from own_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

-- Two real, post-cutover sessions: one promoted, one still in flight.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table promoted_upload as select public.issue_own_storage_upload_v1(
 '7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select id from own_subject),'VCF.GZ',8,repeat('a',64)) receipt;
create temporary table inflight_upload as select public.issue_own_storage_upload_v1(
 '7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select id from own_subject),'VCF',8,repeat('b',64)) receipt;
grant select on promoted_upload,inflight_upload,own_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('genomes',(select receipt->>'stagingKey' from promoted_upload),'7d2b0000-0000-4000-8000-000000000101','{"size":8}'),
 ('genomes',(select receipt->>'stagingKey' from inflight_upload),'7d2b0000-0000-4000-8000-000000000101','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select (receipt->>'uploadId')::uuid from promoted_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('7d2b0000-0000-4000-8000-000000000120',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
-- Finalization removes the staging key before it promotes (staging-removed).
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from promoted_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select (receipt->>'uploadId')::uuid from promoted_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '7d2b0000-0000-4000-8000-000000000120',repeat('a',64),repeat('b',64)) receipt;
reset role;
select is((select string_agg(u.status||' '||u.storage_bucket||' '||(u.token_jti is not null),', ' order by u.status)
 from public.upload_sessions u where u.id in ((select (receipt->>'uploadId')::uuid from promoted_upload),
 (select (receipt->>'uploadId')::uuid from inflight_upload))),'promoted genomes true, uploaded genomes true',
 'two post-cutover sessions: one promoted, one uploaded and still in flight, both recorded under genomes');

-- A legacy session: token-less, terminal, recorded under the dropped bucket
-- by the column default 20260906113021 gave it.
insert into public.upload_sessions(id,account_id,auth_session_id,subject_id,staging_object_name,expected_size,expected_sha256,
 content_type,upload_revision,status,created_at,expires_at,consumed_at,storage_bucket)
 values('7d2b0000-0000-4000-8000-000000000130','7d2b0000-0000-4000-8000-000000000101','7d2b0000-0000-4000-8000-000000000110',
 (select id from own_subject),'7d2b0000-0000-4000-8000-000000000131',8,repeat('c',64),'text/plain',1,'expired',
 clock_timestamp()-interval '80 days',clock_timestamp()-interval '80 days'+interval '2 hours',
 clock_timestamp()-interval '80 days'+interval '2 hours','genomes-staging');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata)
 values('genomes-staging','7d2b0000-0000-4000-8000-000000000131','{"size":8}')$$,'23503',null,
 'a legacy session''s bytes cannot be in Storage any more: its bucket is gone');

create temporary table deletion as select * from public.request_account_deletion_v2('7d2b0000-0000-4000-8000-000000000101',
 '7d2b0000-0000-4000-8000-000000000110',repeat('f',64),clock_timestamp()+interval '9 minutes',decode(repeat('ab',40),'hex'),
 repeat('e',64),repeat('d',64));
with deadline as (select clock_timestamp()-interval '8 days' requested_at)
update public.account_deletion_requests set requested_at=deadline.requested_at,
 notice_ends_at=deadline.requested_at+interval '7 days' from deadline where account_id='7d2b0000-0000-4000-8000-000000000101';
update public.retention_rows r set fixed_deadline=d.notice_ends_at from public.account_deletion_requests d
 where r.target_id=d.account_id and r.retention_id='account-deletion.notice-7d'
 and d.account_id='7d2b0000-0000-4000-8000-000000000101';
update public.retention_due_phases p set phase_deadline=d.notice_ends_at from public.account_deletion_requests d
 where p.target_id=d.account_id and p.retention_id='account-deletion.notice-7d'
 and d.account_id='7d2b0000-0000-4000-8000-000000000101';
create temporary table claimed as select * from public.claim_due_account_deletion_v1(repeat('4',64),300);
select is((select deletion_id from claimed),(select deletion_id from deletion),'the claim takes this account''s deletion');

select bag_eq($$select bucket_id||' '||object_name||' '||source_kind||' '||source_id from public.account_deletion_storage_entries
 where deletion_id=(select deletion_id from deletion)$$,
 (select array['genomes '||(f.receipt->>'finalKey')||' canonical-source 7d2b0000-0000-4000-8000-000000000120',
   'genomes '||(i.receipt->>'stagingKey')||' upload-staging '||(i.receipt->>'uploadId')]
  from finalizing_upload f,inflight_upload i),
 'the manifest names the promoted source and the in-flight staging object, each in genomes, and nothing else');
select ok(not exists(select 1 from public.account_deletion_storage_entries
 where deletion_id=(select deletion_id from deletion) and object_name=(select receipt->>'stagingKey' from promoted_upload)),
 'the promoted session''s staging key, removed before promotion, is not in the manifest');
select ok(not exists(select 1 from public.account_deletion_storage_entries
 where deletion_id=(select deletion_id from deletion) and source_id='7d2b0000-0000-4000-8000-000000000130'),
 'the legacy session is not in the manifest: nothing of it can be in Storage');
select is((select storage_objects from claimed),(select jsonb_agg(jsonb_build_object('bucketId',e.bucket_id,
 'objectName',e.object_name,'ordinal',e.entry_ordinal) order by e.entry_ordinal) from public.account_deletion_storage_entries e
 where e.deletion_id=(select deletion_id from deletion)),'the worker receives exactly that manifest, in order');

-- ---------------------------------------------------------------------------
-- 4. The embryo-unwind manifest, case by case (D-130)
-- ---------------------------------------------------------------------------
create temporary table attempts(label text primary key, id uuid not null, unwind uuid, staged uuid);
create function pg_temp.sid(p_label text) returns uuid language sql as $$ select id from attempts where label=p_label $$;
create function pg_temp.uid(p_label text) returns uuid language sql as $$ select unwind from attempts where label=p_label $$;
create function pg_temp.attempt(p_label text) returns text language plpgsql as $$
begin
  update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;
  insert into attempts(label,id) values(p_label,pg_temp.new_attempt());
  return private.reserve_embryo_ingest_chunk_v1(pg_temp.sid(p_label),0,repeat('d',64),100,2,60,jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4),
    jsonb_build_object('ordinal',1,'sha256',repeat('c',64),'bytes',80,'lines',4)))->>'status';
end $$;
-- An upload session bound to the attempt's cohort, under the bucket and in
-- the state given.
create function pg_temp.stage(p_label text,p_bucket text,p_status text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.upload_sessions(account_id,auth_session_id,cohort_id,staging_object_name,expected_size,
    content_type,upload_revision,status,expires_at,consumed_at,storage_bucket)
    select s.account_id,s.originating_session_id,s.cohort_id,gen_random_uuid()::text,100,'text/plain',1,p_status,
      clock_timestamp()+interval '1 hour',
      case when p_status in ('promoted','rejected','expired','cancelled') then clock_timestamp() end,p_bucket
    from public.embryo_ingest_sessions s where s.id=pg_temp.sid(p_label) returning id into v;
  update attempts set staged=v where label=p_label;
  return v;
end $$;
create function pg_temp.fail_and_plan(p_label text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform private.mark_embryo_ingest_failure_v1(pg_temp.sid(p_label),'abort');
  v:=public.prepare_embryo_ingest_unwind_v1((select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)),
    (select ingest_revision from public.embryo_ingest_sessions where id=pg_temp.sid(p_label)));
  update attempts set unwind=(v->>'unwindId')::uuid where label=p_label;
  return v->>'status';
end $$;
create function pg_temp.staging_entry(p_label text) returns text language sql as $$
  select string_agg(o.bucket_id||' '||(o.object_name=u.staging_object_name)||' '||(o.source_id=u.id),', ')
  from public.embryo_ingest_delete_objects o join attempts a on a.unwind=o.unwind_id and a.label=p_label
  join public.upload_sessions u on u.id=a.staged where o.source_kind='upload-staging';
$$;

select is(pg_temp.attempt('inflight'),'reserved','an in-flight attempt reserves its fragments');
select isnt(pg_temp.stage('inflight','genomes','issued'),null,'a post-cutover session in flight is bound to its cohort');
select is(pg_temp.fail_and_plan('inflight'),'storage_pending','its unwind is planned');
select is(pg_temp.staging_entry('inflight'),'genomes true true',
 'the in-flight session is inventoried once, under genomes, its own bucket');
select bag_eq($$select bucket_id||' '||source_kind from public.embryo_ingest_delete_objects where unwind_id=pg_temp.uid('inflight')$$,
 array['inherit-embryo-test ingest-fragment','inherit-embryo-test ingest-fragment','genomes upload-staging'],
 'the in-flight plan is its two fragments and its staging object, and nothing else');

select is(pg_temp.attempt('promoted'),'reserved','a promoted attempt reserves its fragments');
select isnt(pg_temp.stage('promoted','genomes','promoted'),null,'a promoted session is bound to its cohort');
select is(pg_temp.fail_and_plan('promoted'),'storage_pending','its unwind is planned');
select is(pg_temp.staging_entry('promoted'),'genomes true true',
 'the promoted session is inventoried as before, under genomes, its own bucket');
select is((private.embryo_ingest_unwind_unresolved_v1(pg_temp.uid('promoted'))->>'unsupported')::integer,1,
 'and, having no disposal contract, it keeps the unwind unresolved exactly as before');

-- ---------------------------------------------------------------------------
-- 5. The migration's own blocks, through every state they must refuse
-- ---------------------------------------------------------------------------
-- The predecessor block and the tightening block, byte for byte.
create function pg_temp.predecessor() returns void language plpgsql as $predecessor$
begin
 -- Each function its reviewed body and ACL. Distinct signatures are counted,
 -- so no body can stand in for another.
 if (select count(distinct x.signature) from pg_proc p join (values
    ('public.claim_due_account_deletion_v1(text,integer)','a67a7a734a1e3bf392f5bdaf40678b6e',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.prepare_embryo_ingest_unwind_v1(uuid,bigint)','370cf6155b34299765c50ef2a7fefdbc',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','8c330bee64e40182f7df90fdff39505d',
     '{postgres=X/postgres}'),
    ('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)',
     '5f87e19b0324a34ef2945c2f2158313d','{postgres=X/postgres}'),
    ('private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)','6bc9b8cda82896772859a4887ad888c1',
     '{postgres=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl)<>5
  -- Each bucket check exactly as the migrations left it, validated.
  or (select count(*) from pg_constraint c join (values
    ('public.genome_storage_objects','genome_storage_objects_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''generated-artifacts''::text])))'),
    ('public.account_deletion_storage_entries','account_deletion_storage_entries_bucket_id_check',
     'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])))'),
    ('public.embryo_ingest_delete_objects','embryo_ingest_delete_objects_bucket_id_check',
     'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, ''generated-artifacts''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))')
   ) as x(relation,name,definition) on c.conrelid=to_regclass(x.relation) and c.conname=x.name
    and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid)=x.definition)<>3
  -- Both buckets are gone.
  or exists(select 1 from storage.buckets where id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket literals prerequisite differs'; end if;
end;
$predecessor$;
create function pg_temp.tighten() returns void language plpgsql as $tighten$
begin
 lock table public.account_deletion_storage_entries,public.embryo_ingest_delete_objects,public.genome_storage_objects
  in access exclusive mode;
 if exists(select 1 from public.account_deletion_storage_entries where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.account_deletion_storage_entries'; end if;
 if exists(select 1 from public.embryo_ingest_delete_objects where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.embryo_ingest_delete_objects'; end if;
 if exists(select 1 from public.genome_storage_objects where bucket_id in ('genomes-staging','generated-artifacts')) then
  raise exception using errcode='55000',message='dropped bucket recorded in public.genome_storage_objects'; end if;
 if exists(select 1 from public.upload_sessions u where u.storage_bucket='genomes-staging'
   and (u.cohort_id is not null or exists(select 1 from public.subjects s where s.id=u.subject_id and s.cohort_id is not null))) then
  raise exception using errcode='55000',message='legacy genomes-staging session reachable by an embryo unwind'; end if;
 alter table public.account_deletion_storage_entries
  drop constraint account_deletion_storage_entries_bucket_id_check,
  add constraint account_deletion_storage_entries_bucket_id_check check (bucket_id in ('genomes','legal-evidence'));
 alter table public.embryo_ingest_delete_objects
  drop constraint embryo_ingest_delete_objects_bucket_id_check,
  add constraint embryo_ingest_delete_objects_bucket_id_check check (bucket_id in ('genomes','legal-evidence')
   or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$');
 alter table public.genome_storage_objects
  drop constraint genome_storage_objects_bucket_id_check,
  add constraint genome_storage_objects_bucket_id_check check (bucket_id in ('genomes'));
end;
$tighten$;

-- The state before the migration: the three checks as the migrations left
-- them, and (on request) the three cores as their predecessors.
create function pg_temp.loosen() returns void language plpgsql as $$
begin
 alter table public.account_deletion_storage_entries drop constraint account_deletion_storage_entries_bucket_id_check,
  add constraint account_deletion_storage_entries_bucket_id_check
  check (bucket_id in ('genomes','genomes-staging','generated-artifacts','legal-evidence'));
 alter table public.embryo_ingest_delete_objects drop constraint embryo_ingest_delete_objects_bucket_id_check,
  add constraint embryo_ingest_delete_objects_bucket_id_check
  check (bucket_id in ('genomes','genomes-staging','generated-artifacts','legal-evidence') or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$');
 alter table public.genome_storage_objects drop constraint genome_storage_objects_bucket_id_check,
  add constraint genome_storage_objects_bucket_id_check check (bucket_id in ('genomes','generated-artifacts'));
end $$;
create function pg_temp.unpatch_cores() returns void language plpgsql as $$
declare x record;
begin
 for x in select * from (values
  ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)'),
  ('private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)'),
  ('private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)')) v(signature) loop
  execute replace(pg_get_functiondef(x.signature::regprocedure),'if p_test_jurisdiction is distinct from true','if not p_test_jurisdiction');
 end loop;
end $$;
create function pg_temp.checks() returns text language sql as $$
 select case
  when count(*) filter (where pg_get_constraintdef(c.oid) like '%generated-artifacts%')=3 then 'unchanged'
  when count(*) filter (where pg_get_constraintdef(c.oid) not like '%generated-artifacts%'
   and pg_get_constraintdef(c.oid) not like '%genomes-staging%')=3 then 'tightened'
  else 'other' end
 from pg_constraint c where c.conname in ('account_deletion_storage_entries_bucket_id_check',
  'embryo_ingest_delete_objects_bucket_id_check','genome_storage_objects_bucket_id_check');
$$;
-- Run one block on a prepared state, report what it did and how the checks
-- read afterwards, then undo the whole probe.
create function pg_temp.probe(p_block text,p_loosen boolean,p_unpatch boolean,p_setup text) returns text language plpgsql as $$
declare v_outcome text;
begin
 begin
  -- Pending deferred checks (the finalization above wrote genome objects)
  -- would block the ALTERs; they fire here and are pending again after.
  set constraints all immediate;
  if p_loosen then perform pg_temp.loosen(); end if;
  if p_unpatch then perform pg_temp.unpatch_cores(); end if;
  if p_setup is not null then execute p_setup; end if;
  begin
   execute format('select pg_temp.%I()',p_block);
   v_outcome:='applied';
  exception when others then
   v_outcome:=sqlstate||' '||sqlerrm;
  end;
  v_outcome:=v_outcome||'; '||pg_temp.checks();
  raise exception using errcode='ZZ001',message='probe undone';
 exception when sqlstate 'ZZ001' then
  return v_outcome;
 end;
end $$;
select is(pg_temp.checks(),'tightened','(the migration is applied)');

-- The predecessor block.
select is(pg_temp.probe('predecessor',true,true,null),'applied; unchanged',
 'the predecessor block accepts exactly the reviewed pre-state');
select is(pg_temp.probe('predecessor',true,false,null),'55000 dropped bucket literals prerequisite differs; unchanged',
 'it refuses once the guards are patched: the migration cannot run twice');
select is(pg_temp.probe('predecessor',false,true,null),'55000 dropped bucket literals prerequisite differs; tightened',
 'it refuses a bucket check that is not the reviewed one');
select is(pg_temp.probe('predecessor',true,true,$s$do $d$ begin execute replace(pg_get_functiondef(
 'public.prepare_embryo_ingest_unwind_v1(uuid,bigint)'::regprocedure),
 'select storage_bucket,staging_object_name,''upload-staging''',
 'select ''genomes-staging'',staging_object_name,''upload-staging'''); end $d$$s$),
 '55000 dropped bucket literals prerequisite differs; unchanged',
 'it refuses an embryo builder that still names the dropped staging bucket');
select is(pg_temp.probe('predecessor',true,true,$s$do $d$ begin execute replace(pg_get_functiondef(
 'public.claim_due_account_deletion_v1(text,integer)'::regprocedure),
 'select us.storage_bucket, us.staging_object_name,','select ''genomes-staging'', us.staging_object_name,'); end $d$$s$),
 '55000 dropped bucket literals prerequisite differs; unchanged',
 'it refuses an account-deletion builder that still names the dropped staging bucket');
select is(pg_temp.probe('predecessor',true,true,
 'grant execute on function private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean) to service_role'),
 '55000 dropped bucket literals prerequisite differs; unchanged','it refuses a core whose ACL differs');
select is(pg_temp.probe('predecessor',true,true,$s$alter table public.genome_storage_objects
 drop constraint genome_storage_objects_bucket_id_check,
 add constraint genome_storage_objects_bucket_id_check check (bucket_id in ('genomes','generated-artifacts')) not valid$s$),
 '55000 dropped bucket literals prerequisite differs; unchanged','it refuses a check that is not validated');

-- The tightening block: a row on a dropped bucket refuses it, writing nothing.
select is(pg_temp.probe('tighten',true,false,null),'applied; tightened',
 'on the reviewed state the block replaces all three checks');
select is(pg_temp.probe('tighten',true,false,$s$insert into public.account_deletion_storage_entries(deletion_id,entry_ordinal,
 bucket_id,object_name,source_kind,source_id,status,completed_at) values((select deletion_id from deletion),99,'genomes-staging',
 '7d2b0000-0000-4000-8000-000000000131','upload-staging','7d2b0000-0000-4000-8000-000000000130','deleted',clock_timestamp())$s$),
 '55000 dropped bucket recorded in public.account_deletion_storage_entries; unchanged',
 'a completed legacy entry of an unfinished deletion refuses it, and no check changes');
select is(pg_temp.probe('tighten',true,false,$s$set local session_replication_role=replica;
 insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id)
  values(pg_temp.uid('inflight'),99,'generated-artifacts','x','upload-staging',gen_random_uuid());
 set local session_replication_role=origin$s$),
 '55000 dropped bucket recorded in public.embryo_ingest_delete_objects; unchanged',
 'an embryo-unwind entry on a dropped bucket refuses it');
select is(pg_temp.probe('tighten',true,false,$s$alter table public.genome_storage_objects
 drop constraint genome_storage_objects_genomes_only;
 set local session_replication_role=replica;
 insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
  values(gen_random_uuid(),'7d2b0000-0000-4000-8000-000000000140','generated-artifacts',gen_random_uuid(),repeat('a',64),1,1,'current');
 set local session_replication_role=origin$s$),
 '55000 dropped bucket recorded in public.genome_storage_objects; unchanged','a recorded object on a dropped bucket refuses it');
select is(pg_temp.probe('tighten',true,false,$s$insert into public.upload_sessions(account_id,auth_session_id,cohort_id,
 staging_object_name,expected_size,content_type,upload_revision,status,expires_at,consumed_at,storage_bucket)
 select s.account_id,s.originating_session_id,s.cohort_id,gen_random_uuid()::text,100,'text/plain',1,'expired',
  clock_timestamp()+interval '1 hour',clock_timestamp(),'genomes-staging'
 from public.embryo_ingest_sessions s where s.id=pg_temp.sid('promoted')$s$),
 '55000 legacy genomes-staging session reachable by an embryo unwind; unchanged',
 'a legacy session an embryo unwind would inventory refuses it');
select is((select count(*) from public.upload_sessions where account_id='7d2b0000-0000-4000-8000-000000000101'
 and storage_bucket='genomes-staging'),1::bigint,'(the account''s own legacy session is still there)');
select is(pg_temp.probe('tighten',true,false,null),'applied; tightened',
 'an account''s own legacy session does not: no manifest can inventory it under the dropped bucket');

-- ---------------------------------------------------------------------------
-- 6. The embryo-unwind manifest for a legacy session: the plan refuses
-- ---------------------------------------------------------------------------
select is(pg_temp.attempt('legacy'),'reserved','a third attempt reserves its fragments');
select isnt(pg_temp.stage('legacy','genomes-staging','expired'),null,
 'a legacy session recorded under the dropped bucket is bound to its cohort');
select private.mark_embryo_ingest_failure_v1(pg_temp.sid('legacy'),'abort');
select throws_ok($$select public.prepare_embryo_ingest_unwind_v1(
 (select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid('legacy')),
 (select ingest_revision from public.embryo_ingest_sessions where id=pg_temp.sid('legacy')))$$,'23514',
 'new row for relation "embryo_ingest_delete_objects" violates check constraint "embryo_ingest_delete_objects_bucket_id_check"',
 'the plan refuses to inventory an object under a bucket that does not exist');
select is((select count(*) from public.embryo_ingest_unwinds u join public.embryo_ingest_sessions s
 on s.cohort_id=u.cohort_id and s.ingest_revision=u.ingest_revision where s.id=pg_temp.sid('legacy')),0::bigint,
 'and writes no unwind and no inventory');

-- ---------------------------------------------------------------------------
-- 7. Each patched guard refuses NULL and false and admits true (D-140)
-- ---------------------------------------------------------------------------
insert into auth.users(id,email,email_confirmed_at) values('7d2b0000-0000-4000-8000-000000000201',
 'dropped-bucket-inviter@example.invalid',now()),('7d2b0000-0000-4000-8000-000000000202','dropped-bucket-embryo@example.invalid',now());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values('7d2b0000-0000-4000-8000-000000000212',
 '7d2b0000-0000-4000-8000-000000000202',now(),now(),'aal1');
select public.declare_jurisdiction_v1('7d2b0000-0000-4000-8000-000000000202','7d2b0000-0000-4000-8000-000000000212','GB',
 (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),false);

-- private.create_adult_subject_invitation_core_v1, through its public door.
create function pg_temp.invite_adult(p_flag boolean) returns bigint language sql as $$
 select count(*) from public.create_adult_subject_invitation_v1('7d2b0000-0000-4000-8000-000000000201',
  decode('00112233445566778899aabbccddeeff','hex'),repeat('7',64),repeat('8',64),p_flag,
  p_quota_keys => pg_temp.invitation_quota_keys());
$$;
select throws_ok(format('select pg_temp.invite_adult(%s)',f),'42501','adult invitation unavailable',
 'an adult invitation with a '||f||' jurisdiction flag is refused') from unnest(array['null','false']) f;
select is((select count(*) from public.subject_invitations i join public.subject_principals sp on sp.id=i.inviter_principal_id
 where sp.account_id='7d2b0000-0000-4000-8000-000000000201'),0::bigint,'and the refusals wrote no invitation');
select is(pg_temp.invite_adult(true),1::bigint,'a true flag creates the adult invitation');

-- private.create_embryo_cohort_draft_core_v1, through its public door.
create function pg_temp.draft(p_flag boolean) returns uuid language sql as $$
 select draft_id from public.create_embryo_cohort_draft_v1('7d2b0000-0000-4000-8000-000000000202',
  '7d2b0000-0000-4000-8000-000000000212','own_embryos','true_two_parent',2,decode('00112233445566778899aabbccddeeff','hex'),
  encode(extensions.digest('dropped-bucket-owner','sha256'),'hex'),array['ffeeddccbbaa99887766554433221100'],
  array[encode(extensions.digest('dropped-bucket-parent','sha256'),'hex')],gen_random_uuid()::text,p_flag);
$$;
select throws_ok(format('select pg_temp.draft(%s)',f),'42501','embryo analysis unavailable',
 'an embryo cohort draft with a '||f||' jurisdiction flag is refused') from unnest(array['null','false']) f;
create temporary table embryo_draft as select pg_temp.draft(true) id;
select isnt((select id from embryo_draft),null,'a true flag creates the embryo cohort draft');

-- private.create_embryo_draft_invitation_core_v1, through its public door,
-- on that draft once its three artifacts are signed.
select public.sign_embryo_artifact_v1('7d2b0000-0000-4000-8000-000000000202','7d2b0000-0000-4000-8000-000000000212',
 'cohort_draft',(select id from embryo_draft),k,1,private.embryo_statement_keys_v1(k,'parent'),decode('deadbeef','hex'),'GB',
 gen_random_uuid()::text)
 from unnest(array['consent.upload-embryo','attestation.embryo-parentage','attestation.embryo-disposition-rights']) k;
create function pg_temp.invite_parent(p_flag boolean) returns bigint language sql as $$
 select count(*) from public.create_embryo_draft_invitation_v1('7d2b0000-0000-4000-8000-000000000202',
  '7d2b0000-0000-4000-8000-000000000212',(select id from embryo_draft),encode(extensions.digest('dropped-bucket-parent','sha256'),'hex'),
  repeat('9',64),gen_random_uuid()::text,p_flag,p_quota_keys => pg_temp.invitation_quota_keys());
$$;
select throws_ok(format('select pg_temp.invite_parent(%s)',f),'42501','invitation unavailable',
 'an embryo draft invitation with a '||f||' jurisdiction flag is refused') from unnest(array['null','false']) f;
select is(pg_temp.invite_parent(true),1::bigint,'a true flag creates the embryo draft invitation');

-- ---------------------------------------------------------------------------
-- 8. The patches cannot be applied twice
-- ---------------------------------------------------------------------------
create type pg_temp.patch_item as (ordinal integer,target text,before_md5 text,after_md5 text,acl text,
 old_fragment text,new_fragment text,label text);
create function pg_temp.guarded_patch(item pg_temp.patch_item) returns void language plpgsql as $guarded$
declare definition text;before_acl aclitem[];
begin
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
end $guarded$;
select throws_ok(format('select pg_temp.guarded_patch(row(%s,%L,%L,%L,%L,%L,%L,%L)::pg_temp.patch_item)',
 x.ordinal,x.target,x.before_md5,x.after_md5,'{postgres=X/postgres}','if not p_test_jurisdiction',
 'if p_test_jurisdiction is distinct from true',x.label),'55000',x.label||' predecessor differs',
 x.label||': the patch cannot be applied twice') from (values
 (1,'private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','8c330bee64e40182f7df90fdff39505d',
  '72ea3d6e8b41bfe74d8645259f7cfad7','adult invitation jurisdiction guard'),
 (2,'private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)',
  '5f87e19b0324a34ef2945c2f2158313d','f8f19fa7d430d55b00359703eee53faa','embryo cohort draft jurisdiction guard'),
 (3,'private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)','6bc9b8cda82896772859a4887ad888c1',
  '4e6272c513d728aa62b5fba27916bcc7','embryo draft invitation jurisdiction guard')
) x(ordinal,target,before_md5,after_md5,label);

select * from finish();
rollback;
