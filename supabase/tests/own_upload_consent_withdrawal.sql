begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- The withdrawal of a person's consent to store their own DNA file
-- (migration 20261119150000_own_upload_consent_withdrawal; owner decision of
-- 19 November 2026, "Withdrawing consent for a person's own DNA file deletes
-- the files and all made from them"). The door runs api.subject-delete's self
-- emptying unchanged and queues the confirmation email in the same
-- transaction; the page's read predicts the emptying's refusals. Synthetic
-- accounts, files and rows only. Everything rolls back.

-- claim_mail_outbox takes the oldest deliverable row, so a developer
-- database holding other queued mail would hand this suite someone else's
-- row. Retiring them inside the transaction makes the claim below
-- deterministic; the rollback puts them back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('7c910000-0000-4000-8000-000000000001','withdraw-alpha@example.invalid',clock_timestamp(),'{}'),
 ('7c910000-0000-4000-8000-000000000002','withdraw-beta@example.invalid',clock_timestamp(),'{}'),
 ('7c910000-0000-4000-8000-000000000003','withdraw-gamma@example.invalid',null,'{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7c910000-0000-4000-8000-000000000011','7c910000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp(),'aal1'),
 ('7c910000-0000-4000-8000-000000000012','7c910000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp(),'aal1'),
 ('7c910000-0000-4000-8000-000000000013','7c910000-0000-4000-8000-000000000003',clock_timestamp(),clock_timestamp(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in
 ('7c910000-0000-4000-8000-000000000001','7c910000-0000-4000-8000-000000000003');
insert into storage.buckets(id,name) values('genomes','genomes') on conflict do nothing;

create temporary table fx as select
 '7c910000-0000-4000-8000-000000000001'::uuid alpha,
 '7c910000-0000-4000-8000-000000000002'::uuid beta,
 '7c910000-0000-4000-8000-000000000003'::uuid gamma,
 '7c910000-0000-4000-8000-000000000011'::uuid alpha_session,
 '7c910000-0000-4000-8000-000000000012'::uuid beta_session,
 '7c910000-0000-4000-8000-000000000013'::uuid gamma_session,
 '7c910000-0000-4000-8000-000000000021'::uuid f1,
 '7c910000-0000-4000-8000-000000000022'::uuid f2,
 '7c910000-0000-4000-8000-000000000023'::uuid foreign_file,
 (select id from public.subjects where subject_account_id='7c910000-0000-4000-8000-000000000001' and subject_class='self') alpha_subject,
 (select id from public.subjects where subject_account_id='7c910000-0000-4000-8000-000000000002' and subject_class='self') beta_subject,
 (select id from public.subjects where subject_account_id='7c910000-0000-4000-8000-000000000003' and subject_class='self') gamma_subject,
 (select id from public.subject_principals where account_id='7c910000-0000-4000-8000-000000000001' and principal_kind='account_subject' and status='active') alpha_principal,
 (select id from public.subject_principals where account_id='7c910000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active') beta_principal;
grant select on fx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('own-upload-withdrawal-test:'||p,'sha256'),'hex') $$;
-- The envelope the route builds: the account's address sealed under the
-- server key and its keyed hash. Synthetic bytes here; the database never
-- opens them.
create function pg_temp.notice(p_revision bigint default 1, p_hmac text default repeat('c',64)) returns jsonb language sql immutable as
 $$ select jsonb_build_object('contactCiphertext',repeat('ab',40),'contactHmac',p_hmac,'contactRevision',p_revision) $$;
create function pg_temp.withdraw(p_account uuid, p_session uuid, p_subject uuid, p_code text, p_notice jsonb default pg_temp.notice())
returns jsonb language sql volatile as
 $$ select public.empty_self_subject_with_notice_v1(p_account,p_session,p_subject,pg_temp.h(p_code),
  clock_timestamp()+interval '5 minutes',p_notice) $$;
create function pg_temp.ready(p_account uuid, p_subject uuid) returns text language sql stable as
 $$ select public.self_subject_withdrawal_readiness_v1(p_account,p_subject) $$;

-- Alpha signs the two own-upload artifacts through the real signing path,
-- so the consent rows are the ones an upload makes.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select pg_temp.h('sign-'||letter),alpha,alpha_session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from fx, unnest(array['insurance','upload','again']) letter;
select public.sign_own_upload_artifact_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,pg_temp.h('sign-insurance'));
select public.sign_own_upload_artifact_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
 'consent.upload-self',1,(select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,pg_temp.h('sign-upload'));
create temporary table upload_consent as select sc.id, sc.signature_id from public.subject_consents sc
 where sc.subject_id=(select alpha_subject from fx) and sc.consent_type='upload_class' and sc.revoked_at is null;
select is((select count(*) from upload_consent),1::bigint,'fixture: Alpha holds one live upload consent on its own record');

-- Two analysed files, a result, a report, a chat, a share with Beta, a
-- current family pair with a joint result, and Beta's chat turn that drew on
-- Alpha's record.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select x.id,fx.alpha,fx.alpha_subject,fx.alpha::text||'/'||x.name,x.name||'.txt','array_ancestry',1,1,'annotated'
from fx, (values ((select f1 from fx),'synthetic-one'),((select f2 from fx),'synthetic-two')) x(id,name);
insert into storage.objects(bucket_id,name) select 'genomes',bucket_path from public.genome_files
 where id in ((select f1 from fx),(select f2 from fx));
insert into public.ancestry_results(user_id,file_id,kind,result,support_note,subject_id)
select alpha,f1,'admixture','{}'::jsonb,'synthetic',alpha_subject from fx;
insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
select alpha_subject,'synthetic-withdrawal',1,repeat('a',64),'{}' from fx;
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
select '7c910000-0000-4000-8000-000000000031',alpha,'Synthetic own chat','self',alpha_subject,1,'local',1,1,repeat('a',64),false from fx;
select ok(private.persist_chat_turn_pair_v1('7c910000-0000-4000-8000-000000000031',(select alpha from fx),'"own question"','"own answer"') is not null,
 'fixture: Alpha has a Copilot turn on its own record');
set local role service_role;
create temporary table alpha_grant as select public.grant_directional_purpose_v1((select alpha from fx),(select alpha_subject from fx),
 (select beta_principal from fx),'reports.polygenic','consent.share-with-adult',1,'own-upload-withdrawal-share-000') id;
reset role;
insert into public.family_pairs(id,subject_a_id,subject_b_id,status)
select '7c910000-0000-4000-8000-000000000041',alpha_subject,beta_subject,'current' from fx;
insert into public.portrait_results(owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,
 kind,trait_key,result,coverage,method_version,source_binding_fingerprint,computation_revision)
select alpha,alpha_subject,beta_subject,'7c910000-0000-4000-8000-000000000041','carrier_pair','abo','{}'::jsonb,1,
 'synthetic-v1',repeat('7',64),1 from fx;
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
select '7c910000-0000-4000-8000-000000000032',beta,'Synthetic reader chat','self',beta_subject,1,'local',1,1,repeat('a',64),false from fx;
select ok(private.persist_chat_turn_pair_v1('7c910000-0000-4000-8000-000000000032',(select beta from fx),'"shared question"','"shared answer"') is not null,
 'fixture: Beta has a turn of its own');
update public.chat_messages set retrieved_subject_ids=array[(select alpha_subject from fx)]
 where chat_id='7c910000-0000-4000-8000-000000000032' and role='assistant';

-- Privileges -------------------------------------------------------------------
select is(has_function_privilege('authenticated','public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)','execute'),false,
 'an authenticated client cannot reach the withdrawal door');
select is(has_function_privilege('anon','public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)','execute'),false,
 'anon cannot reach the withdrawal door');
select is(has_function_privilege('service_role','public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)','execute'),true,
 'the service role reaches the withdrawal door');
select is(has_function_privilege('authenticated','public.self_subject_withdrawal_readiness_v1(uuid,uuid)','execute')
  or has_function_privilege('anon','public.self_subject_withdrawal_readiness_v1(uuid,uuid)','execute'),false,
 'no browser role reaches the page''s read');
select is(has_function_privilege('service_role','private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)','execute')
  or has_function_privilege('authenticated','private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)','execute'),false,
 'the email is queued only through the door');
select is((select provolatile from pg_proc where oid='public.self_subject_withdrawal_readiness_v1(uuid,uuid)'::regprocedure),'s',
 'the page''s read is declared stable: it writes nothing');

-- The page's read ---------------------------------------------------------------
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'ready','a record with finished files is ready');
select throws_ok($$select pg_temp.ready((select beta from fx),(select alpha_subject from fx))$$,'42501','not_found',
 'another account''s record is not found by the read');
update public.genome_files set status='parsing' where id=(select f2 from fx);
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'processing','a file still being processed reads processing');

-- Refusals before any write ------------------------------------------------------
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'processing')$$,
 '55000','subject_delete_processing','the door refuses what the read predicted, as the emptying does');
