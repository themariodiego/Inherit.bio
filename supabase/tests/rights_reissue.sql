-- api.rights-reissue (20261016208000_rights_reissue.sql; owner decision
-- 2026-10-22). Synthetic accounts and rows only. Everything rolls back.
--
-- Proves that:
--   * only the service role, and only under TEST-LOCAL, reaches the door;
--   * the owner's limits are counted first: 3 an hour per contact, 10 an
--     hour per network and 1000 an hour for the whole service; a limited
--     request writes no candidate; the form nonce is spent once;
--   * only an active principal with no account (account_id is null) whose
--     record is current and has a live 730-day clock is matched; it gets one
--     hash-only candidate bound to its purpose, target, revision and
--     existing deadline, and a new request replaces it;
--   * no outbox row, token, source credential or session is created or
--     touched by a request;
--   * the patched activation exchanges an issued recovery candidate only once
--     its eventual session purpose can be issued, revoking nothing before,
--     and every other token keeps the existing path.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';

-- One person confirms with no account, one with their own account.
select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','reissue-token-aaaaaaaaaaaaaaaa'),'accepted','fixture: the person signs with no account');
select pg_temp.requested('acct','c',repeat('c',64));
select is(pg_temp.account_confirms('c','reissue-sign-cccccccccccccccccc','2',repeat('c',64)),'accepted',
 'fixture: another person signs with their own account');

create function pg_temp.d(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1',encode(extensions.digest('rights-reissue-test:'||p,'sha256'),'hex')) $$;
create function pg_temp.ask(p_contact text,p_form text,p_identifier text default 'id-a',p_network text default 'net-a',
 p_flag boolean default true) returns text language sql volatile as $$
 select public.request_rights_reissue_v1(encode(extensions.digest('form:'||p_form,'sha256'),'hex'),
  jsonb_build_object('1',p_contact),pg_temp.d(p_identifier),pg_temp.d(p_network),pg_temp.d('global'),p_flag) $$;
create function pg_temp.live() returns setof private.rights_recovery_candidates language sql as $$
 select * from private.rights_recovery_candidates where status in ('pending','issued') $$;
create temporary table before_counts as select (select count(*) from public.mail_outbox) mail,
 (select count(*) from public.token_hashes) tokens, (select count(*) from public.rights_sessions) sessions,
 (select count(*) from public.token_candidates) token_candidates;

-- 0. Admission ------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('authenticated','public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('anon','public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('service_role','private.activate_rights_recovery_v1(text,text,text)','execute')
 and not has_function_privilege('service_role','private.rights_recovery_target_v1(uuid)','execute')
 and not has_table_privilege('service_role','private.rights_recovery_candidates','select')
 and not has_table_privilege('authenticated','private.rights_recovery_candidates','select'),
 'only the service role reaches the request door, and nobody reads candidates directly');
select throws_ok($$select pg_temp.ask(repeat('a',64),'no-role')$$,'42501','not_found','a caller that is not the service role is refused');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select pg_temp.ask(repeat('a',64),'no-flag',p_flag=>false)$$,'42501','not_found',
 'outside the test jurisdiction the door refuses');
select is((select md5(prosrc) from pg_proc where oid='public.activate_rights_session_v1(text,text,text)'::regprocedure),
 'f4c47723ec1c65454514a5b8d08ec0e0','the activation carries the pinned recovery branch');

-- 1. Before a confirmed file the record has no deadline: nothing is reissued ----
select is(pg_temp.ask(repeat('a',64),'before'),'received','a request is received');
select is((select count(*) from pg_temp.live()),0::bigint,'with no live 730-day clock no candidate is written');

-- 2. A confirmed file: one candidate ----------------------------------------------
select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64));
select is(pg_temp.notice_session('nb','1'),1::bigint,'fixture: the file notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'reissue-confirm-11111111111111','confirm'),'confirmed',
 'fixture: the person says yes, and its 730-day clock starts');
create temporary table base_counts as select (select count(*) from public.mail_outbox) mail,
 (select count(*) from public.token_hashes) tokens, (select count(*) from public.rights_sessions) sessions,
 (select count(*) filter (where status='active') from public.rights_sessions) active_sessions;
