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
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('78700000-0000-4000-8000-000000000001','ancestry-generation@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='78700000-0000-4000-8000-000000000001';
create temporary table ancestry_subject as select id from public.subjects
 where subject_account_id='78700000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('78700000-0000-4000-8000-000000000020',
 'genomes','78700000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('78700000-0000-4000-8000-000000000040','78700000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 '78700000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'78700000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('78700000-0000-4000-8000-000000000020','78700000-0000-4000-8000-000000000030','genomes',
 '78700000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance',jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),
 'sourceBuild','GRCh37','targetBuild','GRCh38','buildBasis','source-declared','chainSha256',repeat('c',64),
 'variantRowsMapped',0,'variantRowsUnmapped',0,'attempted',1,
 'counts','{"called":1,"noCall":0,"unsupported":0,"failedFilter":0,"blocks":0,"singleSample":true,"buildClaim":true}'::jsonb)));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'ancestry',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),public.own_report_context_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010',(select id from ancestry_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.readable(purpose text default 'ancestry') returns uuid[] language sql as $$
 select public.filter_own_analysis_files_v1('78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),purpose,array['78700000-0000-4000-8000-000000000040'::uuid],true);
$$;

create function pg_temp.read_ancestry() returns jsonb language sql as $$
 select public.own_ancestry_content_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040');
$$;
select is(pg_temp.generate('begin')->>'status','not_selected','prepared source alone does not authorize ancestry');
select is((select count(*) from private.own_analysis_runs where file_id='78700000-0000-4000-8000-000000000040'),0::bigint,'unselected ancestry creates no run');
select pg_temp.grant_report('ancestry',repeat('c',64));
select is(pg_temp.readable(),'{}'::uuid[],'permission alone does not expose an ancestry result');
insert into claims values('ancestry',pg_temp.generate('begin'));
select is((select receipt->'source' from claims where purpose='ancestry'),
 '{"fileId":"78700000-0000-4000-8000-000000000040","fileType":"vcf","normalizedBuild":"GRCh38","callEncoding":"vcf-literal"}'::jsonb,
 'claim binds verified file type and normalized literal encoding');
select is((select computation_revision from private.own_analysis_runs where file_id='78700000-0000-4000-8000-000000000040'),
 'own-ancestry-v1','ancestry has an explicit independent journal revision');
select throws_ok($$select pg_temp.generate('begin')$$,'55000','analysis_in_progress','live ancestry claim cannot be stolen');
select is(pg_temp.generate('read-observed','ancestry','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')->0->>'genotype',
 'A/G','authorized ancestry reads exact normalized observed source call');
select is(pg_temp.generate('read-observed','ancestry','{"loci":[{"chrom":2,"pos":136608646}],"offset":0}'),'[]'::jsonb,
 'source-build coordinate is not confused with normalized coordinate');
select throws_ok($$select pg_temp.generate('read-variants','ancestry','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')$$,
 '22023','invalid_request','literal source cannot fall back to array-genotype rows');
select throws_ok($$select public.own_report_generation_v1('check','78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040','ancestry',gen_random_uuid())$$,
 '42501','not_found','wrong claim cannot read or complete ancestry');
savepoint encoding_changed;
update public.genome_files set file_type='array_23andme' where id='78700000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','file type transition invalidates the exact running claim');
select throws_ok($$select pg_temp.generate('begin')$$,'42501','not_found','new claim cannot reinterpret a type different from the verified normalization manifest');
rollback to encoding_changed;
savepoint source_changed;
-- Keep the source completion pair coherent; its old certified manifest and
-- ancestry claim must still fail the exact revision check. Rollback restores both.
update public.genome_files set upload_revision=2,normalization_source_revision=2
 where id='78700000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.generate('read-observed','ancestry','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')$$,
 '42501','not_found','changed source cannot be read under old ancestry claim');
