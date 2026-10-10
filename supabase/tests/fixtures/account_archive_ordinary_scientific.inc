-- Unchanged actual normalization/report-generation assertions from the original own source content fixture. Synthetic physical metadata only.
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

create temporary table export_snapshot as select private.own_export_source_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040') value;
create function pg_temp.export_content(op text,off integer default 0) returns jsonb language sql as $$
 select public.own_subject_export_content_v1(op,'77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',(select value from export_snapshot),off);
$$;
select is(jsonb_array_length(pg_temp.export_content('variants')),1,'raw own rows export without any analytic grant');
select is(pg_temp.export_content('reports'),'[]'::jsonb,'normalization never fabricates a completed report');
select is(pg_temp.export_content('prs'),'[]'::jsonb,'no generated PRS means no exported coverage');
select public.grant_own_report_purpose_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),public.own_report_context_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from normalization_subject)),
 'reports.polygenic',2,(select body_sha256 from public.consent_artifacts where artifact_key='consent.own-polygenic' and version=2),
 repeat('c',64),clock_timestamp()+interval '9 minutes');
insert into public.report_templates(slug,category,title,summary,evidence,estimate_kind,variants,citations)
 values('own-read-fixture','basic-traits','Fixture','Rollback-only result read fixture.','emerging','single_locus',
 '[{"rsid":123,"gene":"X","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('OWN-READ-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create temporary table generation_manifest as select public.own_report_generation_v1('begin',
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 '77900000-0000-4000-8000-000000000040','reports.polygenic') as receipt;
select public.own_report_generation_v1('complete','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040','reports.polygenic',
 (select (receipt->>'claim')::uuid from generation_manifest),
 '{"reports":[{"slug":"own-read-fixture","covered":true,"conflictingRsids":[],"variants":[{"rsid":123,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved outcome","strandFlipped":false}}]}],"prs":[{"pgs_id":"OWN-READ-FIXTURE","raw_score":0,"coverage":1,"matched":1}]}');
select is(pg_temp.export_content('reports')->0->'report'->'variants'->0->'outcome'->>'interpretation','saved outcome',
 'actual generation completion is exported verbatim');
select is(pg_temp.export_content('prs')->0->>'matched','1','actual completed PRS includes coverage');
select ok(not ((pg_temp.export_content('prs')->0) ?| array['raw_score','zscore','percentile','risk']),
 'database projection excludes all unvalidated numeric fields');