select is(pg_temp.ask(repeat('a',64),'first',p_identifier=>'id-b'),'received','the matched request is received the same way');
select is((select count(*) from pg_temp.live()),1::bigint,'one live candidate is written');
select ok((select c.principal_id=p.id and c.eventual_purpose='adult-subject-control' and c.target_kind='subject'
  and c.target_id=pg_temp.sid('nb') and c.authority_revision=p.principal_revision and c.status='pending'
  and c.token_hash_id is null and c.fixed_deadline=rr.fixed_deadline and c.expires_at<=c.created_at+interval '24 hours'
  and c.expires_at<=c.fixed_deadline
 from pg_temp.live() c join public.subject_principals p on p.subject_id=pg_temp.sid('nb') and p.principal_kind='non_account_subject'
 join public.retention_rows rr on rr.retention_id='adult.non-account-holder-24mo' and rr.state='scheduled'
  and rr.target_id=pg_temp.fxv('nb','upload')::uuid),
 'the candidate is hash-free, non-authorizing and bound to the principal, purpose, target, revision and existing deadline');
select ok((select count(*) from public.mail_outbox)=(select mail from base_counts)
  and (select count(*) from public.token_hashes)=(select tokens from base_counts)
  and (select count(*) from public.rights_sessions)=(select sessions from base_counts)
  and (select count(*) filter (where status='active') from public.rights_sessions)=(select active_sessions from base_counts),
 'no outbox row, token or session is created or ended');
select is(pg_temp.ask(repeat('a',64),'first',p_identifier=>'id-b'),'replayed','a form nonce is spent once');
create temporary table first_candidate as select id from pg_temp.live();
select is(pg_temp.ask(repeat('a',64),'second',p_identifier=>'id-c'),'received','a second request is received');
select ok((select count(*)=1 and min(id::text)<>(select id::text from first_candidate) from pg_temp.live())
  and (select status='replaced' and ended_at is not null from private.rights_recovery_candidates where id=(select id from first_candidate)),
 'it replaces the live candidate: one live candidate per principal');

-- 3. Nothing else matches ---------------------------------------------------------
select is(pg_temp.ask(repeat('c',64),'account',p_identifier=>'id-d'),'received','a principal with an account is answered the same way');
select is(pg_temp.ask(repeat('e',64),'nobody',p_identifier=>'id-e'),'received','an unknown address is answered the same way');
select is((select count(*) from private.rights_recovery_candidates),2::bigint,
 '... and neither writes a candidate: only principals whose account_id is null are matched');

-- 4. The limits -------------------------------------------------------------------
create temporary table live_now as select id from pg_temp.live();
select is(pg_temp.ask(repeat('a',64),'contact-1',p_identifier=>'id-limit',p_network=>'net-l1'),'received','contact 1 of 3');
select is(pg_temp.ask(repeat('a',64),'contact-2',p_identifier=>'id-limit',p_network=>'net-l1'),'received','contact 2 of 3');
select is(pg_temp.ask(repeat('a',64),'contact-3',p_identifier=>'id-limit',p_network=>'net-l1'),'received','contact 3 of 3');
delete from live_now; insert into live_now select id from pg_temp.live();
select is(pg_temp.ask(repeat('a',64),'contact-4',p_identifier=>'id-limit',p_network=>'net-l1'),'received',
 'the fourth request for one contact in an hour is answered the same way');
select is((select id from pg_temp.live()),(select id from live_now),'... and writes nothing: 3 an hour per contact');
select is((select count(*) from generate_series(1,9) n where pg_temp.ask(repeat('e',64),'network-'||n,p_identifier=>'id-n'||n,
 p_network=>'net-l2')='received'),9::bigint,'nine requests from one network');
select is(pg_temp.ask(repeat('a',64),'network-10',p_identifier=>'id-n10',p_network=>'net-l2'),'received','the tenth is admitted');
delete from live_now; insert into live_now select id from pg_temp.live();
select is(pg_temp.ask(repeat('a',64),'network-11',p_identifier=>'id-n11',p_network=>'net-l2'),'received',
 'the eleventh from one network is answered the same way');
select is((select id from pg_temp.live()),(select id from live_now),'... and writes nothing: 10 an hour per network');
update public.rate_limit_hmac_buckets set request_count=1000
 where action_id='api.rights-reissue' and dimension='global-capacity' and bucket_key_hmac=pg_temp.d('global')->>'1';
select is(pg_temp.ask(repeat('a',64),'global',p_identifier=>'id-g',p_network=>'net-g'),'received',
 'past 1000 an hour for the service, a request is answered the same way');
