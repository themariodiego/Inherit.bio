-- Service-only, no-Storage prerequisites for the disabled embryo upload path.
-- The caller must derive format/build evidence from the trusted parser/inference
-- boundary, never copy a request's claimed build or source labels into this API.
-- No route, source writer, worker, publication, or new retention clock is enabled.

alter table public.embryo_ingest_sessions
  add column configuration_nonce_hash text check (configuration_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column configured_build text check (configured_build in ('GRCh37','GRCh38')),
  add column build_evidence text check (build_evidence in ('explicit-header','reference-inference','decision-required'));

alter table public.embryo_operation_nonces
  drop constraint embryo_operation_nonces_target_kind_check,
  add constraint embryo_operation_nonces_target_kind_check check (target_kind in (
    'account','cohort_draft','cohort','embryo','rights_session','form','ingest_session'
  ));

-- Configuration facts are write-once; the sole unresolved build may gain a
-- canonical answer later. Neither kind of update can revise a resolved build.
create function private.freeze_embryo_configuration_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if (old.source_format is not null and new.source_format is distinct from old.source_format)
    or (old.reference_build is not null and new.reference_build is distinct from old.reference_build)
    or (old.configuration_nonce_hash is not null and
      (new.configuration_nonce_hash,new.configured_build,new.build_evidence) is distinct from
      (old.configuration_nonce_hash,old.configured_build,old.build_evidence)) then
    raise exception using errcode='55000',message='immutable ingest configuration';
  end if;
  return new;
end $$;
create trigger embryo_configuration_immutable before update on public.embryo_ingest_sessions
  for each row execute function private.freeze_embryo_configuration_v1();
revoke all on function private.freeze_embryo_configuration_v1() from public,anon,authenticated;

-- Never reinterpret an existing challenge under this new closed shape.
do $$ begin
  if exists(select 1 from public.embryo_mapping_challenges) then
    raise exception using errcode='55000',message='existing mapping challenges require review';
  end if;
end $$;
alter table public.embryo_mapping_challenges
  add column challenge_hash text not null unique check (challenge_hash ~ '^[0-9a-f]{64}$'),
  add column challenge_kind text not null check (challenge_kind in ('columns','build')),
  add column column_count integer check (column_count between 1 and 128),
  add column transport_revision bigint not null check (transport_revision > 0),
  add column inspection_nonce_hash text not null unique check (inspection_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column resolution_nonce_hash text unique check (resolution_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column resolution jsonb,
  add constraint embryo_mapping_challenge_kind_columns check (
    (challenge_kind='columns' and column_count is not null) or
    (challenge_kind='build' and column_count is null)
  ),
  add constraint embryo_mapping_resolution_state check (
    (state='resolved')=(resolution is not null and resolution_nonce_hash is not null)
  );
create unique index embryo_mapping_one_pending_challenge
  on public.embryo_mapping_challenges(ingest_session_id) where state='pending';

create function private.freeze_embryo_mapping_challenge_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.ingest_session_id,new.mapping_revision,new.handle_manifest_fingerprint,
      new.expires_at,new.created_at,new.challenge_hash,new.challenge_kind,new.column_count,
      new.transport_revision,new.inspection_nonce_hash) is distinct from
    (old.id,old.ingest_session_id,old.mapping_revision,old.handle_manifest_fingerprint,
      old.expires_at,old.created_at,old.challenge_hash,old.challenge_kind,old.column_count,
      old.transport_revision,old.inspection_nonce_hash)
    or (old.state<>'pending' and new is distinct from old) then
    raise exception using errcode='55000',message='immutable mapping challenge';
  end if;
  return new;
end $$;
create trigger embryo_mapping_challenge_immutable before update on public.embryo_mapping_challenges
  for each row execute function private.freeze_embryo_mapping_challenge_v1();
revoke all on function private.freeze_embryo_mapping_challenge_v1() from public,anon,authenticated;

-- Lock the credential-bound session before comparing the caller's expected
-- cohort/revision. A mismatched request must never mutate another attempt.
create function private.lock_embryo_configuration_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_test boolean
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb;
begin
  if not exists(select 1 from public.embryo_ingest_sessions s
    where s.id=p_session and s.account_id=p_account and s.originating_session_id=p_auth
      and s.cookie_hash=p_cookie_hash and s.origin=p_origin and s.cohort_id=p_cohort
      and s.ingest_revision=p_ingest_revision and s.upload_id is not null) then
    raise exception using errcode='42501',message='ingest unavailable';
  end if;
  a:=public.authorize_embryo_ingest_request_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,p_test);
  return a;
end $$;

create function private.configure_embryo_ingest_session_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_format text,p_build text,p_evidence text,
  p_nonce text,p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; s public.embryo_ingest_sessions%rowtype; h text;
begin
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  if p_format is null or p_format not in ('vcf','gvcf','pgt_table') or p_evidence is null
    or p_evidence not in ('explicit-header','reference-inference','decision-required')
    or (p_evidence='decision-required' and (p_format<>'pgt_table' or p_build is not null))
    or (p_evidence<>'decision-required' and (p_build is null or p_build not in ('GRCh37','GRCh38')))
    or (p_evidence='reference-inference' and p_format<>'pgt_table')
    or p_nonce is null or (p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256) then
    raise exception using errcode='22023',message='invalid ingest configuration';
  end if;
  h:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.configuration_nonce_hash is not null then
    if (s.configuration_nonce_hash,s.source_format,s.configured_build,s.build_evidence)
      is not distinct from (h,p_format,p_build,p_evidence) then
      return jsonb_build_object('status','configured','transportRevision',s.transport_revision);
    end if;
    raise exception using errcode='55000',message='ingest configuration already fixed';
  end if;
  if s.source_format is not null or s.reference_build is not null or s.status<>'open'
    or exists(select 1 from public.embryo_ingest_chunks where session_id=s.id)
    or exists(select 1 from public.embryo_mapping_challenges where ingest_session_id=s.id) then
    raise exception using errcode='55000',message='ingest configuration unavailable';
  end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_auth,
    'ingest_configure','ingest_session',s.id);
  update public.embryo_ingest_sessions set source_format=p_format,reference_build=p_build,
    configured_build=p_build,build_evidence=p_evidence,configuration_nonce_hash=h where id=s.id;
  return jsonb_build_object('status','configured','transportRevision',s.transport_revision);
