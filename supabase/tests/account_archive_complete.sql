begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Pure native contract controls over genuine signing, normalization, report,
-- attested custody/release/binding and relocation doors. Physical metadata and
-- previously recorded scientific payloads are synthetic and rollback-only.
-- This file does not prove actual provider bytes, ZIP delivery or human review.
select ok((select enabled=false from private.account_archive_r2_configuration where singleton),
 'the migration leaves the native TEST R2 configuration OFF');
\ir fixtures/account_archive_ordinary_scientific.inc
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
\ir fixtures/future_person_recorded_scientific_members.inc
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table complete_origins(name text primary key,origin jsonb);
insert into complete_origins values
 ('owner',jsonb_build_object('kind','account','accountId','77900000-0000-4000-8000-000000000001',
  'sessionId','77900000-0000-4000-8000-000000000010')),
 ('claimant',jsonb_build_object('kind','account','accountId','7b100000-0000-4000-8000-000000000001',
  'sessionId','7b100000-0000-4000-8000-000000000002'));
create function pg_temp.archive_origin(name text) returns jsonb language sql as $$
 select origin from complete_origins where complete_origins.name=$1; $$;
select throws_ok($$select private.account_archive_complete_capture_v1(pg_temp.archive_origin('owner'))$$,
 '42501','not_found','new complete capture has no native config bypass');
select is(private.export_account_owned_capture_v1(pg_temp.archive_origin('owner'),'account',
 '77900000-0000-4000-8000-000000000001'),private.export_account_owned_capture_pre_complete_v1(
 pg_temp.archive_origin('owner'),'account','77900000-0000-4000-8000-000000000001'),
 'default-OFF account capture is the exact preserved original delegate');
-- TEST-LOCAL is a runtime/store capability, never a stored pseudo-country.
-- Use the actual current attestation writer; no signature/grant row is seeded.
select throws_ok($$select public.declare_jurisdiction_v2('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','TEST',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)$$,
 '22023','invalid_request','the genuine declaration writer cannot persist the impossible four-letter TEST value');
select is(public.declare_jurisdiction_v2('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','GB',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)->>'jurisdiction','GB',
 'the ordinary actor uses an actual current alpha-2 declaration before complete capture');
select is(public.declare_jurisdiction_v2('7b100000-0000-4000-8000-000000000001','7b100000-0000-4000-8000-000000000002','GB',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)->>'jurisdiction','GB',
 'the claimant actor separately uses an actual current alpha-2 declaration before complete capture');
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
select ok(private.account_archive_complete_enabled_v1(pg_temp.archive_origin('owner')),
 'native TEST configuration and real TEST actor select the complete capture');
select is(private.export_account_owned_capture_v1(pg_temp.archive_origin('owner'),'subject',(select id from normalization_subject)),
 private.export_account_owned_capture_pre_complete_v1(pg_temp.archive_origin('owner'),'subject',(select id from normalization_subject)),
 'subject export keeps the byte-exact legacy body even when TEST account config is enabled');
savepoint missing_declaration;
update public.profiles set jurisdiction_code=null,jurisdiction_subdivision=null,jurisdiction_declared_at=null,
 jurisdiction_attestation_version=null,jurisdiction_attestation_sha256=null
 where id='77900000-0000-4000-8000-000000000001';
select ok(not private.account_archive_complete_enabled_v1(pg_temp.archive_origin('owner')),
 'enabled native TEST store does not supply a missing personal declaration');
select throws_ok($$select private.account_archive_complete_capture_v1(pg_temp.archive_origin('owner'))$$,
 '42501','not_found','undeclared actor independently refuses the complete capture');
select throws_ok($$select private.account_archive_test_ready_v1(pg_temp.archive_origin('owner'),
 '77900000-0000-4000-8000-000000000070',repeat('9',64))$$,
 '42501','account_archive_test_unavailable','undeclared actor independently refuses native READY before record lookup');
rollback to missing_declaration;
savepoint non_test;
select public.declare_jurisdiction_v2('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','XX',null,(select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true);
select ok(not private.account_archive_complete_enabled_v1(pg_temp.archive_origin('owner')),
 'non-TEST actor cannot select the complete TEST capture');
select throws_ok($$select private.account_archive_complete_capture_v1(pg_temp.archive_origin('owner'))$$,
 '42501','not_found','enabled native TEST config is not a production jurisdiction grant');
select throws_ok($$select private.account_archive_test_ready_v1(pg_temp.archive_origin('owner'),
 '77900000-0000-4000-8000-000000000070',repeat('9',64))$$,
 '42501','account_archive_test_unavailable','new READY refuses non-TEST natively before any ready-record lookup');
rollback to non_test;
savepoint no_ready_test_origin;
select throws_ok($$select private.account_archive_test_ready_v1(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010','extra',true),
 '77900000-0000-4000-8000-000000000070',repeat('9',64))$$,
 '42501','account_archive_test_unavailable','new READY cannot use an open or caller-extended origin envelope');
rollback to no_ready_test_origin;

-- Record an existing supported own scientific artifact with a genuinely large
-- payload. It is not a model result or a claimed worker/provider publication.
insert into public.report_artifacts(id,subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
 values('77900000-0000-4000-8000-000000000061',(select id from normalization_subject),
 'synthetic-retained-text',1,repeat('b',64),jsonb_build_object('text',repeat('x',4100000)));
-- The original library has no portrait producer door. A nonempty historical
-- pair row is counted as source, but absent actual mutual/current export
-- authority it must be explicitly excluded, never mislabeled an empty source.
insert into public.family_pairs(subject_a_id,subject_b_id,status)
 values((select id from normalization_subject),(select id from claimant_account_self),'current');
insert into public.portrait_results(id,owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,
 kind,trait_key,result,coverage,method_version,source_binding_fingerprint,computation_revision)
 values('77900000-0000-4000-8000-000000000062','77900000-0000-4000-8000-000000000001',
 (select id from normalization_subject),(select id from claimant_account_self),
 (select id from public.family_pairs where subject_a_id=(select id from normalization_subject)
  and subject_b_id=(select id from claimant_account_self)),
 'carrier_pair','synthetic-retained-pair','{"status":"historical-test-only"}',0,'synthetic-test-only',repeat('b',64),1);
create temporary table before_raw as select private.account_archive_complete_capture_v1(pg_temp.archive_origin('claimant')) value;
select ok((select exists(select 1 from jsonb_array_elements(value->'scopePartitions')x
 where x->>'subjectId'=(select id::text from normalization_subject) and x->>'class'='consent-covered'
  and (x->>'fileCount')::bigint=0) from before_raw),
 'relationship/source presence does not create foreign raw file permission');
select throws_ok($$select private.account_archive_raw_source_v1(pg_temp.archive_origin('claimant'),
 '77900000-0000-4000-8000-000000000040')$$,'42501','not_found','physical own custody is not a recipient raw-export tuple');
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('owner'),
 (select id from normalization_subject))$$,'42501','not_found','direct-owner match cannot substitute for the distinct foreign raw authority');

