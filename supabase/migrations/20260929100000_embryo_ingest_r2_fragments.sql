-- Embryo fragments on R2 (owner decision, 28 September 2026: prove cleanup,
-- do not assume it). Test-local primitives only. No route, writer, gateway
-- deployment or availability flag is added; EMBRYO_INGEST_AVAILABLE stays false.
--
-- Every write intent now records its backend:
--   * `r2`: the object lives at `embryo/<fragment object id>` in a private
--     `inherit-embryo-*` bucket behind the signed fragment gateway
--     (`workers/embryo-fragments`). Landing is recorded by
--     `ack_embryo_ingest_r2_write_v1` after the transport has written the
--     object create-only and read it back to EOF, and only inside the intent's
--     open window of an open, unfenced, still-authorized session. SQL checks
--     the reported provider version, ETag, SHA-256 and size against the intent;
--     it does not read the bytes itself.
--   * `supabase`: the unit-1 path, landed by the storage.objects guard. It is
--     kept for tests and as a fenced namespace. On Supabase Storage an
--     uncertain write can never be proved absent, so production uses `r2`.
-- The Supabase guard still owns the embryo namespace in bucket `genomes`: the
-- name reserved for an R2 fragment can never gain a metadata row.
--
-- Nothing is backend-by-default. Until an operator selects a backend in
-- private.embryo_ingest_object_config, reserving a fragment is refused.
-- The concurrency argument of 20260928100000 holds for both landing paths:
-- each takes the session FOR SHARE, then the intent FOR UPDATE, through the
-- one helper below, and holds both until its transaction ends.

do $$ begin
  if exists(select 1 from private.embryo_ingest_write_intents) then
    raise exception using errcode='55000',message='existing embryo write intents require explicit review';
  end if;
end $$;

create table private.embryo_ingest_object_config (
  singleton boolean primary key default true check (singleton),
  provider text check (provider in ('supabase','r2')),
  r2_bucket text check (r2_bucket ~ '^inherit-embryo-[a-z0-9-]{1,40}$'),
  check (provider is distinct from 'r2' or r2_bucket is not null)
);
insert into private.embryo_ingest_object_config(singleton) values (true);
alter table private.embryo_ingest_object_config enable row level security;
revoke all on private.embryo_ingest_object_config from public,anon,authenticated,inherit_upload_only,service_role;

