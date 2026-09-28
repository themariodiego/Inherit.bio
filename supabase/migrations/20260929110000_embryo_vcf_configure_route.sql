-- ADR 0035: the one transaction behind api.embryo-ingest-configure
-- (POST /api/embryo-ingest/[session]/configure). TEST-LOCAL only: every
-- function below reaches public.authorize_embryo_ingest_request_v1, whose
-- first statement refuses unless p_test_jurisdiction is true, and
-- EMBRYO_INGEST_AVAILABLE stays false. No genotype byte, Storage object,
-- fragment, job or publication is written here.
--
-- What the route sends is already decided in memory: the build from the
-- source's ##fileformat/##reference/##contig lines by the product parser's
-- header rule (null when it names none, or conflicting builds), and the
-- submitted sample count. No source line or derivative of one reaches this
-- database. The route also sends three fresh random values, which are stored
-- as SHA-256 digests only:
--   * the transport challenge every chunk header must repeat;
--   * the inner nonce of the one-time completion nonce;
--   * the inner nonce of the upload-session-bound X-Inherit-CSRF token.
-- The random positive transport revision is drawn here.

-- 1. Hash-only transport issuance on the session row.
-- The raw challenge minted with the session (transport_challenge) is never
-- handed to anyone (cohort-created-v1 withholds it). Issuing the real one
-- clears it, so no raw challenge survives configuration.
-- The two token digests are what was ISSUED. They are deliberately not named
-- completion_nonce_hash: the completion transaction records under that name
-- the nonce it actually consumed, and should require it to equal
-- issued_completion_nonce_hash.
alter table public.embryo_ingest_sessions
  add column transport_challenge_hash text check (transport_challenge_hash ~ '^[0-9a-f]{64}$'),
  add column issued_completion_nonce_hash text check (issued_completion_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column issued_csrf_hash text check (issued_csrf_hash ~ '^[0-9a-f]{64}$'),
  add constraint embryo_ingest_transport_issue_shape check (
    (transport_challenge_hash is null and issued_completion_nonce_hash is null and issued_csrf_hash is null)
    or (transport_challenge_hash is not null and issued_completion_nonce_hash is not null
      and issued_csrf_hash is not null and transport_challenge is null
      and issued_completion_nonce_hash<>issued_csrf_hash)
  );

-- Issued once. Neither a later request nor a privileged writer can swap the
-- challenge, revision or either token digest for another.
create function private.freeze_embryo_transport_issue_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.transport_challenge_hash is not null and
    (new.transport_challenge,new.transport_challenge_hash,new.transport_revision,
      new.issued_completion_nonce_hash,new.issued_csrf_hash) is distinct from
    (old.transport_challenge,old.transport_challenge_hash,old.transport_revision,
      old.issued_completion_nonce_hash,old.issued_csrf_hash) then
    raise exception using errcode='55000',message='immutable ingest transport';
  end if;
  return new;
end $$;
create trigger embryo_transport_issue_immutable before update on public.embryo_ingest_sessions
  for each row execute function private.freeze_embryo_transport_issue_v1();
revoke all on function private.freeze_embryo_transport_issue_v1() from public,anon,authenticated;

-- 2. The authorizer returns the challenge's digest, never a raw challenge.
-- Identical to 20260905202656 except the one key: 'challengeHash' (null until
-- the configure route issues one) replaces 'challenge'. A chunk route
-- compares the digest of the challenge a chunk header carries.
create or replace function public.authorize_embryo_ingest_request_v1(
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
    'ingestRevision',s.ingest_revision,'expiresAt',s.expires_at,'challengeHash',s.transport_challenge_hash,
    'transportRevision',s.transport_revision,'build',s.reference_build,'format',s.source_format,
    'sampleCount',v_count,'handles',v_handles);
end;
$$;
revoke all on function public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.authorize_embryo_ingest_request_v1(uuid,uuid,uuid,text,text,boolean)
  to service_role;

-- 3. The configure transaction.
--
-- Selection (embryo-vcf-transport-v1.selection): the header build is decided
-- before the sample count. A null build is build_unknown; a count of one is
-- cohort_single_sample; any other difference from the cohort's immutable
-- embryo count (or a cohort of fewer than two) is sample_count_mismatch.
-- Each terminal branch consumes the nonce and marks the attempt
-- failure-pending in this transaction, preserving the session, its fixed
-- due target, handles and every attempt-owned row for the one
-- attemptFailure unwind the route dispatches next.
--
-- Success records format and build through the existing
-- private.configure_embryo_ingest_session_v1 (which consumes the nonce and
-- rechecks the same credential-bound authority), then issues the transport.
-- An exact retry of the same values is idempotent; the same nonce with any
-- other value is refused, as a mapping challenge's is.
create function private.configure_embryo_vcf_ingest_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_build text,p_sample_count bigint,
  p_nonce text,p_challenge text,p_completion_nonce text,p_csrf_nonce text,
  p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; r jsonb; s public.embryo_ingest_sessions%rowtype; v_count integer;
  h_nonce text; h_challenge text; h_completion text; h_csrf text; v_branch text; v_revision bigint;
begin
  if (p_build is not null and p_build not in ('GRCh37','GRCh38'))
    or p_sample_count is null or p_sample_count<1
    or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256
    or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
    or p_completion_nonce is null or p_completion_nonce !~ '^[A-Za-z0-9_-]+$'
    or length(p_completion_nonce) not between 16 and 256
    or p_csrf_nonce is null or p_csrf_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_csrf_nonce) not between 16 and 256
    or p_completion_nonce in (p_nonce,p_csrf_nonce) or p_csrf_nonce=p_nonce then
    raise exception using errcode='22023',message='invalid ingest configuration';
  end if;
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;

  h_nonce:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
  h_challenge:=encode(extensions.digest(convert_to(p_challenge,'UTF8'),'sha256'),'hex');
  h_completion:=encode(extensions.digest(convert_to(p_completion_nonce,'UTF8'),'sha256'),'hex');
  h_csrf:=encode(extensions.digest(convert_to(p_csrf_nonce,'UTF8'),'sha256'),'hex');
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;

  if s.configuration_nonce_hash is not null then
    if (s.configuration_nonce_hash,s.source_format,s.configured_build,s.build_evidence,
        s.transport_challenge_hash,s.issued_completion_nonce_hash,s.issued_csrf_hash)
      is not distinct from (h_nonce,'vcf',p_build,'explicit-header',h_challenge,h_completion,h_csrf) then
      return jsonb_build_object('status','configured','build',s.configured_build,'revision',s.transport_revision);
    end if;
    raise exception using errcode='55000',message='ingest configuration already fixed';
  end if;
  if s.status<>'open' or s.source_format is not null or s.reference_build is not null
    or s.transport_challenge_hash is not null
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id)
    or exists(select 1 from public.embryo_mapping_challenges where ingest_session_id=s.id) then
    raise exception using errcode='55000',message='ingest configuration unavailable';
  end if;

  select embryo_count into strict v_count from public.embryo_cohorts where id=s.cohort_id;
  v_branch:=case
    when p_build is null then 'build_unknown'
    when p_sample_count=1 then 'cohort_single_sample'
    when v_count<2 or p_sample_count<>v_count then 'sample_count_mismatch'
  end;
  if v_branch is not null then
    perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_auth,
      'ingest_configure','ingest_session',s.id);
    perform private.mark_embryo_ingest_failure_v1(s.id,
      case v_branch when 'build_unknown' then 'build' else 'header' end);
    return jsonb_build_object('status','terminal','branch',v_branch,
      'cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;

  r:=private.configure_embryo_ingest_session_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,'vcf',p_build,'explicit-header',p_nonce,p_test);
  if r->>'status'='failure_pending' then return r; end if;
  -- Positive, random, at most 2^48+1 (a safe integer), and never the minted 1.
  v_revision:=2+('x'||encode(extensions.gen_random_bytes(6),'hex'))::bit(48)::bigint;
  update public.embryo_ingest_sessions set transport_challenge=null,
    transport_challenge_hash=h_challenge,transport_revision=v_revision,
    issued_completion_nonce_hash=h_completion,issued_csrf_hash=h_csrf
    where id=s.id;
  return jsonb_build_object('status','configured','build',p_build,'revision',v_revision);
end $$;
revoke all on function private.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)
  to service_role;

-- 4. The public door, and nothing else (as 20260921130000 and 20260921150000):
-- PostgREST exposes only public. Security invoker, so the inner EXECUTE check
-- against the caller is a second barrier behind the revoke.
create function public.configure_embryo_vcf_ingest_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,
  p_origin text,p_cohort_id uuid,p_ingest_revision bigint,p_build text,p_sample_count bigint,
  p_nonce text,p_challenge text,p_completion_nonce text,p_csrf_nonce text,
  p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.configure_embryo_vcf_ingest_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_cohort_id,p_ingest_revision,p_build,p_sample_count,
    p_nonce,p_challenge,p_completion_nonce,p_csrf_nonce,p_test_jurisdiction);
$$;
revoke all on function public.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.configure_embryo_vcf_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,bigint,text,text,text,text,boolean)
  to service_role;
