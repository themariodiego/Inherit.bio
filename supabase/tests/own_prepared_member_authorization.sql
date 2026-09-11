begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Synthetic member-authority fixture. Actual signed issuance/finalization and
-- publication RPCs; Storage rows prove metadata only, not provider bytes.
insert into auth.users(id,email,email_confirmed_at) values('89900000-0000-4000-8000-000000000001','prepared-member@example.invalid',clock_timestamp());
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
insert into storage.objects(id,bucket_id,name,version,metadata) values('89900000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),gen_random_uuid()::text,'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89900000-0000-4000-8000-000000000001','89900000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89900000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- This fixture verifies SQL authority and metadata only. Storage bytes and the
-- final canonical/rsID root are NOT proved by synthetic Storage rows.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89900000-0000-4000-8000-000000000011','89900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update private.own_preparation_config set enabled=true where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.publication(p jsonb default null,session_id uuid default '89900000-0000-4000-8000-000000000010',
 claim_hash text default repeat('e',64)) returns jsonb language sql as $$
 select public.publish_own_prepared_manifest_v1('89900000-0000-4000-8000-000000000001',session_id,
 pg_temp.job_id(),pg_temp.attempt_id(),claim_hash,coalesce(p,(select value from pub_receipts where label='payload'))); $$;
create function pg_temp.read_publication(session_id uuid default '89900000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_prepared_manifest_v1('89900000-0000-4000-8000-000000000001',session_id,pg_temp.file_id(),null); $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
select throws_ok($$select public.own_upload_normalization_v1('begin','89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id(),null,null)$$,
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
select throws_ok($$select public.check_own_prepared_member_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id(),gen_random_uuid(),
 (select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'))$$,
 '42501','not_found','ACKed data is not readable before publication');
insert into pub_receipts values('published',pg_temp.publication());
reset role;
create function pg_temp.manifest_id() returns uuid language sql as $$
 select (value->>'manifestId')::uuid from pub_receipts where label='published'; $$;
create function pg_temp.check_member(p_label text default 'artifact1',reader_session uuid default '89900000-0000-4000-8000-000000000010')
returns jsonb language sql as $$
 select public.check_own_prepared_member_v1('89900000-0000-4000-8000-000000000001',reader_session,
 pg_temp.file_id(),pg_temp.manifest_id(),(select (value->>'artifactId')::uuid from pub_receipts where pub_receipts.label=p_label)); $$;
set local role service_role;
select is(pg_temp.check_member('artifact2'),(select jsonb_build_object('version','own-prepared-member-v1',
 'manifestId',value->'manifestId','fileId',value->'fileId','membershipSha256',value->'membershipSha256',
 'member',value->'root') from pub_receipts where label='published'),
 'root member response is the exact closed registered receipt and Storage identity');
select is(pg_temp.check_member()->'member'->'receipt',(select value from pub_receipts where label='artifact1'),
 'selected data member returns its exact original registered receipt');
select is(pg_temp.read_publication(),(select value from pub_receipts where label='published'),
 'factored full reader preserves the exhaustive publication response');
select throws_ok($$select pg_temp.check_member('artifact0')$$,'42501','not_found','ACKed intermediate scratch is not a final member');
select throws_ok($$select pg_temp.check_member('unknown')$$,'42501','not_found','unknown member refuses');
select throws_ok($$select public.check_own_prepared_member_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id(),null,
 (select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'))$$,
 '42501','not_found','per-object check requires an exact expected manifest');
select throws_ok($$select public.check_own_prepared_member_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id(),gen_random_uuid(),
 (select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'))$$,
 '42501','not_found','different expected manifest cannot reuse a real member');
select throws_ok($$select public.check_own_prepared_member_v1('89900000-0000-4000-8000-000000000001',
 '89900000-0000-4000-8000-000000000010',gen_random_uuid(),pg_temp.manifest_id(),
 (select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'))$$,
 '42501','not_found','different file cannot reuse the real manifest and member');
select throws_ok($$select public.check_own_prepared_member_v1(gen_random_uuid(),
 '89900000-0000-4000-8000-000000000010',pg_temp.file_id(),pg_temp.manifest_id(),
 (select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'))$$,
 '42501','not_found','different account cannot reuse source/member identifiers');
select throws_ok($$select pg_temp.check_member('artifact1',gen_random_uuid())$$,'42501','not_found','missing current session refuses');
reset role;

-- Each refusal rolls back its controlled mutation via throws_ok's subtransaction.
create function pg_temp.member_after_file_type_change() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin update public.genome_files set file_type='gvcf' where id=pg_temp.file_id(); return pg_temp.check_member(); end; $$;
create function pg_temp.member_after_partial_source_revision_change() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin update public.genome_files set upload_revision=upload_revision+1 where id=pg_temp.file_id(); return pg_temp.check_member(); end; $$;
create function pg_temp.member_after_source_revision_change() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 -- Keep the completed-file constraint coherent. Neither revision is part of
 -- guard_structural_file_identity_v1's immutable tuple; the published source
 -- receipt must independently refuse this now-different revision.
 update public.genome_files set upload_revision=upload_revision+1,
  normalization_source_revision=normalization_source_revision+1 where id=pg_temp.file_id();
 return pg_temp.check_member();
end; $$;
create function pg_temp.member_after_delete_prepare() returns jsonb language plpgsql as $$
begin
 perform public.prepare_genome_file_deletion_v1('89900000-0000-4000-8000-000000000001',
  '89900000-0000-4000-8000-000000000010',pg_temp.file_id());
 return pg_temp.check_member();
end; $$;
create function pg_temp.member_after_missing_object(p_label text) returns jsonb language plpgsql as $$
begin
 delete from storage.objects where bucket_id='genomes' and name=(select value->>'objectKey' from pub_receipts where pub_receipts.label=p_label);
 return pg_temp.check_member();
end; $$;
create function pg_temp.member_after_account_deletion() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin update public.profiles set deletion_requested_at=clock_timestamp() where id='89900000-0000-4000-8000-000000000001'; return pg_temp.check_member(); end; $$;
create function pg_temp.member_after_lifecycle_change() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin update public.subjects set lifecycle='restricted' where id=(select id from generation_subject); return pg_temp.check_member(); end; $$;
create function pg_temp.member_after_store_withdrawal() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where id=(select (authority->>'uploadConsentId')::uuid from private.own_preparation_jobs where id=pg_temp.job_id())
  and account_id='89900000-0000-4000-8000-000000000001' and subject_id=(select id from generation_subject)
  and consent_type='upload_class' and scope=array['store'] and revoked_at is null;
 return pg_temp.check_member();
end; $$;
set local role service_role;
select throws_ok($$select pg_temp.member_after_file_type_change()$$,'42501','not_found','member gate preserves exact captured file type');
select throws_ok($$select pg_temp.member_after_partial_source_revision_change()$$,'23514',
 'new row for relation "genome_files" violates check constraint "normalization_source_completion"',
 'partial source revision change is rejected by the completed-file constraint');
select throws_ok($$select pg_temp.member_after_source_revision_change()$$,'42501','not_found','changed source revision refuses member');
select throws_ok($$select pg_temp.member_after_delete_prepare()$$,'42501','not_found','real file deletion preparation fences member reads');
select throws_ok($$select pg_temp.member_after_missing_object('artifact1')$$,'42501','not_found','missing selected exact Storage object refuses');
select throws_ok($$select pg_temp.member_after_account_deletion()$$,'42501','not_found','pending account deletion refuses member');
select throws_ok($$select pg_temp.member_after_lifecycle_change()$$,'42501','not_found','restricted source subject refuses member');
select throws_ok($$select pg_temp.member_after_store_withdrawal()$$,'55000','upload_consent_required','current exact store withdrawal refuses member');
reset role;
select is((select count(*)::integer from private.genome_file_deletions where file_id=pg_temp.file_id()),0,'deletion denial probe rolls back disposition');
select is((select file_type::text from public.genome_files where id=pg_temp.file_id()),'vcf','file-type denial probe preserves original metadata');

-- An unrelated missing member must still fail the EXHAUSTIVE full reader.
-- The point check intentionally verifies only its exact target; final full
-- reads remain required and this test proves it does not call that scan.
create temporary sequence target_member_checked;
create function pg_temp.check_target_then_exhaustive() returns jsonb language plpgsql as $$
begin
 delete from storage.objects where bucket_id='genomes' and name=(select value->>'objectKey' from pub_receipts where label='artifact2');
 perform pg_temp.check_member('artifact1');
 perform nextval('pg_temp.target_member_checked');
 return pg_temp.read_publication();
end; $$;
grant usage,select on sequence target_member_checked to service_role;
set local role service_role;
select throws_ok($$select pg_temp.check_target_then_exhaustive()$$,'42501','not_found','full reader retains unrelated-member integrity validation');
reset role;
select ok((select is_called from target_member_checked),'targeted check succeeded without scanning the unrelated missing member');

-- Final clock fence after response construction, not merely before the lookup.
-- A temporary receipt hook delays only this exact synthetic member and restores
-- the original definition immediately after the bounded rollback-only probe.
create temporary table original_member_receipt_function as select pg_get_functiondef(
 'private.own_preparation_artifact_receipt_v1(private.own_preparation_artifacts)'::regprocedure) body;
create temporary sequence member_receipt_entered;
create or replace function private.own_preparation_artifact_receipt_v1(a private.own_preparation_artifacts)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare due timestamptz;
begin
 if current_setting('test.prepared_member_expiry',true)='on' and a.job_id=pg_temp.job_id()
  and a.id=(select (value->>'artifactId')::uuid from pg_temp.pub_receipts where label='artifact1') then
  perform nextval('pg_temp.member_receipt_entered');
  select not_after into due from auth.sessions where id='89900000-0000-4000-8000-000000000010';
  if due is null or due>clock_timestamp()+interval '1 second' then raise exception 'fixture deadline is not bounded'; end if;
  perform pg_sleep(greatest(0,extract(epoch from due-clock_timestamp()))+0.01);
 end if;
 return jsonb_build_object('version','own-preparation-artifact-v1','artifactId',a.id,'jobId',a.job_id,
  'attemptId',a.attempt_id,'sequence',a.sequence,'bucket','genomes','objectKey',a.object_key,
  'byteCount',a.byte_count,'sha256',a.sha256,'writeExpiresAt',a.write_expires_at);
end; $$;
create function pg_temp.member_crossing_deadline() returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform set_config('test.prepared_member_expiry','on',true);
 update auth.sessions set not_after=clock_timestamp()+interval '500 milliseconds' where id='89900000-0000-4000-8000-000000000010';
 return pg_temp.check_member();
end; $$;
set local role service_role;
select throws_ok($$select pg_temp.member_crossing_deadline()$$,'42501','not_found','member deadline crossing after final authority check refuses response');
reset role;
select ok((select is_called from member_receipt_entered),'expiry probe reached exact member response construction');
do $$begin execute (select body from original_member_receipt_function); end; $$;
select is(pg_get_functiondef('private.own_preparation_artifact_receipt_v1(private.own_preparation_artifacts)'::regprocedure),
 (select body from original_member_receipt_function),'temporary deadline hook restores exact original definition');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='89900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.check_member()$$,'42501','not_found','expired current session refuses member');
select is(pg_temp.check_member('artifact2','89900000-0000-4000-8000-000000000011')->'member',
 (select value->'root' from pub_receipts where label='published'),'fresh current reader works after originating preparation session expires');
select is(pg_temp.read_publication('89900000-0000-4000-8000-000000000011'),(select value from pub_receipts where label='published'),
 'full reader also retains current-session replay semantics after factoring');
reset role;
select ok(not has_function_privilege('anon','public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
 'anonymous callers cannot invoke member authorization');
select ok(not has_function_privilege('authenticated','public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
 'authenticated clients have no direct genetic-member RPC');
select ok(not has_function_privilege('inherit_upload_only','public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
 'upload-only role cannot read prepared members');
select ok(has_function_privilege('service_role','public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),
 'service receives only the narrow current-authority wrapper');
select ok(not has_function_privilege('service_role','private.own_prepared_read_context_v1(uuid,uuid,uuid,uuid)','EXECUTE'),
 'unfinished source context cannot be called directly by service');
select ok(not has_table_privilege('service_role','private.own_prepared_manifest_members','SELECT'),
 'no table privilege bypass accompanies the member RPC');
select * from finish();
rollback;