select is((select id from pg_temp.live()),(select id from live_now),'... and writes nothing: the global cap');
select ok((select bool_and(limit_count=case dimension when 'normalized-identifier' then 3 when 'source-network' then 10
  else 1000 end) from public.rate_limit_hmac_buckets where action_id='api.rights-reissue'),
 'every bucket carries the owner''s ceiling');

-- 5. Activation of a recovery candidate ------------------------------------------------
-- A synthetic delivered token stands in for the mail issuer that does not exist.
create temporary table delivered as select gen_random_uuid() outbox_id, gen_random_uuid() token_candidate_id,
 gen_random_uuid() token_id, encode(extensions.digest('rights-reissue-raw-token','sha256'),'hex') token_hash;
insert into public.mail_outbox(id,template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
 recipient_authority_revision,semantic_revision,idempotency_key,expires_at,state)
select d.outbox_id,'rights-recovery','rights-recovery','subject',c.target_id,c.principal_id,
 (select id from public.encrypted_contact_references where principal_id=c.principal_id and status='current' limit 1),
 c.authority_revision,1,encode(extensions.digest('rights-reissue-outbox','sha256'),'hex'),clock_timestamp()+interval '1 day','submitted'
from delivered d cross join pg_temp.live() c;
insert into public.token_candidates(id,outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
select d.token_candidate_id,d.outbox_id,'rights-recovery','subject',c.target_id,c.authority_revision,'issued',c.expires_at
from delivered d cross join pg_temp.live() c;
insert into public.token_hashes(id,candidate_id,token_hash,token_revision)
select d.token_id,d.token_candidate_id,d.token_hash,c.authority_revision from delivered d cross join pg_temp.live() c;
update private.rights_recovery_candidates set status='issued',token_hash_id=(select token_id from delivered)
 where id=(select id from live_now);
create function pg_temp.activate(p_session text,p_form text) returns bigint language sql volatile as $$
 select count(*) from public.activate_rights_session_v1((select token_hash from delivered),repeat(p_session,64),p_form) $$;
select is(pg_temp.activate('7','reissue-activate-form-0000001'),0::bigint,
 'while the adult-subject-control issuer does not exist, a delivered candidate opens nothing');
select ok((select status='issued' from private.rights_recovery_candidates where id=(select id from live_now))
  and (select status='current' from public.token_hashes where id=(select token_id from delivered))
  and not exists(select 1 from public.embryo_operation_nonces where nonce_hash=encode(extensions.digest('reissue-activate-form-0000001','sha256'),'hex')),
 '... and spends, consumes and revokes nothing');
insert into private.rights_session_purposes(session_purpose,matrix_purpose,invitation_kind,target_kind)
values ('adult-subject-control','adult-subject-control',null,'subject');
update public.subject_principals set principal_revision=principal_revision+1
 where subject_id=pg_temp.sid('nb') and principal_kind='non_account_subject';
select is(pg_temp.activate('7','reissue-activate-form-0000002'),0::bigint,'a stale authority revision opens nothing');
update public.subject_principals set principal_revision=principal_revision-1
 where subject_id=pg_temp.sid('nb') and principal_kind='non_account_subject';
create temporary table activated as select * from public.activate_rights_session_v1((select token_hash from delivered),
 repeat('8',64),'reissue-activate-form-0000003');
select ok((select count(*)=1 and min(purpose)='adult-subject-control' and min(target_kind)='subject'
  and min(target_id::text)=pg_temp.sid('nb')::text from activated),
 'once its issuer exists, the candidate is exchanged for one adult-subject-control session');
select ok((select rs.status='active' and rs.principal_id=c.principal_id and rs.authority_revision=c.authority_revision
  and rs.expires_at<=least(rs.created_at+interval '60 minutes',c.fixed_deadline) and rs.token_hash_id=(select token_id from delivered)
 from public.rights_sessions rs join private.rights_recovery_candidates c on c.id=(select id from live_now)
 where rs.session_hash=repeat('8',64)),'the session is purpose-bound and clamped to an hour and the existing deadline');
select ok((select status='consumed' from private.rights_recovery_candidates where id=(select id from live_now))
  and (select status='consumed' from public.token_hashes where id=(select token_id from delivered))
  and (select count(*)=0 from pg_temp.live()),'the token and candidate are consumed, and no other candidate stays live');
select is(pg_temp.activate('9','reissue-activate-form-0000004'),0::bigint,'a consumed recovery token opens nothing');

select * from finish();
rollback;
