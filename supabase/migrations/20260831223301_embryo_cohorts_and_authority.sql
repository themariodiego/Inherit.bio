-- Embryo cohort authority, sanitized ingest, QC, and closed findings.

create table public.embryo_cohort_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users (id) on delete restrict,
  uploader_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  upload_class text not null check (upload_class in ('embryo_own', 'embryo_third_party')),
  basis_case text not null check (basis_case in (
    'true_two_parent', 'anonymous_donor', 'identified_donor_consented',
    'parent_deceased', 'sole_legal_authority'
  )),
  basis_revision bigint not null default 1 check (basis_revision > 0),
  participant_set_revision bigint not null default 1 check (participant_set_revision > 0),
  donor_attribution_revision bigint not null default 1 check (donor_attribution_revision > 0),
  embryo_count smallint not null check (embryo_count between 1 and 64),
  state text not null default 'draft' check (state in (
    'draft', 'evidence_pending', 'ready', 'finalized', 'expired', 'cancelled'
  )),
  fixed_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  check (fixed_expires_at > created_at),
  check ((state = 'finalized') = (finalized_at is not null))
);

create index embryo_cohort_drafts_owner_idx
  on public.embryo_cohort_drafts (owner_account_id, state, fixed_expires_at);

create table public.embryo_draft_participants (
  draft_id uuid not null references public.embryo_cohort_drafts (id) on delete cascade,
  set_kind text not null check (set_kind in (
    'required_upload_principals', 'disposition_authorities',
    'notice_recipients', 'record_key_recipients', 'attribution_principals'
  )),
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  set_revision bigint not null check (set_revision > 0),
  membership_revision bigint not null check (membership_revision > 0),
  primary key (draft_id, set_kind, principal_id)
);

create table public.embryo_cohorts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.embryo_cohort_drafts (id) on delete restrict,
  owner_account_id uuid not null references auth.users (id) on delete restrict,
  upload_class text not null check (upload_class in ('embryo_own', 'embryo_third_party')),
  basis_case text not null check (basis_case in (
    'true_two_parent', 'anonymous_donor', 'identified_donor_consented',
    'parent_deceased', 'sole_legal_authority'
  )),
  basis_revision bigint not null check (basis_revision > 0),
  participant_set_revision bigint not null check (participant_set_revision > 0),
  donor_attribution_revision bigint not null check (donor_attribution_revision > 0),
  recipient_set_revision bigint not null default 1 check (recipient_set_revision > 0),
  key_revision bigint not null default 1 check (key_revision > 0),
  lifecycle_revision bigint not null default 1 check (lifecycle_revision > 0),
  status text not null default 'upload_pending' check (status in (
    'upload_pending', 'ingesting', 'active', 'restricted',
    'purge_queued', 'purged', 'claimed_bound'
  )),
  embryo_count smallint not null check (embryo_count between 1 and 64),
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  uploaded_at timestamptz,
  qc_failed_at timestamptz,
  check (num_nonnulls(uploaded_at, qc_failed_at) <= 1)
);

create index embryo_cohorts_owner_idx
  on public.embryo_cohorts (owner_account_id, status, retention_expires_at);

alter table public.subjects
  add column cohort_id uuid references public.embryo_cohorts (id) on delete restrict;

alter table public.subjects
  add constraint subjects_embryo_cohort_shape
  check ((subject_class = 'embryo') = (cohort_id is not null)) not valid;
alter table public.subjects validate constraint subjects_embryo_cohort_shape;

create index subjects_cohort_idx on public.subjects (cohort_id, lifecycle);

