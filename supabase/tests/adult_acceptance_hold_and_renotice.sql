-- D-141: the 72-hour hold on an account created from an invitation, the
-- second notice at 72 hours and the re-notice at 30 days
-- (20261120120000_adult_acceptance_hold_and_renotice.sql; register
-- other-adult-mitigation-state-v1 and adult-subject-confirmation-v1, coded to
-- under the owner's rule of 19 November 2026).
--
-- Proves, on synthetic rows only:
--   * the acceptance records the origin from the auth row and the invitation
--     row in its own transaction, for Path A and Path B's account branch: an
--     account that existed before the invitation starts the re-notice clock
--     only; any other starts the 72-hour hold too; rewriting the auth row
--     later changes nothing;
--   * an account created from the invitation is denied at 71 hours 59
--     minutes, still denied at 72 hours until the second notice is accepted
--     by the provider, released once it is, and never released when the
--     notice is not sent; an existing account is never held; an acceptance
--     recorded before the migration keeps the old comparison and is never
--     released; a public-appeal hold still denies after a release;
--   * the person's own analysis and derived reads wait out the hold, their
--     own rights never do; Path A's own record is found and follows the same
--     clock, and nobody else is found on it;
--   * each notice is queued once, at its deadline, to the person's account,
--     and never after the record was deleted, transferred or its address
--     barred, before or after it was queued; a re-notice holds the uploader
--     from 30 days until it is accepted;
--   * every checkpoint caller asks the decision: the result read, the
--     person's choices, the account export and the normalization enqueue
--     answer the hold, and a file confirmed during the hold is normalized
--     once the hold is released;
--   * the patched bodies carry their pinned successors and privileges.
-- Time is moved only by ageing one synthetic acceptance's own rows. Everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

-- Four more people with an account and a current declaration: 05, 06, 07, 08.
insert into auth.users(id,email,raw_user_meta_data)
 select ('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,'acct-held-'||n||'@e2e.local','{"display_name":"Synthetic held"}'
 from unnest(array['5','6','7','8']) n;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('0b5e0000-0000-4000-8000-00000000001'||n)::uuid,('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['5','6','7','8']) n;
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id in ('0b5e0000-0000-4000-8000-000000000005','0b5e0000-0000-4000-8000-000000000006',
   '0b5e0000-0000-4000-8000-000000000007','0b5e0000-0000-4000-8000-000000000008');
-- Every account predates this suite's requests by a day, with a confirmed
-- address (the notice queue writes only to a confirmed one), until moved.
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now()-interval '1 day'
 where id::text like '0b5e0000-%';

-- Helpers ---------------------------------------------------------------------
create function pg_temp.m(p_name text,p_account text,p_checkpoint text default 'route-read-before-fetch') returns text
language sql as $$
 select (private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'decision')
  ||':'||coalesce(private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'gate','-')
$$;
create function pg_temp.inv(p_name text) returns uuid language sql as $$ select pg_temp.invitation_of(pg_temp.sid(p_name)) $$;
-- The clock of one class on one acceptance: row state and phase status, or none.
create function pg_temp.clock(p_name text,p_class text) returns text language sql as $$
 select coalesce((select r.state||':'||d.status from public.retention_rows r
  join public.retention_due_phases d on d.retention_row_id=r.id
  where r.retention_id=p_class and r.target_kind='invitation' and r.target_id=pg_temp.inv(p_name)),'none')
$$;
-- Time passing for one acceptance: its acceptance and its fixed deadlines move back together.
create function pg_temp.age(p_name text,p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by,terminal_at=terminal_at-p_by where id=pg_temp.inv(p_name);
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
$$;
create function pg_temp.notices(p_name text,p_kind text) returns bigint language sql as $$
 select count(*) from private.invitation_terminal_notices where invitation_id=pg_temp.inv(p_name) and notice_kind=p_kind
$$;
-- The terminal mail worker, as src/lib/embryos/invitation-terminal-mail.ts drives it: claim, authorize,
-- complete. Answers sent, refused (claimed but not authorized) or none (never claimed).
create function pg_temp.deliver(p_name text,p_kind text) returns text language plpgsql as $$
declare c record; n integer;
begin
 for n in 1..20 loop
  select * into c from public.claim_invitation_terminal_mail_v1();
  if c.outbox_id is null then return 'none'; end if;
  if c.notice_kind=p_kind and exists(select 1 from public.mail_outbox m where m.id=c.outbox_id
    and m.target_id=pg_temp.inv(p_name)) then
   if c.recipient_account_id is distinct from (select subject_account_id from public.subjects where id=pg_temp.sid(p_name))
    or c.contact_ciphertext is not null then return 'wrong-recipient'; end if;
   if not public.authorize_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal) then return 'refused'; end if;
   perform public.complete_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal,true,
    encode(extensions.digest(convert_to('provider:'||c.outbox_id::text,'UTF8'),'sha256'),'hex'));
   return 'sent';
  end if;
 end loop;
 return 'none';
end $$;
create function pg_temp.all_checkpoints(p_name text,p_account text) returns text language sql as $$
 select string_agg(distinct pg_temp.m(p_name,p_account,c),',') from unnest(array['purpose-grant-create','route-read-before-fetch',
  'model-context-before-retrieval','analysis-enqueue','worker-claim','source-read-and-every-bounded-range',
  'derived-write-and-read','export-create','export-source-read','download-session-create','every-download-chunk']) c
$$;

-- 0. The migration ---------------------------------------------------------------
-- 20261122170000 (D-154) widens the decision's Path B lookup to both Path B
-- flows, patched in place from exactly this suite's successor; with it
-- applied the pin follows its successor. Every other line of the body is this
-- migration's, and the rest of this suite runs on it unchanged.
select is((select string_agg(x.label||' '||md5(pg_get_functiondef(p.oid))||' '||p.proacl::text,' | ' order by x.label)
 from (values
  ('a','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)'),
  ('b','private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)'),
  ('c','private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'),
  ('d','private.path_b_normalization_authority_v1(uuid,text)'),
  ('e','public.claim_invitation_terminal_mail_v1()'),
  ('f','public.authorize_invitation_terminal_mail_v1(uuid,smallint)')) x(label,signature)
 join pg_proc p on p.oid=x.signature::regprocedure),
 'a bb4234666d681aeb85f3d41ed9e5121a {postgres=X/postgres} | b 63c6c510a724cbe747af5db354cb344b {postgres=X/postgres} | '
 ||'c '||case when position('path-b-reviewed-document' in (select prosrc from pg_proc
  where oid='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure))>0
  then '85be478145319e0c69dad7575e262941' else '91dfb6e4abf766e3da6e5827d4381daf' end
 ||' {postgres=X/postgres} | d 591fc9f913fb7177ed86144a7ce654f4 {postgres=X/postgres} | '
 ||'e 3524eba4d0dd916bef2c4dac1e5c25cb {postgres=X/postgres,service_role=X/postgres} | '
 ||'f 5ba9fd2ef4bfa2c36ec0e2be4b97aeb5 {postgres=X/postgres,service_role=X/postgres}',
 'the six patched bodies carry their pinned successors and unchanged privileges');
select ok((select provolatile='s' and prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc
 where oid='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure),
 'the decision stays STABLE SECURITY DEFINER with its pinned search path');
select is((select string_agg(p.oid::regprocedure::text||' '||p.proacl::text,' | ' order by p.oid::regprocedure::text)
 from pg_proc p where p.oid in (to_regprocedure('private.start_adult_acceptance_clocks_v1(uuid)'),
  to_regprocedure('private.adult_acceptance_clock_state_v1(uuid)'),to_regprocedure('private.adult_acceptance_notice_current_v1(uuid)'),
  to_regprocedure('private.settle_adult_acceptance_notice_v1()'),to_regprocedure('public.run_due_adult_acceptance_notices_v1()'),
  to_regprocedure('public.adult_subject_acceptance_origin_v1(uuid,uuid)'))),
 'adult_subject_acceptance_origin_v1(uuid,uuid) {postgres=X/postgres,service_role=X/postgres} | '
 ||'private.adult_acceptance_clock_state_v1(uuid) {postgres=X/postgres} | '
 ||'private.adult_acceptance_notice_current_v1(uuid) {postgres=X/postgres} | '
 ||'private.settle_adult_acceptance_notice_v1() {postgres=X/postgres} | '
 ||'private.start_adult_acceptance_clocks_v1(uuid) {postgres=X/postgres} | '
 ||'run_due_adult_acceptance_notices_v1() {postgres=X/postgres,service_role=X/postgres}',
 'the six new functions: the executor and the origin read are service-only, the rest owner-only');
select ok(not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
  where has_function_privilege(r,'public.run_due_adult_acceptance_notices_v1()','execute')
   or has_function_privilege(r,'public.adult_subject_acceptance_origin_v1(uuid,uuid)','execute')),
 'no API role but the service role may run the executor or read an origin');
select is((select pg_get_triggerdef(oid) from pg_trigger where tgrelid='private.invitation_terminal_notices'::regclass
  and tgname='settle_adult_acceptance_notice'),
 'CREATE TRIGGER settle_adult_acceptance_notice AFTER DELETE OR UPDATE OF state ON private.invitation_terminal_notices '
 ||'FOR EACH ROW WHEN ((old.notice_kind = ANY (ARRAY[''adult-acceptance-second-notice''::text, ''adult-revocation-renotice''::text]))) '
 ||'EXECUTE FUNCTION private.settle_adult_acceptance_notice_v1()','the queue records the provider''s answer on the phase');
select ok((select pg_get_constraintdef(oid) like '%''adult-acceptance-second-notice''::text, ''adult-revocation-renotice''::text%'
 and pg_get_constraintdef(oid) like '%''upload-permission-withdrawn''::text%' from pg_constraint
 where conrelid='private.invitation_terminal_notices'::regclass and conname='invitation_terminal_notices_notice_kind_check'),
 'the queue takes the two new kinds and keeps the four it had');
select is((select pg_get_function_identity_arguments(oid) from pg_proc where oid='public.confirm_path_b_subject_account_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)'::regprocedure),
 'p_session_hash text, p_nonce text, p_artifact_version integer, p_artifact_body_sha256 text, p_statement_keys text[], p_signing_name_ciphertext bytea, p_account_id uuid, p_auth_session_id uuid, p_account_email_hmac text, p_test_jurisdiction boolean, p_account_email_hmac_set jsonb',
 'the Path B account door takes no origin field: the origin never comes from the request');

-- 1. Path B: one account that predates its request, four created after theirs -------
select pg_temp.requested('old','a',repeat('a',64));
select is(pg_temp.account_confirms('a','hold-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 '(old) a person whose account predates the request accepts');
select pg_temp.requested('new','c',repeat('c',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('4');
select is(pg_temp.account_confirms('c','hold-sign-ccccccccccccccccccc','4',repeat('c',64)),'accepted',
 '(new) a person whose account was created after the request accepts');
select pg_temp.requested('fail','e',repeat('e',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('5');
select is(pg_temp.account_confirms('e','hold-sign-eeeeeeeeeeeeeeeeeee','5',repeat('e',64)),'accepted','(fail) another, created after');
select pg_temp.requested('gone','f',repeat('f',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('6');
select is(pg_temp.account_confirms('f','hold-sign-fffffffffffffffffff','6',repeat('f',64)),'accepted','(gone) another, created after');
select pg_temp.requested('bar','d',repeat('d',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('7');
select is(pg_temp.account_confirms('d','hold-sign-ddddddddddddddddddd','7',repeat('d',64)),'accepted','(bar) another, created after');
select pg_temp.requested('rev','b',repeat('b',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('8');
select is(pg_temp.account_confirms('b','hold-sign-bbbbbbbbbbbbbbbbbbb','8',repeat('b',64)),'accepted','(rev) another, created after');

-- 2. What each acceptance recorded ---------------------------------------------------
select is(pg_temp.clock('old','adult.re-notice-30d')||' '||pg_temp.clock('old','adult.acceptance-hold-72h'),
 'scheduled:pending none','(old) an existing account starts the re-notice clock and no hold');
select is(pg_temp.clock('new','adult.re-notice-30d')||' '||pg_temp.clock('new','adult.acceptance-hold-72h'),
 'scheduled:pending scheduled:pending','(new) an account created after the request starts both');
select is((select d.immutable_envelope->>'accountOrigin' from public.retention_due_phases d
  where d.phase_id='adult-revocation-renotice' and d.target_id=pg_temp.inv('old'))||' '||
 (select d.immutable_envelope->>'accountOrigin' from public.retention_due_phases d
  where d.phase_id='adult-revocation-renotice' and d.target_id=pg_temp.inv('new')),
 'existing_account created_from_this_invitation','each re-notice phase names the origin it was decided with');
select ok((select r.fixed_deadline=i.accepted_at+interval '72 hours' and d.phase_deadline=r.fixed_deadline
  and d.recipient_authority_kind='subject-account' and r.target_lifecycle_revision>0
 from public.subject_invitations i join public.retention_rows r on r.retention_id='adult.acceptance-hold-72h'
  and r.target_kind='invitation' and r.target_id=i.id
 join public.retention_due_phases d on d.retention_row_id=r.id where i.id=pg_temp.inv('new')),
 '(new) the hold ends exactly 72 hours after the acceptance, fixed at acceptance');
select ok((select r.fixed_deadline=i.accepted_at+interval '30 days' and d.phase_deadline=r.fixed_deadline
 from public.subject_invitations i join public.retention_rows r on r.retention_id='adult.re-notice-30d'
  and r.target_kind='invitation' and r.target_id=i.id
 join public.retention_due_phases d on d.retention_row_id=r.id where i.id=pg_temp.inv('old')),
 '(old) the re-notice is due exactly 30 days after the acceptance');
select is(public.adult_subject_acceptance_origin_v1(pg_temp.a('2'),pg_temp.sid('old'))||' '||
 public.adult_subject_acceptance_origin_v1(pg_temp.a('4'),pg_temp.sid('new'))||' '||
 coalesce(public.adult_subject_acceptance_origin_v1(pg_temp.a('1'),pg_temp.sid('new')),'null'),
 'existing_account created_from_this_invitation null','the origin read answers only the record''s own account');

-- 3. An existing account is never held -----------------------------------------------
select is(pg_temp.all_checkpoints('old','1'),'allow:-','(old) its uploader is allowed at all eleven checkpoints at once');
select is(pg_temp.all_checkpoints('old','2'),'subject-own-right-only:-','(old) the person is never held');
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('2');
select is(pg_temp.m('old','1','analysis-enqueue'),'allow:-',
 '(old) rewriting the auth row after acceptance changes nothing: the origin was recorded when it committed');
update auth.users set created_at=now()-interval '1 day' where id=pg_temp.a('2');

-- 4. The hold --------------------------------------------------------------------
select is(pg_temp.all_checkpoints('new','1'),'deny:adult.acceptance-hold-72h',
 '(new) during the hold the uploader is denied at all eleven checkpoints');
select is(pg_temp.m('new','4','analysis-enqueue')||' '||pg_temp.m('new','4','derived-write-and-read')||' '||
 pg_temp.m('new','4','route-read-before-fetch')||' '||pg_temp.m('new','4','model-context-before-retrieval'),
 'deny:adult.acceptance-hold-72h deny:adult.acceptance-hold-72h deny:adult.acceptance-hold-72h deny:adult.acceptance-hold-72h',
 '(new) the person''s own analysis and derived reads wait too');
select is(pg_temp.m('new','4','purpose-grant-create')||' '||pg_temp.m('new','4','export-create')||' '||
 pg_temp.m('new','4','download-session-create')||' '||pg_temp.m('new','4','every-download-chunk'),
 'subject-own-right-only:- subject-own-right-only:- subject-own-right-only:- subject-own-right-only:-',
 '(new) the person''s own rights never wait');
select is(pg_temp.m('new','9'),'deny:not-found','(new) anyone else is not found');
update auth.users set created_at=now()-interval '2 days' where id=pg_temp.a('4');
select is(pg_temp.m('new','1'),'deny:adult.acceptance-hold-72h',
 '(new) rewriting the auth row after acceptance does not lift the recorded hold');
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('4');

-- The checkpoint callers answer the hold, and a file confirmed during it is not normalized.
create temporary table own_context as select private.own_upload_context_v1(pg_temp.a('1'),pg_temp.s('1'),s.id) c,s.id
 from public.subjects s where s.subject_class='self' and s.subject_account_id=pg_temp.a('1');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(repeat('9',64),pg_temp.a('1'),pg_temp.s('1'),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
select public.sign_own_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from own_context),
 'disclosure.insurance-and-discrimination',a.version,a.body_sha256,array['understood'],
 (c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
 (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat('9',64))
 from own_context,public.consent_artifacts a where a.artifact_key='disclosure.insurance-and-discrimination' and a.superseded_at is null;
select pg_temp.hold('new',pg_temp.sid('new'),repeat('e',64));
select pg_temp.notice_session('new','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'hold-confirm-1111111111111111','confirm',pg_temp.a('4')),
 'confirmed','(new) the person confirms a file during the hold');
select is((select analysis_state from public.other_adult_held_uploads where id=pg_temp.fxv('new','revision')::uuid)
 ||' '||(select count(*) from public.worker_jobs where subject_id=pg_temp.sid('new')),
 'confirmed_blocked_current_gate 0','analysis-enqueue: no normalization is queued during the hold');
select throws_ok($$select private.path_b_normalization_authority_v1(pg_temp.fxv('new','revision')::uuid,'worker-claim')$$,
 '42501','not_found','worker-claim: the normalization authority refuses during the hold');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('new'),'reports.monogenic')->>'gate',
 'adult.acceptance-hold-72h','route-read-before-fetch: the uploader''s result read stops at the hold');
select is(private.path_b_result_read_v1(pg_temp.a('4'),pg_temp.sid('new'),'reports.monogenic')->>'gate',
 'adult.acceptance-hold-72h','route-read-before-fetch: so does the person''s own');
select is((select x->'uploaderShare' from jsonb_array_elements(public.path_b_person_choices_v1(pg_temp.a('4'),pg_temp.s('4'),true)) x
  where x->>'subjectId'=pg_temp.sid('new')::text),'{"gate": "adult.acceptance-hold-72h", "decision": "deny"}'::jsonb,
 'purpose-grant-create: the person''s choices keep sharing with the uploader closed during the hold');
select throws_ok($$select private.account_archive_other_adult_export_gate_v1(pg_temp.sid('new'),pg_temp.a('1'))$$,
 '42501','not_found','export-create: the uploader''s account export leaves the record out during the hold');

-- 71 hours 59 minutes: still held, and the second notice is not yet due.
select pg_temp.age('new',interval '71 hours 59 minutes');
select is(public.run_due_adult_acceptance_notices_v1(),0,'at 71 hours 59 minutes nothing is due');
select is(pg_temp.notices('new','adult-acceptance-second-notice'),0::bigint,'(new) no second notice yet');
select is(pg_temp.m('new','1','analysis-enqueue'),'deny:adult.acceptance-hold-72h','(new) denied at 71 hours 59 minutes');
-- 72 hours: the notice is queued once; the hold stands until the provider accepts it.
select pg_temp.age('new',interval '1 minute');
select is(public.run_due_adult_acceptance_notices_v1(),1,'at 72 hours the second notice is queued');
select is(public.run_due_adult_acceptance_notices_v1(),0,'a second run queues nothing');
select is(pg_temp.notices('new','adult-acceptance-second-notice'),1::bigint,'(new) exactly one second notice');
select is((select recipient_kind||' '||(recipient_account_id=pg_temp.a('4'))::text||' '||(contact_ciphertext is null)::text
  from private.invitation_terminal_notices where invitation_id=pg_temp.inv('new')),
 'account true true','(new) addressed to the person''s account; no contact is copied');
select is(pg_temp.clock('new','adult.acceptance-hold-72h'),'active:claimed','(new) the hold waits on that notice');
select is(pg_temp.m('new','1','analysis-enqueue'),'deny:adult.acceptance-hold-72h',
 '(new) at 72 hours, with the notice queued but not accepted, the uploader is still denied');
select is(pg_temp.deliver('new','adult-acceptance-second-notice'),'sent','(new) the worker sends it to the account');
select is(pg_temp.clock('new','adult.acceptance-hold-72h'),'active:succeeded',
 '(new) the provider''s acceptance is recorded on the phase in the same transaction');
select is(pg_temp.all_checkpoints('new','1'),'allow:-','(new) released: the uploader is allowed at all eleven checkpoints');
select is(pg_temp.m('new','4','analysis-enqueue'),'subject-own-right-only:-','(new) the person''s own analysis may begin');
select is(pg_temp.deliver('new','adult-acceptance-second-notice'),'none','(new) a sent notice is never sent again');
-- The release retries the file confirmed during the hold.
select is(public.run_due_adult_acceptance_notices_v1(),0,'the next run queues no notice');
select is(pg_temp.clock('new','adult.acceptance-hold-72h'),'complete:succeeded','(new) and closes the released hold');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('new') and output_kind='ingest.normalize'
  and source_binding_id=pg_temp.fxv('new','revision')::uuid),1::bigint,
 '(new) the file confirmed during the hold is queued for normalization once released');
select isnt((select analysis_state from public.other_adult_held_uploads where id=pg_temp.fxv('new','revision')::uuid),
 'confirmed_blocked_current_gate','(new) and is no longer blocked');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('new'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','(new) the uploader''s read now stops only at the person''s own grant');
select ok((private.account_archive_other_adult_export_gate_v1(pg_temp.sid('new'),pg_temp.a('1'))->>'path')='path-b',
 '(new) the account export includes the record again');
-- A public-appeal hold still denies after a release: the wrapper asks it first (stand-in, rolled back).
savepoint before_appeal_stand_in;
create or replace function private.public_appeal_target_held_v1(p_kind text,p_target uuid) returns boolean
 language sql stable set search_path='' as $$ select p_kind='subject' and p_target=pg_temp.sid('new') $$;
select is(pg_temp.m('new','1','analysis-enqueue'),'deny:appeal-review-pending',
 '(new) a public-appeal hold still denies a released record');
rollback to savepoint before_appeal_stand_in;

-- 5. A hold whose second notice is never sent is never released -------------------
select pg_temp.age('fail',interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(fail) its second notice is queued');
update private.invitation_terminal_notices set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days'
 where invitation_id=pg_temp.inv('fail');
update public.mail_outbox set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days'
 where target_id=pg_temp.inv('fail');
select ok(public.expire_invitation_terminal_notices_v1()>=1,'(fail) it expires unsent and leaves the queue');
select is(pg_temp.clock('fail','adult.acceptance-hold-72h'),'cancelled:failed','(fail) the phase records that it was not sent');
select pg_temp.age('fail',interval '10 days');
select is(pg_temp.m('fail','1','analysis-enqueue'),'deny:adult.acceptance-hold-72h',
 '(fail) ten days later the hold still stands: never released without the notice');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(fail) and no retry extends or reissues it');

-- 6. Never queued, or never sent, once the record is gone, transferred or barred -----
select is(public.delete_subject_v1(pg_temp.a('6'),pg_temp.s('6'),pg_temp.sid('gone'),repeat('6',64),
 clock_timestamp()+interval '9 minutes')->>'case','adult','(gone) the person deletes the record before 72 hours');
select pg_temp.age('gone',interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(gone) nothing is queued for a deleted record');
select is(pg_temp.notices('gone','adult-acceptance-second-notice')::text||' '||pg_temp.clock('gone','adult.acceptance-hold-72h'),
 '0 cancelled:cancelled','(gone) its phase is cancelled');
select is((select terminal_outcome_code from public.retention_due_phases where target_id=pg_temp.inv('gone')
  and phase_id='adult-acceptance-second-notice'),'subject_not_current','(gone) and names why');
-- Barred after the notice was queued: the claim drops it, nothing is written.
select pg_temp.age('bar',interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(bar) its second notice is queued');
insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at)
 values(repeat('d',64),'subject',gen_random_uuid(),1,clock_timestamp()+interval '1 day');
select is(pg_temp.deliver('bar','adult-acceptance-second-notice'),'none',
 '(bar) once the address is barred the worker never claims it');
select is((select n.state||' '||m.state from private.invitation_terminal_notices n join public.mail_outbox m
  on m.invitation_terminal_notice_id=n.id where n.invitation_id=pg_temp.inv('bar')),'expired invalidated',
 '(bar) its row is invalidated');
select is(pg_temp.clock('bar','adult.acceptance-hold-72h'),'cancelled:failed','(bar) and the hold is never released');
select is(pg_temp.m('bar','1','analysis-enqueue'),'deny:adult.acceptance-hold-72h','(bar) the uploader stays denied');
-- Barred before it is due: nothing is queued.
select is(public.run_due_adult_acceptance_notices_v1(),0,'nothing else is due');
update public.subject_invitations set email_hmac=repeat('d',64) where id=pg_temp.inv('old');
select pg_temp.age('old',interval '30 days');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(old) a re-notice to a barred address is never queued');
select is(pg_temp.clock('old','adult.re-notice-30d')||' '||(select terminal_outcome_code from public.retention_due_phases
  where target_id=pg_temp.inv('old') and phase_id='adult-revocation-renotice'),'cancelled:cancelled contact_barred',
 '(old) its re-notice is cancelled as barred');
select is(pg_temp.m('old','1','analysis-enqueue'),'deny:adult.re-notice-30d','(old) and from 30 days the uploader stays denied');
update public.subject_invitations set email_hmac=repeat('a',64) where id=pg_temp.inv('old');
-- Revoked by the person after the notice was queued: the claim drops it. Its
-- account binding, principal and address are all still current, so only the
-- record's own state stops it, at send time and, for the re-notice, at queueing.
select pg_temp.age('rev',interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(rev) its second notice is queued');
update public.subjects set lifecycle='revoked',lifecycle_revision=lifecycle_revision+1 where id=pg_temp.sid('rev');
select is(pg_temp.deliver('rev','adult-acceptance-second-notice'),'none',
 '(rev) once the person has revoked the record, the worker never claims its notice');
select is(pg_temp.clock('rev','adult.acceptance-hold-72h'),'cancelled:failed','(rev) the notice fails unsent');
select pg_temp.age('rev',interval '30 days'-interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(rev) a re-notice for a revoked record is never queued');
select is((select status||' '||terminal_outcome_code from public.retention_due_phases where target_id=pg_temp.inv('rev')
  and phase_id='adult-revocation-renotice'),'cancelled subject_not_current','(rev) its re-notice is cancelled as not current');

-- 7. The re-notice ---------------------------------------------------------------
-- (new), released at 72 hours, reaches 30 days: denied until its re-notice is accepted.
select pg_temp.age('new',interval '29 days 23 hours 59 minutes'-interval '72 hours');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(new) at 29 days 23 hours 59 minutes no re-notice is due');
select is(pg_temp.m('new','1','analysis-enqueue'),'allow:-','(new) and the uploader is still allowed');
select pg_temp.age('new',interval '1 minute');
select is(pg_temp.m('new','1','analysis-enqueue'),'deny:adult.re-notice-30d','(new) at 30 days the uploader is denied');
select is(pg_temp.m('new','4','analysis-enqueue'),'subject-own-right-only:-','(new) the person''s own analysis is not');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(new) the re-notice is queued');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(new) once');
select is(pg_temp.m('new','1','analysis-enqueue'),'deny:adult.re-notice-30d','(new) still denied while it is not accepted');
select is((select recipient_kind||' '||(recipient_account_id=pg_temp.a('4'))::text from private.invitation_terminal_notices
  where invitation_id=pg_temp.inv('new') and notice_kind='adult-revocation-renotice'),'account true',
 '(new) the re-notice goes to the person''s account, not to the request''s contact');
select is(pg_temp.deliver('new','adult-revocation-renotice'),'sent','(new) the worker sends it');
select is(pg_temp.clock('new','adult.re-notice-30d'),'active:succeeded','(new) its acceptance is recorded');
select is(pg_temp.all_checkpoints('new','1'),'allow:-',
 '(new) after 30 days, with the re-notice accepted, the uploader is allowed at all eleven checkpoints');
select pg_temp.age('new',interval '60 days');
select is(pg_temp.m('new','1','analysis-enqueue'),'allow:-','(new) and stays allowed: there is no further boundary');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(new) nothing more is queued');
select is(pg_temp.clock('new','adult.re-notice-30d')||' '||pg_temp.notices('new','adult-revocation-renotice'),
 'complete:succeeded 1','(new) the re-notice clock closes, one re-notice sent');
select lives_ok($$select private.path_b_normalization_authority_v1(pg_temp.fxv('new','revision')::uuid,'derived-write-and-read')$$,
 '(new) 90 days after acceptance the normalization authority holds: no second cut at 30 days');

-- 8. Path A: the invited adult's own record -----------------------------------------
do $$ declare n integer; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at,created_at) values(('7d1a0000-0000-4000-8000-00000000000'||n)::uuid,
   'path-a-hold-'||n||'@example.invalid',now()-interval '1 day',now()-interval '1 day');
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7d1a0000-0000-4000-8000-00000000001'||n)::uuid,
   ('7d1a0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
 end loop;
end $$;
create function pg_temp.pa(n integer) returns uuid language sql immutable as $$ select ('7d1a0000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.ps(n integer) returns uuid language sql immutable as $$ select ('7d1a0000-0000-4000-8000-00000000001'||n)::uuid $$;
create temporary table pa_inv(name text primary key,subject_id uuid,invitation_id uuid);
-- An invitation from 01 to the address digest p_letter…, opened through its mailed token, accepted by account p_account.
create function pg_temp.path_a(p_name text,p_letter text,p_account integer) returns uuid language plpgsql as $$
declare r record; d record; v_subject uuid;
begin
 select * into r from public.create_adult_subject_invitation_v1(pg_temp.pa(1),decode('00112233445566778899aabbccddeeff','hex'),
  repeat(p_letter,64),encode(extensions.digest(convert_to('path-a-hold-idem:'||p_name,'UTF8'),'sha256'),'hex'),true,
  p_quota_keys=>pg_temp.invitation_quota_keys());
 update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and token_target_id is distinct from r.invitation_id;
 select * into d from public.claim_mail_outbox();
 if (select count(*) from public.activate_rights_session_v1(encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex'),
   repeat(p_letter,64),'path-a-hold-open-'||p_name||'aaaaaaa'))<>1 then raise exception 'path a setup failed'; end if;
 if p_account=3 then update auth.users set created_at=clock_timestamp() where id=pg_temp.pa(3); end if;
 v_subject:=public.accept_adult_subject_invitation_v1(repeat(p_letter,64),'path-a-hold-accept-'||p_name||'aaaaa',pg_temp.pa(p_account),
  pg_temp.ps(p_account),jsonb_build_object('1',repeat(p_letter,64)),decode(repeat('5a',28),'hex'));
 insert into pa_inv values(p_name,v_subject,r.invitation_id);
 return v_subject;
end $$;
create function pg_temp.pm(p_name text,p_account integer,p_checkpoint text) returns text language sql as $$
 select (private.other_adult_mitigation_v1((select subject_id from pa_inv where name=p_name),pg_temp.pa(p_account),p_checkpoint)->>'decision')
  ||':'||coalesce(private.other_adult_mitigation_v1((select subject_id from pa_inv where name=p_name),pg_temp.pa(p_account),p_checkpoint)->>'gate','-')
$$;
select isnt(pg_temp.path_a('pa-old','7',2),null,'(Path A) an adult whose account predates the invitation accepts');
select isnt(pg_temp.path_a('pa-new','8',3),null,'(Path A) an adult whose account was created after it accepts');
select is(public.adult_subject_acceptance_origin_v1(pg_temp.pa(2),(select subject_id from pa_inv where name='pa-old'))||' '||
 public.adult_subject_acceptance_origin_v1(pg_temp.pa(3),(select subject_id from pa_inv where name='pa-new')),
 'existing_account created_from_this_invitation','(Path A) each origin is recorded in the acceptance');
select is((select count(*) from public.retention_rows where target_kind='invitation'
  and target_id=(select invitation_id from pa_inv where name='pa-old') and retention_id='adult.acceptance-hold-72h')||' '||
 (select count(*) from public.retention_rows where target_kind='invitation'
  and target_id=(select invitation_id from pa_inv where name='pa-new') and retention_id='adult.acceptance-hold-72h'),
 '0 1','(Path A) only the account created from the invitation is held');
select is(pg_temp.pm('pa-old',2,'analysis-enqueue'),'subject-own-right-only:-',
 '(Path A) the record is found and its existing account is never held (it was denied outright before)');
select is(pg_temp.pm('pa-new',3,'analysis-enqueue')||' '||pg_temp.pm('pa-new',3,'export-create'),
 'deny:adult.acceptance-hold-72h subject-own-right-only:-',
 '(Path A) a new account''s own analysis waits out the hold; its own export does not');
select is(pg_temp.pm('pa-new',1,'analysis-enqueue'),'deny:not-found','(Path A) the inviter is never found on it');
update public.subject_invitations set accepted_at=accepted_at-interval '72 hours' where id=(select invitation_id from pa_inv where name='pa-new');
update public.retention_rows set fixed_deadline=fixed_deadline-interval '72 hours' where target_id=(select invitation_id from pa_inv where name='pa-new');
update public.retention_due_phases set phase_deadline=phase_deadline-interval '72 hours' where target_id=(select invitation_id from pa_inv where name='pa-new');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(Path A) at 72 hours its second notice is queued');
select is(pg_temp.pm('pa-new',3,'analysis-enqueue'),'deny:adult.acceptance-hold-72h','(Path A) still held until it is accepted');
select is((select n.recipient_account_id from private.invitation_terminal_notices n
  where n.invitation_id=(select invitation_id from pa_inv where name='pa-new')),pg_temp.pa(3),'(Path A) addressed to the person''s account');
create function pg_temp.deliver_a() returns text language plpgsql as $$
declare c record;
begin
 select * into c from public.claim_invitation_terminal_mail_v1();
 if c.outbox_id is null then return 'none'; end if;
 if not public.authorize_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal) then return 'refused'; end if;
 perform public.complete_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal,true,
  encode(extensions.digest(convert_to('provider:'||c.outbox_id::text,'UTF8'),'sha256'),'hex'));
 return c.notice_kind;
end $$;
select is(pg_temp.deliver_a(),'adult-acceptance-second-notice','(Path A) the worker sends it');
select is(pg_temp.pm('pa-new',3,'analysis-enqueue'),'subject-own-right-only:-','(Path A) released once accepted');
-- Path A re-notices: one for an account being deleted after it was queued, one for a record transferred before it was due.
create function pg_temp.pa_age(p_name text,p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by where id=(select invitation_id from pa_inv where name=p_name);
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation'
  and target_id=(select invitation_id from pa_inv where name=p_name);
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation'
  and target_id=(select invitation_id from pa_inv where name=p_name);
$$;
select pg_temp.pa_age('pa-old',interval '30 days');
select is(public.run_due_adult_acceptance_notices_v1(),1,'(Path A) at 30 days the re-notice is queued');
update public.profiles set deletion_requested_at=clock_timestamp() where id=pg_temp.pa(2);
select is(pg_temp.deliver_a(),'none','(Path A) an account asked to be deleted is never written to');
select is((select status||' '||terminal_outcome_code from public.retention_due_phases
  where target_id=(select invitation_id from pa_inv where name='pa-old') and phase_id='adult-revocation-renotice'),
 'failed notice_not_sent','(Path A) and that re-notice failed unsent');
update public.subjects set ownership_transferred_at=clock_timestamp(),owner_account_id=subject_account_id
 where id=(select subject_id from pa_inv where name='pa-new');
select pg_temp.pa_age('pa-new',interval '30 days');
select is(public.run_due_adult_acceptance_notices_v1(),0,'(Path A) a re-notice for a transferred record is never queued');
select is((select status||' '||terminal_outcome_code from public.retention_due_phases
  where target_id=(select invitation_id from pa_inv where name='pa-new') and phase_id='adult-revocation-renotice'),
 'cancelled subject_transferred','(Path A) its phase is cancelled as transferred');

-- 9. An acceptance recorded before the migration keeps the old rule ---------------
delete from public.retention_due_phases where target_kind='invitation' and target_id=pg_temp.inv('fail');
delete from public.retention_rows where target_kind='invitation' and target_id=pg_temp.inv('fail');
select is(pg_temp.m('fail','1','analysis-enqueue'),'deny:adult.acceptance-hold-72h',
 'an unrecorded acceptance by an account created after its request stays held, as before');
update auth.users set created_at=now()-interval '30 days' where id=pg_temp.a('5');
select is(pg_temp.m('fail','1','analysis-enqueue'),'allow:-','an unrecorded acceptance by an older account is allowed, as before');

select * from finish();
rollback;
