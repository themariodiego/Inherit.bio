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
insert into storage.objects(id,bucket_id,name,version,metadata) values('89800000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),gen_random_uuid()::text,'{"size":8}');
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

-- SQL authority/metadata only. Provider deletion is a separate actual service
-- test. This fixture never claims its synthetic Storage metadata is a blob.
reset role;
select is((select enabled from private.own_original_retention_config where singleton),false,'original retirement starts disabled');
select is((select count(*) from private.own_original_retirements),0::bigint,'no old-source backfill');
update private.own_original_retention_config set enabled=true,applies_after=clock_timestamp()-interval '2 months' where singleton;
set local role service_role;
do $$declare artifact jsonb;i integer;begin for i in 0..2 loop
 artifact:=public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 jsonb_build_object('kind','container','sequence',i,'byteCount',8,'sha256',repeat('f',64)));
 artifact:=public.ack_own_preparation_r2_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 (artifact->>'artifactId')::uuid,artifact,repeat('1',32),repeat('2',32),repeat('f',64));
 insert into pub_receipts values('artifact'||i,artifact->'receipt');
end loop;end; $$;
insert into pub_receipts values('payload',jsonb_build_object('version','own-prepared-publication-v1',
 'rootArtifactId',(select value->>'artifactId' from pub_receipts where label='artifact2'),
 'memberIds',jsonb_build_array((select value->>'artifactId' from pub_receipts where label='artifact1'),(select value->>'artifactId' from pub_receipts where label='artifact2')),
 'summary',jsonb_build_object('version','own-prepared-summary-v1','sourceBuild','GRCh38','parserRevision','vcf-v1',
 'canonicalRevision','prepared-canonical-v1','sourceVariantCount',1,'sourceObservedCount',1,'sourceReferenceCount',0,
 'variantCount',1,'observedCallCount',1,'usableObservedCount',1,'attempted',0,'unmapped',0,'rsidPointerCount',2)));
reset role;
-- Time-controlled synthetic source only, BEFORE actual publication captures the
-- immutable date. No consent/signature/source identity fields are backdated.
update public.genome_files set created_at=clock_timestamp()-interval '1 month'+interval '1 second' where id=pg_temp.file_id();
set local role service_role;
insert into pub_receipts values('published',pg_temp.publication());
insert into pub_receipts values('download',public.authorize_own_prepared_original_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id(),null));
select is(public.authorize_own_prepared_original_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id(),(select value->'source' from pub_receipts where label='download')),
 (select value from pub_receipts where label='download'),'live chunk authorization returns same captured source/deadline');
select is(public.claim_own_original_retirement_v1(repeat('c',64)),null::jsonb,'original cannot retire before its immutable deadline');
reset role;
select is((select expires_at from private.own_original_retirements where file_id=pg_temp.file_id()),
 (select created_at+interval '1 month' from public.genome_files where id=pg_temp.file_id()),'fixed calendar month anchored in actual source timestamp');
select throws_ok($$update private.own_original_retirements set expires_at=expires_at+interval '1 day' where file_id=pg_temp.file_id()$$,
 '22023','original_retirement_immutable','retention deadline cannot be renewed');
do $$declare due timestamptz;begin select expires_at into due from private.own_original_retirements where file_id=pg_temp.file_id();
 if due>clock_timestamp()+interval '2 seconds' then raise exception 'fixture clock is not bounded';end if;
 perform pg_sleep(greatest(0,extract(epoch from due-clock_timestamp()))+0.01);end; $$;
set local role service_role;
select is(public.own_original_download_state_v1('89800000-0000-4000-8000-000000000001',pg_temp.file_id())->>'retired','true','new download refuses at expiry even before worker deletion');
select throws_ok($$select public.authorize_own_prepared_original_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id(),(select value->'source' from pub_receipts where label='download'))$$,
 '55000','original_retired','already-captured original stream cannot authorize another chunk after expiry');