create table public.embryo_participant_sets (
  cohort_id uuid not null references public.embryo_cohorts (id) on delete restrict,
  set_kind text not null check (set_kind in (
    'required_upload_principals', 'disposition_authorities',
    'notice_recipients', 'record_key_recipients', 'attribution_principals'
  )),
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  set_revision bigint not null check (set_revision > 0),
  membership_revision bigint not null check (membership_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (cohort_id, set_kind, principal_id, membership_revision)
);

create unique index embryo_participant_sets_current_idx
  on public.embryo_participant_sets (cohort_id, set_kind, principal_id)
  where revoked_at is null;
create index embryo_participant_sets_principal_idx
  on public.embryo_participant_sets (principal_id, set_kind, revoked_at);

create table public.embryo_basis_bindings (
  cohort_id uuid primary key references public.embryo_cohorts (id) on delete restrict,
  basis_case text not null check (basis_case in (
    'true_two_parent', 'anonymous_donor', 'identified_donor_consented',
    'parent_deceased', 'sole_legal_authority'
  )),
  basis_revision bigint not null check (basis_revision > 0),
  participant_set_revision bigint not null check (participant_set_revision > 0),
  case_artifact_signature_id uuid references public.consent_signatures (id) on delete restrict,
  reviewed_evidence_id uuid references public.reviewed_evidence (id) on delete restrict,
  legal_review_id uuid references public.legal_reviews (id) on delete restrict,
  artifact_matrix_fingerprint text not null check (artifact_matrix_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (
    (basis_case = 'true_two_parent' and case_artifact_signature_id is null)
    or (basis_case <> 'true_two_parent' and case_artifact_signature_id is not null)
  ),
  check (
    basis_case not in ('parent_deceased', 'sole_legal_authority')
    or (reviewed_evidence_id is not null and legal_review_id is not null)
  )
);

create table public.embryo_donor_attributions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.embryo_cohorts (id) on delete restrict,
  donor_slot text not null check (donor_slot in ('parent_a', 'parent_b')),
  donor_principal_id uuid references public.subject_principals (id) on delete restrict,
  signature_id uuid references public.consent_signatures (id) on delete restrict,
  classification text not null check (classification in (
    'anonymous', 'identified_pending', 'identified_consented', 'refused', 'revoked'
  )),
  attribution_revision bigint not null check (attribution_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (
    (classification = 'identified_consented' and donor_principal_id is not null and signature_id is not null)
    or classification <> 'identified_consented'
  )
);

create unique index embryo_donor_attributions_current_slot_idx
  on public.embryo_donor_attributions (cohort_id, donor_slot)
  where revoked_at is null;

create table public.embryos (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.embryo_cohorts (id) on delete restrict,
  subject_id uuid not null unique references public.subjects (id) on delete restrict,
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  display_label text generated always as ('Embryo ' || (sample_ordinal + 1)::text) stored,
  status text not null default 'pending' check (status in (
    'pending', 'qc_pass', 'qc_marginal', 'qc_fail', 'excluded',
    'stored', 'transferred', 'donated', 'discarded', 'claimed_bound'
  )),
  disposition_revision bigint not null default 1 check (disposition_revision > 0),
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (cohort_id, sample_ordinal)
);

create index embryos_cohort_status_idx
  on public.embryos (cohort_id, status, sample_ordinal);

create or replace function private.assert_embryo_subject_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.subjects s
    where s.id = new.subject_id
      and s.subject_class = 'embryo'
      and s.cohort_id = new.cohort_id
      and s.lifecycle <> 'purged'
  ) then
    raise exception using errcode = '23514', message = 'invalid embryo subject binding';
  end if;
  return new;
end;
$$;

revoke all on function private.assert_embryo_subject_binding() from public, anon, authenticated;
grant execute on function private.assert_embryo_subject_binding() to service_role;

create trigger embryos_subject_binding
before insert or update of cohort_id, subject_id on public.embryos
for each row execute function private.assert_embryo_subject_binding();

create table public.embryo_qc (
  embryo_id uuid primary key references public.embryos (id) on delete cascade,
  sites_expected integer not null check (sites_expected >= 0),
  sites_called integer not null check (sites_called >= 0 and sites_called <= sites_expected),
  call_rate double precision not null check (call_rate between 0 and 1),
  autosomal_het_rate double precision check (autosomal_het_rate between 0 and 1),
  mean_depth double precision check (mean_depth >= 0),
  parent_a_concordance double precision check (parent_a_concordance between 0 and 1),
  parent_b_concordance double precision check (parent_b_concordance between 0 and 1),
  allelic_dropout_estimate double precision check (allelic_dropout_estimate between 0 and 1),
  allelic_dropout_interval_low double precision,
  allelic_dropout_interval_high double precision,
  allelic_dropout_method text,
  amplification_method text,
  source_laboratory text,
  source_assay text,
  imputation_performed boolean not null default false check (not imputation_performed),
  imputation_panel text check (imputation_panel is null),
  contamination_estimate double precision check (contamination_estimate between 0 and 1),
  qc_verdict text not null check (qc_verdict in ('pass', 'marginal', 'fail')),
  qc_reasons text[] not null default '{}',
  computed_at timestamptz not null default clock_timestamp(),
  check (
    (allelic_dropout_estimate is null and allelic_dropout_interval_low is null and allelic_dropout_interval_high is null)
    or (
      allelic_dropout_interval_low is not null
      and allelic_dropout_estimate is not null
      and allelic_dropout_interval_high is not null
      and allelic_dropout_interval_low < allelic_dropout_estimate
      and allelic_dropout_estimate < allelic_dropout_interval_high
    )
  )
);

create table public.embryo_findings (
  id uuid primary key default gen_random_uuid(),
  embryo_id uuid not null references public.embryos (id) on delete cascade,
  condition_id text not null,
  condition_name text not null,
  finding jsonb,
  evidence_label text not null check (evidence_label in (
    'clinical', 'established', 'emerging', 'preliminary'
  )),
  coverage_state text not null check (coverage_state in (
    'covered', 'partial', 'not_covered', 'quality_not_measurable'
  )),
  citation_ids text[] not null default '{}',
  not_covered_reason text,
  model_id text,
  model_version text,
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  computation_revision bigint not null check (computation_revision > 0),
  computed_at timestamptz not null default clock_timestamp(),
  unique (embryo_id, condition_id, computation_revision),
  check (
    (finding is not null and coverage_state in ('covered', 'partial') and not_covered_reason is null)
    or (
      finding is not null
      and coverage_state = 'not_covered'
      and not_covered_reason = 'insufficient_coverage'
      and finding ->> 'kind' = 'coverage_failure'
    )
    or (
      finding is null
      and coverage_state in ('not_covered', 'quality_not_measurable')
      and not_covered_reason is not null
      and not_covered_reason <> 'insufficient_coverage'
    )
  ),
  check (finding is null or not (finding ?| array[
    'sex', 'embryo_sex', 'karyotype', 'rank', 'score', 'recommendation'
  ]))
);

create index embryo_findings_embryo_idx
  on public.embryo_findings (embryo_id, condition_id, computed_at desc);

create table public.embryo_figures (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.embryo_findings (id) on delete cascade,
  figure_kind text not null check (figure_kind in (
    'absolute_risk', 'interval', 'natural_frequency', 'within_family'
  )),
  payload jsonb not null,
  figure_revision bigint not null check (figure_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (finding_id, figure_kind, figure_revision)
);

create table public.result_suppressions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  condition_id text not null,
  reason_code text not null,
  suppression_revision bigint not null check (suppression_revision > 0),
  active_from timestamptz not null default clock_timestamp(),
  ended_at timestamptz
);

create unique index result_suppressions_current_idx
  on public.result_suppressions (subject_id, condition_id)
  where ended_at is null;

create table public.embryo_variants (
  id bigint generated always as identity primary key,
  embryo_id uuid not null references public.embryos (id) on delete cascade,
  source_file_id uuid references public.genome_files (id) on delete restrict,
  chromosome smallint not null check (chromosome between 1 and 22),
  position integer not null check (position > 0),
  reference_allele text,
  alternate_allele text,
  genotype text not null,
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$')
);

create index embryo_variants_locus_idx
  on public.embryo_variants (embryo_id, chromosome, position);

create or replace function private.enforce_subject_variant_chromosome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.subjects s
    where s.id = new.subject_id and s.subject_class = 'embryo'
  ) and new.chrom not between 1 and 22 then
    raise exception using errcode = '23514', message = 'non-autosomal embryo variant forbidden';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_subject_variant_chromosome() from public, anon, authenticated;
