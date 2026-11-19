-- The no-account uploader gate (20261016204000_path_b_no_account_uploader_gate.sql;
-- owner decision 2026-10-22 "Uploader gate for a person who confirmed with no
-- account"; a stated privacy-control change, TEST-LOCAL only).
--
-- Proves, on synthetic rows only, that other-adult-mitigation-state-v1's
-- no-account-path-b case now mirrors the account case:
--   * before any file is confirmed (no 730-day clock), the uploader of a
--     person with no account is denied, as before;
--   * inside the window (a live 730-day clock and less than 30 days since the
--     request was accepted) the uploader is allowed, at every checkpoint;
--   * from accepted+30 days the uploader is denied adult.re-notice-30d,
--     exactly as in the account case;
--   * once the clock has ended (passed, or cancelled by a refusal), or the
--     person's confirmation principal is no longer active, the uploader is
--     denied adult.non-account-holder-24mo;
--   * the account case, the subject's own right, the 72-hour hold, anyone
--     else and the checkpoint list answer exactly as before;
--   * the patched function carries its pinned body and unchanged privileges.
-- The clock and the acceptance are moved only by ageing one synthetic
-- record's own rows, and each is moved back. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';

create function pg_temp.m(p_name text,p_account text,p_checkpoint text default 'route-read-before-fetch') returns text
language sql as $$
 select (private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'decision')
  ||':'||coalesce(private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'gate','-')
$$;
create function pg_temp.keep(p_name text) returns setof public.retention_rows language sql as $$
 select * from public.retention_rows where retention_id='adult.non-account-holder-24mo' and target_kind='upload_session'
  and target_id=pg_temp.fxv(p_name,'upload')::uuid
$$;
create function pg_temp.age_acceptance(p_name text,p_days integer) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-make_interval(days=>p_days)
 where id=pg_temp.invitation_of(pg_temp.sid(p_name));
$$;

-- 0. The patched body ----------------------------------------------------------
select is((select md5(prosrc) from pg_proc
 where oid='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure),
 '29c74c79cb3eeedbbdac44273a6f4de3','the no-account branch carries the pinned successor body');
select ok((select provolatile='s' and prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc
 where oid='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure),
 'it stays STABLE SECURITY DEFINER with its pinned search path');
select ok(not has_function_privilege('service_role','private.other_adult_mitigation_v1(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','execute'),
 'neither the decision nor its patched body is callable by any API role');

-- 1. Two people: one with no account, one with an account that predates ---------
select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','gate-token-aaaaaaaaaaaaaaaaaa'),'accepted','(nb) the person signs with no account');
select pg_temp.requested('acct','c',repeat('c',64));
select is(pg_temp.account_confirms('c','gate-sign-ccccccccccccccccccc','2',repeat('c',64)),'accepted',
 '(acct) a second person signs with their own account, which predates the request');

-- 2. Before a confirmed file there is no 730-day clock: denied, as before -------
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) with no confirmed file the uploader is denied: no 730-day clock is live');
select is(pg_temp.m('nb','1','purpose-grant-create'),'deny:adult.non-account-holder-24mo',
 '(nb) ... also at purpose-grant-create');
select is((select h->>'status' from (select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64)) h) x),'stored_quarantined',
 '(nb) a file is held');
select is(pg_temp.notice_session('nb','1'),1::bigint,'(nb) the notice opens a session');
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) a held file the person has not said yes to starts no clock and opens nothing');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'gate-confirm-1111111111111111','confirm'),'confirmed',
 '(nb) the person says yes with no account');
select is((select count(*) from pg_temp.keep('nb') where state='scheduled' and fixed_deadline>clock_timestamp()),1::bigint,
 '(nb) the yes starts a live 730-day clock');

-- 3. Inside the window: allowed at every checkpoint ------------------------------
select is((select count(*) from unnest(array['purpose-grant-create','route-read-before-fetch',
  'model-context-before-retrieval','analysis-enqueue','worker-claim','source-read-and-every-bounded-range',
  'derived-write-and-read','export-create','export-source-read','download-session-create','every-download-chunk']) c
 where pg_temp.m('nb','1',c)='allow:-'),11::bigint,
 '(nb) with a live clock and inside 30 days of acceptance the uploader is allowed at all eleven checkpoints');
