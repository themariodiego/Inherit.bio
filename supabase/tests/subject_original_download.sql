begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- api.subject-download (20261016191000_subject_original_download.sql).
-- Synthetic metadata only. All fixtures and assertions roll back.
insert into auth.users(id,email) values
 ('77910000-0000-4000-8000-000000000001','subject-download-own@e2e.local'),
 ('77910000-0000-4000-8000-000000000002','subject-download-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77910000-0000-4000-8000-000000000010','77910000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('77910000-0000-4000-8000-000000000011','77910000-0000-4000-8000-000000000002',now(),now(),'aal1');
create temporary table own_subject as select id from public.subjects
 where subject_account_id='77910000-0000-4000-8000-000000000001' and subject_class='self';
create temporary table other_subject as select id from public.subjects
 where subject_account_id='77910000-0000-4000-8000-000000000002' and subject_class='self';
insert into storage.objects(id,bucket_id,name,metadata,version) values
 ('77910000-0000-4000-8000-000000000020','genomes','77910000-0000-4000-8000-000000000030','{"size":4000005}',
  '77910000-0000-4000-8000-0000000000a1');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77910000-0000-4000-8000-000000000040','77910000-0000-4000-8000-000000000001',(select id from own_subject),
 '77910000-0000-4000-8000-000000000030','Genome file','vcf',1,4000005,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('a',64),'77910000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77910000-0000-4000-8000-000000000020','77910000-0000-4000-8000-000000000030','genomes',
 '77910000-0000-4000-8000-000000000040',repeat('a',64),4000005,1,'current');

create function pg_temp.open(account uuid, session uuid, subject uuid, cookie text default repeat('c',64)) returns jsonb
language sql as $$ select public.open_subject_original_download_v1(account,session,subject,
 '77910000-0000-4000-8000-000000000040',cookie) $$;
create function pg_temp.own_open(cookie text default repeat('c',64)) returns jsonb language sql as $$
 select pg_temp.open('77910000-0000-4000-8000-000000000001','77910000-0000-4000-8000-000000000010',
  (select id from own_subject),cookie) $$;
create function pg_temp.chunk(download uuid, sequence integer, cookie text default repeat('c',64)) returns jsonb
language sql as $$ select public.authorize_subject_original_chunk_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',download,cookie,sequence) $$;
create function pg_temp.record(download uuid, sequence integer, bytes integer) returns text
language sql as $$ select public.record_subject_original_chunk_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',download,repeat('c',64),sequence,bytes) $$;

-- Privileges: only the service transport may call any door.
select ok(not has_function_privilege('authenticated','public.open_subject_original_download_v1(uuid,uuid,uuid,uuid,text)','execute'),
 'no signed-in client may open a session directly');
select ok(not has_function_privilege('anon','public.authorize_subject_original_chunk_v1(uuid,uuid,uuid,text,integer)','execute'),
 'no anonymous client may authorize a chunk');
select ok(not has_function_privilege('authenticated','public.record_subject_original_chunk_v1(uuid,uuid,uuid,text,integer,integer)','execute'),
 'no signed-in client may record a chunk');
select ok(has_function_privilege('service_role','public.open_subject_original_download_v1(uuid,uuid,uuid,uuid,text)','execute'),
 'the service transport may open a session');
select ok(not has_function_privilege('service_role','private.subject_original_download_authority_v1(uuid,uuid,uuid,uuid,text)','execute'),
 'the authority helper is not a door');

-- The create step.
create temporary table opened as select pg_temp.own_open() as value;
select is((select value->>'chunkCount' from opened),'2','two fixed chunks for 4,000,005 bytes');
select is((select value->>'sha256' from opened),repeat('a',64),'the recorded integrity hash is returned');
select is((select value->>'sizeBytes' from opened),'4000005','the recorded size is returned');
select ok(not ((select value from opened) ?| array['objectKey','bucket','objectId','cookieHash']),
 'the descriptor names no object, bucket or credential');
select is((select count(*)::integer from public.download_sessions where id=(select (value->>'session')::uuid from opened)
  and purpose='subject-original-download' and cookie_hash=repeat('c',64) and status='active'
  and file_id='77910000-0000-4000-8000-000000000040' and object_version='77910000-0000-4000-8000-0000000000a1'
  and expires_at<=created_at+interval '1 hour'),1,'one hash-only session row bound to the exact file and object version');
