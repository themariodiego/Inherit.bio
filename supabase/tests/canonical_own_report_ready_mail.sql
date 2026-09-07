begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('78800000-0000-4000-8000-000000000001','ready-notice@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('78800000-0000-4000-8000-000000000010','78800000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='78800000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='78800000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('78800000-0000-4000-8000-000000000020',
 'genomes','78800000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('78800000-0000-4000-8000-000000000040','78800000-0000-4000-8000-000000000001',(select id from generation_subject),
 '78800000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'78800000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('78800000-0000-4000-8000-000000000020','78800000-0000-4000-8000-000000000030','genomes',
 '78800000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000010','78800000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'78800000-0000-4000-8000-000000000001',
 '78800000-0000-4000-8000-000000000010','78800000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'78800000-0000-4000-8000-000000000001',
 '78800000-0000-4000-8000-000000000010','78800000-0000-4000-8000-000000000040',purpose,
 case when op in ('begin','ready') then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('78800000-0000-4000-8000-000000000001',
 '78800000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

-- This test owns its published catalog/PGS fixtures; no seed or first-row assumption.
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('ready-poly-fixture','basic-traits','Fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('ready-mono-fixture','medicines','Fixture','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('OWN-READY-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$ select jsonb_build_object(
 'reports',jsonb_build_array(jsonb_build_object('slug',case $1 when 'reports.polygenic' then 'ready-poly-fixture' else 'ready-mono-fixture' end,
 'covered',true,'conflictingRsids','[]'::jsonb,'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved"}}]'::jsonb)),
 'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"OWN-READY-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
 'readyMail',pg_temp.envelope()); $$;
create function pg_temp.ready_state() returns jsonb language sql as $$ select private.own_report_ready_state_v1(
 '78800000-0000-4000-8000-000000000001','78800000-0000-4000-8000-000000000040'); $$;
create function pg_temp.current_mail() returns boolean language sql as $$ select private.file_ready_mail_current_v1(m)
 from public.mail_outbox m where target_id='78800000-0000-4000-8000-000000000040'; $$;
select is((select mail_contact_revision from public.profiles where id='78800000-0000-4000-8000-000000000001'),1::bigint,'new account seeds DB-owned contact revision one');
select is(pg_temp.ready_state(),null::jsonb,'preparation alone is not report readiness');
select is((select count(*) from public.mail_outbox where target_id='78800000-0000-4000-8000-000000000040'),0::bigint,'no preparation notice');
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
select pg_temp.grant_report('reports.monogenic',repeat('d',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin')),('reports.monogenic',pg_temp.generate('begin','reports.monogenic'));
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',pg_temp.output('reports.polygenic')-'readyMail')$$,
 '22023','invalid_ready_envelope','new application completion cannot omit recipient envelope');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',null)$$,
 '22023','invalid_ready_envelope','SQL-null completion payload is refused before delegation');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(pg_temp.output('reports.polygenic'),'{readyMail}','null'))$$,
 '22023','invalid_ready_envelope','JSON-null envelope rolls back delegated completion');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',jsonb_set(pg_temp.output('reports.polygenic'),'{readyMail}','{}'))$$,
 '22023','invalid_ready_envelope','enqueue rejection rolls back delegated completion');
select is((select state from private.own_analysis_runs where file_id='78800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),
 'running','rejected enqueue leaves completion uncommitted');
select is((select count(*) from public.user_prs where file_id='78800000-0000-4000-8000-000000000040'),0::bigint,'rejected enqueue rolls back PGS writes');
savepoint auth_before_enqueue;
update auth.users set email='new-before-enqueue@e2e.local' where id='78800000-0000-4000-8000-000000000001';
select is((select mail_contact_revision from public.profiles where id='78800000-0000-4000-8000-000000000001'),2::bigint,
 'actual Auth email transition advances its independent mail counter');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',pg_temp.output('reports.polygenic'))$$,
 '42501','recipient_authority_stale','email change after envelope resolution rejects old recipient in completion transaction');
select is((select state from private.own_analysis_runs where file_id='78800000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),
 'running','stale Auth recipient rolls back delegated completion');
select is((select count(*) from public.user_prs where file_id='78800000-0000-4000-8000-000000000040'),0::bigint,
 'stale Auth recipient rolls back delegated PGS writes');
rollback to auth_before_enqueue;
select is(pg_temp.generate('complete','reports.polygenic',pg_temp.output('reports.polygenic'))->>'status','complete','first selected purpose completes');
select is(pg_temp.ready_state(),null::jsonb,'partial selected-purpose completion is not blanket ready');
select is((select count(*) from public.mail_outbox where target_id='78800000-0000-4000-8000-000000000040'),0::bigint,'no notice after partial success');
savepoint partial_failure;
select pg_temp.generate('fail','reports.monogenic');
select is(pg_temp.ready_state(),null::jsonb,'failed selected purpose never becomes ready');
select is((select count(*) from public.mail_outbox where target_id='78800000-0000-4000-8000-000000000040'),0::bigint,'ordinary failure invents no email');
rollback to partial_failure;
select is(pg_temp.generate('complete','reports.monogenic',pg_temp.output('reports.monogenic'))->>'status','complete','last selected completion queues atomically');
create temporary table original_notice as select * from public.mail_outbox where target_id='78800000-0000-4000-8000-000000000040';
select is((select count(*) from original_notice),1::bigint,'one notice for the exact selected source/grant set');
select ok(pg_temp.current_mail(),'same shared source predicate accepts inserted notice');
select is(private.file_ready_mail_current_v1(null::public.mail_outbox),false,'a null candidate is false, never unknown');
select is((select private.file_ready_mail_current_v1(jsonb_populate_record(null::public.mail_outbox,
 to_jsonb(o)||'{"canonical_readiness":null}'::jsonb)) from original_notice o),false,
 'missing canonical snapshot is a total false even while exact source is ready');
select is((select private.file_ready_mail_current_v1(jsonb_populate_record(null::public.mail_outbox,
 to_jsonb(o)||'{"target_kind":null}'::jsonb)) from original_notice o),false,
 'missing target kind cannot inherit source readiness');
select ok((select canonical_readiness=pg_temp.ready_state() and canonical_readiness->'purposes' ?& array['reports.monogenic','reports.polygenic'] from original_notice),
 'event captures both exact completed authorities');
select ok((select idempotency_key=encode(extensions.digest(convert_to(canonical_readiness::text,'UTF8'),'sha256'),'hex') from original_notice),
 'identity is SHA256 of canonical JSONB ready snapshot');
select ok((select expires_at<=clock_timestamp()+interval '30 days' and expires_at>clock_timestamp()+interval '29 days' from original_notice),
 'database supplies bounded thirty-day expiry');
select is((select template_payload from original_notice),'{"reportCount":0,"dashboardUrl":"https://example.invalid/genome/me/reports"}'::jsonb,
 'mail payload contains no findings, variants, filenames or source data');
select is(pg_temp.generate('ready','reports.polygenic',pg_temp.envelope()),'true'::jsonb,'completed replay acknowledges the durable event');
select throws_ok($$select pg_temp.generate('ready',null,pg_temp.envelope())$$,
 '22023','invalid_request','ready cannot select a null purpose');
select throws_ok($$select pg_temp.generate('ready','ancestry',pg_temp.envelope())$$,
 '22023','invalid_request','ready adapter cannot widen supported report operations');
select ok((select (m.id,m.contact_reference_id,m.expires_at,m.idempotency_key,m.canonical_readiness)=(o.id,o.contact_reference_id,o.expires_at,o.idempotency_key,o.canonical_readiness)
 from public.mail_outbox m join original_notice o using(id)),'replay preserves event contact identity and deadline');
select throws_ok($$update public.mail_outbox set expires_at=expires_at+interval '1 day' where id=(select id from original_notice)$$,
 '55000','immutable_ready_notice','replay cannot renew an existing deadline');
select throws_ok($$update public.mail_outbox set canonical_readiness='{}' where id=(select id from original_notice)$$,
 '55000','immutable_ready_notice','captured readiness cannot be rewritten');
-- Generic account enqueue cannot substitute an annotated flag for canonical readiness.
create function pg_temp.old_enqueue(file uuid,key text) returns uuid language sql as $$
 select public.enqueue_account_mail('78800000-0000-4000-8000-000000000001',decode(repeat('ab',40),'hex'),repeat('e',64),
 'report-ready','report.ready','genome_file',$1,'{"reportCount":1,"dashboardUrl":"https://example.invalid/genome/me/reports"}',
 encode(extensions.digest($2,'sha256'),'hex')); $$;
select throws_ok($$select pg_temp.old_enqueue('78800000-0000-4000-8000-000000000040','canonical-bypass')$$,
 '55000','file_target_unavailable','generic enqueue cannot omit canonical readiness');
savepoint annotated_bypass;
update public.genome_files set status='annotated' where id='78800000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.old_enqueue('78800000-0000-4000-8000-000000000040','canonical-annotated-bypass')$$,
 '55000','file_target_unavailable','canonical annotated flag cannot bypass source and grants');
rollback to annotated_bypass;
savepoint legacy_compatibility;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
 values('78800000-0000-4000-8000-000000000050','78800000-0000-4000-8000-000000000001',(select id from generation_subject),
 '78800000-0000-4000-8000-000000000001/legacy-fixture','synthetic.txt','array_ancestry',1,1,'annotated');
select lives_ok($$select pg_temp.old_enqueue('78800000-0000-4000-8000-000000000050','actual-legacy')$$,
 'actual legacy annotated sources preserve existing enqueue behavior');
select ok((select private.file_ready_mail_current_v1(m) from public.mail_outbox m where target_id='78800000-0000-4000-8000-000000000050'),
 'actual legacy readiness remains valid for claim and pre-submit');
rollback to legacy_compatibility;
savepoint candidate_fences;
delete from auth.sessions where id='78800000-0000-4000-8000-000000000010';
select ok(pg_temp.current_mail(),'durable current recipient does not depend on an expired browser login');
rollback to candidate_fences;
select throws_ok($$update public.genome_files set source_sha256=repeat('f',64) where id='78800000-0000-4000-8000-000000000040'$$,
 '55000','immutable_file_identity','canonical source hash remains immutable');
-- The journal manifest is service-owned and has no identity-update trigger.
-- Change only this rollback-local fixture's source revision, never the file identity.
update private.own_normalization_runs set manifest=jsonb_set(manifest,'{sourceRevision}','99')
 where file_id='78800000-0000-4000-8000-000000000040';
select ok(not pg_temp.current_mail(),'mismatched normalization source revision blocks delivery');
rollback to candidate_fences;
update private.own_analysis_runs set source_sha256=repeat('f',64) where file_id='78800000-0000-4000-8000-000000000040' and purpose='reports.polygenic';
select ok(not pg_temp.current_mail(),'stale captured completion source blocks delivery');
rollback to candidate_fences;
update public.profiles set deletion_requested_at=clock_timestamp() where id='78800000-0000-4000-8000-000000000001';
select ok(not pg_temp.current_mail(),'account deletion request blocks readiness');
rollback to candidate_fences;
insert into public.account_deletion_requests(account_id,request_account_revision,request_auth_session_revision,
 principal_graph_revision,deletion_hold_revision,requested_at,notice_ends_at)
 values('78800000-0000-4000-8000-000000000001',1,1,1,1,now(),now()+interval '7 days');
update public.account_deletion_requests set state='delete_started',delete_started_at=clock_timestamp()
 where account_id='78800000-0000-4000-8000-000000000001';
select ok(not pg_temp.current_mail(),'irreversible delete-start fences even a surviving profile and session');
rollback to candidate_fences;
-- Claim and pre-submit operate locally only. No provider invocation exists here.
update public.mail_outbox set not_before='-infinity' where id=(select id from original_notice);
create temporary table ready_claim as select * from public.claim_mail_outbox();
select is((select outbox_id from ready_claim),(select id from original_notice),'claim uses canonical stored-source readiness');
select ok(private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'immediate pre-submit shares exact current readiness');
savepoint submission_fences;
update auth.users set email='new-after-claim@e2e.local' where id='78800000-0000-4000-8000-000000000001';
select is((select state from public.mail_outbox where id=(select id from original_notice)),'invalidated',
 'actual Auth contact transition terminalizes the claimed notice atomically');
select is((select status from public.encrypted_contact_references where id=(select contact_reference_id from original_notice)),
 'rotated','old captured address no longer has a current contact reference');
select ok(not private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'actual Auth email change after claim blocks provider submission');
select ok((select account_revision=1 and auth_session_revision=1 from public.profiles where id='78800000-0000-4000-8000-000000000001')
 and (select count(*)=2 from private.own_analysis_runs where file_id='78800000-0000-4000-8000-000000000040' and state='complete'),
 'email-only change preserves analysis account revisions and both completed purposes');
select is(pg_temp.generate('ready','reports.polygenic',jsonb_set(jsonb_set(pg_temp.envelope(),'{contactRevision}','2'),'{contactHmac}',to_jsonb(repeat('f',64)))),'true'::jsonb,
 'explicit retry creates one event for the new current contact revision');
select is((select count(*) from public.mail_outbox where target_id='78800000-0000-4000-8000-000000000040'),2::bigint,
 'new recipient authority creates a successor event without rewriting the old one');
select ok((select (m.id,m.contact_reference_id,m.expires_at,m.idempotency_key,m.canonical_readiness)=(o.id,o.contact_reference_id,o.expires_at,o.idempotency_key,o.canonical_readiness)
 from public.mail_outbox m join original_notice o using(id)),'email transition cannot renew or readdress the old event');
rollback to submission_fences;
update auth.users set email_confirmed_at=null where id='78800000-0000-4000-8000-000000000001';
select ok(not private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'loss of Auth email verification terminalizes current delivery authority');
rollback to submission_fences;
-- Table-wide profile grants cannot bypass the new field guard.
select set_config('request.jwt.claims','{"sub":"78800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.profiles set mail_contact_revision=9 where id='78800000-0000-4000-8000-000000000001'$$,
 '42501','mail_contact_revision_server_only','browser cannot manufacture a contact revision through table UPDATE');
select throws_ok($$insert into public.profiles(id,mail_contact_revision) values('78800000-0000-4000-8000-000000000001',9)$$,
 '42501','mail_contact_revision_server_only','browser INSERT cannot seed its own revision');
select throws_ok($$insert into public.profiles(id) values('78800000-0000-4000-8000-000000000001')$$,
 '42501','mail_contact_revision_server_only','browser recreation cannot reset the counter to its default');
reset role;
rollback to submission_fences;
update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp() where id=(select contact_reference_id from original_notice);
select ok(not private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'rotated current contact is denied immediately before provider');
rollback to submission_fences;
select throws_ok($$update public.genome_files set source_sha256=repeat('f',64) where id='78800000-0000-4000-8000-000000000040'$$,
 '55000','immutable_file_identity','canonical source hash remains immutable');
-- The journal manifest is service-owned and has no identity-update trigger.
-- Change only this rollback-local fixture's source revision, never the file identity.
update private.own_normalization_runs set manifest=jsonb_set(manifest,'{sourceRevision}','99')
 where file_id='78800000-0000-4000-8000-000000000040';
select ok(not private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'normalization source revision mismatch between claim and submit is denied');
rollback to submission_fences;
select public.revoke_directional_purpose_v1('78800000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic'));
select is((select state from public.mail_outbox where id=(select id from original_notice)),'invalidated','withdrawal invalidates claimed notice in its own transaction');
select ok(not private.authorize_mail_submission_v1((select id from original_notice),(select attempt_ordinal from ready_claim)),
 'withdrawal between claim and submit is denied');
rollback to submission_fences;
select ok(not has_function_privilege('anon','public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE'),
 'adapter has no anonymous, browser or restricted-upload bypass');
select ok(has_function_privilege('service_role','public.own_report_generation_with_mail_v1(text,uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE'),
 'service adapter is callable by the authenticated server only');
select is((select count(*) from public.mail_provider_attempts where outbox_id=(select id from original_notice)),0::bigint,
 'durable preparation and claims do not contact a provider');
savepoint teardown;
select lives_ok($$delete from public.mail_outbox where id=(select id from original_notice)$$,
 'immutable replay bindings do not prevent authorized outbox teardown');
select lives_ok($$delete from public.encrypted_contact_references where id=(select contact_reference_id from original_notice)$$,
 'existing outbox-before-contact purge order remains valid');
rollback to teardown;
set constraints all immediate;
select * from finish();
rollback;
