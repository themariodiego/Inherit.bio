-- The Future Person claim documents step (legal-evidence-ingest-v1 for the
-- two claim document kinds, api.future-person-claim-document-session,
-- api.evidence-chunk, api.evidence-complete), under TEST-LOCAL.
--
-- A live claim session (private.future_person_claim_intakes) opens an
-- evidence session for one document: one kind, one declared media type, size
-- and SHA-256, one hash-only cookie, a hard expiry no later than the claim's.
-- Chunks are written create-only to the private `future-person-identity`
-- bucket under keys this database generates, sealed by the application with
-- the claim's own data key. Completion composes one sealed object and leaves
-- it QUARANTINED: nothing can read it until a malware scan bound to the exact
-- bytes' SHA-256 has returned a positive "OK" under fresh signatures.
--
-- Infected, unscannable, oversize, mistyped or corrupt documents are refused
-- with a closed code, their objects are deleted, and the deletion is recorded
-- in the ledger. When the claim session ends, every row here and every
-- object behind it goes with it (future-person.claim-intake-session-24h,
-- evidence.ingest-session-24h).
--
-- The request never supplies a bucket, an object key, an owner or a review
-- state, and no function here returns a key to anything but the service
-- transport that writes, scans or deletes it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('future-person-identity', 'future-person-identity', false, 20000028,
  array['application/octet-stream'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'future-person-identity'
    and name = 'future-person-identity' and public = false and file_size_limit = 20000028
    and allowed_mime_types = array['application/octet-stream']) then
    raise exception using errcode = '55000', message = 'future_person_identity_bucket_incompatible';
  end if;
end $$;
-- No Storage policy is added: anon and authenticated can list, read, write
-- and delete nothing in this bucket. Only the service transport touches it.

-- payloadBoundaryContract.evidenceIngestLimits and ingestChunkMaximumBytes.
create function private.claim_document_limits_v1()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'maximumDocumentBytes', 20000000,
    'maximumChunks', 5,
    'chunkBytes', 4000000,
    'maximumActiveSessionsPerPrincipal', 3,
    'maximumDocumentsPerTargetAndKind', 3,
    'signatureFreshnessSeconds', 86400,
    'scanLeaseSeconds', 300,
    'maximumScanAttempts', 5);
$$;
revoke all on function private.claim_document_limits_v1() from public, anon, authenticated, service_role;

