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
 values('SYNTHETIC_OWN_GENERATION','Synthetic generation reference','Synthetic test trait',1,
 '{"label":"Synthetic test reference"}','http://localhost/synthetic-pgs','Synthetic fixture; no population inference.');
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,pgs_id)
 values('synthetic-own-generation-estimate','synthetic','Synthetic generation estimate','Synthetic database test fixture.',
 'published','emerging','estimate','polygenic_score','SYNTHETIC_OWN_GENERATION');
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('76800000-0000-4000-8000-000000000001','generation@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76800000-0000-4000-8000-000000000010','76800000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76800000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='76800000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('76800000-0000-4000-8000-000000000020',
 'genomes','76800000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76800000-0000-4000-8000-000000000040','76800000-0000-4000-8000-000000000001',(select id from generation_subject),
 '76800000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76800000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76800000-0000-4000-8000-000000000020','76800000-0000-4000-8000-000000000030','genomes',
 '76800000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010','76800000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76800000-0000-4000-8000-000000000001',
 '76800000-0000-4000-8000-000000000010','76800000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'76800000-0000-4000-8000-000000000001',
 '76800000-0000-4000-8000-000000000010','76800000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('76800000-0000-4000-8000-000000000001',
 '76800000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.readable(purpose text default 'reports.polygenic') returns uuid[] language sql as $$
 select public.filter_own_analysis_files_v1('76800000-0000-4000-8000-000000000001','76800000-0000-4000-8000-000000000010',
 (select id from generation_subject),purpose,array['76800000-0000-4000-8000-000000000040'::uuid],true);
$$;
select is(pg_temp.generate('begin')->>'status','not_selected','preparation alone never enables a report');
select is((select count(*) from private.own_analysis_runs where file_id='76800000-0000-4000-8000-000000000040'),0::bigint,'no purpose means no analysis run');
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
select is(pg_temp.readable(),'{}'::uuid[],'a saved checkbox alone does not expose results');
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select is((select receipt->>'status' from claims),'authorized','one selected purpose starts its exact source run');
select throws_ok($$select pg_temp.generate('begin')$$,'55000','analysis_in_progress','a live claim cannot be stolen by another begin');
select is(pg_temp.generate('begin','reports.monogenic')->>'status','not_selected','polygenic does not authorize monogenic');
select throws_ok($$select pg_temp.generate('begin','ancestry')$$,'22023','invalid_request','ancestry is not silently computed by this dispatcher');
select is(pg_temp.generate('read-observed','reports.polygenic','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}')->0->>'genotype','A/G',
 'GRCh37 source is selected by normalized GRCh38 locus with preserved allele call');
select is(pg_temp.generate('read-observed','reports.polygenic','{"loci":[{"chrom":2,"pos":136608646}],"offset":0}'),'[]'::jsonb,
 'source-build coordinates are not mistaken for normalized coordinates');
select ok((select source_sha256=repeat('a',64) and source_build='GRCh37' and source_pos=136608646
 from public.report_observed_calls where file_id='76800000-0000-4000-8000-000000000040'),
 'gzip-style distinct raw/decoded hashes certify observed rows with the raw hash');
savepoint wrong_hash;
update public.report_observed_calls set source_sha256=repeat('b',64) where file_id='76800000-0000-4000-8000-000000000040';
select is(pg_temp.generate('read-observed','reports.polygenic','{"loci":[{"chrom":2,"pos":135851076}],"offset":0}'),'[]'::jsonb,
 'decoded hash cannot substitute for the exact certified raw source');
rollback to wrong_hash;
savepoint replaced_source;
update public.genome_files set upload_revision=upload_revision+1,normalization_source_revision=normalization_source_revision+1
 where id='76800000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','source revision changes invalidate the run before computation');
rollback to replaced_source;
select throws_ok($$select pg_temp.generate('complete','reports.polygenic','{"reports":[{"slug":"not-a-published-template"}],"prs":[]}')$$,
 '22023','invalid_request','unpublished report output cannot become ready');
create temporary table report_output as select jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',slug,'covered',1)),
 'prs','[{"pgs_id":"SYNTHETIC_OWN_GENERATION","raw_score":0.1,"coverage":0.2,"matched":1}]'::jsonb) payload
 from public.report_templates where slug='synthetic-own-generation-estimate' and status='published' and layer='estimate';
-- Capture the exact reference input without rewriting the legacy fixture below.
create temporary table captured_output as select jsonb_set(payload,'{reports,0,catalogSnapshot}',
 jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
 'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
 'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind))) payload
 from report_output cross join public.report_templates t where t.slug='synthetic-own-generation-estimate';
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(
 (select payload from captured_output),'{reports,0,catalogSnapshot,template,title}','"Different title"'))$$,
 '22023','invalid_report_catalog','a description not used by the published template cannot be captured');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(
 (select payload from captured_output),'{reports,0,catalogSnapshot,template,citations}','[{"label":"Invented"}]'))$$,
 '22023','invalid_report_catalog','a substituted citation cannot be captured');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(
 (select payload from captured_output),'{reports,0,catalogSnapshot,template,layer}','"variant_call"'))$$,
 '22023','invalid_report_catalog','the other report purpose cannot supply captured metadata');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(
 (select payload from captured_output),'{reports,0,catalogSnapshot,templateSha256}',to_jsonb(repeat('a',64))))$$,
 '22023','invalid_report_catalog','the caller cannot choose the catalog digest');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(
 (select payload from captured_output),'{reports,0,catalogSnapshot,schemaVersion}','null'))$$,
 '22023','invalid_report_catalog','a null snapshot version fails closed');
savepoint edited_catalog;
update public.report_templates set title='Changed after generation read' where slug='synthetic-own-generation-estimate';
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',(select payload from captured_output))$$,
 '22023','invalid_report_catalog','a catalog edit between read and completion cannot masquerade as the old reference');
