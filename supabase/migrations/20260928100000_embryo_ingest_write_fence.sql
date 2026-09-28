-- ADR 0020 safeguard 1: the embryo-ingest Storage write fence and drain.
-- Test-local primitives only. No route, writer, scheduler or availability flag
-- is added, and EMBRYO_INGEST_AVAILABLE stays false.
--
-- What this proves, and what it does not:
--   * Storage metadata fence. A row in the embryo namespace of the `genomes`
--     bucket can be created only by a service-role INSERT that names one open,
--     unexpired write intent of a writable, unfenced, still-authorized session
--     whose chunk is still reserved. Every UPDATE touching the namespace is
--     refused, and a committed rollback-only permission probe is refused.
--   * A time bound. When a session leaves the writable set, a fence row is
--     stamped. After `fenced_at` no admitted metadata write can still commit;
--     after `fence_at` (the later of the stamp and the last open write window)
--     every window a writer was given has closed.
--   * A drain classification. After `fence_at`, settle classifies every intent
--     `landed` (one committed metadata row, exact id and version) or
--     `uncertain` (no metadata row committed inside its windows).
--   * NOT physical absence. An `uncertain` intent, or a refused or abandoned
--     attempt at a `landed` name, may have left provider bytes at a version
--     that no metadata row names. Nothing here claims those bytes are absent.
--
-- Concurrency argument. The Storage guard takes the session row FOR SHARE and
-- then the intent row FOR UPDATE, and holds both until the Storage transaction
-- ends. Every status change needs the session row lock, which conflicts with
-- FOR SHARE. So a status change either commits first (the guard then reads the
-- new status and refuses) or waits for the Storage transaction (the fence is
-- then computed after that landing is visible). Settle locks the session FOR
-- UPDATE before it touches intents, so it cannot flip an intent a guard holds.
-- Lock order everywhere: session, then authority rows (NOWAIT), then intents,
-- then storage.objects rows. The guard is a BEFORE trigger, so it takes these
-- locks before the INSERT takes its (bucket_id, name) unique-index lock
-- (20260906113021_own_upload_storage_authorization.sql:270-272).

