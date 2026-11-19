-- Path B: a file confirmed with no account is kept for at most exactly 730
-- days (20261016170000_path_b_confirmed_file_retention.sql; G5.4; owner
-- decision 2026-10-16 "Confirmed file of an accountless person: 730 days").
--
-- Proves, on synthetic rows only, that:
--   * confirming a file of a person with no account writes exactly one
--     adult.non-account-holder-24mo row and its one registered due phase,
--     each at confirmed_at plus exactly 730 days, in the same transaction;
--   * a person bound to their own account gets no such clock (cancelWhen),
--     and the review read says so;
--   * nothing is deleted before the deadline, and the retention job's sweep
--     touches only the due file;
--   * after the job runs (the sweep, then the existing upload-working
--     executor) no confirmed file older than 730 days exists, its session,
--     revision and Storage object are gone and its clock is complete;
--   * every other ending of a confirmed file cancels its clock at once;
--   * only the service role can call the sweep and the review read.
-- The clock is moved only by ageing one synthetic file's whole record
-- together, as the 30-day suite does; every interval is preserved.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';

-- 1. Three people: two sign with no account, one with their own account -----
select pg_temp.requested('nb','a',repeat('a',64));
select is(pg_temp.token_confirms('a','keep-token-aaaaaaaaaaaaaaaaaa'),'accepted','(nb) the person signs with no account');
select pg_temp.requested('other','b',repeat('b',64));
select is(pg_temp.token_confirms('b','keep-token-bbbbbbbbbbbbbbbbbb'),'accepted',
 '(other) a second person signs with no account');
select pg_temp.requested('acct','c',repeat('c',64));
select is(pg_temp.account_confirms('c','keep-sign-ccccccccccccccccccc','2',repeat('c',64)),'accepted',
 '(acct) a third person signs with their own account');
select ok((select subject_account_id is null from public.subjects where id=pg_temp.sid('nb'))
 and (select subject_account_id is null from public.subjects where id=pg_temp.sid('other'))
 and (select subject_account_id=pg_temp.a('2') from public.subjects where id=pg_temp.sid('acct')),
 'two subjects have no account of their own and one is bound to its own account');

select is((select h->>'status' from (select pg_temp.hold('nb',pg_temp.sid('nb'),repeat('d',64)) h) x),'stored_quarantined','(nb) held');
select is((select h->>'status' from (select pg_temp.hold('other',pg_temp.sid('other'),repeat('e',64)) h) x),'stored_quarantined',
 '(other) held');
select is((select h->>'status' from (select pg_temp.hold('acct',pg_temp.sid('acct'),repeat('f',64)) h) x),'stored_quarantined',
 '(acct) held');
select is(pg_temp.notice_session('nb','1'),1::bigint,'(nb) the notice opens a session');
select is(pg_temp.notice_session('other','2'),1::bigint,'(other) the notice opens a session');
select is(pg_temp.notice_session('acct','3'),1::bigint,'(acct) the notice opens a session');

create function pg_temp.keep(p_name text) returns setof public.retention_rows language sql as $$
 select * from public.retention_rows where retention_id='adult.non-account-holder-24mo' and target_kind='upload_session'
  and target_id=pg_temp.fxv(p_name,'upload')::uuid
$$;
create function pg_temp.keep_phase(p_name text) returns setof public.retention_due_phases language sql as $$
 select * from public.retention_due_phases where retention_id='adult.non-account-holder-24mo' and target_kind='upload_session'
  and target_id=pg_temp.fxv(p_name,'upload')::uuid
$$;

-- 2. Before a yes: no clock, and the review says what a yes would start ------
select is((select count(*) from pg_temp.keep('nb'))+(select count(*) from pg_temp.keep('other'))
 +(select count(*) from pg_temp.keep('acct')),0::bigint,'a held, unconfirmed file has no 730-day clock');
select is(public.adult_upload_revision_retention_v1(repeat('1',64)),'{"keepDays":730,"keepUntil":null}'::jsonb,
 'a person with no account is told a yes keeps the file for 730 days');