update public.genome_files set status='annotated' where id=(select f2 from fx);
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select foreign_file,beta,alpha_subject,beta::text||'/synthetic-foreign','synthetic-foreign.txt','array_ancestry',1,1,'annotated' from fx;
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'unsupported','a file another account holds on the record reads unsupported');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'unsupported')$$,
 '55000','subject_delete_unsupported_graph','the door refuses what the read predicted, as the emptying does');
delete from public.genome_files where id=(select foreign_file from fx);
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'ready','and reads ready again once it is gone');
-- The emptying cancels every queued job but a purge, and the per-file guard
-- then refuses a file a purge is still working on.
insert into public.worker_jobs(user_id,kind,output_kind,source_binding_kind,source_binding_id,source_binding_revision,
 file_sha256,computation_revision,idempotency_key,subject_id,file_id,status)
select alpha,'revoke_purge','lifecycle.revoke-purge','revocation-disposition',f1,1,repeat('a',64),1,pg_temp.h('purge-job'),
 alpha_subject,f1,'queued' from fx;
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'processing','a purge still queued on a file reads processing');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'purging')$$,
 '55000','file_delete_processing','the door refuses what the read predicted, as the per-file guard does');
delete from public.worker_jobs where idempotency_key=pg_temp.h('purge-job');
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'ready','and reads ready again once the purge is done');

