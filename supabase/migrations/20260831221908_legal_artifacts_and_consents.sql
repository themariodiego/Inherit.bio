-- Versioned legal evidence and exact directional purpose grants.

create table public.consent_artifacts (
  artifact_key text not null,
  version integer not null check (version > 0),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  body_markdown text not null check (char_length(body_markdown) > 0),
  summary_markdown text not null check (char_length(summary_markdown) > 0),
  effective_on date not null,
  summary_of_changes text,
  published_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  primary key (artifact_key, version),
  check (version = 1 or nullif(btrim(summary_of_changes), '') is not null)
);

create unique index consent_artifacts_current_idx
  on public.consent_artifacts (artifact_key)
  where superseded_at is null;

create table public.consent_signatures (
  id uuid primary key default gen_random_uuid(),
  artifact_key text not null,
  artifact_version integer not null,
  artifact_body_sha256 text not null check (artifact_body_sha256 ~ '^[0-9a-f]{64}$'),
  signer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  signer_account_id uuid references auth.users (id) on delete restrict,
  target_kind text not null check (target_kind in (
    'subject', 'cohort', 'cohort_draft', 'donor_attribution', 'provider', 'account'
  )),
  target_id uuid not null,
  purpose text,
  statement_keys text[] not null default '{}',
  signing_name_encrypted bytea,
  jurisdiction_code text not null check (jurisdiction_code ~ '^[A-Z]{2}$'),
  jurisdiction_revision bigint not null check (jurisdiction_revision > 0),
  subject_binding_revision bigint,
  signed_at timestamptz not null default clock_timestamp(),
  foreign key (artifact_key, artifact_version)
    references public.consent_artifacts (artifact_key, version) on delete restrict,
  check (subject_binding_revision is null or subject_binding_revision > 0)
);

create index consent_signatures_target_idx
  on public.consent_signatures (target_kind, target_id, artifact_key, signed_at desc);
create index consent_signatures_signer_idx
  on public.consent_signatures (signer_principal_id, signed_at desc);

create table public.subject_consents (
  id uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.consent_signatures (id) on delete restrict,
  subject_id uuid references public.subjects (id) on delete restrict,
  cohort_id uuid,
  account_id uuid references auth.users (id) on delete restrict,
  consent_type text not null check (consent_type in (
    'self_source', 'adult_source', 'embryo_source', 'cloud_model',
    'family_portrait', 'raw_export', 'future_person', 'donor_attribution'
  )),
  scope text[] not null check (cardinality(scope) > 0),
  provider_key text,
  grant_revision bigint not null default 1 check (grant_revision > 0),
  granted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason in (
    'withdrawn', 'superseded', 'account_deleted', 'retention_expired',
    'jurisdiction_lost', 'relationship_changed', 'contradiction'
  )),
  check (num_nonnulls(subject_id, cohort_id) = 1),
  check ((revoked_at is null) = (revocation_reason is null)),
  check (expires_at is null or expires_at > granted_at)
);

create unique index subject_consents_active_idx
  on public.subject_consents (
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    consent_type,
    coalesce(provider_key, '')
  ) where revoked_at is null;

create table public.attestations (
  id uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.consent_signatures (id) on delete restrict,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  target_kind text not null check (target_kind in ('subject', 'cohort', 'cohort_draft', 'account')),
  target_id uuid not null,
  kind text not null check (kind in (
    'own_embryo', 'genetic_parent', 'parents_permission', 'jurisdiction',
    'single_parent_authority', 'adult_control', 'future_person_acknowledgement'
  )),
  statement_keys text[] not null check (cardinality(statement_keys) > 0),
  affirmed boolean not null check (affirmed),
  attestation_revision bigint not null default 1 check (attestation_revision > 0),
  affirmed_at timestamptz not null default clock_timestamp()
);

create index attestations_target_idx
  on public.attestations (target_kind, target_id, kind, affirmed_at desc);

