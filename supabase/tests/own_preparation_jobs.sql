begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89900000-0000-4000-8000-000000000001','preparation-job@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89900000-0000-4000-8000-000000000010','89900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89900000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'89900000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89900000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89900000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table second_issued_upload as select public.issue_own_storage_upload_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('c',64)) receipt;
grant select on second_issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from second_issued_upload),'89900000-0000-4000-8000-000000000001','{"size":8}');
create temporary table second_finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from second_issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89900000-0000-4000-8000-000000000021',
 'genomes',(select receipt->>'finalKey' from second_finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from second_issued_upload);
create temporary table second_finalized_upload as select public.complete_own_upload_finalization_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from second_issued_upload),(select (receipt->>'claim')::uuid from second_finalizing_upload),
 '89900000-0000-4000-8000-000000000021',repeat('c',64),repeat('d',64)) receipt;
reset role;
-- These are real finalization RPC metadata fixtures, not a prepared result or a
-- provider byte-integrity test. No scheduler/writer is activated by this file.
create temporary table preserved_sources as
 select f.id,md5(to_jsonb(f)::text) fingerprint from public.genome_files f
 where f.id in ((select (receipt->>'fileId')::uuid from finalized_upload),
 (select (receipt->>'fileId')::uuid from second_finalized_upload));
create temporary table receipts(label text primary key,receipt jsonb);
grant select,insert,update on receipts to service_role;
grant select on finalized_upload,second_finalized_upload to service_role;
create function pg_temp.enqueue(second_source boolean default false) returns jsonb language sql as $$
 select public.enqueue_own_preparation_v1('89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 case when second_source then (select (receipt->>'fileId')::uuid from second_finalized_upload)
 else (select (receipt->>'fileId')::uuid from finalized_upload) end);
$$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (receipt->>'jobId')::uuid from receipts where label='claim';
$$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (receipt->>'attemptId')::uuid from receipts where label='claim';
$$;
create function pg_temp.check_claim(token text default repeat('e',64)) returns jsonb language sql as $$
 select public.check_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),token);
$$;
create function pg_temp.reserve(seq integer default 0,bytes bigint default 8,hash text default repeat('f',64))
 returns jsonb language sql as $$
 select public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',seq,'byteCount',bytes,'sha256',hash));
$$;
create function pg_temp.ack(expected jsonb default null,observed text default repeat('f',64)) returns jsonb language sql as $$
 select public.ack_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (receipt->>'artifactId')::uuid from receipts where label='artifact'),
 '89900000-0000-4000-8000-000000000030',
 coalesce(expected,(select receipt from receipts where label='artifact')),observed);
$$;
select ok((select not enabled from private.own_preparation_config),'prototype is disabled by default');
select is((select count(*)::integer from public.purge_target_stores where store_name in
 ('private.own_preparation_jobs','private.own_preparation_artifacts')),2,'both sensitive stores have purge registry entries');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.own_preparation_jobs'::regclass,'private.own_preparation_artifacts'::regclass,'private.own_preparation_config'::regclass)),
 'private stores have RLS enabled');
select ok(not has_table_privilege('service_role','private.own_preparation_jobs','SELECT')
 and not has_table_privilege('service_role','private.own_preparation_artifacts','INSERT'),
 'service worker cannot bypass job RPCs through raw tables');
select ok(not has_function_privilege('anon','public.enqueue_own_preparation_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.claim_next_own_preparation_v1(text)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.reserve_own_preparation_artifact_v1(uuid,uuid,text,jsonb)','EXECUTE'),
 'browser and restricted uploader roles cannot access preparation operations');
select ok(not has_function_privilege('service_role','private.own_preparation_source_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','private.freeze_own_preparation_job_v1(uuid)','EXECUTE'),
 'source and arbitrary internal freeze helpers are not service-callable');
select ok((select bool_and(position('from auth.users' in prosrc)>0
 and position('from auth.users' in prosrc)<position('from auth.sessions' in prosrc)
 and position('from auth.sessions' in prosrc)<position('from public.profiles' in prosrc)
 and position('from public.profiles' in prosrc)<position('from public.genome_files' in prosrc))
 from pg_proc where oid in ('private.freeze_own_preparation_job_v1(uuid)'::regprocedure,
 'private.freeze_own_preparation_v1(uuid,uuid,text)'::regprocedure,'private.freeze_due_own_preparations_v1()'::regprocedure)),
 'freeze source preserves Auth-before-profile lock order (static guard, not concurrency proof)');
