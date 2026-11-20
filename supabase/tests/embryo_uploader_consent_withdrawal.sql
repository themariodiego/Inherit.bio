-- A non-parent uploader's withdrawal of its consent for an embryo upload
-- (migration 20261119170000_embryo_uploader_consent_withdrawal; owner
-- decision of 19 November 2026, "A non-parent uploader's withdrawal for an
-- embryo upload stops analysis and deletes, as they signed"). Before
-- finalisation the draft is cancelled and queued on the refused-invitation
-- draft purge; after it the cohort is restricted under the register's actor
-- case nonparent-required-uploader-basis-loss. The uploader becomes no
-- disposition authority and touches no other cohort. Synthetic accounts,
-- contacts and digests only. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

-- U uploads embryos with the genetic parents' permission and is not a parent;
-- P1 and P2 are the genetic parents of U's finalised cohort; O is anyone else.
insert into auth.users(id,email,raw_user_meta_data) values
 ('7b500000-0000-4000-8000-000000000001','embryo-uploader@example.invalid','{}'),
 ('7b500000-0000-4000-8000-000000000002','embryo-parent-one@example.invalid','{}'),
 ('7b500000-0000-4000-8000-000000000003','embryo-parent-two@example.invalid','{}'),
 ('7b500000-0000-4000-8000-000000000009','embryo-outsider@example.invalid','{}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('7b500000-0000-4000-8000-00000000001'||n)::uuid,('7b500000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3','9']) n;
create function pg_temp.a(p text) returns uuid language sql immutable as $$ select ('7b500000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.s(p text) returns uuid language sql immutable as $$ select ('7b500000-0000-4000-8000-00000000001'||p)::uuid $$;
select public.declare_jurisdiction_v1(pg_temp.a(n),pg_temp.s(n),'GB',
 (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),false)
from unnest(array['1','2','3','9']) n;
create function pg_temp.self_principal(p text) returns uuid language sql stable as
 $$ select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
   where s.subject_class='self' and s.subject_account_id=pg_temp.a(p) and sp.account_id=pg_temp.a(p)
    and sp.principal_kind='account_subject' and sp.status='active' $$;
create function pg_temp.draft(p_nonce text) returns uuid language sql volatile as
 $$ select draft_id from public.create_embryo_cohort_draft_v1(pg_temp.a('1'),pg_temp.s('1'),
   'with_genetic_parents_permission','true_two_parent',2,decode('00112233445566778899aabbccddeeff','hex'),repeat('c',64),
   array['ffeeddccbbaa99887766554433221100','00ff00ff00ff00ff00ff00ff00ff00ff'],array[repeat('d',64),repeat('e',64)],p_nonce,true) $$;
create function pg_temp.sign(p_draft uuid,p_nonce text) returns uuid language sql volatile as
 $$ select public.sign_embryo_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),'cohort_draft',p_draft,'consent.upload-embryo',1,
   private.embryo_statement_keys_v1('consent.upload-embryo','uploader'),decode('deadbeef','hex'),'GB',p_nonce) $$;
create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('embryo-uploader-withdrawal:'||p,'sha256'),'hex') $$;
create function pg_temp.wd(p_account text,p_signature uuid,p_code text) returns jsonb language sql volatile as
 $$ select public.withdraw_embryo_uploader_consent_v1(pg_temp.a(p_account),pg_temp.s(p_account),p_signature,pg_temp.h(p_code),
   clock_timestamp()+interval '5 minutes') $$;
create function pg_temp.ready(p_account text,p_signature uuid) returns text language sql stable as
 $$ select public.embryo_uploader_withdrawal_readiness_v1(pg_temp.a(p_account),p_signature) $$;
create function pg_temp.codes() returns bigint language sql as
 $$ select count(*) from public.account_operation_nonces where operation='consent_revoke' and account_id=pg_temp.a('1') $$;
create function pg_temp.sets(p_cohort uuid) returns text language sql stable as
 $$ select string_agg(set_kind||':'||principal_id::text,',' order by set_kind,principal_id) from public.embryo_participant_sets
   where cohort_id=p_cohort and revoked_at is null $$;

