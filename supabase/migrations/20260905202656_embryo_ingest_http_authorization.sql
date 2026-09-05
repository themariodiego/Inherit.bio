-- Server-only credential boundary. Browser credentials are hashed before this
-- RPC; neither the raw cookie nor source headers enter PostgreSQL. This is not
-- a write capability: reservation/commit must recheck authority in their own
-- transaction. Production ingest remains unavailable.
create function public.authorize_embryo_ingest_request_v1(
  p_account_id uuid, p_auth_session_id uuid, p_ingest_session_id uuid,
  p_cookie_hash text, p_origin text, p_test_jurisdiction boolean default false
) returns jsonb language plpgsql security definer
set search_path = '' set lock_timeout = '250ms'
as $$
declare
  s public.embryo_ingest_sessions%rowtype;
  v_failure text;
  v_handles jsonb;
  v_count integer;
begin
  if p_test_jurisdiction is distinct from true then
    raise exception using errcode='42501',message='jurisdiction unavailable';
  end if;
  if p_account_id is null or p_auth_session_id is null or p_ingest_session_id is null
    or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$'
    or p_origin is null or length(p_origin)>255
    or p_origin !~ '^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$'
  then raise exception using errcode='42501',message='ingest unavailable'; end if;

  -- Filter on every credential before locking: a foreign cookie/account must
  -- not cause a denial marker, acquire the target's lock, or reveal its state.
  select * into s from public.embryo_ingest_sessions
    where id=p_ingest_session_id and account_id=p_account_id
      and originating_session_id=p_auth_session_id and cookie_hash=p_cookie_hash
      and origin=p_origin and upload_id is not null
    for update nowait;
  if not found then raise exception using errcode='42501',message='ingest unavailable'; end if;
  if s.status='failure_pending' then
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  if s.status not in ('open','mapping_required') then
    raise exception using errcode='42501',message='ingest unavailable';
  end if;

  -- Contention propagates as 55P03, never as a permanent failure. Invalidated
  -- authority retains the exact due target for the single cohort-wide unwind.
  v_failure:=private.embryo_ingest_binding_failure_v1(s.id);
  if v_failure is null and s.capability_revision is distinct from 1 then v_failure:='stale-binding'; end if;
  if v_failure is not null then
    perform private.mark_embryo_ingest_failure_v1(s.id,v_failure);
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;

  select embryo_count into v_count from public.embryo_cohorts where id=s.cohort_id;
  perform 1 from public.embryo_fragment_handle_maps where session_id=s.id for share nowait;
  select jsonb_agg(jsonb_build_object('ordinal',sample_ordinal,'hash',handle_hash) order by sample_ordinal)
    into v_handles from public.embryo_fragment_handle_maps
    where session_id=s.id and consumed_at is null and expires_at=s.expires_at
      and sample_ordinal>=0 and sample_ordinal<v_count;
  if jsonb_array_length(coalesce(v_handles,'[]'::jsonb))<>v_count or
    (select count(*) from public.embryo_fragment_handle_maps where session_id=s.id)<>v_count then
    perform private.mark_embryo_ingest_failure_v1(s.id,'stale-binding');
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  return jsonb_build_object('status','authorized','session',s.id,'cohortId',s.cohort_id,'uploadId',s.upload_id,
    'ingestRevision',s.ingest_revision,'expiresAt',s.expires_at,'challenge',s.transport_challenge,
    'transportRevision',s.transport_revision,'build',s.reference_build,'format',s.source_format,
    'sampleCount',v_count,'handles',v_handles);
end;
$$;
revoke all on function public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)
  to service_role;
