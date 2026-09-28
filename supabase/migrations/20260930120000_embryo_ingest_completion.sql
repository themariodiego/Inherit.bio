-- Embryo ingest completion: the one transaction that turns an open upload
-- attempt whose every chunk is stored into `sanitization_pending` with exactly
-- one `split_cohort_vcf` job bound to its exact fragment manifest
-- (`docs/embryo-session-configuration.md` item 4; register
-- `policyResolvers.embryo-ingest-session-v1.completion`).
--
-- TEST-LOCAL only. `EMBRYO_INGEST_AVAILABLE` stays false and no route calls
-- this yet. Nothing here publishes: no genome_files row, no variant, QC or
-- score row, no mail and no downstream analysis job. Embryo subjects stay
-- quarantined and embryos stay `pending` until the worker's terminal
-- publication transaction, which is a separate migration.
--
-- Storage write fence (20260928100000_embryo_ingest_write_fence.sql). Chunk
-- commit already requires every fragment's write intent to be `landed`, and
-- leaving `open` stamps the fence. This transaction is the one that leaves
-- `open`, only when every chunk is `stored`, and it rechecks the fence's own
-- evidence: every fragment has its write intent, and every intent is
-- `landed`. That is the landing record whichever backend holds the bytes
-- (a Supabase metadata row or an acknowledged R2 version), so nothing here
-- reads a provider-specific store. It never renews the fixed 24-hour
-- deadline, never cancels the `embryo.ingest-session-24h` due phase and never
-- deletes a fragment or handle.
--
-- The completion nonce is the one the configure transaction issued
-- (20260929110000_embryo_vcf_configure_route.sql stores its digest as
-- `issued_completion_nonce_hash`). Any other nonce is a credential mismatch.

-- ---------------------------------------------------------------------------
-- 1. The locked manifest lives on the session row it snapshots.
-- ---------------------------------------------------------------------------

-- The job's source binding is the session itself: its frozen authority
-- columns and fingerprint already snapshot the cohort, basis, set, artifact,
-- jurisdiction and donor revisions, and these write-once columns add the
-- fragment manifest, the completion nonce and the one job.
alter table public.embryo_ingest_sessions
  add column manifest_sha256 text check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column manifest_chunk_count integer check (manifest_chunk_count between 1 and 50),
  add column completion_nonce_hash text unique check (completion_nonce_hash ~ '^[0-9a-f]{64}$'),
  add column worker_job_id uuid unique references public.worker_jobs (id) on delete restrict,
  add constraint embryo_ingest_manifest_shape check (
    num_nonnulls(manifest_sha256, manifest_chunk_count, completion_nonce_hash, worker_job_id) in (0, 4)
    and (completion_nonce_hash is null or completed_at is not null)
    and (completion_nonce_hash is not null
      or status not in ('sanitization_pending', 'processing', 'published'))
  );

-- Exactly one sanitization job per attempt, structurally. The idempotency key
-- already makes a replay return the same row; this makes any second tuple for
-- the same session fail instead of queueing a rival.
create unique index worker_jobs_one_embryo_split_per_session
  on public.worker_jobs (source_binding_id)
  where kind = 'split_cohort_vcf';

-- Once completed, the manifest, the counters it was computed from and the
-- completion identity are frozen, and the attempt can never reopen for writes.
-- Status may still move forward (processing, published) or to failure_pending.
create function private.freeze_embryo_ingest_manifest_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.completion_nonce_hash is not null and (
    (new.manifest_sha256, new.manifest_chunk_count, new.completion_nonce_hash,
      new.worker_job_id, new.completed_at, new.expected_next_sequence,
      new.accepted_bytes, new.accepted_chunks, new.accepted_records)
    is distinct from
    (old.manifest_sha256, old.manifest_chunk_count, old.completion_nonce_hash,
      old.worker_job_id, old.completed_at, old.expected_next_sequence,
      old.accepted_bytes, old.accepted_chunks, old.accepted_records)
    or new.status in ('open', 'mapping_required', 'complete')
  ) then
    raise exception using errcode = '55000', message = 'immutable ingest manifest';
  end if;
  return new;
end $$;
create trigger embryo_ingest_manifest_immutable
  before update on public.embryo_ingest_sessions
  for each row execute function private.freeze_embryo_ingest_manifest_v1();
revoke all on function private.freeze_embryo_ingest_manifest_v1()
  from public, anon, authenticated, inherit_upload_only;

