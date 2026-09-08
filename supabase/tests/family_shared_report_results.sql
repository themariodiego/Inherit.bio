begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('79010000-0000-4000-8000-000000000001','shared-source@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79010000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='79010000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('79010000-0000-4000-8000-000000000020',
 'genomes','79010000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79010000-0000-4000-8000-000000000040','79010000-0000-4000-8000-000000000001',(select id from generation_subject),
 '79010000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79010000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79010000-0000-4000-8000-000000000020','79010000-0000-4000-8000-000000000030','genomes',
 '79010000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000040',purpose,
 case when op in ('begin','ready') then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

-- This test owns its published catalog/PGS fixtures; no seed or first-row assumption.
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('shared-poly-fixture','basic-traits','Fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('shared-mono-fixture','medicines','Fixture','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('OWN-SHARED-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$ select jsonb_build_object(
 'reports',jsonb_build_array(jsonb_build_object('slug',case $1 when 'reports.polygenic' then 'shared-poly-fixture' else 'shared-mono-fixture' end,
 'covered',true,'conflictingRsids','[]'::jsonb,'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb)),
 'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"OWN-SHARED-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
 'readyMail',pg_temp.envelope()); $$;
create function pg_temp.captured_output() returns jsonb language sql as $$
 select jsonb_set(pg_temp.output('reports.polygenic'),'{reports,0,catalogSnapshot}',
  jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,'evidence',t.evidence,
   'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))
 from public.report_templates t where slug='shared-poly-fixture'; $$;

create function pg_temp.ready_state() returns jsonb language sql as $$ select private.own_report_ready_state_v1(
 '79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000040'); $$;
create function pg_temp.current_mail() returns boolean language sql as $$ select private.file_ready_mail_current_v1(m)
 from public.mail_outbox m where target_id='79010000-0000-4000-8000-000000000040'; $$;
-- A and unrelated C never upload or acquire B's own grants. B's real source
-- is prepared above with the existing stage/complete authority functions.
insert into auth.users(id,email,email_confirmed_at) values
 ('79010000-0000-4000-8000-000000000002','shared-viewer@e2e.local',now()),
 ('79010000-0000-4000-8000-000000000003','shared-outsider@e2e.local',now());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79010000-0000-4000-8000-000000000012','79010000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('79010000-0000-4000-8000-000000000013','79010000-0000-4000-8000-000000000003',now(),now(),'aal1');
update public.profiles set date_of_birth='1990-01-01' where id in(
 '79010000-0000-4000-8000-000000000002','79010000-0000-4000-8000-000000000003');
create function pg_temp.presentation() returns text language sql as $$
 select public.family_report_grant_presentation_v1('79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010',(select id from generation_subject),'79010000-0000-4000-8000-000000000002'); $$;
create function pg_temp.share(receipt text,nonce text) returns uuid language sql as $$
 select public.grant_family_report_purpose_v1('79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010',(select id from generation_subject),
 (select id from public.subject_principals where account_id='79010000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active'),
 '79010000-0000-4000-8000-000000000002','reports.polygenic',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt); $$;
create function pg_temp.shared(mode text default 'content') returns jsonb language sql as $$
 select public.family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),'reports.polygenic',null,mode); $$;
select is(has_function_privilege('authenticated','public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text)','execute'),false,'browser cannot call service projection');
select is(has_function_privilege('anon','public.grant_family_report_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)','execute'),false,'anon cannot issue snapshot-bearing grant');
select is(has_table_privilege('service_role','private.family_report_grant_snapshots','insert'),false,'service client cannot backfill grant snapshots directly');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','prepared source and family membership do not authorize a recipient');
create temporary table old_shared as select public.grant_directional_purpose_v1(
 '79010000-0000-4000-8000-000000000001',(select id from generation_subject),
 (select id from public.subject_principals where account_id='79010000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active'),
 'reports.polygenic','consent.share-with-adult',1,'legacy-share-nonce-000000000000') id;
select is(pg_temp.shared()->>'legacyOnly','true','unproven historical permission explicitly remains legacy only');
select is(pg_temp.shared()->'sources','[]'::jsonb,'legacy permission never opens canonical sources');
savepoint legacy_dob;
update public.profiles set date_of_birth=null where id='79010000-0000-4000-8000-000000000002';
select is(pg_temp.shared()->>'legacyOnly','true','historical legacy permission does not invent a new DOB prerequisite');
select is(pg_temp.shared()->'sources','[]'::jsonb,'legacy DOB compatibility still withholds every canonical source');
select throws_ok($$select pg_temp.presentation()$$,'42501','not_found','new report sharing requires actual adult endpoint proof');
rollback to legacy_dob;
create temporary table shared_grant as select pg_temp.share(pg_temp.presentation(),'new-share-nonce-00000000000000') id;
select isnt((select id from shared_grant),(select id from old_shared),'explicit new consent replaces rather than backfills historical grant');
select ok((select revoked_at is not null from public.purpose_grants where grant_id=(select id from old_shared)),'prior historical grant is terminal');
select is(pg_temp.shared()->>'legacyOnly','false','new endpoints prove canonical access');
select is(pg_temp.shared()->'sources','[]'::jsonb,'sharing alone never generates a report');
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select is(pg_temp.shared()->'sources','[]'::jsonb,'running generation is not a captured result');
select is(pg_temp.generate('complete','reports.polygenic',pg_temp.captured_output())->>'status','complete','independent owner purpose completes through real generation wrapper');
create temporary table captured_share as select pg_temp.shared() receipt;
create function pg_temp.confirm_captured() returns boolean language sql as $$
 select public.confirm_family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),'content',
 jsonb_build_array(jsonb_build_object('purpose','reports.polygenic','afterFile',null,'receipt',(select receipt->>'pageReceipt' from captured_share)))); $$;
select is(pg_temp.confirm_captured(),true,'one locked terminal transaction confirms the exact captured source');
select is(jsonb_array_length((select receipt->'sources' from captured_share)),1,'recipient reads one exact completed source');
select is((select receipt#>>'{sources,0,subjectId}' from captured_share),(select id::text from generation_subject),'result is attributed to B self subject');
select is((select receipt#>>'{sources,0,reports,0,catalogSnapshot,template,title}' from captured_share),'Fixture','scientific title is captured at completion');
select ok((select receipt#>>'{sources,0,reports,0,catalogSnapshot,templateSha256}' from captured_share)~'^[0-9a-f]{64}$','captured template has DB digest');
select is(pg_temp.shared('readiness')#>>'{sources,0,hasReports}','true','metadata-only readiness can announce existing reports');
select ok(pg_temp.shared('readiness')::text !~ 'genotype|interpretation|catalogSnapshot|sourceSha256|bucket_path','pre-gate response contains no genetic or source payload');
select ok(pg_temp.shared()::text !~ 'raw_score|percentile|zscore|bucket_path|source_sha256','content projection excludes raw PRS values and storage identifiers');
select throws_ok($$select public.family_shared_report_results_v1('79010000-0000-4000-8000-000000000003',
 '79010000-0000-4000-8000-000000000013',(select id from generation_subject),'reports.polygenic')$$,
 '42501','not_found','same source cannot be read by unrelated recipient');
select throws_ok($$select public.family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),'reports.monogenic')$$,
 '42501','not_found','one purpose never opens an unshared layer');
select throws_ok($$select public.family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),null)$$,
 '42501','not_found','SQL-null purpose refuses');
select throws_ok($$select pg_temp.shared('unknown')$$,'22023','invalid_request','unknown projection mode refuses');

savepoint owner_logout;
delete from auth.sessions where id='79010000-0000-4000-8000-000000000010';
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'owner need not remain logged in for lawful recipient read');
rollback to owner_logout;
savepoint viewer_logout;
delete from auth.sessions where id='79010000-0000-4000-8000-000000000012';
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','viewer session must remain live');
rollback to viewer_logout;
savepoint presentation_race;
create temporary table before_binding as select pg_temp.presentation() receipt;
update public.subject_account_bindings set binding_revision=binding_revision+1
 where account_id='79010000-0000-4000-8000-000000000002' and status='current';
select throws_ok($$select pg_temp.share((select receipt from before_binding),'stale-prompt-nonce-000000000000')$$,
 '42501','not_found','same-ID recipient binding change between presentation and confirmation denies grant');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','same-ID binding change after grant denies read instead of legacy fallback');
rollback to presentation_race;
savepoint principal_change;
update public.subject_principals set principal_revision=principal_revision+1
 where account_id='79010000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','current principal with changed revision cannot revive prior grant');
rollback to principal_change;
savepoint relationship_change;
update public.subject_relationships set relationship_revision=relationship_revision+1 where subject_id=(select id from generation_subject) and recipient_account_id='79010000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','changed relationship revision cannot supply captured result');
rollback to relationship_change;
savepoint jurisdiction_change;
update public.profiles set jurisdiction_revision=jurisdiction_revision+1 where id='79010000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','recipient jurisdiction revision is bound independently');
rollback to jurisdiction_change;
savepoint stale_source;
update private.own_normalization_runs set manifest=jsonb_set(manifest,'{sourceRevision}','2') where file_id='79010000-0000-4000-8000-000000000040';
select is(pg_temp.shared()->'sources','[]'::jsonb,'mismatched normalization source never supplies result');
select is(pg_temp.confirm_captured(),false,'terminal confirmation refuses source drift after capture');
rollback to stale_source;
savepoint partial_result;
update private.own_analysis_runs set state='running',completed_at=null where file_id='79010000-0000-4000-8000-000000000040';
select is(pg_temp.shared()->'sources','[]'::jsonb,'incomplete journal never inherits prior completion');
rollback to partial_result;
savepoint pause;
select public.pause_family_sharing_v1('79010000-0000-4000-8000-000000000002','79010000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','pause immediately denies recipient read');
select is((select count(*) from private.own_analysis_runs where file_id='79010000-0000-4000-8000-000000000040'),1::bigint,'pause preserves independent owner result');
rollback to pause;
savepoint revoke;
select public.revoke_directional_purpose_v1('79010000-0000-4000-8000-000000000001',(select id from shared_grant));
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','actual directional withdrawal removes recipient access');
select is(pg_temp.confirm_captured(),false,'terminal confirmation cannot publish a captured result after withdrawal');
select is((select count(*) from private.own_analysis_runs where file_id='79010000-0000-4000-8000-000000000040'),1::bigint,'sharing withdrawal preserves owner completion');
select is((select count(*) from public.genome_files where id='79010000-0000-4000-8000-000000000040'),1::bigint,'sharing withdrawal preserves original');
rollback to revoke;
select is(public.confirm_family_shared_readiness_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',jsonb_build_array(jsonb_build_object('subjectId',(select id from generation_subject),
 'expected',jsonb_build_array(jsonb_build_object('purpose','reports.polygenic','afterFile',null,'receipt',pg_temp.shared('readiness')->>'pageReceipt'))))),
 true,'hub terminal confirmation uses metadata receipts only');

