begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89130000-0000-4000-8000-000000000001','prepared-checkpoints@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89130000-0000-4000-8000-000000000010','89130000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89130000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89130000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'89130000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89130000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89130000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- This fixture verifies SQL authority and metadata only. Storage bytes and the
-- final canonical/rsID root are NOT proved by synthetic Storage rows.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89130000-0000-4000-8000-000000000011','89130000-0000-4000-8000-000000000001',now(),now(),'aal1');
update private.own_preparation_config set enabled=true where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.publication(p jsonb default null,session_id uuid default '89130000-0000-4000-8000-000000000010',
 claim_hash text default repeat('e',64)) returns jsonb language sql as $$
 select public.publish_own_prepared_manifest_v1('89130000-0000-4000-8000-000000000001',session_id,
 pg_temp.job_id(),pg_temp.attempt_id(),claim_hash,coalesce(p,(select value from pub_receipts where label='payload'))); $$;
create function pg_temp.read_publication(session_id uuid default '89130000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_prepared_manifest_v1('89130000-0000-4000-8000-000000000001',session_id,pg_temp.file_id(),null); $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('89130000-0000-4000-8000-000000000001',
 '89130000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
-- Metadata authority/continuation proof only; no actual provider bytes are
-- uploaded by this rollback fixture. Every public operation runs as service_role.
select is((public.read_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))->>'revision')::bigint,
 0::bigint,'new live attempt has no invented checkpoint');
select is((public.read_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))->>'nextArtifactSequence')::integer,
 0,'authoritative next sequence starts at actual registry count');
insert into pub_receipts values('checkpoint',jsonb_build_object('version','own-preparation-checkpoint-v1','state','provisional',
 'phase','source-scan','generation',0,'completedInputRuns',0,'inputs','[]'::jsonb,'outputs','[]'::jsonb,'nextArtifactSequence',0,
 'sourceScan',jsonb_build_object('version','own-preparation-source-v1','source',(select value->'source' from pub_receipts where label='claim'),
  'rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'rawBytes',8,'decodedBytes',8,'lineCount',4,'compressed',true,'build','GRCh38'),
 'resume','{}'::jsonb,'terminal',jsonb_build_object('syntheticSqlMetadataOnly',true)));
select is((public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),0,
 (select value from pub_receipts where label='checkpoint'))->>'revision')::bigint,1::bigint,'current live attempt saves first checkpoint');
select throws_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),0,
 (select value from pub_receipts where label='checkpoint'))$$,'40001','checkpoint_revision_conflict','stale CAS never overwrites progress');
select throws_ok($$select public.read_own_preparation_checkpoint_v1(pg_temp.job_id(),gen_random_uuid(),repeat('e',64))$$,
 '42501','not_found','another attempt cannot adopt a checkpoint');
select throws_ok($$select public.read_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('0',64))$$,
 '42501','not_found','wrong token cannot read progress');
select throws_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),1,
 jsonb_set((select value from pub_receipts where label='checkpoint'),'{sourceScan,source,sourceRevision}','2'))$$,
 '42501','not_found','changed original revision cannot receive progress');
select throws_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),1,
 jsonb_set((select value from pub_receipts where label='checkpoint'),'{nextArtifactSequence}','1'))$$,
 '42501','not_found','caller cannot invent the next artifact sequence');
select throws_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),1,
 jsonb_set((select value from pub_receipts where label='checkpoint'),'{phase}','"published"'))$$,
 '22023','invalid_checkpoint','checkpoint cannot mint published status');
select throws_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),1,
 (select value from pub_receipts where label='checkpoint')||'{"unexpected":true}'::jsonb)$$,
 '22023','invalid_checkpoint','unknown checkpoint envelope fields refuse');
insert into pub_receipts values('renewed',public.renew_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64)));
select is((select value->>'attemptId' from pub_receipts where label='renewed'),pg_temp.attempt_id()::text,'renewal preserves attempt identity');
select ok((select (value->>'claimExpiresAt')::timestamptz<=(value->>'jobDeadline')::timestamptz from pub_receipts where label='renewed'),
 'renewal cannot exceed immutable hard job deadline');
select ok((select (value->>'claimExpiresAt')::timestamptz<=clock_timestamp()+interval '5 minutes' from pub_receipts where label='renewed'),
 'renewal grants at most five minutes');
reset role;
select is((select max_job_seconds from private.own_preparation_config where singleton),900,'default hard job duration remains fifteen minutes');
select is((select extract(epoch from cleanup_deadline-created_at)::integer from private.own_preparation_jobs where id=pg_temp.job_id()),7200,
 'original two-hour scratch deadline is unchanged');
select throws_ok($$update private.own_preparation_config set max_job_seconds=3601 where singleton$$,'23514',null,'policy cannot exceed one hour');
select throws_ok($$update private.own_preparation_config set max_job_seconds=899 where singleton$$,'23514',null,'policy does not silently shrink existing minimum');
-- Setup-only time changes are coherent under the existing immutable job guard;
-- the public operation must still reject an expired lease rather than revive it.
create function pg_temp.expired_renewal() returns jsonb language plpgsql security definer as $$
begin
 update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.job_id();
 return public.renew_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64));
end; $$;
select throws_ok($$select pg_temp.expired_renewal()$$,'42501','not_found','expired lease cannot be resurrected by renewal');
select is((select revision from private.own_preparation_checkpoints where job_id=pg_temp.job_id()),1::bigint,'failed writes preserve prior checkpoint');
select ok(not has_table_privilege('service_role','private.own_preparation_checkpoints','SELECT'),'service cannot bypass checkpoint authority through table reads');
select ok(not has_function_privilege('authenticated','public.renew_own_preparation_claim_v1(uuid,uuid,text)','EXECUTE'),'browser role cannot renew worker leases');
select ok(not has_function_privilege('anon','public.write_own_preparation_checkpoint_v1(uuid,uuid,text,bigint,jsonb)','EXECUTE'),'anonymous role cannot write checkpoints');
select ok(has_function_privilege('service_role','public.read_own_preparation_checkpoint_v1(uuid,uuid,text)','EXECUTE'),'service-only checkpoint API is callable');
select ok(exists(select 1 from public.purge_target_stores where target_id='variant-rows' and store_name='private.own_preparation_checkpoints'),
 'checkpoint retirement remains in existing purge registry');
set local role service_role;
select is(public.own_preparation_status_v1('89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',pg_temp.file_id())->>'status',
 'preparing','current owner sees queued/claimed progress, not Prepared');
select throws_ok($$select public.own_preparation_status_v1('89130000-0000-4000-8000-000000000001',gen_random_uuid(),pg_temp.file_id())$$,
 '42501','not_found','status requires a real current owner session');
select public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64));
select is(public.own_preparation_status_v1('89130000-0000-4000-8000-000000000001','89130000-0000-4000-8000-000000000010',pg_temp.file_id())->>'status',
 'failed','frozen source never appears prepared');
select throws_ok($$select public.renew_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))$$,
 '42501','not_found','frozen job cannot renew');
reset role;
-- No artifacts were created in this SQL fixture. Exact metadata retirement of
-- that job proves checkpoint cascade; it is not a physical Storage deletion.
delete from private.own_preparation_jobs where id=pg_temp.job_id();
select is((select count(*)::integer from private.own_preparation_checkpoints),0,'exact job retirement leaves no checkpoint residual');
select is((select count(*)::integer from public.genome_files where id=pg_temp.file_id()),1,'checkpoint retirement preserves independent original file');
select * from finish();
rollback;