-- ---------------------------------------------------------------------------
-- 2. The manifest digest (sourceBindingMatrix.embryo-ingest-fragment-set).
-- ---------------------------------------------------------------------------

-- Length-prefixed, ordered, and computed only from server-owned values: the
-- attempt identity and revisions, the session's authority fingerprint (which
-- the binding check proves is still current), the random handle hashes, every
-- chunk receipt and every fragment's random object identity, path, size and
-- digest in ascending ordinal order. No source label or header derivative
-- exists to include. A null anywhere yields null, which every caller treats
-- as a mismatch. The worker recomputes this at claim and before publication.
create function private.embryo_ingest_manifest_sha256_v1(p_session_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  s public.embryo_ingest_sessions%rowtype;
  v bytea;
begin
  select * into s from public.embryo_ingest_sessions where id = p_session_id;
  if not found then return null; end if;
  v := private.length_prefix_utf8('embryo-ingest-fragment-set-v1')
    || private.length_prefix_utf8(s.id::text)
    || private.length_prefix_utf8(s.cohort_id::text)
    || private.length_prefix_utf8(s.upload_id::text)
    || private.length_prefix_utf8(s.ingest_revision::text)
    || private.length_prefix_utf8('1')
    || private.length_prefix_utf8(s.source_format)
    || private.length_prefix_utf8(s.reference_build)
    || private.length_prefix_utf8(s.transport_revision::text)
    || private.length_prefix_utf8(s.authority_fingerprint)
    || coalesce((
      select string_agg(
        private.length_prefix_utf8('handle')
        || private.length_prefix_utf8(m.sample_ordinal::text)
        || private.length_prefix_utf8(m.handle_hash), ''::bytea order by m.sample_ordinal)
      from public.embryo_fragment_handle_maps m where m.session_id = s.id), ''::bytea)
    || coalesce((
      select string_agg(
        private.length_prefix_utf8('chunk')
        || private.length_prefix_utf8(k.sequence::text)
        || private.length_prefix_utf8(k.state)
        || private.length_prefix_utf8(k.content_sha256)
        || private.length_prefix_utf8(k.byte_count::text)
        || private.length_prefix_utf8(k.record_count::text)
        || private.length_prefix_utf8(k.maximum_line_bytes::text), ''::bytea order by k.sequence)
      from public.embryo_ingest_chunks k where k.session_id = s.id), ''::bytea)
    || coalesce((
      select string_agg(
        private.length_prefix_utf8('fragment')
        || private.length_prefix_utf8(f.sample_ordinal::text)
        || private.length_prefix_utf8(f.sequence::text)
        || private.length_prefix_utf8(f.object_id::text)
        || private.length_prefix_utf8(f.bucket_id)
        || private.length_prefix_utf8(f.object_name)
        || private.length_prefix_utf8(f.byte_count::text)
        || private.length_prefix_utf8(f.content_sha256)
        || private.length_prefix_utf8(f.line_count::text), ''::bytea
        order by f.sample_ordinal, f.sequence)
      from public.embryo_ingest_fragments f where f.session_id = s.id), ''::bytea);
  return encode(extensions.digest(v, 'sha256'), 'hex');
end $$;
revoke all on function private.embryo_ingest_manifest_sha256_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 3. The unwind planner admits the attempt's own sanitization job.
-- ---------------------------------------------------------------------------

-- `worker_jobs` carries `cohort_id`, so once completion enqueues the job an
-- unchanged planner would refuse every later unwind of that attempt as an
-- unsupported store, and an expired or failed completed attempt could never be
-- cleaned up. The job holds no Storage object, so admitting it leaves the
-- object inventory exact. Only the attempt's own `split_cohort_vcf` row is
-- admitted: any other job targeting the cohort, its subjects or its session
-- still fails closed. The final graph purge must delete that row (and the
-- session's `worker_job_id` reference first); it is registered under
-- `worker-and-model-working-state`. Everything else is unchanged from
-- 20260905203457_embryo_ingest_unwind_runtime.sql.
create or replace function private.assert_embryo_unwind_plannable_stores_v1(p_targets uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare r record; v_exists boolean; v_allowed constant text[]:=array[
  'subjects','embryos','embryo_cohorts','embryo_cohort_drafts','embryo_participant_sets',
  'embryo_basis_bindings','embryo_donor_attributions','embryo_ingest_sessions','embryo_ingest_unwinds',
  'embryo_ingest_chunks','embryo_ingest_fragments','embryo_fragment_handle_maps','embryo_mapping_challenges',
  'embryo_draft_participants','draft_participant_slots','embryo_operation_nonces','consent_signatures','attestations',
  'attestation_contradictions','subject_invitations','mail_outbox','token_candidates','rights_sessions',
  'future_person_record_key_hashes','future_person_record_key_print_rights','future_person_record_key_recipients',
  'retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries',
  'genome_files','genome_storage_objects','upload_sessions','worker_jobs'];
begin
  for r in select c.relname table_name,a.attname column_name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and not a.attisdropped and a.atttypid='uuid'::regtype
      and a.attname in ('cohort_id','subject_id','embryo_id','target_id','draft_id','embryo_draft_id','ingest_session_id','session_id')
      and not c.relname=any(v_allowed)
  loop
    execute format('select exists(select 1 from public.%I where %I=any($1))',r.table_name,r.column_name)
      into v_exists using p_targets;
    if v_exists then raise exception using errcode='55000',message='unsupported unwind store'; end if;
  end loop;
  if exists(select 1 from public.worker_jobs w
    where (w.cohort_id=any(p_targets) or w.subject_id=any(p_targets))
      and not (w.kind='split_cohort_vcf' and w.output_kind='ingest.normalize'
        and w.source_binding_kind='embryo-ingest-fragment-set'
        and w.source_binding_id=any(p_targets))) then
    raise exception using errcode='55000',message='unsupported unwind store';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The completion transaction.
-- ---------------------------------------------------------------------------

-- A terminal completion branch: the durable denial marker, never the unwind.
-- The session, due target, handle map, chunks and fragments all survive for
-- the identical cohort-wide `attemptFailure` dispatch.
create function private.embryo_ingest_completion_failure_v1(p_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.embryo_ingest_sessions%rowtype;
begin
  perform private.mark_embryo_ingest_failure_v1(p_session_id, p_code);
  select * into strict s from public.embryo_ingest_sessions where id = p_session_id;
  return jsonb_build_object('status', 'failure_pending', 'cohortId', s.cohort_id,
    'ingestRevision', s.ingest_revision, 'failureCode', s.failure_code);
end $$;
revoke all on function private.embryo_ingest_completion_failure_v1(uuid, text)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- api.embryo-ingest-complete. The caller supplies only its credentials, the
-- chunk count it believes it sent and the one-time completion nonce; every
-- fact the decision rests on is read from the locked rows.
--
-- Outcomes:
--   sanitization_pending      first completion: one job queued (HTTP 202)
--   sanitization_in_progress  exact replay of that completion (HTTP 200)
--   mapping_required          a column or build decision is still pending;
--                             nonterminal, nothing written, nonce unspent
--   failure_pending           terminal; the attempt is marked for the one
--                             cohort-wide unwind and `failureCode` is closed
-- 42501 for any credential, cohort, revision or unissued-nonce mismatch (no
-- state revealed and nothing written),
-- 22023 for a malformed request (retryable, nothing written), 23505 for a
-- nonce already spent elsewhere, 55P03 for contention (retry the same nonce).
create function private.complete_embryo_ingest_v1(
  p_account uuid, p_auth uuid, p_session uuid, p_cookie_hash text, p_origin text,
  p_cohort uuid, p_ingest_revision bigint, p_chunk_count integer, p_nonce text,
  p_test boolean default false
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  a jsonb;
  s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype;
  j public.worker_jobs%rowtype;
  h text;
  v_failure text;
  v_count integer;
  v_stored integer;
  v_first integer;
  v_last integer;
  v_manifest text;
begin
  if p_test is distinct from true then
    raise exception using errcode = '42501', message = 'jurisdiction unavailable';
  end if;
  if p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256
    or p_chunk_count is null or p_chunk_count not between 1 and 50 then
    raise exception using errcode = '22023', message = 'invalid ingest completion';
  end if;
  h := encode(extensions.digest(convert_to(p_nonce, 'UTF8'), 'sha256'), 'hex');

  -- Filter on every credential and the expected cohort/revision before any
  -- lock, as the shared door does: a foreign or stale request never locks,
  -- marks or reveals the target.
  select * into s from public.embryo_ingest_sessions
    where id = p_session and account_id = p_account and originating_session_id = p_auth
      and cookie_hash = p_cookie_hash and origin = p_origin and cohort_id = p_cohort
      and ingest_revision = p_ingest_revision and upload_id is not null
    for update nowait;
  if not found then raise exception using errcode = '42501', message = 'ingest unavailable'; end if;
  -- Only the nonce configuration issued can complete this attempt. Checked
  -- before the shared door, so a request without it causes no side effect.
  if s.issued_completion_nonce_hash is null or s.issued_completion_nonce_hash <> h then
    raise exception using errcode = '42501', message = 'ingest unavailable';
  end if;

  if s.completion_nonce_hash is not null then
    -- An exact replay of the committed completion. It enqueues nothing and
    -- changes no manifest value, but live authority is still rechecked.
    if s.completion_nonce_hash <> h or s.manifest_chunk_count <> p_chunk_count then
      raise exception using errcode = '42501', message = 'ingest unavailable';
    end if;
    if s.status = 'failure_pending' then
      return jsonb_build_object('status', 'failure_pending', 'cohortId', s.cohort_id,
        'ingestRevision', s.ingest_revision, 'failureCode', s.failure_code);
    end if;
    if s.status not in ('sanitization_pending', 'processing') then
      raise exception using errcode = '42501', message = 'ingest unavailable';
    end if;
    v_failure := private.embryo_ingest_binding_failure_v1(s.id);
    if v_failure is not null then
      return private.embryo_ingest_completion_failure_v1(s.id, v_failure);
    end if;
    select * into strict j from public.worker_jobs where id = s.worker_job_id;
    if j.status not in ('queued', 'running') then
      raise exception using errcode = '55000', message = 'ingest completion unavailable';
    end if;
    return jsonb_build_object('status', 'sanitization_in_progress', 'uploadId', s.upload_id,
      'jobId', j.id, 'analysisState', j.status);
  end if;

  -- First completion. The shared door relocks the session, reruns the full
  -- binding check (revocation, expiry, revisions, authority fingerprint, due
  -- pair) and the handle map, and marks failure_pending itself on refusal.
  a := private.lock_embryo_configuration_v1(p_account, p_auth, p_session, p_cookie_hash,
    p_origin, p_cohort, p_ingest_revision, p_test);
  if a->>'status' = 'failure_pending' then return a; end if;
  select * into strict s from public.embryo_ingest_sessions where id = p_session for update;
  select * into strict c from public.embryo_cohorts where id = s.cohort_id;

  if s.status = 'mapping_required' then
    return jsonb_build_object('status', 'mapping_required',
      'kind', (select m.challenge_kind from public.embryo_mapping_challenges m
        where m.ingest_session_id = s.id and m.state = 'pending'),
      'expiresAt', (select m.expires_at from public.embryo_mapping_challenges m
        where m.ingest_session_id = s.id and m.state = 'pending'));
  end if;

  -- Configuration must be complete: a recorded format and a resolved build.
  if s.source_format is null or s.configuration_nonce_hash is null then
    return private.embryo_ingest_completion_failure_v1(s.id, 'format');
  end if;
  if s.reference_build is null then
    return private.embryo_ingest_completion_failure_v1(s.id, 'build');
  end if;

  -- Chunks: the caller's count equals the server's contiguous, zero-based,
  -- entirely stored receipt set, and the session counters agree with it.
  perform 1 from public.embryo_ingest_chunks where session_id = s.id order by sequence for share;
  select count(*), count(*) filter (where state = 'stored'), min(sequence), max(sequence)
    into v_count, v_stored, v_first, v_last
    from public.embryo_ingest_chunks where session_id = s.id;
  if v_count = 0 or v_count <> p_chunk_count or v_stored <> v_count
    or v_first <> 0 or v_last <> v_count - 1
    or s.expected_next_sequence <> v_count or s.accepted_chunks <> v_count then
    return private.embryo_ingest_completion_failure_v1(s.id, 'chunk');
  end if;

  -- Fragments: the distinct stable ordinals are exactly 0 through the cohort's
  -- immutable embryo count minus one, and a VCF chunk carries every ordinal
  -- (the transport splits every record into every embryo's fragment).
  perform 1 from public.embryo_ingest_fragments where session_id = s.id
    order by sequence, sample_ordinal for share;
  if (select count(distinct f.sample_ordinal) from public.embryo_ingest_fragments f
      where f.session_id = s.id) <> c.embryo_count
    or exists(select 1 from public.embryo_ingest_fragments f where f.session_id = s.id
      and (f.sample_ordinal < 0 or f.sample_ordinal >= c.embryo_count))
    or (s.source_format in ('vcf', 'gvcf') and exists(
      select 1 from public.embryo_ingest_chunks k where k.session_id = s.id
        and (select count(*) from public.embryo_ingest_fragments f
          where f.session_id = k.session_id and f.sequence = k.sequence) <> c.embryo_count)) then
    return private.embryo_ingest_completion_failure_v1(s.id, 'format');
  end if;

  -- The fence's evidence, rechecked: every fragment has its write intent
  -- and every intent is `landed`, whatever the backend. Locked until commit
  -- in the fence's order (session held, then intents).
  perform 1 from private.embryo_ingest_write_intents i where i.session_id = s.id
    order by i.sequence, i.sample_ordinal for share;
  if exists(select 1 from public.embryo_ingest_fragments f
      left join private.embryo_ingest_write_intents i on i.session_id = f.session_id
        and i.sequence = f.sequence and i.sample_ordinal = f.sample_ordinal
      where f.session_id = s.id and (i.state is distinct from 'landed' or i.byte_count <> f.byte_count)) then
    return private.embryo_ingest_completion_failure_v1(s.id, 'chunk');
  end if;

  -- One-to-one subject reservation: every ordinal still has its quarantined
  -- embryo subject and pending embryo, and nothing else exists.
  perform 1 from public.embryos where cohort_id = c.id order by sample_ordinal for share;
  perform 1 from public.subjects where cohort_id = c.id order by id for share;
  if (select count(*) from public.embryos e join public.subjects sub on sub.id = e.subject_id
      where e.cohort_id = c.id and sub.cohort_id = c.id and sub.subject_class = 'embryo'
        and sub.lifecycle = 'quarantined' and sub.owner_account_id = c.owner_account_id
        and e.status = 'pending' and e.sample_ordinal between 0 and c.embryo_count - 1)
      <> c.embryo_count
    or (select count(*) from public.embryos e where e.cohort_id = c.id) <> c.embryo_count
    or (select count(*) from public.subjects sub where sub.cohort_id = c.id) <> c.embryo_count then
    return private.embryo_ingest_completion_failure_v1(s.id, 'stale-binding');
  end if;

  -- Success. The nonce is spent in the same transaction as the transition.
  perform private.consume_embryo_operation_nonce_v1(p_nonce, p_account, p_auth,
    'ingest_complete', 'ingest_session', s.id);
  v_manifest := private.embryo_ingest_manifest_sha256_v1(s.id);
  if v_manifest is null then
    raise exception using errcode = '55000', message = 'ingest manifest unavailable';
  end if;
  j := private.enqueue_worker_job_v2(s.account_id, 'split_cohort_vcf', 'ingest.normalize',
    null, c.id, 'embryo-ingest-fragment-set', s.id, 1, v_manifest, 'embryo-split-v1',
    null, '{}'::jsonb);
  if j.status <> 'queued' or j.attempts <> 0 then
    raise exception using errcode = '55000', message = 'ingest completion unavailable';
  end if;
  update public.embryo_ingest_sessions
    set status = 'sanitization_pending', completed_at = clock_timestamp(),
      manifest_sha256 = v_manifest, manifest_chunk_count = v_count,
      completion_nonce_hash = h, worker_job_id = j.id
    where id = s.id;
  update public.embryo_cohorts set status = 'ingesting'
    where id = c.id and status = 'upload_pending';
  return jsonb_build_object('status', 'sanitization_pending', 'uploadId', s.upload_id,
    'jobId', j.id, 'analysisState', 'queued');
end $$;
revoke all on function private.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function private.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)
  to service_role;

-- The route's door, and deliberately nothing else: `security invoker`, as in
-- 20260921150000_embryo_ingest_chunk_public_doors.sql, so the inner EXECUTE
-- check stays the real barrier and this adds no privilege of its own.
create function public.complete_embryo_ingest_v1(
  p_account uuid, p_auth uuid, p_session uuid, p_cookie_hash text, p_origin text,
  p_cohort uuid, p_ingest_revision bigint, p_chunk_count integer, p_nonce text,
  p_test boolean default false
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.complete_embryo_ingest_v1(p_account, p_auth, p_session, p_cookie_hash,
    p_origin, p_cohort, p_ingest_revision, p_chunk_count, p_nonce, p_test);
$$;
revoke all on function public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.complete_embryo_ingest_v1(uuid,uuid,uuid,text,text,uuid,bigint,integer,text,boolean)
  to service_role;
