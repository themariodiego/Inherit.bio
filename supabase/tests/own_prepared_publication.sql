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
update private.own_preparation_config set enabled=true where singleton;
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
do $$declare a jsonb; object_id uuid; i integer; begin
 for i in 0..2 loop
  a:=public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
   jsonb_build_object('kind','container','sequence',i,'byteCount',8,'sha256',repeat('f',64)));
  insert into storage.objects(bucket_id,name,version,metadata) values('genomes',a->>'objectKey',gen_random_uuid()::text,'{"size":8}')
   returning id into object_id;
  a:=public.ack_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
   (a->>'artifactId')::uuid,object_id,a,repeat('f',64));
  insert into pub_receipts values('artifact'||i,a);
 end loop;
end; $$;
insert into pub_receipts values('payload',jsonb_build_object('version','own-prepared-publication-v1',
 'rootArtifactId',(select value->>'artifactId' from pub_receipts where label='artifact2'),
 'memberIds',jsonb_build_array((select value->>'artifactId' from pub_receipts where label='artifact1'),
  (select value->>'artifactId' from pub_receipts where label='artifact2')),
 'summary',jsonb_build_object('version','own-prepared-summary-v1','sourceBuild','GRCh38','parserRevision','vcf-v1',
 'canonicalRevision','prepared-canonical-v1','sourceVariantCount',1,'sourceObservedCount',1,'sourceReferenceCount',0,
 'variantCount',1,'observedCallCount',1,'usableObservedCount',1,'attempted',0,'unmapped',0,'rsidPointerCount',2)));
select throws_ok($$select pg_temp.read_publication()$$,'42501','not_found','unpublished source is not readable');
select throws_ok($$select pg_temp.publication(null,'89800000-0000-4000-8000-000000000011')$$,
 '42501','not_found','first publication requires the actual originating session');
select throws_ok($$select pg_temp.publication(null,'89800000-0000-4000-8000-000000000010',repeat('0',64))$$,
 '42501','not_found','wrong claim refuses publication');
select throws_ok($$select public.publish_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',gen_random_uuid(),pg_temp.attempt_id(),repeat('e',64),
 (select value from pub_receipts where label='payload'))$$,'42501','not_found','unknown job refuses');
select throws_ok($$select public.publish_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.job_id(),gen_random_uuid(),repeat('e',64),
 (select value from pub_receipts where label='payload'))$$,'42501','not_found','wrong attempt refuses');
select throws_ok($$select pg_temp.publication((select value||'{"extra":true}'::jsonb from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','publication payload is closed');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,variantCount}','null') from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','NULL count does not bypass validation');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,variantCount}','2') from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','normalized count cannot exceed original variants');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,sourceBuild}','"GRCh39"') from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','unsupported source build refuses');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,attempted}','1') from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','GRCh38 retains zero liftover-attempt semantics');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,rsidPointerCount}','3') from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','pointer count cannot exceed original variant and observation evidence');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{memberIds}',jsonb_build_array(value->>'rootArtifactId',value->>'rootArtifactId')) from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','duplicate member IDs refuse');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{memberIds}',jsonb_build_array(gen_random_uuid(),value->>'rootArtifactId')) from pub_receipts where label='payload'))$$,
 '22023','publication_members_invalid','unregistered member refuses');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{rootArtifactId}',to_jsonb(gen_random_uuid())) from pub_receipts where label='payload'))$$,
 '22023','invalid_publication','root must be in the exact final membership');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{rootArtifactId}',value->'memberIds'->0) from pub_receipts where label='payload'))$$,
 '22023','publication_members_invalid','root is written after its selected members');
reset role;
create temporary table original_claim as select claim_expires_at from private.own_preparation_jobs where id=pg_temp.job_id();
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.job_id();
set local role service_role;
select throws_ok($$select pg_temp.publication()$$,'42501','not_found','expired claim refuses before publication');
reset role;
update private.own_preparation_jobs set claim_expires_at=(select claim_expires_at from original_claim) where id=pg_temp.job_id();
-- Each expected refusal rolls back the real disposition/metadata operation
-- inside throws_ok's subtransaction, retaining the valid source for publication.
create function pg_temp.publish_after_delete_prepare() returns jsonb language plpgsql as $$
begin
 perform public.prepare_genome_file_deletion_v1('89800000-0000-4000-8000-000000000001',
  '89800000-0000-4000-8000-000000000010',pg_temp.file_id());
 return pg_temp.publication();
