-- E0 transport persistence primitives. No public route is enabled here.
-- A route must still resolve the complete legal/capability authority before
-- calling these service-only routines. Their binding checks are defense in depth.
alter table public.embryo_ingest_sessions
  drop constraint embryo_ingest_sessions_status_check,
  add constraint embryo_ingest_sessions_status_check check (status in (
    'open', 'mapping_required', 'complete', 'processing', 'published',
    'failed', 'abandoned', 'cancelled', 'sanitization_pending', 'failure_pending'
  )),
  add column account_auth_session_revision bigint check (account_auth_session_revision > 0),
  add column account_revision bigint check (account_revision > 0),
  add column ingest_revision bigint check (ingest_revision > 0),
  add column cohort_lifecycle_revision bigint check (cohort_lifecycle_revision > 0),
  add column declared_capacity_bytes bigint check (declared_capacity_bytes between 1 and 200000000),
  add column accepted_records bigint not null default 0 check (accepted_records between 0 and 10000000),
  add column failure_code text check (failure_code in (
    'format', 'header', 'build', 'mapping', 'chunk', 'quota', 'limit', 'cancel',
    'abort', 'expiry', 'authenticated-session-revocation', 'stale-binding', 'retry-exhaustion'
  ));

-- A receipt represents transport identity; its objects are independently
-- attributable to ordinals. Metadata is reserved BEFORE writing Storage.
create table public.embryo_ingest_chunks (
  session_id uuid not null references public.embryo_ingest_sessions(id) on delete cascade,
  sequence integer not null check (sequence between 0 and 49),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count between 1 and 4000000),
  record_count integer not null check (record_count between 0 and 10000000),
  maximum_line_bytes integer not null check (maximum_line_bytes between 1 and 1000000),
  state text not null default 'reserved' check (state in ('reserved', 'stored')),
  created_at timestamptz not null default clock_timestamp(),
  stored_at timestamptz,
  primary key (session_id, sequence),
  check ((state = 'stored') = (stored_at is not null))
);
alter table public.embryo_ingest_chunks enable row level security;
revoke all on public.embryo_ingest_chunks from public, anon, authenticated;
grant all on public.embryo_ingest_chunks to service_role;

-- There has never been an enabled embryo-ingest writer. Refuse migration over
-- unexpected old fragments instead of silently assigning them to ordinal zero.
do $$
begin
  if exists (select 1 from public.embryo_ingest_fragments) then
    raise exception 'existing embryo fragments require explicit migration';
  end if;
end;
$$;
alter table public.embryo_ingest_fragments
  drop constraint embryo_ingest_fragments_pkey,
  add column sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  add primary key (session_id, sequence, sample_ordinal),
  add foreign key (session_id, sequence)
    references public.embryo_ingest_chunks(session_id, sequence) on delete cascade;

insert into public.purge_target_stores (target_id, store_name, store_order)
values ('upload-and-ingest-working-state', 'public.embryo_ingest_chunks', 30);

-- This is a durable denial marker, NOT the cohort-wide unwind. Callers must
-- dispatch that unwind against the identical cohort/revision. Never delete or
-- cancel the due target, handle map, receipt or reserved object on this path.
create function private.mark_embryo_ingest_failure_v1(p_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
  if p_code is null or p_code not in (
    'format', 'header', 'build', 'mapping', 'chunk', 'quota', 'limit', 'cancel',
    'abort', 'expiry', 'authenticated-session-revocation', 'stale-binding', 'retry-exhaustion'
  ) then
    raise exception using errcode = '22023', message = 'invalid failure code';
  end if;
  select status into v_status from public.embryo_ingest_sessions
    where id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'denied'); end if;
  if v_status = 'published' then return jsonb_build_object('status', 'published'); end if;
  update public.embryo_ingest_sessions
    set status = 'failure_pending', failure_code = coalesce(failure_code, p_code)
    where id = p_session_id;
  return jsonb_build_object('status', 'failure_pending');