select ok((select not prosecdef from pg_proc where oid='public.enqueue_own_preparation_v1(uuid,uuid,uuid)'::regprocedure)
 and (select prosecdef from pg_proc where oid='private.enqueue_own_preparation_v1(uuid,uuid,uuid)'::regprocedure),
 'public invoker delegates to narrowly authorized private definer');
set local role service_role;
select throws_ok($$select pg_temp.enqueue()$$,'55000','preparation_disabled','disabled queue refuses enqueue');
select throws_ok($$select public.claim_next_own_preparation_v1(repeat('e',64))$$,
 '55000','preparation_disabled','disabled queue refuses claims');
reset role;
update private.own_preparation_config set enabled=true where singleton;
set local role service_role;
select throws_ok($$select public.enqueue_own_preparation_v1('89900000-0000-4000-8000-000000000099',
 '89900000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload))$$,
 '42501','not_found','foreign account cannot enqueue the source');
insert into receipts values('job',pg_temp.enqueue());
select is(pg_temp.enqueue(),(select receipt from receipts where label='job'),'enqueue replay preserves exact job and immutable deadline');
select throws_ok($$select public.claim_next_own_preparation_v1('not-a-hash')$$,'22023','invalid_request','claim token must be a closed SHA256 hash');
insert into receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
select is(pg_temp.check_claim(),(select receipt from receipts where label='claim'),'actual service claim passes exact live check');
select is(public.claim_next_own_preparation_v1(repeat('f',64)),null::jsonb,'competing claim cannot replace a live attempt');
select throws_ok($$select pg_temp.check_claim(repeat('0',64))$$,'42501','not_found','wrong claim token refuses');
select throws_ok($$select public.check_own_preparation_claim_v1(pg_temp.job_id(),gen_random_uuid(),repeat('e',64))$$,
 '42501','not_found','foreign attempt refuses');
reset role;
select ok((select j.cleanup_deadline=j.created_at+interval '2 hours' and j.job_deadline<=j.created_at+interval '15 minutes'
 and j.claim_expires_at<=j.job_deadline and j.claim_expires_at<=clock_timestamp()+interval '5 minutes' and j.attempts=1
 from private.own_preparation_jobs j where id=pg_temp.job_id()),'job, attempt and cleanup clocks are finite and independent');
select ok((select j.source->>'rawSha256'=repeat('a',64) and j.source->>'decodedSha256'=repeat('b',64)
 and j.source->>'objectId'='89900000-0000-4000-8000-000000000020'
 and j.session_id='89900000-0000-4000-8000-000000000010'
 and (j.authority->>'originatingSessionRevision')::bigint=coalesce(s.refresh_token_counter,0)+1
 from private.own_preparation_jobs j join auth.sessions s on s.id=j.session_id where j.id=pg_temp.job_id()),
 'job binds raw/decoded identities and the actual originating session revision');
select throws_ok($$update private.own_preparation_jobs set session_id=gen_random_uuid() where id=pg_temp.job_id()$$,
 '22023','preparation_identity_immutable','job cannot be rebound to a fresh session');
select throws_ok($$update private.own_preparation_jobs set job_deadline=job_deadline+interval '1 second' where id=pg_temp.job_id()$$,
 '22023','preparation_identity_immutable','job deadline cannot be renewed');
-- Restore only exact synthetic metadata after each refused operation. No live
-- authority check is bypassed and no production trigger is disabled.
create temporary table original_session as select refresh_token_counter from auth.sessions
 where id='89900000-0000-4000-8000-000000000010';
update auth.sessions set refresh_token_counter=coalesce(refresh_token_counter,0)+1 where id='89900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.check_claim()$$,'42501','not_found','session revision change invalidates existing claim');
reset role;
update auth.sessions set refresh_token_counter=(select refresh_token_counter from original_session)
 where id='89900000-0000-4000-8000-000000000010';
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='89900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.check_claim()$$,'42501','not_found','expired originating session refuses even a live job');
reset role;
update auth.sessions set not_after=null where id='89900000-0000-4000-8000-000000000010';
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89900000-0000-4000-8000-000000000011','89900000-0000-4000-8000-000000000001',now(),now(),'aal1');
set local role service_role;
select throws_ok($$select public.enqueue_own_preparation_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000011',(select (receipt->>'fileId')::uuid from finalized_upload))$$,
 '42501','not_found','a different valid login cannot adopt or renew the originating job');
reset role;
set local role service_role;
select throws_ok($$update storage.objects set metadata='{"size":9}' where id='89900000-0000-4000-8000-000000000020'$$,
 '42501','upload_unavailable','finalized original metadata cannot be changed');
reset role;
-- Use the existing deletion-preparation RPC for a legitimate unavailable-source
-- state. The PL/pgSQL exception block is a rollback savepoint: PT001 rolls back
-- the real deletion preparation while the local captured refusal code survives.
-- No trigger is disabled and no object is physically removed or restored.
create function pg_temp.check_deletion_pending_source() returns text language plpgsql as $$
declare refusal text;
begin
 begin
  perform public.prepare_genome_file_deletion_v1('89900000-0000-4000-8000-000000000001',
   '89900000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload));
  begin perform pg_temp.check_claim();
  exception when insufficient_privilege then refusal:=sqlstate; end;
  raise exception using errcode='PT001',message='rollback_synthetic_deletion_preparation';
 exception when sqlstate 'PT001' then return refusal; end;
end;
$$;
set local role service_role;
select is(pg_temp.check_deletion_pending_source(),'42501',
 'real deletion preparation makes the exact source unavailable to an existing claim');
reset role;
select ok(not exists(select 1 from private.genome_file_deletions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),
 'negative-source savepoint leaves no deletion state behind');
set local role service_role;
select throws_ok($$select public.ack_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 gen_random_uuid(),gen_random_uuid(),'{}',repeat('f',64))$$,'42501','not_found','ACK without prior reservation refuses');
select throws_ok($$select public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 '{"kind":"container","sequence":0,"byteCount":8,"sha256":null}')$$,'22023','invalid_request','JSON null descriptor refuses');
select throws_ok($$select public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',0,'byteCount',8,'sha256',repeat('f',64),'objectKey','caller-key'))$$,
 '22023','invalid_request','caller cannot choose an artifact key');