select ok(exists(select 1 from public.legal_audit_log where event_code='download.session.created'
  and route_id='api.subject-download' and coded_context->>'kind'='subject-original'),'the session creation is audited');

-- Own data only.
select throws_ok($$select pg_temp.open('77910000-0000-4000-8000-000000000002','77910000-0000-4000-8000-000000000011',
 (select id from own_subject))$$,'42501','not_found','another account cannot download this file');
select throws_ok($$select pg_temp.open('77910000-0000-4000-8000-000000000001','77910000-0000-4000-8000-000000000010',
 (select id from other_subject))$$,'42501','not_found','a file is downloadable only under its own route subject');
select throws_ok($$select pg_temp.open('77910000-0000-4000-8000-000000000001','77910000-0000-4000-8000-000000000011',
 (select id from own_subject))$$,'42501','not_found','another account''s session cannot open it');
select throws_ok($$select pg_temp.own_open('not-a-hash')$$,'42501','not_found','a malformed cookie hash is refused');
select is(public.subject_original_download_target_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',(select id from own_subject)),true,'the own subject is a readable target');
select is(public.subject_original_download_target_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',(select id from other_subject)),false,'another person''s subject is not');

-- The uploader of an adult record whose account is not the caller.
savepoint uploader_case;
update public.subjects set subject_account_id=null,subject_class='other_adult',upload_class='adult'
 where id=(select id from own_subject);
select throws_ok($$select pg_temp.own_open()$$,'42501','not_found','an uploader-held adult record answers not found');
rollback to uploader_case;

-- Integrity record and original lifecycle.
savepoint integrity_case;
update public.genome_storage_objects set sha256=repeat('f',64) where object_id='77910000-0000-4000-8000-000000000020';
select throws_ok($$select pg_temp.own_open()$$,'42501','not_found','a mismatched integrity record refuses the session');
rollback to integrity_case;
insert into storage.objects(id,bucket_id,name,metadata,version) values
 ('77910000-0000-4000-8000-000000000021','genomes','77910000-0000-4000-8000-000000000031','{"size":8}',
  '77910000-0000-4000-8000-0000000000b1');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,storage_object_id)
 values('77910000-0000-4000-8000-000000000041','77910000-0000-4000-8000-000000000001',(select id from own_subject),
 '77910000-0000-4000-8000-000000000031','Genome file','vcf',1,8,repeat('b',64),'uploaded',1,
 '77910000-0000-4000-8000-000000000021');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77910000-0000-4000-8000-000000000021','77910000-0000-4000-8000-000000000031','genomes',
 '77910000-0000-4000-8000-000000000041',repeat('b',64),8,1,'current');
select throws_ok($$select public.open_subject_original_download_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',(select id from own_subject),'77910000-0000-4000-8000-000000000041',repeat('c',64))$$,
 '42501','not_found','a file without single-sample evidence refuses the session');
rollback to integrity_case;
update storage.objects set metadata='{"size":7}' where id='77910000-0000-4000-8000-000000000020';
select throws_ok($$select pg_temp.own_open()$$,'42501','not_found','a Storage object of another size refuses the session');
rollback to integrity_case;
insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
 values('77910000-0000-4000-8000-000000000040','77910000-0000-4000-8000-000000000001','genomes',
  '77910000-0000-4000-8000-000000000030');
select throws_ok($$select pg_temp.own_open()$$,'42501','not_found','a deleting original refuses the session');
rollback to integrity_case;

-- Each chunk.
create temporary table first_chunk as select pg_temp.chunk((select (value->>'session')::uuid from opened),0) as value;
select is((select value->>'status' from first_chunk),'authorized','the first chunk is authorized');
select is((select value->>'objectKey' from first_chunk),'77910000-0000-4000-8000-000000000030',
 'only the service transport receives the database-owned object key');
select is((select (value->>'start')||'-'||(value->>'end') from first_chunk),'0-3999999','sequence 0 is the first full chunk');
select is((select (value->>'start')||'-'||(value->>'end')
  from (select pg_temp.chunk((select (value->>'session')::uuid from opened),1) value) x),'4000000-4000004',
 'the last chunk is the shorter remainder');