-- Separate genuine nonce-consuming purpose issuance does not turn storage
-- consent into a signed variants scope. No purpose called variants is invented.
create temporary table archive_grants(purpose text primary key,id uuid);
-- The included binding fixture deliberately flushes every deferred invariant
-- and leaves them immediate. These two initially-deferred pair checks must
-- cover the whole genuine two-insert issuance RPC, never its first insert.
-- Immediately validate each completed statement before reading its authority.
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
insert into archive_grants select 'reports.share-link',public.grant_directional_purpose_v1(
 '77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 (select principal_id from claimant_account_self),'export.share-link','consent.share-with-adult',1,
 'complete-archive-share-link-0001') from(values('export.share-link'))x(purpose);
select lives_ok('set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check immediate',
 'the complete share-link RPC flushes both paired-grant invariants');
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select id from normalization_subject))$$,'42501','not_found','share-link alone cannot export any raw source');
savepoint self_raw_refusal;
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
select public.grant_directional_purpose_v1(
 '77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 (select principal_id from claimant_account_self),'raw.export','consent.share-with-adult',1,
 'complete-archive-self-raw-refused-0001');
select lives_ok('set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check immediate',
 'the complete self-raw RPC flushes both paired-grant invariants before the signed-scope refusal');
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select id from normalization_subject))$$,'42501','not_found',
 'two real directional grants still cannot invent the absent signed self variants scope');
select throws_ok($$select private.account_archive_complete_capture_v1(pg_temp.archive_origin('claimant'))$$,
 '42501','not_found','a live invalid raw candidate refuses the whole capture instead of silently excluding it');
rollback to self_raw_refusal;

-- A positive raw fixture uses an existing genuine variants issuer, not an
-- invented self_source row. Path A acceptance signs consent.subject-adult v1
-- after its actual mailed-token rights session; its new adult binding is then
-- used by the original storage signing and whole normalization doors.
\ir fixtures/invitation_quota_keys.inc
update public.mail_outbox set state='invalidated' where state in('queued','claimed');
insert into auth.users(id,email) values('77900000-0000-4000-8000-000000000090','complete-inviter@example.invalid');
create temporary table accepted_adult as select * from public.create_adult_subject_invitation_v1(
 '77900000-0000-4000-8000-000000000090',decode('00112233445566778899aabbccddeeff','hex'),
 repeat('5',64),repeat('6',64),true,p_quota_keys=>pg_temp.invitation_quota_keys());
create temporary table adult_delivery as select * from public.claim_mail_outbox();
create temporary table adult_token as select encode(digest(convert_to(delivery_token,'UTF8'),'sha256'),'hex') hash
 from adult_delivery;
select is((select target_id from public.token_candidates where id=(select candidate_id from public.token_hashes
 where token_hash=(select hash from adult_token))),(select invitation_id from accepted_adult),
 'the positive adult source uses its actual issued invitation mail token');
select is((select count(*) from public.activate_rights_session_v1((select hash from adult_token),repeat('7',64),
 'complete-adult-open-00000001')),1::bigint,'the issued token opens its real rights session');
select is(public.respond_adult_subject_invitation_session_v1(repeat('7',64),'confirm','complete-adult-confirm-00000001',
 '77900000-0000-4000-8000-000000000001',repeat('5',64)),'accepted',
 'the actual person accepts the existing signed Path A scope in their own account');
select is((select count(*) from public.subject_consents c join public.consent_signatures sig on sig.id=c.signature_id
 where c.subject_id=(select subject_id from accepted_adult) and c.consent_type='adult_source'
 and 'variants'=any(c.scope) and sig.artifact_key='consent.subject-adult'
 and sig.purpose='adult-subject-account-acceptance'),1::bigint,
 'the real acceptance door, rather than test seeding, records the variants scope');
