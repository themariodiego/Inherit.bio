-- api.subject-sharing stop: the single-use stop code (owner decision
-- 2026-10-16, "The subjects endpoints (G2.1)", docs/protocol/decisions.md).
--
-- FLAGGED: needs a later guarded release before it reaches a hosted
-- database. It adds one function and widens one check; nothing existing is
-- otherwise altered, and no restricted capability or jurisdiction gate is
-- touched. Pause and resume need no SQL: the route calls the existing
-- pause_family_sharing_v1 and resume_family_sharing_v1 directly.
--
-- The route is the UUID-addressed twin of api.family-sharing. Its stop runs
-- the unchanged public.stop_family_sharing_v1 over the counterpart account
-- the route subject resolves to through the Family graph. What this adds is
-- the single-use code the Family permissions page issues for this route and
-- this subject (brief X1.5: rendered by the page, consumed only by the
-- request, never stored by a GET):
--
--   * The route has already verified the code's MAC against the live account,
--     session, operation, route and subject, and its expiry.
--   * This function records the code's SHA-256 in
--     public.account_operation_nonces in the same transaction as the stop.
--     A second use of the same code is refused (22023) and writes nothing;
--     a stop that fails rolls back its own record, so a code is spent only by
--     a stop that happened.
--   * It rechecks that the auth session is live and that the route subject is
--     an active adult record bound to the counterpart account, so a code for
--     one subject cannot stop sharing with a different counterpart.

do $predecessor$
begin
 if to_regprocedure('public.stop_family_sharing_v1(uuid,uuid)') is null
  or to_regclass('public.account_operation_nonces') is null
  or not exists(select 1 from pg_constraint where conrelid='public.account_operation_nonces'::regclass
   and conname='account_operation_nonces_operation_check'
   and pg_get_constraintdef(oid) like '%other_adult_upload_artifact_sign%') then
  raise exception using errcode='55000',message='subject sharing stop prerequisite missing'; end if;
 if to_regprocedure('public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)') is not null then
  raise exception using errcode='55000',message='subject sharing stop successor already exists'; end if;
end;
$predecessor$;

alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign',
  'own_account_completion','other_adult_upload_artifact_sign','subject_sharing_stop'));

-- One verified subject-route code, recorded once. The subject is part of the
-- route's MAC, not of the stored row: the hash alone makes the code one-time.
create function private.record_subject_operation_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_operation text,p_subject_id uuid,p_nonce_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null
  or p_operation is null or p_operation not in ('subject_sharing_stop')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp()
  or p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='subject operation unavailable'; end if;
 delete from public.account_operation_nonces where operation=p_operation and expires_at<=clock_timestamp();
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at,consumed_at)
 values(p_nonce_hash,p_account_id,p_session_id,p_operation,p_expires_at,clock_timestamp())
 on conflict(nonce_hash) do nothing;
 if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
end $$;
revoke all on function private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.stop_subject_sharing_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_counterpart_account_id uuid,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns table(ended_at timestamptz,deleted_counts jsonb)
language plpgsql security definer set search_path='' as $$
begin
 if p_account_id is null or p_counterpart_account_id is null or p_subject_id is null
  or p_account_id=p_counterpart_account_id then
  raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 -- The canonical lock order: the acting account, then the subject. The
 -- shared stop below locks the same profile again, which is a no-op.
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform 1 from public.subjects s where s.id=p_subject_id and s.subject_account_id=p_counterpart_account_id
  and s.subject_class in ('self','other_adult') and s.lifecycle in ('active','claimed_bound')
 for share;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_sharing_stop',
  p_subject_id,p_nonce_hash,p_nonce_expires_at);
 return query select x.ended_at,x.deleted_counts
  from public.stop_family_sharing_v1(p_account_id,p_counterpart_account_id) x;
end $$;
revoke all on function public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.stop_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