select is(public.adult_upload_revision_retention_v1(repeat('3',64)),'{"keepDays":null,"keepUntil":null}'::jsonb,
 'a person bound to their own account is not told a 730-day maximum that does not apply to them');
select is(public.adult_upload_revision_retention_v1(repeat('9',64)),null::jsonb,'an unknown session reads nothing');
select is(public.adult_upload_revision_retention_v1('not-a-hash'),null::jsonb,'a malformed session reads nothing');

-- 3. The yes starts the clock in the same transaction -------------------------
create temporary table confirmed_window(name text primary key,before_at timestamptz,after_at timestamptz);
create function pg_temp.confirm(p_name text,p_session text,p_nonce text) returns text language plpgsql as $$
declare v_before timestamptz:=clock_timestamp(); v_result text;
begin
 v_result:=public.respond_adult_upload_revision_v1(repeat(p_session,64),p_nonce,'confirm');
 insert into confirmed_window values(p_name,v_before,clock_timestamp());
 return v_result;
end;
$$;
select is(pg_temp.confirm('nb','1','keep-confirm-1111111111111111'),'confirmed','(nb) the person says yes with no account');
select is(pg_temp.confirm('other','2','keep-confirm-2222222222222222'),'confirmed','(other) the person says yes with no account');
select is(pg_temp.confirm('acct','3','keep-confirm-3333333333333333'),'confirmed','(acct) the bound person says yes');

select is((select count(*) from pg_temp.keep('nb')),1::bigint,'(nb) confirmation writes exactly one adult.non-account-holder-24mo row');
select ok((select r.state='scheduled' and r.ended_at is null and r.retention_revision=h.upload_revision
  and r.target_lifecycle_revision=h.upload_revision and r.disposition_revision=1
  and r.fixed_deadline=h.confirmed_at+interval '730 days'
  and extract(epoch from r.fixed_deadline-h.confirmed_at)=730*86400
 from pg_temp.keep('nb') r join public.other_adult_held_uploads h on h.upload_session_id=r.target_id),
 'its fixed deadline is the confirmation time plus exactly 730 days');
select ok((select h.confirmed_at between w.before_at and w.after_at from public.other_adult_held_uploads h
 join confirmed_window w on w.name='nb' where h.id=pg_temp.fxv('nb','revision')::uuid),
 'the clock starts at the confirmation itself, inside the confirming transaction');
select ok((select p.phase_id='adult-non-account-holder-expiry' and p.phase_kind='compound-atomic' and p.phase_revision=1
  and p.phase_deadline=r.fixed_deadline and p.status='pending' and p.recipient_authority_kind='service-retention'
  and p.attempts=0 and p.claim_token_hash is null
  and p.immutable_envelope=jsonb_build_object('uploadId',pg_temp.fxv('nb','upload')::uuid,'uploadRevision',r.retention_revision,
   'revisionId',pg_temp.fxv('nb','revision')::uuid,'confirmedAt',h.confirmed_at)
 from pg_temp.keep_phase('nb') p join pg_temp.keep('nb') r on r.id=p.retention_row_id
 join public.other_adult_held_uploads h on h.upload_session_id=r.target_id),
 'its one registered due phase has the same deadline and names exactly this revision');
select is((select count(*) from public.purge_manifests m join pg_temp.keep('nb') r on r.id=m.retention_row_id),0::bigint,
 'the phase is no-physical-manifest, as registered: the upload-working executor owns the objects');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('nb','upload')::uuid),'cancelled:subject_confirmed',
 'the 30-day clock still ends at the yes, so exactly one clock runs');
select is((select count(*) from pg_temp.keep('acct')),0::bigint,
 '(acct) a subject bound to its own account gets no 730-day clock (the register''s cancelWhen)');
select is(public.adult_upload_revision_retention_v1(repeat('1',64)),
 jsonb_build_object('keepDays',730,'keepUntil',(select fixed_deadline from pg_temp.keep('nb'))),
 'after the yes the review reads the 730 days and the fixed end of this file''s clock');
select is(public.adult_upload_revision_retention_v1(repeat('3',64)),'{"keepDays":null,"keepUntil":null}'::jsonb,
 'after the bound person''s yes the review reads no clock');