rollback to source_changed;
savepoint session_ended;
delete from auth.sessions where id='78700000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','ended login cannot continue ancestry generation');
rollback to session_ended;
-- Closed zero-panel-coverage adapter DTO. The supplied synthetic call is outside
-- this panel. No population or lineage claim is inferred from that absence.
create temporary table ancestry_output as select jsonb_build_object('ancestry',jsonb_build_object(
 'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
 'source',jsonb_build_object('fileId','78700000-0000-4000-8000-000000000040','subjectId',(select id from ancestry_subject),
  'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),
  'normalizedAt',receipt#>'{authorization,normalizedAt}'),
 'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
 'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
 'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
 'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb)) payload
 from claims where purpose='ancestry';
select throws_ok($$select pg_temp.generate('complete','ancestry','{"reports":[],"prs":[]}')$$,
 '22023','invalid_request','ancestry cannot publish a report or PRS envelope');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,source,sourceSha256}',to_jsonb(repeat('b',64))))$$,
 '22023','invalid_ancestry_content','decoded hash cannot replace certified raw source hash');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,source,fileId}','"78700000-0000-4000-8000-000000000050"'))$$,
 '22023','invalid_ancestry_content','other file result cannot be published under selected claim');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,source,callEncoding}','"array-genotype"'))$$,
 '22023','invalid_ancestry_content','literal calls cannot be labelled array encoding at publication');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,panel,markerSha256}',to_jsonb(repeat('f',64))))$$,
 '22023','invalid_ancestry_content','unreviewed marker panel cannot be published');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,admixture,result_state}','"available"'))$$,
 '22023','invalid_ancestry_content','missing panel data cannot masquerade as supported ancestry');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,admixture,result,proportions,EUR}','0.9'))$$,
 '22023','invalid_ancestry_content','proportions must remain a normalized bounded mixture');
select throws_ok($$select pg_temp.generate('complete','ancestry',jsonb_set((select payload from ancestry_output),'{ancestry,lineages,0,haplogroup}','"H"'))$$,
 '22023','invalid_ancestry_content','ancestry result cannot introduce an unsupported lineage finding');
savepoint withdrawn_in_flight;
select public.revoke_directional_purpose_v1('78700000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from ancestry_subject) and purpose='ancestry'));
select throws_ok($$select pg_temp.generate('complete','ancestry',(select payload from ancestry_output))$$,
 '42501','not_found','withdrawal between source read and publication prevents completion');
rollback to withdrawn_in_flight;
select is(pg_temp.generate('complete','ancestry',(select payload from ancestry_output))->>'status','complete','selected ancestry publishes exact stored content atomically');
select is((select result from private.own_analysis_runs where file_id='78700000-0000-4000-8000-000000000040' and purpose='ancestry'),
 (select payload from ancestry_output),'journal retains exact source and panel-bound DTO without current catalog borrowing');
select is(pg_temp.readable(),array['78700000-0000-4000-8000-000000000040'::uuid],'live exact ancestry completion is readable');
select is(pg_temp.read_ancestry()->'content',(select payload->'ancestry' from ancestry_output),'service reader returns exact captured ancestry DTO');
select is((pg_temp.read_ancestry()->>'completedAt')::timestamptz,(select completed_at from private.own_analysis_runs
 where file_id='78700000-0000-4000-8000-000000000040' and purpose='ancestry'),'page receipt orders by actual computation completion');
select is(public.read_own_input_sources_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010',(select id from ancestry_subject),
 array['78700000-0000-4000-8000-000000000040'::uuid],'ancestry')->0->>'fileId','78700000-0000-4000-8000-000000000040',
 'completed ancestry exposes only recorded canonical source provenance');
