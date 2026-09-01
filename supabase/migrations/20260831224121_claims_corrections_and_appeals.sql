-- Future-person claims, identity matching, corrections, and appeals.

create table public.future_person_record_key_recipients (
  cohort_id uuid not null references public.embryo_cohorts (id) on delete restrict,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_set_revision bigint not null check (recipient_set_revision > 0),
  authority_revision bigint not null check (authority_revision > 0),
  status text not null default 'current' check (status in ('current', 'superseded', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  primary key (cohort_id, recipient_principal_id, recipient_set_revision),
  check ((status = 'current') = (ended_at is null))
);

create table public.future_person_claim_sessions (
  id uuid primary key default gen_random_uuid(),
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  candidate_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  record_key_recipient_principal_id uuid,
  record_key_revision bigint,
  auth_session_id uuid,
  intake_revision bigint not null check (intake_revision > 0),
  state text not null default 'draft' check (state in ('draft', 'submitted', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  foreign key (embryo_id, record_key_recipient_principal_id, record_key_revision)
    references public.future_person_record_key_hashes (
      embryo_id, recipient_principal_id, key_revision
    ) on delete restrict,
  check (num_nonnulls(record_key_recipient_principal_id, record_key_revision) in (0, 2)),
  check (expires_at > created_at),
  check ((state in ('expired', 'cancelled')) = (ended_at is not null))
);

create table public.future_person_identity (
  id uuid primary key default gen_random_uuid(),
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  identity_revision bigint not null check (identity_revision > 0),
  parent_supplied_ciphertext bytea not null,
  identity_hmac text not null check (identity_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_revision bigint not null check (hmac_key_revision > 0),
  envelope_key_revision bigint not null check (envelope_key_revision > 0),
  state text not null default 'current' check (state in ('current', 'superseded', 'shredded')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  unique (embryo_id, identity_revision),
  check ((state = 'current') = (ended_at is null))
);

create unique index future_person_identity_current_idx
  on public.future_person_identity (embryo_id) where state = 'current';

create table public.future_person_claims (
  id uuid primary key default gen_random_uuid(),
  intake_session_id uuid not null unique references public.future_person_claim_sessions (id) on delete restrict,
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  claimant_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  claimant_account_id uuid references auth.users (id) on delete restrict,
  identity_id uuid references public.future_person_identity (id) on delete restrict,
  claim_method text not null check (claim_method in ('record_key', 'keyless_documentary')),
  claim_revision bigint not null check (claim_revision > 0),
  claimant_revision bigint not null check (claimant_revision > 0),
  status text not null default 'submitted' check (status in (
    'submitted', 'reviewing', 'owner_notice', 'objected', 'approved',
    'refused', 'withdrawn', 'expired'
  )),
  submitted_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  check ((status in ('approved', 'refused', 'withdrawn', 'expired')) = (decided_at is not null))
);

create index future_person_claims_embryo_idx on public.future_person_claims (embryo_id, status);
create unique index future_person_claims_current_idx on public.future_person_claims (embryo_id)
  where status in ('submitted', 'reviewing', 'owner_notice', 'objected', 'approved');

create table public.future_person_claim_documents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  evidence_kind text not null check (evidence_kind in ('photo_identity', 'birth_record', 'clinic_record', 'parentage_record')),
  reviewed_evidence_id uuid not null references public.reviewed_evidence (id) on delete restrict,
  evidence_revision bigint not null check (evidence_revision > 0),
  status text not null check (status in ('pending', 'approved', 'rejected', 'expired')),
  unique (claim_id, evidence_kind, evidence_revision)
);

create table public.future_person_claim_objections (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  objector_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  objection_revision bigint not null check (objection_revision > 0),
  reason_code text not null,
  reviewed_evidence_id uuid references public.reviewed_evidence (id) on delete restrict,
  status text not null default 'submitted' check (status in ('submitted', 'upheld', 'overruled', 'withdrawn', 'expired')),
  submitted_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  unique (claim_id, objection_revision),
  check ((status in ('upheld', 'overruled', 'withdrawn', 'expired')) = (decided_at is not null))
);

create table public.future_person_claim_assignments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  review_revision bigint not null check (review_revision > 0),
  decision text not null check (decision in ('approve', 'refuse', 'close_without_release', 'overrule_objection', 'uphold_objection')),
  reason_code text not null,
  evidence_revision bigint not null check (evidence_revision > 0),
  decided_at timestamptz not null default clock_timestamp(),
  unique (claim_id, review_revision)
);

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  claimant_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  correction_kind text not null check (correction_kind in ('identity', 'source_call', 'attribution', 'record_metadata')),
  condition_id text,
  correction_revision bigint not null check (correction_revision > 0),
  statement_ciphertext bytea not null,
  state text not null default 'submitted' check (state in ('submitted', 'reviewing', 'approved', 'rejected', 'withdrawn', 'expired')),
  submitted_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  check ((state in ('approved', 'rejected', 'withdrawn', 'expired')) = (decided_at is not null))
);

create table public.correction_assignments (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.correction_requests (id) on delete restrict,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  review_revision bigint not null check (review_revision > 0),
  decision text not null check (decision in ('approve', 'reject', 'close')),
  reason_code text not null,
  reviewed_evidence_id uuid references public.reviewed_evidence (id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  unique (correction_id, review_revision)
);

create table public.appeal_intakes (
  id uuid primary key default gen_random_uuid(),
  appellant_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  appellant_account_id uuid references auth.users (id) on delete restrict,
  target_kind text not null check (target_kind in ('claim', 'correction', 'contradiction', 'access_decision')),
  target_id uuid not null,
  appeal_revision bigint not null check (appeal_revision > 0),
  statement_ciphertext bytea not null,
  state text not null default 'submitted' check (state in ('submitted', 'reviewing', 'approved', 'rejected', 'withdrawn', 'expired')),
  submitted_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  unique (target_kind, target_id, appeal_revision),
  check ((state in ('approved', 'rejected', 'withdrawn', 'expired')) = (decided_at is not null))
);

create table public.appeal_evidence (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeal_intakes (id) on delete restrict,
  evidence_kind text not null check (evidence_kind in (
    'photo_identity', 'subject_source_control', 'decision_notice',
    'contradiction_counterevidence', 'objective_ground'
  )),
  reviewed_evidence_id uuid not null references public.reviewed_evidence (id) on delete restrict,
  evidence_revision bigint not null check (evidence_revision > 0),
  unique (appeal_id, evidence_kind, evidence_revision)
);

create table public.appeal_assignments (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.appeal_intakes (id) on delete restrict,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  review_revision bigint not null check (review_revision > 0),
  decision text not null check (decision in ('approve_access', 'reverse_prior_decision', 'uphold', 'overturn_contradiction', 'close')),
  reason_code text not null,
  decided_at timestamptz not null default clock_timestamp(),
  unique (appeal_id, review_revision)
);

do $$
declare t text;
begin
  foreach t in array array[
    'future_person_record_key_recipients', 'future_person_claim_sessions',
    'future_person_identity', 'future_person_claims', 'future_person_claim_documents',
    'future_person_claim_objections', 'future_person_claim_assignments',
    'correction_requests', 'correction_assignments',
    'appeal_intakes', 'appeal_evidence', 'appeal_assignments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;