select is(pg_temp.m('nb','9'),'deny:not-found','(nb) anyone but the uploader is still not found');
select is(pg_temp.m('nb','2'),'deny:not-found','(nb) another person''s account is still not found');

-- 4. From the 30-day boundary: adult.re-notice-30d, as for an account -----------
select pg_temp.age_acceptance('nb',29);
select is(pg_temp.m('nb','1','analysis-enqueue'),'allow:-','(nb) 29 days after acceptance the uploader is still allowed');
select pg_temp.age_acceptance('nb',2);
select is(pg_temp.m('nb','1','analysis-enqueue'),'deny:adult.re-notice-30d',
 '(nb) 31 days after acceptance the uploader is denied: the re-notice is not built');
select is(pg_temp.m('nb','1','purpose-grant-create'),'deny:adult.re-notice-30d','(nb) ... also at purpose-grant-create');
select ok((select count(*)=1 from pg_temp.keep('nb') where state='scheduled' and fixed_deadline>clock_timestamp()),
 '(nb) ... while the 730-day clock itself is still live');
select pg_temp.age_acceptance('nb',-31);
select is(pg_temp.m('nb','1'),'allow:-','(nb) moved back inside the window, allowed again');

-- 5. After the clock ends: denied ---------------------------------------------------
update public.retention_rows set fixed_deadline=clock_timestamp()-interval '1 second' where id=(select id from pg_temp.keep('nb'));
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) once the 730-day deadline has passed the uploader is denied, even before the sweep runs');
update public.retention_rows set fixed_deadline=(select h.confirmed_at+interval '730 days' from public.other_adult_held_uploads h
 where h.id=pg_temp.fxv('nb','revision')::uuid) where id=(select id from pg_temp.keep('nb'));
select is(pg_temp.m('nb','1'),'allow:-','(nb) its deadline restored, allowed again');
update public.retention_rows set state='cancelled',ended_at=clock_timestamp() where id=(select id from pg_temp.keep('nb'));
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) a clock that has ended while its file is still confirmed opens nothing');
update public.retention_rows set state='scheduled',ended_at=null where id=(select id from pg_temp.keep('nb'));
select is(pg_temp.m('nb','1'),'allow:-','(nb) the clock running again, allowed again');
update public.subject_principals set status='revoked' where subject_id=pg_temp.sid('nb') and principal_kind='non_account_subject';
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) without an active confirmation principal the uploader is denied');
update public.subject_principals set status='active' where subject_id=pg_temp.sid('nb') and principal_kind='non_account_subject';
select is(pg_temp.m('nb','1'),'allow:-','(nb) the principal active again, allowed again');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'gate-refuse-11111111111111111','refuse'),'refused',
 '(nb) the person later says no to the file');
select is((select state from pg_temp.keep('nb')),'cancelled','(nb) refusing cancels its clock');
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 '(nb) with the clock cancelled the uploader is denied again');
select is(pg_temp.m('nb','1','every-download-chunk'),'deny:adult.non-account-holder-24mo','(nb) ... at every checkpoint');

-- 6. The account case is unchanged ------------------------------------------------
select is(pg_temp.m('acct','2'),'subject-own-right-only:-','(acct) the person''s own account is subject-own-right-only');
select is(pg_temp.m('acct','1'),'allow:-','(acct) the uploader, inside 30 days of acceptance, is allowed');
select is(pg_temp.m('acct','9'),'deny:not-found','(acct) anyone else is not found');
select pg_temp.age_acceptance('acct',31);
select is(pg_temp.m('acct','1','analysis-enqueue'),'deny:adult.re-notice-30d','(acct) from 30 days the uploader is denied');
select pg_temp.age_acceptance('acct',-31);
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('2');
select is(pg_temp.m('acct','1'),'deny:adult.acceptance-hold-72h',
 '(acct) an account created after the request still meets the 72-hour hold');
update auth.users set created_at=now()-interval '1 day' where id=pg_temp.a('2');
select is(pg_temp.m('acct','1'),'allow:-','(acct) restored, allowed');
select throws_ok($$select private.other_adult_mitigation_v1(pg_temp.sid('acct'),pg_temp.a('1'),'anything')$$,
 '22023','invalid_request','only the register''s checkpoints are answered');

select * from finish();
rollback;