select throws_ok($$select public.own_ancestry_content_v1('78700000-0000-4000-8000-000000000099',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040')$$,
 '42501','not_found','foreign account cannot use another account session or ancestry source');
savepoint read_source_changed;
-- Keep the source completion pair coherent; its old certified manifest and
-- ancestry claim must still fail the exact revision check. Rollback restores both.
update public.genome_files set upload_revision=2,normalization_source_revision=2
 where id='78700000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.read_ancestry()$$,'42501','not_found','reader rejects stale source revision');
rollback to read_source_changed;
select ok(has_function_privilege('service_role','public.own_ancestry_content_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.own_ancestry_content_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','private.own_ancestry_content_v1(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.own_ancestry_content_v1(uuid,uuid,uuid)','EXECUTE'),
 'only service dispatcher may call exact-source ancestry reader');
select is(pg_temp.generate('begin')->>'status','complete','repeat selected generation uses completed receipt without recomputation');
select is(pg_temp.readable('reports.polygenic'),'{}'::uuid[],'ancestry completion does not enable other report purpose');
select is((select count(*) from public.ancestry_results where file_id='78700000-0000-4000-8000-000000000040')+
 (select count(*) from public.user_prs where file_id='78700000-0000-4000-8000-000000000040'),0::bigint,'no legacy ancestry or PRS output is fabricated');
select throws_ok($$update private.own_analysis_runs set result=jsonb_set(result,'{ancestry,admixture,result_state}','"available"')
 where file_id='78700000-0000-4000-8000-000000000040' and purpose='ancestry'$$,
 '55000','completed_report_is_immutable','completed ancestry cannot be rewritten');
savepoint completed_encoding;
update public.genome_files set file_type='gvcf' where id='78700000-0000-4000-8000-000000000040';
select is(pg_temp.readable(),'{}'::uuid[],'completed ancestry is hidden if exact checked file type changes');
rollback to completed_encoding;
-- Another independently selected purpose must survive ancestry withdrawal.
select pg_temp.grant_report('reports.monogenic',repeat('d',64));
insert into claims values('reports.monogenic',pg_temp.generate('begin','reports.monogenic'));
create temporary table old_ancestry_grant as select grant_id from public.purpose_grants
 where target_id=(select id from ancestry_subject) and purpose='ancestry';
select public.revoke_directional_purpose_v1('78700000-0000-4000-8000-000000000001',(select grant_id from old_ancestry_grant));
select is(pg_temp.readable(),'{}'::uuid[],'withdrawal immediately hides exact stored ancestry');
select throws_ok($$select pg_temp.read_ancestry()$$,'42501','not_found','withdrawn ancestry is unavailable through service reader');
select is(public.read_own_input_sources_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010',(select id from ancestry_subject),
 array['78700000-0000-4000-8000-000000000040'::uuid],'ancestry'),'[]'::jsonb,
 'withdrawn ancestry cannot expose purpose-bound source provenance');
select is((select count(*) from private.own_analysis_runs where grant_id=(select grant_id from old_ancestry_grant)),0::bigint,
 'synchronous ancestry withdrawal physically removes exact journal');
select ok(exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
 where e.row_key->>'grantId'=(select grant_id::text from old_ancestry_grant) and e.store_name='private.own_analysis_runs'
 and e.status='deleted' and m.state='complete'),'frozen manifest records real ancestry journal deletion');
select is((select count(*) from private.own_analysis_runs where file_id='78700000-0000-4000-8000-000000000040' and purpose='reports.monogenic'),1::bigint,
 'ancestry purge preserves independent report claim');
select is((select count(*) from public.report_observed_calls where file_id='78700000-0000-4000-8000-000000000040'),1::bigint,
 'ancestry purge preserves exact prepared raw calls');
select is((select count(*) from storage.objects where id='78700000-0000-4000-8000-000000000020'),1::bigint,
 'ancestry purge never removes raw Storage source');
select pg_temp.grant_report('ancestry',repeat('e',64));
update claims set receipt=pg_temp.generate('begin') where purpose='ancestry';
select is(pg_temp.generate('complete','ancestry',(select payload from ancestry_output))->>'status','complete','new independently granted ancestry can complete');
select ok(private.dispatch_own_report_purge_v1((select j.id from public.worker_jobs j
 join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 where d.immutable_envelope->>'grantId'=(select grant_id::text from old_ancestry_grant))) is null,
 'completed historical purge cannot execute again against new grant');