select throws_ok($$select public.empty_self_subject_with_notice_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
  pg_temp.h('no-notice'),clock_timestamp()+interval '5 minutes',null)$$,'22023','invalid_request','a withdrawal with no email envelope is refused');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'extra-key',
  pg_temp.notice()||'{"dashboardUrl":"https://example.invalid/"}')$$,'22023','invalid_request','an envelope with an unknown key is refused');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'short-hmac',
  pg_temp.notice(1,'abc'))$$,'22023','invalid_request','an envelope with a malformed keyed hash is refused');
select throws_ok($$select pg_temp.withdraw((select beta from fx),(select beta_session from fx),(select alpha_subject from fx),'foreign')$$,
 '42501','not_found','another account cannot withdraw for this record');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select beta_session from fx),(select alpha_subject from fx),'foreign-session')$$,
 '42501','not_found','another account''s session cannot withdraw for it');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),'7c910000-0000-4000-8000-0000000000ff','unknown')$$,
 '42501','not_found','an unknown record is not found');
-- A record of another class is not this door's, even one the account owns.
insert into public.subjects(id,owner_account_id,subject_class,upload_class,display_label,lifecycle)
select '7c910000-0000-4000-8000-000000000051',alpha,'other_adult','adult','Synthetic adult','active' from fx;
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),'7c910000-0000-4000-8000-000000000051','adult')$$,
 '42501','not_found','a record that is not a self record is not this door''s');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'stale-address',
  pg_temp.notice(2))$$,'55000','withdrawal_notice_recipient_stale','an envelope from before an address change refuses the whole withdrawal');
select throws_ok($$select pg_temp.withdraw((select gamma from fx),(select gamma_session from fx),(select gamma_subject from fx),'unconfirmed')$$,
 '55000','withdrawal_notice_unavailable','an account with no confirmed address cannot be sent the email, and nothing is emptied');
select ok((select lifecycle_revision=1 from public.subjects where id=(select gamma_subject from fx)),
 'the refused record was not emptied');
select is((select count(*) from public.account_operation_nonces where account_id in ((select alpha from fx),(select gamma from fx))
  and operation='subject_delete'),0::bigint,'a refused withdrawal records no code');
select ok((select revoked_at is null from public.subject_consents where id=(select id from upload_consent))
  and (select count(*) from private.genome_file_deletions where file_id in ((select f1 from fx),(select f2 from fx)))=0
  and (select count(*) from public.report_artifacts where subject_id=(select alpha_subject from fx))=1
  and (select count(*) from public.chats where subject_id=(select alpha_subject from fx))=1
  and (select revoked_at is null from public.purpose_grants where grant_id=(select id from alpha_grant))
  and (select count(*) from public.mail_outbox where template_id='upload-consent-withdrawn')=0,
 'a refused withdrawal changes no consent, file, result, chat or grant, and queues no email');

-- The withdrawal ------------------------------------------------------------------
-- An earlier address on file, and mail the record already had queued to
-- it, which the emptying invalidates.
insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
select '7c910000-0000-4000-8000-000000000061',alpha_principal,decode(repeat('cd',40),'hex'),repeat('d',64),1,
 (select principal_revision from public.subject_principals where id=fx.alpha_principal),'current' from fx;
insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
 recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at)
select 'synthetic-earlier','synthetic-earlier','subject',alpha_subject,alpha_principal,'7c910000-0000-4000-8000-000000000061',
 (select principal_revision from public.subject_principals where id=fx.alpha_principal),1,pg_temp.h('earlier-mail'),'{}'::jsonb,
 clock_timestamp()+interval '1 day' from fx;
select is((select state from public.mail_outbox where idempotency_key=pg_temp.h('earlier-mail')),'queued','fixture: the record has queued mail');
create temporary table before_withdrawal as select lifecycle_revision rev,
 (select count(*) from public.subject_consents where subject_id=(select alpha_subject from fx)) consents,
 (select count(*) from public.consent_signatures where target_id=(select alpha_subject from fx)) signatures
 from public.subjects where id=(select alpha_subject from fx);
select set_config('inherit.legal_audit_actor','',true);
set local role service_role;
create temporary table withdrawn as select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'withdraw-1') body;
reset role;
select is((select body from withdrawn),jsonb_build_object('case','self','files',
  (select jsonb_agg(x order by x) from unnest(array[(select f1 from fx),(select f2 from fx)]) x)),
 'the door answers as the self case does, with exactly the record''s files to drain');
select is((select count(*) from public.account_operation_nonces where account_id=(select alpha from fx) and operation='subject_delete'
  and nonce_hash=pg_temp.h('withdraw-1') and consumed_at is not null),1::bigint,'the code''s hash is recorded as spent in the same transaction');
select ok((select revoked_at is not null and revocation_reason='withdrawn' from public.subject_consents where id=(select id from upload_consent)),
 'the upload consent is marked withdrawn');
select is((select count(*) from public.subject_consents where subject_id=(select alpha_subject from fx)),(select consents from before_withdrawal),
 'and kept: no consent row is deleted');
select is((select count(*) from public.consent_signatures where target_id=(select alpha_subject from fx)),(select signatures from before_withdrawal),
 'every signature stays as it was signed');
select is((select count(*) from public.subject_consents where subject_id=(select alpha_subject from fx) and revoked_at is null),0::bigint,
 'no consent on the record is live');
select ok((select subject_class='self' and lifecycle='active' and owner_account_id=(select alpha from fx)
  and lifecycle_revision=(select rev from before_withdrawal)+1 from public.subjects where id=(select alpha_subject from fx))
  and (select status from public.subject_principals where id=(select alpha_principal from fx))='active'
  and exists(select 1 from auth.users where id=(select alpha from fx) and deleted_at is null)
  and (select deletion_requested_at is null from public.profiles where id=(select alpha from fx)),
 'the account, its record and its principal stay');
select is((select count(*) from private.genome_file_deletions where file_id in ((select f1 from fx),(select f2 from fx))),2::bigint,
 'every file is prepared for deletion');
select is((select count(*) from public.ancestry_results where subject_id=(select alpha_subject from fx))
  +(select count(*) from public.report_artifacts where subject_id=(select alpha_subject from fx))
  +(select count(*) from public.chats where subject_id=(select alpha_subject from fx)),0::bigint,
 'every result, report and Copilot conversation made from them is deleted');
select is((select count(*) from public.chat_messages where retrieved_subject_ids && array[(select alpha_subject from fx)]),0::bigint,
 'the copy another account held is deleted');
select ok((select revocation_reason='subject_deleted' from public.purpose_grants where grant_id=(select id from alpha_grant))
  and (select status from public.family_pairs where id='7c910000-0000-4000-8000-000000000041')='revoked'
  and (select count(*) from public.portrait_results where family_pair_id='7c910000-0000-4000-8000-000000000041')=0,
 'the sharing permission and the family link built on the files end');
select is((select count(*) from public.legal_audit_log where event_code='subject.emptied' and route_id='api.subject-delete'
  and audit_principal_id=(select audit_principal_id from private.legal_audit_account_principals where account_id=(select alpha from fx))),1::bigint,
 'the emptying''s audit event records the withdrawal and names the account that asked for it');
select is((select state||' '||last_outcome_code from public.mail_outbox where idempotency_key=pg_temp.h('earlier-mail')),
 'invalidated subject_emptied','mail the record had queued is invalidated');