insert into pub_receipts values('retirement',public.claim_own_original_retirement_v1(repeat('c',64)));
select is((select value->>'fileId' from pub_receipts where label='retirement'),pg_temp.file_id()::text,'server claims exact synthetic original');
select is(public.claim_own_original_retirement_v1(repeat('d',64)),null::jsonb,'competing worker cannot steal lease');
select is(public.check_own_original_retirement_v1(pg_temp.file_id(),repeat('c',64)),(select value from pub_receipts where label='retirement'),'pre-delete check binds exact known physical version');
select throws_ok($$select public.check_own_original_retirement_v1(pg_temp.file_id(),repeat('d',64))$$,'42501','not_found','wrong claim cannot authorize original delete');
insert into pub_receipts values('delete-evidence',jsonb_build_object('version','own-original-delete-evidence-v1','provider','supabase','disposition','original-payload-deleted',
 'objectId',(select value->'objectId' from pub_receipts where label='retirement'),'objectKey',(select value->'objectKey' from pub_receipts where label='retirement'),
 'storageVersion',(select value->'storageVersion' from pub_receipts where label='retirement'),'byteCount',8,'sha256',repeat('a',64)));
select throws_ok($$select public.finish_own_original_retirement_v1(pg_temp.file_id(),repeat('c',64),
 (select value from pub_receipts where label='retirement'),(select value from pub_receipts where label='delete-evidence'))$$,
 '42501','not_found','provider evidence alone cannot finish while exact Storage metadata remains');
select throws_ok($$update storage.objects set metadata='{"size":8}' where id='89800000-0000-4000-8000-000000000020'$$,
 '42501','upload_unavailable','existing final-copy guard still refuses original overwrite during retirement');
-- Simulate ONLY the metadata side of provider deletion under the fixture's
-- trusted callback contract. Actual known-version/.info absence is external proof.
delete from storage.objects where id='89800000-0000-4000-8000-000000000020';
select throws_ok($$select pg_temp.read_publication()$$,'42501','not_found','metadata disappearance alone does not make a retired prepared source readable');
select throws_ok($$select public.finish_own_original_retirement_v1(pg_temp.file_id(),repeat('c',64),
 (select value from pub_receipts where label='retirement'),(select value||'{"extra":true}' from pub_receipts where label='delete-evidence'))$$,
 '22023','invalid_original_delete_evidence','provider receipt is closed');
select is(public.finish_own_original_retirement_v1(pg_temp.file_id(),repeat('c',64),
 (select value from pub_receipts where label='retirement'),(select value from pub_receipts where label='delete-evidence')),true,'exact acknowledged retirement commits');
select is(pg_temp.read_publication(),(select value from pub_receipts where label='published'),'verified prepared source survives confirmed original retirement');
reset role;
select ok(private.own_report_source_metadata_v1('89800000-0000-4000-8000-000000000001',pg_temp.file_id(),true) ? 'preparedSource','report source metadata accepts exact retired provenance');
select is(private.own_export_source_v1('89800000-0000-4000-8000-000000000001','89800000-0000-4000-8000-000000000010',pg_temp.file_id())->>'normalized','true','full canonical export remains genuinely normalized');
select is((select count(*) from public.genome_storage_objects where genome_file_id=pg_temp.file_id()),1::bigint,'immutable original identity retained for source and exact eventual deletion');
select is((select count(*) from private.own_prepared_manifest_members where manifest_id=(select (value->>'manifestId')::uuid from pub_receipts where label='published')),2::bigint,'no prepared payload member removed');
select ok(not has_function_privilege('authenticated','public.finish_own_original_retirement_v1(uuid,text,jsonb,jsonb)','execute'),'browser cannot attest provider deletion');
select ok(not has_table_privilege('service_role','private.own_original_retirements','update'),'service cannot bypass exact retirement RPC');
select * from finish();
rollback;
