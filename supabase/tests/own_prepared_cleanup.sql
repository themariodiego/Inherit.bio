begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89800000-0000-4000-8000-000000000001','prepared-publication@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89800000-0000-4000-8000-000000000010','89800000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89800000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89800000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'89800000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89800000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89800000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- This fixture verifies SQL authority and metadata only. Storage bytes and the
-- final canonical/rsID root are NOT proved by synthetic Storage rows.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89800000-0000-4000-8000-000000000011','89800000-0000-4000-8000-000000000001',now(),now(),'aal1');
update private.own_preparation_config set enabled=true,artifact_provider='r2',r2_bucket='inherit-prepared-test' where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.publication(p jsonb default null,session_id uuid default '89800000-0000-4000-8000-000000000010',
 claim_hash text default repeat('e',64)) returns jsonb language sql as $$
 select public.publish_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',session_id,
 pg_temp.job_id(),pg_temp.attempt_id(),claim_hash,coalesce(p,(select value from pub_receipts where label='payload'))); $$;
create function pg_temp.read_publication(session_id uuid default '89800000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',session_id,pg_temp.file_id(),null); $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
select throws_ok($$select public.own_upload_normalization_v1('begin','89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id(),null,null)$$,
 '55000','prepared_backend_reserved','real legacy begin cannot steal a claimed object source');

-- SQL metadata/authority proof only. Tombstone receipts below exercise the
-- trusted executor RPC contract; actual provider fencing is proved separately.
create function pg_temp.cleanup_id() returns uuid language sql as $$
 select (value->>'cleanupId')::uuid from pub_receipts where label='cleanup'; $$;
create function pg_temp.evidence() returns jsonb language sql as $$
 select jsonb_build_object('disposition','payload-tombstoned','providerVersion',repeat('c',32),
 'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
 'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); $$;
create function pg_temp.ack_cleanup(p_hash text default repeat('c',64)) returns integer language plpgsql as $$
declare e jsonb; n integer:=0;begin
 for e in select value from jsonb_array_elements((select value->'entries' from pub_receipts where label='cleanup')) loop
  perform public.ack_own_prepared_cleanup_entry_v1(pg_temp.cleanup_id(),p_hash,(e->>'artifactId')::uuid,e,pg_temp.evidence()); n:=n+1;
 end loop; return n;end; $$;
insert into pub_receipts values('checkpoint',jsonb_build_object('version','own-preparation-checkpoint-v1','state','provisional',
 'phase','source-scan','generation',0,'completedInputRuns',0,'inputs','[]'::jsonb,'outputs','[]'::jsonb,'nextArtifactSequence',0,
 'sourceScan',jsonb_build_object('version','own-preparation-source-v1','source',(select value->'source' from pub_receipts where label='claim'),
 'rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'rawBytes',8,'decodedBytes',8,'lineCount',4,'compressed',true,'build','GRCh38'),
 'resume','{}'::jsonb,'terminal',jsonb_build_object('syntheticSqlMetadataOnly',true)));
select lives_ok($$select public.write_own_preparation_checkpoint_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),0,
 (select value from pub_receipts where label='checkpoint'))$$,'real checkpoint saved before possible first-write failure');
-- Reserved unknown-ACK object must be fenced too, without inventing a version.
insert into pub_receipts values('unknown',public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',0,'byteCount',8,'sha256',repeat('f',64))));
select lives_ok($$select public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))$$,'actual attempt freezes before cleanup');
select throws_ok($$select public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',1,'byteCount',8,'sha256',repeat('f',64)))$$,'42501','not_found','late reservation refused after freeze');
select throws_ok($$select public.enqueue_own_preparation_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id())$$,'55000','preparation_cleanup_pending','retry cannot bypass frozen artifacts');
reset role;
insert into pub_receipts values('cleanup-id',to_jsonb(private.prepare_own_prepared_cleanup_v1(pg_temp.job_id(),'unpublished-scratch')));
select is((select cleanup_deadline from private.own_prepared_cleanups where id=(select (value#>>'{}')::uuid from pub_receipts where label='cleanup-id')),
 (select cleanup_deadline from private.own_preparation_jobs where id=pg_temp.job_id()),'cleanup preserves original immutable two-hour deadline');
set local role service_role;
insert into pub_receipts values('cleanup',public.claim_own_prepared_cleanup_v1(repeat('c',64),(select (value#>>'{}')::uuid from pub_receipts where label='cleanup-id')));
select is((select jsonb_array_length(value->'entries') from pub_receipts where label='cleanup'),1,'unknown write included exactly once');
select is((select value#>'{entries,0,locator,providerVersion}' from pub_receipts where label='cleanup'),'null'::jsonb,'unknown provider version stays explicitly unknown');
select is(public.claim_own_prepared_cleanup_v1(repeat('d',64),pg_temp.cleanup_id()),null::jsonb,'competing claim cannot steal active cleanup');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64)),false,'unacknowledged payload blocks finish');
select throws_ok($$select public.check_own_prepared_cleanup_entry_v1(pg_temp.cleanup_id(),repeat('d',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='unknown'))$$,'42501','not_found','wrong cleanup claim refuses');
select throws_ok($$select public.ack_own_prepared_cleanup_entry_v1(pg_temp.cleanup_id(),repeat('c',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='unknown'),
 (select value#>'{entries,0}' from pub_receipts where label='cleanup'),jsonb_set(pg_temp.evidence(),'{byteCount}','8'))$$,
 '22023','invalid_cleanup_evidence','nonempty provider observation cannot complete cleanup');
select throws_ok($$select public.ack_own_prepared_cleanup_entry_v1(pg_temp.cleanup_id(),repeat('c',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='unknown'),
 (select value#>'{entries,0}' from pub_receipts where label='cleanup'),pg_temp.evidence()||'{"extra":true}')$$,
 '22023','invalid_cleanup_evidence','receipt is closed');
select is(pg_temp.ack_cleanup(),1,'exact tombstone observation acknowledged');
select lives_ok($$select public.release_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64))$$,'partial progress can release claim');
update pub_receipts set value=public.claim_own_prepared_cleanup_v1(repeat('d',64),pg_temp.cleanup_id()) where label='cleanup';
select is((select jsonb_array_length(value->'entries') from pub_receipts where label='cleanup'),0,'retry does not repeat an acknowledged provider operation');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('d',64)),true,'all exact payload evidence permits retirement');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('d',64)),true,'exact completed-claim retry is idempotent');
reset role;
select is((select count(*) from private.own_preparation_artifacts where job_id=pg_temp.job_id()),0::bigint,'frozen artifacts retired');
select is((select count(*) from private.own_preparation_checkpoints where job_id=pg_temp.job_id()),0::bigint,'checkpoint retired with scratch');
select is((select count(*) from private.own_preparation_jobs where id=pg_temp.job_id()),0::bigint,'frozen job retired for genuine new attempt');
set local role service_role;
update pub_receipts set value=public.enqueue_own_preparation_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id()) where label='job';
select isnt((select value->>'jobId' from pub_receipts where label='job'),pg_temp.job_id()::text,'actual new enqueue receives fresh job identity');
update pub_receipts set value=public.claim_next_own_preparation_v1(repeat('e',64)) where label='claim';
select lives_ok($$select public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))$$,'zero-artifact failed scan freezes');
select ok(public.prepare_due_prepared_scratch_v1()>=1,'server selector includes frozen zero-artifact work');
reset role;
update pub_receipts set value=to_jsonb((select id from private.own_prepared_cleanups where job_id=pg_temp.job_id() and state<>'complete')) where label='cleanup-id';
set local role service_role;
update pub_receipts set value=public.claim_own_prepared_cleanup_v1(repeat('c',64),(select (value#>>'{}')::uuid from pub_receipts where label='cleanup-id')) where label='cleanup';
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64)),true,'empty frozen selection safely retires');
-- Publish through the actual contract: one nonmember scratch plus two members.
update pub_receipts set value=public.enqueue_own_preparation_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id()) where label='job';
update pub_receipts set value=public.claim_next_own_preparation_v1(repeat('e',64)) where label='claim';
do $$declare a jsonb;i integer;begin for i in 0..2 loop
 a:=public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',i,'byteCount',8,'sha256',repeat('f',64)));
 a:=public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (a->>'artifactId')::uuid,a,repeat('1',32),repeat('2',32),repeat('f',64));
 insert into pub_receipts values('artifact'||i,a->'receipt');
