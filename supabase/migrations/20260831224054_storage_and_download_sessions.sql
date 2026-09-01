-- Create-only staging, database-owned final objects, and revocable range reads.

alter table public.genome_files
  add column storage_object_id uuid,
  add column structural_validator_version text,
  add column single_logical_sample_verified_at timestamptz,
  add column source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  add column canonical_build text check (canonical_build is null or canonical_build in ('GRCh37', 'GRCh38')),
  add column upload_revision bigint not null default 1 check (upload_revision > 0),
  add constraint genome_files_structural_evidence_check check (
    (single_logical_sample_verified_at is null and structural_validator_version is null and source_sha256 is null)
    or (single_logical_sample_verified_at is not null and structural_validator_version is not null and source_sha256 is not null)
  );

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  auth_session_id uuid not null,
  subject_id uuid references public.subjects (id) on delete restrict,
  cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  staging_object_name text not null unique
    check (staging_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  expected_size bigint not null check (expected_size > 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in (
    'text/plain', 'text/tab-separated-values', 'application/gzip',
    'application/octet-stream'
  )),
  upload_revision bigint not null check (upload_revision > 0),
  status text not null default 'issued' check (status in (
    'issued', 'uploaded', 'validating', 'promoted', 'rejected', 'expired', 'cancelled'
  )),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  check (num_nonnulls(subject_id, cohort_id) = 1),
  check (expires_at > created_at),
  check ((status in ('promoted', 'rejected', 'expired', 'cancelled')) = (consumed_at is not null))
);

create index upload_sessions_account_idx on public.upload_sessions (account_id, status, expires_at);

create table public.genome_storage_objects (
  object_id uuid primary key,
  object_name text not null unique
    check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  bucket_id text not null check (bucket_id in ('genomes', 'generated-artifacts')),
  genome_file_id uuid references public.genome_files (id) on delete restrict,
  cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint not null check (byte_count > 0),
  object_revision bigint not null check (object_revision > 0),
  state text not null default 'current' check (state in ('current', 'revoked', 'purge_queued', 'purged')),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint genome_storage_objects_one_binding
    check (num_nonnulls(genome_file_id, cohort_id) = 1),
  check ((state = 'current') = (revoked_at is null))
);

alter table public.genome_files
  add constraint genome_files_storage_object_fk
  foreign key (storage_object_id) references public.genome_storage_objects (object_id)
  deferrable initially deferred;

create table public.download_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  auth_session_id uuid not null,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  target_kind text not null check (target_kind in ('subject', 'cohort', 'family_pair', 'export')),
  target_id uuid not null,
  purpose text not null,
  object_id uuid not null references public.genome_storage_objects (object_id) on delete restrict,
  lifecycle_revision bigint not null check (lifecycle_revision > 0),
  grant_revision bigint,
  publication_revision bigint not null check (publication_revision > 0),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  session_revision bigint not null default 1 check (session_revision > 0),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'complete')),
  max_bytes bigint not null check (max_bytes > 0),
  served_bytes bigint not null default 0 check (served_bytes >= 0 and served_bytes <= max_bytes),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'active') = (ended_at is null))
);

create index download_sessions_account_idx on public.download_sessions (account_id, status, expires_at);
create index download_sessions_object_idx on public.download_sessions (object_id, status);

create table public.download_ranges (
  session_id uuid not null references public.download_sessions (id) on delete cascade,
  range_sequence integer not null check (range_sequence >= 0),
  byte_start bigint not null check (byte_start >= 0),
  byte_end bigint not null check (byte_end >= byte_start),
  served_at timestamptz not null default clock_timestamp(),
  primary key (session_id, range_sequence)
);

