begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('79810000-0000-4000-8000-000000000001','jurisdiction-sharer@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79810000-0000-4000-8000-000000000010','79810000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79810000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='79810000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('79810000-0000-4000-8000-000000000020',
 'genomes','79810000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79810000-0000-4000-8000-000000000040','79810000-0000-4000-8000-000000000001',(select id from generation_subject),
 '79810000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79810000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79810000-0000-4000-8000-000000000020','79810000-0000-4000-8000-000000000030','genomes',
 '79810000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010','79810000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79810000-0000-4000-8000-000000000001',
 '79810000-0000-4000-8000-000000000010','79810000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'79810000-0000-4000-8000-000000000001',
 '79810000-0000-4000-8000-000000000010','79810000-0000-4000-8000-000000000040',purpose,
 case when op in ('begin','ready') then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('79810000-0000-4000-8000-000000000001',
 '79810000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

-- This test owns its published catalog/PGS fixtures; no seed or first-row assumption.
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('jurisdiction-poly-fixture','basic-traits','Fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('jurisdiction-mono-fixture','medicines','Fixture','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('OWN-JURISDICTION-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$ select jsonb_build_object(
 'reports',jsonb_build_array(jsonb_build_object('slug',case $1 when 'reports.polygenic' then 'jurisdiction-poly-fixture' else 'jurisdiction-mono-fixture' end,
 'covered',true,'conflictingRsids','[]'::jsonb,'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb)),
 'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"OWN-JURISDICTION-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
 'readyMail',pg_temp.envelope()); $$;
create function pg_temp.captured_output() returns jsonb language sql as $$
 select jsonb_set(pg_temp.output('reports.polygenic'),'{reports,0,catalogSnapshot}',
  jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,'evidence',t.evidence,
   'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))
 from public.report_templates t where slug='jurisdiction-poly-fixture'; $$;

create function pg_temp.ready_state() returns jsonb language sql as $$ select private.own_report_ready_state_v1(
 '79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000040'); $$;
create function pg_temp.current_mail() returns boolean language sql as $$ select private.file_ready_mail_current_v1(m)
 from public.mail_outbox m where target_id='79810000-0000-4000-8000-000000000040'; $$;
-- A and unrelated C never upload or acquire B's own grants. B's real source
-- is prepared above with the existing stage/complete authority functions.
insert into auth.users(id,email,email_confirmed_at) values
 ('79810000-0000-4000-8000-000000000002','jurisdiction-recipient@e2e.local',now()),
 ('79810000-0000-4000-8000-000000000003','jurisdiction-outsider@e2e.local',now());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79810000-0000-4000-8000-000000000012','79810000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('79810000-0000-4000-8000-000000000013','79810000-0000-4000-8000-000000000003',now(),now(),'aal1');
update public.profiles set date_of_birth='1990-01-01' where id in(
 '79810000-0000-4000-8000-000000000002','79810000-0000-4000-8000-000000000003');
create function pg_temp.presentation() returns text language sql as $$
 select public.family_report_grant_presentation_v1('79810000-0000-4000-8000-000000000001',
 '79810000-0000-4000-8000-000000000010',(select id from generation_subject),'79810000-0000-4000-8000-000000000002'); $$;
create function pg_temp.share(receipt text,nonce text) returns uuid language sql as $$
 select public.grant_family_report_purpose_v1('79810000-0000-4000-8000-000000000001',
 '79810000-0000-4000-8000-000000000010',(select id from generation_subject),
 (select id from public.subject_principals where account_id='79810000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active'),
 '79810000-0000-4000-8000-000000000002','reports.polygenic',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt); $$;
create function pg_temp.shared(mode text default 'content') returns jsonb language sql as $$
 select public.family_shared_report_results_v1('79810000-0000-4000-8000-000000000002',
 '79810000-0000-4000-8000-000000000012',(select id from generation_subject),'reports.polygenic',null,mode); $$;

-- G5.1a/G5.1b declaration writer (ADR 0032). B above holds its own upload
-- consent, its own polygenic permission and one completed report; below it
-- also shares that layer with A while no country is declared.
create function pg_temp.attestation_version() returns integer language sql as $$
 select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null; $$;
create function pg_temp.attestation_sha() returns text language sql as $$
 select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null; $$;
create function pg_temp.declare(account uuid,session uuid,code text,test boolean default false) returns jsonb language sql as $$
 select public.declare_jurisdiction_v1(account,session,code,pg_temp.attestation_version(),pg_temp.attestation_sha(),test); $$;
create function pg_temp.declare_b(code text,test boolean default false) returns jsonb language sql as $$
 select pg_temp.declare('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',code,test); $$;
create function pg_temp.own_report_current() returns boolean language sql as $$
 select private.own_analysis_completion_matches_v1('79810000-0000-4000-8000-000000000040','reports.polygenic',
  private.current_own_report_grant_read_v1('79810000-0000-4000-8000-000000000001',
   '79810000-0000-4000-8000-000000000010','79810000-0000-4000-8000-000000000040','reports.polygenic')); $$;
create function pg_temp.own_grants() returns bigint language sql as $$
 select count(*) from public.purpose_grants pg join public.directional_grants dg using(grant_id)
 where pg.target_id=(select id from generation_subject) and dg.direction='self' and dg.status='current'
  and pg.revoked_at is null; $$;
create function pg_temp.events(code text) returns bigint language sql as $$
 select count(*) from public.legal_audit_log where event_code=code; $$;

select is(has_function_privilege('authenticated','public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)','execute'),false,'a browser cannot call the declaration writer');
select is(has_function_privilege('anon','public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)','execute'),false,'anon cannot call the declaration writer');
select is(has_function_privilege('service_role','public.declare_jurisdiction_v1(uuid,uuid,text,integer,text,boolean)','execute'),true,'the verified server route can');
select is((select count(*) from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null
 and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex')),1::bigint,'one current attestation whose stored hash recomputes');

create temporary table shared_grant as select pg_temp.share(pg_temp.presentation(),'jur-share-nonce-00000000000001') id;
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select is(pg_temp.generate('complete','reports.polygenic',pg_temp.captured_output())->>'status','complete','fixture: B holds one completed own report');
select is(pg_temp.own_grants(),1::bigint,'fixture: B holds exactly one current own report permission');
select is(pg_temp.own_report_current(),true,'fixture: that report matches B''s current permission');
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'fixture: A reads B''s shared result before any declaration');
select is((select jurisdiction_code from public.consent_signatures where id=(select signature_id from public.purpose_grants
 where grant_id=(select id from shared_grant))),'ZZ','fixture: a consent signed while undeclared records the unset placeholder');

-- D-135: the table grant and own-row policy used to let a browser write these.
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"79810000-0000-4000-8000-000000000001","session_id":"79810000-0000-4000-8000-000000000010","role":"authenticated"}',
 true); end $$;
set local role authenticated;
select throws_ok($$update public.profiles set jurisdiction_code='GB' where id='79810000-0000-4000-8000-000000000001'$$,
 '42501','jurisdiction_server_only','a signed-in browser cannot declare its own country around the writer');
select throws_ok($$update public.profiles set jurisdiction_revision=jurisdiction_revision+1 where id='79810000-0000-4000-8000-000000000001'$$,
 '42501','jurisdiction_server_only','a browser cannot move the revision every consent binds');
select throws_ok($$update public.profiles set jurisdiction_declared_at=now() where id='79810000-0000-4000-8000-000000000001'$$,
 '42501','jurisdiction_server_only','a browser cannot forge a declaration time');
select lives_ok($$update public.profiles set digest_opt_in=not digest_opt_in where id='79810000-0000-4000-8000-000000000001'$$,
 'the guard leaves other own-profile writes alone');
reset role;

select throws_ok($$select pg_temp.declare_b('gb')$$,'22023','invalid_request','an unnormalized code is refused');
select throws_ok($$select pg_temp.declare_b('GBR')$$,'22023','invalid_request','a three-letter code is refused');
select throws_ok($$select pg_temp.declare_b('XX')$$,'22023','invalid_request','the block-only test code is refused unless the test fixture is on');
select throws_ok($$select public.declare_jurisdiction_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 'GB',pg_temp.attestation_version(),repeat('0',64),false)$$,'22023','invalid_request','an attestation hash that is not the current text is refused');
select throws_ok($$select public.declare_jurisdiction_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 'GB',pg_temp.attestation_version()+1,pg_temp.attestation_sha(),false)$$,'22023','invalid_request','an unpublished attestation version is refused');
select throws_ok($$select public.declare_jurisdiction_v1('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000010',
 'GB',pg_temp.attestation_version(),pg_temp.attestation_sha(),null)$$,'22023','invalid_request','an unstated test flag is refused, never defaulted');
select throws_ok($$select pg_temp.declare('79810000-0000-4000-8000-000000000001','79810000-0000-4000-8000-000000000012','GB')$$,
 '42501','not_found','another account''s session cannot declare for B');
savepoint ended_session;
delete from auth.sessions where id='79810000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.declare_b('GB')$$,'42501','not_found','an ended session cannot declare');
rollback to ended_session;
savepoint deletion_notice;
update public.profiles set deletion_requested_at=clock_timestamp() where id='79810000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.declare_b('GB')$$,'42501','not_found','an account in its deletion notice period cannot declare');
rollback to deletion_notice;
select is((select jurisdiction_code from public.profiles where id='79810000-0000-4000-8000-000000000001'),null,'every refusal left B undeclared');

create temporary table events_before as select pg_temp.events('jurisdiction.declared') declared,
 pg_temp.events('jurisdiction.reaffirmed') reaffirmed, pg_temp.events('purpose.revoked') revoked, pg_temp.own_grants() own;
select is(pg_temp.declare_b('GB'),jsonb_build_object('jurisdiction','GB','changed',true,'revokedGrants',1),
 'first declaration records GB and ends the one restricted permission B signed while undeclared');
select ok((select jurisdiction_code='GB' and jurisdiction_declared_at is not null and jurisdiction_attestation_version=pg_temp.attestation_version()
 and jurisdiction_attestation_sha256=pg_temp.attestation_sha() from public.profiles where id='79810000-0000-4000-8000-000000000001'),
 'the code is stored with the attestation version and hash B affirmed');
select is((select jurisdiction_revision from public.profiles where id='79810000-0000-4000-8000-000000000001'),1::bigint,
 'the revision every own consent and saved report binds does not move');
select is(pg_temp.events('jurisdiction.declared'),(select declared+1 from events_before),'one declaration event is appended');
select is((select coded_context from public.legal_audit_log where event_code='jurisdiction.declared' order by seq desc limit 1),
 jsonb_build_object('code','GB','first',true,'attestation_version',pg_temp.attestation_version(),'revoked_grants',1),
 'the event records the code, that it was the first, the attestation and the count ended');
select is((select audit_principal_id from public.legal_audit_log where event_code='jurisdiction.declared' order by seq desc limit 1),null,
 'the event carries no account link');
select is(pg_temp.events('purpose.revoked'),(select revoked+1 from events_before),'the ended permission is audited through the existing revocation path');
select is(pg_temp.own_grants(),(select own from events_before),'B''s own report permissions stay current');
select is(pg_temp.own_report_current(),true,'B''s completed own report still matches, so saved reports stay visible');
select is((select revocation_reason from public.purpose_grants where grant_id=(select id from shared_grant)),'jurisdiction_changed',
 'the share B signed while undeclared ends, recorded as a jurisdiction change');
select is((select status from public.directional_grants where grant_id=(select id from shared_grant)),'revoked','its direction row ends with it');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','A can no longer read B''s shared result');

select is(pg_temp.declare_b('GB'),jsonb_build_object('jurisdiction','GB','changed',false,'revokedGrants',0),
 'repeating the same declaration changes nothing');
select is(pg_temp.events('jurisdiction.declared')+pg_temp.events('jurisdiction.reaffirmed'),(select declared+reaffirmed+1 from events_before),
 'and appends no second event');

create temporary table second_share as select pg_temp.share(pg_temp.presentation(),'jur-share-nonce-00000000000002') id;
select is((select jurisdiction_code from public.consent_signatures where id=(select signature_id from public.purpose_grants
 where grant_id=(select id from second_share))),'GB','a consent signed after declaring records the declared code (G5.1b)');
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'B shares again under GB and A reads it');
select is((select endpoints#>>'{recipient,jurisdictionCode}' from private.family_report_grant_snapshots
 where grant_id=(select id from second_share)),null,'a share''s snapshot also binds the recipient''s code, here still undeclared');
select is(pg_temp.declare('79810000-0000-4000-8000-000000000002','79810000-0000-4000-8000-000000000012','FR')->>'revokedGrants','1',
 'A declaring ends B''s share to A: its snapshot bound A''s old answer');
select is((select revocation_reason from public.purpose_grants where grant_id=(select id from second_share)),'jurisdiction_changed',
 'the recipient-side share ends as a jurisdiction change, not a withdrawal');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','and A reads nothing from it');
select is(pg_temp.own_grants(),(select own from events_before),'the recipient''s change leaves B''s own permissions alone');

create temporary table third_share as select pg_temp.share(pg_temp.presentation(),'jur-share-nonce-00000000000003') id;
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'B shares again with both sides declared, and A reads it');
select is(pg_temp.declare_b('DE')->>'revokedGrants','1','B moving from GB to DE ends the share B signed under GB');
select ok((select revoked_at is not null from public.purpose_grants where grant_id=(select id from third_share)),'that share is ended');
select is(pg_temp.own_grants(),(select own from events_before),'B''s own permissions survive a change of country too');
select is(pg_temp.own_report_current(),true,'and B''s saved report still matches');
select is((select coded_context->>'first' from public.legal_audit_log where event_code='jurisdiction.declared' order by seq desc limit 1),'false',
 'a later change is recorded as not the first');
select is(pg_temp.declare_b('XX',true)->>'jurisdiction','XX','the block-only test code is accepted when the caller says the fixture is on');
select * from finish();
rollback;
