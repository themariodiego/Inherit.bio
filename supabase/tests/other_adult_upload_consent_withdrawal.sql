-- The uploader's withdrawal of consent for another adult's file (migration
-- 20261119160000_other_adult_upload_consent_withdrawal; owner decision of 19
-- November 2026, "An uploader's withdrawal for another adult's file deletes
-- it, unless that adult holds the record themselves"). With no account of
-- the person's own on the record, the uploader's whole-record delete runs
-- unchanged and the person gets a notice, unless barred. On a record the
-- person holds with their own account the withdrawal hands the record to the
-- person through the transfer, open since 20261122120000 (owner decisions of
-- 22 November 2026; supabase/tests/uploader_withdrawal_hand_over.sql and
-- subject_transfer_open.sql drive it in full); here it is probed and undone.
-- Synthetic accounts, HMACs and files only. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
update private.invitation_terminal_notices set state='expired',contact_ciphertext=null,recipient_account_id=null
 where state='pending';
update public.mail_outbox set state='invalidated' where invitation_terminal_notice_id is not null and state in ('queued','claimed');

-- Two Path B people: one signs with no account, one with their own account.
select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','wd-token-aaaaaaaaaaaaaaaaaaaaa'),'accepted','fixture: (nb) the person signs with no account');
select pg_temp.requested('acct','c',repeat('c',64));
select is(pg_temp.account_confirms('c','wd-sign-cccccccccccccccccccccc','2',repeat('c',64)),'accepted',
 'fixture: (acct) the person signs with their own account');
select is((select h->>'status' from (select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64)) h) x),'stored_quarantined',
 'fixture: (nb) a first file is held');
select is(pg_temp.notice_session('nb','1'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'wd-confirm-1111111111111111111','confirm'),'confirmed',
 'fixture: (nb) the person confirms the first file');
select is((select h->>'status' from (select pg_temp.hold('nb-2',pg_temp.sid('nb'),repeat('e',64)) h) x),'stored_quarantined',
 'fixture: (nb) a second file is held and not yet confirmed');
select is((select h->>'status' from (select pg_temp.hold('acct',pg_temp.sid('acct'),repeat('f',64)) h) x),'stored_quarantined',
 'fixture: (acct) a file is held');
select is(pg_temp.notice_session('acct','2'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'wd-confirm-2222222222222222222','confirm',pg_temp.a('2')),
 'confirmed','fixture: (acct) the person confirms it with their account');
select is((select h->>'status' from (select pg_temp.hold('acct-2',pg_temp.sid('acct'),repeat('9',64)) h) x),'stored_quarantined',
 'fixture: (acct) a second file is held and not yet confirmed');
select ok((select owner_account_id=pg_temp.a('1') and subject_account_id=pg_temp.a('2') from public.subjects where id=pg_temp.sid('acct'))
 and (select owner_account_id=pg_temp.a('1') and subject_account_id is null from public.subjects where id=pg_temp.sid('nb')),
 'fixture: the uploader owns both records and the person holds one with their own account');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('other-adult-withdrawal:'||p,'sha256'),'hex') $$;
