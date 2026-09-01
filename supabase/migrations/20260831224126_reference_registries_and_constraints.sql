-- Closed reference registries and the remaining named runtime stores.

create table public.consent_purposes (
  purpose text primary key,
  description text not null,
  active boolean not null default true
);
insert into public.consent_purposes (purpose, description) values
  ('reports.monogenic', 'Monogenic reports'),
  ('reports.polygenic', 'Polygenic reports'),
  ('ancestry', 'Ancestry estimates'),
  ('copilot.local', 'Local Copilot context'),
  ('copilot.cloud', 'Cloud Copilot context'),
  ('family.heritability', 'Multi-subject heritability'),
  ('family.portrait', 'Family portrait'),
  ('export.share-link', 'Revocable export link'),
  ('raw.export', 'Raw data export'),
  ('embryo.analysis', 'Embryo analysis');

create table public.condition_registry (
  condition_id text primary key,
  condition_name text not null,
  category text not null check (category in (
    'Heart and circulation', 'Food, drink and metabolism',
    'Immune system and allergies', 'Cancer', 'Having children'
  )),
  phenotype_class text not null,
  inheritance_mode text,
  active boolean not null default false,
  registry_revision bigint not null check (registry_revision > 0),
  citation_ids text[] not null default '{}'
);

create table public.risk_models (
  model_id text not null,
  model_version text not null,
  condition_id text not null references public.condition_registry (condition_id) on delete restrict,
  subject_class text not null check (subject_class in ('self', 'other_adult', 'embryo')),
  sex_basis text not null check (sex_basis = 'combined'),
  age_band text not null check (age_band = 'lifetime'),
  prevalence_basis text not null check (prevalence_basis = 'lifetime_risk'),
  birth_cohort text not null check (char_length(birth_cohort) > 0),
  calibration_cohort text not null check (char_length(calibration_cohort) > 0),
  calibration_n integer not null check (calibration_n > 0),
  baseline_low double precision not null check (baseline_low between 0 and 1),
  baseline_point double precision not null check (baseline_point between 0 and 1),
  baseline_high double precision not null check (baseline_high between 0 and 1),
  within_family_status text not null check (within_family_status in ('measured', 'measured_inconclusive', 'not_measured')),
  enabled boolean not null default false,
  model_revision bigint not null check (model_revision > 0),
  primary key (model_id, model_version),
  check (baseline_low < baseline_point and baseline_point < baseline_high)
);

create table public.provider_recipient_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  provider_id text not null references public.providers (slug) on delete restrict,
  purpose text not null references public.consent_purposes (purpose) on delete restrict,
  artifact_key text not null,
  artifact_version integer not null,
  grant_revision bigint not null check (grant_revision > 0),
  model_recipient_revision bigint not null check (model_recipient_revision > 0),
  status text not null default 'current' check (status in ('current', 'revoked', 'expired', 'superseded')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  foreign key (artifact_key, artifact_version)
    references public.consent_artifacts (artifact_key, version) on delete restrict,
  check ((status = 'current') = (ended_at is null))
);

create table public.portrait_results (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users (id) on delete restrict,
  parent_a_subject_id uuid not null references public.subjects (id) on delete restrict,
  parent_b_subject_id uuid not null references public.subjects (id) on delete restrict,
  family_pair_id uuid not null references public.family_pairs (id) on delete restrict,
  kind text not null check (kind in ('carrier_pair', 'polygenic_distribution')),
  trait_key text not null check (trait_key !~* '(intelligence|cognitive|iq|education|success)'),
  result jsonb not null,
  coverage double precision not null check (coverage between 0 and 1),
  method_version text not null,
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  computation_revision bigint not null check (computation_revision > 0),
  computed_at timestamptz not null default clock_timestamp(),
  unique (family_pair_id, kind, trait_key, computation_revision),
  check (parent_a_subject_id <> parent_b_subject_id),
  check (not (result ?| array['rank', 'recommendation', 'sex']))
);

create table public.report_artifacts (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects (id) on delete restrict,
  cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  report_kind text not null,
  report_revision bigint not null check (report_revision > 0),
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  artifact jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(subject_id, cohort_id) = 1)
);