create or replace function private.download_target_authorized_v1(
  p_account_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_purpose text,
  p_lifecycle_revision bigint,
  p_grant_revision bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.resource_authorized_v1(
    p_account_id, p_target_kind, p_target_id, p_purpose,
    p_lifecycle_revision, p_grant_revision
  )
$$;

revoke all on function private.download_target_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.download_target_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  to service_role;

create or replace function private.authorize_download_range_v1(
  p_session_id uuid,
  p_account_id uuid,
  p_auth_session_id uuid,
  p_byte_start bigint,
  p_byte_end bigint,
  p_expected_session_revision bigint
)
returns table (bucket_id text, object_name text, range_sequence integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.download_sessions;
  v_object public.genome_storage_objects;
  v_sequence integer;
  v_length bigint;
begin
  select * into v_session from public.download_sessions
  where id = p_session_id for update;
  if v_session.id is null
    or v_session.account_id <> p_account_id
    or v_session.auth_session_id <> p_auth_session_id
    or v_session.session_revision <> p_expected_session_revision
    or v_session.status <> 'active'
    or v_session.expires_at <= clock_timestamp()
    or p_byte_start < 0 or p_byte_end < p_byte_start then
    raise exception using errcode = '42501', message = 'download authority is not current';
  end if;

  if not private.download_target_authorized_v1(
    p_account_id, v_session.target_kind, v_session.target_id,
    v_session.purpose, v_session.lifecycle_revision, v_session.grant_revision
  ) then
    raise exception using errcode = '42501', message = 'download resource is not authorized';
  end if;

  select * into v_object from public.genome_storage_objects
  where object_id = v_session.object_id and state = 'current' for share;
  if v_object.object_id is null then
    raise exception using errcode = '42501', message = 'download object is unavailable';
  end if;

  v_length := p_byte_end - p_byte_start + 1;
  if p_byte_end >= v_object.byte_count or v_session.served_bytes + v_length > v_session.max_bytes then
    raise exception using errcode = '22023', message = 'download range exceeds authority';
  end if;
  select coalesce(max(dr.range_sequence), -1) + 1 into v_sequence
  from public.download_ranges dr where dr.session_id = p_session_id;
  insert into public.download_ranges (session_id, range_sequence, byte_start, byte_end)
  values (p_session_id, v_sequence, p_byte_start, p_byte_end);
  update public.download_sessions set served_bytes = served_bytes + v_length
  where id = p_session_id;
  return query select v_object.bucket_id, v_object.object_name, v_sequence;
end;
$$;

revoke all on function private.authorize_download_range_v1(uuid, uuid, uuid, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.authorize_download_range_v1(uuid, uuid, uuid, bigint, bigint, bigint)
  to service_role;

insert into storage.buckets (id, name, public)
values
  ('genomes-staging', 'genomes-staging', false),
  ('generated-artifacts', 'generated-artifacts', false)
on conflict (id) do update set public = false;

drop policy if exists "genomes_select_own" on storage.objects;
drop policy if exists "genomes_insert_own" on storage.objects;
drop policy if exists "genomes_update_own" on storage.objects;
drop policy if exists "genomes_delete_own" on storage.objects;

create policy genomes_staging_create_once
on storage.objects for insert to authenticated
with check (
  bucket_id = 'genomes-staging'
  and exists (
    select 1 from public.upload_sessions us
    where us.account_id = (select auth.uid())
      and us.status = 'issued'
      and us.expires_at > clock_timestamp()
      and us.staging_object_name = name
  )
);

alter table public.upload_sessions enable row level security;
alter table public.genome_storage_objects enable row level security;
alter table public.download_sessions enable row level security;
alter table public.download_ranges enable row level security;
revoke all on table public.upload_sessions, public.genome_storage_objects,
  public.download_sessions, public.download_ranges from anon, authenticated;
grant all on table public.upload_sessions, public.genome_storage_objects,
  public.download_sessions, public.download_ranges to service_role;
grant select on table public.upload_sessions to authenticated;
create policy upload_sessions_select_own on public.upload_sessions
for select to authenticated using (account_id = (select auth.uid()));
