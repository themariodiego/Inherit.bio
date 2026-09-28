-- The Future Person claim review (api.future-person-claim-complete,
-- api.future-person-claim-review, api.legal-evidence-review-download,
-- api.download-chunk), under TEST-LOCAL, up to the release decision.
--
-- Completion turns a live claim into one review case: the two clean,
-- kind-bound documents the claimant names, their SHA-256 digests, the case
-- the server resolves from the stored mode and key (never shown to the
-- claimant), and the fixed 30-day documentary decision deadline
-- (future-person.claim-review). The claim session ends there.
--
-- A review is read and decided only by a named human: an account the
-- database owner has made a claim reviewer, holding the current assignment
-- for the case, in a live session stepped up with MFA in the last 15 minutes
-- (authContracts.reviewer-api-v1). Every check reads the reviewer's own JWT;
-- nothing trusts a value the route passes in. Every read is recorded.
--
-- A decision is one of the rows the case kind allows
-- (reviewCaseDecisionMatrix). It is recorded against the exact documents'
-- SHA-256 digests, only after the reviewer has read every chunk of both
-- documents, and only if both are still the clean documents the case bound.
-- A refusal ends the case and deletes the documents. An approval is recorded
-- and queued for the release transaction, which is not built here; until it
-- is, an approved case closes at the deadline like any other, without
-- release. The register asks for one named reviewer, not two, so there is no
-- second approval step.

alter table private.future_person_claim_intakes add column completed_at timestamptz;
alter table private.future_person_claim_intakes
  add constraint future_person_claim_intakes_completed_check check (completed_at is null or completed_at >= created_at);

-- A completed claim's session is no longer live: no upload, no document
-- session and no second completion. Its review keeps what it needs.
create or replace function private.claim_intake_live_v1(i private.future_person_claim_intakes)
returns boolean language sql stable security invoker set search_path = '' as $$
  select i.completed_at is null
    and i.expires_at > clock_timestamp()
    and i.last_active_at > clock_timestamp() - interval '30 minutes';
$$;

-- The database owner names claim reviewers. No API role can add or remove one.
create table private.claim_reviewers (
  account_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check ((status = 'revoked') = (revoked_at is not null))
);
alter table private.claim_reviewers enable row level security;
revoke all on private.claim_reviewers from public, anon, authenticated, service_role;

create table private.claim_reviews (
  id uuid primary key references private.future_person_claim_intakes (id) on delete cascade,
  mode text not null check (mode in ('record-key', 'claimant-recovery-key', 'keyless')),
  case_kind text not null check (case_kind in (
    'record_key', 'record_key_unmatched_or_ineligible', 'claimant_recovery_key',
    'recovery_key_unmatched_or_ineligible', 'claimed_unbound_no_key_recovery', 'unclaimed_keyless',
    'keyless_none', 'keyless_ambiguous')),
  -- Server-only: the record a matched Record Key selected, or the claimant a
  -- matched Recovery Key named. Never projected to the claimant.
  matched_embryo_id uuid references public.embryos (id) on delete restrict,
  matched_claimant_principal_id uuid references public.future_person_claimant_principals (id) on delete restrict,
  photo_document_id uuid references private.claim_documents (id) on delete set null,
  photo_sha256 text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  birth_record_document_id uuid references private.claim_documents (id) on delete set null,
  birth_record_sha256 text not null check (birth_record_sha256 ~ '^[0-9a-f]{64}$'),
  completion_nonce_hash text not null unique check (completion_nonce_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'document_review_pending' check (state in (
    'document_review_pending', 'more_information_required', 'release_queued', 'refused', 'closed')),
  review_revision bigint not null default 1 check (review_revision > 0),
  deadline timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check (photo_document_id is distinct from birth_record_document_id or photo_document_id is null),
  check (deadline = created_at + interval '30 days'),
  check ((state in ('refused', 'closed')) = (resolved_at is not null)),
  check ((case_kind = 'record_key') = (matched_embryo_id is not null)),
  check ((case_kind = 'claimant_recovery_key') = (matched_claimant_principal_id is not null))
);
create index claim_reviews_open_idx on private.claim_reviews (deadline)
  where state in ('document_review_pending', 'more_information_required', 'release_queued');
alter table private.claim_reviews enable row level security;
revoke all on private.claim_reviews from public, anon, authenticated, service_role;

create table private.claim_review_assignments (
  review_id uuid not null references private.claim_reviews (id) on delete cascade,
  reviewer_account_id uuid not null references private.claim_reviewers (account_id) on delete cascade,
  assignment_revision bigint not null check (assignment_revision > 0),
  status text not null default 'current' check (status in ('current', 'ended')),
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  primary key (review_id, assignment_revision),
  check ((status = 'ended') = (ended_at is not null))
);
create unique index claim_review_assignments_current_idx on private.claim_review_assignments (review_id)
  where status = 'current';
alter table private.claim_review_assignments enable row level security;
revoke all on private.claim_review_assignments from public, anon, authenticated, service_role;

-- Pseudonymous in the ledger, exact here while the case lives: which
-- reviewer read what, under which session and case revision.
create table private.claim_review_reads (
  id bigint generated always as identity primary key,
  review_id uuid not null references private.claim_reviews (id) on delete cascade,
  reviewer_account_id uuid not null,
  auth_session_id uuid not null,
  review_revision bigint not null check (review_revision > 0),
  document_id uuid,
  chunk_sequence integer check (chunk_sequence between 0 and 4),
  read_at timestamptz not null default clock_timestamp(),
  check ((document_id is null) = (chunk_sequence is null))
);
create index claim_review_reads_review_idx on private.claim_review_reads (review_id, reviewer_account_id, document_id);
alter table private.claim_review_reads enable row level security;
revoke all on private.claim_review_reads from public, anon, authenticated, service_role;

create table private.claim_review_decisions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references private.claim_reviews (id) on delete cascade,
  review_revision bigint not null check (review_revision > 0),
  decision text not null check (decision in ('approve-record-key', 'approve-recovery-key',
    'approve-claimed-unbound-no-key-recovery', 'keyless-document-match', 'needs-more-information', 'reject')),
  reviewer_account_id uuid not null,
  auth_session_id uuid not null,
  photo_document_id uuid not null,
  photo_sha256 text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  birth_record_document_id uuid not null,
  birth_record_sha256 text not null check (birth_record_sha256 ~ '^[0-9a-f]{64}$'),
  -- The professional basis, sealed by the application under the claim's data key.
  reason_ciphertext bytea not null check (octet_length(reason_ciphertext) between 29 and 16384),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz not null default clock_timestamp(),
  unique (review_id, review_revision)
);
alter table private.claim_review_decisions enable row level security;
revoke all on private.claim_review_decisions from public, anon, authenticated, service_role;