select throws_ok($$select pg_temp.reserve(1)$$,'22023','artifact_limit_or_sequence','out-of-sequence reservation refuses');
select throws_ok($$select pg_temp.reserve(0,8388609)$$,'22023','invalid_request','single artifact byte ceiling enforced');
select throws_ok($$select pg_temp.reserve(4096)$$,'22023','invalid_request','artifact sequence count ceiling enforced');
insert into receipts values('artifact',pg_temp.reserve());
select is(pg_temp.reserve(),(select receipt from receipts where label='artifact'),'exact reserve replay returns original immutable identity');
select throws_ok($$select pg_temp.reserve(0,9)$$,'22023','artifact_replay_conflict','conflicting reservation replay refuses');
select throws_ok($$select pg_temp.ack()$$,'42501','not_found','reservation alone cannot acknowledge missing provider object');
insert into storage.objects(id,bucket_id,name,metadata) values('89900000-0000-4000-8000-000000000030',
 'genomes',(select receipt->>'objectKey' from receipts where label='artifact'),'{"size":8}');
select throws_ok($$select pg_temp.ack(null,repeat('0',64))$$,'42501','not_found','transport-observed hash mismatch refuses');
select throws_ok($$select pg_temp.ack((select receipt||'{"extra":true}' from receipts where label='artifact'))$$,
 '42501','not_found','ACK receipt is closed and exact rather than a subset');
select is(pg_temp.ack(),(select receipt from receipts where label='artifact'),'exact provider metadata and transport hash acknowledge the reservation');
select is(pg_temp.ack(),(select receipt from receipts where label='artifact'),'exact ACK replay is idempotent');
reset role;
select ok((select a.state='acknowledged' and a.observed_sha256=a.sha256
 and a.storage_object_id='89900000-0000-4000-8000-000000000030'
 and a.write_expires_at<=j.claim_expires_at and a.write_expires_at<=j.job_deadline
 and a.write_expires_at<=clock_timestamp()+interval '30 seconds'
 from private.own_preparation_artifacts a join private.own_preparation_jobs j on j.id=a.job_id where a.job_id=pg_temp.job_id()),
 'ACK records supplied transport observation separately and retains finite write lease');
