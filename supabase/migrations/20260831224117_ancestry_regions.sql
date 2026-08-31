-- Versioned reference geography and subject-bound regional estimates.

create table public.ref_region_releases (
  release_id text primary key check (release_id ~ '^ancestry-regions-v[0-9]+$'),
  name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null,
  retired_at timestamptz
);

create table public.ref_regions (
  region_code text not null check (region_code ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  release_id text not null references public.ref_region_releases (release_id) on delete restrict,
  parent_region_code text,
  display_name text not null,
  level smallint not null check (level between 0 and 8),
  sort_order integer not null check (sort_order >= 0),
  citation_ids text[] not null default '{}',
  primary key (release_id, region_code),
  foreign key (release_id, parent_region_code)
    references public.ref_regions (release_id, region_code) deferrable initially deferred
);

alter table public.ancestry_results
  add column model_id text,
  add column model_version text,
  add column computation_revision bigint not null default 1 check (computation_revision > 0),
  add column source_binding_fingerprint text
    check (source_binding_fingerprint is null or source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  add column coverage double precision check (coverage is null or coverage between 0 and 1),
  add column result_state text not null default 'legacy_unverified'
    check (result_state in ('legacy_unverified', 'available', 'partial', 'not_covered', 'suppressed')),
  add column not_covered_reason text;

create table public.ancestry_regions (
  ancestry_result_id uuid not null references public.ancestry_results (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  release_id text not null,
  region_code text not null,
  point double precision not null check (point between 0 and 1),
  p05 double precision not null check (p05 between 0 and 1),
  p95 double precision not null check (p95 between 0 and 1),
  markers_used integer not null check (markers_used >= 0),
  method_version text not null,
  evidence_label text not null check (evidence_label in ('established', 'emerging', 'preliminary')),
  primary key (ancestry_result_id, region_code),
  foreign key (release_id, region_code)
    references public.ref_regions (release_id, region_code) on delete restrict,
  check (p05 <= point and point <= p95)
);

create index ancestry_regions_subject_idx
  on public.ancestry_regions (subject_id, ancestry_result_id);

alter table public.ref_region_releases enable row level security;
alter table public.ref_regions enable row level security;
alter table public.ancestry_regions enable row level security;
revoke all on table public.ref_region_releases, public.ref_regions,
  public.ancestry_regions from anon, authenticated;
grant all on table public.ref_region_releases, public.ref_regions,
  public.ancestry_regions to service_role;
grant select on table public.ref_region_releases, public.ref_regions to anon, authenticated;
create policy ref_region_releases_public_read
  on public.ref_region_releases for select to anon, authenticated
  using (published_at <= clock_timestamp() and retired_at is null);
create policy ref_regions_public_read
  on public.ref_regions for select to anon, authenticated
  using (exists (
    select 1 from public.ref_region_releases r
    where r.release_id = ref_regions.release_id
      and r.published_at <= clock_timestamp() and r.retired_at is null
  ));