create function pg_temp.wd(p_account text, p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select public.withdraw_other_adult_upload_v1(pg_temp.a(p_account), pg_temp.s(p_account), p_subject, pg_temp.h(p_code),
   clock_timestamp() + interval '5 minutes') $$;
create function pg_temp.del(p_account text, p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(pg_temp.a(p_account), pg_temp.s(p_account), p_subject, pg_temp.h(p_code),
   clock_timestamp() + interval '5 minutes') $$;
create function pg_temp.ready(p_account text, p_subject uuid) returns text language sql stable as
 $$ select public.other_adult_withdrawal_readiness_v1(pg_temp.a(p_account), p_subject) $$;
-- D-161: each count reads only this suite's own rows (its records' requests,
-- its synthetic accounts' codes), so rows earlier local runs committed to a
-- shared database are not counted; on a fresh database nothing changes.
create function pg_temp.mine(p_invitation uuid) returns boolean language sql as
 $$ select p_invitation in (select pg_temp.invitation_of(subject_id) from fx) $$;
create function pg_temp.notices() returns bigint language sql as
 $$ select count(*) from private.invitation_terminal_notices where notice_kind='upload-permission-withdrawn'
   and pg_temp.mine(invitation_id) $$;
create function pg_temp.codes() returns bigint language sql as
 $$ select count(*) from public.account_operation_nonces where operation='subject_delete'
   and account_id in (select pg_temp.a(x) from unnest(array['1','2','3','4','9']) x) $$;
-- Runs a setup and a call, reads one observation, then undoes all three.
create function pg_temp.probe(p_setup text,p_call text,p_observe text default 'select null::text')
returns text language plpgsql as $$
declare v_result text; v_observed text;
begin
 begin
  execute p_setup;
  begin
   execute p_call into v_result;
  exception when others then v_result:=sqlstate||' '||sqlerrm;
  end;
  execute p_observe into v_observed;
  raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return coalesce(v_result,'')||coalesce(' / '||v_observed,'');
end $$;
create temporary table before_state as select
 (select contact_ciphertext from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
   where sp.subject_id=pg_temp.sid('nb') and sp.principal_kind='non_account_subject' and e.status='current') ciphertext,
 (select id from public.subject_invitations where target_kind='subject' and target_id=pg_temp.sid('nb') and status='accepted') invitation,
 (select invitation_revision from public.subject_invitations where target_kind='subject' and target_id=pg_temp.sid('nb') and status='accepted') revision,
 (select sc.id from public.subject_consents sc where sc.subject_id=pg_temp.sid('nb') and sc.account_id=pg_temp.a('1')
   and sc.consent_type='upload_class' and sc.revoked_at is null) consent,
 (select sc.signature_id from public.subject_consents sc where sc.subject_id=pg_temp.sid('nb') and sc.account_id=pg_temp.a('1')
   and sc.consent_type='upload_class' and sc.revoked_at is null) signature;
grant select on before_state to service_role;
select ok((select ciphertext is not null and invitation is not null and consent is not null from before_state),
 'fixture: the person''s contact, accepted request and the uploader''s live consent are on record');

-- Privileges --------------------------------------------------------------------
select is((select proacl::text from pg_proc where oid='public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','only the service role may run the door');
select is((select proacl::text from pg_proc where oid='public.other_adult_withdrawal_readiness_v1(uuid,uuid)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','only the service role may run the page''s read');
select ok(not has_function_privilege('authenticated','public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.other_adult_withdrawal_readiness_v1(uuid,uuid)','execute'),
 'no browser role may run either');

-- The page's read ---------------------------------------------------------------
select is(pg_temp.ready('1',pg_temp.sid('nb')),'ready','the uploader may withdraw for a person with no account of their own');
select is(pg_temp.ready('1',pg_temp.sid('acct')),'hand-over',
 'the read names the own-account branch: with the transfer open (20261122120000), a hand-over');
select throws_ok($$select pg_temp.ready('9',pg_temp.sid('nb'))$$,'42501','not_found','an outsider reads nothing');
select throws_ok($$select pg_temp.ready('2',pg_temp.sid('acct'))$$,'42501','not_found',
 'the person holding the record is not its uploader');
select is(pg_temp.probe($$delete from public.invitation_candidates where invitation_id=(select invitation from before_state);
  delete from public.subject_invitations where id=(select invitation from before_state)$$,
  $$select pg_temp.ready('1',pg_temp.sid('nb'))$$),'unsupported','a record whose notice cannot be addressed reads unsupported');

-- Refusals, before anything is written --------------------------------------------
select throws_ok($$select public.withdraw_other_adult_upload_v1(null,pg_temp.s('1'),pg_temp.sid('nb'),pg_temp.h('null'),clock_timestamp()+interval '5 minutes')$$,
 '42501','not_found','no account, no withdrawal');
select throws_ok($$select pg_temp.wd('9',pg_temp.sid('nb'),'outsider')$$,'42501','not_found','an outsider cannot withdraw');
select throws_ok($$select pg_temp.wd('2',pg_temp.sid('acct'),'person')$$,'42501','not_found',
 'the person cannot use the uploader''s withdrawal on their own record');
select is(pg_temp.probe('select 1',$$select pg_temp.wd('1',pg_temp.sid('acct'),'account-held')::text$$,
  $$select owner_account_id::text from public.subjects where id=pg_temp.sid('acct')$$),
 '{"case": "adult"} / '||pg_temp.a('2')::text,
 'the own-account branch hands the record to the person through the transfer (probed, then undone)');
select throws_ok($$select pg_temp.del('1',pg_temp.sid('acct'),'direct')$$,'42501','not_found',
 'and the uploader can no longer delete that record through the delete door either');
select is(pg_temp.probe($$delete from public.invitation_candidates where invitation_id=(select invitation from before_state);
  delete from public.subject_invitations where id=(select invitation from before_state)$$,
  $$select pg_temp.wd('1',pg_temp.sid('nb'),'unaddressed')$$,
  $$select (select lifecycle from public.subjects where id=pg_temp.sid('nb'))||' '||pg_temp.codes()$$),
 '55000 withdrawal_notice_unavailable / active 0','a notice that cannot be addressed refuses the whole withdrawal');
select ok(pg_temp.codes()=0 and pg_temp.notices()=0
 and (select lifecycle from public.subjects where id=pg_temp.sid('acct'))='active'
 and (select lifecycle from public.subjects where id=pg_temp.sid('nb'))='active'
 and (select count(*) from public.subject_consents where id=(select consent from before_state) and revoked_at is null)=1
 and (select count(*) from public.other_adult_held_uploads where subject_id in (pg_temp.sid('nb'),pg_temp.sid('acct'))
  and state in ('pending','confirmed'))=4,
 'a refused withdrawal records no code, queues no notice and changes no record, file or consent');

-- A barred contact: the delete runs, no notice is queued ----------------------------
select is(pg_temp.probe($$insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at)
  values(repeat('a',64),'subject',gen_random_uuid(),1,clock_timestamp()+interval '1 day')$$,
  $$select pg_temp.wd('1',pg_temp.sid('nb'),'barred')::text$$,
  $$select (select lifecycle from public.subjects where id=pg_temp.sid('nb'))||' '||pg_temp.notices()$$),
 '{"case": "adult"} / purged 0','a barred contact is never written to, and the withdrawal still deletes');

-- The withdrawal ----------------------------------------------------------------
set local role service_role;
create temporary table withdrawal as select pg_temp.wd('1',pg_temp.sid('nb'),'withdraw') body;
reset role;
select is((select body from withdrawal),'{"case":"adult"}'::jsonb,'the withdrawal is accepted as the adult case');
select ok((select lifecycle='purged' and subject_account_id is null from public.subjects where id=pg_temp.sid('nb')),
 'the record is purged');
select is((select array_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('nb')),
 array['withdrawn','withdrawn'],'every file the uploader added ends, the confirmed one and the unconfirmed one');
select ok((select revoked_at is not null and revocation_reason='withdrawn' from public.subject_consents where id=(select consent from before_state)),
 'the uploader''s upload consent is marked withdrawn and kept');
select is((select count(*) from public.consent_signatures where id=(select signature from before_state)),1::bigint,
 'the uploader''s signature is kept');
select is((select count(*) from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
  where sp.subject_id=pg_temp.sid('nb') and (e.status<>'shredded' or e.contact_ciphertext is not null)),0::bigint,
 'the record''s contact is shredded');
select is((select count(*) from public.contact_refusal_bars where target_kind='subject' and target_id=pg_temp.sid('nb')),0::bigint,
 'an uploader''s withdrawal writes no subject-controlled bar');
select is((select count(*) from public.account_operation_nonces where operation='subject_delete' and nonce_hash=pg_temp.h('withdraw')),1::bigint,
 'the one-time code is spent');
select ok((select audit_principal_id is not null from public.legal_audit_log where event_code='subject.deleted'
  and route_id='api.subject-delete' and outcome_code='withdrawn' order by seq desc limit 1),
 'the delete''s audit event records the withdrawal and names the uploader');

-- The notice --------------------------------------------------------------------
select is(pg_temp.notices(),1::bigint,'exactly one notice is queued');
select ok((select n.invitation_id=(select invitation from before_state) and n.recipient_kind='contact'
  and n.contact_ciphertext=(select ciphertext from before_state) and n.recipient_account_id is null
  and n.recipient_authority_revision=(select revision from before_state) and n.state='pending'
  and n.expires_at=n.created_at+interval '7 days'
  and n.idempotency_key=encode(extensions.digest(convert_to('upload-permission-withdrawn-v1|'||pg_temp.sid('nb')::text||'|'
   ||pg_temp.h('withdraw'),'UTF8'),'sha256'),'hex')
  from private.invitation_terminal_notices n where n.notice_kind='upload-permission-withdrawn' and pg_temp.mine(n.invitation_id)),
 'to the person''s own sealed contact, bound to the request they accepted, for seven days, keyed by the spent code');
select ok((select m.template_id='invitation-terminal-notice' and m.purpose='invitation-terminal-notice'
  and m.template_payload='{"kind":"upload-permission-withdrawn"}'::jsonb and m.target_kind='subject_invitation'
  and m.target_id=(select invitation from before_state) and m.state='queued' and m.token_purpose is null
  and m.recipient_principal_id is null and m.contact_reference_id is null
  from public.mail_outbox m join private.invitation_terminal_notices n on n.id=m.invitation_terminal_notice_id
  where n.notice_kind='upload-permission-withdrawn' and pg_temp.mine(n.invitation_id)),
 'its one mail row carries only the kind: no token, principal, contact reference, name or file');
select is(pg_temp.probe('select 1',
  $$select (select notice_kind||' '||(contact_ciphertext=(select ciphertext from before_state))::text
    from public.claim_invitation_terminal_mail_v1())$$,
  $$select public.authorize_invitation_terminal_mail_v1(m.id,m.attempt_count)::text from public.mail_outbox m
    join private.invitation_terminal_notices n on n.id=m.invitation_terminal_notice_id where n.notice_kind='upload-permission-withdrawn'
    and pg_temp.mine(n.invitation_id)$$),
 'upload-permission-withdrawn true / true','the terminal mail worker claims it with the sealed contact and may send it');
select is(pg_temp.probe($$insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at)
  values(repeat('a',64),'subject',gen_random_uuid(),1,clock_timestamp()+interval '1 day')$$,
  $$select count(*)::text from public.claim_invitation_terminal_mail_v1()$$,
  $$select (select n.state||' '||(n.contact_ciphertext is null)::text||' '||m.state from private.invitation_terminal_notices n
    join public.mail_outbox m on m.invitation_terminal_notice_id=n.id where n.notice_kind='upload-permission-withdrawn'
    and pg_temp.mine(n.invitation_id))$$),
 '0 / expired true invalidated','a contact barred after the withdrawal is never written to, and its copy is cleared');
select is(pg_temp.probe('select 1',$$select (select count(*) from public.claim_invitation_terminal_mail_v1())::text$$,
  $$select private.invitation_notice_recipient_current_v1(id)::text from private.invitation_terminal_notices
    where notice_kind='invitation-refused' and pg_temp.mine(invitation_id) limit 1$$),'1','the other notice kinds read as before');

-- A replay ------------------------------------------------------------------------
select throws_ok($$select pg_temp.wd('1',pg_temp.sid('nb'),'withdraw')$$,'42501','not_found','a replay finds no record');
select is(pg_temp.notices(),1::bigint,'and queues no second notice');

-- The record its person holds is untouched ------------------------------------------
select ok((select lifecycle='active' and subject_account_id=pg_temp.a('2') and owner_account_id=pg_temp.a('1')
  from public.subjects where id=pg_temp.sid('acct'))
 and (select array_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('acct'))
  =array['confirmed','pending']
 and exists(select 1 from public.subject_consents where subject_id=pg_temp.sid('acct') and account_id=pg_temp.a('1')
  and consent_type='upload_class' and revoked_at is null)
 and exists(select 1 from public.subject_principals where subject_id=pg_temp.sid('acct') and account_id=pg_temp.a('2')
  and principal_kind='account_subject' and status='active'),
 'the record the person holds, its files, its principal and the uploader''s consent on it are unchanged');
-- The person's own delete is unchanged by the patch.
set local role service_role;
create temporary table person_delete as select pg_temp.del('2',pg_temp.sid('acct'),'person-own') body;
reset role;
select is((select body from person_delete),'{"case":"adult"}'::jsonb,'the person''s own delete still runs');
select is((select array_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('acct')),
 array['deleted','deleted'],'and ends every file as deleted by the person');
select is(pg_temp.notices(),1::bigint,'the person''s own delete queues no withdrawal notice');

-- Bodies --------------------------------------------------------------------------
select is((select md5(pg_get_functiondef(oid)) from pg_proc where oid='private.delete_path_b_subject_for_route_v1(uuid,text)'::regprocedure),
 'f30283fb54afaf87da2462c9a469c85f','the Path B delete it runs is unchanged');
select is((select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure),
 'e994afb4410ad008aa959efc65726895','the delete door is the reviewed successor');

select * from finish();
rollback;