select throws_ok($$update private.own_preparation_artifacts set byte_count=9 where job_id=pg_temp.job_id()$$,
 '22023','preparation_identity_immutable','reserved descriptor cannot be rewritten');
create temporary table original_store_consent as select c.id,c.expires_at from public.subject_consents c
 join private.own_preparation_jobs j on (j.authority->>'uploadConsentId')::uuid=c.id where j.id=pg_temp.job_id();
-- expires_at must be after granted_at. Let a valid future permission deadline
-- actually elapse, rather than backdating the grant or disabling its constraint.
update public.subject_consents set expires_at=clock_timestamp()+interval '50 milliseconds' where id=(select id from original_store_consent);
select pg_sleep(0.075);
select ok((select expires_at>granted_at and expires_at<=clock_timestamp() from public.subject_consents
 where id=(select id from original_store_consent)),'store permission expires naturally after its actual grant time');
set local role service_role;
select throws_ok($$select pg_temp.check_claim()$$,'55000','upload_consent_required','expired store permission invalidates claim');
select throws_ok($$select pg_temp.reserve(1)$$,'55000','upload_consent_required','reserve rechecks current store permission');
select throws_ok($$select pg_temp.ack()$$,'55000','upload_consent_required','ACK rechecks current store permission');
reset role;
update public.subject_consents set expires_at=(select expires_at from original_store_consent) where id=(select id from original_store_consent);
-- Actual aggregate reservation boundary: twelve 8MiB objects plus the 8-byte
-- first object fit; the next 8MiB would exceed 100MiB and must not be reserved.
set local role service_role;
do $$begin for i in 1..12 loop perform pg_temp.reserve(i,8388608); end loop; end$$;
select throws_ok($$select pg_temp.reserve(13,8388608)$$,'22023','artifact_limit_or_sequence','aggregate 100MiB cap rejects excess reservation');
reset role;
select is((select artifact_count from private.own_preparation_jobs where id=pg_temp.job_id()),13,
 'failed reservation does not increment reserved identity count');
update private.own_preparation_config set enabled=false where singleton;
set local role service_role;
select throws_ok($$select pg_temp.check_claim()$$,'55000','preparation_disabled','turning private gate off stops active work');
insert into receipts values('freeze',public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64)));
select is((select receipt->>'cleanupComplete' from receipts where label='freeze'),'false','freeze never claims physical cleanup complete');
select is(public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64)),
 (select receipt from receipts where label='freeze'),'freeze replay preserves exact original fence');
reset role;
update private.own_preparation_config set enabled=true where singleton;
set local role service_role;
select throws_ok($$select pg_temp.reserve(13,1)$$,'42501','not_found','freeze forbids new reservations');
select throws_ok($$select pg_temp.ack()$$,'42501','not_found','freeze forbids late ACK even for an existing object');
reset role;
select ok((select j.write_fence_at>=max(a.write_expires_at) and j.cleanup_deadline=j.created_at+interval '2 hours'
 from private.own_preparation_jobs j join private.own_preparation_artifacts a on a.job_id=j.id
 where j.id=pg_temp.job_id() group by j.id),'freeze retains all outstanding write deadlines and immutable cleanup deadline');
select is((select count(*)::integer from private.own_preparation_artifacts where job_id=pg_temp.job_id()),13,
 'freeze keeps registered cleanup identities until physical absence can be verified');
select throws_ok($$delete from private.own_preparation_jobs where id=pg_temp.job_id()$$,'23503',null::text,
 'registered artifacts prevent premature job identity deletion');