grant execute on function private.enforce_subject_variant_chromosome() to service_role;

create trigger user_variants_embryo_autosomal_only
before insert or update of subject_id, chrom on public.user_variants
for each row execute function private.enforce_subject_variant_chromosome();

create table public.embryo_ingest_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.embryo_cohorts (id) on delete restrict,
  originating_session_id uuid not null,
  uploader_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  basis_case text not null,
  basis_revision bigint not null check (basis_revision > 0),
  participant_set_revision bigint not null check (participant_set_revision > 0),
  donor_attribution_revision bigint not null check (donor_attribution_revision > 0),
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'open' check (status in (
    'open', 'mapping_required', 'complete', 'processing', 'published',
    'failed', 'abandoned', 'cancelled'
  )),
  expected_next_sequence integer not null default 0 check (expected_next_sequence >= 0),
  accepted_bytes bigint not null default 0 check (accepted_bytes >= 0),
  accepted_chunks integer not null default 0 check (accepted_chunks >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (expires_at > created_at)
);

create table public.embryo_ingest_handles (
  session_id uuid not null references public.embryo_ingest_sessions (id) on delete cascade,
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  handle_hash text not null unique check (handle_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  primary key (session_id, sample_ordinal)
);

create table public.embryo_ingest_fragments (
  session_id uuid not null references public.embryo_ingest_sessions (id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  object_id uuid not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count > 0),
  line_count integer not null check (line_count > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, sequence)
);

create table public.embryo_disposition_proposals (
  id uuid primary key default gen_random_uuid(),
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  proposer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  disposition text not null check (disposition in ('stored', 'transferred', 'donated', 'discarded')),
  basis_revision bigint not null check (basis_revision > 0),
  authority_set_revision bigint not null check (authority_set_revision > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  check (expires_at > created_at)
);

create unique index embryo_disposition_proposals_pending_idx
  on public.embryo_disposition_proposals (embryo_id)
  where status = 'pending';

create table public.future_person_record_key_hashes (
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_set_revision bigint not null check (recipient_set_revision > 0),
  key_revision bigint not null check (key_revision > 0),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'current' check (status in ('current', 'revoked', 'claimed', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  primary key (embryo_id, recipient_principal_id, key_revision),
  check ((status = 'current') = (ended_at is null))
);

create table public.future_person_record_key_print_rights (
  id uuid primary key default gen_random_uuid(),
  embryo_id uuid not null references public.embryos (id) on delete restrict,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  recipient_set_revision bigint not null check (recipient_set_revision > 0),
  key_revision bigint not null check (key_revision > 0),
  status text not null default 'unconsumed' check (status in ('unconsumed', 'consumed', 'revoked', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz
);

create unique index future_person_print_rights_current_idx
  on public.future_person_record_key_print_rights (embryo_id, recipient_principal_id, key_revision)
  where status = 'unconsumed';

alter type public.genome_file_type add value if not exists 'vcf_multisample';
alter type public.genome_file_type add value if not exists 'pgt_table';

alter table public.genome_files
  add column cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  add column is_cohort_file boolean not null default false,
  add column sample_count smallint not null default 1 check (sample_count between 1 and 64),
  add column source_publication_state text not null default 'legacy_unverified'
    check (source_publication_state in (
      'legacy_unverified', 'staging', 'structurally_validated', 'canonical_pending',
      'published', 'quarantined', 'rejected', 'purged'
    )),
  add column source_publication_revision bigint not null default 1
    check (source_publication_revision > 0),
  add column source_binding_fingerprint text
    check (source_binding_fingerprint is null or source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint genome_files_subject_or_cohort
    check (num_nonnulls(subject_id, cohort_id) = 1) not valid,
  add constraint genome_files_cohort_shape
    check (is_cohort_file = (cohort_id is not null)) not valid;

alter table public.genome_files validate constraint genome_files_subject_or_cohort;
alter table public.genome_files validate constraint genome_files_cohort_shape;
create index genome_files_cohort_idx on public.genome_files (cohort_id, created_at desc);

alter table public.subject_consents
  add constraint subject_consents_cohort_fk
  foreign key (cohort_id) references public.embryo_cohorts (id) on delete restrict not valid;
alter table public.subject_consents validate constraint subject_consents_cohort_fk;

alter table public.attestation_contradictions
  add constraint attestation_contradictions_cohort_fk
  foreign key (cohort_id) references public.embryo_cohorts (id) on delete restrict not valid;
alter table public.attestation_contradictions validate constraint attestation_contradictions_cohort_fk;

do $$
declare
  t text;
begin
  foreach t in array array[
    'embryo_cohort_drafts', 'embryo_draft_participants', 'embryo_cohorts',
    'embryo_participant_sets', 'embryo_basis_bindings', 'embryo_donor_attributions',
    'embryos', 'embryo_qc', 'embryo_findings', 'embryo_figures',
    'result_suppressions', 'embryo_variants', 'embryo_ingest_sessions',
    'embryo_ingest_handles', 'embryo_ingest_fragments',
    'embryo_disposition_proposals', 'future_person_record_key_hashes',
    'future_person_record_key_print_rights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;
