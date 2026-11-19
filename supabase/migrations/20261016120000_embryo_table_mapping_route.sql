-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Every function below is TEST-LOCAL only and
-- EMBRYO_INGEST_AVAILABLE stays false.
-- =====================================================================
--
-- ADR 0037 (owner decisions of 16 October 2026, docs/protocol/decisions.md
-- "Genome build for laboratory-table embryo sessions" and "Token rotation in
-- the embryo mapping responses"): the laboratory-table half of embryo
-- ingest, behind api.embryo-ingest-configure, api.embryo-ingest-mapping,
-- api.embryo-ingest-chunk and the split_cohort_vcf worker.
--
--   1. Configure records a table session as `pgt_table`. Its build comes
--      from the file header when the header states one (`explicit-header`);
--      otherwise it is `decision-required`. No position-based inference.
--      The configure transaction stores the digest of the one mapping
--      inspection nonce it issues.
--   2. The mapping POST consumes that nonce once. Header refusals decided
--      in memory (a forbidden sex, gender, karyotype or proxy column, a
--      file that is not a table, a mapping beyond four decisions) are
--      terminal here. Otherwise it records the server-derived locus kind and
--      issues exactly one of: a column challenge, a build challenge, or the
--      transport (challenge, revision, completion nonce, CSRF token).
--   3. The mapping PUT resolves the current challenge through the existing
--      private.resolve_embryo_mapping_challenge_v1 and, in the same
--      transaction, issues the next challenge or the transport. `unknown`
--      is terminal. Every issued nonce is stored as a digest bound to the
--      challenge it answers.
--   4. The chunk route reads the recorded locus kind through a
--      credential-filtered read. Table chunks stay refused until the build
--      is resolved and the transport issued (the existing fragment trigger).
--   5. The worker claims table attempts, stages table genotypes with no
--      reference allele (a laboratory table carries none, as a consumer
--      array does not) and publishes each table source under a neutral
--      table name and type.
--
-- No source header, label, candidate set or example value reaches this
-- database. The locus kind is one closed canonical value.

-- ---------------------------------------------------------------------------
-- 1. Columns and write-once triggers
-- ---------------------------------------------------------------------------
alter table public.embryo_ingest_sessions
  add column issued_mapping_nonce_hash text check (issued_mapping_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column table_locus text check (table_locus in ('rsid','chrom-pos'));
alter table public.embryo_ingest_sessions
  add constraint embryo_ingest_table_mapping_shape check (
    (issued_mapping_nonce_hash is null and table_locus is null) or source_format is not distinct from 'pgt_table');

create function private.freeze_embryo_table_mapping_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if (old.issued_mapping_nonce_hash is not null
      and new.issued_mapping_nonce_hash is distinct from old.issued_mapping_nonce_hash)
    or (old.table_locus is not null and new.table_locus is distinct from old.table_locus) then
    raise exception using errcode='55000',message='immutable table mapping';
  end if;
  return new;
end $$;
create trigger embryo_table_mapping_immutable before update on public.embryo_ingest_sessions
  for each row execute function private.freeze_embryo_table_mapping_v1();
revoke all on function private.freeze_embryo_table_mapping_v1() from public,anon,authenticated;

-- The nonce a challenge may be answered with, issued in the response that
-- carried the challenge. Older challenges (none exist) have no such nonce
-- and can never be answered through the decision door below.
alter table public.embryo_mapping_challenges
  add column decision_nonce_hash text unique check (decision_nonce_hash ~ '^[0-9a-f]{64}$');

-- Identical to 20260927120000 except that the issued decision nonce joins
-- the frozen identity.
create or replace function private.freeze_embryo_mapping_challenge_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.ingest_session_id,new.mapping_revision,new.handle_manifest_fingerprint,
      new.expires_at,new.created_at,new.challenge_hash,new.challenge_kind,new.column_count,
      new.transport_revision,new.inspection_nonce_hash,new.decision_nonce_hash) is distinct from
    (old.id,old.ingest_session_id,old.mapping_revision,old.handle_manifest_fingerprint,
      old.expires_at,old.created_at,old.challenge_hash,old.challenge_kind,old.column_count,
      old.transport_revision,old.inspection_nonce_hash,old.decision_nonce_hash)
    or (old.state<>'pending' and new is distinct from old) then
    raise exception using errcode='55000',message='immutable mapping challenge';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (no service grant)
-- ---------------------------------------------------------------------------
create function private.embryo_table_token_ok_v1(p_value text)
returns boolean language sql immutable set search_path='' as $$
  select p_value is not null and p_value ~ '^[A-Za-z0-9_-]+$' and length(p_value) between 16 and 256
$$;
create function private.embryo_table_digest_v1(p_value text)
returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex')
$$;

-- One pending challenge for a locked, configured table session. The caller
-- holds the session lock and has already consumed the nonce that created it.
create function private.issue_embryo_table_challenge_v1(
  p_session uuid,p_kind text,p_column_count integer,p_challenge text,
  p_creating_nonce_hash text,p_decision_nonce text,p_manifest text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; c public.embryo_mapping_challenges%rowtype; v_revision bigint;
begin
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.source_format is distinct from 'pgt_table' or s.configuration_nonce_hash is null
    or s.status not in ('open','mapping_required') or s.transport_challenge_hash is not null
    or s.table_locus is null
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id)
    or (p_kind='build' and (s.reference_build is not null or s.build_evidence is distinct from 'decision-required'))
    or p_kind not in ('columns','build')
    or (p_kind='columns' and (p_column_count is null or p_column_count not between 1 and 128))
    or (p_kind='build' and p_column_count is not null)
    or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
    or not private.embryo_table_token_ok_v1(p_decision_nonce)
    or p_creating_nonce_hash is null or p_creating_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_manifest is null or p_manifest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='55000',message='mapping challenge unavailable';
  end if;
  update public.embryo_mapping_challenges set state='cancelled'
    where ingest_session_id=s.id and state='pending';
  v_revision:=1+('x'||encode(extensions.gen_random_bytes(6),'hex'))::bit(48)::bigint;
  insert into public.embryo_mapping_challenges(ingest_session_id,mapping_revision,
    handle_manifest_fingerprint,state,expires_at,challenge_hash,challenge_kind,column_count,
    transport_revision,inspection_nonce_hash,decision_nonce_hash)
  values(s.id,v_revision,p_manifest,'pending',least(s.expires_at,clock_timestamp()+interval '10 minutes'),
    private.embryo_table_digest_v1(p_challenge),p_kind,p_column_count,s.transport_revision,
    p_creating_nonce_hash,private.embryo_table_digest_v1(p_decision_nonce)) returning * into c;
  update public.embryo_ingest_sessions set status='mapping_required' where id=s.id;
  return jsonb_build_object('status','challenge','kind',c.challenge_kind,'revision',c.mapping_revision,
    'expiresAt',c.expires_at);
end $$;

-- The transport of a table session, issued once and only when nothing is
-- left to decide: a resolved build, a recorded locus, no pending challenge,
-- no chunk. Stored as digests only, exactly as the VCF configure route does
-- (20260929110000), with a random positive revision that is never the minted 1.
create function private.issue_embryo_table_transport_v1(
  p_session uuid,p_challenge text,p_completion_nonce text,p_csrf_nonce text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; v_revision bigint;
begin
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.source_format is distinct from 'pgt_table' or s.configuration_nonce_hash is null
    or s.reference_build is null or s.status<>'open' or s.transport_challenge_hash is not null
    or s.table_locus is null
    or exists(select 1 from public.embryo_mapping_challenges where ingest_session_id=s.id and state='pending')
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id)
    or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
    or not private.embryo_table_token_ok_v1(p_completion_nonce)
    or not private.embryo_table_token_ok_v1(p_csrf_nonce) or p_completion_nonce=p_csrf_nonce then
    raise exception using errcode='55000',message='table transport unavailable';
  end if;
  v_revision:=2+('x'||encode(extensions.gen_random_bytes(6),'hex'))::bit(48)::bigint;
  update public.embryo_ingest_sessions set transport_challenge=null,
    transport_challenge_hash=private.embryo_table_digest_v1(p_challenge),transport_revision=v_revision,
    issued_completion_nonce_hash=private.embryo_table_digest_v1(p_completion_nonce),
    issued_csrf_hash=private.embryo_table_digest_v1(p_csrf_nonce)
    where id=s.id;
  return jsonb_build_object('status','transport','build',s.reference_build,'revision',v_revision);
end $$;

revoke all on function private.embryo_table_token_ok_v1(text),private.embryo_table_digest_v1(text),
  private.issue_embryo_table_challenge_v1(uuid,text,integer,text,text,text,text),
  private.issue_embryo_table_transport_v1(uuid,text,text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- ---------------------------------------------------------------------------
-- 3. Configure a laboratory table (api.embryo-ingest-configure, table body)
-- ---------------------------------------------------------------------------
-- p_build is what the route derived in memory from the table's own
-- ##reference/##contig header lines through the product header rule, or
-- null when the header states no single build. A null build records
-- `decision-required`; any build records `explicit-header`. The operation
-- nonce is consumed through private.configure_embryo_ingest_session_v1,
-- and only the digest of the one mapping-inspection nonce is kept.
create function private.configure_embryo_table_ingest_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_build text,p_nonce text,p_mapping_nonce text,
  p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; r jsonb; s public.embryo_ingest_sessions%rowtype; h_nonce text; h_mapping text; v_evidence text;
begin
  if (p_build is not null and p_build not in ('GRCh37','GRCh38'))
    or not private.embryo_table_token_ok_v1(p_nonce) or not private.embryo_table_token_ok_v1(p_mapping_nonce)
    or p_mapping_nonce=p_nonce then
    raise exception using errcode='22023',message='invalid ingest configuration';
  end if;
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  h_nonce:=private.embryo_table_digest_v1(p_nonce);
  h_mapping:=private.embryo_table_digest_v1(p_mapping_nonce);
  v_evidence:=case when p_build is null then 'decision-required' else 'explicit-header' end;
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.configuration_nonce_hash is not null then
    if (s.configuration_nonce_hash,s.source_format,s.configured_build,s.build_evidence,s.issued_mapping_nonce_hash)
      is not distinct from (h_nonce,'pgt_table',p_build,v_evidence,h_mapping) then
      return jsonb_build_object('status','configured','build',s.configured_build);
    end if;
    raise exception using errcode='55000',message='ingest configuration already fixed';
  end if;
  if s.status<>'open' or s.source_format is not null or s.reference_build is not null
    or s.transport_challenge_hash is not null
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id)
    or exists(select 1 from public.embryo_mapping_challenges where ingest_session_id=s.id) then
    raise exception using errcode='55000',message='ingest configuration unavailable';
  end if;
  r:=private.configure_embryo_ingest_session_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,'pgt_table',p_build,v_evidence,p_nonce,p_test);
  if r->>'status'='failure_pending' then return r; end if;
  update public.embryo_ingest_sessions set issued_mapping_nonce_hash=h_mapping where id=s.id;
  return jsonb_build_object('status','configured','build',p_build);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Inspect the header (api.embryo-ingest-mapping POST)