end;
$$;

-- Called with the session locked by the caller. This intentionally returns no
-- authority decision for clients and does not replace the full case-artifact,
-- five-principal-set, jurisdiction and capability resolver.
create function private.embryo_ingest_binding_failure_v1(p_session_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.embryo_ingest_sessions%rowtype;
  v_cohort public.embryo_cohorts%rowtype;
begin
  select * into v_session from public.embryo_ingest_sessions where id = p_session_id;
  if not found then return 'stale-binding'; end if;
  if v_session.expires_at <= clock_timestamp() then return 'expiry'; end if;
  select * into v_cohort from public.embryo_cohorts where id = v_session.cohort_id for share;
  if not found or v_cohort.publication_revision is not null
    or v_cohort.status not in ('upload_pending', 'ingesting')
    or v_session.ingest_revision is distinct from v_cohort.ingest_revision
    or v_session.cohort_lifecycle_revision is distinct from v_cohort.lifecycle_revision
    or v_session.basis_case is distinct from v_cohort.basis_case
    or v_session.basis_revision is distinct from v_cohort.basis_revision
    or v_session.participant_set_revision is distinct from v_cohort.participant_set_revision
    or v_session.donor_attribution_revision is distinct from v_cohort.donor_attribution_revision
  then return 'stale-binding'; end if;
  perform 1 from auth.sessions s
      join auth.users u on u.id = s.user_id
      join public.profiles p on p.id = u.id
      join public.subject_principals principal on principal.id = v_session.uploader_principal_id
    where s.id = v_session.originating_session_id and s.user_id = v_cohort.owner_account_id
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= clock_timestamp())
      and principal.account_id = u.id and principal.status = 'active'
      and p.auth_session_revision = v_session.account_auth_session_revision
      and p.account_revision = v_session.account_revision
      and p.deletion_requested_at is null and p.non_self_upload_suspended_at is null
      and (s.aal = 'aal2' or not exists (
        select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'
      ))
    for share of s, u, p, principal;
  if not found then return 'authenticated-session-revocation'; end if;
  -- The exact, still-live due pair must survive all nonterminal work.
  perform 1 from public.retention_rows r
      join public.retention_due_phases d on d.retention_row_id = r.id
    where r.retention_id = 'embryo.ingest-session-24h'
      and r.target_kind = 'ingest_session' and r.target_id = v_session.id
      and r.retention_revision = v_session.ingest_revision
      and r.target_lifecycle_revision = v_session.cohort_lifecycle_revision
      and r.fixed_deadline = v_session.expires_at and r.state in ('scheduled', 'active')
      and d.phase_id = 'ingest-abandoned-no-source'
      and d.retention_id = r.retention_id
      and d.phase_kind = 'ingest-abandoned-no-source'
      and d.phase_revision = v_session.ingest_revision
      and d.target_kind = r.target_kind and d.target_id = r.target_id
      and d.phase_deadline = r.fixed_deadline
      and d.target_lifecycle_revision = r.target_lifecycle_revision
      and d.immutable_envelope = jsonb_build_object(
        'cohortId', v_session.cohort_id, 'ingestRevision', v_session.ingest_revision)
      and d.status in ('pending', 'retry')
    for share of r, d;
  if not found then return 'stale-binding'; end if;
  return null;
end;
$$;

