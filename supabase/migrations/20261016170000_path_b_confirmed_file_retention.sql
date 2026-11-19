-- Path B: a file confirmed by a person with no account is kept for at most
-- exactly 730 days (G5.4; owner decision 2026-10-16, "Confirmed file of an
-- accountless person: 730 days", docs/protocol/decisions.md).
--
-- FLAGGED: TEST-LOCAL. Path B is offered only in the test jurisdiction, so in
-- production no row is ever created here and the sweep finds nothing. A later
-- guarded release is required before this reaches a hosted database. No
-- restricted capability, mitigation gate or uploader access is opened: the
-- no-account-path-b mitigation (20260930220000) still denies the uploader.
--
-- Until now a person's confirmation cancelled the file's 30-day clock
-- (adult.unconfirmed-30d) and created none: a confirmed file had no maximum.
-- This adds the registered class adult.non-account-holder-24mo (defined as
-- exactly 730 days, docs/retention.md) for each confirmed file revision:
--
--   1. Clock. In the same transaction that confirms a revision of a subject
--      that has not bound its own account, one retention row and its one
--      registered due phase (adult-non-account-holder-expiry, compound-atomic)
--      are written. Both deadlines are the revision's confirmed_at plus
--      exactly 730 x 24 hours, independent of the session time zone. Mail,
--      sessions, analysis or sharing never touch them. A subject bound to its
--      own account (Path B's account branch, which binds at the request,
--      before any file) gets no row: the register's cancelWhen.
--   2. Executor. public.expire_due_path_b_confirmed_files_v1, called by
--      jobs.retention just before the upload cleanup, selects every due phase,
--      marks it done and ends the revision through the existing
--      private.end_other_adult_held_upload_v1(...,'expired'). The existing
--      upload-working executor then deletes the held objects, the session and
--      the revision in that same job run, exactly as for a refusal.
--   3. Any other ending of a confirmed revision (refusal, the person's delete,
--      the uploader's account deletion, subject purge, row removal) cancels
--      its clock in the same statement, so no live clock outlives its file.
--   4. A service-only read for the person's review page: whether a yes would
--      start this clock (pending), or when it ends (confirmed).
--
-- No table, column, grant to an API role or existing function is changed.

do $predecessor$
begin
 if not exists(select 1 from public.retention_phase_registry where retention_id='adult.non-account-holder-24mo'
   and phase_id='adult-non-account-holder-expiry' and phase_kind='compound-atomic')
  or not exists(select 1 from public.retention_registry where retention_id='adult.non-account-holder-24mo'
   and execution_class='scheduledDuePhase')
  or to_regprocedure('private.end_other_adult_held_upload_v1(uuid,text)') is null
  or to_regprocedure('private.adult_upload_revision_session_v1(text)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null then
  raise exception using errcode='55000',message='path b confirmed retention prerequisite missing'; end if;
 if to_regprocedure('private.adult_non_account_holder_days_v1()') is not null
  or to_regprocedure('private.path_b_confirmed_file_retention_v1()') is not null
  or to_regprocedure('public.expire_due_path_b_confirmed_files_v1()') is not null
  or to_regprocedure('public.adult_upload_revision_retention_v1(text)') is not null then
  raise exception using errcode='55000',message='path b confirmed retention successor already exists'; end if;
end;
$predecessor$;

-- The class's one number, in days. docs/retention.md is its authority.
create function private.adult_non_account_holder_days_v1()
returns integer language sql immutable set search_path='' as $$ select 730 $$;
revoke all on function private.adult_non_account_holder_days_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 1 and 3. The clock starts at confirmation and ends with its file ----------
create function private.path_b_confirmed_file_retention_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_account uuid; v_row uuid; v_deadline timestamptz; v_now timestamptz:=clock_timestamp(); v_code text;
begin
 if tg_op='UPDATE' and old.state='pending' and new.state='confirmed' then
  select s.subject_account_id into v_account from public.subjects s where s.id=new.subject_id;
  if v_account is not null then return null; end if;
  if new.confirmed_at is null then
   raise exception using errcode='23514',message='path_b_confirmation_time_required'; end if;
  v_deadline:=new.confirmed_at+make_interval(hours=>24*private.adult_non_account_holder_days_v1());
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
  values('adult.non-account-holder-24mo','upload_session',new.upload_session_id,new.upload_revision,new.upload_revision,1,
   v_deadline)
  returning id into v_row;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,
   immutable_envelope)
  values(v_row,'adult.non-account-holder-24mo','adult-non-account-holder-expiry','compound-atomic',1,v_deadline,
   'upload_session',new.upload_session_id,new.upload_revision,1,'service-retention',1,
   jsonb_build_object('uploadId',new.upload_session_id,'uploadRevision',new.upload_revision,'revisionId',new.id,
    'confirmedAt',new.confirmed_at));
  return null;
 end if;
 if (tg_op='DELETE' and old.state='confirmed')
  or (tg_op='UPDATE' and old.state='confirmed' and new.state is distinct from 'confirmed') then
  v_code:=case when tg_op='DELETE' then 'revision_removed' else case new.state when 'refused' then 'subject_refused'
   when 'deleted' then 'subject_deleted' when 'withdrawn' then 'uploader_withdrawn' else 'revision_ended' end end;
  -- The executor below marks its own phase done before it ends the revision,
  -- so only a clock that is still running is cancelled here.
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
   completed_at=v_now,terminal_outcome_code=v_code
  where retention_id='adult.non-account-holder-24mo' and phase_id='adult-non-account-holder-expiry'
   and target_kind='upload_session' and target_id=old.upload_session_id and status in ('pending','retry','claimed');
  update public.retention_rows set state='cancelled',ended_at=v_now
  where retention_id='adult.non-account-holder-24mo' and target_kind='upload_session'
   and target_id=old.upload_session_id and state in ('scheduled','active');
 end if;
 return null;
end;
$$;
revoke all on function private.path_b_confirmed_file_retention_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
create trigger path_b_confirmed_file_retention after update of state or delete on public.other_adult_held_uploads
 for each row execute function private.path_b_confirmed_file_retention_v1();

-- 2. The retention job's executor --------------------------------------------
-- Selected by the database; no selector, clock or batch comes from the caller.
-- Serialized with every confirmation, refusal and sweep by the same lock.
create function public.expire_due_path_b_confirmed_files_v1()
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v record; h public.other_adult_held_uploads%rowtype; v_account uuid; n integer:=0; v_now timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 for v in select p.retention_row_id,p.phase_revision,p.target_id
  from public.retention_due_phases p join public.retention_rows r on r.id=p.retention_row_id
  where p.retention_id='adult.non-account-holder-24mo' and p.phase_id='adult-non-account-holder-expiry'
   and p.target_kind='upload_session' and p.status in ('pending','retry') and p.phase_deadline<=v_now
   and r.retention_id='adult.non-account-holder-24mo' and r.target_kind='upload_session' and r.target_id=p.target_id
   and r.state in ('scheduled','active') and r.fixed_deadline<=v_now
  order by p.phase_deadline,p.retention_row_id
  for update of p,r
 loop
  v_account:=null;
  select * into h from public.other_adult_held_uploads where upload_session_id=v.target_id for update;
  if h.id is not null then
   select s.subject_account_id into v_account from public.subjects s where s.id=h.subject_id for update;
  end if;
  if h.id is null or h.state<>'confirmed' or v_account is not null then
   -- No confirmed file is held under this clock any more, or the subject has
   -- since bound its own account (the register's cancelWhen). Nothing to delete.
   update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    completed_at=v_now,terminal_outcome_code=case when v_account is not null and h.state='confirmed'
     then 'subject_bound_own_account' else 'revision_already_ended' end
   where retention_row_id=v.retention_row_id and phase_id='adult-non-account-holder-expiry'
    and phase_revision=v.phase_revision;
   update public.retention_rows set state='cancelled',ended_at=v_now where id=v.retention_row_id;
   continue;
  end if;
  update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
   completed_at=v_now,terminal_outcome_code='adult_non_account_holder_expired'
  where retention_row_id=v.retention_row_id and phase_id='adult-non-account-holder-expiry'
   and phase_revision=v.phase_revision;
  update public.retention_rows set state='complete',ended_at=v_now where id=v.retention_row_id;
  -- The same ending a refusal uses: the held session is rejected and due now,
  -- so the upload-working executor deletes its objects in this job run.
  if not private.end_other_adult_held_upload_v1(h.id,'expired') then
   raise exception using errcode='55000',message='held_upload_unavailable'; end if;
  n:=n+1;
 end loop;
 return n;
end;
$function$;
revoke all on function public.expire_due_path_b_confirmed_files_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_due_path_b_confirmed_files_v1() to service_role;

-- 4. What the person's review page states ------------------------------------
-- Only for the live upload-confirmation session of this one revision, through
-- the same session check the review itself uses. Pending: the days a yes would
-- keep the file, or null when the subject is bound to its own account.
-- Confirmed: the days and the fixed end of its running clock, or nulls.
create function public.adult_upload_revision_retention_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; v_account uuid; v_until timestamptz;
begin
 r:=private.adult_upload_revision_session_v1(p_session_hash);
 if r is null then return null; end if;
 if r->>'state'='confirmed' then
  select rr.fixed_deadline into v_until from public.other_adult_held_uploads h
   join public.retention_rows rr on rr.retention_id='adult.non-account-holder-24mo' and rr.target_kind='upload_session'
    and rr.target_id=h.upload_session_id and rr.state in ('scheduled','active')
  where h.id=(r->>'revisionId')::uuid;
  return jsonb_build_object('keepDays',case when v_until is not null then private.adult_non_account_holder_days_v1() end,
   'keepUntil',v_until);
 end if;
 select s.subject_account_id into v_account from public.subjects s where s.id=(r->>'subjectId')::uuid;
 return jsonb_build_object('keepDays',case when v_account is null then private.adult_non_account_holder_days_v1() end,
  'keepUntil',null);
end;
$function$;
revoke all on function public.adult_upload_revision_retention_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.adult_upload_revision_retention_v1(text) to service_role;