-- ---------------------------------------------------------------------------
-- The route has already decided, in memory and from the bounded header copy
-- alone, which outcome applies. It sends only that closed outcome, the
-- column count, the canonical locus kind and fresh random values:
--   columns    a column challenge (column count, challenge, next nonce)
--   build      a build challenge for a decision-required build
--   transport  nothing left to decide: transport challenge, completion
--              nonce and CSRF token
--   header | format | mapping   terminal: a forbidden column, not a table
--              under the header rule, or more than four decisions
-- The inspection nonce must be the one configure issued. A terminal outcome
-- consumes it and marks the attempt failure-pending for the one unwind.
create function private.inspect_embryo_table_mapping_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_outcome text,p_column_count integer,p_locus text,
  p_nonce text,p_challenge text,p_next_nonce text,p_completion_nonce text,p_csrf_nonce text,
  p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; s public.embryo_ingest_sessions%rowtype; h text; v_manifest text; v_result jsonb;
begin
  if p_outcome is null or p_outcome not in ('columns','build','transport','header','format','mapping')
    or not private.embryo_table_token_ok_v1(p_nonce)
    or (p_outcome in ('header','format','mapping') and (p_column_count is not null or p_locus is not null
      or p_challenge is not null or p_next_nonce is not null or p_completion_nonce is not null
      or p_csrf_nonce is not null))
    or (p_outcome in ('columns','build','transport') and (p_locus is null or p_locus not in ('rsid','chrom-pos')
      or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'))
    or (p_outcome='columns' and (p_column_count is null or p_column_count not between 1 and 128))
    or (p_outcome in ('build','transport') and p_column_count is not null)
    or (p_outcome in ('columns','build') and (not private.embryo_table_token_ok_v1(p_next_nonce)
      or p_next_nonce=p_nonce or p_completion_nonce is not null or p_csrf_nonce is not null))
    or (p_outcome='transport' and (p_next_nonce is not null
      or not private.embryo_table_token_ok_v1(p_completion_nonce) or not private.embryo_table_token_ok_v1(p_csrf_nonce)
      or p_completion_nonce=p_csrf_nonce or p_nonce in (p_completion_nonce,p_csrf_nonce))) then
    raise exception using errcode='22023',message='invalid mapping inspection';
  end if;
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  h:=private.embryo_table_digest_v1(p_nonce);
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  -- Only the nonce the table configuration issued inspects this session.
  if s.source_format is distinct from 'pgt_table' or s.issued_mapping_nonce_hash is distinct from h then
    raise exception using errcode='42501',message='mapping unavailable';
  end if;
  -- One inspection per attempt. A repeat cannot be answered again, because
  -- the values the first answer carried exist only as digests.
  if s.table_locus is not null or s.transport_challenge_hash is not null or s.status<>'open'
    or exists(select 1 from public.embryo_mapping_challenges where ingest_session_id=s.id)
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id) then
    raise exception using errcode='55000',message='mapping inspection already recorded';
  end if;
  -- The route's view of the build must be the recorded one.
  if (p_outcome='build' and s.reference_build is not null)
    or (p_outcome='transport' and s.reference_build is null) then
    raise exception using errcode='55000',message='mapping inspection unavailable';
  end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_auth,
    'ingest_mapping_inspect','ingest_session',s.id);
  if p_outcome in ('header','format','mapping') then
    perform private.mark_embryo_ingest_failure_v1(s.id,p_outcome);
    return jsonb_build_object('status','terminal','branch',p_outcome,
      'cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  update public.embryo_ingest_sessions set table_locus=p_locus where id=s.id;
  if p_outcome='transport' then
    return private.issue_embryo_table_transport_v1(s.id,p_challenge,p_completion_nonce,p_csrf_nonce);
  end if;
  v_manifest:=private.embryo_table_digest_v1((a->'handles')::text);
  v_result:=private.issue_embryo_table_challenge_v1(s.id,p_outcome,p_column_count,p_challenge,h,p_next_nonce,v_manifest);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Decide (api.embryo-ingest-mapping PUT)
-- ---------------------------------------------------------------------------
-- p_challenge and p_resolution are the decision; p_nonce is the nonce the
-- previous response issued for this exact challenge. Exactly one next group
-- is sent, chosen by the route from the recorded build:
--   build group      p_build_challenge + p_build_nonce, when a column
--                    decision leaves a decision-required build
--   transport group  p_transport_challenge + p_completion_nonce + p_csrf_nonce,
--                    when nothing is left to decide
-- Resolution, nonce consumption and the next issuance share one
-- transaction. Expired, stale or cross-kind real challenges and `unknown`
-- are terminal through the existing resolver.
create function private.decide_embryo_table_mapping_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_challenge text,p_resolution jsonb,p_nonce text,
  p_build_challenge text,p_build_nonce text,p_transport_challenge text,p_completion_nonce text,
  p_csrf_nonce text,p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; r jsonb; s public.embryo_ingest_sessions%rowtype; c public.embryo_mapping_challenges%rowtype;
  n text; v_build_group boolean; v_transport_group boolean; v_fields text[]; v_manifest text;
begin
  v_build_group:=p_build_challenge is not null or p_build_nonce is not null;
  v_transport_group:=p_transport_challenge is not null or p_completion_nonce is not null or p_csrf_nonce is not null;
  if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or not private.embryo_table_token_ok_v1(p_nonce)
    or p_resolution is null or v_build_group=v_transport_group
    or (v_build_group and (p_build_challenge is null or p_build_challenge !~ '^[A-Za-z0-9_-]{43}$'
      or p_build_challenge=p_challenge or not private.embryo_table_token_ok_v1(p_build_nonce) or p_build_nonce=p_nonce))
    or (v_transport_group and (p_transport_challenge is null or p_transport_challenge !~ '^[A-Za-z0-9_-]{43}$'
      or not private.embryo_table_token_ok_v1(p_completion_nonce) or not private.embryo_table_token_ok_v1(p_csrf_nonce)
      or p_completion_nonce=p_csrf_nonce or p_nonce in (p_completion_nonce,p_csrf_nonce))) then
    raise exception using errcode='22023',message='invalid mapping decision';
  end if;
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.source_format is distinct from 'pgt_table' then
    raise exception using errcode='42501',message='mapping challenge unavailable';
  end if;
  select * into c from public.embryo_mapping_challenges where ingest_session_id=s.id
    and challenge_hash=private.embryo_table_digest_v1(p_challenge) for update;
  if not found then raise exception using errcode='42501',message='mapping challenge unavailable'; end if;
  n:=private.embryo_table_digest_v1(p_nonce);
  -- Only the nonce issued with this challenge answers it.
  if c.decision_nonce_hash is distinct from n then
    raise exception using errcode='42501',message='mapping challenge unavailable';
  end if;
  -- An exact replay of a recorded decision cannot be answered again: what
  -- the first answer issued exists only as digests. Nothing changes.
  if c.state='resolved' and c.resolution_nonce_hash=n and c.resolution=p_resolution then
    raise exception using errcode='55000',message='mapping decision already recorded';
  end if;
  if c.state='pending' then
    -- The next group must be the one the recorded state needs.
    if (c.challenge_kind='columns' and (s.reference_build is null) is distinct from v_build_group)
      or (c.challenge_kind='build' and not v_transport_group) then
      raise exception using errcode='55000',message='mapping decision unavailable';
    end if;
    -- A column decision names fields of the recorded locus kind only. The
    -- resolver below checks the closed vocabulary, indexes and uniqueness.
    if c.challenge_kind='columns' and jsonb_typeof(p_resolution)='array' then
      select array_agg(e->>'field') into v_fields from jsonb_array_elements(p_resolution) e
        where jsonb_typeof(e)='object';
      if (s.table_locus='chrom-pos' and 'rsid'=any(coalesce(v_fields,'{}')))
        or (s.table_locus='rsid' and ('chrom'=any(coalesce(v_fields,'{}')) or 'pos'=any(coalesce(v_fields,'{}')))) then
        raise exception using errcode='22023',message='invalid mapping decision';
      end if;
    end if;
  end if;
  r:=private.resolve_embryo_mapping_challenge_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_challenge,p_resolution,p_nonce,p_test);
  if r->>'status'='failure_pending' then
    select * into strict s from public.embryo_ingest_sessions where id=p_session;
    if c.challenge_kind='build' and s.failure_code='build' and p_resolution->>'referenceBuild'='unknown' then
      return jsonb_build_object('status','terminal','branch','build_unknown',
        'cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
    end if;
    return r;
  end if;
  if r->>'status' is distinct from 'resolved' or r->>'kind' is distinct from c.challenge_kind then
    raise exception using errcode='55000',message='mapping decision unavailable';
  end if;
  if v_build_group then
    v_manifest:=private.embryo_table_digest_v1((a->'handles')::text);
    return private.issue_embryo_table_challenge_v1(s.id,'build',null,p_build_challenge,n,p_build_nonce,v_manifest);
  end if;
  return private.issue_embryo_table_transport_v1(s.id,p_transport_challenge,p_completion_nonce,p_csrf_nonce);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The locus kind a table chunk must carry (api.embryo-ingest-chunk)
-- ---------------------------------------------------------------------------
-- A read: every credential filters the row, as the issued-token check does,
-- and nothing is locked or marked. Null until the transport is issued, so a
-- table chunk can never bind before every decision is made.
create function private.embryo_ingest_table_locus_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,p_test boolean default false
) returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_test is distinct from true then
    raise exception using errcode='42501',message='jurisdiction unavailable';
  end if;
  return (select s.table_locus from public.embryo_ingest_sessions s
    where s.id=p_session and s.account_id=p_account and s.originating_session_id=p_auth
      and s.cookie_hash=p_cookie_hash and s.origin=p_origin and s.upload_id is not null
      and s.source_format='pgt_table' and s.reference_build is not null
      and s.transport_challenge_hash is not null and s.status='open');