-- The namespace is new ground. Refuse to take ownership over existing rows.
do $$ begin
  if exists(select 1 from storage.objects where bucket_id='genomes'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(vcf|tsv)$') then
    raise exception using errcode='55000',message='existing embryo objects require explicit review';
  end if;
  -- A fragment reserved before this migration has no intent and could never be
  -- written or committed. Refuse rather than invent a write window for it.
  if exists(select 1 from public.embryo_ingest_fragments) then
    raise exception using errcode='55000',message='existing embryo fragments require explicit review';
  end if;
end $$;

-- The fenced namespace: bucket `genomes`, four canonical UUID segments and a
-- `.vcf` or `.tsv` suffix, matched case-insensitively so case variants of an
-- embryo name are fenced too. The fragment binder only ever writes lowercase.
create function private.embryo_ingest_object_name_v1(p_bucket text,p_name text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_bucket='genomes' and p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(vcf|tsv)$',false);
$$;

-- One intent per reserved fragment. Written only by definer code; no role,
-- service_role included, holds any table privilege. Object ids are not
-- Storage foreign keys: a provider DELETE must stay possible.
create table private.embryo_ingest_write_intents (
  session_id uuid not null,
  sequence integer not null,
  sample_ordinal smallint not null,
  object_name text not null unique check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(vcf|tsv)$'),
  byte_count integer not null check (byte_count > 0),
  created_at timestamptz not null,
  write_expires_at timestamptz not null,
  write_attempts smallint not null default 1 check (write_attempts between 1 and 3),
  state text not null default 'open' check (state in ('open','landed','uncertain')),
  storage_object_id uuid unique,
  storage_version text check (storage_version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  landed_at timestamptz,
  settled_at timestamptz,
  primary key (session_id, sequence, sample_ordinal),
  foreign key (session_id, sequence, sample_ordinal)
    references public.embryo_ingest_fragments(session_id, sequence, sample_ordinal) on delete cascade,
  check (write_expires_at > created_at),
  check ((state='landed') = (storage_object_id is not null)),
  check ((storage_object_id is null) = (storage_version is null)),
  check ((storage_object_id is null) = (landed_at is null)),
  check ((state='uncertain') = (settled_at is not null)),
  -- A landing is admitted only inside its window; an intent is classified
  -- uncertain only after its window closed.
  check (landed_at is null or landed_at < write_expires_at),
  check (settled_at is null or settled_at >= write_expires_at)
);

-- One fence per session that has left the writable set.
create table private.embryo_ingest_write_fences (
  session_id uuid primary key references public.embryo_ingest_sessions(id) on delete cascade,
  fenced_at timestamptz not null,
  fence_at timestamptz not null,
  settled_at timestamptz,
  landed_count integer check (landed_count >= 0),
  uncertain_count integer check (uncertain_count >= 0),
  check (fence_at >= fenced_at),
  check ((settled_at is null) = (landed_count is null)),
  check ((settled_at is null) = (uncertain_count is null)),
  check (settled_at is null or settled_at >= fence_at)
);
alter table private.embryo_ingest_write_intents enable row level security;
alter table private.embryo_ingest_write_fences enable row level security;
revoke all on private.embryo_ingest_write_intents,private.embryo_ingest_write_fences
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Both are cascaded children of registered ingest working state (fragments
-- and sessions). Register them so the terminal purge's residual check sees
-- them. private.assert_embryo_unwind_plannable_stores_v1 scans only `public`;
-- these rows are covered because the unwind already inventories their parents.
insert into public.purge_target_stores(target_id,store_name,store_order)
  select 'upload-and-ingest-working-state','private.embryo_ingest_write_intents',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='upload-and-ingest-working-state';
insert into public.purge_target_stores(target_id,store_name,store_order)
  select 'upload-and-ingest-working-state','private.embryo_ingest_write_fences',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='upload-and-ingest-working-state';

-- Identity is immutable. `landed` and `uncertain` are terminal. A window may
-- be renewed only by one attempt at a time and never after a fence exists.
-- Shortening a window is allowed: it only narrows what can land.
create function private.freeze_embryo_ingest_write_record_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='embryo_ingest_write_intents' then
    if (new.session_id,new.sequence,new.sample_ordinal,new.object_name,new.byte_count,new.created_at)
        is distinct from (old.session_id,old.sequence,old.sample_ordinal,old.object_name,old.byte_count,old.created_at)
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
create trigger embryo_ingest_write_intent_identity before update on private.embryo_ingest_write_intents
  for each row execute function private.freeze_embryo_ingest_write_record_v1();
create trigger embryo_ingest_write_fence_identity before update on private.embryo_ingest_write_fences
  for each row execute function private.freeze_embryo_ingest_write_record_v1();

-- Issue exactly one intent per reserved fragment, in the reserving statement.
-- The fragment binder has already locked the session FOR UPDATE.
create function private.issue_embryo_ingest_write_intent_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; v_now timestamptz:=clock_timestamp();
begin
  select * into s from public.embryo_ingest_sessions where id=new.session_id for update;
  if not found or s.status<>'open' or s.expires_at<=v_now
    or exists(select 1 from private.embryo_ingest_write_fences where session_id=new.session_id)
    or not exists(select 1 from public.embryo_ingest_chunks c where c.session_id=new.session_id
      and c.sequence=new.sequence and c.state='reserved')
  then raise exception using errcode='55000',message='embryo_write_intent_unavailable'; end if;
  insert into private.embryo_ingest_write_intents(session_id,sequence,sample_ordinal,object_name,
    byte_count,created_at,write_expires_at)
  values(new.session_id,new.sequence,new.sample_ordinal,new.object_name,new.byte_count,v_now,
    least(v_now+interval '60 seconds',s.expires_at));
  return null;
end $$;
create trigger embryo_fragment_write_intent after insert on public.embryo_ingest_fragments
  for each row execute function private.issue_embryo_ingest_write_intent_v1();

-- The fence time is the later of now and the last open window. Idempotent.
-- Callers hold the session row lock, so no guard transaction is in flight.
create function private.stamp_embryo_ingest_write_fence_v1(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();
begin
  insert into private.embryo_ingest_write_fences(session_id,fenced_at,fence_at)
    select p_session_id,v_now,greatest(v_now,max(i.write_expires_at))
    from private.embryo_ingest_write_intents i where i.session_id=p_session_id and i.state='open'
  on conflict (session_id) do nothing;
end $$;

-- Writable set W = {open, mapping_required}. Leaving W stamps the fence; no
-- session may enter W from outside it, and a fenced session never returns.
-- This does not touch the existing freeze triggers or their column lists.
create function private.fence_embryo_ingest_writes_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('open','mapping_required') then
    if old.status not in ('open','mapping_required')
      or exists(select 1 from private.embryo_ingest_write_fences where session_id=old.id) then
      raise exception using errcode='55000',message='embryo_write_fence_final';
    end if;
  elsif old.status in ('open','mapping_required') then
    perform private.stamp_embryo_ingest_write_fence_v1(old.id);
  end if;
  return new;
end $$;
create trigger embryo_ingest_write_fence before update of status on public.embryo_ingest_sessions
  for each row when (old.status is distinct from new.status)
  execute function private.fence_embryo_ingest_writes_v1();

-- The Storage metadata guard. Every refusal is 42501 embryo_object_unavailable.
-- A refusal persists nothing: the Storage transaction rolls back with it. The
-- write-targets door records authority failures instead.
create function private.guard_embryo_ingest_object_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare i private.embryo_ingest_write_intents%rowtype; s public.embryo_ingest_sessions%rowtype;
  v_now timestamptz; size_field text;
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
    -- Exact, case-sensitive name. An unlocked read only finds the session.
    select * into i from private.embryo_ingest_write_intents where object_name=new.name;
    if not found then raise exception using errcode='42501',message='embryo_object_unavailable'; end if;
    select * into s from public.embryo_ingest_sessions where id=i.session_id for share;
    if not found or s.status<>'open' or s.expires_at<=clock_timestamp()
      or exists(select 1 from private.embryo_ingest_write_fences where session_id=s.id) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    -- Called with the session locked, as its contract requires.
    if private.embryo_ingest_binding_failure_v1(s.id) is not null then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    select * into i from private.embryo_ingest_write_intents
      where session_id=i.session_id and sequence=i.sequence and sample_ordinal=i.sample_ordinal for update;
    v_now:=clock_timestamp();
    if not found or i.object_name is distinct from new.name or i.state<>'open' or i.write_expires_at<=v_now
      or not exists(select 1 from public.embryo_ingest_chunks c where c.session_id=i.session_id
        and c.sequence=i.sequence and c.state='reserved')
      or exists(select 1 from public.embryo_ingest_delete_objects d
        where d.bucket_id=new.bucket_id and d.object_name=new.name) then
      raise exception using errcode='42501',message='embryo_object_unavailable';
    end if;
    -- As 20260908164616:393-404: Storage's create-only admission runs a
    -- rollback-only version='1' INSERT carrying contentLength; the real write
    -- carries a generated UUID-v4 version and metadata.size. A deferred
    -- constraint below refuses to commit the probe shape.
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
        storage_version=new.version,landed_at=v_now
        where session_id=i.session_id and sequence=i.sequence and sample_ordinal=i.sample_ordinal;
    end if;
  exception
    -- Contention and authority-state errors are refusals here too. The 55000
    -- handler is a class handler and includes 55P03 (lock_not_available).
    when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then
      raise exception using errcode='42501',message='embryo_object_unavailable';
  end;
  return new;
end $$;
create trigger guard_embryo_ingest_object before insert or update on storage.objects
  for each row execute function private.guard_embryo_ingest_object_v1();

create function private.refuse_committed_embryo_ingest_probe_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
  -- The namespace test lives here, not in WHEN, so the one predicate decides.
  if private.embryo_ingest_object_name_v1(new.bucket_id,new.name) then
    raise exception using errcode='42501',message='embryo_probe_uncommittable';
  end if;
  return null;
end $$;
create constraint trigger refuse_committed_embryo_ingest_probe
  after insert on storage.objects deferrable initially deferred
  for each row when (new.bucket_id='genomes' and new.version='1')
  execute function private.refuse_committed_embryo_ingest_probe_v1();

-- "Call only after every reserved object has been written" is now enforced:
-- reserved -> stored needs every fragment of the chunk to have a landed intent
-- whose metadata row still exists with the same id, bucket, name, version and
-- size. Those rows are locked FOR SHARE until the commit ends, so a concurrent
-- DELETE cannot slip between the check and the commit. A chunk with no
-- fragments stays committable. A chunk is created reserved and stays stored.
create function private.gate_embryo_ingest_chunk_objects_v1()
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
      where i.session_id=new.session_id and i.sequence=new.sequence order by o.id for share of o;
    if exists(select 1 from public.embryo_ingest_fragments f
        left join private.embryo_ingest_write_intents i on i.session_id=f.session_id
          and i.sequence=f.sequence and i.sample_ordinal=f.sample_ordinal
        left join storage.objects o on o.id=i.storage_object_id and o.bucket_id='genomes'
          and o.name=i.object_name and o.name=f.object_name and o.version=i.storage_version
          and o.metadata->'size'=to_jsonb(i.byte_count)
        where f.session_id=new.session_id and f.sequence=new.sequence
          and (i.state is distinct from 'landed' or o.id is null)) then
      raise exception using errcode='55000',message='embryo_chunk_objects_unlanded';
    end if;
  end if;
  return new;
end $$;
create trigger embryo_ingest_chunk_objects_landed before insert or update on public.embryo_ingest_chunks
  for each row execute function private.gate_embryo_ingest_chunk_objects_v1();

-- Where to write, and whether a name has landed. An expired open window is
-- renewed (clamped to the session deadline, three windows at most) only while
-- the session is open, unfenced, unexpired and still authorized, so a crashed
-- chunk request can resume instead of failing the cohort. Renewal is not an
-- unconditional retry: an exhausted expired window fails the attempt.
create function private.embryo_ingest_write_targets_v1(p_session_id uuid,p_sequence integer)
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
  select jsonb_agg(jsonb_build_object('ordinal',i.sample_ordinal,'objectName',i.object_name,
      'state',i.state,'writeExpiresAt',i.write_expires_at) order by i.sample_ordinal)
    into v_targets from private.embryo_ingest_write_intents i
    where i.session_id=s.id and i.sequence=p_sequence;
  return jsonb_build_object('status',c.state,'bucket','genomes','targets',coalesce(v_targets,'[]'::jsonb));
end $$;

-- Drain. It never claims physical absence: `uncertain` means no metadata row
-- committed inside the intent's windows; provider bytes at an unknown version
-- may still exist. An expired session still in W is failed first, because it
-- can never become writable again. Idempotent once settled.
create function private.settle_embryo_ingest_writes_v1(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.embryo_ingest_sessions%rowtype; f private.embryo_ingest_write_fences%rowtype;
  v_now timestamptz; v_landed integer; v_uncertain integer;
begin
  select * into s from public.embryo_ingest_sessions where id=p_session_id for update;
  if not found then return jsonb_build_object('status','denied'); end if;
  if s.status in ('open','mapping_required') then
    if s.expires_at>clock_timestamp() then return jsonb_build_object('status','writable'); end if;
    perform private.mark_embryo_ingest_failure_v1(s.id,'expiry');
  end if;
  -- A session that left W before this migration has no fence yet.
  perform private.stamp_embryo_ingest_write_fence_v1(s.id);
  select * into f from private.embryo_ingest_write_fences where session_id=s.id for update;
  if f.settled_at is null then
    v_now:=clock_timestamp();
    if v_now<f.fence_at then
      return jsonb_build_object('status','draining','fenceAt',f.fence_at);
    end if;
    perform 1 from private.embryo_ingest_write_intents where session_id=s.id
      order by sequence,sample_ordinal for update;
    update private.embryo_ingest_write_intents set state='uncertain',settled_at=v_now
      where session_id=s.id and state='open';
    select count(*) filter (where state='landed'),count(*) filter (where state='uncertain')
      into v_landed,v_uncertain from private.embryo_ingest_write_intents where session_id=s.id;
    update private.embryo_ingest_write_fences set settled_at=v_now,landed_count=v_landed,
      uncertain_count=v_uncertain where session_id=s.id returning * into f;
  end if;
  return jsonb_build_object('status','settled','fenceAt',f.fence_at,'settledAt',f.settled_at,
    'landed',f.landed_count,'uncertain',f.uncertain_count);
end $$;

-- Invoker doors, as 20260921150000_embryo_ingest_chunk_public_doors.sql: the
-- inner EXECUTE check is the real barrier, and only service_role holds it.
create function public.embryo_ingest_write_targets_v1(p_session_id uuid,p_sequence integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.embryo_ingest_write_targets_v1(p_session_id,p_sequence);
$$;
create function public.settle_embryo_ingest_writes_v1(p_session_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.settle_embryo_ingest_writes_v1(p_session_id);
$$;

revoke all on function private.embryo_ingest_write_targets_v1(uuid,integer),
  private.settle_embryo_ingest_writes_v1(uuid),
  public.embryo_ingest_write_targets_v1(uuid,integer),
  public.settle_embryo_ingest_writes_v1(uuid)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.embryo_ingest_write_targets_v1(uuid,integer),
  private.settle_embryo_ingest_writes_v1(uuid),
  public.embryo_ingest_write_targets_v1(uuid,integer),
  public.settle_embryo_ingest_writes_v1(uuid)
  to service_role;
-- Internal helpers and trigger bodies: no caller holds EXECUTE.
revoke all on function private.embryo_ingest_object_name_v1(text,text),
  private.freeze_embryo_ingest_write_record_v1(),
  private.issue_embryo_ingest_write_intent_v1(),
  private.stamp_embryo_ingest_write_fence_v1(uuid),
  private.fence_embryo_ingest_writes_v1(),
  private.guard_embryo_ingest_object_v1(),
  private.refuse_committed_embryo_ingest_probe_v1(),
  private.gate_embryo_ingest_chunk_objects_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Still missing before any route accepts embryo bytes: the deletion ACK (with
-- D-130's recorded-bucket fix) and the terminal graph purge. An `uncertain`
-- intent keeps the unwind in storage_pending until the owner decides what
-- provider evidence is enough to say its bytes are absent.
notify pgrst,'reload schema';