select is(pg_temp.readable(),array['78700000-0000-4000-8000-000000000040'::uuid],'historical job replay preserves current regranted ancestry');
-- Second untouched source, without fabricated completed analysis status.
insert into storage.objects(id,bucket_id,name,metadata) values('78700000-0000-4000-8000-000000000021','genomes',
 '78700000-0000-4000-8000-000000000031','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('78700000-0000-4000-8000-000000000041','78700000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 '78700000-0000-4000-8000-000000000031','Independent synthetic source','array_23andme',1,8,repeat('c',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('d',64),'78700000-0000-4000-8000-000000000021');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('78700000-0000-4000-8000-000000000021','78700000-0000-4000-8000-000000000031','genomes',
 '78700000-0000-4000-8000-000000000041',repeat('c',64),8,1,'current');
create temporary table array_preparation as select public.own_upload_normalization_v1('begin',
 '78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041') receipt;
select public.own_upload_normalization_v1('stage','78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041',
 (select (receipt->>'claim')::uuid from array_preparation),
 '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":null,"alt":null,"genotype":"AG"}]}');
select public.own_upload_normalization_v1('complete','78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041',
 (select (receipt->>'claim')::uuid from array_preparation),jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('c',64),'decodedSha256',repeat('d',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));
create temporary table array_claim as select public.own_report_generation_v1('begin',
 '78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041','ancestry') receipt;
create function pg_temp.array_generate(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041','ancestry',
 (select (receipt->>'claim')::uuid from array_claim),payload);
$$;
select is((select receipt#>>'{source,callEncoding}' from array_claim),'array-genotype','real prepared array has explicit checked array encoding');
select is(pg_temp.array_generate('read-variants','{"loci":[{"chrom":1,"pos":100000}],"offset":0}')->0->>'genotype','AG',
 'array generation reads only its exact source variants');
select throws_ok($$select pg_temp.array_generate('read-observed','{"loci":[{"chrom":1,"pos":100000}],"offset":0}')$$,
 '22023','invalid_request','array claim cannot read literal observed-call path');
select is(pg_temp.array_generate('read-variants','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}'),'[]'::jsonb,
 'array claim cannot borrow the other file call');
create temporary table array_output as select jsonb_set(payload,'{ancestry,source}',
 jsonb_build_object('fileId','78700000-0000-4000-8000-000000000041','subjectId',(select id from ancestry_subject),
 'normalizedBuild','GRCh38','callEncoding','array-genotype','sourceRevision',1,'sourceSha256',repeat('c',64),
 'normalizedAt',(select receipt#>'{authorization,normalizedAt}' from array_claim))) payload from ancestry_output;
select is(pg_temp.array_generate('complete',(select payload from array_output))->>'status','complete','second exact array source completes independently');
create temporary table deletion_receipt as select public.prepare_genome_file_deletion_v1(
 '78700000-0000-4000-8000-000000000001','78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040') receipt;
select is(pg_temp.readable(),'{}'::uuid[],'pending source deletion immediately removes ancestry read authority');
select throws_ok($$select public.finish_genome_file_deletion_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040',(select (receipt->>'token')::uuid from deletion_receipt))$$,
 '55000','file_delete_storage_incomplete','source deletion cannot finish before real Storage acknowledgement');
set local storage.allow_delete_query='true';
delete from storage.objects where id='78700000-0000-4000-8000-000000000020';
set local storage.allow_delete_query='false';
select public.finish_genome_file_deletion_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000040',(select (receipt->>'token')::uuid from deletion_receipt));
select is((select count(*) from private.own_analysis_runs where file_id='78700000-0000-4000-8000-000000000040'),0::bigint,
 'acknowledged source deletion cascades only its exact report and ancestry journals');
select is((select count(*) from public.genome_files where id='78700000-0000-4000-8000-000000000041' and sha256=repeat('c',64)),1::bigint,
 'selected deletion preserves unrelated source metadata');
select is(public.own_ancestry_content_v1('78700000-0000-4000-8000-000000000001',
 '78700000-0000-4000-8000-000000000010','78700000-0000-4000-8000-000000000041')->'content',(select payload->'ancestry' from array_output),
 'selected source deletion preserves exact independent completed ancestry');
select is((select count(*) from storage.objects where id='78700000-0000-4000-8000-000000000021'),1::bigint,
 'selected deletion preserves unrelated Storage object');
select ok(not has_function_privilege('authenticated','public.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 and not has_function_privilege('anon','private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)','EXECUTE'),
 'browser and anonymous callers cannot submit ancestry computations');
set constraints all immediate;
select * from finish();
rollback;