end; $$;
create function pg_temp.publish_after_missing_root() returns jsonb language plpgsql as $$
begin
 delete from storage.objects where bucket_id='genomes' and name=(select value->>'objectKey' from pub_receipts where label='artifact2');
 return pg_temp.publication();
end; $$;
create temporary sequence publication_insert_entered;
create function pg_temp.expire_publication_after_insert() returns trigger language plpgsql as $$
declare due timestamptz;
begin
 if current_setting('test.prepared_publication_expiry',true)='on' and new.file_id=pg_temp.file_id() then
  perform nextval('pg_temp.publication_insert_entered');
  select claim_expires_at into due from private.own_preparation_jobs where id=new.job_id;
  if due>clock_timestamp()+interval '1 second' then raise exception 'fixture deadline is not bounded'; end if;
  perform pg_sleep(greatest(0,extract(epoch from due-clock_timestamp()))+0.01);
 end if;
 return new;
end; $$;
create trigger fixture_publication_expiry after insert on private.own_prepared_manifests
 for each row execute function pg_temp.expire_publication_after_insert();
create function pg_temp.publish_crossing_deadline() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform set_config('test.prepared_publication_expiry','on',true);
 update private.own_preparation_jobs set claim_expires_at=clock_timestamp()+interval '500 milliseconds' where id=pg_temp.job_id();
 return pg_temp.publication();
end; $$;
set local role service_role;
select throws_ok($$select pg_temp.publish_after_delete_prepare()$$,'42501','not_found','actual deletion preparation fences initial publication');
select throws_ok($$select pg_temp.publish_after_missing_root()$$,'42501','not_found','missing exact root Storage metadata refuses');
select throws_ok($$select pg_temp.publish_crossing_deadline()$$,'42501','not_found','deadline crossing after manifest INSERT rolls back publication');
reset role;
select ok((select is_called from publication_insert_entered),'terminal-expiry probe really entered manifest INSERT');
select is((select count(*)::integer from private.own_prepared_manifests),0,'terminal expiry leaves no published manifest');
select is((select count(*)::integer from private.own_prepared_manifest_members),0,'terminal expiry leaves no published members');
select ok((select normalization_completed_at is null from public.genome_files where id=pg_temp.file_id()),'terminal expiry leaves file unprepared');
select is((select count(*)::integer from private.genome_file_deletions where file_id=pg_temp.file_id()),0,'failed publication disposition probe rolled back');
drop trigger fixture_publication_expiry on private.own_prepared_manifests;
set local role service_role;
insert into pub_receipts values('published',pg_temp.publication());
select is(pg_temp.read_publication(),(select value from pub_receipts where label='published'),'actual current-session source read returns exact publication');
select is(pg_temp.publication(),(select value from pub_receipts where label='published'),'identical publication replay is stable');
select throws_ok($$select pg_temp.publication((select jsonb_set(value,'{summary,rsidPointerCount}','1') from pub_receipts where label='payload'))$$,
 '22023','publication_replay_conflict','replay cannot replace published summary/root');
select throws_ok($$select public.freeze_own_preparation_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64))$$,
 '55000','prepared_source_published','ordinary worker cancellation cannot freeze a published source');
select is(public.freeze_due_own_preparations_v1()->>'frozen','0','scratch expiry scanner skips published jobs');
select throws_ok($$select public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
 '{"kind":"container","sequence":3,"byteCount":8,"sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}')$$,
 '42501','not_found','published job cannot reserve again');
select throws_ok($$select public.own_upload_normalization_v1('begin','89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000010',pg_temp.file_id(),null,null)$$,
 '55000','prepared_backend_reserved','legacy begin cannot overwrite a published backend');
reset role;
create function pg_temp.read_after_file_type_change() returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.genome_files set file_type='gvcf' where id=pg_temp.file_id();
 return pg_temp.read_publication();