create function pg_temp.sign_adult(artifact text,keys text[]) returns jsonb language plpgsql as $$
declare c jsonb;nonce text;
begin
 c:=public.own_upload_context_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
  (select subject_id from accepted_adult));
 nonce:=encode(digest(convert_to('complete-adult-sign:'||artifact,'UTF8'),'sha256'),'hex');
 -- The current v2 POST records and consumes this rendered nonce in the same
 -- genuine signing transaction. The retired render-time issuer stays absent.
 return public.sign_own_upload_artifact_v2('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
  (select subject_id from accepted_adult),artifact,1,(select body_sha256 from public.consent_artifacts
   where artifact_key=artifact and version=1),keys,(c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,nonce,
  clock_timestamp()+interval '9 minutes');
end $$;
select is(to_regprocedure('public.issue_own_upload_nonce_v1(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,text,text,timestamptz)'),null,
 'complete adult signing never revives the retired render-time nonce issuer');
select is((select count(*) from public.account_operation_nonces where nonce_hash in (
 encode(digest(convert_to('complete-adult-sign:disclosure.insurance-and-discrimination','UTF8'),'sha256'),'hex'),
 encode(digest(convert_to('complete-adult-sign:consent.upload-self','UTF8'),'sha256'),'hex'))),0::bigint,
 'rendered adult-signing nonce hashes have no stored row before either POST');
select pg_temp.sign_adult('disclosure.insurance-and-discrimination',array['understood']);
select pg_temp.sign_adult('consent.upload-self',array['own-adult-dna']);
select is((select count(*) from public.account_operation_nonces where nonce_hash in (
 encode(digest(convert_to('complete-adult-sign:disclosure.insurance-and-discrimination','UTF8'),'sha256'),'hex'),
 encode(digest(convert_to('complete-adult-sign:consent.upload-self','UTF8'),'sha256'),'hex'))
 and account_id='77900000-0000-4000-8000-000000000001'
 and session_id='77900000-0000-4000-8000-000000000010'
 and operation='own_upload_artifact_sign' and consumed_at is not null),2::bigint,
 'both genuine signing POSTs record exactly their own consumed nonce');
select throws_ok($$select pg_temp.sign_adult('consent.upload-self',array['own-adult-dna'])$$,
 '42501','not_found','the genuine v2 adult signer refuses its already consumed nonce');
insert into storage.objects(id,bucket_id,name,metadata) values('77900000-0000-4000-8000-000000000082',
 'genomes','77900000-0000-4000-8000-000000000081','{"size":8}');
-- The included binding lifecycle flushes all deferred constraints and leaves
-- them immediate. Defer only this original circular file/object FK while both
-- unchanged synthetic metadata rows are inserted, then validate the full pair.
set constraints public.genome_files_storage_object_fk deferred;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77900000-0000-4000-8000-000000000083','77900000-0000-4000-8000-000000000001',(select subject_id from accepted_adult),
 '77900000-0000-4000-8000-000000000081','Accepted adult original','vcf',1,8,repeat('d',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('e',64),'77900000-0000-4000-8000-000000000082');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77900000-0000-4000-8000-000000000082','77900000-0000-4000-8000-000000000081','genomes',
 '77900000-0000-4000-8000-000000000083',repeat('d',64),8,1,'current');
select lives_ok('set constraints public.genome_files_storage_object_fk immediate',
 'the complete adult file/storage pair satisfies its original deferred FK before normalization');
create temporary table adult_normalization(receipt jsonb);
create function pg_temp.normalize_adult(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000083',
 case when op='begin' then null else (select(receipt->>'claim')::uuid from adult_normalization) end,payload); $$;
insert into adult_normalization select pg_temp.normalize_adult('begin');
select pg_temp.normalize_adult('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":456,"chrom":1,"pos":100001,"ref":"C","alt":"T","genotype":"C/T"}]}');
select pg_temp.normalize_adult('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('d',64),
 'decodedSha256',repeat('e',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
insert into archive_grants select purpose,public.grant_directional_purpose_v1(
 '77900000-0000-4000-8000-000000000001',(select subject_id from accepted_adult),
 (select principal_id from claimant_account_self),purpose,'consent.share-with-adult',1,
 'complete-adult-grant-'||purpose||'-0001') from unnest(array['export.share-link','raw.export']) purpose;
select lives_ok('set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check immediate',
 'each completed adult raw/share-link RPC leaves both grant rows paired');
select is(private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')->>'path','path-a',
 'exact accepted invitation, current adult_claim and signed scope form the distinct Path A gate');
select is(jsonb_array_length(private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select subject_id from accepted_adult))->'grants'),2,'both independently signed recipient purposes remain required');
create temporary table actual_foreign_source as select private.account_archive_raw_source_v1(
 pg_temp.archive_origin('claimant'),'77900000-0000-4000-8000-000000000083') value;