-- 1. U's first draft, signed, then finalised into a cohort --------------------------
-- The parents' own ceremony is not what this suite is about, so the cohort,
-- its sets, contacts and embryos are written directly, as the finaliser does.
create temporary table fx(name text primary key, id uuid);
grant select on fx to service_role;
insert into fx values('cohort_draft',pg_temp.draft('nonce-draft-wd-0001-aaaaaaaaa'));
insert into fx values('cohort_signature',pg_temp.sign((select id from fx where name='cohort_draft'),'nonce-sign-wd-0001-aaaaaaaaaa'));
create function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from fx where name=p $$;
select is((select purpose from public.consent_signatures where id=pg_temp.fx('cohort_signature')),'embryo-upload-uploader-class',
 'fixture: U signs the uploader form of the first draft');
update public.embryo_cohort_drafts set state='finalized',finalized_at=clock_timestamp() where id=pg_temp.fx('cohort_draft');
insert into public.subject_principals(id,account_id,principal_kind,principal_revision,status) values
 ('7b500000-0000-4000-8000-0000000000a2',pg_temp.a('2'),'genetic_parent',1,'active'),
 ('7b500000-0000-4000-8000-0000000000a3',pg_temp.a('3'),'genetic_parent',1,'active');
insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
 values('7b500000-0000-4000-8000-0000000000a2',decode('a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2','hex'),repeat('2',64),1,1,'current'),
       ('7b500000-0000-4000-8000-0000000000a3',decode('a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3','hex'),repeat('3',64),1,1,'current');
insert into public.embryo_cohorts(id,draft_id,owner_account_id,upload_class,basis_case,basis_revision,participant_set_revision,
 donor_attribution_revision,embryo_count,retention_expires_at,status)
 values('7b500000-0000-4000-8000-0000000000c1',pg_temp.fx('cohort_draft'),pg_temp.a('1'),'embryo_third_party','true_two_parent',1,1,1,2,
  clock_timestamp()+interval '1 year','active');
insert into fx values('cohort','7b500000-0000-4000-8000-0000000000c1');
insert into public.embryo_participant_sets(cohort_id,set_kind,principal_id,set_revision,membership_revision)
 select pg_temp.fx('cohort'),k,p,1,1 from unnest(array['required_upload_principals','disposition_authorities','notice_recipients',
  'record_key_recipients']) k cross join unnest(array['7b500000-0000-4000-8000-0000000000a2','7b500000-0000-4000-8000-0000000000a3']::uuid[]) p;
insert into public.subjects(id,owner_account_id,subject_class,upload_class,display_label,lifecycle,cohort_id) values
 ('7b500000-0000-4000-8000-0000000000e1',pg_temp.a('1'),'embryo','embryo_third_party','Embryo 1','active',pg_temp.fx('cohort')),
 ('7b500000-0000-4000-8000-0000000000e2',pg_temp.a('1'),'embryo','embryo_third_party','Embryo 2','active',pg_temp.fx('cohort'));
insert into public.embryos(cohort_id,subject_id,sample_ordinal,retention_expires_at) values
 (pg_temp.fx('cohort'),'7b500000-0000-4000-8000-0000000000e1',0,clock_timestamp()+interval '1 year'),
 (pg_temp.fx('cohort'),'7b500000-0000-4000-8000-0000000000e2',1,clock_timestamp()+interval '1 year');

-- Another cohort: P1's own embryos, which U has nothing to do with.
insert into public.embryo_cohort_drafts(id,owner_account_id,uploader_principal_id,upload_class,basis_case,embryo_count,state,
 fixed_expires_at,finalized_at)
 values('7b500000-0000-4000-8000-0000000000d9',pg_temp.a('2'),pg_temp.self_principal('2'),'embryo_own','true_two_parent',1,'finalized',
  clock_timestamp()+interval '30 days',clock_timestamp());