create function private.reserve_embryo_ingest_chunk_v1(
  p_session_id uuid, p_sequence integer, p_sha256 text, p_byte_count integer,
  p_record_count integer, p_maximum_line_bytes integer, p_fragments jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.embryo_ingest_sessions%rowtype;
  v_receipt public.embryo_ingest_chunks%rowtype;
  v_count integer;
  v_fragment jsonb;
  v_failure text;
  v_objects jsonb;
begin
  select * into v_session from public.embryo_ingest_sessions
    where id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'denied'); end if;
  if v_session.status = 'failure_pending' then
    return jsonb_build_object('status', 'failure_pending');
  end if;
  if v_session.status <> 'open' then return jsonb_build_object('status', 'denied'); end if;
  v_failure := private.embryo_ingest_binding_failure_v1(p_session_id);
  if v_failure is not null then
    return private.mark_embryo_ingest_failure_v1(p_session_id, v_failure);
  end if;
  if p_sequence is null or p_sequence < 0 or p_sha256 is null
    or p_sha256 !~ '^[0-9a-f]{64}$'
  then return private.mark_embryo_ingest_failure_v1(p_session_id, 'chunk'); end if;

  select * into v_receipt from public.embryo_ingest_chunks
    where session_id = p_session_id and sequence = p_sequence;
  if found then
    if v_receipt.content_sha256 <> p_sha256 then
      return private.mark_embryo_ingest_failure_v1(p_session_id, 'chunk');
    end if;
    -- The same bytes resume the SAME object names; no new capacity or objects.
    select coalesce(jsonb_agg(jsonb_build_object(
      'ordinal', f.sample_ordinal, 'objectId', f.object_id
    ) order by f.sample_ordinal), '[]'::jsonb) into v_objects
    from public.embryo_ingest_fragments f
    where f.session_id = p_session_id and f.sequence = p_sequence;
    return jsonb_build_object('status', v_receipt.state, 'objects', v_objects);
  end if;
  if p_sequence <> v_session.expected_next_sequence
    or exists (select 1 from public.embryo_ingest_chunks
      where session_id = p_session_id and state = 'reserved')
  then return private.mark_embryo_ingest_failure_v1(p_session_id, 'chunk'); end if;

  if p_byte_count is null or p_byte_count not between 1 and 4000000
    or p_record_count is null or p_record_count not between 0 and 10000000
    or p_maximum_line_bytes is null or p_maximum_line_bytes not between 1 and 1000000
    or p_maximum_line_bytes > p_byte_count
    or v_session.declared_capacity_bytes is null
    or v_session.accepted_bytes + p_byte_count > v_session.declared_capacity_bytes
    or v_session.accepted_bytes + p_byte_count > 200000000
    or v_session.accepted_records + p_record_count > 10000000
    or v_session.accepted_chunks >= 50
  then return private.mark_embryo_ingest_failure_v1(p_session_id, 'quota'); end if;

  select embryo_count into v_count from public.embryo_cohorts where id = v_session.cohort_id;
  if jsonb_typeof(p_fragments) is distinct from 'array' then
    return private.mark_embryo_ingest_failure_v1(p_session_id, 'format');
  end if;
  if jsonb_array_length(p_fragments) > v_count then
    return private.mark_embryo_ingest_failure_v1(p_session_id, 'format');
  end if;
  for v_fragment in select value from jsonb_array_elements(p_fragments) loop
    if jsonb_typeof(v_fragment) is distinct from 'object' then
      return private.mark_embryo_ingest_failure_v1(p_session_id, 'format');
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(v_fragment) k)
        is distinct from array['bytes', 'lines', 'ordinal', 'sha256']::text[]
      or jsonb_typeof(v_fragment->'ordinal') is distinct from 'number'
      or (v_fragment->>'ordinal') !~ '^[0-9]{1,2}$'
      or (v_fragment->>'ordinal')::integer >= v_count
      or jsonb_typeof(v_fragment->'bytes') is distinct from 'number'
      or (v_fragment->>'bytes') !~ '^[1-9][0-9]{0,7}$'
      or (v_fragment->>'bytes')::integer > p_byte_count + 4096
      or jsonb_typeof(v_fragment->'lines') is distinct from 'number'
      or (v_fragment->>'lines') !~ '^[1-9][0-9]{0,7}$'
      or jsonb_typeof(v_fragment->'sha256') is distinct from 'string'
      or (v_fragment->>'sha256') !~ '^[0-9a-f]{64}$'
    then return private.mark_embryo_ingest_failure_v1(p_session_id, 'format'); end if;
  end loop;
  if (select count(distinct value->>'ordinal') from jsonb_array_elements(p_fragments))
    <> jsonb_array_length(p_fragments)
  then return private.mark_embryo_ingest_failure_v1(p_session_id, 'format'); end if;

  insert into public.embryo_ingest_chunks (
    session_id, sequence, content_sha256, byte_count, record_count, maximum_line_bytes
  ) values (p_session_id, p_sequence, p_sha256, p_byte_count, p_record_count, p_maximum_line_bytes);
  insert into public.embryo_ingest_fragments (
    session_id, sequence, sample_ordinal, object_id, content_sha256, byte_count, line_count
  ) select p_session_id, p_sequence, (value->>'ordinal')::smallint, gen_random_uuid(),
    value->>'sha256', (value->>'bytes')::integer, (value->>'lines')::integer
    from jsonb_array_elements(p_fragments);
  update public.embryo_ingest_sessions set
    accepted_bytes = accepted_bytes + p_byte_count,
    accepted_chunks = accepted_chunks + 1,
    accepted_records = accepted_records + p_record_count
    where id = p_session_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ordinal', f.sample_ordinal, 'objectId', f.object_id
  ) order by f.sample_ordinal), '[]'::jsonb) into v_objects
    from public.embryo_ingest_fragments f
    where f.session_id = p_session_id and f.sequence = p_sequence;
  return jsonb_build_object('status', 'reserved', 'objects', v_objects);