end $$;

-- The server generates the 256-bit token outside the database and retains it
-- only for its bounded response/retry. SQL stores its digest, never the token.
-- No header, candidate set, source label or derivative thereof is accepted.
create function private.create_embryo_mapping_challenge_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_transport_revision bigint,p_kind text,
  p_column_count integer,p_challenge text,p_nonce text,p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; s public.embryo_ingest_sessions%rowtype; c public.embryo_mapping_challenges%rowtype;
  h text; n text; manifest text; rev bigint;
begin
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  if p_kind is null or p_kind not in ('columns','build') or
    (p_kind='columns' and (p_column_count is null or p_column_count not between 1 and 128)) or
    (p_kind='build' and p_column_count is not null) or
    p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or
    p_nonce is null or (p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256) then
    raise exception using errcode='22023',message='invalid mapping challenge';
  end if;
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  if s.configuration_nonce_hash is null or s.source_format<>'pgt_table' or
    s.transport_revision is distinct from p_transport_revision or s.status not in ('open','mapping_required') or
    exists(select 1 from public.embryo_ingest_chunks where session_id=s.id) or
    (p_kind='build' and (s.reference_build is not null or s.build_evidence<>'decision-required')) then
    raise exception using errcode='55000',message='mapping challenge unavailable';
  end if;
  h:=encode(extensions.digest(convert_to(p_challenge,'UTF8'),'sha256'),'hex');
  n:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
  manifest:=encode(extensions.digest(convert_to((a->'handles')::text,'UTF8'),'sha256'),'hex');
  select * into c from public.embryo_mapping_challenges where inspection_nonce_hash=n;
  if found then
    if (c.ingest_session_id,c.challenge_hash,c.challenge_kind,c.column_count,c.transport_revision,c.handle_manifest_fingerprint)
      is not distinct from (s.id,h,p_kind,p_column_count,p_transport_revision,manifest)
      and c.state='pending' and c.expires_at>clock_timestamp() then
      return jsonb_build_object('status','challenge','revision',c.mapping_revision,'expiresAt',c.expires_at);
    end if;
    raise exception using errcode='42501',message='mapping challenge unavailable';
  end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_auth,
    'ingest_mapping_inspect','ingest_session',s.id);
  update public.embryo_mapping_challenges set state='cancelled'
    where ingest_session_id=s.id and state='pending';
  rev:=1+('x'||encode(extensions.gen_random_bytes(6),'hex'))::bit(48)::bigint;
  insert into public.embryo_mapping_challenges(ingest_session_id,mapping_revision,
    handle_manifest_fingerprint,state,expires_at,challenge_hash,challenge_kind,column_count,
    transport_revision,inspection_nonce_hash)
  values(s.id,rev,manifest,'pending',least(s.expires_at,clock_timestamp()+interval '10 minutes'),
    h,p_kind,p_column_count,p_transport_revision,n) returning * into c;
  update public.embryo_ingest_sessions set status='mapping_required' where id=s.id;
  return jsonb_build_object('status','challenge','revision',c.mapping_revision,'expiresAt',c.expires_at);
end $$;