-- Second source exercises bounded retry without reading/adopting any artifact
-- from the first attempt. Only the private test claim expiry is moved backwards.
set local role service_role;
insert into receipts values('second-job',pg_temp.enqueue(true));
reset role;
update auth.sessions set not_after=clock_timestamp()+interval '2 minutes' where id='89900000-0000-4000-8000-000000000010';
set local role service_role;
insert into receipts values('second-claim',public.claim_next_own_preparation_v1(repeat('1',64)));
reset role;
select ok((select j.claim_expires_at=s.not_after from private.own_preparation_jobs j
 join auth.sessions s on s.id=j.session_id where j.id=(select (receipt->>'jobId')::uuid from receipts where label='second-job')),
 'claim is clamped to a shorter live originating session deadline');
update auth.sessions set not_after=null where id='89900000-0000-4000-8000-000000000010';
create temporary table second_clocks as select id,created_at,job_deadline,cleanup_deadline,source,authority,session_id
 from private.own_preparation_jobs where id=(select (receipt->>'jobId')::uuid from receipts where label='second-job');
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '61 seconds'
 where id=(select id from second_clocks);
set local role service_role;
select throws_ok($$select public.check_own_preparation_claim_v1(
 (select (receipt->>'jobId')::uuid from receipts where label='second-claim'),
 (select (receipt->>'attemptId')::uuid from receipts where label='second-claim'),repeat('1',64))$$,
 '42501','not_found','expired attempt fails even before reclaim');
insert into receipts values('retry',public.claim_next_own_preparation_v1(repeat('2',64)));
select throws_ok($$select public.check_own_preparation_claim_v1(
 (select (receipt->>'jobId')::uuid from receipts where label='second-claim'),
 (select (receipt->>'attemptId')::uuid from receipts where label='second-claim'),repeat('1',64))$$,
 '42501','not_found','old attempt remains refused after replacement');
reset role;
select ok((select j.attempts=2 and j.attempt_id<>(r.receipt->>'attemptId')::uuid
 and row(j.created_at,j.job_deadline,j.cleanup_deadline,j.source,j.authority,j.session_id)
 is not distinct from row(c.created_at,c.job_deadline,c.cleanup_deadline,c.source,c.authority,c.session_id)
 from private.own_preparation_jobs j join second_clocks c on c.id=j.id cross join receipts r where r.label='second-claim'),
 'retry replaces only the claim and preserves source/session/job/cleanup clocks');
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '121 seconds' where id=(select id from second_clocks);
set local role service_role;
insert into receipts values('third',public.claim_next_own_preparation_v1(repeat('3',64)));
reset role;
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '241 seconds' where id=(select id from second_clocks);
set local role service_role;
select is(public.claim_next_own_preparation_v1(repeat('4',64)),null::jsonb,'maximum three attempts cannot be exceeded');
reset role;
-- Restore this test-only clock to the actual third claim receipt before
-- revocation: the sweep must discover lost authority, not merely exhaustion.
update private.own_preparation_jobs set claim_expires_at=(select (receipt->>'claimExpiresAt')::timestamptz from receipts where label='third')
 where id=(select id from second_clocks);
-- Session expiry and refresh revision changes are independently covered above;
-- this sweep must work after expiry and with the private work gate disabled.
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='89900000-0000-4000-8000-000000000010';
update private.own_preparation_config set enabled=false where singleton;
set local role service_role;
select is(public.freeze_due_own_preparations_v1(),
 '{"version":"own-preparation-freeze-scan-v1","frozen":1,"cleanupComplete":false}'::jsonb,
 'server-selected freeze discovers session expiry during a live claim with work gate disabled');
select is(public.freeze_due_own_preparations_v1(),
 '{"version":"own-preparation-freeze-scan-v1","frozen":0,"cleanupComplete":false}'::jsonb,
 'server-selected freeze replay has no new mutation');
reset role;
select ok(not exists(select 1 from preserved_sources p join public.genome_files f on f.id=p.id
 where p.fingerprint<>md5(to_jsonb(f)::text)), 'both original source rows remain byte-identical');
select is((select count(*)::integer from private.own_normalization_runs where file_id in(select id from preserved_sources)),0,
 'prototype does not fabricate completed or running normalizer journals');
select is((select count(*)::integer from private.own_analysis_runs where file_id in(select id from preserved_sources)),0,
 'prototype grants no report readiness');
select is((select count(*)::integer from public.genome_storage_objects where genome_file_id in(select id from preserved_sources)),2,
 'provisional artifacts are not inserted into the original-source object mapping');
select * from finish();
rollback;
