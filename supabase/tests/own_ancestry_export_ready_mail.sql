begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('79100000-0000-4000-8000-000000000001','ancestry-mail-export@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79100000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='79100000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('79100000-0000-4000-8000-000000000020',
 'genomes','79100000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79100000-0000-4000-8000-000000000040','79100000-0000-4000-8000-000000000001',(select id from generation_subject),
 '79100000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79100000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79100000-0000-4000-8000-000000000020','79100000-0000-4000-8000-000000000030','genomes',
 '79100000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79100000-0000-4000-8000-000000000001',
 '79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'79100000-0000-4000-8000-000000000001',
 '79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000040',purpose,
 case when op in ('begin','ready') then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('79100000-0000-4000-8000-000000000001',
 '79100000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' when 'ancestry' then 'consent.own-ancestry' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' when 'ancestry' then 'consent.own-ancestry' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

-- This test owns its published catalog/PGS fixtures; no seed or first-row assumption.
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('ancestry-ready-poly-fixture','basic-traits','Fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('ancestry-ready-mono-fixture','medicines','Fixture','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('ANCESTRY-READY-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$ select jsonb_build_object(
 'reports',jsonb_build_array(jsonb_build_object('slug',case $1 when 'reports.polygenic' then 'ancestry-ready-poly-fixture' else 'ancestry-ready-mono-fixture' end,
 'covered',true,'conflictingRsids','[]'::jsonb,'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved"}}]'::jsonb)),
 'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"ANCESTRY-READY-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
 'readyMail',pg_temp.envelope()); $$;
create function pg_temp.ready_state() returns jsonb language sql as $$ select private.own_report_ready_state_v1(
 '79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000040'); $$;
create function pg_temp.current_mail() returns boolean language sql as $$ select private.file_ready_mail_current_v1(m)
 from public.mail_outbox m where target_id='79100000-0000-4000-8000-000000000040'; $$;

create temporary table export_snapshot as select private.own_export_source_v1(
 '79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000040') value;
create function pg_temp.export_ancestry() returns jsonb language sql as $$
 select public.own_subject_export_content_v1('ancestry','79100000-0000-4000-8000-000000000001',
 '79100000-0000-4000-8000-000000000010','79100000-0000-4000-8000-000000000040',(select value from export_snapshot),0);
$$;
select is(pg_temp.export_ancestry(),'[]'::jsonb,'raw export never invents ancestry before a selected completion');
select is(private.own_report_ready_state_v2('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000040'),null::jsonb,
 'v2 cannot report preparation as ancestry readiness');
-- Produce a real v1 event before selecting ancestry. It must never be relabelled.
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select pg_temp.generate('complete','reports.polygenic',pg_temp.output('reports.polygenic'));
create temporary table v1_notice as select id,canonical_readiness,idempotency_key,expires_at from public.mail_outbox
 where target_id='79100000-0000-4000-8000-000000000040';
select is((select canonical_readiness->>'version' from v1_notice),'own-report-ready-v1','report-only completion preserves v1 event identity');
-- Scope the transport-state fixture to this exact synthetic event; never run
-- the account-wide worker/claim operation against unrelated local fixtures.
savepoint claimed_predecessor;
update public.mail_outbox set state='claimed',claimed_at=clock_timestamp(),attempt_count=1
 where id=(select id from v1_notice);
select ok(private.authorize_mail_submission_v1((select id from v1_notice),1::smallint),
 'claimed v1 is eligible before ancestry is selected');
select pg_temp.grant_report('ancestry',repeat('d',64));
select is((select state from public.mail_outbox where id=(select id from v1_notice)),'invalidated',
 'new ancestry selection permanently cancels an already claimed v1 predecessor');
select ok(not private.authorize_mail_submission_v1((select id from v1_notice),1::smallint),
 'pre-submit refuses the cancelled predecessor');
rollback to claimed_predecessor;
select pg_temp.grant_report('ancestry',repeat('d',64));
select is(private.own_report_ready_state_v2('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000040'),null::jsonb,
 'selected unfinished ancestry prevents v2 readiness');
select throws_ok($$select pg_temp.generate('ready','ancestry',pg_temp.envelope())$$,'55000','reports_not_ready',
 'ready operation cannot ignore selected unfinished ancestry');
select is((select count(*) from public.mail_outbox where target_id='79100000-0000-4000-8000-000000000040'),1::bigint,
 'no premature successor event');
select ok((select not private.file_ready_mail_current_v1(m) from public.mail_outbox m join v1_notice v using(id)),
 'historical v1 cannot claim readiness for an unfinished current ancestry selection');
select is((select state from public.mail_outbox where id=(select id from v1_notice)),'invalidated',
 'new ancestry selection permanently cancels the queued v1 predecessor');
insert into claims values('ancestry',pg_temp.generate('begin','ancestry'));
create temporary table ancestry_output as select jsonb_build_object('ancestry',jsonb_build_object(
 'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
 'source',jsonb_build_object('fileId','79100000-0000-4000-8000-000000000040','subjectId',(select id from generation_subject),
  'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),
  'normalizedAt',receipt#>'{authorization,normalizedAt}'),
 'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
 'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
 'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
 'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb)) payload
 from claims where purpose='ancestry';

select throws_ok($$select pg_temp.generate('complete','ancestry',(select payload from ancestry_output))$$,
 '22023','invalid_ready_envelope','ancestry wrapper requires actual recipient envelope');
select throws_ok($$select pg_temp.generate('complete','ancestry',(select payload from ancestry_output)||
 jsonb_build_object('readyMail',jsonb_set(pg_temp.envelope(),'{contactRevision}','2')))$$,
 '42501','recipient_authority_stale','stale recipient rolls back ancestry completion and queue insertion');
select is((select state from private.own_analysis_runs where file_id='79100000-0000-4000-8000-000000000040' and purpose='ancestry'),'running',
 'failed enqueue does not leave an ancestry completion');
select is(pg_temp.export_ancestry(),'[]'::jsonb,'failed completion cannot leak through export');
select is(pg_temp.generate('complete','ancestry',(select payload from ancestry_output)||jsonb_build_object('readyMail',pg_temp.envelope()))->>'status',
 'complete','valid ancestry and notice commit atomically through the public wrapper');
create temporary table v2_notice as select id,canonical_readiness,idempotency_key,expires_at from public.mail_outbox
 where target_id='79100000-0000-4000-8000-000000000040' and canonical_readiness->>'version'='own-report-ready-v2';
select is((select count(*) from v2_notice),1::bigint,'exactly one ancestry-selected v2 event exists');
select ok((select idempotency_key from v2_notice)<>(select idempotency_key from v1_notice),'v2 selection has a distinct immutable event identity');
select is((select canonical_readiness->'computationRevisions' from v2_notice),
 '{"ancestry":"own-ancestry-v1","reports.polygenic":"own-reports-v1"}'::jsonb,'v2 captures each selected computation contract');
select is((select count(*)::integer from v2_notice,jsonb_object_keys(canonical_readiness->'purposes')),2,
 'v2 contains exactly both selected grants');
select ok((select private.file_ready_mail_current_v1(m) from public.mail_outbox m join v2_notice v using(id)),
 'the existing insert/claim/pre-submit eligibility predicate recognizes a current v2 event');
select ok((select expires_at between clock_timestamp()+interval '29 days 23 hours' and clock_timestamp()+interval '30 days' from v2_notice),
 'new v2 event retains database-owned thirty-day expiry');
select is((select canonical_readiness from public.mail_outbox where id=(select id from v1_notice)),
 (select canonical_readiness from v1_notice),'existing v1 snapshot is unchanged');
select ok((select m.idempotency_key=v.idempotency_key and m.expires_at=v.expires_at
 from public.mail_outbox m join v1_notice v using(id)),
 'cancellation preserves the original v1 event hash and immutable expiry');
select lives_ok($$select pg_temp.generate('ready','ancestry',pg_temp.envelope())$$,'explicit ready replay accepts completed ancestry');
select is((select count(*) from public.mail_outbox where target_id='79100000-0000-4000-8000-000000000040'),2::bigint,'replay creates no duplicate or renewed expiry');
select is((select expires_at from public.mail_outbox where id=(select id from v2_notice)),(select expires_at from v2_notice),'replay preserves original expiry');
select ok((select not private.file_ready_mail_current_v1(jsonb_populate_record(null::public.mail_outbox,
 to_jsonb(m)||jsonb_build_object('canonical_readiness',jsonb_set(m.canonical_readiness,'{version}','"unknown"'))))
 from public.mail_outbox m join v2_notice v using(id)),'unknown readiness versions fail the common eligibility check');
-- A newly selected third purpose must finish before a successor event exists.
savepoint third_purpose;
select pg_temp.grant_report('reports.monogenic',repeat('e',64));
select throws_ok($$select pg_temp.generate('ready','ancestry',pg_temp.envelope())$$,'55000','reports_not_ready',
 'a selected unfinished third purpose cannot be omitted from readiness');
insert into claims values('reports.monogenic',pg_temp.generate('begin','reports.monogenic'));
select pg_temp.generate('complete','reports.monogenic',pg_temp.output('reports.monogenic'));
select is((select count(*)::integer from jsonb_object_keys(private.own_report_ready_state_v2(
 '79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000040')->'purposes')),3,
 'v2 readiness includes all three completed selected purposes');
select is((select count(*) from public.mail_outbox where target_id='79100000-0000-4000-8000-000000000040'),3::bigint,
 'new selection gets one successor event without rewriting earlier events');
rollback to third_purpose;
select throws_ok($$update public.mail_outbox set canonical_readiness=jsonb_set(canonical_readiness,'{version}','"own-report-ready-v1"')
 where id=(select id from v2_notice)$$,'55000','immutable_ready_notice','queued v2 cannot be relabelled as v1');
select is(pg_temp.export_ancestry()->0->'result',(select payload->'ancestry' from ancestry_output),'export reads exact completed journal content');
select is(pg_temp.export_ancestry()->0->>'grant_id',(select receipt#>>'{authorization,grantId}' from claims where purpose='ancestry'),
 'export decision includes exact selected grant identity for final buffer recheck');
grant select on export_snapshot to service_role;
set local role service_role;
select is(jsonb_array_length(pg_temp.export_ancestry()),1,'service role can execute the actual public export reader');
reset role;
select ok(not has_function_privilege('authenticated','public.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer)','execute')
 and not has_function_privilege('anon','private.own_report_ready_state_v2(uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.own_report_ready_state_v2(uuid,uuid)','execute'),'new and existing readers retain service-only authority');
-- Exact contact transition invalidates v1 and v2 without touching analysis.
savepoint contact_changed;
update auth.users set email='ancestry-mail-export-changed@e2e.local' where id='79100000-0000-4000-8000-000000000001';
select ok((select not private.file_ready_mail_current_v1(m) from public.mail_outbox m join v2_notice v using(id)),
 'actual Auth contact change invalidates v2 eligibility before submission');
select is((select state from public.mail_outbox where id=(select id from v2_notice)),'invalidated','contact trigger invalidates queued v2');
rollback to contact_changed;
savepoint source_changed;
-- Keep the file's completion metadata internally consistent while changing
-- its source revision; the previously checked journal/manifest stays stale.
update public.genome_files set upload_revision=2,normalization_source_revision=2
 where id='79100000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.export_ancestry()$$,'42501','not_found','changed raw source cannot reuse export snapshot');
select ok((select not private.file_ready_mail_current_v1(m) from public.mail_outbox m join v2_notice v using(id)),
 'source transition invalidates v2 eligibility');
rollback to source_changed;
-- Genuine purpose withdrawal hides and physically purges only ancestry output.
select public.revoke_directional_purpose_v1('79100000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='ancestry'));
select is(pg_temp.export_ancestry(),'[]'::jsonb,'revoked ancestry is absent from export');
select is((select state from public.mail_outbox where id=(select id from v1_notice)),'invalidated',
 'ancestry withdrawal cannot revive the cancelled v1 predecessor');
select ok(not private.authorize_mail_submission_v1((select id from v1_notice),1::smallint),
 'pre-submit still refuses the predecessor after ancestry withdrawal');
select ok((select not private.file_ready_mail_current_v1(m) from public.mail_outbox m join v2_notice v using(id)),
 'v2 no longer matches a changed selected grant set');
select is((select state from public.mail_outbox where id=(select id from v2_notice)),'invalidated','ancestry purge invalidates its pending ready event');
select is((select count(*) from private.own_analysis_runs where file_id='79100000-0000-4000-8000-000000000040' and purpose='ancestry'),0::bigint,
 'actual ancestry journal is physically absent after withdrawal');
select is((select count(*) from private.own_analysis_runs where file_id='79100000-0000-4000-8000-000000000040' and purpose='reports.polygenic' and state='complete'),1::bigint,
 'independently chosen report completion survives ancestry withdrawal');
select is((select count(*) from public.report_observed_calls where file_id='79100000-0000-4000-8000-000000000040'),1::bigint,
 'prepared raw observation remains');
select ok(private.own_export_source_v1('79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000010',
 '79100000-0000-4000-8000-000000000040') is not null,'raw export remains authorized after ancestry withdrawal');
-- A genuine regrant with ancestry as the only selected purpose also works.
select public.revoke_directional_purpose_v1('79100000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic'));
select pg_temp.grant_report('ancestry',repeat('f',64));
update claims set receipt=pg_temp.generate('begin','ancestry') where purpose='ancestry';
select is(pg_temp.generate('complete','ancestry',(select payload from ancestry_output)||jsonb_build_object('readyMail',pg_temp.envelope()))->>'status',
 'complete','ancestry-only regrant completes through the same atomic wrapper');
select is((select jsonb_agg(k) from jsonb_object_keys(private.own_report_ready_state_v2(
 '79100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000040')->'purposes') k),
 '["ancestry"]'::jsonb,'ancestry-only ready event claims no unselected report purpose');
select ok((pg_temp.export_ancestry()->0->>'grant_id') is distinct from
 (select canonical_readiness#>>'{purposes,ancestry,grantId}' from v2_notice),'regrant export carries the new authority, never the purged grant');
select ok((select not private.file_ready_mail_current_v1(m) from public.mail_outbox m join v2_notice v using(id)),
 'new completion cannot revive the old v2 event');
select * from finish();
rollback;
