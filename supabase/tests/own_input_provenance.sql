begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('76900000-0000-4000-8000-000000000001','source-facts@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76900000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='76900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('76900000-0000-4000-8000-000000000020',
 'genomes','76900000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76900000-0000-4000-8000-000000000040','76900000-0000-4000-8000-000000000001',(select id from generation_subject),
 '76900000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76900000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76900000-0000-4000-8000-000000000020','76900000-0000-4000-8000-000000000030','genomes',
 '76900000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance',jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),
 'sourceBuild','GRCh37','targetBuild','GRCh38','buildBasis','source-declared','chainSha256',repeat('c',64),
 'variantRowsMapped',0,'variantRowsUnmapped',0,'attempted',1,
 'counts','{"called":1,"noCall":1,"unsupported":0,"failedFilter":0,"blocks":0,"singleSample":true,"buildClaim":true}'::jsonb)));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.source_facts(purpose text default null) returns jsonb language sql as $$
 select public.read_own_input_sources_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from generation_subject),
 array['76900000-0000-4000-8000-000000000040'::uuid],purpose);
$$;
select is(jsonb_array_length(pg_temp.source_facts()),1,'current store consent exposes completed preparation facts');
select is(pg_temp.source_facts()->0->'snapshot'->'counts'->>'called','1','recorded called count is preserved');
select is(pg_temp.source_facts()->0->'snapshot'->'counts'->>'noCall','1','recorded no-call count is preserved');
select is(pg_temp.source_facts()->0->'snapshot'->>'sourceBuild','GRCh37','source conversion is recorded');
select is(pg_temp.source_facts()->0->>'processedAt',
 (select to_jsonb(normalization_completed_at)#>>'{}' from public.genome_files where id='76900000-0000-4000-8000-000000000040'),
 'canonical completion timestamp is used without inventing legacy annotation');
select is((pg_temp.source_facts()->0)-array['fileId','fileType','processedAt','snapshot'],'{}'::jsonb,'top-level DTO is closed');
select is((pg_temp.source_facts()->0->'snapshot')-array['sourceBuild','buildBasis','targetBuild','variantRowsMapped','variantRowsUnmapped','counts'],
 '{}'::jsonb,'snapshot does not expose hashes, paths, manifests, claims or private provenance extras');
select is(pg_temp.source_facts('reports.polygenic'),'[]'::jsonb,'preparation does not authorize report-purpose facts');
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
select is(pg_temp.source_facts('reports.polygenic'),'[]'::jsonb,'grant without generation does not expose report facts');
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select pg_temp.generate('complete','reports.polygenic',jsonb_build_object('reports',jsonb_build_array(jsonb_build_object(
 'slug',(select slug from public.report_templates where status='published' and layer='estimate' order by slug limit 1))), 'prs','[]'::jsonb));
select is(jsonb_array_length(pg_temp.source_facts('reports.polygenic')),1,'completed exact purpose exposes its source facts');
select is(pg_temp.source_facts('reports.monogenic'),'[]'::jsonb,'different purpose cannot borrow completion');

savepoint changed;
update private.own_normalization_runs set provenance=jsonb_set(provenance,'{sourceSha256}',to_jsonb(repeat('b',64)))
 where file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'decoded hash cannot substitute for raw source identity');
rollback to changed;
update private.own_normalization_runs set provenance=provenance-'chainSha256' where file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'GRCh37 facts need a recorded chain identity');
rollback to changed;
update private.own_normalization_runs set provenance=jsonb_set(provenance,'{counts,called}','"1"') where file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'malformed string counter is refused');
rollback to changed;
update private.own_normalization_runs set provenance=jsonb_set(provenance,'{counts,called}','9007199254740992') where file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'unsafe counter is refused');
rollback to changed;
update private.own_normalization_runs set state='failed' where file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'incomplete preparation never yields facts');
rollback to changed;
update public.genome_files set upload_revision=upload_revision+1,normalization_source_revision=normalization_source_revision+1
 where id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'source revision cannot borrow prior manifest facts');
rollback to changed;
update public.genome_storage_objects set state='purged',revoked_at=clock_timestamp() where genome_file_id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'non-current object cannot yield facts');
rollback to changed;
delete from auth.sessions where id='76900000-0000-4000-8000-000000000010';
select is(pg_temp.source_facts(),'[]'::jsonb,'ended login cannot yield facts');
rollback to changed;
select is(public.read_own_input_sources_v1('76900000-0000-4000-8000-000000000099',
 '76900000-0000-4000-8000-000000000010',(select id from generation_subject),
 array['76900000-0000-4000-8000-000000000040'::uuid],null),'[]'::jsonb,'foreign account is denied');
select is(public.read_own_input_sources_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000099',
 array['76900000-0000-4000-8000-000000000040'::uuid],null),'[]'::jsonb,'foreign subject is denied');
select throws_ok($$select pg_temp.source_facts('ancestry')$$,'22023','invalid_request','closed optional purpose cannot widen to ancestry');
select throws_ok($$select public.read_own_input_sources_v1(null,null,null,array_fill(gen_random_uuid(),array[101]),null)$$,
 '22023','invalid_request','more than 100 file IDs is refused');
select public.revoke_directional_purpose_v1('76900000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic'));
select is(pg_temp.source_facts('reports.polygenic'),'[]'::jsonb,'withdrawal removes report facts');
select is(jsonb_array_length(pg_temp.source_facts()),1,'report withdrawal retains store-authorized preparation facts');
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=(select id from generation_subject) and consent_type='upload_class';
select is(pg_temp.source_facts(),'[]'::jsonb,'store withdrawal removes preparation facts');
rollback to changed;
delete from public.genome_storage_objects where genome_file_id='76900000-0000-4000-8000-000000000040';
delete from public.genome_files where id='76900000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts(),'[]'::jsonb,'deleted exact source yields no facts');
select is((select count(*) from private.own_normalization_runs where file_id='76900000-0000-4000-8000-000000000040'),0::bigint,
 'file deletion removes the existing private source journal');
rollback to changed;
select ok(not has_function_privilege(role,'public.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)','EXECUTE')
 and not has_function_privilege(role,'private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)','EXECUTE'),
 role||' cannot directly read canonical provenance') from unnest(array['anon','authenticated','inherit_upload_only']) role;
select ok(has_function_privilege('service_role','public.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)','EXECUTE'),
 'only the service caller has the public projection capability');
set constraints all immediate;
select * from finish();
rollback;