-- revocable-chunk-session-v1 for a reviewer reading one bound document.
create table private.claim_review_downloads (
  id uuid primary key default gen_random_uuid(),
  cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
  review_id uuid not null references private.claim_reviews (id) on delete cascade,
  document_id uuid not null,
  reviewer_account_id uuid not null,
  auth_session_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count between 1 and 20000000),
  chunk_count integer not null check (chunk_count between 1 and 5),
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  -- One hour at most; a refusal or a closed case ends it at once.
  check (expires_at > created_at - interval '1 second' and expires_at <= created_at + interval '1 hour')
);
alter table private.claim_review_downloads enable row level security;
revoke all on private.claim_review_downloads from public, anon, authenticated, service_role;

insert into public.purge_target_stores (target_id, store_name, store_order) values
  ('claim-review-working-packages', 'private.claim_reviews', 11),
  ('claim-review-working-packages', 'private.claim_review_assignments', 12),
  ('claim-review-working-packages', 'private.claim_review_reads', 13),
  ('claim-review-working-packages', 'private.claim_review_decisions', 14),
  ('claim-review-working-packages', 'private.claim_review_downloads', 15);

create function private.claim_review_open_v1(r private.claim_reviews)
returns boolean language sql stable security invoker set search_path = '' as $$
  select r.state in ('document_review_pending', 'more_information_required', 'release_queued')
    and r.deadline > clock_timestamp();
$$;
revoke all on function private.claim_review_open_v1(private.claim_reviews) from public, anon, authenticated, service_role;

