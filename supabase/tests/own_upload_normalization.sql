begin;
select no_plan();
-- Synthetic metadata only. All fixtures and assertions roll back.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email) values('76500000-0000-4000-8000-000000000001','normalization@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76500000-0000-4000-8000-000000000010','76500000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76500000-0000-4000-8000-000000000001';
create temporary table normalization_subject as select id from public.subjects
 where subject_account_id='76500000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76500000-0000-4000-8000-000000000001','76500000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('76500000-0000-4000-8000-000000000020',
 'genomes','76500000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76500000-0000-4000-8000-000000000040','76500000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '76500000-0000-4000-8000-000000000030','Genome file','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76500000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76500000-0000-4000-8000-000000000020','76500000-0000-4000-8000-000000000030','genomes',
 '76500000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table normalization_manifest(receipt jsonb);
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010','76500000-0000-4000-8000-000000000040',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
insert into normalization_manifest select pg_temp.normalize('begin');
select is((select receipt->>'status' from normalization_manifest),'authorized','store consent alone permits preparation');
select is((select count(*) from public.purpose_grants where target_id=(select id from normalization_subject)),0::bigint,
 'no analytic purpose exists or is invented');
select throws_ok($$select pg_temp.normalize('begin')$$,'55000','normalization_in_progress','a concurrent run cannot replace a live claim');
select is(pg_temp.normalize('check'),(select receipt from normalization_manifest),'each range gets the same exact source identity');
select is(pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'a checked canonical batch can be staged privately');
select is((select count(*) from public.user_variants where file_id='76500000-0000-4000-8000-000000000040'),0::bigint,
 'incomplete source batches are not readable canonical rows');
select throws_ok($$select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{}]}')$$,
 '22023','invalid_request','duplicate sequence cannot be acknowledged as new input');
select throws_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('c',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '22023','invalid_request','a mismatched raw source cannot be published');
select throws_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',2,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '22023','invalid_request','terminal counts must cover exactly the staged batches');
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id='76500000-0000-4000-8000-000000000001' and consent_type='upload_class';
select throws_ok($$select pg_temp.normalize('check')$$,'55000','upload_consent_required','revocation denies the next source read');
select throws_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '55000','upload_consent_required','revocation denies atomic publication even after staging');
select is(pg_temp.normalize('fail'),'true'::jsonb,'exact private run cleanup still works after revocation');
select is((select count(*) from private.own_normalization_batches where file_id='76500000-0000-4000-8000-000000000040'),0::bigint,
 'failed run discards all its private genetic batches');
-- Rollback-only restoration is fixture setup, never application behavior.
update public.subject_consents set revoked_at=null,revocation_reason=null
 where account_id='76500000-0000-4000-8000-000000000001' and consent_type='upload_class';
update normalization_manifest set receipt=pg_temp.normalize('begin');
select is(pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'retry starts a fresh private batch sequence');
select is(pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb)),
 jsonb_build_object('fileId','76500000-0000-4000-8000-000000000040','status','normalization_complete','analysisState','not_generated'),
 'complete source publishes an honest preparation-only receipt');
select is((select count(*) from public.user_variants where file_id='76500000-0000-4000-8000-000000000040'),1::bigint,
 'the entire source becomes canonical in its terminal transaction');
select ok((select status='stored' and normalization_completed_at is not null and normalization_source_revision=upload_revision
 and roh_status is null and input_provenance is null from public.genome_files where id='76500000-0000-4000-8000-000000000040'),
 'preparation is not annotated, ROH-measured, or report-ready');
select is((select count(*) from public.ancestry_results where file_id='76500000-0000-4000-8000-000000000040')+
 (select count(*) from public.user_prs where file_id='76500000-0000-4000-8000-000000000040')+
 (select count(*) from public.worker_jobs where file_id='76500000-0000-4000-8000-000000000040'),0::bigint,'zero analytic results or jobs');
select is(pg_temp.normalize('begin')->>'status','normalization_complete','successful preparation is idempotent');
select throws_ok($$select pg_temp.normalize('fail')$$,'42501','not_found','a late failure cannot delete completed canonical rows');
select ok(not has_function_privilege('authenticated','public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
 'browser cannot forge authority or normalization payloads');
select ok(not has_function_privilege('inherit_upload_only','public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'),
 'upload-only token cannot trigger parsing or call the service RPC');
select ok(not has_table_privilege('authenticated','private.own_normalization_batches','SELECT'),
 'provisional genetic rows are inaccessible to authenticated clients');
select throws_ok($$update public.genome_files set normalization_source_revision=null
 where id='76500000-0000-4000-8000-000000000040'$$,'23514',null,'a completion timestamp cannot have a null source revision');

-- A second synthetic source exercises interrupted and rejected preparation.
insert into storage.objects(id,bucket_id,name,metadata) values('76500000-0000-4000-8000-000000000021',
 'genomes','76500000-0000-4000-8000-000000000031','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76500000-0000-4000-8000-000000000041','76500000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '76500000-0000-4000-8000-000000000031','Genome file','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76500000-0000-4000-8000-000000000021');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76500000-0000-4000-8000-000000000021','76500000-0000-4000-8000-000000000031','genomes',
 '76500000-0000-4000-8000-000000000041',repeat('a',64),8,1,'current');
create or replace function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76500000-0000-4000-8000-000000000001',
 '76500000-0000-4000-8000-000000000010','76500000-0000-4000-8000-000000000041',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
update normalization_manifest set receipt=pg_temp.normalize('begin');
select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}');
select is(public.reap_expired_own_normalizations_v1(),0,'cleanup leaves live preparation batches alone');
update private.own_normalization_runs set expires_at='1900-01-01' where file_id='76500000-0000-4000-8000-000000000041';
select is(public.reap_expired_own_normalizations_v1(),1,'expired crashed preparation is selected without caller identifiers');
select is((select count(*) from private.own_normalization_batches where file_id='76500000-0000-4000-8000-000000000041'),0::bigint,
 'crash cleanup removes the expired private genetic rows');
select is((select count(*) from storage.objects where id='76500000-0000-4000-8000-000000000021'),1::bigint,
 'crash cleanup preserves the source for retry');
select is((select count(*) from public.user_variants where file_id='76500000-0000-4000-8000-000000000040'),1::bigint,
 'crash cleanup does not touch a completed sibling source');
select throws_ok($$select pg_temp.normalize('check')$$,'42501','not_found','late crashed worker cannot resume after reaping');
update normalization_manifest set receipt=pg_temp.normalize('begin');
select is(pg_temp.normalize('reject-build')->>'status','build_cleanup_required','unknown build freezes its exact source cleanup target');
select throws_ok($$select pg_temp.normalize('finish-rejected')$$,'55000','cleanup_incomplete','cleanup cannot finish while source metadata remains');
select is(pg_temp.normalize('begin')->>'status','build_cleanup_required','interrupted rejected-object cleanup can resume without parsing again');
select is((select count(*) from public.user_variants where file_id='76500000-0000-4000-8000-000000000041'),0::bigint,
 'unknown-build rejection has no canonical genetic rows');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where id='76500000-0000-4000-8000-000000000021';
select is(pg_temp.normalize('finish-rejected'),'true'::jsonb,'absence proof terminalizes only the rejected source');
select ok((select state='purged' and revoked_at is not null from public.genome_storage_objects
 where object_id='76500000-0000-4000-8000-000000000021'),'the rejected object is never advertised as current');
select ok(not has_function_privilege('authenticated','public.reap_expired_own_normalizations_v1()','EXECUTE'),
 'browser cannot call crash cleanup');
select * from finish();
rollback;
