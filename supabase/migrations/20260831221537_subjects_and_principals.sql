-- Inherit v2 subject and principal graph.
-- New public tables start closed: RLS is enabled and anon/authenticated have
-- no privileges until the dedicated RLS migration grants an exact operation.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

alter table public.profiles
  add column account_revision bigint not null default 1
    check (account_revision > 0),
  add column auth_session_revision bigint not null default 1
    check (auth_session_revision > 0),
  add column jurisdiction_code text
    check (jurisdiction_code is null or jurisdiction_code ~ '^[A-Z]{2}$'),
  add column jurisdiction_revision bigint not null default 1
    check (jurisdiction_revision > 0),
  add column non_self_upload_suspended_at timestamptz,
  add column deletion_requested_at timestamptz;

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid references auth.users (id) on delete restrict,
  subject_account_id uuid references auth.users (id) on delete restrict,
  subject_class text not null
    check (subject_class in ('self', 'other_adult', 'minor', 'embryo')),
  upload_class text not null
    check (upload_class in ('self', 'adult', 'embryo_own', 'embryo_third_party')),
  display_label text not null
    check (char_length(display_label) between 1 and 80),
  lifecycle text not null default 'active'
    check (lifecycle in (
      'draft', 'quarantined', 'active', 'restricted', 'revoked',
      'purge_queued', 'purged', 'claimed_unbound', 'claimed_bound'
    )),
  subject_binding_revision bigint not null default 1
    check (subject_binding_revision > 0),
  lifecycle_revision bigint not null default 1
    check (lifecycle_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (owner_account_id is not null or subject_account_id is not null or subject_class = 'embryo'),
  check ((subject_class = 'self') = (owner_account_id is not null and owner_account_id = subject_account_id)),
  check (
    (subject_class = 'self' and upload_class = 'self')
    or (subject_class in ('other_adult', 'minor') and upload_class = 'adult')
    or (subject_class = 'embryo' and upload_class in ('embryo_own', 'embryo_third_party'))
  )
);

create unique index subjects_one_self_per_account_idx
  on public.subjects (subject_account_id)
  where subject_class = 'self' and lifecycle <> 'purged';
create index subjects_owner_idx on public.subjects (owner_account_id, lifecycle);
create index subjects_account_idx on public.subjects (subject_account_id, lifecycle);

create table public.subject_demographics (
  subject_id uuid primary key references public.subjects (id) on delete cascade,
  date_of_birth date,
  chromosomal_sex text check (chromosomal_sex in ('XX', 'XY', 'other', 'unknown')),
  demographics_revision bigint not null default 1 check (demographics_revision > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.subject_principals (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects (id) on delete restrict,
  account_id uuid references auth.users (id) on delete restrict,
  principal_kind text not null check (principal_kind in (
    'account_subject', 'non_account_subject', 'future_person',
    'genetic_parent', 'identified_donor', 'reviewer', 'service'
  )),
  principal_revision bigint not null default 1 check (principal_revision > 0),
  status text not null default 'active'
    check (status in ('pending', 'active', 'revoked', 'detached', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  check (subject_id is not null or account_id is not null or principal_kind in ('reviewer', 'service')),
  check (principal_kind <> 'account_subject' or account_id is not null)
);

create unique index subject_principals_current_account_idx
  on public.subject_principals (account_id, subject_id, principal_kind)
  where status = 'active' and account_id is not null;
create index subject_principals_subject_idx
  on public.subject_principals (subject_id, status, principal_kind);

create table public.subject_account_bindings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  subject_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  account_id uuid not null references auth.users (id) on delete restrict,
  account_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  binding_kind text not null
    check (binding_kind in ('self', 'adult_claim', 'future_person_claim')),
  binding_revision bigint not null check (binding_revision > 0),
  status text not null check (status in ('pending', 'current', 'superseded', 'revoked')),
  bound_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check ((status in ('superseded', 'revoked')) = (ended_at is not null))
);

create unique index subject_account_bindings_current_subject_idx
  on public.subject_account_bindings (subject_id)
  where status = 'current';
create unique index subject_account_bindings_current_account_subject_idx
  on public.subject_account_bindings (account_id, subject_id)
  where status = 'current';

create table public.subject_relationships (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  data_subject_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_account_id uuid references auth.users (id) on delete restrict,
  relationship_kind text not null check (relationship_kind in (
    'self', 'uploader', 'adult_controller', 'family_member',
    'genetic_parent', 'co_parent', 'future_person_claimant'
  )),
  relationship_revision bigint not null check (relationship_revision > 0),
  status text not null default 'current'
    check (status in ('pending', 'current', 'superseded', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check (data_subject_principal_id <> recipient_principal_id or relationship_kind = 'self'),
  check ((status in ('superseded', 'revoked')) = (ended_at is not null))
);

create unique index subject_relationships_current_direction_idx
  on public.subject_relationships (
    subject_id, data_subject_principal_id, recipient_principal_id, relationship_kind
  ) where status = 'current';
create index subject_relationships_recipient_idx
  on public.subject_relationships (recipient_principal_id, recipient_account_id, status);

create table public.family_pairs (
  id uuid primary key default gen_random_uuid(),
  subject_a_id uuid not null references public.subjects (id) on delete restrict,
  subject_b_id uuid not null references public.subjects (id) on delete restrict,
  subject_low_id uuid generated always as (least(subject_a_id, subject_b_id)) stored,
  subject_high_id uuid generated always as (greatest(subject_a_id, subject_b_id)) stored,
  pair_revision bigint not null default 1 check (pair_revision > 0),
  status text not null default 'current'
    check (status in ('pending', 'current', 'revoked', 'purged')),
  created_at timestamptz not null default clock_timestamp(),
  check (subject_a_id <> subject_b_id),
  unique (subject_low_id, subject_high_id)
);

create or replace function private.reject_embryo_demographics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.subjects s
    where s.id = new.subject_id
      and s.subject_class = 'embryo'
  ) then
    raise exception using
      errcode = '23514',
      message = 'embryo demographics are forbidden';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_embryo_demographics() from public, anon, authenticated;
grant execute on function private.reject_embryo_demographics() to service_role;

create trigger subject_demographics_reject_embryo
before insert or update on public.subject_demographics
for each row execute function private.reject_embryo_demographics();

alter table public.subjects enable row level security;
alter table public.subject_demographics enable row level security;
alter table public.subject_principals enable row level security;
alter table public.subject_account_bindings enable row level security;
alter table public.subject_relationships enable row level security;
alter table public.family_pairs enable row level security;

revoke all on table public.subjects from anon, authenticated;
revoke all on table public.subject_demographics from anon, authenticated;
revoke all on table public.subject_principals from anon, authenticated;
revoke all on table public.subject_account_bindings from anon, authenticated;
revoke all on table public.subject_relationships from anon, authenticated;
revoke all on table public.family_pairs from anon, authenticated;

grant all on table public.subjects to service_role;
grant all on table public.subject_demographics to service_role;
grant all on table public.subject_principals to service_role;
grant all on table public.subject_account_bindings to service_role;
grant all on table public.subject_relationships to service_role;
grant all on table public.family_pairs to service_role;