insert into public.embryo_cohorts(id,draft_id,owner_account_id,upload_class,basis_case,basis_revision,participant_set_revision,
 donor_attribution_revision,embryo_count,retention_expires_at,status)
 values('7b500000-0000-4000-8000-0000000000c9','7b500000-0000-4000-8000-0000000000d9',pg_temp.a('2'),'embryo_own','true_two_parent',
  1,1,1,1,clock_timestamp()+interval '1 year','active');
insert into fx values('other_cohort','7b500000-0000-4000-8000-0000000000c9');
insert into public.embryo_participant_sets(cohort_id,set_kind,principal_id,set_revision,membership_revision)
 select pg_temp.fx('other_cohort'),k,'7b500000-0000-4000-8000-0000000000a2',1,1
 from unnest(array['required_upload_principals','disposition_authorities','notice_recipients','record_key_recipients']) k;

-- 2. U's second draft, still open, signed and with an invitation out ------------------
insert into fx values('open_draft',pg_temp.draft('nonce-draft-wd-0002-aaaaaaaaa'));
insert into fx values('draft_signature',pg_temp.sign(pg_temp.fx('open_draft'),'nonce-sign-wd-0002-aaaaaaaaaa'));
insert into fx select 'invitation',invitation_id from public.create_embryo_draft_invitation_v1(pg_temp.a('1'),pg_temp.s('1'),
 pg_temp.fx('open_draft'),repeat('d',64),repeat('1',64),'nonce-invite-wd-0001-aaaaaaaa',true,
 p_quota_keys=>pg_temp.invitation_quota_keys());
select ok(pg_temp.fx('invitation') is not null and exists(select 1 from public.subject_invitations where id=pg_temp.fx('invitation')
  and status='pending' and target_kind='cohort_draft' and target_id=pg_temp.fx('open_draft')),
 'fixture: the open draft has a pending invitation to a genetic parent');
select ok(exists(select 1 from public.mail_outbox where target_kind='subject_invitation' and target_id=pg_temp.fx('invitation')
  and state='queued'),'fixture: its mail is queued');
create temporary table sets_before as select pg_temp.sets(pg_temp.fx('cohort')) cohort, pg_temp.sets(pg_temp.fx('other_cohort')) other;
grant select on sets_before to service_role;
select ok(position(pg_temp.self_principal('1')::text in (select cohort from sets_before))=0,
 'fixture: U is in no participant set of its cohort');