end; $$;
select throws_ok($$select pg_temp.read_after_file_type_change()$$,'42501','not_found',
 'published reader rejects actual file-type change against immutable source');
select is((select file_type::text from public.genome_files where id=pg_temp.file_id()),'vcf',
 'refused file-type mutation probe rolls back to the original source');
select is((select count(*)::integer from private.own_normalization_runs where file_id=pg_temp.file_id()),0,'publication creates no fake normalization run');
select is((select count(*)::integer from private.own_prepared_manifest_members),2,'only the exact two final members are published');
select is((select count(*)::integer from private.own_preparation_artifacts where job_id=pg_temp.job_id()),3,'intermediate scratch stays registered for real cleanup');
select ok((select f.normalization_completed_at=m.published_at and f.normalization_source_revision=f.upload_revision
 and f.variant_count=1 and f.build='GRCh38' from public.genome_files f join private.own_prepared_manifests m on m.file_id=f.id
 where f.id=pg_temp.file_id()),'file completion metadata and manifest publish atomically');
select throws_ok($$update private.own_prepared_manifests set membership_sha256=repeat('0',64) where file_id=pg_temp.file_id()$$,
 '22023','prepared_manifest_immutable','manifest identity cannot be updated');
select throws_ok($$insert into private.own_prepared_manifest_members(manifest_id,artifact_id)
 select m.id,(r.value->>'artifactId')::uuid from private.own_prepared_manifests m cross join pub_receipts r
 where m.file_id=pg_temp.file_id() and r.label='artifact0'$$,'22023','prepared_manifest_immutable','cannot append final membership after publication');
select throws_ok($$update private.own_preparation_jobs set state='queued' where id=pg_temp.job_id()$$,
 '22023','preparation_identity_immutable','published job cannot be reopened');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='89800000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.read_publication()$$,'42501','not_found','expired current reader session refuses');
select is(pg_temp.read_publication('89800000-0000-4000-8000-000000000011'),(select value from pub_receipts where label='published'),
 'old preparation session expiry does not revoke a distinct current reader');
select is(pg_temp.publication(null,'89800000-0000-4000-8000-000000000011',null),(select value from pub_receipts where label='published'),
 'replay uses current owner authority rather than stale preparation credentials');
select throws_ok($$select public.read_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000011',gen_random_uuid(),null)$$,'42501','not_found','different source cannot read publication');
select throws_ok($$select public.read_own_prepared_manifest_v1('89800000-0000-4000-8000-000000000001',
 '89800000-0000-4000-8000-000000000011',pg_temp.file_id(),gen_random_uuid())$$,'42501','not_found','wrong expected manifest refuses');
reset role;
-- The real consent state requires timestamp and reason together. Withdraw
-- only this job's exact signed store consent, matching existing upload fixtures.
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where id=(select (authority->>'uploadConsentId')::uuid from private.own_preparation_jobs where id=pg_temp.job_id())
 and account_id='89800000-0000-4000-8000-000000000001' and subject_id=(select id from generation_subject)
 and consent_type='upload_class' and scope=array['store'] and revoked_at is null;
select ok((select revoked_at is not null and revocation_reason='withdrawn' from public.subject_consents
 where id=(select (authority->>'uploadConsentId')::uuid from private.own_preparation_jobs where id=pg_temp.job_id())),
 'exact originating signed store consent has a valid withdrawn state');
set local role service_role;
select throws_ok($$select pg_temp.read_publication('89800000-0000-4000-8000-000000000011')$$,
 '55000','upload_consent_required','current store withdrawal denies published reads');
reset role;
select ok(not has_function_privilege('authenticated','public.read_own_prepared_manifest_v1(uuid,uuid,uuid,uuid)','EXECUTE'),
 'reader is not a public genetic-read RPC');
select ok(not has_table_privilege('service_role','private.own_prepared_manifests','SELECT'), 'service has no direct manifest table access');
select ok(has_function_privilege('service_role','public.publish_own_prepared_manifest_v1(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE'),
 'only narrow service publication wrapper is available');
select * from finish();
rollback;
