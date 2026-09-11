begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('90000000-0000-4000-8000-000000000001','prepared-report@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='90000000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='90000000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'90000000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,version,metadata) values('90000000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),gen_random_uuid()::text,'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '90000000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- This fixture verifies SQL authority and metadata only. Storage bytes and the
-- final canonical/rsID root are NOT proved by synthetic Storage rows.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000001',now(),now(),'aal1');
update private.own_preparation_config set enabled=true where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.publication(p jsonb default null,session_id uuid default '90000000-0000-4000-8000-000000000010',
 claim_hash text default repeat('e',64)) returns jsonb language sql as $$
 select public.publish_own_prepared_manifest_v1('90000000-0000-4000-8000-000000000001',session_id,
 pg_temp.job_id(),pg_temp.attempt_id(),claim_hash,coalesce(p,(select value from pub_receipts where label='payload'))); $$;
create function pg_temp.read_publication(session_id uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_prepared_manifest_v1('90000000-0000-4000-8000-000000000001',session_id,pg_temp.file_id(),null); $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
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
insert into pub_receipts values('published',pg_temp.publication());
reset role;
update private.own_preparation_config set enabled=false where singleton;

-- All assertions below run through the actual service-only export RPC; owner
-- metadata mutation is confined to rollback savepoints and never disables guards.
create temporary table export_snapshots(label text primary key,value jsonb);
grant all on export_snapshots to service_role;
create function pg_temp.export_source(sid uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select private.own_export_source_v1('90000000-0000-4000-8000-000000000001',sid,pg_temp.file_id()); $$;
create function pg_temp.export_content(op text,selected jsonb default null,
 sid uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.own_subject_export_content_v1(op,'90000000-0000-4000-8000-000000000001',sid,
 case when op='list' then null else pg_temp.file_id() end,
 case when op='list' then null else coalesce(selected,(select value from export_snapshots where label='prepared')) end,0); $$;
set local role service_role;
insert into export_snapshots values('prepared',pg_temp.export_source());
select is((select value->'preparedSource' from export_snapshots where label='prepared'),
 (select jsonb_build_object('version','own-prepared-report-source-v1','backend','prepared-object-v1',
 'manifestId',value->'manifestId','membershipSha256',value->'membershipSha256',
 'rootArtifactId',value#>'{root,receipt,artifactId}','rootSha256',value#>'{root,receipt,sha256}') from pub_receipts where label='published'),
 'export captures exact immutable publication and membership');
select is((select value->>'normalized' from export_snapshots where label='prepared'),'true','prepared source is explicitly normalized');
select is((select value#>>'{file,variant_count}' from export_snapshots where label='prepared'),'1','actual published normalized count is retained');
select is((select (value#>>'{binding,normalizedAt}')::timestamptz from export_snapshots where label='prepared'),
 (select (value->>'preparedAt')::timestamptz from pub_receipts where label='published'),'export uses actual publication time');
select is(pg_temp.export_content('check'),(select value from export_snapshots where label='prepared'),'exact current snapshot checks');
select is(pg_temp.export_content('list')->0,(select value from export_snapshots where label='prepared'),'list retains prepared backend');
select throws_ok($$select pg_temp.export_content('variants')$$,'55000','prepared_object_reader_required','no prepared-to-empty variant fallback');
select throws_ok($$select pg_temp.export_content('observed')$$,'55000','prepared_object_reader_required','no prepared-to-empty observation fallback');
select is(pg_temp.export_content('reports'),'[]'::jsonb,'store publication creates no report permission or saved result');
select is(pg_temp.export_content('prs'),'[]'::jsonb,'store publication creates no PRS result');
select is(pg_temp.export_content('ancestry'),'[]'::jsonb,'store publication creates no ancestry result');
select throws_ok($$select pg_temp.export_content('check',jsonb_set((select value from export_snapshots where label='prepared'),
 '{preparedSource,membershipSha256}',to_jsonb(repeat('a',64))))$$,'42501','not_found','changed membership snapshot refuses');
reset role;
select is((select count(*) from private.own_normalization_runs where file_id=pg_temp.file_id()),0::bigint,'export creates no fake normalization row');
savepoint missing_member;
delete from storage.objects where id=(select storage_object_id from private.own_preparation_artifacts
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'));
set local role service_role;
select throws_ok($$select pg_temp.export_content('check')$$,'42501','not_found','unread nonroot member loss denies export');
reset role;
rollback to missing_member;
savepoint changed_type;
update public.genome_files set file_type='gvcf' where id=pg_temp.file_id();
set local role service_role;
select throws_ok($$select pg_temp.export_content('check')$$,'42501','not_found','changed captured file type denies export');
reset role;
rollback to changed_type;
savepoint expired_origin;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='90000000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.export_source()$$,'42501','not_found','expired reader session denies export');
select is(pg_temp.export_source('90000000-0000-4000-8000-000000000011')->'preparedSource',
 (select value->'preparedSource' from export_snapshots where label='prepared'),'fresh current session reads after originating session expiry');
reset role;
rollback to expired_origin;
create function pg_temp.make_db_source() returns uuid language plpgsql as $$
declare issued jsonb; finalizing jsonb; finalized jsonb; oid uuid; claim uuid; fid uuid; prep jsonb;
begin
 issued:=public.issue_own_storage_upload_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF',8,repeat('c',64));
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',issued->>'stagingKey',
 '90000000-0000-4000-8000-000000000001','{"size":8}');
 finalizing:=public.begin_own_upload_finalization_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',(issued->>'uploadId')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('genomes',finalizing->>'finalKey','{"size":8}') returning id into oid;
 delete from storage.objects where bucket_id='genomes' and name=issued->>'stagingKey';
 finalized:=public.complete_own_upload_finalization_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (issued->>'uploadId')::uuid,(finalizing->>'claim')::uuid,oid,repeat('c',64),repeat('d',64));
 fid:=(finalized->>'fileId')::uuid;
 update private.own_preparation_config set enabled=true where singleton;
 perform public.enqueue_own_preparation_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid);
 prep:=public.claim_next_own_preparation_v1(repeat('9',64));
 perform public.freeze_own_preparation_v1((prep->>'jobId')::uuid,(prep->>'attemptId')::uuid,repeat('9',64));
 update private.own_preparation_config set enabled=false where singleton;
 claim:=(public.own_upload_normalization_v1('begin','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid)->>'claim')::uuid;
 perform public.own_upload_normalization_v1('stage','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid,claim,
 '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":15,"source_pos":74749576,"source_ref":"C","source_alt":"A","source_gt":"0/1","rsid":762551,"chrom":15,"pos":74749576,"ref":"C","alt":"A","genotype":"A/C","quality_state":"pass","usable":true}]}');
 perform public.own_upload_normalization_v1('complete','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid,claim,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('c',64),'decodedSha256',repeat('d',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
 return fid;
end; $$;
create temporary table db_source as select pg_temp.make_db_source() id;
grant select on db_source to service_role;

set local role service_role;
insert into export_snapshots values('db',private.own_export_source_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from db_source)));
select ok(not((select value from export_snapshots where label='db') ? 'preparedSource'),'genuine DB recovery keeps original snapshot shape');
select is((select value->>'normalized' from export_snapshots where label='db'),'true','frozen unmanifested job permits genuine DB normalization export');
select is(jsonb_array_length(public.own_subject_export_content_v1('observed','90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from db_source),(select value from export_snapshots where label='db'),0)),1,
 'genuine DB observation still exports');
reset role;
savepoint source_deletion;
select public.prepare_genome_file_deletion_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',pg_temp.file_id());
set local role service_role;
select throws_ok($$select pg_temp.export_content('check')$$,'42501','not_found','actual deletion preparation denies source before provider removal');
select is(private.own_export_source_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',(select id from db_source)),
 (select value from export_snapshots where label='db'),'deleting prepared A preserves exact DB B snapshot');
reset role;
rollback to source_deletion;
savepoint store_withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=(select id from generation_subject) and account_id='90000000-0000-4000-8000-000000000001'
 and consent_type='upload_class' and scope=array['store'] and revoked_at is null;
set local role service_role;
select throws_ok($$select pg_temp.export_content('check')$$,'55000','upload_consent_required','actual store withdrawal denies prepared export');
reset role;
rollback to store_withdrawal;
select ok(not has_function_privilege('authenticated','public.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)','execute'),
 'public application role cannot invoke service export RPC');
select ok(has_function_privilege('service_role','public.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)','execute'),
 'service export RPC remains available');
select * from finish();
rollback;
