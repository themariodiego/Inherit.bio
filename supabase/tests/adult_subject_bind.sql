-- api.adult-subject-bind (20261016207000_adult_subject_bind.sql; owner
-- decision 2026-10-22). Synthetic accounts and rows only. Everything rolls
-- back.
--
-- The adult-subject-control purpose has no issuer, so no session of it can
-- exist on a real database: block 1 proves the door is closed. Block 2
-- registers the purpose inside this transaction only, on a person who
-- confirmed a real Path B request with no account, to prove what the door
-- does once an issuer and the binding notice exist: it refuses while a file
-- is pending, binds once every file is confirmed, ends the non-account
-- principal's grants, sends nothing and leaves ownership unchanged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
-- 02 signs in again now, so its session is recent.
update auth.sessions set created_at=clock_timestamp() where id=pg_temp.s('2');

select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','bind-token-aaaaaaaaaaaaaaaaaa'),'accepted','fixture: the person signs with no account');
create temporary table bx as select
 (select id from public.subject_principals where subject_id=pg_temp.sid('nb') and principal_kind='non_account_subject'
  and status='active') principal,
 (select principal_revision from public.subject_principals where subject_id=pg_temp.sid('nb')
  and principal_kind='non_account_subject' and status='active') principal_revision,
 (select id from public.token_hashes order by created_at desc limit 1) token;
grant select on bx to service_role;

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('adult-subject-bind-test:'||p,'sha256'),'hex') $$;
create function pg_temp.control_session(p_id uuid,p_secret text) returns uuid language sql volatile as $$
 insert into public.rights_sessions(id,token_hash_id,principal_id,purpose,target_kind,target_id,authority_revision,
  session_hash,expires_at)
 select p_id,token,principal,'adult-subject-control','subject',pg_temp.sid('nb'),principal_revision,pg_temp.h(p_secret),
  clock_timestamp()+interval '1 hour' from bx returning id $$;
create function pg_temp.bind(p_secret text,p_nonce text,p_account text default '2',p_flag boolean default true)
returns jsonb language sql volatile as $$
 select public.bind_adult_subject_account_v1(pg_temp.h(p_secret),p_nonce,pg_temp.a(p_account),pg_temp.s(p_account),p_flag) $$;

-- 0. Admission ---------------------------------------------------------------
select ok(has_function_privilege('service_role','public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','execute')
 and not has_function_privilege('authenticated','public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','execute')
 and not has_function_privilege('anon','public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','execute')
 and not has_function_privilege('inherit_upload_only','public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','execute'),
 'only the service role reaches the bind door');

-- 1. Closed until an issuer exists ----------------------------------------------
select is(private.rights_action_permitted_v1('adult-subject-control','bind-account','api.adult-subject-bind'),false,
 'the purpose matrix refuses the bind while no issuer exists');
select throws_ok($$select pg_temp.control_session('0b5e0000-0000-4000-8000-000000000301','closed')$$,
 '42501','rights purpose unavailable','no adult-subject-control session can be created');
select throws_ok($$select pg_temp.bind('closed','bind-nonce-closed-0000000001')$$,'42501','not_found',
 'with no session the door refuses');

-- 2. An issuer exists (registered in this transaction only) ------------------------
insert into private.rights_session_purposes(session_purpose,matrix_purpose,invitation_kind,target_kind)
values ('adult-subject-control','adult-subject-control',null,'subject');
select pg_temp.control_session('0b5e0000-0000-4000-8000-000000000302','current');
select is((select h->>'status' from (select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64)) h) x),'stored_quarantined',
 'fixture: a file is held for the person');
create temporary table outbox_before as select count(*) n from public.mail_outbox;
grant select on outbox_before to service_role;
select throws_ok($$select pg_temp.bind('current','bind-nonce-pending-000000001')$$,'42501','not_found',
 'the bind is refused while a file is pending');
select is(pg_temp.notice_session('nb','1'),1::bigint,'fixture: the file notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'bind-confirm-1111111111111111','confirm'),'confirmed',
 'fixture: the person says yes to the file');

select throws_ok($$select pg_temp.bind('current','bind-nonce-flag-00000000001',p_flag=>false)$$,'42501','not_found',
 'outside the test jurisdiction the door refuses');
select throws_ok($$select pg_temp.bind('current','bind-nonce-uploader-0000001','1')$$,'42501','not_found',
 'the uploader cannot bind the person''s record to their own account');
update auth.sessions set created_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.s('2');
select throws_ok($$select pg_temp.bind('current','bind-nonce-stale-0000000001')$$,'42501','recent_reauthentication_required',
 'a sign-in older than 15 minutes is refused');
update auth.sessions set created_at=clock_timestamp() where id=pg_temp.s('2');
update public.profiles set jurisdiction_code='US' where id=pg_temp.a('2');
select throws_ok($$select pg_temp.bind('current','bind-nonce-juris-0000000001')$$,'42501','not_found',
 'an account whose declared country differs from the signed one is refused');
update public.profiles set jurisdiction_code='GB' where id=pg_temp.a('2');
select ok((select subject_account_id is null from public.subjects where id=pg_temp.sid('nb'))
 and (select status='active' from public.subject_principals where id=(select principal from bx)),
 'every refusal wrote nothing');

-- One uploader-direction grant the person signed with no account, written directly.
insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,recipient_account_id,
 relationship_kind,relationship_revision,status)