select is(private.adult_non_account_holder_days_v1(),730,'the class is exactly 730 days');

-- 4. Nothing is due early ----------------------------------------------------
-- Anything else already due on a shared developer database is drained first.
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the 30-day sweep runs');
select lives_ok($$select public.expire_due_path_b_confirmed_files_v1()$$,'the 730-day sweep runs');
select is(public.expire_due_path_b_confirmed_files_v1(),0,'nothing of this suite is due before its deadline');
select ok((select bool_and(state='confirmed') from public.other_adult_held_uploads
 where id in (pg_temp.fxv('nb','revision')::uuid,pg_temp.fxv('other','revision')::uuid,pg_temp.fxv('acct','revision')::uuid))
 and (select state='scheduled' from pg_temp.keep('nb')) and (select status='pending' from pg_temp.keep_phase('nb')),
 'every confirmed file and its clock are untouched before the deadline');
create temporary table survivor as select r.id,r.fixed_deadline,r.state,p.phase_deadline,p.status,h.confirmed_at,h.state held_state
 from pg_temp.keep('other') r join pg_temp.keep_phase('other') p on p.retention_row_id=r.id
 join public.other_adult_held_uploads h on h.upload_session_id=r.target_id;

-- 5. Age one file's whole record past its 730 days ---------------------------
update public.other_adult_held_uploads set held_at=held_at-interval '731 days',fixed_deadline=fixed_deadline-interval '731 days',
 confirmed_at=confirmed_at-interval '731 days' where id=pg_temp.fxv('nb','revision')::uuid and state='confirmed';
update public.retention_rows set fixed_deadline=fixed_deadline-interval '731 days' where id=(select id from pg_temp.keep('nb'));
update public.retention_due_phases set phase_deadline=phase_deadline-interval '731 days'
 where retention_row_id=(select id from pg_temp.keep('nb')) and phase_id='adult-non-account-holder-expiry' and status='pending';
select ok((select r.fixed_deadline<clock_timestamp() and r.fixed_deadline=h.confirmed_at+interval '730 days'
  and p.phase_deadline=r.fixed_deadline and h.fixed_deadline-h.held_at=interval '30 days'
 from pg_temp.keep('nb') r join pg_temp.keep_phase('nb') p on p.retention_row_id=r.id
 join public.other_adult_held_uploads h on h.upload_session_id=r.target_id),
 'the aged record keeps every interval: still exactly 730 days after its confirmation');

-- 6. The retention job: the sweep, then the existing upload-working executor --
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,
 'the 30-day sweep runs first and leaves a confirmed file alone');
select is((select state from public.other_adult_held_uploads where id=pg_temp.fxv('nb','revision')::uuid),'confirmed',
 'the 30-day sweep never ends a confirmed file');
select is(public.expire_due_path_b_confirmed_files_v1(),1,'the 730-day sweep ends exactly the one due file');
select ok((select h.state='expired' and h.terminal_at is not null and u.status='rejected' and u.finalization_cleanup_pending
  and u.expires_at<=clock_timestamp()
 from public.other_adult_held_uploads h join public.upload_sessions u on u.id=h.upload_session_id
 where h.id=pg_temp.fxv('nb','revision')::uuid),'the due file ends as expired and its session is rejected and due now');
select is((select status||':'||terminal_outcome_code from pg_temp.keep_phase('nb')),'succeeded:adult_non_account_holder_expired',
 'its adult.non-account-holder-24mo phase completes as expired');
select ok((select state='complete' and ended_at is not null from pg_temp.keep('nb')),'its retention row is complete');
select ok(not exists(select 1 from public.rights_sessions where target_kind='adult_upload_revision'
  and target_id=pg_temp.fxv('nb','revision')::uuid and status='active')
 and not exists(select 1 from public.token_candidates tc join public.other_adult_held_uploads h on h.notice_outbox_id=tc.outbox_id
  where h.id=pg_temp.fxv('nb','revision')::uuid and tc.state in ('pending','issued')),
 'its notice credential and review session end with it');
