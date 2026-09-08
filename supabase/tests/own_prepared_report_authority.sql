begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('90000000-0000-4000-8000-000000000001','prepared-report@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='90000000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='90000000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'90000000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('90000000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '90000000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- This fixture verifies SQL authority and metadata only. Storage bytes and the
-- final canonical/rsID root are NOT proved by synthetic Storage rows.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000001',now(),now(),'aal1');
update private.own_preparation_config set enabled=true where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.publication(p jsonb default null,session_id uuid default '90000000-0000-4000-8000-000000000010',
 claim_hash text default repeat('e',64)) returns jsonb language sql as $$
 select public.publish_own_prepared_manifest_v1('90000000-0000-4000-8000-000000000001',session_id,
 pg_temp.job_id(),pg_temp.attempt_id(),claim_hash,coalesce(p,(select value from pub_receipts where label='payload'))); $$;
create function pg_temp.read_publication(session_id uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.read_own_prepared_manifest_v1('90000000-0000-4000-8000-000000000001',session_id,pg_temp.file_id(),null); $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));
select throws_ok($$select public.own_upload_normalization_v1('begin','90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id(),null,null)$$,
 '55000','prepared_backend_reserved','real legacy begin cannot steal a claimed object source');
do $$declare a jsonb; object_id uuid; i integer; begin
 for i in 0..2 loop
  a:=public.reserve_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
   jsonb_build_object('kind','container','sequence',i,'byteCount',8,'sha256',repeat('f',64)));
  insert into storage.objects(bucket_id,name,version,metadata) values('genomes',a->>'objectKey',gen_random_uuid()::text,'{"size":8}')
   returning id into object_id;
  a:=public.ack_own_preparation_artifact_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),
   (a->>'artifactId')::uuid,object_id,a,repeat('f',64));
  insert into pub_receipts values('artifact'||i,a);
 end loop;
end; $$;
insert into pub_receipts values('payload',jsonb_build_object('version','own-prepared-publication-v1',
 'rootArtifactId',(select value->>'artifactId' from pub_receipts where label='artifact2'),
 'memberIds',jsonb_build_array((select value->>'artifactId' from pub_receipts where label='artifact1'),
  (select value->>'artifactId' from pub_receipts where label='artifact2')),
 'summary',jsonb_build_object('version','own-prepared-summary-v1','sourceBuild','GRCh38','parserRevision','vcf-v1',
 'canonicalRevision','prepared-canonical-v1','sourceVariantCount',1,'sourceObservedCount',1,'sourceReferenceCount',0,
 'variantCount',1,'observedCallCount',1,'usableObservedCount',1,'attempted',0,'unmapped',0,'rsidPointerCount',2)));
