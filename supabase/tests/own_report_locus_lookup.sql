begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Independent bounded fixture configuration. Every change, including an
-- update to an existing local singleton, is restored by transaction rollback.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer,
 maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads;
-- Reference fixtures are synthetic and roll back; no application seed or
-- completed analysis row is imported. The coverage output has a real PGS FK.
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('SYNTHETIC_LOCUS_GENERATION','Synthetic generation reference','Synthetic test trait',1,
 '{"label":"Synthetic test reference"}','http://localhost/synthetic-pgs','Synthetic fixture; no population inference.');
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,pgs_id)
 values('synthetic-locus-generation-estimate','synthetic','Synthetic generation estimate','Synthetic database test fixture.',
 'published','emerging','estimate','polygenic_score','SYNTHETIC_LOCUS_GENERATION');
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('78200000-0000-4000-8000-000000000001','locus-generation@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('78200000-0000-4000-8000-000000000010','78200000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='78200000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='78200000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('78200000-0000-4000-8000-000000000020',
 'genomes','78200000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('78200000-0000-4000-8000-000000000040','78200000-0000-4000-8000-000000000001',(select id from generation_subject),
 '78200000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'78200000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('78200000-0000-4000-8000-000000000020','78200000-0000-4000-8000-000000000030','genomes',
 '78200000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010','78200000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'78200000-0000-4000-8000-000000000001',
 '78200000-0000-4000-8000-000000000010','78200000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G"},{"rsid":124,"chrom":2,"pos":135851077,"ref":"G","alt":"A","genotype":"G/G"}]}');
-- More than one page of observations at a single locus is legal: source_line
-- is the identity, and repeated requested loci must not multiply these rows.
select pg_temp.prepare('stage',jsonb_build_object('kind','observed','sequence',batch,'rows',jsonb_agg(
 jsonb_build_object('source_line',n,'source_chrom',2,'source_pos',136608646,'source_ref','G','source_alt','A',
 'source_gt','0/1','rsid',4988235+n,'chrom',2,'pos',135851076,'ref','G','alt','A','genotype','A/G','quality_state','pass','usable',true)
 order by n))) from (select n,(n-1)/1000 batch from generate_series(1,1002) n) rows group by batch order by batch;
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',2,'observedCallCount',1002,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'78200000-0000-4000-8000-000000000001',
 '78200000-0000-4000-8000-000000000010','78200000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('78200000-0000-4000-8000-000000000001',
 '78200000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.readable(purpose text default 'reports.polygenic') returns uuid[] language sql as $$
 select public.filter_own_analysis_files_v1('78200000-0000-4000-8000-000000000001','78200000-0000-4000-8000-000000000010',
 (select id from generation_subject),purpose,array['78200000-0000-4000-8000-000000000040'::uuid],true);
$$;
select is(pg_temp.generate('begin')->>'status','not_selected','preparation alone never enables a report');
select is((select count(*) from private.own_analysis_runs where file_id='78200000-0000-4000-8000-000000000040'),0::bigint,'no purpose means no analysis run');
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
select is(pg_temp.readable(),'{}'::uuid[],'a saved checkbox alone does not expose results');
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select is((select receipt->>'status' from claims),'authorized','one selected purpose starts its exact source run');

select is(jsonb_array_length(pg_temp.generate('read-variants','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851076},{"chrom":2,"pos":135851076},{"chrom":2,"pos":135851077},{"chrom":2,"pos":1}],"offset":0}')),2,
 'duplicate requested loci do not multiply normalized rows; absent point adds none');
select is(pg_temp.generate('read-variants','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851077},{"chrom":2,"pos":135851076}],"offset":1}')->0->>'rsid','124',
 'variant pagination retains persisted id ordering, not requested-locus order');
select is(pg_temp.generate('read-variants','reports.polygenic','{"loci":[{"chrom":2,"pos":136608646}],"offset":0}'),'[]'::jsonb,
 'source coordinates cannot substitute for a canonical locus');
select is(jsonb_array_length(pg_temp.generate('read-observed','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851076},{"chrom":2,"pos":135851076}],"offset":0}')),1000,
 'observed page stays bounded at1000 with duplicate requested loci');
select is(jsonb_array_length(pg_temp.generate('read-observed','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851076}],"offset":1000}')),2,'second page returns only the two remaining source lines');
select is(pg_temp.generate('read-observed','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851076}],"offset":1000}')->0->>'rsid','4989236','observed pagination preserves source_line order');
select is(pg_temp.generate('read-observed','reports.polygenic',
 '{"loci":[{"chrom":2,"pos":135851076}],"offset":1002}'),'[]'::jsonb,'after the last source line no rows remain');
savepoint hash_mismatch;
update public.report_observed_calls set source_sha256=repeat('b',64) where file_id='78200000-0000-4000-8000-000000000040';
select is(pg_temp.generate('read-observed','reports.polygenic','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}'),'[]'::jsonb,
 'lateral lookup does not bypass exact raw-source hash');
rollback to hash_mismatch;
select throws_ok($$select public.own_report_generation_v1('read-variants','78200000-0000-4000-8000-000000000002',
 '78200000-0000-4000-8000-000000000010','78200000-0000-4000-8000-000000000040','reports.polygenic',
 (select (receipt->>'claim')::uuid from claims),'{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')$$,
 '42501','not_found','another account cannot borrow the exact source claim');
savepoint revoked;
select public.revoke_directional_purpose_v1('78200000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_kind='subject' and target_id=(select id from generation_subject)
  and purpose='reports.polygenic' and revoked_at is null));
select throws_ok($$select pg_temp.generate('read-variants','reports.polygenic','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')$$,
 '42501','not_found','withdrawn purpose cannot use the indexed read');
rollback to revoked;
select is((select count(*) from public.user_variants where file_id='78200000-0000-4000-8000-000000000040'),2::bigint,'reads leave variant source rows unchanged');
select is((select count(*) from public.report_observed_calls where file_id='78200000-0000-4000-8000-000000000040'),1002::bigint,'reads leave observed source rows unchanged');
select is((select count(*) from private.own_analysis_runs where file_id='78200000-0000-4000-8000-000000000040' and state='complete'),0::bigint,'read performance does not fabricate completed analysis');
select ok((select prosecdef and proconfig=array['search_path=pg_catalog, private'] from pg_proc
 where oid='private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure),'definer and closed search path preserved');
select ok(not has_function_privilege('authenticated','private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 and has_function_privilege('service_role','private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE'),'service-only execution preserved');
select * from finish();
rollback;