rollback to edited_catalog;
savepoint unpublished_catalog;
update public.report_templates set status='draft' where slug='synthetic-own-generation-estimate';
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',(select payload from captured_output))$$,
 '22023','invalid_request','unpublished reference cannot complete a captured report');
rollback to unpublished_catalog;
savepoint captured_completion;
select is(pg_temp.generate('complete','reports.polygenic',(select payload from captured_output))->>'status','complete',
 'an exact published reference completes with the real selected purpose');
select is((select result#>>'{reports,0,catalogSnapshot,templateSha256}' from private.own_analysis_runs
 where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),
 (select encode(extensions.digest(convert_to((payload#>'{reports,0,catalogSnapshot,template}')::text,'UTF8'),'sha256'),'hex')
 from captured_output),'the database digest binds all exact template fields');
update public.report_templates set title='Later catalog title' where slug='synthetic-own-generation-estimate';
select is((select result#>>'{reports,0,catalogSnapshot,template,title}' from private.own_analysis_runs
 where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),'Synthetic generation estimate',
 'later catalog changes do not rewrite historical results');
select throws_ok($$update private.own_analysis_runs set result=jsonb_set(result,'{reports,0,covered}','false')
 where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'$$,
 '55000','completed_report_is_immutable','completed outcomes and their source reference cannot be rewritten');
rollback to captured_completion;
select is(pg_temp.generate('complete','reports.polygenic',(select payload from report_output))->>'status','complete','chosen report results publish atomically');
select ok((select not(result#>'{reports,0}' ? 'catalogSnapshot') from private.own_analysis_runs
 where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),
 'older application completion remains compatible and receives no invented historical metadata');
select is(pg_temp.readable(),array['76800000-0000-4000-8000-000000000040'::uuid],'completed purpose now exposes this exact source');
select is(pg_temp.readable('reports.monogenic'),'{}'::uuid[],'unchosen report family remains hidden');
select is(pg_temp.generate('begin')->>'status','complete','repeat generation returns completed evidence without new work');
savepoint session_refresh;
update public.profiles set auth_session_revision=auth_session_revision+1 where id='76800000-0000-4000-8000-000000000001';
update auth.sessions set refresh_token_counter=coalesce(refresh_token_counter,0)+1 where id='76800000-0000-4000-8000-000000000010';
select is(pg_temp.readable(),array['76800000-0000-4000-8000-000000000040'::uuid],
 'a currently authenticated session refresh preserves completed source results');
rollback to session_refresh;
savepoint account_transition;
update public.profiles set account_revision=account_revision+1 where id='76800000-0000-4000-8000-000000000001';
select is(pg_temp.readable(),'{}'::uuid[],
 'an account lifecycle revision transition invalidates its older completed marker');
rollback to account_transition;
select is((select array_agg(purpose) from private.own_analysis_runs where file_id='76800000-0000-4000-8000-000000000040'),array['reports.polygenic'],'only selected purpose has an output marker');
select ok((select zscore is null and percentile is null from public.user_prs where file_id='76800000-0000-4000-8000-000000000040'),
 'coverage proof does not fabricate calibrated score percentiles');
select is((select status::text from public.genome_files where id='76800000-0000-4000-8000-000000000040'),'stored','completion never flips the global annotated flag');
select is((select count(*) from public.ancestry_results where file_id='76800000-0000-4000-8000-000000000040')+
 (select count(*) from public.worker_jobs where file_id='76800000-0000-4000-8000-000000000040'),0::bigint,'no ancestry or fake queue jobs');
select pg_temp.grant_report('reports.monogenic',repeat('d',64));
insert into claims values('reports.monogenic',pg_temp.generate('begin','reports.monogenic'));
select throws_ok($$select pg_temp.generate('complete','reports.monogenic',(select payload from report_output))$$,'22023','invalid_request','monogenic cannot persist a PGS payload');
select public.revoke_directional_purpose_v1('76800000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic'));
select is(pg_temp.readable(),'{}'::uuid[],'withdrawal immediately hides completed report results');
select is((select count(*) from private.own_analysis_runs where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),0::bigint,
 'withdrawal removes its completed marker and interpretation');
select is((select count(*) from public.user_prs where file_id='76800000-0000-4000-8000-000000000040'),0::bigint,'withdrawal removes its stored PGS outputs');
select is((select count(*) from private.own_analysis_runs where file_id='76800000-0000-4000-8000-000000000040' and purpose='reports.monogenic'),1::bigint,
 'withdrawal preserves independently selected monogenic work');
select is((select count(*) from public.report_observed_calls where file_id='76800000-0000-4000-8000-000000000040'),1::bigint,
 'withdrawal preserves store-authorized normalized source');
select ok(not has_function_privilege('authenticated','public.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE'),
 'browser cannot forge generation claims or interpreted payloads');
select ok(not has_function_privilege('anon','public.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE'),
 'anonymous caller cannot access generation');
select ok(not has_table_privilege('authenticated','private.own_analysis_runs','SELECT'),'private interpretation store is not directly readable');
select ok(not has_column_privilege('authenticated','public.user_prs','raw_score','SELECT')
 and not has_column_privilege('authenticated','public.user_prs','zscore','SELECT')
 and not has_column_privilege('authenticated','public.user_prs','percentile','SELECT')
 and not has_column_privilege('authenticated','public.user_prs','coverage','SELECT'),
 'existing API column grants deny every unvalidated numeric score and coverage fraction');
select ok(has_column_privilege('authenticated','public.user_prs','matched','SELECT'),
 'safe matched-position counts remain available to authorized owners');
set constraints all immediate;
select * from finish();
rollback;
