begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic metadata only. All fixtures and assertions roll back.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email) values('77900000-0000-4000-8000-000000000001','analysis-read@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='77900000-0000-4000-8000-000000000001';
create temporary table normalization_subject as select id from public.subjects
 where subject_account_id='77900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('77900000-0000-4000-8000-000000000020',
 'genomes','77900000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77900000-0000-4000-8000-000000000040','77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '77900000-0000-4000-8000-000000000030','Genome file','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'77900000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77900000-0000-4000-8000-000000000020','77900000-0000-4000-8000-000000000030','genomes',
 '77900000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table normalization_manifest(receipt jsonb);
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
insert into normalization_manifest select pg_temp.normalize('begin');
select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}');
select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));

create function pg_temp.authority(read_only boolean,purpose text default 'reports.polygenic') returns jsonb language plpgsql as $$
begin
 if read_only then return private.current_own_report_grant_read_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',purpose); end if;
 return private.current_own_report_grant_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',purpose);
end; $$;
select throws_ok($$select pg_temp.authority(false)$$,'42501','not_found','locked resolver denies unselected reports');
select throws_ok($$select pg_temp.authority(true)$$,'42501','not_found','read-only resolver denies unselected reports');
select public.grant_own_report_purpose_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),public.own_report_context_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from normalization_subject)),
 'reports.polygenic',2,(select body_sha256 from public.consent_artifacts where artifact_key='consent.own-polygenic' and version=2),
 repeat('c',64),clock_timestamp()+interval '9 minutes');
select is(pg_temp.authority(true),pg_temp.authority(false),'read-only and locked authority have exactly equivalent live snapshots');
select is(pg_temp.authority(true)->>'sourceSha256',repeat('a',64),'source authority uses raw SHA, not decoded SHA');
select throws_ok($$select pg_temp.authority(true,'reports.monogenic')$$,'42501','not_found','polygenic choice does not enable observed variants');
select throws_ok($$select pg_temp.authority(true,'ancestry')$$,'42501','not_found','polygenic choice does not enable ancestry');
select throws_ok($$select public.read_own_report_calls_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040','reports.polygenic',array[123]::bigint[],0)$$,
 '42501','not_found','Enable alone never exposes report inputs before generation');
select is(public.filter_own_analysis_files_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'reports.polygenic',array['77900000-0000-4000-8000-000000000040']::uuid[],true),
 '{}'::uuid[],'completed-only result allowlist denies enabled but ungenerated file');
update public.genome_files set build=null where id='77900000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.authority(false)$$,'42501','not_found','locked source fails closed on null build');
select throws_ok($$select pg_temp.authority(true)$$,'42501','not_found','read-only source fails closed on null build');
update public.genome_files set build='GRCh38' where id='77900000-0000-4000-8000-000000000040';
update public.directional_grants set self_principal_revision=self_principal_revision+1
 where recipient_account_id='77900000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.authority(false)$$,'42501','not_found','locked resolver rejects stale principal grant revision');
select throws_ok($$select pg_temp.authority(true)$$,'42501','not_found','read-only resolver rejects stale principal grant revision');
update public.directional_grants set self_principal_revision=self_principal_revision-1
 where recipient_account_id='77900000-0000-4000-8000-000000000001';
select is(pg_temp.authority(true),pg_temp.authority(false),'both resolvers remain equivalent after rolled-back stale revisions');
select ok(has_schema_privilege('authenticated','private','USAGE'),'authenticated RLS entry is reachable through existing private USAGE');
select ok(not has_function_privilege('authenticated','private.current_own_report_grant_read_v1(uuid,uuid,uuid,text)','EXECUTE'),
 'browser cannot probe arbitrary read contexts');
select ok(not has_function_privilege('authenticated','public.read_own_report_calls_v1(uuid,uuid,uuid,text,bigint[],integer)','EXECUTE'),
 'browser cannot forge report read caller or requested subject');
select ok(not has_function_privilege('inherit_upload_only','private.own_stored_analysis_readable_v1(uuid,text)','EXECUTE'),
 'upload-only token cannot probe report choices');
select is((select count(*) from public.user_variants where file_id='77900000-0000-4000-8000-000000000040'),1::bigint,
 'unselected/ungenerated result denial does not remove canonical data');
-- Explicit transaction_read_only is exercised without pgTAP internals (which write temp state).
set constraints all immediate;
select * from finish();
set local transaction_read_only=on;
do $$ begin
 if pg_temp.authority(true)->>'sourceRevision' is distinct from '1' then raise exception 'read-only authority missing'; end if;
end $$;
rollback;