-- Privileges ----------------------------------------------------------------------
select is((select proacl::text from pg_proc where oid='public.withdraw_embryo_uploader_consent_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','only the service role may run the door');
select is((select proacl::text from pg_proc where oid='public.embryo_uploader_withdrawal_readiness_v1(uuid,uuid)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','only the service role may run the page''s read');
select is((select proacl::text from pg_proc where oid='private.embryo_uploader_basis_loss_v1(uuid,uuid)'::regprocedure),
 '{postgres=X/postgres}','nobody may run the actor case directly');

-- The page's read -----------------------------------------------------------------
select is(pg_temp.ready('1',pg_temp.fx('cohort_signature')),'cohort','after finalisation the read says the cohort');
select is(pg_temp.ready('1',pg_temp.fx('draft_signature')),'draft','before finalisation the read says the draft');
select throws_ok($$select pg_temp.ready('2',pg_temp.fx('cohort_signature'))$$,'42501','not_found','a genetic parent reads nothing here');
select throws_ok($$select pg_temp.ready('9',pg_temp.fx('draft_signature'))$$,'42501','not_found','an outsider reads nothing');

-- Refusals, before anything is written ----------------------------------------------
select throws_ok($$select pg_temp.wd('2',pg_temp.fx('cohort_signature'),'parent')$$,'42501','not_found',
 'a genetic parent cannot use the uploader''s withdrawal');
select throws_ok($$select pg_temp.wd('9',pg_temp.fx('draft_signature'),'outsider')$$,'42501','not_found','an outsider cannot');
select throws_ok($$select pg_temp.wd('1',gen_random_uuid(),'unknown')$$,'42501','not_found','an unknown signature is not found');
select throws_ok($$select public.withdraw_embryo_uploader_consent_v1(pg_temp.a('1'),pg_temp.s('9'),pg_temp.fx('cohort_signature'),
  pg_temp.h('foreign-session'),clock_timestamp()+interval '5 minutes')$$,'42501','operation unavailable',
 'another account''s session cannot spend U''s withdrawal');
-- The core under the new case refuses everyone but the uploader, and never
-- outside the uploader's own withdrawal transaction.
select throws_ok($$select private.restrict_embryo_cohort_core_v1(pg_temp.fx('cohort'),'7b500000-0000-4000-8000-0000000000a2','api.consent-revoke')$$,
 '42501','not the non-parent uploader','a disposition authority is not the uploader''s case');
select throws_ok($$select private.restrict_embryo_cohort_core_v1(pg_temp.fx('cohort'),pg_temp.self_principal('1'),'api.consent-revoke')$$,
 '42501','not the non-parent uploader','nor is the uploader outside a transaction its own withdrawal proved');
select throws_ok($$select private.restrict_embryo_cohort_core_v1(pg_temp.fx('cohort'),pg_temp.self_principal('1'),'api.cohort-restrict')$$,
 '42501','not a disposition authority','the uploader is still no disposition authority on the existing routes');
select throws_ok($$select public.restrict_embryo_cohort_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.fx('cohort'),'nonce-restrict-wd-01-aaaaaaa')$$,
 '42501','not a disposition authority','and cannot restrict the cohort through api.cohort-restrict');
select ok(pg_temp.codes()=0
 and (select status from public.embryo_cohorts where id=pg_temp.fx('cohort'))='active'
 and (select state from public.embryo_cohort_drafts where id=pg_temp.fx('open_draft'))='draft'
 and (select status from public.subject_invitations where id=pg_temp.fx('invitation'))='pending'
 and not exists(select 1 from public.legal_audit_log where event_code='embryo.upload-consent.withdrawn'),
 'a refused withdrawal records no code, no event and changes no cohort, draft or invitation');

-- 3. Before finalisation: the draft ------------------------------------------------
set local role service_role;
create temporary table draft_withdrawal as select pg_temp.wd('1',pg_temp.fx('draft_signature'),'draft') body;
reset role;
select is((select body from draft_withdrawal),'{"case":"draft"}'::jsonb,'the withdrawal of the open draft is accepted');
select is((select state from public.embryo_cohort_drafts where id=pg_temp.fx('open_draft')),'cancelled','the draft is cancelled');
select ok((select status='cancelled' and email_encrypted is null and terminal_at is not null from public.subject_invitations
  where id=pg_temp.fx('invitation')),'its pending invitation ends');
select ok(not exists(select 1 from public.mail_outbox where target_kind='subject_invitation' and target_id=pg_temp.fx('invitation')
  and state in ('queued','claimed'))
 and not exists(select 1 from public.token_candidates where target_kind='subject_invitation' and target_id=pg_temp.fx('invitation')
  and state in ('pending','issued')),'its mail and its credentials end');
select is((select count(*) from private.invitation_terminal_notices where invitation_id=pg_temp.fx('invitation')),0::bigint,
 'and nobody is sent a refusal or cancellation notice');
select ok((select p.status='pending' and p.phase_deadline<=clock_timestamp() and p.immutable_envelope->>'draftId'=pg_temp.fx('open_draft')::text
  from public.retention_due_phases p where p.retention_id='embryo.cohort-draft-30d' and p.target_id=pg_temp.fx('open_draft')
   and p.phase_id='embryo-cohort-draft-expiry'),
 'the draft is due now on the purge a refused invitation queues');
select is(pg_temp.codes(),1::bigint,'the one-time code is spent');
select throws_ok($$select pg_temp.wd('1',pg_temp.fx('cohort_signature'),'draft')$$,'22023','invalid_operation_nonce',
 'a spent code is refused, and the cohort is not withdrawn with it');
select ok((select audit_principal_id is not null and coded_context=jsonb_build_object('phase','draft','actor_case',
  'nonparent-required-uploader-basis-loss') from public.legal_audit_log where event_code='embryo.upload-consent.withdrawn'
  and route_id='api.consent-revoke'),'the withdrawal is recorded by its own legal audit event, which names the uploader');
-- The existing drain purges it.
create temporary table purge as select * from public.claim_refused_invitation_draft_purge_v1(repeat('7',64));
select ok((select count(*) from purge)=1 and (select storage_objects from purge)='[]'::jsonb,'the retention drain claims it, with no object to remove');
select lives_ok($$select public.finish_refused_invitation_draft_purge_v1((select manifest_id from purge),repeat('7',64))$$,
 'and finishes it');
select ok(not exists(select 1 from public.embryo_cohort_drafts where id=pg_temp.fx('open_draft'))
 and not exists(select 1 from public.consent_signatures where target_kind='cohort_draft' and target_id=pg_temp.fx('open_draft'))
 and not exists(select 1 from public.subject_invitations where id=pg_temp.fx('invitation')),
 'the draft, its signatures and its invitation are gone');
select is((select status from public.embryo_cohorts where id=pg_temp.fx('cohort')),'active','U''s finalised cohort is untouched by it');

-- 4. After finalisation: the cohort --------------------------------------------------
set local role service_role;
create temporary table cohort_withdrawal as select pg_temp.wd('1',pg_temp.fx('cohort_signature'),'cohort') body;
reset role;
select is((select body from cohort_withdrawal),'{"case":"cohort"}'::jsonb,'the withdrawal of the cohort is accepted');
select is((select status from public.embryo_cohorts where id=pg_temp.fx('cohort')),'restricted','the cohort is restricted');
select is((select array_agg(distinct lifecycle) from public.subjects where cohort_id=pg_temp.fx('cohort')),array['restricted'],
 'every embryo record is restricted: analysis stops');
select is((select count(*) from public.mail_outbox where template_id='cohort-restriction-notice' and target_id=pg_temp.fx('cohort')
  and recipient_principal_id in ('7b500000-0000-4000-8000-0000000000a2','7b500000-0000-4000-8000-0000000000a3')),2::bigint,
 'both genetic parents are told');
select is((select count(*) from public.mail_outbox where target_id=pg_temp.fx('cohort') and recipient_principal_id=pg_temp.self_principal('1')),
 0::bigint,'the uploader is not sent the parents'' notice');
select is(pg_temp.sets(pg_temp.fx('cohort')),(select cohort from sets_before),'no participant set changes: the uploader gains no parent role');
select ok((select count(*)=1 and bool_and(audit_principal_id is not null) from public.legal_audit_log where event_code='embryo.cohort.restricted'
  and route_id='api.consent-revoke'),'the restriction is recorded on api.consent-revoke and names the uploader');
select ok((select audit_principal_id is not null from public.legal_audit_log where event_code='embryo.upload-consent.withdrawn'
  and coded_context->>'phase'='cohort'),'and the withdrawal by its own event');
select is((select count(*) from public.consent_signatures where id=pg_temp.fx('cohort_signature')),1::bigint,
 'the signature itself is kept, as every signature is');
select is((select status from public.embryo_cohorts where id=pg_temp.fx('other_cohort')),'active','another cohort is untouched');
select is(pg_temp.sets(pg_temp.fx('other_cohort')),(select other from sets_before),'and so are its sets');
select throws_ok($$select pg_temp.wd('1',pg_temp.fx('cohort_signature'),'again')$$,'42501','not_found','a restricted cohort cannot be withdrawn twice');
select throws_ok($$select pg_temp.ready('1',pg_temp.fx('cohort_signature'))$$,'42501','not_found','and the read no longer offers it');

-- Bodies --------------------------------------------------------------------------
select is((select md5(pg_get_functiondef(oid)) from pg_proc where oid='private.restrict_embryo_cohort_core_v1(uuid,uuid,text)'::regprocedure),
 '006bfca91b8c66060681371e61333494','the restriction core is the reviewed successor');
select is((select md5(pg_get_functiondef(oid)) from pg_proc where oid='private.queue_refused_invitation_draft_v1(text,uuid,timestamptz,bigint)'::regprocedure),
 '54ab785feca9114bb097e5fbe1484dd9','the draft purge it queues is unchanged');

select * from finish();
rollback;