end $$;

revoke all on function
  private.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean),
  private.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean),
  private.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean),
  private.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function
  private.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean),
  private.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean),
  private.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean),
  private.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)
  to service_role;

-- The public doors, and nothing else (as 20260929110000): security invoker,
-- so the inner EXECUTE check against the caller is the real barrier.
create function public.configure_embryo_table_ingest_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_cohort_id uuid,p_ingest_revision bigint,p_build text,p_nonce text,p_mapping_nonce text,
  p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.configure_embryo_table_ingest_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_cohort_id,p_ingest_revision,p_build,p_nonce,p_mapping_nonce,p_test_jurisdiction);
$$;
create function public.inspect_embryo_table_mapping_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_cohort_id uuid,p_ingest_revision bigint,p_outcome text,p_column_count integer,p_locus text,
  p_nonce text,p_challenge text,p_next_nonce text,p_completion_nonce text,p_csrf_nonce text,
  p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.inspect_embryo_table_mapping_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_cohort_id,p_ingest_revision,p_outcome,p_column_count,p_locus,
    p_nonce,p_challenge,p_next_nonce,p_completion_nonce,p_csrf_nonce,p_test_jurisdiction);
$$;
create function public.decide_embryo_table_mapping_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_cohort_id uuid,p_ingest_revision bigint,p_challenge text,p_resolution jsonb,p_nonce text,
  p_build_challenge text,p_build_nonce text,p_transport_challenge text,p_completion_nonce text,
  p_csrf_nonce text,p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.decide_embryo_table_mapping_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_cohort_id,p_ingest_revision,p_challenge,p_resolution,p_nonce,
    p_build_challenge,p_build_nonce,p_transport_challenge,p_completion_nonce,p_csrf_nonce,p_test_jurisdiction);