insert into pub_receipts values('published',pg_temp.publication());
reset role;
update private.own_preparation_config set enabled=false where singleton;
-- Real publication remains store-only; analysis needs a separate actual grant.
create temporary table report_claims(purpose text primary key,receipt jsonb);
grant select,insert,update on report_claims to service_role;
create function pg_temp.grant_report(p text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from generation_subject)),p,
 (select version from public.consent_artifacts where artifact_key=case p when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case p when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes'); $$;
create function pg_temp.generate(op text,p text default 'reports.polygenic',payload jsonb default null,
 reader_session uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.own_report_generation_with_mail_v1(op,'90000000-0000-4000-8000-000000000001',reader_session,pg_temp.file_id(),p,
 case when op in('begin','ready') then null else (select (receipt->>'claim')::uuid from report_claims where purpose=p) end,payload); $$;
create function pg_temp.saved(expected text default null,reader_session uuid default '90000000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.own_captured_report_v1('90000000-0000-4000-8000-000000000001',reader_session,
 (select id from generation_subject),pg_temp.file_id(),'prepared-caffeine-fixture',expected); $$;
create function pg_temp.ready() returns jsonb language sql as $$
 select private.own_report_ready_state_v1('90000000-0000-4000-8000-000000000001',pg_temp.file_id()); $$;
create function pg_temp.envelope() returns jsonb language sql as $$ select jsonb_build_object(
 'contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),'dashboardUrl','https://example.invalid/genome/me/reports'); $$;
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('prepared-caffeine-fixture','basic-traits','Captured caffeine fixture','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":762551,"gene":"CYP1A2","chrom":15,"pos38":74749576,"ref":"C","alt":"A","interpretations":{"AC":"saved caffeine"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
create function pg_temp.report_payload() returns jsonb language sql as $$
 select jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
  'variants','[{"rsid":762551,"outcome":{"status":"genotyped","genotype":"AC","interpretation":"saved caffeine","strandFlipped":false}}]'::jsonb,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
   'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))),
  'prs','[]'::jsonb,'readyMail',pg_temp.envelope()) from public.report_templates t where t.slug='prepared-caffeine-fixture'; $$;
set local role service_role;
select is(pg_temp.generate('begin')->>'status','not_selected','published preparation alone grants no analysis');
select is(pg_temp.ready(),null::jsonb,'preparation alone does not create ready eligibility');
select is(pg_temp.saved(),null::jsonb,'preparation alone has no captured detail');
reset role;
-- Owner-only fixture inspection; no direct production table privileges are added.
select is((select count(*) from private.own_analysis_runs where file_id=pg_temp.file_id()),0::bigint,'unselected source has no analysis journal');
set local role service_role;
select pg_temp.grant_report('reports.polygenic',repeat('c',64));
insert into report_claims values('reports.polygenic',pg_temp.generate('begin'));
select is((select receipt#>'{authorization,preparedSource}' from report_claims where purpose='reports.polygenic'),
 (select jsonb_build_object('version','own-prepared-report-source-v1','backend','prepared-object-v1',
 'manifestId',value->'manifestId','membershipSha256',value->'membershipSha256',
 'rootArtifactId',value#>'{root,receipt,artifactId}','rootSha256',value#>'{root,receipt,sha256}') from pub_receipts where label='published'),
 'claim carries the exact closed immutable publication identity');
select is(pg_temp.generate('check'),(select receipt from report_claims where purpose='reports.polygenic'),'check preserves captured claim and source identity');
select is(private.current_own_report_grant_read_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id(),'reports.polygenic'),
 (select receipt->'authorization' from report_claims where purpose='reports.polygenic'),'locked and read authorization JSON agree');
select is(private.current_own_report_grant_mail_v1('90000000-0000-4000-8000-000000000001',pg_temp.file_id(),'reports.polygenic')-'context',
 (select (receipt->'authorization')-'context' from report_claims where purpose='reports.polygenic'),'mail carries the same durable source and grant without a session');
select throws_ok($$select pg_temp.generate('read-variants','reports.polygenic','{"loci":[{"chrom":15,"pos":74749576}],"offset":0}')$$,
 '55000','prepared_object_reader_required','SQL variant reader refuses prepared source instead of empty coverage');
select throws_ok($$select pg_temp.generate('read-observed','reports.polygenic','{"loci":[{"chrom":15,"pos":74749576}],"offset":0}')$$,
 '55000','prepared_object_reader_required','SQL observed reader refuses prepared source');
select throws_ok($$select public.read_own_report_calls_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id(),'reports.polygenic',array[762551::bigint],0)$$,
 '55000','prepared_object_reader_required','rsID DB call reader explicitly refuses prepared source');
reset role;
-- Source changes and unsupported consumers cannot be blessed by a matching file ID.
savepoint changed_revision;
update public.genome_files set upload_revision=upload_revision+1,normalization_source_revision=normalization_source_revision+1 where id=pg_temp.file_id();
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','coherent source revision transition invalidates claim');
rollback to changed_revision;
savepoint wrong_root_authority;
update private.own_analysis_runs set authority=jsonb_set(authority,'{preparedSource,rootSha256}',to_jsonb(repeat('0',64))) where file_id=pg_temp.file_id();
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','altered captured root cannot continue');
rollback to wrong_root_authority;
savepoint root_missing;
delete from storage.objects where id=(select (value#>>'{root,storageObjectId}')::uuid from pub_receipts where label='published');
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','missing exact published root prevents analysis');
rollback to root_missing;
savepoint nonroot_missing;
delete from storage.objects where id=(select storage_object_id from private.own_preparation_artifacts
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'));
select is(pg_temp.generate('check')->>'status','authorized','per-object claim check does not scan unrelated final members');
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',pg_temp.report_payload())$$,'42501','not_found',
 'terminal completion exhaustively refuses a lost non-root final member');
select is((select state from private.own_analysis_runs where file_id=pg_temp.file_id() and purpose='reports.polygenic'),'running',
 'missing final member rolls completed result back');
rollback to nonroot_missing;
savepoint source_withdrawal;
select public.prepare_genome_file_deletion_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',pg_temp.file_id());
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','real source deletion preparation fences analysis');
rollback to source_withdrawal;
savepoint store_withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where id=(select (authority->>'uploadConsentId')::uuid from private.own_preparation_jobs where id=pg_temp.job_id());
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',pg_temp.report_payload())$$,'42501','not_found','store withdrawal fences completion');
rollback to store_withdrawal;
-- Deterministic check expiry AFTER its initial running-row check: only the
-- second metadata lookup (inside the terminal fence) waits to the claim clock.
create temporary table metadata_definition as select pg_get_functiondef('private.own_report_source_metadata_v1(uuid,uuid,boolean)'::regprocedure) definition;
create temporary sequence check_phase_seen;
create function pg_temp.pause_second_source_check() returns void language plpgsql as $$
declare expiry timestamptz; phase bigint;
begin
 if current_setting('test.prepared_check_clock',true)='on' then
  phase:=nextval('pg_temp.check_phase_seen');
  if phase=2 then
   select expires_at into expiry from private.own_analysis_runs where file_id=pg_temp.file_id() and purpose='reports.polygenic';
   if expiry is null or expiry>clock_timestamp()+interval '3 seconds' then raise exception 'invalid_clock_probe'; end if;
   perform pg_sleep(greatest(0,extract(epoch from expiry-clock_timestamp()))+0.01);
  end if;
 end if;
end; $$;
savepoint running_check_expiry;
do $$declare definition text; changed text; begin
 select d.definition into definition from metadata_definition d;
 changed:=replace(definition,'return jsonb_build_object(''fileType''',
  'perform pg_temp.pause_second_source_check(); return jsonb_build_object(''fileType''');
 if changed=definition then raise exception 'missing_clock_hook'; end if;
 execute changed;
end; $$;
update private.own_analysis_runs set expires_at=clock_timestamp()+interval '2 seconds' where file_id=pg_temp.file_id() and purpose='reports.polygenic';
select set_config('test.prepared_check_clock','on',true);
select throws_ok($$select pg_temp.generate('check')$$,'42501','not_found','late running-claim expiry cannot authorize a next object read');
select is((select last_value from check_phase_seen),2::bigint,'check reached its second source lookup after the initial running-row check');
rollback to running_check_expiry;
select is(pg_get_functiondef('private.own_report_source_metadata_v1(uuid,uuid,boolean)'::regprocedure),
 (select definition from metadata_definition),'clock probe restores exact source helper definition');
-- After-update hook proves expiry AFTER catalog/result mutation is still atomic.
create temporary sequence completion_phase_seen;
create function pg_temp.pause_completed_report() returns trigger language plpgsql as $$
declare expiry timestamptz;
begin
 if new.file_id=pg_temp.file_id() and new.state='complete' and current_setting('test.prepared_report_clock',true)='on' then
  perform nextval('pg_temp.completion_phase_seen');
  select not_after into expiry from auth.sessions where id='90000000-0000-4000-8000-000000000010';
  if expiry is null or expiry>clock_timestamp()+interval '3 seconds' then raise exception 'invalid_clock_probe'; end if;
  perform pg_sleep(greatest(0,extract(epoch from expiry-clock_timestamp()))+0.01);
 end if;
 return null;
end; $$;
create trigger prepared_report_clock_probe after update on private.own_analysis_runs for each row execute function pg_temp.pause_completed_report();
savepoint completion_expiry;
update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='90000000-0000-4000-8000-000000000010';
select set_config('test.prepared_report_clock','on',true);
select throws_ok($$select pg_temp.generate('complete','reports.polygenic',pg_temp.report_payload())$$,'42501','not_found','clock crossing after result update refuses completion');
select ok((select is_called from completion_phase_seen),'clock refusal reached the actual completed-row trigger');
select is((select state from private.own_analysis_runs where file_id=pg_temp.file_id() and purpose='reports.polygenic'),'running','failed terminal fence rolls result/catalog changes back');
select is((select count(*) from public.mail_outbox where target_id=pg_temp.file_id()),0::bigint,'failed completion creates no ready mail');
rollback to completion_expiry;
drop trigger prepared_report_clock_probe on private.own_analysis_runs;
set local role service_role;
select is(pg_temp.generate('complete','reports.polygenic',pg_temp.report_payload())->>'status','complete','actual generation completion accepts selected prepared source');
select ok(private.own_analysis_completion_matches_v1(pg_temp.file_id(),'reports.polygenic',
 private.current_own_report_grant_read_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',pg_temp.file_id(),'reports.polygenic')),'completed run binds same immutable source');
create temporary table captured_detail as select pg_temp.saved() value;
select is((select value#>>'{source,reports,0,variants,0,outcome,genotype}' from captured_detail),'AC','saved exact source retains supplied captured outcome');
select is((select value#>'{source,source,snapshot}' from captured_detail),'null'::jsonb,'missing listed-call provenance is honestly null');
select is((select value#>>'{source,fileId}' from captured_detail),pg_temp.file_id()::text,'saved detail is exact-file bound');
select is(pg_temp.saved((select value->>'receipt' from captured_detail)),(select value from captured_detail),'same capture confirms exactly');
select is(pg_temp.saved(repeat('0',64)),null::jsonb,'mismatched final receipt refuses detail');
select is(public.own_captured_report_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),gen_random_uuid(),'prepared-caffeine-fixture'),null::jsonb,'different file cannot borrow captured result');
select ok(pg_temp.ready() is not null,'ready eligibility recognizes exact completed prepared authority');
reset role;
-- Inspect queued metadata as fixture owner, then resume the service RPC boundary.
select is((select count(*) from public.mail_outbox where target_id=pg_temp.file_id()),1::bigint,'completion creates one metadata-only ready event');
select ok((select private.file_ready_mail_current_v1(m) from public.mail_outbox m where target_id=pg_temp.file_id()),'mail current predicate validates prepared result');
select is((select canonical_readiness#>'{purposes,reports.polygenic,preparedSource}' from public.mail_outbox where target_id=pg_temp.file_id()),
 (select receipt#>'{authorization,preparedSource}' from report_claims where purpose='reports.polygenic'),'mail snapshot preserves same manifest identity');
set local role service_role;
select throws_ok($$select private.family_source_report_authority_v1('90000000-0000-4000-8000-000000000001',pg_temp.file_id(),'reports.polygenic')$$,
 '42501','not_found','Family source authority remains closed for prepared backend');
reset role;
savepoint saved_nonroot_missing;
delete from storage.objects where id=(select storage_object_id from private.own_preparation_artifacts
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'));
select is(pg_temp.saved(),null::jsonb,'saved detail refuses missing non-root final source member');
select is(pg_temp.ready(),null::jsonb,'ready-mail eligibility refuses missing non-root final source member');
select ok(not (select private.file_ready_mail_current_v1(m) from public.mail_outbox m where target_id=pg_temp.file_id()),
 'queued mail cannot remain current after non-root source loss');
rollback to saved_nonroot_missing;
savepoint newer_catalog;
update public.report_templates set title='Changed current title',variants=jsonb_set(variants,'{0,interpretations,AC}','"changed current interpretation"') where slug='prepared-caffeine-fixture';
select is(pg_temp.saved()#>>'{source,reports,0,catalogSnapshot,template,title}','Captured caffeine fixture','saved detail never borrows current catalog');
select is(pg_temp.saved()#>>'{source,reports,0,variants,0,outcome,interpretation}','saved caffeine','saved interpretation remains captured');
rollback to newer_catalog;
savepoint session_changed;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='90000000-0000-4000-8000-000000000010';
select is(pg_temp.saved(),null::jsonb,'expired current session cannot read saved detail');
select is(pg_temp.saved(null,'90000000-0000-4000-8000-000000000011')#>>'{source,reports,0,variants,0,outcome,genotype}','AC','fresh real session can read same completed source');
rollback to session_changed;
savepoint purpose_withdrawn;
select public.revoke_directional_purpose_v1('90000000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic' and revoked_at is null));
select is(pg_temp.saved(),null::jsonb,'actual purpose withdrawal removes saved detail access');
select is(pg_temp.ready(),null::jsonb,'actual purpose withdrawal removes ready eligibility');
rollback to purpose_withdrawn;
-- Ancestry keeps its real saved API; no public ancestry rows are synthesized.
set local role service_role;
select pg_temp.grant_report('ancestry',repeat('d',64));
insert into report_claims values('ancestry',pg_temp.generate('begin','ancestry'));
select is((select receipt->'source' from report_claims where purpose='ancestry'),
 jsonb_build_object('fileId',pg_temp.file_id(),'fileType','vcf','normalizedBuild','GRCh38','callEncoding','vcf-literal'),
 'ancestry claim derives literal encoding from the verified prepared source');
create temporary table ancestry_output as select jsonb_build_object('ancestry',jsonb_build_object(
 'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
 'source',jsonb_build_object('fileId',pg_temp.file_id(),'subjectId',(select id from generation_subject),
  'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),
  'normalizedAt',receipt#>'{authorization,normalizedAt}'),
 'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
 'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
 'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
 'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb)) payload
 from report_claims where purpose='ancestry';
select is(pg_temp.generate('complete','ancestry',(select payload from ancestry_output)||jsonb_build_object('readyMail',pg_temp.envelope()))->>'status','complete','ancestry completion accepts exact prepared source and panel-bound content');
select is(public.own_ancestry_content_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',pg_temp.file_id())->'content',
 (select payload->'ancestry' from ancestry_output),'existing actual ancestry saved-reader API returns the captured result');
select is(public.own_ancestry_content_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011',pg_temp.file_id())->'content',
 (select payload->'ancestry' from ancestry_output),'fresh actual session reads same saved ancestry');
select ok(private.own_report_ready_state_v2('90000000-0000-4000-8000-000000000001',pg_temp.file_id()) is not null,'all selected prepared layers produce version-two ready eligibility');
reset role;
savepoint ancestry_nonroot_missing;
delete from storage.objects where id=(select storage_object_id from private.own_preparation_artifacts
 where id=(select (value->>'artifactId')::uuid from pub_receipts where label='artifact1'));
select throws_ok($$select public.own_ancestry_content_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',pg_temp.file_id())$$,'42501','not_found','saved ancestry refuses missing non-root final source member');
select is(private.own_report_ready_state_v2('90000000-0000-4000-8000-000000000001',pg_temp.file_id()),null::jsonb,
 'version-two ready eligibility refuses missing non-root member');
rollback to ancestry_nonroot_missing;
select is((select count(*) from private.own_normalization_runs where file_id=pg_temp.file_id()),0::bigint,'prepared report/ancestry integration creates no fake DB normalization');
select is((select count(*) from public.user_variants where file_id=pg_temp.file_id()),0::bigint,'prepared integration creates no fake SQL variants');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.file_id()),0::bigint,'prepared integration creates no fake SQL observations');
select is((select count(*) from public.ancestry_results where file_id=pg_temp.file_id()),0::bigint,'prepared ancestry writes only its real private journal');
-- A second, actually issued/finalized DB-backed source proves backward
-- compatibility. Its normalization RPC really stages and publishes one call.
create function pg_temp.make_db_source() returns uuid language plpgsql as $$
declare issued jsonb; finalizing jsonb; finalized jsonb; oid uuid; claim uuid; fid uuid; prep jsonb;
begin
 issued:=public.issue_own_storage_upload_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF',8,repeat('c',64));
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',issued->>'stagingKey',
 '90000000-0000-4000-8000-000000000001','{"size":8}');
 finalizing:=public.begin_own_upload_finalization_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',(issued->>'uploadId')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('genomes',finalizing->>'finalKey','{"size":8}') returning id into oid;
 delete from storage.objects where bucket_id='genomes' and name=issued->>'stagingKey';
 finalized:=public.complete_own_upload_finalization_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (issued->>'uploadId')::uuid,(finalizing->>'claim')::uuid,oid,repeat('c',64),repeat('d',64));
 fid:=(finalized->>'fileId')::uuid;
 update private.own_preparation_config set enabled=true where singleton;
 perform public.enqueue_own_preparation_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid);
 prep:=public.claim_next_own_preparation_v1(repeat('9',64));
 perform public.freeze_own_preparation_v1((prep->>'jobId')::uuid,(prep->>'attemptId')::uuid,repeat('9',64));
 update private.own_preparation_config set enabled=false where singleton;
 claim:=(public.own_upload_normalization_v1('begin','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid)->>'claim')::uuid;
 perform public.own_upload_normalization_v1('stage','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid,claim,
 '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":15,"source_pos":74749576,"source_ref":"C","source_alt":"A","source_gt":"0/1","rsid":762551,"chrom":15,"pos":74749576,"ref":"C","alt":"A","genotype":"A/C","quality_state":"pass","usable":true}]}');
 perform public.own_upload_normalization_v1('complete','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',fid,claim,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('c',64),'decodedSha256',repeat('d',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
 return fid;
end; $$;
create temporary table db_source as select pg_temp.make_db_source() id;
grant select on db_source to service_role;
select is((select state from private.own_preparation_jobs where file_id=(select id from db_source)),'frozen','actual frozen unpublished preparation permits existing genuine DB recovery');
set local role service_role;
create temporary table db_claim as select public.own_report_generation_with_mail_v1('begin','90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from db_source),'reports.polygenic') receipt;
select ok(not((select receipt->'authorization' from db_claim) ? 'preparedSource'),'legacy DB authorization has no new or null preparedSource field');
reset role;
-- Build the expected legacy JSON from owner-only fixture metadata.
select is((select receipt->'authorization' from db_claim),
 (select jsonb_build_object('context',public.own_report_context_v1(f.user_id,'90000000-0000-4000-8000-000000000010',f.subject_id),
 'grantId',g.grant_id,'grantRevision',g.grant_revision,'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,
 'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id)
 from public.genome_files f join public.purpose_grants g on g.target_id=f.subject_id and g.purpose='reports.polygenic' and g.revoked_at is null
 where f.id=(select id from db_source)), 'legacy DB authorization exactly preserves the prior JSON shape and values');
set local role service_role;
select is(public.own_report_generation_with_mail_v1('read-observed','90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from db_source),'reports.polygenic',(select (receipt->>'claim')::uuid from db_claim),
 '{"loci":[{"chrom":15,"pos":74749576}],"offset":0}')->0->>'genotype','A/C','existing DB read operation still returns its actual normalized call');
select is(public.own_report_generation_with_mail_v1('complete','90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000010',(select id from db_source),'reports.polygenic',(select (receipt->>'claim')::uuid from db_claim),
 pg_temp.report_payload())->>'status','complete','existing DB completion still works with terminal fence');
select is(public.own_captured_report_v1('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000010',
 (select id from generation_subject),(select id from db_source),'prepared-caffeine-fixture')#>>'{source,fileId}',
 (select id::text from db_source),'own saved DB detail remains exact-source readable');
select is(pg_temp.saved()#>>'{source,fileId}',pg_temp.file_id()::text,'adding newer DB source cannot replace earlier prepared saved detail');
select is(private.current_own_report_grant_mail_v1('90000000-0000-4000-8000-000000000001',(select id from db_source),'reports.polygenic')-'context',
 (select (receipt->'authorization')-'context' from db_claim),'legacy mail source/grant JSON remains comparable');
reset role;
select ok(not has_function_privilege('service_role','private.own_report_source_metadata_v1(uuid,uuid,boolean)','EXECUTE'),
 'metadata-only helper cannot be called directly as service genetic authority');
select ok(not has_function_privilege('anon','private.own_report_source_metadata_v1(uuid,uuid,boolean)','EXECUTE')
 and not has_function_privilege('authenticated','private.own_report_source_metadata_v1(uuid,uuid,boolean)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','private.own_report_source_metadata_v1(uuid,uuid,boolean)','EXECUTE'),'metadata helper is closed to client roles');
select ok(not has_function_privilege('service_role','private.assert_own_report_run_current_v1(uuid,uuid,uuid,text,uuid,jsonb,boolean)','EXECUTE'),'terminal internal assertion is not an issued capability');
select ok(not has_function_privilege('service_role','private.own_report_members_metadata_current_v1(uuid,uuid,jsonb)','EXECUTE'),'full ready metadata checker grants no direct read capability');
select is((select enabled from private.own_preparation_config where singleton),false,'integration leaves preparation dispatch disabled');
select * from finish();
rollback;
