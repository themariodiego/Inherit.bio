-- Snapshot-bound, subject-partitioned exports and 24-hour artifacts.

create table public.generated_exports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  requester_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  export_kind text not null check (export_kind in ('account_portable', 'subject_raw', 'cohort_portable', 'family_portable')),
  target_kind text not null check (target_kind in ('account', 'subject', 'cohort', 'family_pair')),
  target_id uuid not null,
  purpose text not null check (purpose in ('raw.export', 'export.share-link')),
  lifecycle_revision bigint not null check (lifecycle_revision > 0),
  grant_revision bigint,
  principal_graph_revision bigint not null check (principal_graph_revision > 0),
  principal_graph_fingerprint text not null check (principal_graph_fingerprint ~ '^[0-9a-f]{64}$'),
  export_revision bigint not null check (export_revision > 0),
  subject_partitions jsonb not null default '[]'::jsonb,
  manifest jsonb not null default '[]'::jsonb,
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  object_id uuid unique,
  archive_sha256 text check (archive_sha256 is null or archive_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint check (byte_count is null or byte_count > 0),
  status text not null default 'queued' check (status in ('queued', 'building', 'ready', 'failed', 'revoked', 'expired', 'purged')),
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz,
  unique (id, export_revision),
  check (jsonb_typeof(subject_partitions) = 'array' and jsonb_typeof(manifest) = 'array'),
  check (
    (status = 'ready') = (
      completed_at is not null and expires_at is not null and object_id is not null
      and archive_sha256 is not null and manifest_sha256 is not null and byte_count is not null
    )
  ),
  check (expires_at is null or (expires_at > requested_at and expires_at <= requested_at + interval '24 hours'))
);

alter table public.genome_storage_objects
  add column generated_export_id uuid references public.generated_exports (id)
    deferrable initially deferred,
  drop constraint genome_storage_objects_one_binding,
  add constraint genome_storage_objects_one_binding
    check (num_nonnulls(genome_file_id, cohort_id, generated_export_id) = 1);

alter table public.generated_exports
  add constraint generated_exports_object_fk
  foreign key (object_id) references public.genome_storage_objects (object_id)
  deferrable initially deferred;

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
  select case
    when p_target_kind = 'export' then exists (
      select 1 from public.generated_exports e
      where e.id = p_target_id
        and e.account_id = p_account_id
        and e.export_revision = p_lifecycle_revision
        and e.status = 'ready'
        and e.expires_at > clock_timestamp()
    )
    else private.resource_authorized_v1(
      p_account_id, p_target_kind, p_target_id, p_purpose,
      p_lifecycle_revision, p_grant_revision
    )
  end
$$;

revoke all on function private.download_target_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.download_target_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  to service_role;

alter table public.generated_exports enable row level security;
revoke all on table public.generated_exports from anon, authenticated;
grant all on table public.generated_exports to service_role;