end loop;end; $$;
insert into pub_receipts values('payload',jsonb_build_object('version','own-prepared-publication-v1',
 'rootArtifactId',(select value->>'artifactId' from pub_receipts where label='artifact2'),
 'memberIds',jsonb_build_array((select value->>'artifactId' from pub_receipts where label='artifact1'),(select value->>'artifactId' from pub_receipts where label='artifact2')),
 'summary',jsonb_build_object('version','own-prepared-summary-v1','sourceBuild','GRCh38','parserRevision','vcf-v1',
 'canonicalRevision','prepared-canonical-v1','sourceVariantCount',1,'sourceObservedCount',1,'sourceReferenceCount',0,
 'variantCount',1,'observedCallCount',1,'usableObservedCount',1,'attempted',0,'unmapped',0,'rsidPointerCount',2)));
insert into pub_receipts values('published',pg_temp.publication());
reset role;
update pub_receipts set value=to_jsonb(private.prepare_own_prepared_cleanup_v1(pg_temp.job_id(),'published-scratch')) where label='cleanup-id';
set local role service_role;
update pub_receipts set value=public.claim_own_prepared_cleanup_v1(repeat('c',64),(select (value#>>'{}')::uuid from pub_receipts where label='cleanup-id')) where label='cleanup';
select is((select jsonb_array_length(value->'entries') from pub_receipts where label='cleanup'),1,'only the nonmember scratch is selected');
select is((select value#>>'{entries,0,artifactId}' from pub_receipts where label='cleanup'),(select value->>'artifactId' from pub_receipts where label='artifact0'),'scratch identity is exact');
select is(pg_temp.ack_cleanup(),1,'only scratch receives tombstone acknowledgement');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64)),true,'published scratch retires independently');
select is(pg_temp.read_publication(),(select value from pub_receipts where label='published'),'published manifest and current reader remain exact after scratch purge');
-- Account path uses its real request and start contract inside a savepoint;
-- rollback restores this exact published fixture for independent file deletion.
savepoint account_path;
select public.issue_account_operation_nonce_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010','account_delete',repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table account_request as select * from public.request_account_deletion_v1(
 '89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',repeat('9',64),decode(repeat('ab',40),'hex'),repeat('8',64),repeat('7',64));
-- Existing account-deletion fixture technique: shift both fixed notice clocks
-- together, retaining the exact seven-day relationship and real worker claim.
reset role;
with deadline as(select clock_timestamp()-interval '8 days' requested_at)
update public.account_deletion_requests set requested_at=deadline.requested_at,notice_ends_at=deadline.requested_at+interval '7 days'
from deadline where id=(select deletion_id from account_request);
update public.retention_rows r set fixed_deadline=d.notice_ends_at from public.account_deletion_requests d
where r.target_id=d.account_id and d.id=(select deletion_id from account_request) and r.retention_id='account-deletion.notice-7d';
update public.retention_due_phases p set phase_deadline=d.notice_ends_at from public.account_deletion_requests d
where p.target_id=d.account_id and d.id=(select deletion_id from account_request) and p.retention_id='account-deletion.notice-7d';
grant select on account_request to service_role;
set local role service_role;
create temporary table account_claim as select * from public.claim_due_account_deletion_v1(repeat('6',64),300);
select is((select deletion_id from account_claim),(select deletion_id from account_request),'actual account worker starts the exact requested synthetic account');
select throws_ok($$select public.prepare_account_prepared_cleanup_v1((select deletion_id from account_request),repeat('0',64))$$,
 '42501','invalid_deletion_claim','wrong account claim cannot select prepared children');
insert into pub_receipts values('account-cleanup',public.prepare_account_prepared_cleanup_v1((select deletion_id from account_request),repeat('6',64)));
select is((select jsonb_array_length(value->'cleanupIds') from pub_receipts where label='account-cleanup'),1,'account selection contains exact prepared job');
update pub_receipts set value=public.claim_own_prepared_cleanup_v1(repeat('c',64),(select (value#>>'{cleanupIds,0}')::uuid from pub_receipts where label='account-cleanup')) where label='cleanup';
select is((select value->>'mode' from pub_receipts where label='cleanup'),'account','account cleanup uses persistent deletion authority after sessions removed');
select is(pg_temp.ack_cleanup(),2,'account selects remaining exact member payloads');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64)),true,'account prepared cleanup completes without resurrecting login authority');
reset role;
select is((select count(*) from private.own_preparation_jobs where account_id='89800000-0000-4000-8000-000000000001'),0::bigint,'account prepared children retired');
rollback to account_path;
set local role service_role;
insert into pub_receipts values('file-cleanup',public.prepare_own_prepared_file_cleanup_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id()));
update pub_receipts set value=public.claim_own_prepared_cleanup_v1(repeat('c',64),(select (value->>'cleanupId')::uuid from pub_receipts where label='file-cleanup')) where label='cleanup';
select is((select jsonb_array_length(value->'entries') from pub_receipts where label='cleanup'),2,'file delete selects both retained members');
select throws_ok($$select pg_temp.read_publication()$$,'42501','not_found','actual file deletion preparation fences source reads');
select is(pg_temp.ack_cleanup(),2,'file member payload observations acknowledged exactly');
select is(public.finish_own_prepared_cleanup_v1(pg_temp.cleanup_id(),repeat('c',64)),true,'exact file cleanup retires publication and job');
reset role;
select is((select count(*) from private.own_prepared_manifests where file_id=pg_temp.file_id()),0::bigint,'manifest absent after selected file cleanup');
select is((select count(*) from private.own_preparation_jobs where file_id=pg_temp.file_id()),0::bigint,'job absent after selected file cleanup');
select is((select count(*) from public.genome_files where id=pg_temp.file_id()),1::bigint,'original file deletion remains a separate existing contract');
select is((select count(*) from storage.objects where bucket_id='genomes' and name=(select receipt->>'finalKey' from finalizing_upload)),1::bigint,'prepared cleanup never deletes original storage');
select ok(not has_function_privilege('authenticated','public.claim_own_prepared_cleanup_v1(text,uuid)','execute'),'browser cannot claim cleanup');
select ok(not has_table_privilege('service_role','private.own_prepared_cleanup_entries','update'),'service cannot forge entry evidence directly');
select * from finish();
rollback;