exception when invalid_text_representation or numeric_value_out_of_range then
  return private.mark_embryo_ingest_failure_v1(p_session_id, 'format');
end;
$$;

-- Call only after every reserved object has been written and its digest
-- verified. No canonical publication, source row or analysis job is produced.
create function private.commit_embryo_ingest_chunk_v1(
  p_session_id uuid, p_sequence integer, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.embryo_ingest_sessions%rowtype;
  v_receipt public.embryo_ingest_chunks%rowtype;
  v_failure text;
begin
  select * into v_session from public.embryo_ingest_sessions
    where id = p_session_id for update;
  if not found then return jsonb_build_object('status', 'denied'); end if;
  if v_session.status = 'failure_pending' then
    return jsonb_build_object('status', 'failure_pending');
  end if;
  if v_session.status <> 'open' then return jsonb_build_object('status', 'denied'); end if;
  v_failure := private.embryo_ingest_binding_failure_v1(p_session_id);
  if v_failure is not null then
    return private.mark_embryo_ingest_failure_v1(p_session_id, v_failure);
  end if;
  select * into v_receipt from public.embryo_ingest_chunks
    where session_id = p_session_id and sequence = p_sequence;
  if not found or v_receipt.content_sha256 is distinct from p_sha256 then
    return private.mark_embryo_ingest_failure_v1(p_session_id, 'chunk');
  end if;
  if v_receipt.state = 'stored' then return jsonb_build_object('status', 'stored'); end if;
  if p_sequence <> v_session.expected_next_sequence then
    return private.mark_embryo_ingest_failure_v1(p_session_id, 'chunk');
  end if;
  update public.embryo_ingest_chunks set state = 'stored', stored_at = clock_timestamp()
    where session_id = p_session_id and sequence = p_sequence;
  update public.embryo_ingest_sessions set expected_next_sequence = p_sequence + 1
    where id = p_session_id;
  return jsonb_build_object('status', 'stored');
end;
$$;

revoke all on function private.mark_embryo_ingest_failure_v1(uuid,text),
  private.embryo_ingest_binding_failure_v1(uuid),
  private.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb),
  private.commit_embryo_ingest_chunk_v1(uuid,integer,text)
  from public, anon, authenticated;
grant execute on function private.mark_embryo_ingest_failure_v1(uuid,text),
  private.embryo_ingest_binding_failure_v1(uuid),
  private.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb),
  private.commit_embryo_ingest_chunk_v1(uuid,integer,text)
  to service_role;
