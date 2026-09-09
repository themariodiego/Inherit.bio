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

-- Metadata/authority assertions only: no R2 bytes are manufactured as evidence.
insert into pub_receipts values('r2',public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',0,'byteCount',8,'sha256',repeat('f',64))));
select is((select value->>'version' from pub_receipts where label='r2'),'own-preparation-artifact-v2','R2 receipt has explicit version');
select is((select value->>'provider' from pub_receipts where label='r2'),'r2','R2 provider explicit');
select is((select value->>'bucket' from pub_receipts where label='r2'),'inherit-prepared-test','R2 bucket comes from server config');
select throws_ok($$select public.ack_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='r2'),gen_random_uuid(),
 (select value from pub_receipts where label='r2'),repeat('f',64))$$,'42501','not_found','Supabase ACK cannot satisfy R2 reservation');
select throws_ok($$select public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='r2'),
 (select value from pub_receipts where label='r2'),null,repeat('2',32),repeat('f',64))$$,'22023','invalid_request','Missing provider version refused');
select throws_ok($$select public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='r2'),
 (select value from pub_receipts where label='r2'),repeat('1',32),repeat('2',32),repeat('0',64))$$,'42501','not_found','Wrong observed hash refused');
insert into pub_receipts values('stored',public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='r2'),
 (select value from pub_receipts where label='r2'),repeat('1',32),repeat('2',32),repeat('f',64)));
select ok(not (select value ? 'storageObjectId' from pub_receipts where label='stored'),'No invented Supabase object UUID');
select is((select value->>'providerVersion' from pub_receipts where label='stored'),repeat('1',32),'Provider version bound to ACK');
select throws_ok($$select public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (select (value->>'artifactId')::uuid from pub_receipts where label='r2'),
 (select value from pub_receipts where label='r2'),repeat('3',32),repeat('2',32),repeat('f',64))$$,'42501','not_found','Replay with other version refused');
reset role;
select is((select count(*) from storage.objects where name=(select value->>'objectKey' from pub_receipts where label='r2')),0::bigint,'No Storage row created for R2');
select is(private.own_preparation_cleanup_locator_v1((select (value->>'artifactId')::uuid from pub_receipts where label='r2'))->>'providerVersion',repeat('1',32),'Cleanup gets same exact R2 version');
select throws_ok($$update private.own_preparation_artifacts set provider_version=repeat('4',32)
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='r2')$$,'22023','preparation_identity_immutable','ACK provider identity immutable');
select ok(not has_function_privilege('authenticated','public.ack_own_preparation_r2_artifact_v1(uuid,uuid,text,uuid,jsonb,text,text,text)','execute'),'Browser cannot ACK provider artifacts');
select ok(not has_function_privilege('service_role','private.own_preparation_cleanup_locator_v1(uuid)','execute'),'Locator not independently exposed to service');
select * from finish();
rollback;