$$;
create function public.embryo_ingest_table_locus_v1(
  p_account_id uuid,p_auth_session_id uuid,p_ingest_session_id uuid,p_cookie_hash text,p_origin text,
  p_test_jurisdiction boolean default false
) returns text language sql stable security invoker set search_path='' as $$
  select private.embryo_ingest_table_locus_v1(p_account_id,p_auth_session_id,p_ingest_session_id,
    p_cookie_hash,p_origin,p_test_jurisdiction);
$$;
revoke all on function
  public.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean),
  public.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean),
  public.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean),
  public.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function
  public.configure_embryo_table_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,boolean),
  public.inspect_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,integer,text,text,text,text,text,text,boolean),
  public.decide_embryo_table_mapping_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,text,text,text,text,text,boolean),
  public.embryo_ingest_table_locus_v1(uuid,uuid,uuid,text,text,boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. The worker: claim, stage and publish table attempts
-- ---------------------------------------------------------------------------
-- A laboratory table carries no reference allele, so a table genotype is
-- stored with none, as a consumer array's is. A table row never claims an
-- alternate allele either. Both remain required for every VCF row.
alter table private.embryo_split_variants alter column reference_allele drop not null;
alter table private.embryo_split_variants
  add constraint embryo_split_variants_table_alleles check (reference_allele is not null or alternate_allele is null);

-- Identical to 20260930121000 except that a table attempt is now claimed;
-- only a gVCF (which no configure path records) still ends with `format`.
create or replace function private.claim_embryo_split_job_v1(p_claim_token_hash text, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  candidate record;
  s public.embryo_ingest_sessions%rowtype;
  w public.worker_jobs%rowtype;
  v_now timestamptz;
  v_failed jsonb;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$'
    or p_worker_id is null or p_worker_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception using errcode = '22023', message = 'invalid split claim';
  end if;
  if not exists (select 1 from private.embryo_split_config where singleton and enabled for share) then
    raise exception using errcode = '55000', message = 'embryo split disabled';
  end if;
  for candidate in select w0.id, w0.source_binding_id from public.worker_jobs w0
    where w0.kind = 'split_cohort_vcf' and (
      (w0.status = 'queued' and w0.not_before <= clock_timestamp())
      or (w0.status = 'running' and w0.claim_expires_at
        + make_interval(secs => 30 * power(2, w0.attempts)::integer) <= clock_timestamp()))
    order by w0.created_at, w0.id limit 5
  loop
    select * into s from public.embryo_ingest_sessions where id = candidate.source_binding_id
      for update skip locked;
    if not found then continue; end if;
    select * into w from public.worker_jobs where id = candidate.id for update skip locked;
    if not found then continue; end if;
    v_now := clock_timestamp();
    if w.kind <> 'split_cohort_vcf' or not (
      (w.status = 'queued' and w.not_before <= v_now)
      or (w.status = 'running' and w.claim_expires_at
        + make_interval(secs => 30 * power(2, w.attempts)::integer) <= v_now)) then
      continue;
    end if;
    if s.worker_job_id is distinct from w.id then
      -- A job no attempt is bound to has no authority to run.
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if s.status = 'failure_pending' then
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if s.status not in ('sanitization_pending', 'processing') then
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if w.attempts >= w.max_attempts then
      perform private.fail_embryo_split_v1(s.id, w.id, 'retry-exhaustion', 'failed');
      continue;
    end if;
    v_failed := private.recheck_embryo_split_binding_v1(s.id, w.id);
    if v_failed is not null then continue; end if;
    if s.source_format is null or s.source_format not in ('vcf', 'pgt_table') then
      -- The VCF and laboratory-table configure paths are registered (ADR
      -- 0035, ADR 0037); any other format has no fragment reader and ends
      -- with a closed code.
      perform private.fail_embryo_split_v1(s.id, w.id, 'format', 'failed');
      continue;
    end if;
    delete from private.embryo_split_variants where session_id = s.id;
    delete from private.embryo_split_ordinals where session_id = s.id;
    update public.worker_jobs
      set status = 'running', attempts = attempts + 1, claim_token_hash = p_claim_token_hash,
        claim_expires_at = least(v_now + interval '5 minutes', s.expires_at),
        claimed_by = p_worker_id, started_at = coalesce(started_at, v_now),
        progress_note = 'splitting'
      where id = w.id;
    update public.embryo_ingest_sessions set status = 'processing'
      where id = s.id and status = 'sanitization_pending';
    return private.embryo_split_claim_receipt_v1(w.id);
  end loop;
  return null;
end $$;

-- Identical to 20260930121000 except for the table branch: a table row has
-- no reference or alternate allele and its genotype is called literal
-- alleles only. A VCF row keeps every original rule, including that the
-- genotype's alleles are present at the locus.
create or replace function private.stage_embryo_split_variants_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text,
  p_ordinal integer, p_batch integer, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; w public.worker_jobs%rowtype; s public.embryo_ingest_sessions%rowtype;
  v_count integer; v_next integer; v_inserted integer; v_table boolean;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select embryo_count into strict v_count from public.embryo_cohorts where id = s.cohort_id;
  v_table := s.source_format = 'pgt_table';
  if p_ordinal is null or p_ordinal < 0 or p_ordinal >= v_count
    or exists (select 1 from private.embryo_split_ordinals o
      where o.session_id = s.id and o.sample_ordinal = p_ordinal) then
    raise exception using errcode = '22023', message = 'invalid split batch';
  end if;
  select coalesce(max(v.batch) + 1, 0) into v_next from private.embryo_split_variants v
    where v.session_id = s.id and v.sample_ordinal = p_ordinal;
  if p_batch is distinct from v_next or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
    or exists (select 1 from jsonb_array_elements(p_rows) r(value) where
      jsonb_typeof(r.value) is distinct from 'array' or jsonb_array_length(r.value) <> 5
      or jsonb_typeof(r.value->0) is distinct from 'number' or (r.value->>0) !~ '^([1-9]|1[0-9]|2[0-2])$'
      or jsonb_typeof(r.value->1) is distinct from 'number' or (r.value->>1) !~ '^[1-9][0-9]{0,9}$'
      or (r.value->>1)::bigint > 2147483647
      or jsonb_typeof(r.value->4) is distinct from 'string' or (r.value->>4) !~ '^[ACGTN]+(/[ACGTN]+)*$'
      or (v_table and (jsonb_typeof(r.value->2) is distinct from 'null'
        or jsonb_typeof(r.value->3) is distinct from 'null' or (r.value->>4) !~ '^[ACGT]+(/[ACGT]+)*$'))
      or (not v_table and (jsonb_typeof(r.value->2) is distinct from 'string' or (r.value->>2) !~ '^[ACGTN]+$'
        or (jsonb_typeof(r.value->3) is distinct from 'null'
          and (jsonb_typeof(r.value->3) is distinct from 'string' or (r.value->>3) !~ '^[ACGTN]+(,[ACGTN]+)*$'))
        or not (string_to_array(r.value->>4, '/') <@
          (array[r.value->>2] || coalesce(string_to_array(r.value->>3, ','), '{}'::text[])))))) then
    raise exception using errcode = '22023', message = 'invalid split batch';
  end if;
  insert into private.embryo_split_variants (session_id, sample_ordinal, worker_job_id, attempt,
    batch, chromosome, position, reference_allele, alternate_allele, genotype)
  select s.id, p_ordinal, w.id, w.attempts, p_batch, (r.value->>0)::smallint, (r.value->>1)::integer,
    r.value->>2, r.value->>3, r.value->>4
  from jsonb_array_elements(p_rows) with ordinality r(value, n) order by r.n;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('status', 'staged', 'batch', p_batch, 'rows', v_inserted);
end $$;

-- Identical to 20261001011000 except that a laboratory-table source is named
-- and typed as the table it is: its canonical parts are the sanitized table
-- fragments, never a VCF. The name stays a neutral server label.
create or replace function private.publish_embryo_split_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  v_failed jsonb;
  w public.worker_jobs%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype;
  v_ordinal private.embryo_split_ordinals%rowtype;
  v_embryo public.embryos%rowtype;
  v_now timestamptz;
  v_passed integer;
  v_qc_failed integer;
  v_cancelled integer;
  v_file uuid;
  v_parts uuid[];
  v_bytes bigint;
  v_rows integer;
begin
  -- Session, then authority rows, then the job: the claim's lock order. This
  -- reruns the binding check and recomputes the manifest digest.
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select * into strict c from public.embryo_cohorts where id = s.cohort_id for update;

  -- The whole ordinal set, recorded by this attempt and no other.
  perform 1 from private.embryo_split_ordinals where session_id = s.id order by sample_ordinal for update;
  if (select count(*) from private.embryo_split_ordinals o where o.session_id = s.id
      and o.worker_job_id = w.id and o.attempt = w.attempts
      and o.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and (o.worker_job_id <> w.id or o.attempt <> w.attempts)) then
    raise exception using errcode = '22023', message = 'split incomplete';
  end if;

  -- Pending genotypes belong only to a passed embryo of this attempt, and
  -- every pass accounts for exactly its own rows and its own fragments. An
  -- inconsistency rolls back; the next attempt starts again from nothing.
  if exists (select 1 from private.embryo_split_variants v where v.session_id = s.id
      and (v.worker_job_id <> w.id or v.attempt <> w.attempts or not exists (
        select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = v.sample_ordinal and o.outcome = 'passed')))
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and o.outcome = 'passed' and (
        o.variant_count <> (select count(*) from private.embryo_split_variants v
          where v.session_id = s.id and v.sample_ordinal = o.sample_ordinal)
        or o.source_sha256 is distinct from private.embryo_split_source_sha256_v1(s.id, o.sample_ordinal))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- Canonical parts: a pass holds exactly one landed part of this attempt per
  -- fragment, byte-identical to it by size and SHA-256; a failure holds none.
  perform 1 from private.embryo_canonical_parts where session_id = s.id order by id for update;
  if exists (select 1 from private.embryo_split_ordinals o
      join public.embryo_ingest_fragments f on f.session_id = o.session_id and f.sample_ordinal = o.sample_ordinal
      where o.session_id = s.id and o.outcome = 'passed' and not exists (
        select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id and p.attempt = w.attempts
          and p.session_id = s.id and p.sample_ordinal = f.sample_ordinal and p.sequence = f.sequence
          and p.state = 'landed' and p.sha256 = f.content_sha256 and p.observed_sha256 = f.content_sha256
          and p.byte_count = f.byte_count))
    or exists (select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id
      and p.attempt = w.attempts and (p.session_id <> s.id
        or not exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = p.sample_ordinal and o.outcome = 'passed')
        or not exists (select 1 from public.embryo_ingest_fragments f where f.session_id = s.id
          and f.sample_ordinal = p.sample_ordinal and f.sequence = p.sequence))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- The one-to-one reservation made at finalization, untouched until now.
  perform 1 from public.embryos where cohort_id = c.id order by sample_ordinal for update;
  perform 1 from public.subjects where cohort_id = c.id order by id for update;
  if (select count(*) from public.embryos e join public.subjects sub on sub.id = e.subject_id
      where e.cohort_id = c.id and sub.cohort_id = c.id and sub.subject_class = 'embryo'
        and sub.lifecycle = 'quarantined' and e.status = 'pending'
        and e.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or (select count(*) from public.embryos e where e.cohort_id = c.id) <> c.embryo_count
    or (select count(*) from public.subjects sub where sub.cohort_id = c.id) <> c.embryo_count
    or exists (select 1 from public.embryo_qc q join public.embryos e on e.id = q.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_variants v join public.embryos e on e.id = v.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_scores x join public.embryos e on e.id = x.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.genome_files f join public.subjects sub on sub.id = f.subject_id
      where sub.cohort_id = c.id)
    or exists (select 1 from public.genome_files f where f.cohort_id = c.id)
    or exists (select 1 from private.embryo_canonical_sources x where x.cohort_id = c.id)
    or c.publication_revision is not null or c.status <> 'ingesting'
    or c.uploaded_at is not null or c.qc_failed_at is not null then
    return private.fail_embryo_split_v1(s.id, w.id, 'stale-binding', 'cancelled');
  end if;

  v_now := clock_timestamp();
  select count(*) filter (where outcome = 'passed'), count(*) filter (where outcome = 'qc_fail_no_source')
    into v_passed, v_qc_failed from private.embryo_split_ordinals where session_id = s.id;

  if exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id and o.figure_basis is null) then
    raise exception using errcode = '22023', message = 'unclassified split QC';
  end if;

  -- One QC row per embryo, measured from its own calls only. What the file
  -- does not report stays null; nothing is estimated or imputed.
  insert into public.embryo_qc (embryo_id, sites_expected, sites_called, call_rate, autosomal_het_rate,
    mean_depth, parent_a_concordance, parent_b_concordance, allelic_dropout_estimate,
    imputation_performed, imputation_panel, contamination_estimate, qc_verdict, qc_reasons, computed_at, figure_basis)
  select e.id, o.sites_expected, o.sites_called, o.call_rate, o.autosomal_het_rate, o.mean_depth,
    null, null, null, false, null, null, o.qc_verdict,
    case when o.failure_reason is not null and not (o.failure_reason = any (o.qc_reasons))
      then o.qc_reasons || o.failure_reason else o.qc_reasons end,
    v_now, o.figure_basis
  from private.embryo_split_ordinals o
  join public.embryos e on e.cohort_id = c.id and e.sample_ordinal = o.sample_ordinal
  where o.session_id = s.id;

  -- Each passed embryo, alone: its canonical source over its own landed
  -- parts, one `genome_files` row bound to its own digest and complete, and
  -- its own genotypes pointing at that row. A failed embryo gets none of it.
  for v_ordinal in select * from private.embryo_split_ordinals x where x.session_id = s.id and x.outcome = 'passed'
    order by x.sample_ordinal
  loop
    select * into strict v_embryo from public.embryos x where x.cohort_id = c.id and x.sample_ordinal = v_ordinal.sample_ordinal;
    select array_agg(p.id order by p.sequence), sum(p.byte_count) into v_parts, v_bytes
      from private.embryo_canonical_parts p
      where p.worker_job_id = w.id and p.attempt = w.attempts and p.sample_ordinal = v_ordinal.sample_ordinal;
    v_file := gen_random_uuid();
    -- The name is a neutral server label, never a laboratory or source name.
    -- There is no single raw object: `sha256` stays null and the composed
    -- digest over the parts is the source digest.
    insert into public.genome_files (id, user_id, bucket_path, original_name, file_type, tier, size_bytes,
      sha256, status, build, variant_count, processing_started_at, processing_finished_at, subject_id,
      cohort_id, is_cohort_file, sample_count, source_publication_state, source_publication_revision,
      source_binding_fingerprint, storage_object_id, structural_validator_version,
      single_logical_sample_verified_at, source_sha256, canonical_build, upload_revision,
      normalization_completed_at, normalization_source_revision)
    values (v_file, c.owner_account_id, 'embryo-source/' || v_file, case when s.source_format = 'pgt_table' then 'embryo-autosomal-source.tsv' else 'embryo-autosomal-source.vcf' end,
      (case when s.source_format = 'pgt_table' then 'pgt_table' else 'vcf' end)::public.genome_file_type, 1, v_bytes,
      null, 'stored', s.reference_build, v_ordinal.variant_count, null, v_now, v_embryo.subject_id,
      null, false, 1, 'published', 1,
      v_ordinal.source_sha256, null, 'embryo-ordinal-fragment-v1',
      v_now, v_ordinal.source_sha256, s.reference_build, 1,
      v_now, 1);
    insert into private.embryo_canonical_sources (file_id, embryo_id, subject_id, cohort_id, sample_ordinal,
      session_id, worker_job_id, attempt, publication_revision, reference_build, source_sha256,
      membership_sha256, part_count, byte_count, variant_count, published_at)
    values (v_file, v_embryo.id, v_embryo.subject_id, c.id, v_ordinal.sample_ordinal, s.id, w.id, w.attempts, 1, s.reference_build,
      v_ordinal.source_sha256, private.embryo_canonical_membership_sha256_v1(v_parts), cardinality(v_parts), v_bytes,
      v_ordinal.variant_count, v_now);
    insert into private.embryo_canonical_source_parts (file_id, part_id, sequence)
      select v_file, p.id, p.sequence from private.embryo_canonical_parts p where p.id = any (v_parts);
    if private.embryo_canonical_source_sha256_v1(v_file) is distinct from v_ordinal.source_sha256 then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
    insert into public.embryo_variants (embryo_id, source_file_id, chromosome, position,
      reference_allele, alternate_allele, genotype, source_binding_fingerprint)
    select v_embryo.id, v_file, v.chromosome, v.position, v.reference_allele, v.alternate_allele, v.genotype,
      v_ordinal.source_sha256
    from private.embryo_split_variants v
    where v.session_id = s.id and v.sample_ordinal = v_ordinal.sample_ordinal
    order by v.batch, v.id;
    get diagnostics v_rows = row_count;
    if v_rows <> v_ordinal.variant_count then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
  end loop;

  update public.embryos e
    set status = case o.qc_verdict when 'pass' then 'qc_pass' when 'marginal' then 'qc_marginal' else 'qc_fail' end
    from private.embryo_split_ordinals o
    where e.cohort_id = c.id and o.session_id = s.id and o.sample_ordinal = e.sample_ordinal;

  -- G5.3: quarantine lifts for every embryo subject at once, and only here.
  update public.subjects set lifecycle = 'active', lifecycle_revision = lifecycle_revision + 1
    where cohort_id = c.id and subject_class = 'embryo' and lifecycle = 'quarantined';

  update public.embryo_cohorts
    set status = 'active', publication_revision = 1,
      uploaded_at = case when v_passed > 0 then v_now end,
      qc_failed_at = case when v_passed = 0 then v_now end
    where id = c.id;

  -- Every ordinal's authoritative deadline, card date and addenda, from this
  -- commit time; a missing required addendum rolls the whole commit back.
  perform private.embryo_publication_dates_v1(c.id, v_now);

  -- The upload-time rights notice, with its withdrawal credential, when the
  -- published set holds a genetic source (upload-time-rights-notice-v1.embryo).
  if v_passed > 0 then
    perform private.enqueue_embryo_upload_notices_v1(c.id, s.id, v_now);
  end if;

  -- Only a success or partial publication cancels the exact due phase.
  update public.retention_due_phases
    set status = 'cancelled', terminal_outcome_code = 'ingest_published', completed_at = v_now
    where retention_id = 'embryo.ingest-session-24h' and phase_id = 'ingest-abandoned-no-source'
      and target_kind = 'ingest_session' and target_id = s.id and phase_revision = s.ingest_revision
      and status in ('pending', 'retry');
  get diagnostics v_cancelled = row_count;
  if v_cancelled <> 1 then
    raise exception using errcode = '55000', message = 'ingest due phase unavailable';
  end if;

  update public.embryo_ingest_sessions set status = 'published' where id = s.id;
  update public.worker_jobs
    set status = 'done', finished_at = v_now, partial = v_qc_failed > 0, progress = 100,
      progress_note = 'complete', claim_token_hash = null, claim_expires_at = null, claimed_by = null
    where id = w.id;

  -- The pending rows are now the published rows; nothing attempt-owned remains
  -- in them. Canonical parts stay: they are the published sources' objects.
  delete from private.embryo_split_variants where session_id = s.id;
  delete from private.embryo_split_ordinals where session_id = s.id;

  perform private.append_legal_audit_event(
    'embryo.cohort.published', null, null, 'accepted',
    jsonb_build_object('embryo_count', c.embryo_count, 'publication_revision', 1));

  return jsonb_build_object('status', 'published', 'publicationRevision', 1,
    'published', v_passed, 'qcFailed', v_qc_failed);
end $$;