-- The location a write goes to, and the provider identity it landed as.
-- `object_name` stays the fenced Supabase name for every intent.
alter table private.embryo_ingest_write_intents
  add column backend text not null check (backend in ('supabase','r2')),
  add column provider_bucket text not null,
  add column provider_key text not null,
  add column sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  add column provider_version text check (provider_version ~ '^[0-9a-f]{32}$'),
  add column provider_etag text check (provider_etag ~ '^[0-9a-f]{32}$'),
  add column observed_sha256 text check (observed_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint embryo_write_intent_location_key unique (provider_bucket, provider_key),
  add constraint embryo_write_intent_location check (
    (backend='supabase' and provider_bucket='genomes' and provider_key=object_name)
    or (backend='r2' and provider_bucket ~ '^inherit-embryo-[a-z0-9-]{1,40}$'
      and provider_key ~ '^embryo/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
  -- Replaces 20260928100000's two Supabase-only landing checks.
  drop constraint embryo_ingest_write_intents_check1,
  drop constraint embryo_ingest_write_intents_check3,
  add constraint embryo_write_intent_landed_at check ((state='landed') = (landed_at is not null)),
  add constraint embryo_write_intent_supabase_identity check (backend<>'supabase' or (
    (state='landed') = (storage_object_id is not null)
    and provider_version is null and provider_etag is null and observed_sha256 is null)),
  add constraint embryo_write_intent_r2_identity check (backend<>'r2' or (
    storage_object_id is null
    and (state='landed') = (provider_version is not null)
    and (state='landed') = (provider_etag is not null)
    and (state='landed') = (observed_sha256 is not null)
    and (observed_sha256 is null or observed_sha256=sha256)));

-- Adds the location and content identity to the immutable columns. Landing
-- fields change once, from open to landed; terminal states stay frozen.
create or replace function private.freeze_embryo_ingest_write_record_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='embryo_ingest_write_intents' then
    if (new.session_id,new.sequence,new.sample_ordinal,new.object_name,new.byte_count,new.created_at,
        new.backend,new.provider_bucket,new.provider_key,new.sha256)
        is distinct from (old.session_id,old.sequence,old.sample_ordinal,old.object_name,old.byte_count,old.created_at,
        old.backend,old.provider_bucket,old.provider_key,old.sha256)
      or (old.state<>'open' and new is distinct from old)
      or (new.state<>'open' and (new.write_expires_at,new.write_attempts)
        is distinct from (old.write_expires_at,old.write_attempts))
      or (new.write_attempts<>old.write_attempts and (new.write_attempts<>old.write_attempts+1
        or new.write_expires_at<=old.write_expires_at))
      or (new.write_expires_at>old.write_expires_at and (new.write_attempts<>old.write_attempts+1
        or exists(select 1 from private.embryo_ingest_write_fences f where f.session_id=new.session_id)))
    then raise exception using errcode='55000',message='immutable embryo write record'; end if;
  elsif (new.session_id,new.fenced_at,new.fence_at) is distinct from (old.session_id,old.fenced_at,old.fence_at)
    or (old.settled_at is not null and new is distinct from old) then
    raise exception using errcode='55000',message='immutable embryo write record';
  end if;
  return new;
end $$;

-- The backend is fixed when the intent is issued, from the configuration.
create or replace function private.issue_embryo_ingest_write_intent_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; cfg private.embryo_ingest_object_config%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  select * into s from public.embryo_ingest_sessions where id=new.session_id for update;
  if not found or s.status<>'open' or s.expires_at<=v_now
    or exists(select 1 from private.embryo_ingest_write_fences where session_id=new.session_id)
    or not exists(select 1 from public.embryo_ingest_chunks c where c.session_id=new.session_id
      and c.sequence=new.sequence and c.state='reserved')
  then raise exception using errcode='55000',message='embryo_write_intent_unavailable'; end if;
  select * into cfg from private.embryo_ingest_object_config where singleton for share;
  if cfg.provider is null then
    raise exception using errcode='55000',message='embryo_object_backend_unavailable';
  end if;
  insert into private.embryo_ingest_write_intents(session_id,sequence,sample_ordinal,object_name,
    byte_count,created_at,write_expires_at,backend,provider_bucket,provider_key,sha256)
  values(new.session_id,new.sequence,new.sample_ordinal,new.object_name,new.byte_count,v_now,
    least(v_now+interval '60 seconds',s.expires_at),cfg.provider,
    case cfg.provider when 'r2' then cfg.r2_bucket else 'genomes' end,
    case cfg.provider when 'r2' then 'embryo/'||new.object_id::text else new.object_name end,
    new.content_sha256);
  return null;
end $$;

-- What a writer is told, and must present back unchanged. A renewed window
-- changes writeExpiresAt, so a receipt from an earlier window cannot land.
create function private.embryo_ingest_write_target_v1(i private.embryo_ingest_write_intents)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version','embryo-ingest-write-target-v1','sessionId',i.session_id,
    'sequence',i.sequence,'ordinal',i.sample_ordinal,'backend',i.backend,'bucket',i.provider_bucket,
    'objectKey',i.provider_key,'byteCount',i.byte_count,'sha256',i.sha256,'writeExpiresAt',i.write_expires_at);
$$;
-- The provider identity a landed intent is bound to; null while not landed.
create function private.embryo_ingest_stored_fragment_v1(i private.embryo_ingest_write_intents)
returns jsonb language sql immutable set search_path='' as $$
  select case when i.state<>'landed' then null
    when i.backend='r2' then jsonb_build_object('providerVersion',i.provider_version,'etag',i.provider_etag)
    else jsonb_build_object('storageObjectId',i.storage_object_id,'storageVersion',i.storage_version) end;
$$;

-- The one admission check both landing paths share. Lock order: session FOR
-- SHARE, then (inside the authority check, NOWAIT) authority rows, then the
-- intent FOR UPDATE. Every refusal is 42501 embryo_object_unavailable. With
-- p_replay a landed intent is returned for the caller's exact-replay check.
create function private.lock_embryo_ingest_landing_v1(p_session_id uuid,p_sequence integer,
  p_ordinal integer,p_replay boolean)
returns private.embryo_ingest_write_intents
language plpgsql security definer set search_path=pg_catalog,private as $$
declare s public.embryo_ingest_sessions%rowtype; i private.embryo_ingest_write_intents%rowtype;
begin
  begin
    select * into s from public.embryo_ingest_sessions where id=p_session_id for share;
    if not found or s.status<>'open' or s.expires_at<=clock_timestamp()
      or exists(select 1 from private.embryo_ingest_write_fences where session_id=s.id) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    -- Called with the session locked, as its contract requires.
    if private.embryo_ingest_binding_failure_v1(s.id) is not null then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    select * into i from private.embryo_ingest_write_intents
      where session_id=s.id and sequence=p_sequence and sample_ordinal=p_ordinal for update;
    if not found then raise exception using errcode='42501',message='embryo_object_unavailable'; end if;
    if i.state='landed' and p_replay then return i; end if;
    if i.state<>'open' or i.write_expires_at<=clock_timestamp()
      or not exists(select 1 from public.embryo_ingest_chunks c where c.session_id=i.session_id
        and c.sequence=i.sequence and c.state='reserved')
      or exists(select 1 from public.embryo_ingest_delete_objects d
        where (d.bucket_id=i.provider_bucket and d.object_name=i.provider_key)
          or (d.bucket_id='genomes' and d.object_name=i.object_name)) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    return i;
  exception
    -- Contention and authority-state errors are refusals here too. The 55000
    -- handler is a class handler and includes 55P03 (lock_not_available).
    when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then
      raise exception using errcode='42501',message='embryo_object_unavailable';
  end;
end $$;

-- 20260928100000's guard, now through the shared admission check and only
-- for `supabase` intents. The name of an `r2` intent is refused outright.
create or replace function private.guard_embryo_ingest_object_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare i private.embryo_ingest_write_intents%rowtype; size_field text;
begin
  if tg_op='UPDATE' then
    if private.embryo_ingest_object_name_v1(old.bucket_id,old.name)
      or private.embryo_ingest_object_name_v1(new.bucket_id,new.name) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    return new;
  end if;
  if not private.embryo_ingest_object_name_v1(new.bucket_id,new.name) then return new; end if;
  begin
    if auth.jwt()->>'role' is distinct from 'service_role' then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    -- Exact, case-sensitive name. An unlocked read only finds the intent key.
    select * into i from private.embryo_ingest_write_intents where object_name=new.name;
    if not found or i.backend<>'supabase' then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    i:=private.lock_embryo_ingest_landing_v1(i.session_id,i.sequence,i.sample_ordinal,false);
    if i.object_name is distinct from new.name or i.backend<>'supabase' then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    -- As 20260908164616:393-404: Storage's create-only admission runs a
    -- rollback-only version='1' INSERT carrying contentLength; the real write
    -- carries a generated UUID-v4 version and metadata.size. A deferred
    -- constraint refuses to commit the probe shape.
    if new.version='1' then size_field:='contentLength';
    elsif new.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then size_field:='size';
    else raise exception using errcode='42501',message='embryo_object_unavailable'; end if;
    if jsonb_typeof(new.metadata->size_field) is distinct from 'number'
      or (new.metadata->>size_field) !~ '^[1-9][0-9]{0,8}$'
      or (new.metadata->>size_field)::bigint<>i.byte_count then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    if size_field='size' then
      update private.embryo_ingest_write_intents set state='landed',storage_object_id=new.id,
        storage_version=new.version,landed_at=clock_timestamp()
        where session_id=i.session_id and sequence=i.sequence and sample_ordinal=i.sample_ordinal;
    end if;
  exception
    when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then
      raise exception using errcode='42501',message='embryo_object_unavailable';
  end;
  return new;
end $$;

-- The R2 landing. Call only after the transport wrote the object create-only
-- and independently read that exact version back to EOF, hashing every byte.
-- SQL checks the reported identity against the intent; it is not independent
-- provider proof. An exact replay of a committed ACK returns the same answer.
create function private.ack_embryo_ingest_r2_write_v1(p_session_id uuid,p_sequence integer,
  p_ordinal integer,p_expected jsonb,p_provider_version text,p_etag text,
  p_observed_sha256 text,p_observed_byte_count bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.embryo_ingest_write_intents%rowtype;
begin
  if p_provider_version is null or p_provider_version !~ '^[0-9a-f]{32}$'
    or p_etag is null or p_etag !~ '^[0-9a-f]{32}$'
    or p_observed_sha256 is null or p_observed_sha256 !~ '^[0-9a-f]{64}$'
    or p_observed_byte_count is null or p_session_id is null or p_sequence is null or p_ordinal is null
    or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>2048 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  i:=private.lock_embryo_ingest_landing_v1(p_session_id,p_sequence,p_ordinal,true);
  if i.backend<>'r2' or p_expected is distinct from private.embryo_ingest_write_target_v1(i)
    or p_observed_sha256<>i.sha256 or p_observed_byte_count<>i.byte_count then
    raise exception using errcode='42501',message='embryo_object_unavailable';
  end if;
  if i.state='landed' then
    if (i.provider_version,i.provider_etag) is distinct from (p_provider_version,p_etag) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
  else
    update private.embryo_ingest_write_intents set state='landed',provider_version=p_provider_version,
      provider_etag=p_etag,observed_sha256=p_observed_sha256,landed_at=clock_timestamp()
      where session_id=i.session_id and sequence=i.sequence and sample_ordinal=i.sample_ordinal
      returning * into i;
  end if;
  return jsonb_build_object('receipt',private.embryo_ingest_write_target_v1(i))
    ||private.embryo_ingest_stored_fragment_v1(i);
end $$;

-- A landed `r2` intent satisfies the commit gate by its registry identity: the
-- transport verified the bytes before the ACK. `supabase` keeps 20260928100000's
-- live metadata-row check, locked FOR SHARE.
create or replace function private.gate_embryo_ingest_chunk_objects_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
  if tg_op='INSERT' then
    if new.state<>'reserved' then
      raise exception using errcode='55000',message='embryo_chunk_objects_unlanded';
    end if;
    return new;
  end if;
  if old.state='stored' and new.state<>'stored' then
    raise exception using errcode='55000',message='embryo_chunk_objects_unlanded';
  end if;
  if old.state='reserved' and new.state='stored' then
    perform 1 from private.embryo_ingest_write_intents i
      where i.session_id=new.session_id and i.sequence=new.sequence order by i.sample_ordinal for share;
    perform 1 from storage.objects o join private.embryo_ingest_write_intents i on i.storage_object_id=o.id
      where i.session_id=new.session_id and i.sequence=new.sequence and i.backend='supabase'
      order by o.id for share of o;
    if exists(select 1 from public.embryo_ingest_fragments f
        left join private.embryo_ingest_write_intents i on i.session_id=f.session_id
          and i.sequence=f.sequence and i.sample_ordinal=f.sample_ordinal
        left join storage.objects o on i.backend='supabase' and o.id=i.storage_object_id
          and o.bucket_id='genomes' and o.name=i.object_name and o.name=f.object_name
          and o.version=i.storage_version and o.metadata->'size'=to_jsonb(i.byte_count)
        where f.session_id=new.session_id and f.sequence=new.sequence
          and (i.state is distinct from 'landed'
            or (i.backend='supabase' and o.id is null)
            or (i.backend='r2' and (i.provider_version is null or i.provider_etag is null
              or i.observed_sha256 is distinct from f.content_sha256 or i.sha256 is distinct from f.content_sha256
              or i.byte_count is distinct from f.byte_count)))) then
      raise exception using errcode='55000',message='embryo_chunk_objects_unlanded';
    end if;
  end if;
  return new;
end $$;

-- Targets now carry the exact receipt a writer must present, per backend.
create or replace function private.embryo_ingest_write_targets_v1(p_session_id uuid,p_sequence integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; c public.embryo_ingest_chunks%rowtype;
  v_failure text; v_now timestamptz; v_targets jsonb;
begin
  select * into s from public.embryo_ingest_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('status','denied'); end if;
  if s.status='failure_pending' then return jsonb_build_object('status','failure_pending'); end if;
  if s.status<>'open' or exists(select 1 from private.embryo_ingest_write_fences where session_id=s.id) then
    return jsonb_build_object('status','denied');
  end if;
  v_failure:=private.embryo_ingest_binding_failure_v1(s.id);
  if v_failure is not null then return private.mark_embryo_ingest_failure_v1(s.id,v_failure); end if;
  select * into c from public.embryo_ingest_chunks where session_id=s.id and sequence=p_sequence;
  if not found then return jsonb_build_object('status','denied'); end if;
  perform 1 from private.embryo_ingest_write_intents
    where session_id=s.id and sequence=p_sequence order by sample_ordinal for update;
  v_now:=clock_timestamp();
  if s.expires_at<=v_now then return private.mark_embryo_ingest_failure_v1(s.id,'expiry'); end if;
  if c.state='reserved' then
    if exists(select 1 from private.embryo_ingest_write_intents where session_id=s.id
        and sequence=p_sequence and state='open' and write_expires_at<=v_now and write_attempts>=3) then
      return private.mark_embryo_ingest_failure_v1(s.id,'retry-exhaustion');
    end if;
    update private.embryo_ingest_write_intents
      set write_expires_at=least(v_now+interval '60 seconds',s.expires_at),write_attempts=write_attempts+1
      where session_id=s.id and sequence=p_sequence and state='open' and write_expires_at<=v_now;
  end if;
  select jsonb_agg(jsonb_build_object('receipt',private.embryo_ingest_write_target_v1(i),'state',i.state,
      'stored',private.embryo_ingest_stored_fragment_v1(i)) order by i.sample_ordinal)
    into v_targets from private.embryo_ingest_write_intents i
    where i.session_id=s.id and i.sequence=p_sequence;
  return jsonb_build_object('status',c.state,'targets',coalesce(v_targets,'[]'::jsonb));
end $$;

create function public.ack_embryo_ingest_r2_write_v1(p_session_id uuid,p_sequence integer,
  p_ordinal integer,p_expected jsonb,p_provider_version text,p_etag text,
  p_observed_sha256 text,p_observed_byte_count bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select private.ack_embryo_ingest_r2_write_v1(p_session_id,p_sequence,p_ordinal,p_expected,
    p_provider_version,p_etag,p_observed_sha256,p_observed_byte_count);
$$;

revoke all on function private.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint),
  public.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint),
  public.ack_embryo_ingest_r2_write_v1(uuid,integer,integer,jsonb,text,text,text,bigint)
  to service_role;
revoke all on function private.embryo_ingest_write_target_v1(private.embryo_ingest_write_intents),
  private.embryo_ingest_stored_fragment_v1(private.embryo_ingest_write_intents),
  private.lock_embryo_ingest_landing_v1(uuid,integer,integer,boolean)
  from public,anon,authenticated,inherit_upload_only,service_role;

notify pgrst,'reload schema';