select throws_ok($$select pg_temp.chunk((select (value->>'session')::uuid from opened),2)$$,'22023','invalid_request',
 'a sequence past the end is an invalid request');
select is(pg_temp.record((select (value->>'session')::uuid from opened),0,4000000),'recorded','a served range is recorded');
select is(pg_temp.record((select (value->>'session')::uuid from opened),0,4000000),'recorded','a repeated range is idempotent');
select is((select served_bytes from public.download_sessions where id=(select (value->>'session')::uuid from opened)),
 4000000::bigint,'each range counts once');
select is((select count(*)::integer from public.download_ranges where session_id=(select (value->>'session')::uuid from opened)),
 1,'one range row per served sequence');
select throws_ok($$select pg_temp.record((select (value->>'session')::uuid from opened),1,4000000)$$,'22023','invalid_request',
 'a recorded byte count must be the exact range');
select throws_ok($$select pg_temp.chunk((select (value->>'session')::uuid from opened),0,repeat('d',64))$$,'42501','not_found',
 'another cookie cannot read the session');
select is(public.authorize_subject_original_chunk_v1('77910000-0000-4000-8000-000000000001',
 '77910000-0000-4000-8000-000000000010',gen_random_uuid(),repeat('c',64),0),null::jsonb,
 'an unknown id is not a subject original session, so the route may try another kind');

-- Revocation: every change ends the session at its next chunk.
savepoint revocation_case;
update public.profiles set auth_session_revision=auth_session_revision+1 where id='77910000-0000-4000-8000-000000000001';
select is((select pg_temp.chunk((select (value->>'session')::uuid from opened),1)->>'status'),'ended',
 'a stale account session revision ends the session');
select is((select status from public.download_sessions where id=(select (value->>'session')::uuid from opened)),'revoked',
 'and the session row is revoked');
rollback to revocation_case;
update storage.objects set version='77910000-0000-4000-8000-0000000000a2' where id='77910000-0000-4000-8000-000000000020';
select is((select pg_temp.chunk((select (value->>'session')::uuid from opened),1)->>'status'),'ended',
 'a replaced Storage object version ends the session');
rollback to revocation_case;
update public.subject_account_bindings set binding_revision=binding_revision+1 where subject_id=(select id from own_subject);
select is(pg_temp.record((select (value->>'session')::uuid from opened),1,5),'ended',
 'a revocation during the read is seen by the second authorization');
rollback to revocation_case;
update public.download_sessions set last_activity_at=clock_timestamp()-interval '6 minutes'
 where id=(select (value->>'session')::uuid from opened);
select is((select pg_temp.chunk((select (value->>'session')::uuid from opened),1)->>'status'),'ended','five idle minutes end the session');
select is((select status from public.download_sessions where id=(select (value->>'session')::uuid from opened)),'expired',
 'an idle session is expired');
rollback to revocation_case;
delete from auth.sessions where id='77910000-0000-4000-8000-000000000010';
select is((select pg_temp.chunk((select (value->>'session')::uuid from opened),1)->>'status'),'ended',
 'a signed-out originating session ends the session');
rollback to revocation_case;

-- A new session replaces the earlier one.
create temporary table reopened as select pg_temp.own_open(repeat('e',64)) as value;
select is((select status from public.download_sessions where id=(select (value->>'session')::uuid from opened)),'revoked',
 'opening again ends the earlier session');
select throws_ok($$select pg_temp.chunk((select (value->>'session')::uuid from opened),0)$$,'42501','not_found',
 'the earlier cookie no longer reads');
select is((select pg_temp.chunk((select (value->>'session')::uuid from reopened),0,repeat('e',64))->>'status'),'authorized',
 'the new session reads');

-- Cleanup of ended sessions.
update public.download_sessions set ended_at=clock_timestamp()-interval '2 hours'
 where id=(select (value->>'session')::uuid from opened);
select is(public.purge_ended_subject_original_downloads_v1(),1,'an ended session is purged after an hour');
select is((select count(*)::integer from public.download_ranges where session_id=(select (value->>'session')::uuid from opened)),
 0,'its ranges go with it');
select is((select count(*)::integer from public.download_sessions where id=(select (value->>'session')::uuid from reopened)),
 1,'a live session is kept');

select * from finish();
rollback;