-- reviewer-api-v1.requires: the caller's own JWT must be a live
-- authenticated session of an active claim reviewer, at AAL2, with an MFA
-- factor verified in the last 15 minutes. Returns the reviewer and session,
-- or nothing.
create function private.claim_reviewer_step_up_v1()
returns table (account_id uuid, auth_session_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_claims jsonb;
  v_account uuid;
  v_session uuid;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return;
  end;
  if jsonb_typeof(v_claims) is distinct from 'object'
    or v_claims->>'role' is distinct from 'authenticated'
    or v_claims->>'aal' is distinct from 'aal2'
    or coalesce(v_claims->>'sub', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(v_claims->>'session_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(v_claims->'amr') is distinct from 'array' then
    return;
  end if;
  v_account := (v_claims->>'sub')::uuid;
  v_session := (v_claims->>'session_id')::uuid;
  if not exists (
    select 1 from jsonb_array_elements(v_claims->'amr') a
    where a->>'method' in ('totp', 'webauthn', 'phone')
      and jsonb_typeof(a->'timestamp') = 'number'
      and (a->>'timestamp')::numeric >= extract(epoch from clock_timestamp()) - 900
      and (a->>'timestamp')::numeric <= extract(epoch from clock_timestamp()) + 60
  ) then
    return;
  end if;
  if not exists (select 1 from private.claim_reviewers r where r.account_id = v_account and r.status = 'active') then
    return;
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = v_account
      and (s.not_after is null or s.not_after > clock_timestamp())) then
    return;
  end if;
  account_id := v_account;
  auth_session_id := v_session;
  return next;
end;
$$;
revoke all on function private.claim_reviewer_step_up_v1() from public, anon, authenticated, service_role;

-- The open review the stepped-up caller is currently assigned, locked.
create function private.assigned_claim_review_v1(p_review_id uuid, p_account uuid)
returns private.claim_reviews
language plpgsql security definer set search_path = '' as $$
declare v_review private.claim_reviews;
begin
  select r.* into v_review from private.claim_reviews r
  where r.id = p_review_id
    and exists (select 1 from private.claim_review_assignments a
      where a.review_id = r.id and a.reviewer_account_id = p_account and a.status = 'current')
  for update;
  if v_review.id is null or not private.claim_review_open_v1(v_review) then return null; end if;
  return v_review;
end;
$$;
revoke all on function private.assigned_claim_review_v1(uuid, uuid) from public, anon, authenticated, service_role;

-- Database-owner operations: name a reviewer, and assign a case. Neither is
-- reachable from any API role.
create function private.grant_claim_reviewer_v1(p_account_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.claim_reviewers (account_id) values (p_account_id)
  on conflict (account_id) do update set status = 'active', revoked_at = null;
$$;
create function private.revoke_claim_reviewer_v1(p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.claim_reviewers set status = 'revoked', revoked_at = clock_timestamp()
  where account_id = p_account_id and status = 'active';
  update private.claim_review_assignments set status = 'ended', ended_at = clock_timestamp()
  where reviewer_account_id = p_account_id and status = 'current';
end;
$$;
create function private.assign_claim_review_v1(p_review_id uuid, p_reviewer_account_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_review private.claim_reviews;
  v_revision bigint;
begin
  select * into v_review from private.claim_reviews where id = p_review_id for update;
  if v_review.id is null or not private.claim_review_open_v1(v_review) then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  if not exists (select 1 from private.claim_reviewers where account_id = p_reviewer_account_id and status = 'active') then
    raise exception using errcode = '42501', message = 'claim reviewer unavailable';
  end if;
  update private.claim_review_assignments set status = 'ended', ended_at = clock_timestamp()
  where review_id = p_review_id and status = 'current';
  select coalesce(max(assignment_revision), 0) + 1 into v_revision
  from private.claim_review_assignments where review_id = p_review_id;
  insert into private.claim_review_assignments (review_id, reviewer_account_id, assignment_revision)
  values (p_review_id, p_reviewer_account_id, v_revision);
  perform private.append_legal_audit_event('claim.review.assigned', null, 'operations', 'accepted', '{}'::jsonb);
  return v_revision;
end;
$$;
revoke all on function private.grant_claim_reviewer_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.revoke_claim_reviewer_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function private.assign_claim_review_v1(uuid, uuid) from public, anon, authenticated, service_role;

-- The case the server resolves at completion from the stored mode and key.
-- Nothing here is ever returned to the claimant.
--
-- Record Key: the key's hash must be a current record key hash, and the
-- record eligible. The register's reserved_for_future_person state and
-- earliest_claim_at have no column yet; until they do, eligibility is the
-- transferred claim window (status transferred, closing_date_state
-- definitive_transferred_claim_window), eighteen years after transfer (no
-- one born of that transfer can be adult sooner), a current parent-supplied
-- identity (the recorded parent link), and no other open review of the
-- same record.
-- Recovery Key: a current recovery hash of a current claimant principal.
-- Keyless: no parent profile writer defines the profile HMAC yet, and no
-- claimed_unbound claimant exists, so every keyless case is keyless_none.
create function private.resolve_claim_case_v1(p_intake private.future_person_claim_intakes)
returns table (case_kind text, matched_embryo_id uuid, matched_claimant_principal_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_embryo uuid;
  v_claimant uuid;
begin
  if p_intake.mode = 'record-key' then
    select h.embryo_id into v_embryo
    from public.future_person_record_key_hashes h
    join public.embryos e on e.id = h.embryo_id
    where h.key_hash = p_intake.key_hash and h.status = 'current'
      and e.status = 'transferred' and e.closing_date_state = 'definitive_transferred_claim_window'
      and e.transferred_at is not null and e.transferred_at + interval '18 years' <= clock_timestamp()
      and exists (select 1 from public.future_person_identity f where f.embryo_id = e.id and f.state = 'current')
      and not exists (select 1 from private.claim_reviews r where r.matched_embryo_id = e.id
        and private.claim_review_open_v1(r));
    if v_embryo is not null then
      return query select 'record_key'::text, v_embryo, null::uuid;
    else
      return query select 'record_key_unmatched_or_ineligible'::text, null::uuid, null::uuid;
    end if;
  elsif p_intake.mode = 'claimant-recovery-key' then
    select k.claimant_principal_id into v_claimant
    from public.future_person_recovery_key_hashes k
    join public.future_person_claimant_principals c on c.id = k.claimant_principal_id
    where k.recovery_key_hash = p_intake.key_hash and k.status = 'current' and c.status = 'current'
      and not exists (select 1 from private.claim_reviews r where r.matched_claimant_principal_id = c.id
        and private.claim_review_open_v1(r));
    if v_claimant is not null then
      return query select 'claimant_recovery_key'::text, null::uuid, v_claimant;
    else
      return query select 'recovery_key_unmatched_or_ineligible'::text, null::uuid, null::uuid;
    end if;
  else
    return query select 'keyless_none'::text, null::uuid, null::uuid;
  end if;
end;
$$;
revoke all on function private.resolve_claim_case_v1(private.future_person_claim_intakes)
  from public, anon, authenticated, service_role;

-- api.future-person-claim-complete. The claimant names the two documents;
-- the mode must be the stored one (clientModeOverride forbidden). Every
-- accepted completion answers the same 'received'. Open document sessions
-- end; any other document of the claim is deleted by the retention job.
create function private.complete_future_person_claim_v1(
  p_session_hash text, p_nonce_hash text, p_mode text, p_photo_document_id uuid, p_birth_record_document_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_intake private.future_person_claim_intakes;
  v_photo private.claim_documents;
  v_birth private.claim_documents;
  v_case record;
  v_stored_mode text;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_mode is null or p_mode not in ('record-key', 'claimant-recovery-key', 'keyless')
    or p_photo_document_id is null or p_birth_record_document_id is null
    or p_photo_document_id = p_birth_record_document_id then
    raise exception using errcode = '22023', message = 'claim completion invalid';
  end if;
  perform pg_advisory_xact_lock(1869509217, 20);
  select i.* into v_intake from private.future_person_claim_intakes i where i.session_hash = p_session_hash for update;
  if v_intake.id is null or not private.claim_intake_live_v1(v_intake) then
    raise exception using errcode = '42501', message = 'claim completion unavailable';
  end if;
  v_stored_mode := case v_intake.mode when 'keyless-start' then 'keyless' else v_intake.mode end;
  if p_mode <> v_stored_mode then
    raise exception using errcode = '42501', message = 'claim completion unavailable';
  end if;
  if exists (select 1 from private.claim_reviews where completion_nonce_hash = p_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim completion already used';
  end if;
  select d.* into v_photo from private.claim_documents d
  where d.id = p_photo_document_id and d.intake_id = v_intake.id
    and d.document_kind = 'future-photo-identity' and d.state = 'clean' and d.object_deleted_at is null;
  select d.* into v_birth from private.claim_documents d
  where d.id = p_birth_record_document_id and d.intake_id = v_intake.id
    and d.document_kind = 'future-birth-record' and d.state = 'clean' and d.object_deleted_at is null;
  if v_photo.id is null or v_birth.id is null then
    raise exception using errcode = '42501', message = 'claim completion unavailable';
  end if;
  update private.claim_document_sessions set state = 'failed', failure_code = 'expired'
  where intake_id = v_intake.id and state in ('open', 'composing');
  update private.claim_document_fragments f set state = 'delete_pending'
  from private.claim_document_sessions s where s.id = f.session_id and s.intake_id = v_intake.id;
  select * into v_case from private.resolve_claim_case_v1(v_intake);
  insert into private.claim_reviews (id, mode, case_kind, matched_embryo_id, matched_claimant_principal_id,
    photo_document_id, photo_sha256, birth_record_document_id, birth_record_sha256, completion_nonce_hash,
    deadline, created_at)
  select v_intake.id, v_stored_mode, v_case.case_kind, v_case.matched_embryo_id,
    v_case.matched_claimant_principal_id, v_photo.id, v_photo.sha256, v_birth.id, v_birth.sha256,
    p_nonce_hash, t.now_at + interval '30 days', t.now_at
  from (select clock_timestamp() as now_at) t;
  update private.future_person_claim_intakes set completed_at = clock_timestamp() where id = v_intake.id;
  perform private.append_legal_audit_event('claim.received', null, 'api.future-person-claim-complete',
    'accepted', '{}'::jsonb);
  return 'received';
end;
$$;
revoke all on function private.complete_future_person_claim_v1(text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_future_person_claim_v1(text, text, text, uuid, uuid) to service_role;

-- The decision rows each case kind allows (reviewCaseDecisionMatrix).
create function private.claim_review_decisions_allowed_v1(p_case_kind text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_case_kind
    when 'record_key' then array['approve-record-key', 'reject', 'needs-more-information']
    when 'claimant_recovery_key' then array['approve-recovery-key', 'reject', 'needs-more-information']
    when 'claimed_unbound_no_key_recovery' then array['approve-claimed-unbound-no-key-recovery', 'reject', 'needs-more-information']
    when 'unclaimed_keyless' then array['keyless-document-match', 'reject', 'needs-more-information']
    else array['reject', 'needs-more-information']
  end;
$$;
revoke all on function private.claim_review_decisions_allowed_v1(text) from public, anon, authenticated, service_role;

-- api.future-person-claim-review GET: the case for the assigned, stepped-up
-- reviewer. The database cannot decrypt; it returns the sealed identity and
-- the wrapped claim key to the route, which opens only the listed fields.
-- The read is recorded.
create function private.read_claim_review_case_v1(p_review_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_review private.claim_reviews;
  v_intake private.future_person_claim_intakes;
  v_identity public.future_person_identity;
begin
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_review := private.assigned_claim_review_v1(p_review_id, v_reviewer.account_id);
  -- An approved case waits for the release step, which reads it on its own terms.
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required')
    or v_review.photo_document_id is null or v_review.birth_record_document_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select * into v_intake from private.future_person_claim_intakes where id = v_review.id;
  if v_review.case_kind = 'record_key' then
    select f.* into v_identity from public.future_person_identity f
    where f.embryo_id = v_review.matched_embryo_id and f.state = 'current';
  end if;
  insert into private.claim_review_reads (review_id, reviewer_account_id, auth_session_id, review_revision)
  values (v_review.id, v_reviewer.account_id, v_reviewer.auth_session_id, v_review.review_revision);
  perform private.append_legal_audit_event('claim.review.read', null, 'api.future-person-claim-review',
    'accepted', '{}'::jsonb);
  return jsonb_build_object(
    'claimId', v_review.id,
    'mode', v_review.mode,
    'state', v_review.state,
    'reviewRevision', v_review.review_revision,
    'deadline', v_review.deadline,
    'caseKind', v_review.case_kind,
    'allowedDecisions', to_jsonb(private.claim_review_decisions_allowed_v1(v_review.case_kind)),
    'photoIdentityDocumentId', v_review.photo_document_id,
    'birthRecordDocumentId', v_review.birth_record_document_id,
    'identityCiphertext', encode(v_intake.identity_ciphertext, 'hex'),
    'wrappedDataKey', encode(v_intake.wrapped_data_key, 'hex'),
    'parentIdentityCiphertext', case when v_identity.id is null then null
      else encode(v_identity.parent_supplied_ciphertext, 'hex') end);
end;
$$;
revoke all on function private.read_claim_review_case_v1(uuid) from public, anon, authenticated, service_role;
grant execute on function private.read_claim_review_case_v1(uuid) to authenticated;

-- A bound, clean document of an open case the caller reviews; null otherwise.
create function private.claim_review_document_v1(p_review private.claim_reviews, p_document_id uuid)
returns private.claim_documents
language sql stable security definer set search_path = '' as $$
  select d.* from private.claim_documents d
  where d.id = p_document_id and d.intake_id = p_review.id
    and d.id in (p_review.photo_document_id, p_review.birth_record_document_id)
    and d.state = 'clean' and d.scan_verdict = 'OK' and d.scanned_sha256 = d.sha256
    and d.object_deleted_at is null
    and d.sha256 = case when d.id = p_review.photo_document_id then p_review.photo_sha256
      else p_review.birth_record_sha256 end;
$$;
revoke all on function private.claim_review_document_v1(private.claim_reviews, uuid)
  from public, anon, authenticated, service_role;

-- api.legal-evidence-review-download: a revocable chunk session for one
-- bound document, bound to this reviewer and this auth session, one hour
-- absolute and five minutes idle.
create function private.open_claim_review_download_v1(p_document_id uuid, p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_review private.claim_reviews;
  v_document private.claim_documents;
  v_download private.claim_review_downloads;
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim review download invalid';
  end if;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select r.id into v_review.id from private.claim_reviews r
  where r.photo_document_id = p_document_id or r.birth_record_document_id = p_document_id;
  v_review := private.assigned_claim_review_v1(v_review.id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required') then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, p_document_id);
  if v_document.id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  insert into private.claim_review_downloads (cookie_hash, review_id, document_id, reviewer_account_id,
    auth_session_id, sha256, byte_count, chunk_count, created_at, last_used_at, expires_at)
  select p_cookie_hash, v_review.id, v_document.id, v_reviewer.account_id, v_reviewer.auth_session_id,
    v_document.sha256, v_document.byte_count, ceil(v_document.byte_count / 4000000.0)::integer,
    t.now_at, t.now_at, t.now_at + interval '1 hour'
  from (select clock_timestamp() as now_at) t
  returning * into v_download;
  return jsonb_build_object('session', v_download.id, 'sizeBytes', v_download.byte_count,
    'sha256', v_download.sha256, 'chunkCount', v_download.chunk_count, 'mediaType', v_document.media_type,
    'documentKind', v_document.document_kind);
end;
$$;
revoke all on function private.open_claim_review_download_v1(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.open_claim_review_download_v1(uuid, text) to authenticated;

-- api.download-chunk for a claim review download: re-authorizes everything
-- on every chunk (same reviewer, same live stepped-up session, current
-- assignment, open case, the still-clean bound document), then returns the
-- object key and wrapped claim key to the service transport and records the
-- read. The cookie is an identifier, not a grant.
create function private.authorize_claim_review_chunk_v1(p_session_id uuid, p_cookie_hash text, p_sequence integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_download private.claim_review_downloads;
  v_review private.claim_reviews;
  v_document private.claim_documents;
begin
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select d.* into v_download from private.claim_review_downloads d
  where d.id = p_session_id and d.cookie_hash = p_cookie_hash for update;
  if v_download.id is null or v_download.reviewer_account_id <> v_reviewer.account_id
    or v_download.auth_session_id <> v_reviewer.auth_session_id
    or v_download.expires_at <= clock_timestamp()
    or v_download.last_used_at <= clock_timestamp() - interval '300 seconds'
    or p_sequence is null or p_sequence < 0 or p_sequence >= v_download.chunk_count then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_review := private.assigned_claim_review_v1(v_download.review_id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required') then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, v_download.document_id);
  if v_document.id is null or v_document.sha256 <> v_download.sha256 then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  update private.claim_review_downloads set last_used_at = clock_timestamp() where id = v_download.id;
  insert into private.claim_review_reads (review_id, reviewer_account_id, auth_session_id, review_revision,
    document_id, chunk_sequence)
  values (v_review.id, v_reviewer.account_id, v_reviewer.auth_session_id, v_review.review_revision,
    v_document.id, p_sequence);
  perform private.append_legal_audit_event('claim.document.read', null, 'api.download-chunk',
    'accepted', '{}'::jsonb);
  return jsonb_build_object('objectKey', v_document.object_key, 'sha256', v_document.sha256,
    'byteCount', v_document.byte_count, 'chunkCount', v_download.chunk_count,
    'wrappedDataKey', (select encode(i.wrapped_data_key, 'hex') from private.future_person_claim_intakes i
      where i.id = v_review.id));
end;
$$;
revoke all on function private.authorize_claim_review_chunk_v1(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function private.authorize_claim_review_chunk_v1(uuid, text, integer) to authenticated;

-- Whether this reviewer has read every chunk of this document in this case.
create function private.claim_document_fully_read_v1(p_review_id uuid, p_account uuid, p_document private.claim_documents)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(distinct r.chunk_sequence) from private.claim_review_reads r
    where r.review_id = p_review_id and r.reviewer_account_id = p_account and r.document_id = p_document.id)
    = ceil(p_document.byte_count / 4000000.0)::integer;
$$;
revoke all on function private.claim_document_fully_read_v1(uuid, uuid, private.claim_documents)
  from public, anon, authenticated, service_role;

-- api.future-person-claim-review POST. Returns the claimant-safe outcome:
-- the new state and revision, never a match, candidate or deadline.
create function private.decide_claim_review_v1(
  p_review_id uuid, p_review_revision bigint, p_decision text, p_nonce_hash text, p_reason_ciphertext bytea
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_review private.claim_reviews;
  v_photo private.claim_documents;
  v_birth private.claim_documents;
  v_state text;
begin
  if p_decision is null or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 29 and 16384 then
    raise exception using errcode = '22023', message = 'claim review decision invalid';
  end if;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_review := private.assigned_claim_review_v1(p_review_id, v_reviewer.account_id);
  -- The stale, the wrong branch and the already-decided are all the opaque 404.
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required')
    or p_review_revision is distinct from v_review.review_revision
    or not (p_decision = any (private.claim_review_decisions_allowed_v1(v_review.case_kind))) then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  if exists (select 1 from private.claim_review_decisions where nonce_hash = p_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim review nonce already used';
  end if;
  v_photo := private.claim_review_document_v1(v_review, v_review.photo_document_id);
  v_birth := private.claim_review_document_v1(v_review, v_review.birth_record_document_id);
  if v_photo.id is null or v_birth.id is null
    or not private.claim_document_fully_read_v1(v_review.id, v_reviewer.account_id, v_photo)
    or not private.claim_document_fully_read_v1(v_review.id, v_reviewer.account_id, v_birth) then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  insert into private.claim_review_decisions (review_id, review_revision, decision, reviewer_account_id,
    auth_session_id, photo_document_id, photo_sha256, birth_record_document_id, birth_record_sha256,
    reason_ciphertext, nonce_hash)
  values (v_review.id, v_review.review_revision, p_decision, v_reviewer.account_id, v_reviewer.auth_session_id,
    v_photo.id, v_photo.sha256, v_birth.id, v_birth.sha256, p_reason_ciphertext, p_nonce_hash);
  v_state := case
    when p_decision = 'reject' then 'refused'
    when p_decision = 'needs-more-information' then 'more_information_required'
    else 'release_queued' end;
  update private.claim_reviews set state = v_state, review_revision = review_revision + 1,
    resolved_at = case when v_state = 'refused' then clock_timestamp() end
  where id = v_review.id;
  update private.claim_review_assignments set status = 'ended', ended_at = clock_timestamp()
  where review_id = v_review.id and status = 'current' and v_state = 'refused';
  update private.claim_review_downloads set expires_at = created_at where review_id = v_review.id
    and v_state = 'refused';
  perform private.append_legal_audit_event(
    case v_state when 'refused' then 'claim.resolved' when 'release_queued' then 'claim.review.approved'
      else 'claim.review.more-information' end,
    null, 'api.future-person-claim-review',
    case v_state when 'refused' then 'refused' else 'accepted' end,
    case v_state when 'refused' then jsonb_build_object('outcome', 'refused') else '{}'::jsonb end);
  return jsonb_build_object('claimId', v_review.id, 'state', v_state, 'reviewRevision', v_review.review_revision + 1);
end;
$$;
revoke all on function private.decide_claim_review_v1(uuid, bigint, text, text, bytea)
  from public, anon, authenticated, service_role;
grant execute on function private.decide_claim_review_v1(uuid, bigint, text, text, bytea) to authenticated;

-- future-person.claim-review: a case open at its deadline closes without
-- release, whatever it had reached; its documents are then due for deletion.
create function private.close_due_claim_reviews_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update private.claim_reviews set state = 'closed', resolved_at = clock_timestamp()
  where state in ('document_review_pending', 'more_information_required', 'release_queued')
    and deadline <= clock_timestamp();
  get diagnostics v_count = row_count;
  update private.claim_review_assignments a set status = 'ended', ended_at = clock_timestamp()
  from private.claim_reviews r
  where r.id = a.review_id and a.status = 'current' and r.state = 'closed';
  if v_count > 0 then
    perform private.append_legal_audit_event('claim.resolved', null, 'jobs.retention', 'closed',
      jsonb_build_object('outcome', 'closed', 'count', v_count));
  end if;
  return v_count;
end;
$$;
revoke all on function private.close_due_claim_reviews_v1() from public, anon, authenticated, service_role;
grant execute on function private.close_due_claim_reviews_v1() to service_role;

-- abuseControls.global counts live intakes and open documentary reviews
-- together (at most 500 live intake, documentary-review or keyless
-- notice-release cases); a completed claim keeps its place until its review
-- ends. Unchanged otherwise from 20260929150100_future_person_claim_intake.sql.
create or replace function private.start_future_person_claim_v1(
  p_session_hash text,
  p_form_nonce_hash text,
  p_mode text,
  p_key_hash text,
  p_identity_ciphertext bytea,
  p_wrapped_data_key bytea,
  p_identifier_digests jsonb,
  p_network_digests jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_identifier_dimension text;
  v_identifier_keys jsonb := '{}'::jsonb;
  v_network_keys jsonb := '{}'::jsonb;
  v_pair record;
  v_active bigint := private.hmac_active_revision_v1('rate-limit');
  v_allowed boolean;
begin
  -- One writer at a time, so a capacity count and the row it admits commit
  -- together: the reservation is atomic.
  perform pg_advisory_xact_lock(1869509217, 20);

  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_form_nonce_hash is null or p_form_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_mode is null or p_mode not in ('record-key', 'claimant-recovery-key', 'keyless-start')
    or (p_mode = 'keyless-start') <> (p_key_hash is null)
    or (p_key_hash is not null and p_key_hash !~ '^[0-9a-f]{64}$')
    or p_identity_ciphertext is null or octet_length(p_identity_ciphertext) not between 29 and 16384
    or p_wrapped_data_key is null or octet_length(p_wrapped_data_key) not between 29 and 256
  then
    raise exception using errcode = '22023', message = 'claim intake invalid';
  end if;

  -- Buckets first, before anything else is read (securityRateLimitContract
  -- .decisionOrder). Each digest set must cover every usable revision.
  v_identifier_dimension := case when p_mode = 'keyless-start'
    then 'normalized-identifier' else 'token-or-key-hmac' end;
  for v_pair in select * from private.claim_intake_digest_pairs_v1(p_identifier_digests) loop
    v_identifier_keys := v_identifier_keys || jsonb_build_object(
      v_pair.key_revision::text, jsonb_build_object(v_identifier_dimension, v_pair.digest));
  end loop;
  for v_pair in select * from private.claim_intake_digest_pairs_v1(p_network_digests) loop
    v_network_keys := v_network_keys || jsonb_build_object(
      v_pair.key_revision::text, jsonb_build_object('source-network', v_pair.digest));
  end loop;

  v_allowed := private.consume_rate_limit_buckets_v1(
    'api.future-person-claim',
    '[{"dimension":"source-network","windowSeconds":900,"limit":10},
      {"dimension":"source-network","windowSeconds":86400,"limit":40}]'::jsonb,
    v_network_keys);
  v_allowed := private.consume_rate_limit_buckets_v1(
    'api.future-person-claim',
    jsonb_build_array(jsonb_build_object(
      'dimension', v_identifier_dimension, 'windowSeconds', 86400, 'limit', 3)),
    v_identifier_keys) and v_allowed;

  -- Live-session ceilings, counted over every usable revision's digest.
  if v_allowed and (
    (select count(*) from private.future_person_claim_intakes i
     where private.claim_intake_live_v1(i)
       and (i.network_key_revision, i.network_hmac) in (
         select * from private.claim_intake_digest_pairs_v1(p_network_digests))) >= 3
    or exists (
      select 1 from private.future_person_claim_intakes i
      where private.claim_intake_live_v1(i)
        and (i.identifier_key_revision, i.identifier_hmac) in (
          select * from private.claim_intake_digest_pairs_v1(p_identifier_digests)))
    or (select count(*) from private.future_person_claim_intakes i
        where private.claim_intake_live_v1(i))
       + (select count(*) from private.claim_reviews r where private.claim_review_open_v1(r)) >= 500
  ) then
    v_allowed := false;
  end if;

  if not v_allowed then
    return 'capacity_limited';
  end if;

  -- A replayed form nonce is refused, never answered with a second session.
  if exists (select 1 from private.future_person_claim_intakes where form_nonce_hash = p_form_nonce_hash)
    or exists (select 1 from private.future_person_claim_intakes where session_hash = p_session_hash)
  then
    raise exception using errcode = '23505', message = 'claim form already used';
  end if;

  insert into private.future_person_claim_intakes (
    session_hash, form_nonce_hash, mode, key_hash, identity_ciphertext, wrapped_data_key,
    identifier_hmac, identifier_key_revision, network_hmac, network_key_revision,
    created_at, last_active_at, expires_at
  )
  select p_session_hash, p_form_nonce_hash, p_mode, p_key_hash, p_identity_ciphertext,
    p_wrapped_data_key,
    (select digest from private.claim_intake_digest_pairs_v1(p_identifier_digests) where key_revision = v_active),
    v_active,
    (select digest from private.claim_intake_digest_pairs_v1(p_network_digests) where key_revision = v_active),
    v_active,
    now_at, now_at, now_at + interval '24 hours'
  from (select clock_timestamp() as now_at) t;

  -- The ledger learns that a claim started, and nothing about which kind.
  perform private.append_legal_audit_event(
    'claim.intake.started', null, 'api.future-person-claim', 'accepted', '{}'::jsonb);
  return 'received';
end;
$$;

-- A claim's document is kept only while its claim is live, or while it is
-- one of the two bound to an open review.
create function private.claim_document_retained_v1(d private.claim_documents)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.future_person_claim_intakes i
      where i.id = d.intake_id and private.claim_intake_live_v1(i))
    or exists (select 1 from private.claim_reviews r
      where r.id = d.intake_id and private.claim_review_open_v1(r)
        and d.id in (r.photo_document_id, r.birth_record_document_id));
$$;
revoke all on function private.claim_document_retained_v1(private.claim_documents)
  from public, anon, authenticated, service_role;

create or replace function private.claim_document_objects_due_v1(p_limit integer)
returns table (object_key text)
language sql stable security definer set search_path = '' as $$
  select k.object_key from (
    select f.object_key, f.created_at
    from private.claim_document_fragments f
    join private.claim_document_sessions s on s.id = f.session_id
    join private.future_person_claim_intakes i on i.id = s.intake_id
    where f.state = 'delete_pending' or not private.claim_intake_live_v1(i)
      or s.expires_at <= clock_timestamp()
    union all
    select s.planned_object_key, s.created_at
    from private.claim_document_sessions s
    join private.future_person_claim_intakes i on i.id = s.intake_id
    where s.planned_object_key is not null
      and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key)
      and (s.state = 'failed' or s.expires_at <= clock_timestamp() or not private.claim_intake_live_v1(i))
    union all
    select d.object_key, d.created_at
    from private.claim_documents d
    where d.object_deleted_at is null
      and (d.state = 'refused' or not private.claim_document_retained_v1(d))
  ) k
  order by k.created_at
  limit greatest(least(coalesce(p_limit, 100), 1000), 1);
$$;

create or replace function private.claim_document_review_object_v1(p_document_id uuid)
returns table (object_key text, wrapped_data_key bytea, sha256 text, media_type text, byte_count integer)
language sql stable security definer set search_path = '' as $$
  select d.object_key, i.wrapped_data_key, d.sha256, d.media_type, d.byte_count
  from private.claim_documents d
  join private.future_person_claim_intakes i on i.id = d.intake_id
  join private.claim_reviews r on r.id = d.intake_id
  where d.id = p_document_id and d.state = 'clean' and d.scan_verdict = 'OK'
    and d.scanned_sha256 = d.sha256 and d.object_deleted_at is null
    and private.claim_review_open_v1(r) and d.id in (r.photo_document_id, r.birth_record_document_id);
$$;

-- A live claim's intake is purged as before. A completed claim goes only
-- once its review has ended and no object is left behind it; its review,
-- assignments, reads, decisions and downloads go with it, and the ledger
-- keeps only coded outcomes.
create or replace function private.purge_future_person_claim_intakes_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(1869509217, 20);
  delete from private.future_person_claim_intakes i
  where not private.claim_intake_live_v1(i)
    and (i.completed_at is null or exists (select 1 from private.claim_reviews r
      where r.id = i.id and r.state in ('refused', 'closed')))
    and not exists (select 1 from private.claim_document_fragments f
      join private.claim_document_sessions s on s.id = f.session_id where s.intake_id = i.id)
    and not exists (select 1 from private.claim_documents d
      where d.intake_id = i.id and d.object_deleted_at is null)
    and not exists (select 1 from private.claim_document_sessions s
      where s.intake_id = i.id and s.planned_object_key is not null
        and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key));
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.append_legal_audit_event(
      'claim.intake.expired', null, 'jobs.retention', 'purged',
      jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

-- A refused document of an ended review can have been clean: deleting its
-- object keeps the row with its refusal, and a clean one of an ended claim
-- goes with the claim.
create or replace function private.confirm_claim_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_rows integer;
  v_document record;
begin
  if p_route_id is null or p_route_id not in ('jobs.retention', 'jobs.claim-document-scan', 'api.evidence-complete') then
    raise exception using errcode = '22023', message = 'claim document deletion invalid';
  end if;
  delete from private.claim_document_fragments where object_key = any (p_object_keys);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  update private.claim_document_sessions s set planned_object_key = null
  where s.planned_object_key = any (p_object_keys)
    and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  for v_document in
    select d.id, d.state, d.refusal_code, d.object_key from private.claim_documents d
    where d.object_key = any (p_object_keys) and d.object_deleted_at is null for update
  loop
    if v_document.state = 'refused' then
      update private.claim_documents set object_deleted_at = clock_timestamp(), lease_hash = null,
        lease_expires_at = null where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', v_document.refusal_code));
    elsif not private.claim_document_retained_v1(
      (select d from private.claim_documents d where d.id = v_document.id)) then
      update private.claim_document_sessions set planned_object_key = null
      where planned_object_key = v_document.object_key;
      delete from private.claim_documents where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'claim-ended'));
    else
      -- A retained document is never deleted by a confirmation.
      continue;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- What the claim page may know about its own claim cookie: 'live' (the
-- documents step, with the stored mode the completion must name),
-- 'completed' (received for review), or nothing. Never a match or a state.
create function private.claim_session_status_v1(p_session_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.claim_intake_live_v1(i) then jsonb_build_object('status', 'live',
      'mode', case i.mode when 'keyless-start' then 'keyless' else i.mode end)
    when i.completed_at is not null then jsonb_build_object('status', 'completed') end
  from private.future_person_claim_intakes i
  where i.session_hash = p_session_hash;
$$;
revoke all on function private.claim_session_status_v1(text) from public, anon, authenticated, service_role;
grant execute on function private.claim_session_status_v1(text) to service_role;

-- Public doors. The claimant's completion is the service role's; the
-- reviewer's doors are the reviewer's own JWT, every check inside.
create function public.complete_future_person_claim_v1(
  p_session_hash text, p_nonce_hash text, p_mode text, p_photo_document_id uuid, p_birth_record_document_id uuid
) returns text language sql security invoker set search_path = '' as $$
  select private.complete_future_person_claim_v1(p_session_hash, p_nonce_hash, p_mode, p_photo_document_id,
    p_birth_record_document_id);
$$;
create function public.claim_session_status_v1(p_session_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_session_status_v1(p_session_hash);
$$;
create function public.read_claim_review_case_v1(p_review_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.read_claim_review_case_v1(p_review_id);
$$;
create function public.open_claim_review_download_v1(p_document_id uuid, p_cookie_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.open_claim_review_download_v1(p_document_id, p_cookie_hash);
$$;
create function public.authorize_claim_review_chunk_v1(p_session_id uuid, p_cookie_hash text, p_sequence integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.authorize_claim_review_chunk_v1(p_session_id, p_cookie_hash, p_sequence);
$$;
create function public.decide_claim_review_v1(
  p_review_id uuid, p_review_revision bigint, p_decision text, p_nonce_hash text, p_reason_ciphertext bytea
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.decide_claim_review_v1(p_review_id, p_review_revision, p_decision, p_nonce_hash, p_reason_ciphertext);
$$;
create function public.close_due_claim_reviews_v1()
returns integer language sql security invoker set search_path = '' as $$
  select private.close_due_claim_reviews_v1();
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_future_person_claim_v1(text,text,text,uuid,uuid)',
    'public.claim_session_status_v1(text)',
    'public.close_due_claim_reviews_v1()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.read_claim_review_case_v1(uuid)',
    'public.open_claim_review_download_v1(uuid,text)',
    'public.authorize_claim_review_chunk_v1(uuid,text,integer)',
    'public.decide_claim_review_v1(uuid,bigint,text,text,bytea)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
