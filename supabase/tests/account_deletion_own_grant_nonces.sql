begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('79400000-0000-4000-8000-000000000001','account-purge-canonical@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79400000-0000-4000-8000-000000000010','79400000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79400000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='79400000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'79400000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('79400000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '79400000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
select ok((select u.status='promoted' and u.upload_consent_id=sc.id and u.finalized_file_id=(f.receipt->>'fileId')::uuid
 from public.upload_sessions u join public.subject_consents sc on sc.id=u.upload_consent_id
 cross join finalized_upload f where u.id=(select (receipt->>'uploadId')::uuid from issued_upload)),
 'real finalization retains an exact consent-bound promoted upload session');
-- A second real issuance is left uncommitted to prove deletion cannot remove
-- its working metadata before the dedicated expiry manifest completes.
create temporary table unfinished_upload as select public.issue_own_storage_upload_v1(
 '79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF',8,repeat('b',64)) receipt;
update public.retention_due_phases set phase_deadline=clock_timestamp()-interval '1 minute'
 where target_id=(select (receipt->>'uploadId')::uuid from unfinished_upload) and retention_id='upload.staging-2h';
grant select on unfinished_upload to service_role;
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload)) receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79400000-0000-4000-8000-000000000001',
 '79400000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'79400000-0000-4000-8000-000000000001',
 '79400000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),purpose,
 case when op in ('begin','ready') then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('79400000-0000-4000-8000-000000000001',
 '79400000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' when 'ancestry' then 'consent.own-ancestry' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' when 'ancestry' then 'consent.own-ancestry' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

-- This test owns its published catalog/PGS fixtures; no seed or first-row assumption.
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('account-purge-poly-fixture','basic-traits','Fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('account-purge-mono-fixture','medicines','Fixture','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('ACCOUNT-PURGE-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$ select jsonb_build_object(
 'reports',jsonb_build_array(jsonb_build_object('slug',case $1 when 'reports.polygenic' then 'account-purge-poly-fixture' else 'account-purge-mono-fixture' end,
 'covered',true,'conflictingRsids','[]'::jsonb,'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved"}}]'::jsonb)),
 'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"ACCOUNT-PURGE-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
 'readyMail',pg_temp.envelope()); $$;

-- Real signed grant and generation RPCs, not fabricated complete journal rows.
grant select,insert,update on generation_subject,claims,preparation to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select pg_temp.generate('complete','reports.polygenic',pg_temp.output('reports.polygenic'));
reset role;
select is((select count(*) from private.own_analysis_runs where account_id='79400000-0000-4000-8000-000000000001' and state='complete'),1::bigint,'real generation completed before account deletion');
select is((select count(*) from public.purpose_grant_nonces where account_id='79400000-0000-4000-8000-000000000001'),1::bigint,'signed own choice has a consumed nonce');
select is((select count(*) from public.user_prs where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),1::bigint,'generated score exists before deletion');
select is((select count(*) from public.report_observed_calls where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),1::bigint,'normalized observed source exists before deletion');
insert into auth.users(id,email,email_confirmed_at) values('79400000-0000-4000-8000-000000000002','account-purge-unrelated@e2e.local',clock_timestamp());
insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,expected_size,
 expected_sha256,content_type,upload_revision,expires_at)
 select '79400000-0000-4000-8000-000000000002','79400000-0000-4000-8000-000000000011',id,
 '79400000-0000-4000-8000-000000000031',8,repeat('9',64),'application/octet-stream',1,clock_timestamp()+interval '30 minutes'
 from public.subjects where subject_account_id='79400000-0000-4000-8000-000000000002' and subject_class='self';
insert into public.upload_staging_objects(object_id,upload_session_id,object_name,state)
 select '79400000-0000-4000-8000-000000000021',id,staging_object_name,'issued' from public.upload_sessions
 where account_id='79400000-0000-4000-8000-000000000002';
create temporary table unrelated_upload_before as select to_jsonb(u) receipt from public.upload_sessions u
 where account_id='79400000-0000-4000-8000-000000000002';
create temporary table unrelated_staging_before as select to_jsonb(o) receipt from public.upload_staging_objects o
 where upload_session_id in(select id from public.upload_sessions where account_id='79400000-0000-4000-8000-000000000002');
insert into public.purpose_grant_nonces(nonce_hash,account_id) values
 (repeat('9',64),'79400000-0000-4000-8000-000000000002'),
 (repeat('8',64),'79400000-0000-4000-8000-000000000001');
create temporary table nonce_before as select * from public.purpose_grant_nonces;
set local role service_role;
select public.issue_account_operation_nonce_v1('79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010','account_delete',repeat('f',64),clock_timestamp()+interval '9 minutes');
create temporary table deletion as select * from public.request_account_deletion_v1('79400000-0000-4000-8000-000000000001','79400000-0000-4000-8000-000000000010',repeat('f',64),decode(repeat('ab',40),'hex'),repeat('e',64),repeat('d',64));
select is((select count(*) from public.purpose_grant_nonces where account_id='79400000-0000-4000-8000-000000000001'),2::bigint,'notice leaves linked and unbound nonce records intact');
with deadline as (select clock_timestamp()-interval '8 days' requested_at)
update public.account_deletion_requests set requested_at=deadline.requested_at,notice_ends_at=deadline.requested_at+interval '7 days' from deadline where account_id='79400000-0000-4000-8000-000000000001';
update public.retention_rows r set fixed_deadline=d.notice_ends_at from public.account_deletion_requests d where r.target_id=d.account_id and r.retention_id='account-deletion.notice-7d';
update public.retention_due_phases p set phase_deadline=d.notice_ends_at from public.account_deletion_requests d where p.target_id=d.account_id and p.retention_id='account-deletion.notice-7d';
savepoint foreign_nonce;
insert into public.purpose_grant_nonces(nonce_hash,account_id,grant_id)
select repeat('7',64),'79400000-0000-4000-8000-000000000002',grant_id from public.purpose_grant_nonces where nonce_hash=repeat('c',64);
select throws_ok($$select * from public.claim_due_account_deletion_v1(repeat('4',64),300)$$,'55000','unsupported_account_graph','foreign nonce referencing the own grant blocks before claim');
select is((select state from public.account_deletion_requests where id=(select deletion_id from deletion)),'notice_period','foreign nonce failure keeps notice state');
select is((select count(*) from public.account_deletion_storage_entries where deletion_id=(select deletion_id from deletion)),0::bigint,'foreign nonce failure creates no storage deletion authority');
rollback to foreign_nonce;
savepoint foreign_recipient;
update public.directional_grants set recipient_account_id='79400000-0000-4000-8000-000000000002'
where grant_id=(select grant_id from public.purpose_grant_nonces where nonce_hash=repeat('c',64));
select throws_ok($$select * from public.claim_due_account_deletion_v1(repeat('4',64),300)$$,'55000','unsupported_account_graph','a non-self recipient cannot enter the nonce exemption');
rollback to foreign_recipient;
savepoint wrong_signature;
update public.purpose_grants set subject_binding_revision=subject_binding_revision+1
where grant_id=(select grant_id from public.purpose_grant_nonces where nonce_hash=repeat('c',64));
select throws_ok($$select * from public.claim_due_account_deletion_v1(repeat('4',64),300)$$,'55000','unsupported_account_graph','a grant detached from its signed historical binding is refused');
rollback to wrong_signature;
-- A historical revoked grant is still the same purgeable replay receipt;
-- current generation authority must not be demanded after withdrawal.
savepoint historical;
reset role;
select public.revoke_directional_purpose_v1('79400000-0000-4000-8000-000000000001',(select grant_id from public.purpose_grant_nonces where nonce_hash=repeat('c',64)));
set local role service_role;
select lives_ok($$select * from public.claim_due_account_deletion_v1(repeat('4',64),300)$$,'revoked historical self grant remains a supported account deletion');
rollback to historical;
create temporary table claimed as select * from public.claim_due_account_deletion_v1(repeat('4',64),300);
select is((select count(*) from claimed),1::bigint,'service role claims the exact due account with canonical source');
select is((select jsonb_array_length(storage_objects) from claimed),1,'claim freezes the exact source object');
select is((select storage_objects->0->>'objectName' from claimed),(select receipt->>'finalKey' from finalizing_upload),'claim contains only this source address');
select is((select count(*) from public.purpose_grant_nonces where account_id='79400000-0000-4000-8000-000000000001'),2::bigint,'claim preserves replay receipts until physical purge');
select throws_ok($$select public.purge_account_deletion_database_v1((select deletion_id from deletion),repeat('4',64))$$,'55000','storage_purge_incomplete','database purge still requires Storage completion');
-- SQL fixture models only the exact Storage metadata acknowledgement. Actual
-- provider bytes and Admin Auth deletion remain a separate browser gate.
reset role;
set local storage.allow_delete_query='true';
delete from storage.objects where id='79400000-0000-4000-8000-000000000020';
set local role service_role;
select is(public.complete_account_deletion_storage_batch_v1((select deletion_id from deletion),repeat('4',64),(select storage_objects from claimed)),1,'the exact storage batch is acknowledged');
select lives_ok($$select public.complete_account_deletion_storage_v1((select deletion_id from deletion),repeat('4',64))$$,'storage receipt completes');
select throws_ok($$select public.purge_account_deletion_database_v1((select deletion_id from deletion),repeat('4',64))$$,
 '55000','storage_purge_incomplete','an uncommitted canonical session cannot lose its working retention metadata even with no bytes');
select is((select count(*) from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from unfinished_upload)),1::bigint,
 'failed account purge preserves the exact unfinished lease');