select is(public.adult_upload_revision_retention_v1(repeat('1',64)),null::jsonb,'its review reads nothing any more');
select is((select jsonb_build_object('id',r.id,'deadline',r.fixed_deadline,'state',r.state,'phase',p.phase_deadline,
   'status',p.status,'confirmed',h.confirmed_at,'held',h.state)
  from pg_temp.keep('other') r join pg_temp.keep_phase('other') p on p.retention_row_id=r.id
  join public.other_adult_held_uploads h on h.upload_session_id=r.target_id),
 (select jsonb_build_object('id',id,'deadline',fixed_deadline,'state',state,'phase',phase_deadline,'status',status,
   'confirmed',confirmed_at,'held',held_state) from survivor),
 'a confirmed file inside its 730 days is untouched, clock and all');
select is((select state from public.other_adult_held_uploads where id=pg_temp.fxv('acct','revision')::uuid),'confirmed',
 'the bound person''s confirmed file is untouched');
select is(public.expire_due_path_b_confirmed_files_v1(),0,'a completed clock is replay-safe');

create function pg_temp.purge_claim(p_upload uuid) returns jsonb language plpgsql as $$
declare c jsonb; i integer;
begin
 for i in 1..200 loop
  c:=public.claim_own_upload_purge_v1(encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  if c is null then return null; end if;
  if exists(select 1 from public.purge_manifests m join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
   and d.phase_id=m.phase_id where m.id=(c->>'manifestId')::uuid and d.target_id=p_upload) then
   return c||jsonb_build_object('claimToken',encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  end if;
 end loop;
 return null;
end;
$$;
create temporary table expired_claim as select pg_temp.purge_claim(pg_temp.fxv('nb','upload')::uuid) c;
select is((select jsonb_agg(o->>'objectName' order by o->>'objectName') from expired_claim,jsonb_array_elements(c->'objects') o),
 (select jsonb_agg(x order by x) from unnest(array[pg_temp.fxv('nb','staging'),pg_temp.fxv('nb','final')]) x),
 'the existing upload-working executor claims exactly the expired file''s objects');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name in (pg_temp.fxv('nb','staging'),pg_temp.fxv('nb','final'));
select is(public.finish_own_upload_purge_v1((select (c->>'manifestId')::uuid from expired_claim),
 (select c->>'claimToken' from expired_claim)),true,'the executor finishes after Storage deletion');
select is((select count(*) from public.upload_sessions where id=pg_temp.fxv('nb','upload')::uuid)
 +(select count(*) from public.other_adult_held_uploads where id=pg_temp.fxv('nb','revision')::uuid)
 +(select count(*) from public.genome_files where id=pg_temp.fxv('nb','revision')::uuid)
 +(select count(*) from storage.objects where name in (pg_temp.fxv('nb','staging'),pg_temp.fxv('nb','final'))),0::bigint,
 'after the job: zero session, revision, file and Storage rows remain for the expired file');
select is((select count(*) from public.other_adult_held_uploads h
 where h.state='confirmed' and h.confirmed_at<=clock_timestamp()-interval '730 days'),0::bigint,
 'after the retention job runs, no confirmed file older than its 730-day class maximum exists');
select is((select count(*) from public.retention_rows r where r.retention_id='adult.non-account-holder-24mo'
 and r.state in ('scheduled','active') and r.fixed_deadline<=clock_timestamp()),0::bigint,
 'and no running 730-day clock is past its deadline');

-- A subject that later binds its own account leaves this class (the
-- register's cancelWhen). No built route binds after a confirmation yet, so
-- the binding is written directly here, on a synthetic row that rolls back.
select pg_temp.requested('late','d',repeat('5',64));
select is(pg_temp.token_confirms('d','keep-token-dddddddddddddddddd'),'accepted','(late) a fourth person signs with no account');
select is((select h->>'status' from (select pg_temp.hold('late',pg_temp.sid('late'),repeat('8',64)) h) x),'stored_quarantined',
 '(late) held');
select is(pg_temp.notice_session('late','5'),1::bigint,'(late) the notice opens a session');
select is(pg_temp.confirm('late','5','keep-confirm-5555555555555555'),'confirmed','(late) the person says yes with no account');
select is((select count(*) from pg_temp.keep('late') where state='scheduled'),1::bigint,'(late) its clock starts');
update public.other_adult_held_uploads set held_at=held_at-interval '731 days',fixed_deadline=fixed_deadline-interval '731 days',
 confirmed_at=confirmed_at-interval '731 days' where id=pg_temp.fxv('late','revision')::uuid and state='confirmed';
update public.retention_rows set fixed_deadline=fixed_deadline-interval '731 days' where id=(select id from pg_temp.keep('late'));
update public.retention_due_phases set phase_deadline=phase_deadline-interval '731 days'
 where retention_row_id=(select id from pg_temp.keep('late')) and phase_id='adult-non-account-holder-expiry' and status='pending';
update public.subjects set subject_account_id=pg_temp.a('4') where id=pg_temp.sid('late');
select is(public.expire_due_path_b_confirmed_files_v1(),0,'a subject bound to its own account before the deadline is not deleted');
select is((select status||':'||terminal_outcome_code from pg_temp.keep_phase('late')),'cancelled:subject_bound_own_account',
 'its 730-day phase is cancelled as the register''s cancelWhen');
select ok((select state='cancelled' from pg_temp.keep('late'))
 and (select state='confirmed' from public.other_adult_held_uploads where id=pg_temp.fxv('late','revision')::uuid),
 'its row is cancelled and the file stays');

-- 7. Every other ending of a confirmed file cancels its clock at once ---------
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'keep-refuse-22222222222222222','refuse'),'refused',
 '(other) the person later says no to the confirmed file');
select is((select status||':'||terminal_outcome_code from pg_temp.keep_phase('other')),'cancelled:subject_refused',
 'refusing a confirmed file cancels its 730-day phase');
select ok((select state='cancelled' and ended_at is not null from pg_temp.keep('other')),'and its retention row');
select pg_temp.hold('again',pg_temp.sid('other'),repeat('7',64));
select is(pg_temp.notice_session('again','4'),1::bigint,'(again) a new file for the same person opens a session');
select is(pg_temp.confirm('again','4','keep-confirm-4444444444444444'),'confirmed','(again) the person says yes');
select is((select count(*) from pg_temp.keep('again') where state='scheduled'),1::bigint,'(again) its own clock starts');
select is(public.respond_adult_upload_revision_v1(repeat('4',64),'keep-delete-44444444444444444','delete'),'deleted',
 '(again) the person deletes everything');
select is((select status||':'||terminal_outcome_code from pg_temp.keep_phase('again')),'cancelled:subject_deleted',
 'deleting everything cancels the clock of every confirmed file');
select ok((select state='cancelled' from pg_temp.keep('again')),'and its retention row');

-- 8. Admission -----------------------------------------------------------------
select ok(has_function_privilege('service_role','public.expire_due_path_b_confirmed_files_v1()','execute')
 and not has_function_privilege('anon','public.expire_due_path_b_confirmed_files_v1()','execute')
 and not has_function_privilege('authenticated','public.expire_due_path_b_confirmed_files_v1()','execute')
 and not has_function_privilege('inherit_upload_only','public.expire_due_path_b_confirmed_files_v1()','execute'),
 'only the service role runs the selector-free sweep');
select ok(has_function_privilege('service_role','public.adult_upload_revision_retention_v1(text)','execute')
 and not has_function_privilege('anon','public.adult_upload_revision_retention_v1(text)','execute')
 and not has_function_privilege('authenticated','public.adult_upload_revision_retention_v1(text)','execute')
 and not has_function_privilege('inherit_upload_only','public.adult_upload_revision_retention_v1(text)','execute'),
 'only the service role reads the review retention');
select ok(not has_function_privilege('service_role','private.path_b_confirmed_file_retention_v1()','execute')
 and not has_function_privilege('service_role','private.adult_non_account_holder_days_v1()','execute')
 and not has_function_privilege('authenticated','private.adult_non_account_holder_days_v1()','execute'),
 'no API role can call the clock writer or its constant directly');
select is((select count(*) from pg_proc where proname='expire_due_path_b_confirmed_files_v1' and pronargs<>0),0::bigint,
 'the sweep accepts no selector, clock or batch size');

select * from finish();
rollback;