select is((select value#>>'{file,user_id}' from actual_foreign_source),'77900000-0000-4000-8000-000000000001',
 'source custody names the real file owner without borrowing their session');
select is((select value#>>'{rawAuthority,origin,accountId}' from actual_foreign_source),'7b100000-0000-4000-8000-000000000001',
 'independent raw authority names the genuine current recipient');
select is((select row_text::jsonb from private.account_archive_raw_file_rows_v1(pg_temp.archive_origin('claimant'),
 '77900000-0000-4000-8000-000000000083','variants')),
 '{"rsid":456,"chrom":1,"pos":100001,"ref":"C","alt":"T","genotype":"C/T"}'::jsonb,
 'the exact nonempty six-field normalization result exports without score/canonical invention');
select is((select count(*) from private.account_archive_raw_file_rows_v1(pg_temp.archive_origin('claimant'),
 '77900000-0000-4000-8000-000000000083','canonical')),0::bigint,
 'database backend honestly has no prepared-object canonical members');

-- Missing, withdrawn, stale, mismatched and unrelated Path A evidence each
-- refuses independently; restoring a savepoint never grants new authority.
savepoint path_a_missing;
update public.subject_invitations set accepted_at=null where id=(select invitation_id from accepted_adult);
select throws_ok($$select private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','not_found','missing accepted invitation evidence refuses');
rollback to path_a_missing;
savepoint path_a_withdrawn;
update public.subject_invitations set status='revoked' where id=(select invitation_id from accepted_adult);
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select subject_id from accepted_adult))$$,'42501','not_found','withdrawn accepted invitation refuses raw export');
rollback to path_a_withdrawn;
savepoint path_a_stale;
update public.subjects set subject_binding_revision=subject_binding_revision+1 where id=(select subject_id from accepted_adult);
select throws_ok($$select private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','not_found','stale adult signature binding refuses');
rollback to path_a_stale;
savepoint path_a_binding;
update public.subject_account_bindings set status='revoked',ended_at=clock_timestamp()
 where subject_id=(select subject_id from accepted_adult) and status='current';
select throws_ok($$select private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','not_found','no current adult_claim binding refuses');
rollback to path_a_binding;
savepoint path_a_mismatched;
update public.subject_consents set account_id='77900000-0000-4000-8000-000000000090'
 where subject_id=(select subject_id from accepted_adult) and consent_type='adult_source';
select throws_ok($$select private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','not_found','variants consent from a mismatched account refuses');
rollback to path_a_mismatched;
savepoint path_a_unrelated;
update public.subject_invitations set invitee_principal_id=(select id from public.subject_principals
 where account_id='77900000-0000-4000-8000-000000000090' and principal_kind='account_subject' and status='active')
 where id=(select invitation_id from accepted_adult);
select throws_ok($$select private.account_archive_other_adult_export_gate_v1((select subject_id from accepted_adult),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','not_found','an unrelated accepted invitation principal cannot authorize this subject');
rollback to path_a_unrelated;
savepoint path_a_revoked_scope;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=(select subject_id from accepted_adult) and consent_type='adult_source';
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select subject_id from accepted_adult))$$,'42501','not_found','withdrawn signed variants scope refuses');
rollback to path_a_revoked_scope;
savepoint path_a_wrong_recipient;
select throws_ok($$select private.account_archive_raw_authority_v1(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),
 (select subject_id from accepted_adult))$$,'42501','not_found','the owner account cannot substitute for the named recipient raw tuple');
rollback to path_a_wrong_recipient;

-- The actual claimant Auth fixture has a current self/session but no DOB.
-- Complete that account through the current rendered-nonce API before the
-- separate adult report endpoint is presented; no profile or grant is seeded.
create temporary table complete_claimant_account_context as
 select public.own_upload_context_v1('7b100000-0000-4000-8000-000000000001',
  '7b100000-0000-4000-8000-000000000002',(select id from claimant_account_self)) value;
select is((select value->>'birthDateState' from complete_claimant_account_context),'missing',
 'the real claimant account independently requires adult completion before a report endpoint');
select is(public.complete_own_upload_account_v2('7b100000-0000-4000-8000-000000000001',
 '7b100000-0000-4000-8000-000000000002',(select id from claimant_account_self),
 (select (value->>'accountRevision')::bigint from complete_claimant_account_context),
 (select (value->>'authSessionRevision')::bigint from complete_claimant_account_context),
 (select (value->>'jurisdictionRevision')::bigint from complete_claimant_account_context),
 (select (value->>'subjectBindingRevision')::bigint from complete_claimant_account_context),
 (select (value->>'accountBindingRevision')::bigint from complete_claimant_account_context),
 date '1990-01-01',encode(digest(convert_to('complete-archive-claimant-account-completion-v2','UTF8'),'sha256'),'hex'),
 clock_timestamp()+interval '9 minutes'),'{"status":"completed"}'::jsonb,
 'the actual claimant self/session and all five live revisions complete through the current v2 API');
select ok(coalesce((select p.date_of_birth=date '1990-01-01'
 and public.own_upload_context_v1('7b100000-0000-4000-8000-000000000001',
  '7b100000-0000-4000-8000-000000000002',(select id from claimant_account_self))=
  c.value||jsonb_build_object('accountRevision',(c.value->>'accountRevision')::bigint+1,'birthDateState','adult')
 and exists(select 1 from public.account_operation_nonces n
  where n.nonce_hash=encode(digest(convert_to('complete-archive-claimant-account-completion-v2','UTF8'),'sha256'),'hex')
   and n.account_id=p.id and n.session_id='7b100000-0000-4000-8000-000000000002'
   and n.operation='own_account_completion' and n.consumed_at is not null)
 from complete_claimant_account_context c join public.profiles p
  on p.id='7b100000-0000-4000-8000-000000000001'),false),
 'completion persists the exact adult DOB, advances only the account revision and consumes its genuine nonce');

-- Current report export uses its own exact signed endpoint confirmation as
-- well as export.share-link. Raw permission does not authorize interpretation.
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
insert into archive_grants values('reports.polygenic',public.grant_family_report_purpose_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),(select principal_id from claimant_account_self),
 '7b100000-0000-4000-8000-000000000001','reports.polygenic',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),
 'complete-archive-report-export-0001',public.family_report_grant_presentation_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),'7b100000-0000-4000-8000-000000000001')));
select lives_ok('set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check immediate',
 'the complete signed report RPC flushes both paired-grant invariants');
select is((select count(*) from private.account_archive_related_science_rows_v1(pg_temp.archive_origin('claimant'),
 (select id from normalization_subject),'reports.json')),1::bigint,'real signed endpoint and completed generation export the saved report');
select ok((select bool_and(not(row_text::jsonb ?| array['raw_score','zscore','risk','percentile']))
 from private.account_archive_related_science_rows_v1(pg_temp.archive_origin('claimant'),
 (select id from normalization_subject),'prs.json')),'shared PRS metadata preserves the original no-unvalidated-number projection');

-- The same genuine report fixture proves that the renamed local value still
-- selects its exact signed purpose; a separate absent purpose stays closed.
select is((select row_text::jsonb->>'purpose' from private.account_archive_related_science_rows_v1(
 pg_temp.archive_origin('claimant'),(select id from normalization_subject),'reports.json')),
 'reports.polygenic','the genuine completed report keeps its exact independently signed scientific purpose');