select ok(exists(select 1 from public.subject_consents where account_id='79400000-0000-4000-8000-000000000001'),
 'failed account purge preserves upload consent for the complete rollback');
-- Rollback-local direct executor proof only: no worker route or provider call.
create temporary table working_purge as select public.claim_own_upload_purge_v1(repeat('6',64)) receipt;
select is((select p.target_id from public.retention_due_phases p join public.purge_manifests m
 on m.retention_row_id=p.retention_row_id where m.id=(select (receipt->>'manifestId')::uuid from working_purge)),
 (select (receipt->>'uploadId')::uuid from unfinished_upload),'existing expiry claims the exact lease after account delete-start and session revocation');
select is(public.authorize_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from working_purge),repeat('6',64)),true,
 'working purge authorization does not require a surviving account session');
select is(public.finish_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from working_purge),repeat('6',64)),true,
 'existing expiry finishes the empty working set after account delete-start');
select is((select state from public.purge_manifests where id=(select (receipt->>'manifestId')::uuid from working_purge)),'complete',
 'working cleanup retains a complete frozen tombstone before account purge');
select is(public.purge_account_deletion_database_v1((select deletion_id from deletion),repeat('4',64)),'79400000-0000-4000-8000-000000000001'::uuid,'service-role physical database purge completes with signed nonce');
select is((select count(*) from public.upload_sessions where account_id='79400000-0000-4000-8000-000000000001'),0::bigint,'promoted consent-bound upload session is removed before its consent');
select is((select count(*) from public.purpose_grant_nonces where account_id='79400000-0000-4000-8000-000000000001'),0::bigint,'linked and unbound exact account nonces are physically absent');
select is((select count(*) from public.genome_files where id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'exact canonical file is absent');
select is((select count(*) from public.user_prs where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'exact score rows are absent');
select is((select count(*) from public.report_observed_calls where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'exact observed source rows are absent');
select is((select count(*) from public.genome_storage_objects where object_id='79400000-0000-4000-8000-000000000020'),0::bigint,'source object journal is absent');
reset role;
select is((select count(*) from private.own_analysis_runs where account_id='79400000-0000-4000-8000-000000000001'),0::bigint,'exact private report journal is absent');
select is((select count(*) from private.own_normalization_runs where account_id='79400000-0000-4000-8000-000000000001'),0::bigint,'exact private normalization journal is absent');
select is((select count(*) from auth.users where id='79400000-0000-4000-8000-000000000001'),1::bigint,'Auth remains for the final supported Admin deletion step');
select results_eq($$select nonce_hash,account_id,grant_id,consumed_at from public.purpose_grant_nonces where account_id='79400000-0000-4000-8000-000000000002'$$,$$select nonce_hash,account_id,grant_id,consumed_at from nonce_before where account_id='79400000-0000-4000-8000-000000000002'$$,'unrelated account nonce is unchanged byte for byte');
select is((select count(*) from public.profiles where id='79400000-0000-4000-8000-000000000002'),1::bigint,'unrelated account stays present');
select results_eq($$select to_jsonb(u) from public.upload_sessions u where account_id='79400000-0000-4000-8000-000000000002'$$,
 $$select receipt from unrelated_upload_before$$,'unrelated account upload session is unchanged');
select results_eq($$select to_jsonb(o) from public.upload_staging_objects o where upload_session_id in(select id from public.upload_sessions where account_id='79400000-0000-4000-8000-000000000002')$$,
 $$select receipt from unrelated_staging_before$$,'unrelated account staging child is unchanged');
delete from auth.users where id='79400000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$select public.finalize_account_deletion_v1((select deletion_id from deletion),repeat('4',64))$$,'terminal receipt follows actual SQL Auth removal');
select is((select state from public.account_deletion_requests where id=(select deletion_id from deletion)),'complete','terminal completion is truthful');
select ok(not has_function_privilege('anon','public.purge_account_deletion_database_v1(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.purge_account_deletion_database_v1(uuid,text)','EXECUTE'),'public purge remains service-only');
select * from finish();
rollback;