create table public.template_reviews (
  id uuid primary key default gen_random_uuid(),
  template_id text not null references public.report_templates (slug) on delete restrict,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  review_revision bigint not null check (review_revision > 0),
  decision text not null check (decision in ('approve', 're_review', 'retire')),
  evidence_review_due date not null,
  decided_at timestamptz not null default clock_timestamp(),
  unique (template_id, review_revision)
);

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  worker_job_id uuid not null unique references public.worker_jobs (id) on delete restrict,
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'running', 'complete', 'failed', 'cancelled')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.worker_job_batches (
  worker_job_id uuid not null references public.worker_jobs (id) on delete cascade,
  batch_ordinal integer not null check (batch_ordinal >= 0),
  claim_revision bigint not null check (claim_revision > 0),
  status text not null check (status in ('pending', 'running', 'complete', 'failed', 'cancelled')),
  completed_at timestamptz,
  primary key (worker_job_id, batch_ordinal)
);

create table public.pending_source_rows (
  id uuid primary key default gen_random_uuid(),
  worker_job_id uuid not null references public.worker_jobs (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete restrict,
  cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  source_revision bigint not null check (source_revision > 0),
  state text not null check (state in ('provisional', 'published', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(subject_id, cohort_id) = 1)
);

create table public.copilot_context_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  chat_id uuid references public.chats (id) on delete restrict,
  scope_kind text not null check (scope_kind in ('self', 'subject', 'family', 'cohort', 'report')),
  target_id uuid not null,
  issuing_route_id text not null,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  token_revision bigint not null check (token_revision > 0),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);

create table public.copilot_context_history (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  turn_id uuid not null,
  scope_revision bigint not null check (scope_revision > 0),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  retrieved_subject_ids uuid[] not null default '{}',
  retrieved_purpose_keys text[] not null default '{}',
  context_revision bigint not null check (context_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (chat_id, turn_id, context_revision)
);

create table public.copilot_turn_dependencies (
  chat_id uuid not null references public.chats (id) on delete cascade,
  turn_id uuid not null,
  dependency_kind text not null check (dependency_kind in (
    'subject', 'cohort', 'file', 'grant', 'relationship', 'pair',
    'basis', 'participant_set', 'donor_attribution', 'provider'
  )),
  dependency_id uuid not null,
  dependency_revision bigint not null check (dependency_revision > 0),
  source_binding_fingerprint text not null check (source_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  primary key (chat_id, turn_id, dependency_kind, dependency_id)
);

create table public.copilot_generation_sessions (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats (id) on delete restrict,
  account_id uuid not null references auth.users (id) on delete restrict,
  scope_revision bigint not null check (scope_revision > 0),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('authorizing', 'generating', 'validated', 'persisted', 'refused', 'failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);

create table public.model_contexts (
  id uuid primary key default gen_random_uuid(),
  generation_session_id uuid not null references public.copilot_generation_sessions (id) on delete cascade,
  provider_classification text not null check (provider_classification in ('local', 'cloud')), 
  context_fingerprint text not null check (context_fingerprint ~ '^[0-9a-f]{64}$'),
  context_revision bigint not null check (context_revision > 0),
  state text not null check (state in ('prepared', 'submitted', 'invalidated', 'complete')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.cloud_model_calls (
  id uuid primary key default gen_random_uuid(),
  model_context_id uuid not null references public.model_contexts (id) on delete cascade,
  provider_recipient_grant_id uuid not null references public.provider_recipient_grants (id) on delete restrict,
  call_revision bigint not null check (call_revision > 0),
  provider_request_id_hmac text check (provider_request_id_hmac is null or provider_request_id_hmac ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending', 'submitted', 'accepted', 'failed', 'invalidated')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create table public.cloud_provider_payloads (
  id uuid primary key default gen_random_uuid(),
  cloud_model_call_id uuid not null references public.cloud_model_calls (id) on delete cascade,
  payload_ciphertext bytea not null,
  envelope_key_revision bigint not null check (envelope_key_revision > 0),
  payload_revision bigint not null check (payload_revision > 0),
  state text not null check (state in ('pending', 'submitted', 'accepted', 'shredded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.cloud_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  cloud_model_call_id uuid not null references public.cloud_model_calls (id) on delete cascade,
  attempt_ordinal smallint not null check (attempt_ordinal between 1 and 10),
  outcome_code text,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (cloud_model_call_id, attempt_ordinal)
);

create table public.encrypted_contact_references (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  contact_ciphertext bytea,
  contact_hmac text not null check (contact_hmac ~ '^[0-9a-f]{64}$'),
  key_revision bigint not null check (key_revision > 0),
  authority_revision bigint not null check (authority_revision > 0),
  status text not null default 'current' check (status in ('current', 'rotated', 'shredded')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  check ((status = 'shredded') = (contact_ciphertext is null))
);

create table public.contact_hmac_indexes (
  contact_reference_id uuid not null references public.encrypted_contact_references (id) on delete cascade,
  contact_hmac text not null check (contact_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_revision bigint not null check (hmac_key_revision > 0),
  status text not null default 'current' check (status in ('current', 'expired', 'revoked')),
  expires_at timestamptz not null,
  primary key (contact_reference_id, hmac_key_revision)
);

create table public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  template_id text not null,
  purpose text not null,
  target_kind text not null,
  target_id uuid not null,
  recipient_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  contact_reference_id uuid not null references public.encrypted_contact_references (id) on delete restrict,
  recipient_authority_revision bigint not null check (recipient_authority_revision > 0),
  semantic_revision bigint not null check (semantic_revision > 0),
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  token_purpose text,
  token_target_id uuid,
  state text not null default 'queued' check (state in ('queued', 'claimed', 'submitted', 'delivered', 'failed', 'invalidated', 'expired')),
  not_before timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);

create index mail_outbox_ready_idx on public.mail_outbox (state, not_before, created_at);

create table public.mail_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.mail_outbox (id) on delete cascade,
  attempt_ordinal smallint not null check (attempt_ordinal between 1 and 10),
  provider text not null check (provider = 'resend'),
  provider_message_id_hmac text check (provider_message_id_hmac is null or provider_message_id_hmac ~ '^[0-9a-f]{64}$'),
  outcome_code text,
  submitted_at timestamptz,
  completed_at timestamptz,
  unique (outbox_id, attempt_ordinal)
);

create table public.mail_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.mail_outbox (id) on delete restrict,
  provider_attempt_id uuid not null references public.mail_provider_attempts (id) on delete restrict,
  status text not null check (status in ('accepted', 'delivered', 'bounced', 'complained', 'reviewed_undeliverable')),
  provider_event_hmac text check (provider_event_hmac is null or provider_event_hmac ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp()
);

create table public.token_candidates (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.mail_outbox (id) on delete cascade,
  purpose text not null,
  target_kind text not null,
  target_id uuid not null,
  token_revision bigint not null check (token_revision > 0),
  state text not null default 'pending' check (state in ('pending', 'issued', 'invalidated', 'expired')),
  expires_at timestamptz not null
);

create table public.token_hashes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.token_candidates (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_revision bigint not null check (token_revision > 0),
  status text not null default 'current' check (status in ('current', 'consumed', 'revoked', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz
);

create table public.rights_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash_id uuid not null references public.token_hashes (id) on delete restrict,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  purpose text not null,
  target_kind text not null,
  target_id uuid not null,
  authority_revision bigint not null check (authority_revision > 0),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'consumed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz
);

create table public.rights_nonces (
  rights_session_id uuid not null references public.rights_sessions (id) on delete cascade,
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  nonce_revision bigint not null check (nonce_revision > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (rights_session_id, nonce_revision)
);

create table public.invitation_reminders (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.subject_invitations (id) on delete restrict,
  outbox_id uuid not null unique references public.mail_outbox (id) on delete restrict,
  reminder_revision bigint not null check (reminder_revision > 0),
  created_at timestamptz not null default clock_timestamp()
);

create table public.contact_refusal_bars (
  id uuid primary key default gen_random_uuid(),
  contact_hmac text not null check (contact_hmac ~ '^[0-9a-f]{64}$'),
  target_kind text not null,
  target_id uuid not null,
  refusal_revision bigint not null check (refusal_revision > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (contact_hmac, target_kind, target_id, refusal_revision)
);

create table public.retention_notice_campaigns (
  id uuid primary key default gen_random_uuid(),
  retention_row_id uuid not null references public.retention_rows (id) on delete restrict,
  phase_id text not null,
  phase_revision bigint not null,
  recipient_set_revision bigint not null check (recipient_set_revision > 0),
  state text not null check (state in ('pending', 'enqueued', 'complete', 'cancelled')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.subject_control_refusal_authorities (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  authority_revision bigint not null check (authority_revision > 0),
  status text not null check (status in ('current', 'revoked', 'expired')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.adult_subject_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users (id) on delete restrict,
  subject_id uuid not null unique references public.subjects (id) on delete restrict,
  draft_revision bigint not null check (draft_revision > 0),
  state text not null default 'draft' check (state in ('draft', 'invited', 'confirmed', 'expired', 'cancelled')),
  fixed_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.draft_participant_slots (
  id uuid primary key default gen_random_uuid(),
  adult_draft_id uuid references public.adult_subject_drafts (id) on delete cascade,
  embryo_draft_id uuid references public.embryo_cohort_drafts (id) on delete cascade,
  slot_kind text not null,
  principal_id uuid references public.subject_principals (id) on delete restrict,
  slot_revision bigint not null check (slot_revision > 0),
  state text not null check (state in ('pending', 'current', 'revoked')),
  check (num_nonnulls(adult_draft_id, embryo_draft_id) = 1)
);

create table public.invitation_candidates (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.subject_invitations (id) on delete cascade,
  draft_slot_id uuid not null references public.draft_participant_slots (id) on delete cascade,
  contact_reference_id uuid not null references public.encrypted_contact_references (id) on delete restrict,
  candidate_revision bigint not null check (candidate_revision > 0),
  state text not null check (state in ('pending', 'issued', 'accepted', 'refused', 'expired')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.upload_chunks (
  upload_session_id uuid not null references public.upload_sessions (id) on delete cascade,
  chunk_ordinal integer not null check (chunk_ordinal >= 0),
  object_id uuid not null unique,
  byte_count integer not null check (byte_count > 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (upload_session_id, chunk_ordinal)
);

create table public.upload_staging_objects (
  object_id uuid primary key,
  upload_session_id uuid not null unique references public.upload_sessions (id) on delete cascade,
  object_name text not null unique,
  state text not null check (state in ('issued', 'uploaded', 'promoted', 'deleted')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.embryo_mapping_challenges (
  id uuid primary key default gen_random_uuid(),
  ingest_session_id uuid not null references public.embryo_ingest_sessions (id) on delete cascade,
  mapping_revision bigint not null check (mapping_revision > 0),
  handle_manifest_fingerprint text not null check (handle_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'resolved', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.embryo_disposition_confirmations (
  proposal_id uuid not null references public.embryo_disposition_proposals (id) on delete cascade,
  confirmer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  authority_revision bigint not null check (authority_revision > 0),
  confirmed_at timestamptz not null default clock_timestamp(),
  primary key (proposal_id, confirmer_principal_id)
);

create table public.legal_evidence_ingest_sessions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  target_kind text not null,
  target_id uuid not null,
  evidence_kind text not null,
  session_revision bigint not null check (session_revision > 0),
  state text not null check (state in ('open', 'finalized', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.legal_evidence_fragments (
  session_id uuid not null references public.legal_evidence_ingest_sessions (id) on delete cascade,
  fragment_ordinal integer not null check (fragment_ordinal >= 0),
  object_id uuid not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count > 0),
  primary key (session_id, fragment_ordinal)
);

create table public.legal_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.legal_evidence_ingest_sessions (id) on delete restrict,
  reviewed_evidence_id uuid references public.reviewed_evidence (id) on delete restrict,
  document_kind text not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  object_id uuid not null unique,
  envelope_key_revision bigint not null check (envelope_key_revision > 0),
  document_revision bigint not null check (document_revision > 0),
  state text not null check (state in ('pending', 'reviewed', 'denied', 'purged')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.legal_evidence_review_copies (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_evidence_documents (id) on delete cascade,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  object_id uuid not null unique,
  copy_revision bigint not null check (copy_revision > 0),
  expires_at timestamptz not null
);

create table public.legal_evidence_working_data (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_evidence_documents (id) on delete cascade,
  working_ciphertext bytea not null,
  working_revision bigint not null check (working_revision > 0),
  expires_at timestamptz not null
);

create table public.legal_evidence_assignments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_evidence_documents (id) on delete restrict,
  reviewer_principal_id uuid not null references public.subject_principals (id) on delete restrict,
  assignment_revision bigint not null check (assignment_revision > 0),
  status text not null check (status in ('assigned', 'accepted', 'complete', 'cancelled')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.correction_working_data (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.correction_requests (id) on delete cascade,
  working_ciphertext bytea not null,
  working_revision bigint not null check (working_revision > 0),
  expires_at timestamptz not null
);

create table public.future_person_claimant_principals (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  principal_id uuid not null references public.subject_principals (id) on delete restrict,
  claimant_revision bigint not null check (claimant_revision > 0),
  status text not null check (status in ('current', 'superseded', 'revoked')),
  created_at timestamptz not null default clock_timestamp()
);

create table public.future_person_claimant_identity_hmacs (
  claimant_principal_id uuid not null references public.future_person_claimant_principals (id) on delete cascade,
  identity_hmac text not null check (identity_hmac ~ '^[0-9a-f]{64}$'),
  hmac_key_revision bigint not null check (hmac_key_revision > 0),
  expires_at timestamptz not null,
  primary key (claimant_principal_id, hmac_key_revision)
);

create table public.future_person_recovery_key_hashes (
  claimant_principal_id uuid not null references public.future_person_claimant_principals (id) on delete cascade,
  recovery_key_hash text not null unique check (recovery_key_hash ~ '^[0-9a-f]{64}$'),
  key_revision bigint not null check (key_revision > 0),
  status text not null check (status in ('current', 'consumed', 'revoked', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (claimant_principal_id, key_revision)
);

create table public.future_person_claim_review_packages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.future_person_claims (id) on delete restrict,
  package_revision bigint not null check (package_revision > 0),
  package_fingerprint text not null check (package_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('open', 'objected', 'approved', 'refused', 'closed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.future_person_claim_notices (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  outbox_id uuid not null unique references public.mail_outbox (id) on delete restrict,
  notice_kind text not null check (notice_kind in ('acknowledgement', 'owner_notice', 'objection_window', 'release', 'refusal')),
  notice_revision bigint not null check (notice_revision > 0),
  created_at timestamptz not null default clock_timestamp()
);

create table public.future_person_claim_release_credentials (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.future_person_claims (id) on delete restrict,
  claimant_principal_id uuid not null references public.future_person_claimant_principals (id) on delete restrict,
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  credential_revision bigint not null check (credential_revision > 0),
  status text not null check (status in ('current', 'consumed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

-- Every table created in this migration is server-only unless explicitly a
-- public reference catalogue.
do $$
declare t text;
begin
  foreach t in array array[
    'consent_purposes', 'condition_registry', 'risk_models',
    'provider_recipient_grants', 'portrait_results', 'report_artifacts',
    'template_reviews', 'analysis_jobs', 'worker_job_batches', 'pending_source_rows',
    'copilot_context_tokens', 'copilot_context_history', 'copilot_turn_dependencies',
    'copilot_generation_sessions', 'model_contexts', 'cloud_model_calls',
    'cloud_provider_payloads', 'cloud_provider_attempts',
    'encrypted_contact_references', 'contact_hmac_indexes', 'mail_outbox',
    'mail_provider_attempts', 'mail_deliveries', 'token_candidates', 'token_hashes',
    'rights_sessions', 'rights_nonces', 'invitation_reminders', 'contact_refusal_bars',
    'retention_notice_campaigns', 'subject_control_refusal_authorities',
    'adult_subject_drafts', 'draft_participant_slots', 'invitation_candidates',
    'upload_chunks', 'upload_staging_objects', 'embryo_mapping_challenges',
    'embryo_disposition_confirmations', 'legal_evidence_ingest_sessions',
    'legal_evidence_fragments', 'legal_evidence_documents',
    'legal_evidence_review_copies', 'legal_evidence_working_data',
    'legal_evidence_assignments', 'correction_working_data',
    'future_person_claimant_principals', 'future_person_claimant_identity_hmacs',
    'future_person_recovery_key_hashes', 'future_person_claim_review_packages',
    'future_person_claim_notices', 'future_person_claim_release_credentials'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

grant select on table public.consent_purposes, public.condition_registry,
  public.risk_models to anon, authenticated;
create policy consent_purposes_public_read on public.consent_purposes
  for select to anon, authenticated using (active);
create policy condition_registry_public_read on public.condition_registry
  for select to anon, authenticated using (active);
create policy risk_models_public_read on public.risk_models
  for select to anon, authenticated using (enabled);

do $$
begin
  if (select count(*) from public.retention_registry) <> 49 then
    raise exception 'retention registry must contain exactly 49 IDs';
  end if;
  if (select count(*) from public.retention_phase_registry) <> 52 then
    raise exception 'retention phase registry must contain exactly 52 IDs';
  end if;
  if (select count(*) from public.purge_manifest_classes) <> 25 then
    raise exception 'purge manifest registry must contain exactly 25 classes';
  end if;
  if (select count(*) from public.purge_targets) <> 33 then
    raise exception 'purge target registry must contain exactly 33 targets';
  end if;
  if (select count(*) from public.purge_target_stores) <> 108 then
    raise exception 'purge store registry must contain exactly 108 stores';
  end if;
  if exists (
    select 1 from public.risk_models where subject_class = 'embryo'
  ) then
    raise exception 'embryo models are withheld until the allowlist is populated';
  end if;
end;
$$;