-- The confirmation email, queued in the same transaction ----------------------------
create temporary table notice as select m.* from public.mail_outbox m where m.template_id='upload-consent-withdrawn';
select is((select count(*) from notice),1::bigint,'exactly one confirmation email is queued');
select ok((select purpose='upload-consent-withdrawn' and target_kind='subject' and target_id=(select alpha_subject from fx)
  and recipient_principal_id=(select alpha_principal from fx) and state='queued' and token_purpose is null
  and semantic_revision=(select rev from before_withdrawal)+1
  and idempotency_key=encode(extensions.digest(convert_to('upload-consent-withdrawn-v1|'||(select alpha from fx)::text||'|'
   ||pg_temp.h('withdraw-1'),'UTF8'),'sha256'),'hex')
  and expires_at<=created_at+interval '7 days' and expires_at>created_at+interval '6 days' from notice),
 'to the account''s own principal on the record, named by the spent code, for seven days');
select is((select array(select jsonb_object_keys(template_payload)) from notice),array['withdrawnAt'],
 'the email carries only the moment of the withdrawal');
select ok((select (template_payload->>'withdrawnAt')::timestamptz between created_at-interval '1 minute' and created_at from notice),
 'and that moment is the withdrawal''s');
select ok((select e.contact_hmac=repeat('c',64) and e.status='current' and e.contact_ciphertext=decode(repeat('ab',40),'hex')
  and e.principal_id=(select alpha_principal from fx)
  from public.encrypted_contact_references e where e.id=(select contact_reference_id from notice)),
 'addressed to the sealed address the route sent');
select is((select status from public.encrypted_contact_references where id='7c910000-0000-4000-8000-000000000061'),'rotated',
 'an earlier address on file is rotated out, as the own report-ready email does');
update public.mail_outbox set state='claimed',claimed_at=clock_timestamp(),attempt_count=1 where id=(select id from notice);
select is(public.authorize_mail_submission_v1((select id from notice),1::smallint),true,
 'the mail worker''s submission check sends it');
update public.mail_outbox set state='queued',claimed_at=null,attempt_count=0 where id=(select id from notice);
create temporary table claimed as select * from public.claim_mail_outbox();
select ok((select outbox_id=(select id from notice) and template_id='upload-consent-withdrawn' and delivery_token is null
  and contact_ciphertext=decode(repeat('ab',40),'hex') from claimed),'the ordinary mail claim hands it to the worker, with no token');
select throws_ok($$select pg_temp.withdraw((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),'withdraw-1')$$,
 '22023','invalid_operation_nonce','a replayed code is refused, and queues nothing');
select is((select count(*) from public.mail_outbox where template_id='upload-consent-withdrawn'),1::bigint,'still exactly one email');

-- Afterwards a new upload asks for the consent again ---------------------------------
select is(pg_temp.ready((select alpha from fx),(select alpha_subject from fx)),'ready','the emptied record can be read again');
select is((select count(*) from public.subject_consents where subject_id=(select alpha_subject from fx) and account_id=(select alpha from fx)
  and consent_type='upload_class' and revoked_at is null and scope @> array['store']),0::bigint,
 'no live upload consent remains, so the upload page asks for it again');
select lives_ok($$select public.sign_own_upload_artifact_v1((select alpha from fx),(select alpha_session from fx),(select alpha_subject from fx),
 'consent.upload-self',1,(select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,pg_temp.h('sign-again'))$$,'the person can give the consent again');
select is((select count(*) from public.subject_consents where subject_id=(select alpha_subject from fx) and consent_type='upload_class'
  and revoked_at is null),1::bigint,'and holds one live upload consent again');
select ok((select revocation_reason='withdrawn' from public.subject_consents where id=(select id from upload_consent)),
 'the withdrawn consent stays withdrawn beside it');

-- The wrapped functions are the ones reviewed ------------------------------------------
-- 2026-11-20 (D-144): 20261120100000 patches the self emptying, from exactly
-- the body this migration pinned (its patch predecessor there), so the
-- reviewed body is now that patch's successor.
-- 2026-11-22 (D-152): 20261122130000 patches that successor
-- (5c35b1a9eafbfe7fd3e16f54b648dee7) once more, in its whole-account copies only.
select is((select md5(pg_get_functiondef('private.empty_self_subject_v1(uuid,uuid)'::regprocedure))),'768b5433d639f9c8578fbd59a5a0d703',
 'the self emptying is the reviewed body: as 20261016181000 wrote it, patched by 20261120100000 and 20261122130000');

select * from finish();
rollback;