create function private.resolve_embryo_mapping_challenge_v1(
  p_account uuid,p_auth uuid,p_session uuid,p_cookie_hash text,p_origin text,
  p_cohort uuid,p_ingest_revision bigint,p_challenge text,p_resolution jsonb,
  p_nonce text,p_test boolean default false
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare a jsonb; s public.embryo_ingest_sessions%rowtype; c public.embryo_mapping_challenges%rowtype;
  n text; entry jsonb; indices integer[]:='{}'; fields text[]:='{}'; key_names text[];
begin
  a:=private.lock_embryo_configuration_v1(p_account,p_auth,p_session,p_cookie_hash,p_origin,
    p_cohort,p_ingest_revision,p_test);
  if a->>'status'='failure_pending' then return a; end if;
  if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or
    p_nonce is null or (p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256) then
    raise exception using errcode='22023',message='invalid mapping decision';
  end if;
  select * into strict s from public.embryo_ingest_sessions where id=p_session for update;
  select * into c from public.embryo_mapping_challenges where ingest_session_id=s.id
    and challenge_hash=encode(extensions.digest(convert_to(p_challenge,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception using errcode='42501',message='mapping challenge unavailable'; end if;
  n:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
  -- Even a byte-identical replay must still belong to the current live binding.
  -- A resolved receipt is not permission to reuse a superseded transport.
  if s.status not in ('open','mapping_required') or c.expires_at<=clock_timestamp() or
    c.transport_revision<>s.transport_revision or
    c.handle_manifest_fingerprint<>encode(extensions.digest(convert_to((a->'handles')::text,'UTF8'),'sha256'),'hex') or
    exists(select 1 from public.embryo_ingest_chunks where session_id=s.id) then
    -- A stale/expired real challenge is terminal; do not delete its retry target.
    perform private.mark_embryo_ingest_failure_v1(s.id,'mapping');
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  if c.state='resolved' and c.resolution_nonce_hash=n and c.resolution=p_resolution then
    return jsonb_build_object('status','resolved','kind',c.challenge_kind);
  end if;
  if c.state<>'pending' then
    perform private.mark_embryo_ingest_failure_v1(s.id,'mapping');
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  -- This enforces only the persisted closed vocabulary/index boundary. The
  -- future HTTP handler must independently validate the offered choices in
  -- memory. These canonical pairs alone are not proof of source-header intent.
  if c.challenge_kind='build' then
    if jsonb_typeof(p_resolution) is distinct from 'object' then
      raise exception using errcode='22023',message='invalid mapping decision';
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(p_resolution) k)
        is distinct from array['referenceBuild']::text[] or
      jsonb_typeof(p_resolution->'referenceBuild') is distinct from 'string' or
      p_resolution->>'referenceBuild' not in ('GRCh37','GRCh38','unknown') then
      raise exception using errcode='22023',message='invalid mapping decision';
    end if;
  else
    if jsonb_typeof(p_resolution) is distinct from 'array' then
      raise exception using errcode='22023',message='invalid mapping decision';
    end if;
    if jsonb_array_length(p_resolution) not between 1 and 4 then
      raise exception using errcode='22023',message='invalid mapping decision';
    end if;
    for entry in select value from jsonb_array_elements(p_resolution) loop
      if jsonb_typeof(entry) is distinct from 'object' then
        raise exception using errcode='22023',message='invalid mapping decision';
      end if;
      select array_agg(k order by k) into key_names from jsonb_object_keys(entry) k;
      if key_names is distinct from array['columnIndex','field']::text[] or
        jsonb_typeof(entry->'columnIndex') is distinct from 'number' or
        (entry->>'columnIndex') !~ '^(0|[1-9][0-9]{0,2})$' or
        (entry->>'columnIndex')::integer>=c.column_count or
        jsonb_typeof(entry->'field') is distinct from 'string' or
        entry->>'field' not in ('sample','embryo','rsid','genotype','chrom','pos') or
        (entry->>'columnIndex')::integer=any(indices) or entry->>'field'=any(fields) then
        raise exception using errcode='22023',message='invalid mapping decision';
      end if;
      indices:=array_append(indices,(entry->>'columnIndex')::integer);
      fields:=array_append(fields,entry->>'field');
    end loop;
    if 'sample'=any(fields) and 'embryo'=any(fields) then
      raise exception using errcode='22023',message='invalid mapping decision';
    end if;
  end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,p_account,p_auth,
    'ingest_mapping_decide','ingest_session',s.id);
  if c.challenge_kind='build' and p_resolution->>'referenceBuild'='unknown' then
    perform private.mark_embryo_ingest_failure_v1(s.id,'build');
    return jsonb_build_object('status','failure_pending','cohortId',s.cohort_id,'ingestRevision',s.ingest_revision);
  end if;
  update public.embryo_mapping_challenges set state='resolved',resolution=p_resolution,resolution_nonce_hash=n where id=c.id;
  if c.challenge_kind='build' then
    update public.embryo_ingest_sessions set reference_build=p_resolution->>'referenceBuild' where id=s.id;
  end if;
  update public.embryo_ingest_sessions set status=case when exists(select 1 from public.embryo_mapping_challenges
    where ingest_session_id=s.id and state='pending') then 'mapping_required' else 'open' end where id=s.id;
  return jsonb_build_object('status','resolved','kind',c.challenge_kind);
end $$;

revoke all on function private.lock_embryo_configuration_v1(uuid,uuid,uuid,text,text,uuid,bigint,boolean),
  private.configure_embryo_ingest_session_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,text,boolean),
  private.create_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,bigint,text,integer,text,text,boolean),
  private.resolve_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,boolean)
  from public,anon,authenticated;
grant execute on function
  private.configure_embryo_ingest_session_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,text,boolean),
  private.create_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,bigint,text,integer,text,text,boolean),
  private.resolve_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,boolean)
  to service_role;
-- No public PostgREST doors: presentation/nonce transport is a separate slice.