select is((select count(*) from private.account_archive_related_science_rows_v1(
 pg_temp.archive_origin('claimant'),(select id from normalization_subject),'ancestry.json')),0::bigint,
 'the genuine report and export tuple never substitutes for a missing ancestry grant');

create temporary table complete_jobs(name text primary key,origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into complete_jobs(name,origin,attempt) select name,origin,
 case name when 'owner' then '77900000-0000-4000-8000-000000000070'::uuid
 else '7b100000-0000-4000-8000-000000000070'::uuid end from complete_origins;
update complete_jobs set capture=public.export_archive_request_v1('capture',origin,'account',(origin->>'accountId')::uuid);
create function pg_temp.complete_envelope(name text) returns jsonb language sql as $$
 select jsonb_build_object('routeId','api.export','origin','authenticated','principalId',capture->>'principalId',
 'targetKind','account','targetId',origin->'accountId','exportContract','account-export-v1','originBinding',capture->>'originBinding',
 'authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create',
 'nonceHash',encode(digest(convert_to('complete-create:'||$1,'UTF8'),'sha256'),'hex'),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000) from complete_jobs where complete_jobs.name=$1; $$;
update complete_jobs set created=public.export_archive_request_v1('create',origin,'account',(origin->>'accountId')::uuid,
 jsonb_build_object('envelope',pg_temp.complete_envelope(name),'exportCookieHash',repeat('9',64)),repeat('c',64));
select lives_ok('set constraints all immediate','genuine complete request flushes all deferred creation invariants');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from complete_jobs;
create function pg_temp.complete_read(name text,op text,kind text default null,selector jsonb default null) returns jsonb language sql as $$
 select public.export_archive_account_complete_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,selector)
 from complete_jobs where complete_jobs.name=$1; $$;
create temporary table complete_contexts as select name,pg_temp.complete_read(name,'context') value from complete_jobs;
select is((select value->>'version' from complete_contexts where name='claimant'),'account-complete-members-v1',
 'whole-account context has a distinct strict version');