select pg_temp.sid('nb'),principal,(select id from public.subject_principals where account_id=pg_temp.a('1')
 and principal_kind='account_subject' and status='active' order by created_at limit 1),pg_temp.a('1'),'uploader',1,'current' from bx;
create temporary table nb_grant(grant_id uuid);
with sig as (
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,signer_account_id,
  target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
 select a.artifact_key,a.version,a.body_sha256,b.principal,null,'subject',s.id,'ancestry',
  array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'],decode(repeat('ab',24),'hex'),'GB',1,s.subject_binding_revision
 from bx b cross join public.subjects s cross join public.consent_artifacts a
 where s.id=pg_temp.sid('nb') and a.artifact_key='consent.share-with-adult' and a.superseded_at is null returning *),
g as (insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,artifact_body_sha256,
 signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,jurisdiction_code,jurisdiction_revision)
select 1,'subject',target_id,'ancestry',artifact_key,artifact_version,artifact_body_sha256,id,signer_principal_id,signer_principal_id,
 subject_binding_revision,'GB',1 from sig returning grant_id)
insert into nb_grant select grant_id from g;
insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,relationship_id,
 relationship_or_pair_revision,direction)
select g.grant_id,1,r.recipient_principal_id,r.recipient_account_id,r.id,1,'subject_to_recipient'
from nb_grant g cross join public.subject_relationships r where r.subject_id=pg_temp.sid('nb') and r.relationship_kind='uploader';
grant select on nb_grant to service_role;

-- G5.6 (20261023130000): the bind records its one nonce, the rights
-- session's, with the signed-in account and its auth session, so its event
-- names the account. Planted first: the nonce recorded with no account, as
-- before, names no one.
savepoint unproven_bind;
create or replace function private.adult_subject_control_for_account_v1(p_session_hash text,p_nonce text,p_action text,
 p_route_id text,p_test_jurisdiction boolean,p_account_id uuid,p_auth_session_id uuid) returns jsonb language sql
 security definer set search_path='' as $f$
 select private.adult_subject_control_v1(p_session_hash,p_nonce,p_action,p_route_id,p_test_jurisdiction) $f$;
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
select pg_temp.bind('current','bind-nonce-good-00000000001');
select is((select audit_principal_id from public.legal_audit_log where event_code='subject.account-bound' and route_id='api.adult-subject-bind' order by seq desc limit 1),null::uuid,
 'planted: a bind whose nonce is recorded with no account names no one');
rollback to unproven_bind;
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
create temporary table bound as select pg_temp.bind('current','bind-nonce-good-00000000001') r;
select ok(coalesce((select audit_principal_id from public.legal_audit_log where event_code='subject.account-bound' and route_id='api.adult-subject-bind' order by seq desc limit 1)
  =(select audit_principal_id from private.legal_audit_account_principals where account_id=pg_temp.a('2')),false),'the bind names the account that bound the record');
select ok((select account_id=pg_temp.a('2') and session_id=pg_temp.s('2') and operation='adult_subject_control_bind_account'
 from public.embryo_operation_nonces where nonce_hash=encode(extensions.digest(convert_to('bind-nonce-good-00000000001','UTF8'),'sha256'),'hex')),
 'its one nonce is recorded once, with the account and its auth session');
select is((select r from bound),jsonb_build_object('status','account_bound','subjectId',pg_temp.sid('nb'),
 'next','review_purposes_and_optionally_transfer_ownership'),'the bind answers adult-subject-bound-v1');
select ok((select s.subject_account_id=pg_temp.a('2') and s.owner_account_id=pg_temp.a('1')
 from public.subjects s where s.id=pg_temp.sid('nb')),'the record is bound to the person''s account and still owned by the uploader');
select ok((select pg.revocation_reason='superseded' and dg.status='superseded' from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id where pg.grant_id=(select grant_id from nb_grant)),
 'the grant the non-account principal signed ends: no pending status, the account signs afresh');
select is((select status from public.subject_principals where id=(select principal from bx)),'detached',
 'the non-account principal keeps no authority');
select is((select count(*) from public.subject_principals where subject_id=pg_temp.sid('nb') and account_id=pg_temp.a('2')
 and principal_kind='account_subject' and status='active'),1::bigint,'one account principal now speaks for the person');
select ok((select h.state='confirmed' and h.confirmation_principal_id=(select principal from bx)
  and h.subject_binding_revision=s.subject_binding_revision
 from public.other_adult_held_uploads h join public.subjects s on s.id=h.subject_id where h.subject_id=pg_temp.sid('nb')),
 'the confirmed file takes the new binding revision and keeps its confirming principal');
select is((select count(*) from public.rights_sessions where principal_id=(select principal from bx) and status='active'),0::bigint,
 'every rights session of the old principal ends');
select is((select count(*) from public.encrypted_contact_references where principal_id=(select principal from bx)
 and status<>'shredded'),0::bigint,'the old principal''s working contact copies are crypto-shredded');
select is((select count(*) from public.mail_outbox),(select n from outbox_before),'no notice or mail is enqueued');
select is((select count(*) from public.legal_audit_log where event_code='subject.account-bound'),1::bigint,'one audit event');
select throws_ok($$select pg_temp.bind('current','bind-nonce-again-0000000001')$$,'42501','not_found',
 'the ended session cannot bind again');

select * from finish();
rollback;