-- Two independently completed files: a changed first source cannot be hidden
-- by a valid later source during terminal confirmation.
insert into storage.objects(id,bucket_id,name,metadata) values('79010000-0000-4000-8000-000000000070',
 'genomes','79010000-0000-4000-8000-000000000080','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79010000-0000-4000-8000-000000000090','79010000-0000-4000-8000-000000000001',(select id from generation_subject),
 '79010000-0000-4000-8000-000000000080','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79010000-0000-4000-8000-000000000070');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79010000-0000-4000-8000-000000000070','79010000-0000-4000-8000-000000000080','genomes',
 '79010000-0000-4000-8000-000000000090',repeat('a',64),8,1,'current');
create temporary table preparation2 as select public.own_upload_normalization_v1('begin',
 '79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000090') receipt;
create function pg_temp.prepare2(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000090',(select (receipt->>'claim')::uuid from preparation2),payload);
$$;
select pg_temp.prepare2('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare2('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));

create temporary table second_claim as select public.own_report_generation_with_mail_v1('begin',
 '79010000-0000-4000-8000-000000000001','79010000-0000-4000-8000-000000000010',
 '79010000-0000-4000-8000-000000000090','reports.polygenic') receipt;
select public.own_report_generation_with_mail_v1('complete','79010000-0000-4000-8000-000000000001',
 '79010000-0000-4000-8000-000000000010','79010000-0000-4000-8000-000000000090','reports.polygenic',
 (select (receipt->>'claim')::uuid from second_claim),pg_temp.captured_output());