select is((select jsonb_array_length(value#>'{completeReceipt,classes}') from complete_contexts where name='claimant'),29,
 'all29 classes have actual full source and split membership receipts');
select is((select jsonb_array_length(value#>'{completeReceipt,history}') from complete_contexts where name='claimant'),9,
 'all9 history classes have separate original/routed receipts');
select is((select jsonb_array_length(value#>'{completeReceipt,members}') from complete_contexts where name='claimant'),
 (select 12*count(*)::integer from complete_contexts,jsonb_array_elements(value->'partitions')x
  where name='claimant' and x->>'class'='consent-covered'),
 'every consent-covered subject has all12 genuine member dispositions, with no forged legacy frame');
select ok((select exists(select 1 from jsonb_array_elements(value->'partitions')x where x->>'class'='claimed-bound'
  and x->>'subjectId'=(select subject::text from custody_ids)) and exists(select 1 from jsonb_array_elements(value->'partitions')x
  where x->>'class'='consent-covered' and x->>'subjectId'=(select subject_id::text from accepted_adult) and (x->>'fileCount')::integer=1)
 from complete_contexts where name='claimant'),'complete context includes actual claimed and independently raw-authorized partitions');
select ok((select not exists(select 1 from jsonb_array_elements(value#>'{legacyCapture,context,partitions}')x
 where x->>'class'='consent-covered') from complete_contexts where name='claimant'),'legacy compatibility context never pretends a related subject is owned');
select is(pg_temp.complete_read('claimant','context')->'legacyCapture'->'classes',
 public.export_archive_account_classes_v1('context',(select(created->>'exportId')::uuid from complete_jobs where name='claimant'),
 (select attempt from complete_jobs where name='claimant'),(select capture->>'authorityReceipt' from complete_jobs where name='claimant')),
 'strict legacy class DTO equals the actual unchanged public producer under the whole receipt');
select ok((select bool_and((c->>'rows')::bigint>0) from complete_contexts,jsonb_array_elements(value#>'{completeReceipt,classes}')c
 where name='claimant' and c->>'kind' in('embryos','embryo_qc','embryo_scores','embryo_figures','embryo_variants','report_artifacts')),
 'genuine claim/release/relocation plus recorded nonempty science is retained across all six classes');
select ok((select bool_and((c->>'rows')::bigint=(case when old->>'mode'='excluded' then 0 else(c#>>'{legacy,rows}')::bigint end)+(c#>>'{routed,rows}')::bigint)
 from complete_contexts,jsonb_array_elements(value#>'{completeReceipt,classes}')c,
 jsonb_array_elements(value#>'{legacyCapture,classes,classes}')old where name='claimant' and old->>'kind'=c->>'kind'),
 'whole emitted class rows include exact legacy source census semantics and routed counts');
select ok((select exists(select 1 from jsonb_array_elements(value->'dispositions')d where d->>'kind'='portrait_results'
 and(d->>'sourceRows')::bigint>0 and(d->>'exportRows')::bigint=0 and d->>'status'='excluded')
 from complete_contexts where name='owner'),'nonempty portrait without mutual/current permission is an explicit exclusion');
select is(jsonb_array_length(pg_temp.complete_read('claimant','file-rows','variants',jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','afterKey',null))->'rows'),1,
 'new actual complete RPC reads exactly the foreign normalized variant');
select is(jsonb_array_length(pg_temp.complete_read('claimant','member-rows','reports.json',jsonb_build_object(
 'subjectId',(select id from normalization_subject),'afterKey',null))->'rows'),1,
 'related reports are emitted only after actual report and export-recipient authority');
create temporary table complete_original as select pg_temp.complete_read('claimant','original',null,jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','expected',null)) value;
select is((select value->>'version' from complete_original),'account-complete-original-v1','foreign original has its distinct authority envelope');
select is((select value->>'rawAuthoritySha256' from complete_original),
 (select f->>'rawAuthoritySha256' from complete_contexts,jsonb_array_elements(value#>'{completeReceipt,files}')f
  where name='claimant' and f->>'fileId'='77900000-0000-4000-8000-000000000083'),
 'original custody and descriptor use the exact same independent raw authority digest');
select is(pg_temp.complete_read('claimant','original',null,jsonb_build_object('fileId','77900000-0000-4000-8000-000000000083',
 'expected',(select value from complete_original))),(select value from complete_original),
 'exact expected source rechecks every current authority and physical identity');
select throws_ok($$select pg_temp.complete_read('claimant','original',null,jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','expected',(select value||'{"extra":true}' from complete_original)))$$,
 '22023','invalid_request','open original metadata envelope refuses');

create temporary table large_page as select pg_temp.complete_read('owner','rows','report_artifacts') value;
select ok((select row->'rowText'='null'::jsonb and (row#>>'{rowSource,byteCount}')::bigint>4000000
 and octet_length(value::text)<4000000 from large_page,jsonb_array_elements(value->'rows')row),
 'supported greater-than4MB scientific row becomes a byte source without omission or raised metadata cap');
create temporary table assembled_large_row(content bytea);
do $$declare b jsonb;data bytea:='';off bigint:=0;k jsonb;begin
 select value#>'{rows,0,key}' into k from large_page;
 loop
  b:=pg_temp.complete_read('owner','row-bytes','report_artifacts',jsonb_build_object('key',k,'offset',off));
  if (b->>'byteOffset')::bigint<>off then raise exception 'byte offset mismatch';end if;
  data:=data||decode(b->>'base64','base64');off:=octet_length(data);
  if (b->>'eof')::boolean then exit;end if;
 end loop;
 if octet_length(data)<>(b->>'totalBytes')::bigint or encode(digest(data,'sha256'),'hex')<>b->>'sha256'
  then raise exception 'whole source EOF mismatch';end if;
 insert into assembled_large_row values(data);
end $$;
select is((select convert_from(content,'UTF8')::jsonb from assembled_large_row),
 (select to_jsonb(r) from public.report_artifacts r where id='77900000-0000-4000-8000-000000000061'),
 'all large scientific source bytes, order, complete EOF/count/SHA and stored fields survive independent reconstruction');
select throws_ok($$select pg_temp.complete_read('owner','row-bytes','report_artifacts',jsonb_build_object(
 'key',jsonb_build_array((select id from normalization_subject),'unknown'),'offset',0))$$,
 '22023','invalid_request','unknown byte key refuses through the fixed opaque boundary');
select throws_ok($$select pg_temp.complete_read('claimant','member-rows','reports.json',jsonb_build_object(
 'subjectId',(select subject from custody_ids),'afterKey',null))$$,'42501','not_found','new member door never borrows legacy claimed-own identity');

savepoint changed_config;
update private.account_archive_r2_configuration set binding_sha256=repeat('3',64);
select throws_ok($$select pg_temp.complete_read('claimant','context')$$,'42501','not_found','changed native provider binding invalidates the full captured authority');
rollback to changed_config;
savepoint closed_config;
update private.account_archive_r2_configuration set enabled=false;
select throws_ok($$select pg_temp.complete_read('claimant','context')$$,'42501','not_found','config OFF cannot fall back to a prior legacy receipt');
select throws_ok($$select private.account_archive_test_cleanup_due_v1()$$,
 '42501','account_archive_test_unavailable','config OFF cannot discover/stop cleanup through a JS flag');
rollback to closed_config;
savepoint revoked_raw;
select public.revoke_directional_purpose_v1('77900000-0000-4000-8000-000000000001',(select id from archive_grants where purpose='raw.export'));
select throws_ok($$select pg_temp.complete_read('claimant','file-rows','variants',jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','afterKey',null))$$,'42501','not_found','revocation refuses the old complete request rather than omitting buffered raw data');
rollback to revoked_raw;
savepoint unsigned_scope;
update public.subject_consents set scope=array['copilot.local'] where account_id='77900000-0000-4000-8000-000000000001'
 and subject_id=(select subject_id from accepted_adult) and consent_type='adult_source';
select throws_ok($$select private.account_archive_raw_authority_v1(pg_temp.archive_origin('claimant'),
 (select subject_id from accepted_adult))$$,'42501','not_found','separate signed variants scope is required in addition to purpose grants');
rollback to unsigned_scope;
savepoint expired_raw;
update public.purpose_grants set granted_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where grant_id=(select id from archive_grants where purpose='raw.export');
select throws_ok($$select pg_temp.complete_read('claimant','context')$$,'42501','not_found','expired raw authority invalidates the whole prior capture');
rollback to expired_raw;
savepoint changed_recipient;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id='7b100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.complete_read('claimant','context')$$,'42501','not_found','current recipient rebind refuses the durable captured request');
rollback to changed_recipient;
savepoint changed_original;
update storage.objects set version=gen_random_uuid() where id='77900000-0000-4000-8000-000000000082';
select throws_ok($$select pg_temp.complete_read('claimant','original',null,jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','expected',(select value from complete_original)))$$,
 '42501','not_found','changed actual original storage version refuses captured custody');
rollback to changed_original;
savepoint ended_session;
delete from auth.sessions where id='7b100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.complete_read('claimant','context')$$,'42501','not_found','ended real originating session refuses every complete page');
rollback to ended_session;
savepoint changed_payload;
update public.report_artifacts set artifact=jsonb_build_object('text',repeat('x',4100001))
 where id='77900000-0000-4000-8000-000000000061';
select throws_ok($$select pg_temp.complete_read('owner','rows','report_artifacts')$$,
 '42501','not_found','same scientific identity with changed full payload invalidates capture');
rollback to changed_payload;
select is(pg_temp.complete_read('claimant','context'),(select value from complete_contexts where name='claimant'),
 'all refused mutations leave exact original full source/context current');
select is(private.account_archive_test_cleanup_due_v1(),'[]'::jsonb,'active writing lease is not immediately cleanup-due');
select is(private.account_archive_test_disposal_due_v1(),'[]'::jsonb,'active allocation is not disposable merely from a poll');
select ok(not has_function_privilege(role_name,'private.account_archive_complete_capture_v1(jsonb)','EXECUTE')
 and not has_function_privilege(role_name,'private.account_archive_raw_authority_v1(jsonb,uuid)','EXECUTE')
 and not has_function_privilege(role_name,'private.account_archive_other_adult_export_gate_v1(uuid,uuid)','EXECUTE')
 and not has_function_privilege(role_name,'private.issue_account_archive_test_chunk_v1(uuid,text,jsonb,bigint,text,text,bigint)','EXECUTE')
 and not has_function_privilege(role_name,'private.ack_account_archive_test_chunk_v1(uuid,text,jsonb,bigint,text,text,bigint)','EXECUTE')
 and not has_function_privilege(role_name,'private.ack_account_archive_r2_object_absence_v1(uuid,bigint,text,jsonb,jsonb)','EXECUTE'),
 role_name||' cannot manufacture native capture, raw authority, browser receipt or physical absence')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name;
select ok(has_function_privilege('service_role','public.export_archive_account_complete_v1(text,uuid,uuid,text,text,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.export_archive_account_complete_v1(text,uuid,uuid,text,text,jsonb)','EXECUTE'),
 'only the service RPC can consume an existing exact account attempt; the browser cannot choose its sources');
-- Closed claimed-score transport must match the historical consumer exactly.
-- These are the genuine stored scientific rows and actual consumed claimant
-- request above; the nullable receipt column stays present in the source table.
create temporary table archive_claimed_full_scores_before as
 select score.id,to_jsonb(score) full_row from public.embryo_scores score
 where score.embryo_id=(select embryo from custody_ids);
create temporary table archive_claimed_full_capture_before as
 select private.account_archive_complete_capture_v1(pg_temp.archive_origin('claimant')) full_capture;
create function pg_temp.archive_claimed_member_read(op text) returns jsonb language sql as $$
 select public.export_archive_account_members_v1(op,(created->>'exportId')::uuid,attempt,
  capture->>'authorityReceipt',(select subject from custody_ids),null)
 from complete_jobs where name='claimant'; $$;
create temporary table archive_claimed_score_page as select pg_temp.archive_claimed_member_read('scores') value;
create temporary table archive_claimed_figure_page as select pg_temp.archive_claimed_member_read('figures') value;
select ok((select count(*)>0 and bool_and(full_row ? 'computation_receipt'
 and full_row->'computation_receipt'='null'::jsonb) from archive_claimed_full_scores_before),
 'real historical source rows retain the nullable computation_receipt column that caused the original strict refusal');
select ok((select (value->>'count')::bigint=(select count(*) from archive_claimed_full_scores_before)
 and jsonb_array_length(value->'rows')=(select count(*) from archive_claimed_full_scores_before)
 from archive_claimed_score_page),'the real claimed reader emits every captured stored score without an empty stand-in');
select ok((select bool_and(
 (select array_agg(k order by k) from jsonb_object_keys(row)k)=array['citation_ids','computation_revision','computed_at',
 'condition_id','condition_name','coverage_state','evidence_label','finding','id','model_id','model_version',
 'not_covered_reason','source_binding_fingerprint']::text[]
 and row=source.full_row-array['embryo_id','computation_receipt'])
 from archive_claimed_score_page,jsonb_array_elements(value->'rows')row
 join archive_claimed_full_scores_before source on source.id=(row->>'id')::uuid),
 'all thirteen emitted score fields preserve exact finding, evidence, source binding and recorded provenance values');
select ok((select (value->>'count')::bigint=(select count(*) from public.embryo_figures fig
 join archive_claimed_full_scores_before source on source.id=fig.finding_id)
 and jsonb_array_length(value->'rows')=(select count(*) from public.embryo_figures fig
 join archive_claimed_full_scores_before source on source.id=fig.finding_id)
 from archive_claimed_figure_page),'the real claimed reader retains every recorded figure');
select ok((select bool_and(
 (select array_agg(k order by k) from jsonb_object_keys(row->'findingRecord')k)=array['citation_ids','computation_revision','computed_at',
 'condition_id','condition_name','coverage_state','evidence_label','finding','id','model_id','model_version',
 'not_covered_reason','source_binding_fingerprint']::text[]
 and row=(to_jsonb(fig)||jsonb_build_object('findingRecord',source.full_row-array['embryo_id','computation_receipt'])))
 from archive_claimed_figure_page,jsonb_array_elements(value->'rows')row
 join public.embryo_figures fig on fig.id=(row->>'id')::uuid
 join archive_claimed_full_scores_before source on source.id=fig.finding_id),
 'nested figure findingRecord is the same closed thirteen-field score while every stored figure payload remains exact');
select is((select coalesce(jsonb_agg(full_row order by id),'[]') from archive_claimed_full_scores_before),
 (select coalesce(jsonb_agg(to_jsonb(score) order by score.id),'[]') from public.embryo_scores score
 where score.embryo_id=(select embryo from custody_ids)),
 'closed emitted projections do not delete, redact or rewrite any complete internal score row or receipt');
select is(private.account_archive_complete_capture_v1(pg_temp.archive_origin('claimant')),
 (select full_capture from archive_claimed_full_capture_before),
 'both real scientific reads preserve the whole source/capture/census hash and all current authority');

-- Account539: each formerly colliding static branch is evaluated before any
-- loop can assign its record variable. These are the existing genuine capture,
-- permissions, source projections and consumed request, without extra grants.
create temporary table complete_alias_captures as
 select name,origin,private.account_archive_complete_capture_v1(origin) value from complete_jobs;
select is(
 (select coalesce(jsonb_agg(jsonb_build_object('identity',actual.identity,'subjectId',actual.subject_id,'rowText',actual.row_text)
  order by actual.identity,actual.subject_id,actual.row_text),'[]')
  from private.account_archive_complete_class_rows_v1(c.origin,c.value->'legacy',c.value->'permissions',kind) actual),
 (select coalesce(jsonb_agg(jsonb_build_object('identity',projected.projected_id::text,'subjectId',projected.projected_subject,
   'rowText',projected.projected_row::text) order by projected.projected_id::text,projected.projected_subject,projected.projected_row::text),'[]')
  from private.export_account_class_projection_v1((c.origin->>'accountId')::uuid,
   array(select(x->>'subjectId')::uuid from jsonb_array_elements(c.value->'permissions')x),kind) projected
  where not exists(select 1 from private.export_account_class_projection_v1((c.origin->>'accountId')::uuid,
   array(select(x->>'subjectId')::uuid from jsonb_array_elements(c.value#>'{legacy,partitions}')x),kind) old
   where old.projected_id=projected.projected_id)),
 'unassigned-record class branch preserves the complete scoped projection: '||kind)
 from complete_alias_captures c cross join unnest(array['attestation_contradictions','directional_grants',
  'family_sharing_pauses','family_sharing_stops','future_person_claim_objections','future_person_claimant_principals',
  'future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions'])kind where c.name='claimant';
select is(
 (select coalesce(jsonb_agg(jsonb_build_object('identity',actual.identity,'subjectId',actual.subject_id,'rowText',actual.row_text)
  order by actual.identity,actual.row_text),'[]')
  from private.account_archive_complete_member_rows_v1(c.origin,c.value->'legacy',c.value->'permissions',
   (select id from normalization_subject),member) actual),
 (select coalesce(jsonb_agg(jsonb_build_object('identity',science.identity,'subjectId',(select id from normalization_subject),
   'rowText',science.row_text) order by science.identity,science.row_text),'[]')
  from private.account_archive_related_science_rows_v1(c.origin,(select id from normalization_subject),member) science),
 'unassigned-record science member retains actual recipient-authorized content: '||member)
 from complete_alias_captures c cross join unnest(array['reports.json','reports.txt','prs.json','ancestry.json'])member
 where c.name='claimant';
select is(
 (select coalesce(jsonb_agg(to_jsonb(actual) order by actual.identity,actual.row_text),'[]')
  from private.account_archive_complete_member_rows_v1(c.origin,c.value->'legacy',c.value->'permissions',
   (select id from normalization_subject),'portrait.json') actual),
 (select coalesce(jsonb_agg(to_jsonb(portrait) order by portrait.identity,portrait.row_text),'[]')
  from private.account_archive_complete_class_rows_v1(c.origin,c.value->'legacy',c.value->'permissions','portrait_results') portrait
  where portrait.subject_id=(select id from normalization_subject)),
 'unassigned-record portrait member preserves the existing actual nonempty-source permission exclusion')
 from complete_alias_captures c where c.name='claimant';
create temporary table complete_alias_variant_page as select pg_temp.complete_read('claimant','file-rows','variants',
 jsonb_build_object('fileId','77900000-0000-4000-8000-000000000083','afterKey',null)) value;
select is((select value from complete_alias_variant_page),
 (select jsonb_build_object('version','account-complete-page-v1','kind','variants','rows',jsonb_build_array(jsonb_build_object(
  'identity',variant.id::text,'key',jsonb_build_array(variant.file_id,variant.id::text),'subjectId',variant.subject_id,'scope','subject',
  'rowText','{"rsid":456,"chrom":1,"pos":100001,"ref":"C","alt":"T","genotype":"C/T"}'::jsonb::text,'rowSource',null)),
  'nextAfterKey',null) from public.user_variants variant where variant.file_id='77900000-0000-4000-8000-000000000083'),
 'unassigned-record duplicate guard retains the exact genuine normalized row, closed page, key and EOF');
select is(pg_temp.complete_read('claimant','file-rows','variants',jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083','afterKey',(select value#>'{rows,0,key}' from complete_alias_variant_page))),
 '{"version":"account-complete-page-v1","kind":"variants","rows":[],"nextAfterKey":null}'::jsonb,
 'unassigned-record cursor guard accepts the actual last returned key and proves empty EOF');
select throws_ok($$select pg_temp.complete_read('claimant','file-rows','variants',jsonb_build_object(
 'fileId','77900000-0000-4000-8000-000000000083',
 'afterKey',jsonb_build_array('77900000-0000-4000-8000-000000000083','unknown')))$$,
 '22023','invalid_request','unassigned-record cursor guard refuses a syntactically valid absent row without weakening current authority');
select is((select jsonb_agg(jsonb_build_object('name',name,'capture',private.account_archive_complete_capture_v1(origin)) order by name)
 from complete_alias_captures),
 (select jsonb_agg(jsonb_build_object('name',name,'capture',value) order by name) from complete_alias_captures),
 'all repaired branches preserve both complete native source/census/configuration/authority captures byte for byte');

select * from finish();
rollback;
