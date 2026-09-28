-- Two credential-bound doors the embryo chunk and completion routes need
-- (register api.embryo-ingest-chunk, api.embryo-ingest-complete). TEST-LOCAL
-- only: both reach public.authorize_embryo_ingest_request_v1 through
-- private.lock_embryo_configuration_v1, which refuses unless p_test is true.
-- EMBRYO_INGEST_AVAILABLE stays false. Neither writes Storage, a fragment, a
-- chunk receipt, a job or a publication.
--
-- 1. fail_embryo_ingest_attempt_v1. A route that rejects a chunk in memory
--    (framing, header, format, a limit or an aborted body) has no database
--    function to record that terminal branch: mark_embryo_ingest_failure_v1
--    is private and keyed by session id alone. This door re-locks the exact
--    credential-bound session, cohort and ingest revision first, then marks
--    the attempt failure-pending with a closed code. It preserves the
--    session, its fixed due target, handles, receipts and fragments for the
--    one attemptFailure unwind the route dispatches next.
--
-- 2. embryo_ingest_issued_tokens_match_v1. The configure transaction stored
--    the digests of the one completion nonce and the one CSRF token it
--    issued (write-once, 20260929110000). The completion route presents both
--    and this answers only whether their digests are exactly those. It is a
--    read: it locks nothing and marks nothing, and it answers false rather
--    than revealing why.

create function private.fail_embryo_ingest_attempt_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_code text,p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; s public.embryo_ingest_sessions%rowtype;
begin
  -- Only the branches a route can decide in memory. Quota, expiry, binding,
  -- revocation and retry exhaustion are decided by the database itself.
  if p_code is null or p_code not in ('format','header','chunk','limit','abort') then
    raise exception using errcode='22023',message='invalid ingest failure';
  end if;
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  perform private.mark_embryo_ingest_failure_v1(s.id,p_code);
  return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
end $$;
revoke all on function private.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean)
  to service_role;

create function private.embryo_ingest_issued_tokens_match_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_completion_nonce_hash text,p_csrf_hash text,p_test boolean default false
) returns boolean language plpgsql stable security definer set search_path=''
as $$
begin
  if p_test is distinct from true then
    raise exception using errcode='42501',message='jurisdiction unavailable';
  end if;
  if p_completion_nonce_hash is null or p_completion_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_csrf_hash is null or p_csrf_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  -- Every credential filters the row, as the authorizer's does, so a foreign
  -- caller learns nothing. Absent digests (never configured) never match.
  return exists(select 1 from public.embryo_ingest_sessions s
    where s.id=p_session and s.account_id=p_account and s.originating_session_id=p_auth
      and s.cookie_hash=p_cookie_hash and s.origin=p_origin and s.upload_id is not null
      and s.issued_completion_nonce_hash=p_completion_nonce_hash
      and s.issued_csrf_hash=p_csrf_hash);
end $$;
revoke all on function private.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)
  to service_role;

-- The public doors, and nothing else (as 20260921150000): security invoker,
-- so the inner EXECUTE check against the caller is the real barrier.
create function public.fail_embryo_ingest_attempt_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_cohort_id uuid,p_ingest_revision bigint,p_code text,p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.fail_embryo_ingest_attempt_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_cohort_id,p_ingest_revision,p_code,p_test_jurisdiction);
$$;
create function public.embryo_ingest_issued_tokens_match_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_completion_nonce_hash text,p_csrf_hash text,p_test_jurisdiction boolean default false
) returns boolean language sql stable security invoker set search_path='' as $$
  select private.embryo_ingest_issued_tokens_match_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_completion_nonce_hash,p_csrf_hash,p_test_jurisdiction);
$$;
revoke all on function public.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean),
  public.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.fail_embryo_ingest_attempt_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,boolean),
  public.embryo_ingest_issued_tokens_match_v1(uuid,uuid,uuid,text,text,text,text,boolean)
  to service_role;