create temporary table multiple_capture as select pg_temp.shared() receipt;
select is(jsonb_array_length((select receipt->'sources' from multiple_capture)),2,'two completed sources remain independently represented');
savepoint first_source_changed;
update private.own_normalization_runs set manifest=jsonb_set(manifest,'{sourceRevision}','2')
 where file_id='79010000-0000-4000-8000-000000000040';
select is(pg_temp.shared()#>>'{sources,0,fileId}','79010000-0000-4000-8000-000000000090','second source remains valid when first source changes');
select is(public.confirm_family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),'content',
 jsonb_build_array(jsonb_build_object('purpose','reports.polygenic','afterFile',null,'receipt',(select receipt->>'pageReceipt' from multiple_capture)))),
 false,'terminal multi-source receipt refuses first-source drift even when second remains valid');
rollback to first_source_changed;
-- Exercise the deployed service role, not just the migration owner.
grant select on generation_subject to service_role;
set local role service_role;
select is(jsonb_array_length(public.family_shared_report_results_v1('79010000-0000-4000-8000-000000000002',
 '79010000-0000-4000-8000-000000000012',(select id from generation_subject),'reports.polygenic')->'sources'),2,
 'service role can call the projection while private snapshot table stays inaccessible');
reset role;

select * from finish();
rollback;