create table public.attestation_contradictions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects (id) on delete restrict,
  cohort_id uuid,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  attestation_id uuid references public.attestations (id) on delete restrict,
  contradiction_code text not null,
  lifecycle_revision bigint not null check (lifecycle_revision > 0),
  recorded_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check (num_nonnulls(subject_id, cohort_id) = 1)
);

create table public.subject_invitations (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('subject', 'cohort', 'cohort_draft', 'donor_attribution')),
  target_id uuid not null,
  inviter_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  invitee_principal_id uuid references public.subject_principals (id) on delete restrict,
  email_hmac text not null check (email_hmac ~ '^[0-9a-f]{64}$'),
  email_encrypted bytea,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invitation_kind text not null check (invitation_kind in (
    'adult_subject', 'co_parent', 'identified_donor_subject'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'refused', 'expired', 'cancelled', 'revoked'
  )),
  invitation_revision bigint not null default 1 check (invitation_revision > 0),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  terminal_at timestamptz,
  contact_purge_due_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check ((status = 'pending') = (terminal_at is null))
);

create index subject_invitations_pending_email_idx
  on public.subject_invitations (email_hmac, expires_at)
  where status = 'pending';

create table public.invitation_refusal_hmacs (
  email_hmac text primary key check (email_hmac ~ '^[0-9a-f]{64}$'),
  refusal_revision bigint not null check (refusal_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create table public.legal_reviews (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in (
    'adult_control', 'single_parent_basis', 'future_person_claim',
    'future_person_correction', 'appeal'
  )),
  target_id uuid not null,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  decision text not null check (decision in ('approved', 'denied', 'needs_more_evidence')),
  decision_code text not null,
  review_revision bigint not null check (review_revision > 0),
  reviewed_at timestamptz not null default clock_timestamp()
);

create table public.reviewed_evidence (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.legal_reviews (id) on delete restrict,
  evidence_kind text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_id uuid,
  evidence_revision bigint not null check (evidence_revision > 0),
  received_at timestamptz not null default clock_timestamp(),
  purged_at timestamptz
);

create table public.purpose_grants (
  grant_id uuid primary key default gen_random_uuid(),
  grant_revision bigint not null check (grant_revision > 0),
  target_kind text not null check (target_kind in ('subject', 'cohort', 'family_pair')),
  target_id uuid not null,
  purpose text not null check (purpose in (
    'reports.monogenic', 'reports.polygenic', 'ancestry', 'copilot.local',
    'copilot.cloud', 'family.heritability', 'family.portrait',
    'export.share-link', 'raw.export', 'embryo.analysis'
  )),
  artifact_key text not null,
  artifact_version integer not null,
  artifact_body_sha256 text not null check (artifact_body_sha256 ~ '^[0-9a-f]{64}$'),
  signature_id uuid not null references public.consent_signatures (id) on delete restrict,
  signer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  data_subject_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  subject_binding_revision bigint not null check (subject_binding_revision > 0),
  jurisdiction_code text not null check (jurisdiction_code ~ '^[A-Z]{2}$'),
  jurisdiction_revision bigint not null check (jurisdiction_revision > 0),
  granted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  foreign key (artifact_key, artifact_version)
    references public.consent_artifacts (artifact_key, version) on delete restrict,
  check (expires_at is null or expires_at > granted_at),
  check ((revoked_at is null) = (revocation_reason is null))
);

create index purpose_grants_target_idx
  on public.purpose_grants (target_kind, target_id, purpose, revoked_at);
create index purpose_grants_subject_principal_idx
  on public.purpose_grants (data_subject_principal_id, purpose, revoked_at);

create table public.directional_grants (
  grant_id uuid primary key,
  grant_revision bigint not null check (grant_revision > 0),
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_account_id uuid references auth.users (id) on delete restrict,
  relationship_id uuid references public.subject_relationships (id) on delete restrict,
  pair_id uuid references public.family_pairs (id) on delete restrict,
  relationship_or_pair_revision bigint not null check (relationship_or_pair_revision > 0),
  direction text not null check (direction in ('subject_to_recipient', 'a_to_b', 'b_to_a', 'self')),
  status text not null default 'current' check (status in ('current', 'superseded', 'revoked', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check (num_nonnulls(relationship_id, pair_id) <= 1),
  check ((status = 'current') = (ended_at is null))
);

create index directional_grants_recipient_idx
  on public.directional_grants (recipient_principal_id, recipient_account_id, status);

create or replace function private.assert_directional_grant_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_id uuid := coalesce(new.grant_id, old.grant_id);
  base_revision bigint;
  extension_revision bigint;
  base_revoked_at timestamptz;
  extension_ended_at timestamptz;
begin
  select pg.grant_revision, pg.revoked_at
    into base_revision, base_revoked_at
  from public.purpose_grants pg
  where pg.grant_id = checked_id;

  select dg.grant_revision, dg.ended_at
    into extension_revision, extension_ended_at
  from public.directional_grants dg
  where dg.grant_id = checked_id;

  if (base_revision is null) <> (extension_revision is null) then
    raise exception using errcode = '23514', message = 'orphan directional grant row';
  end if;

  if base_revision is not null and (
    base_revision <> extension_revision
    or (base_revoked_at is null) <> (extension_ended_at is null)
  ) then
    raise exception using errcode = '23514', message = 'directional grant revision or lifecycle mismatch';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.assert_directional_grant_pair() from public, anon, authenticated;
grant execute on function private.assert_directional_grant_pair() to service_role;

create constraint trigger purpose_grants_pair_check
after insert or update or delete on public.purpose_grants
deferrable initially deferred
for each row execute function private.assert_directional_grant_pair();

create constraint trigger directional_grants_pair_check
after insert or update or delete on public.directional_grants
deferrable initially deferred
for each row execute function private.assert_directional_grant_pair();

create or replace function private.reject_immutable_row_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'immutable row';
end;
$$;

revoke all on function private.reject_immutable_row_update() from public, anon, authenticated;
grant execute on function private.reject_immutable_row_update() to service_role;

create trigger consent_artifacts_immutable
before update on public.consent_artifacts
for each row execute function private.reject_immutable_row_update();

create trigger consent_signatures_immutable
before update on public.consent_signatures
for each row execute function private.reject_immutable_row_update();

alter table public.consent_artifacts enable row level security;
alter table public.consent_signatures enable row level security;
alter table public.subject_consents enable row level security;
alter table public.attestations enable row level security;
alter table public.attestation_contradictions enable row level security;
alter table public.subject_invitations enable row level security;
alter table public.invitation_refusal_hmacs enable row level security;
alter table public.legal_reviews enable row level security;
alter table public.reviewed_evidence enable row level security;
alter table public.purpose_grants enable row level security;
alter table public.directional_grants enable row level security;

revoke all on table public.consent_artifacts from anon, authenticated;
revoke all on table public.consent_signatures from anon, authenticated;
revoke all on table public.subject_consents from anon, authenticated;
revoke all on table public.attestations from anon, authenticated;
revoke all on table public.attestation_contradictions from anon, authenticated;
revoke all on table public.subject_invitations from anon, authenticated;
revoke all on table public.invitation_refusal_hmacs from anon, authenticated;
revoke all on table public.legal_reviews from anon, authenticated;
revoke all on table public.reviewed_evidence from anon, authenticated;
revoke all on table public.purpose_grants from anon, authenticated;
revoke all on table public.directional_grants from anon, authenticated;

grant select on table public.consent_artifacts to anon, authenticated;
grant all on table public.consent_artifacts to service_role;
grant all on table public.consent_signatures to service_role;
grant all on table public.subject_consents to service_role;
grant all on table public.attestations to service_role;
grant all on table public.attestation_contradictions to service_role;
grant all on table public.subject_invitations to service_role;
grant all on table public.invitation_refusal_hmacs to service_role;
grant all on table public.legal_reviews to service_role;
grant all on table public.reviewed_evidence to service_role;
grant all on table public.purpose_grants to service_role;
grant all on table public.directional_grants to service_role;

create policy consent_artifacts_public_read
on public.consent_artifacts for select
to anon, authenticated
using (published_at <= clock_timestamp());