create table private.claim_document_sessions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references private.future_person_claim_intakes (id) on delete cascade,
  document_id uuid not null unique default gen_random_uuid(),
  document_kind text not null check (document_kind in ('future-photo-identity', 'future-birth-record')),
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  declared_bytes integer not null check (declared_bytes between 1 and 20000000),
  declared_sha256 text not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
  create_nonce_hash text not null unique check (create_nonce_hash ~ '^[0-9a-f]{64}$'),
  complete_nonce_hash text unique check (complete_nonce_hash ~ '^[0-9a-f]{64}$'),
  -- The key the composed object will take, fixed before it is written, so a
  -- write whose completion never commits is still found and deleted.
  planned_object_key text unique check (planned_object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  state text not null default 'open' check (state in ('open', 'composing', 'finalized', 'failed')),
  failure_code text check (failure_code in ('integrity', 'type', 'expired', 'storage')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check ((state = 'failed') = (failure_code is not null)),
  check (state in ('open', 'failed') or complete_nonce_hash is not null)
);
create index claim_document_sessions_intake_idx on private.claim_document_sessions (intake_id);
alter table private.claim_document_sessions enable row level security;
revoke all on private.claim_document_sessions from public, anon, authenticated, service_role;

create table private.claim_document_fragments (
  session_id uuid not null references private.claim_document_sessions (id) on delete cascade,
  sequence integer not null check (sequence between 0 and 4),
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  byte_count integer not null check (byte_count between 1 and 4000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'reserved' check (state in ('reserved', 'written', 'delete_pending')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, sequence)
);
alter table private.claim_document_fragments enable row level security;
revoke all on private.claim_document_fragments from public, anon, authenticated, service_role;

create table private.claim_documents (
  id uuid primary key,
  session_id uuid not null unique references private.claim_document_sessions (id) on delete cascade,
  intake_id uuid not null references private.future_person_claim_intakes (id) on delete cascade,
  document_kind text not null check (document_kind in ('future-photo-identity', 'future-birth-record')),
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_count integer not null check (byte_count between 1 and 20000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  state text not null default 'quarantined' check (state in ('quarantined', 'clean', 'refused')),
  refusal_code text check (refusal_code in ('infected', 'unscannable', 'oversize')),
  scan_verdict text check (scan_verdict = 'OK'),
  scanned_sha256 text check (scanned_sha256 ~ '^[0-9a-f]{64}$'),
  scan_engine text check (length(scan_engine) between 1 and 80),
  scan_signature_version bigint check (scan_signature_version > 0),
  scan_signature_at timestamptz,
  scanned_at timestamptz,
  scan_attempts integer not null default 0 check (scan_attempts between 0 and 100),
  lease_hash text check (lease_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  object_deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  -- A clean document carries its whole positive verdict, bound to its bytes.
  check ((state = 'clean') = (scan_verdict is not null)),
  check (state <> 'clean' or (scanned_sha256 = sha256 and scan_engine is not null
    and scan_signature_version is not null and scan_signature_at is not null and scanned_at is not null
    and object_deleted_at is null)),
  check ((state = 'refused') = (refusal_code is not null)),
  check (object_deleted_at is null or state = 'refused')
);
create index claim_documents_intake_idx on private.claim_documents (intake_id);
create index claim_documents_queue_idx on private.claim_documents (created_at) where state = 'quarantined';
alter table private.claim_documents enable row level security;
revoke all on private.claim_documents from public, anon, authenticated, service_role;

insert into public.purge_target_stores (target_id, store_name, store_order) values
  ('legal-evidence-working-and-private-objects', 'private.claim_document_sessions', 7),
  ('legal-evidence-working-and-private-objects', 'private.claim_document_fragments', 8),
  ('claim-review-working-packages', 'private.claim_documents', 10);

-- A clean verdict can only be written by the scan path, never by an update
-- that skips it: the transition is checked here as well as by the columns.
create function private.guard_claim_document_transition_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'quarantined' or new.scan_verdict is not null or new.object_deleted_at is not null then
      raise exception using errcode = '42501', message = 'a claim document starts quarantined';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.session_id <> old.session_id or new.intake_id <> old.intake_id
    or new.sha256 <> old.sha256 or new.object_key <> old.object_key or new.byte_count <> old.byte_count
    or new.media_type <> old.media_type or new.document_kind <> old.document_kind then
    raise exception using errcode = '42501', message = 'a claim document is immutable';
  end if;
  if old.state <> 'quarantined' and new.state <> old.state then
    raise exception using errcode = '42501', message = 'a scanned claim document keeps its verdict';
  end if;
  if new.state = 'clean' and old.state <> 'clean'
    and coalesce(current_setting('inherit.claim_document_scan', true), '') <> new.id::text then
    raise exception using errcode = '42501', message = 'only a recorded scan marks a document clean';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_claim_document_transition_v1() from public, anon, authenticated, service_role;
create trigger claim_document_transition before insert or update on private.claim_documents
  for each row execute function private.guard_claim_document_transition_v1();

-- The live claim a hash-only claim cookie names, locked for this transaction,
-- with its activity refreshed; null when there is none.
create function private.touch_live_claim_intake_v1(p_session_hash text)
returns private.future_person_claim_intakes
language plpgsql security definer set search_path = '' as $$
declare v_intake private.future_person_claim_intakes;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select i.* into v_intake from private.future_person_claim_intakes i
  where i.session_hash = p_session_hash for update;
  if v_intake.id is null or not private.claim_intake_live_v1(v_intake) then return null; end if;
  update private.future_person_claim_intakes set last_active_at = clock_timestamp()
  where id = v_intake.id returning * into v_intake;
  return v_intake;
end;
$$;
revoke all on function private.touch_live_claim_intake_v1(text) from public, anon, authenticated, service_role;

-- The open evidence session a cookie proves, locked, on a live claim.
create function private.claim_document_session_for_v1(p_session_id uuid, p_cookie_hash text)
returns private.claim_document_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_intake private.future_person_claim_intakes;
begin
  if p_session_id is null or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select s.* into v_session from private.claim_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null then return null; end if;
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id for update;
  if v_intake.id is null or not private.claim_intake_live_v1(v_intake) or v_session.expires_at <= clock_timestamp() then
    return null;
  end if;
  update private.future_person_claim_intakes set last_active_at = clock_timestamp() where id = v_intake.id;
  return v_session;
end;
$$;
revoke all on function private.claim_document_session_for_v1(uuid, text) from public, anon, authenticated, service_role;

-- api.future-person-claim-document-session. The kind comes from the closed
-- body; every kind is allowed in every stored claim mode, and the mode is
-- never read from the client. 'capacity_limited' when the claim already has
-- three open sessions or three documents of this kind.
create function private.open_claim_document_session_v1(
  p_claim_session_hash text, p_create_nonce_hash text, p_document_kind text, p_media_type text,
  p_size_bytes integer, p_sha256 text, p_cookie_hash text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_intake private.future_person_claim_intakes;
  v_limits jsonb := private.claim_document_limits_v1();
  v_session private.claim_document_sessions;
begin
  if p_document_kind is null or p_document_kind not in ('future-photo-identity', 'future-birth-record')
    or p_media_type is null or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > (v_limits->>'maximumDocumentBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_create_nonce_hash is null or p_create_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document session invalid';
  end if;
  v_intake := private.touch_live_claim_intake_v1(p_claim_session_hash);
  if v_intake.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if exists (select 1 from private.claim_document_sessions where create_nonce_hash = p_create_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document nonce already used';
  end if;
  if (select count(*) from private.claim_document_sessions s
      where s.intake_id = v_intake.id and s.state in ('open', 'composing'))
      >= (v_limits->>'maximumActiveSessionsPerPrincipal')::integer
    or (select count(*) from private.claim_document_sessions s
      where s.intake_id = v_intake.id and s.document_kind = p_document_kind and s.state <> 'failed')
      >= (v_limits->>'maximumDocumentsPerTargetAndKind')::integer then
    return jsonb_build_object('status', 'capacity_limited');
  end if;
  insert into private.claim_document_sessions (
    intake_id, document_kind, media_type, declared_bytes, declared_sha256, cookie_hash,
    create_nonce_hash, expires_at, created_at)
  select v_intake.id, p_document_kind, p_media_type, p_size_bytes, p_sha256, p_cookie_hash,
    p_create_nonce_hash, least(t.now_at + interval '24 hours', v_intake.expires_at), t.now_at
  from (select clock_timestamp() as now_at) t
  returning * into v_session;
  return jsonb_build_object('status', 'open', 'session', v_session.id,
    'documentKind', v_session.document_kind, 'expiresAt', v_session.expires_at);
end;
$$;
revoke all on function private.open_claim_document_session_v1(text, text, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.open_claim_document_session_v1(text, text, text, text, integer, text, text) to service_role;

-- Fail a session with a closed code. Its fragments stay listed until the
-- retention job has deleted their objects.
create function private.fail_claim_document_session_row_v1(p_session_id uuid, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.claim_document_sessions set state = 'failed', failure_code = p_code
  where id = p_session_id and state in ('open', 'composing');
  update private.claim_document_fragments set state = 'delete_pending' where session_id = p_session_id;
  perform private.append_legal_audit_event('claim.document.refused', null, 'api.evidence-complete',
    'refused', jsonb_build_object('reason', p_code));
end;
$$;
revoke all on function private.fail_claim_document_session_row_v1(uuid, text) from public, anon, authenticated, service_role;

-- api.evidence-chunk, before the write: reserve one sequence under a key this
-- database makes. The byte count and SHA-256 are the server's own, computed
-- from the received body. Any integrity or capacity failure ends the session
-- (evidence-chunk-v1.failureSideEffects). Returns 'invalid' after failing it.
create function private.reserve_claim_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_limits jsonb := private.claim_document_limits_v1();
  v_written bigint;
  v_key text;
  v_intake private.future_person_claim_intakes;
begin
  v_session := private.claim_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_sequence is null or p_sequence < 0 or p_sequence >= (v_limits->>'maximumChunks')::integer
    or exists (select 1 from private.claim_document_fragments f where f.session_id = v_session.id and f.sequence = p_sequence) then
    raise exception using errcode = '23505', message = 'claim document chunk already written';
  end if;
  select coalesce(sum(f.byte_count), 0) into v_written from private.claim_document_fragments f
  where f.session_id = v_session.id;
  if p_byte_count is null or p_byte_count < 1 or p_byte_count > (v_limits->>'chunkBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or v_written + p_byte_count > v_session.declared_bytes then
    perform private.fail_claim_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'invalid');
  end if;
  v_key := v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text;
  insert into private.claim_document_fragments (session_id, sequence, object_key, byte_count, sha256)
  values (v_session.id, p_sequence, v_key, p_byte_count, p_sha256);
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'reserved', 'objectKey', v_key,
    'wrappedDataKey', encode(v_intake.wrapped_data_key, 'hex'));
end;
$$;
revoke all on function private.reserve_claim_document_chunk_v1(uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function private.reserve_claim_document_chunk_v1(uuid, text, integer, integer, text) to service_role;

-- After a create-only write succeeded (p_written) or failed (not): a failed
-- write ends the session, and its key is deleted like every other.
create function private.settle_claim_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_written boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_session private.claim_document_sessions;
begin
  v_session := private.claim_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if not p_written then
    perform private.fail_claim_document_session_row_v1(v_session.id, 'storage');
    return 'failed';
  end if;
  update private.claim_document_fragments set state = 'written'
  where session_id = v_session.id and sequence = p_sequence and state = 'reserved';
  if not found then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  return 'written';
end;
$$;
revoke all on function private.settle_claim_document_chunk_v1(uuid, text, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.settle_claim_document_chunk_v1(uuid, text, integer, boolean) to service_role;

-- The answer a claimant may see about one document session: closed codes only.
create function private.claim_document_status_v1(p_session private.claim_document_sessions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_session.state = 'failed' then jsonb_build_object('status', 'refused', 'reason', p_session.failure_code)
    when d.id is null then jsonb_build_object('status', 'composing')
    when d.state = 'quarantined' then jsonb_build_object('status', 'scanning', 'documentId', d.id,
      'documentKind', d.document_kind)
    when d.state = 'clean' then jsonb_build_object('status', 'review_pending', 'documentId', d.id,
      'documentKind', d.document_kind)
    else jsonb_build_object('status', 'refused', 'reason', d.refusal_code)
  end
  from (select 1) one
  left join private.claim_documents d on d.session_id = p_session.id;
$$;
revoke all on function private.claim_document_status_v1(private.claim_document_sessions)
  from public, anon, authenticated, service_role;

-- api.evidence-complete, first half. The one-time completion nonce is spent
-- here. The manifest must be exactly the contiguous written sequences 0..n-1,
-- n = p_chunk_count, adding up to the declared size. Returns the plan the
-- service composes from, or, for a session already past this point and the
-- same nonce, only its status.
create function private.begin_claim_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_chunk_count integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_count integer;
  v_bytes bigint;
  v_max integer;
  v_intake private.future_person_claim_intakes;
begin
  if p_complete_nonce_hash is null or p_complete_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  select s.* into v_session from private.claim_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if v_session.state <> 'open' then
    -- The same nonce may ask again for the outcome; nothing else may.
    if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash then
      raise exception using errcode = '23505', message = 'claim document completion already used';
    end if;
    return private.claim_document_status_v1(v_session);
  end if;
  v_session := private.claim_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if exists (select 1 from private.claim_document_sessions where complete_nonce_hash = p_complete_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document completion already used';
  end if;
  select count(*), coalesce(sum(byte_count), 0), coalesce(max(sequence), -1)
  into v_count, v_bytes, v_max
  from private.claim_document_fragments where session_id = v_session.id and state = 'written';
  if p_chunk_count is null or p_chunk_count < 1 or p_chunk_count <> v_count or v_max <> v_count - 1
    or exists (select 1 from private.claim_document_fragments where session_id = v_session.id and state <> 'written')
    or v_bytes <> v_session.declared_bytes then
    update private.claim_document_sessions set complete_nonce_hash = p_complete_nonce_hash
    where id = v_session.id;
    perform private.fail_claim_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'refused', 'reason', 'integrity');
  end if;
  update private.claim_document_sessions set state = 'composing', complete_nonce_hash = p_complete_nonce_hash,
    planned_object_key = v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text
  where id = v_session.id
  returning * into v_session;
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'compose',
    'documentId', v_session.document_id, 'documentKind', v_session.document_kind,
    'mediaType', v_session.media_type, 'sizeBytes', v_session.declared_bytes,
    'sha256', v_session.declared_sha256,
    'objectKey', v_session.planned_object_key,
    'wrappedDataKey', encode(v_intake.wrapped_data_key, 'hex'),
    'fragments', (select jsonb_agg(jsonb_build_object('sequence', f.sequence, 'objectKey', f.object_key,
        'byteCount', f.byte_count, 'sha256', f.sha256) order by f.sequence)
      from private.claim_document_fragments f where f.session_id = v_session.id));
end;
$$;
revoke all on function private.begin_claim_document_completion_v1(uuid, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.begin_claim_document_completion_v1(uuid, text, text, integer) to service_role;

-- api.evidence-complete, second half. p_outcome is 'composed' once the
-- service has checked the exact size, SHA-256 and sniffed type and written
-- the sealed object create-only at p_object_key; otherwise a closed failure.
-- A composed document starts QUARANTINED, and its fragments are deleted.
create function private.finish_claim_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_outcome text, p_object_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session private.claim_document_sessions;
begin
  select s.* into v_session from private.claim_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash
    and s.complete_nonce_hash = p_complete_nonce_hash for update;
  if v_session.id is null or v_session.state <> 'composing' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_outcome in ('integrity', 'type', 'storage') then
    perform private.fail_claim_document_session_row_v1(v_session.id, p_outcome);
    return private.claim_document_status_v1(
      (select s from private.claim_document_sessions s where s.id = v_session.id));
  end if;
  if p_outcome is distinct from 'composed' or p_object_key is distinct from v_session.planned_object_key then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  insert into private.claim_documents (id, session_id, intake_id, document_kind, media_type, byte_count,
    sha256, object_key)
  values (v_session.document_id, v_session.id, v_session.intake_id, v_session.document_kind,
    v_session.media_type, v_session.declared_bytes, v_session.declared_sha256, p_object_key);
  update private.claim_document_sessions set state = 'finalized' where id = v_session.id;
  update private.claim_document_fragments set state = 'delete_pending' where session_id = v_session.id;
  perform private.append_legal_audit_event('claim.document.received', null, 'api.evidence-complete',
    'accepted', '{}'::jsonb);
  return private.claim_document_status_v1(
    (select s from private.claim_document_sessions s where s.id = v_session.id));
end;
$$;
revoke all on function private.finish_claim_document_completion_v1(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.finish_claim_document_completion_v1(uuid, text, text, text, text) to service_role;

-- The scan worker takes the oldest quarantined document of a live claim
-- that no other worker holds, for one lease. It receives the key and the
-- wrapped data key because it must read the bytes it scans; nothing else
-- ever receives a quarantined document's key.
create function private.claim_next_claim_document_scan_v1(p_lease_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_document private.claim_documents;
  v_limits jsonb := private.claim_document_limits_v1();
begin
  if p_lease_hash is null or p_lease_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'scan lease invalid';
  end if;
  select d.* into v_document from private.claim_documents d
  join private.future_person_claim_intakes i on i.id = d.intake_id
  where d.state = 'quarantined' and (d.lease_expires_at is null or d.lease_expires_at <= clock_timestamp())
    and i.expires_at > clock_timestamp()
  order by d.created_at, d.id
  limit 1
  for update of d skip locked;
  if v_document.id is null then return null; end if;
  update private.claim_documents set lease_hash = p_lease_hash,
    lease_expires_at = clock_timestamp() + make_interval(secs => (v_limits->>'scanLeaseSeconds')::integer),
    scan_attempts = scan_attempts + 1
  where id = v_document.id;
  return jsonb_build_object('documentId', v_document.id, 'objectKey', v_document.object_key,
    'sha256', v_document.sha256, 'byteCount', v_document.byte_count, 'mediaType', v_document.media_type,
    'wrappedDataKey', (select encode(i.wrapped_data_key, 'hex') from private.future_person_claim_intakes i
      where i.id = v_document.intake_id));
end;
$$;
revoke all on function private.claim_next_claim_document_scan_v1(text) from public, anon, authenticated, service_role;
grant execute on function private.claim_next_claim_document_scan_v1(text) to service_role;

-- The only writer of a scan verdict. 'OK' marks a document clean only when
-- the scanned bytes' SHA-256 is the document's and the signature database is
-- fresh; anything short of that is refused (22023) and the document stays
-- quarantined. 'FOUND', 'UNSCANNABLE' and 'OVERSIZE' refuse the document,
-- which becomes unreadable at once; 'UNAVAILABLE' (scanner down or stale)
-- releases the lease, and after the last attempt refuses as unscannable.
-- Returns 'clean', 'delete' (the caller must delete the object and confirm)
-- or 'retry'.
create function private.record_claim_document_scan_v1(
  p_document_id uuid, p_lease_hash text, p_outcome text, p_scanned_sha256 text,
  p_scan_engine text, p_signature_version bigint, p_signature_at timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_document private.claim_documents;
  v_limits jsonb := private.claim_document_limits_v1();
  v_refusal text;
begin
  select d.* into v_document from private.claim_documents d
  where d.id = p_document_id and d.lease_hash = p_lease_hash and d.state = 'quarantined'
    and d.lease_expires_at > clock_timestamp()
  for update;
  if v_document.id is null then
    raise exception using errcode = '42501', message = 'scan lease unavailable';
  end if;
  if p_outcome = 'OK' then
    if p_scanned_sha256 is distinct from v_document.sha256
      or p_scan_engine is null or length(p_scan_engine) not between 1 and 80
      or p_signature_version is null or p_signature_version < 1
      or p_signature_at is null
      or p_signature_at < clock_timestamp() - make_interval(secs => (v_limits->>'signatureFreshnessSeconds')::integer)
      or p_signature_at > clock_timestamp() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'scan verdict refused';
    end if;
    perform set_config('inherit.claim_document_scan', v_document.id::text, true);
    update private.claim_documents set state = 'clean', scan_verdict = 'OK',
      scanned_sha256 = p_scanned_sha256, scan_engine = p_scan_engine,
      scan_signature_version = p_signature_version, scan_signature_at = p_signature_at,
      scanned_at = clock_timestamp(), lease_hash = null, lease_expires_at = null
    where id = v_document.id;
    perform set_config('inherit.claim_document_scan', '', true);
    perform private.append_legal_audit_event('claim.document.scanned', null, 'jobs.claim-document-scan',
      'accepted', '{}'::jsonb);
    return 'clean';
  elsif p_outcome = 'UNAVAILABLE' then
    if v_document.scan_attempts < (v_limits->>'maximumScanAttempts')::integer then
      update private.claim_documents set lease_hash = null, lease_expires_at = null where id = v_document.id;
      return 'retry';
    end if;
    v_refusal := 'unscannable';
  elsif p_outcome = 'FOUND' then
    v_refusal := 'infected';
  elsif p_outcome = 'UNSCANNABLE' then
    v_refusal := 'unscannable';
  elsif p_outcome = 'OVERSIZE' then
    v_refusal := 'oversize';
  else
    raise exception using errcode = '22023', message = 'scan verdict refused';
  end if;
  update private.claim_documents set state = 'refused', refusal_code = v_refusal,
    lease_hash = null, lease_expires_at = null
  where id = v_document.id;
  perform private.append_legal_audit_event('claim.document.refused', null, 'jobs.claim-document-scan',
    'refused', jsonb_build_object('reason', v_refusal));
  return 'delete';
end;
$$;
revoke all on function private.record_claim_document_scan_v1(uuid, text, text, text, text, bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.record_claim_document_scan_v1(uuid, text, text, text, text, bigint, timestamptz)
  to service_role;

-- Objects the service must delete: fragments of finished or failed sessions,
-- refused documents' objects, and everything of a claim that has ended.
create function private.claim_document_objects_due_v1(p_limit integer)
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
    join private.future_person_claim_intakes i on i.id = d.intake_id
    where d.object_deleted_at is null
      and (d.state = 'refused' or not private.claim_intake_live_v1(i))
  ) k
  order by k.created_at
  limit greatest(least(coalesce(p_limit, 100), 1000), 1);
$$;
revoke all on function private.claim_document_objects_due_v1(integer) from public, anon, authenticated, service_role;
grant execute on function private.claim_document_objects_due_v1(integer) to service_role;

-- The service has deleted these objects (Storage answered, or they were
-- already gone). Fragment rows go; a document keeps its refusal and the time
-- its object was deleted, and the ledger records the deletion by reason.
create function private.confirm_claim_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
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
    else
      -- A quarantined or clean document's object is deleted only because its
      -- claim ended; the row goes with the claim.
      update private.claim_document_sessions set planned_object_key = null
      where planned_object_key = v_document.object_key;
      delete from private.claim_documents where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'claim-ended'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.confirm_claim_document_objects_deleted_v1(text[], text) from public, anon, authenticated, service_role;
grant execute on function private.confirm_claim_document_objects_deleted_v1(text[], text) to service_role;

-- The read gate the named-reviewer routes will call. Nothing is readable
-- before a clean verdict bound to the bytes, and nothing after the claim
-- ends. Granted to no API role.
create function private.claim_document_review_object_v1(p_document_id uuid)
returns table (object_key text, wrapped_data_key bytea, sha256 text, media_type text, byte_count integer)
language sql stable security definer set search_path = '' as $$
  select d.object_key, i.wrapped_data_key, d.sha256, d.media_type, d.byte_count
  from private.claim_documents d
  join private.future_person_claim_intakes i on i.id = d.intake_id
  where d.id = p_document_id and d.state = 'clean' and d.scan_verdict = 'OK'
    and d.scanned_sha256 = d.sha256 and d.object_deleted_at is null
    and i.expires_at > clock_timestamp();
$$;
revoke all on function private.claim_document_review_object_v1(uuid) from public, anon, authenticated, service_role;

-- The claim purge keeps an ended claim until the retention job has deleted
-- every object behind it; the rows then go with it. Unchanged otherwise from
-- 20260929150100_future_person_claim_intake.sql.
create or replace function private.purge_future_person_claim_intakes_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(1869509217, 20);
  delete from private.future_person_claim_intakes i
  where not private.claim_intake_live_v1(i)
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
revoke all on function private.purge_future_person_claim_intakes_v1()
  from public, anon, authenticated, service_role;
grant execute on function private.purge_future_person_claim_intakes_v1() to service_role;

-- Whether a claim cookie names a live claim, for the claim page to offer the
-- documents step. It reads nothing else and changes nothing.
create function private.claim_session_live_v1(p_session_hash text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.future_person_claim_intakes i
    where i.session_hash = p_session_hash and private.claim_intake_live_v1(i));
$$;
revoke all on function private.claim_session_live_v1(text) from public, anon, authenticated, service_role;
grant execute on function private.claim_session_live_v1(text) to service_role;

-- Public invoker doors, granted to the service role only.
create function public.claim_session_live_v1(p_session_hash text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.claim_session_live_v1(p_session_hash);
$$;
create function public.open_claim_document_session_v1(
  p_claim_session_hash text, p_create_nonce_hash text, p_document_kind text, p_media_type text,
  p_size_bytes integer, p_sha256 text, p_cookie_hash text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.open_claim_document_session_v1(p_claim_session_hash, p_create_nonce_hash, p_document_kind,
    p_media_type, p_size_bytes, p_sha256, p_cookie_hash);
$$;
create function public.reserve_claim_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_claim_document_chunk_v1(p_session_id, p_cookie_hash, p_sequence, p_byte_count, p_sha256);
$$;
create function public.settle_claim_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_written boolean
) returns text language sql security invoker set search_path = '' as $$
  select private.settle_claim_document_chunk_v1(p_session_id, p_cookie_hash, p_sequence, p_written);
$$;
create function public.begin_claim_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_chunk_count integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_claim_document_completion_v1(p_session_id, p_cookie_hash, p_complete_nonce_hash, p_chunk_count);
$$;
create function public.finish_claim_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_outcome text, p_object_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.finish_claim_document_completion_v1(p_session_id, p_cookie_hash, p_complete_nonce_hash,
    p_outcome, p_object_key);
$$;
create function public.claim_next_claim_document_scan_v1(p_lease_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_next_claim_document_scan_v1(p_lease_hash);
$$;
create function public.record_claim_document_scan_v1(
  p_document_id uuid, p_lease_hash text, p_outcome text, p_scanned_sha256 text,
  p_scan_engine text, p_signature_version bigint, p_signature_at timestamptz
) returns text language sql security invoker set search_path = '' as $$
  select private.record_claim_document_scan_v1(p_document_id, p_lease_hash, p_outcome, p_scanned_sha256,
    p_scan_engine, p_signature_version, p_signature_at);
$$;
create function public.claim_document_objects_due_v1(p_limit integer)
returns table (object_key text) language sql security invoker set search_path = '' as $$
  select * from private.claim_document_objects_due_v1(p_limit);
$$;
create function public.confirm_claim_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
returns integer language sql security invoker set search_path = '' as $$
  select private.confirm_claim_document_objects_deleted_v1(p_object_keys, p_route_id);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.claim_session_live_v1(text)',
    'public.open_claim_document_session_v1(text,text,text,text,integer,text,text)',
    'public.reserve_claim_document_chunk_v1(uuid,text,integer,integer,text)',
    'public.settle_claim_document_chunk_v1(uuid,text,integer,boolean)',
    'public.begin_claim_document_completion_v1(uuid,text,text,integer)',
    'public.finish_claim_document_completion_v1(uuid,text,text,text,text)',
    'public.claim_next_claim_document_scan_v1(text)',
    'public.record_claim_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz)',
    'public.claim_document_objects_due_v1(integer)',
    'public.confirm_claim_document_objects_deleted_v1(text[],text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
