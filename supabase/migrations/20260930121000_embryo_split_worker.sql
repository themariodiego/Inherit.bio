-- The `split_cohort_vcf` worker's database half (register
-- `workerExecutionBindings.embryo-sanitization`, `policyResolvers.
-- embryo-ingest-session-v1.workerCompletion`). TEST-LOCAL only.
--
-- What this adds:
--   1. `private.embryo_split_config`, off by default. No claim runs unless an
--      operator enables it; production keeps it off with ingest.
--   2. Two worker-only, attempt-owned pending stores: per-embryo outcomes with
--      their QC measurements, and the validated genotype rows of embryos that
--      are still pending. Nothing reads them but these functions and the later
--      terminal publication; no product reader, route or export can.
--   3. Claim, check, renew, fragment read authority, stage, finish and fail
--      for this job kind only, following the own-preparation lease pattern: a
--      random claim token held only by the worker, a five-minute lease never
--      past the attempt's fixed deadline, exponential backoff for transient
--      failures and a terminal `retry-exhaustion` after the job's last attempt.
--
-- Where fragment bytes live is the fragment store's concern
-- (20260929100000_embryo_ingest_r2_fragments.sql). The worker names a
-- fragment by (session, sequence, ordinal); the read door below hands it only
-- the landed identity the store needs to read that exact version.
--
-- Every claim, check, stage and finish reruns
-- `private.embryo_ingest_binding_failure_v1` and recomputes the locked
-- manifest digest. A refusal marks the attempt `failure_pending` through
-- `private.mark_embryo_ingest_failure_v1`, ends the job and keeps the session,
-- due target, handles, fragments and every attempt-owned row for the one
-- cohort-wide unwind. Nothing here publishes, lifts quarantine, writes an
-- embryo, QC, variant or score row, or cancels the due phase.
--
-- QC thresholds live only in src/lib/embryos/qc-policy.ts. The database checks
-- that a reported outcome is internally consistent, never re-derives a band.

-- ---------------------------------------------------------------------------
-- 1. Stores
-- ---------------------------------------------------------------------------

create table private.embryo_split_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.embryo_split_config (singleton, enabled) values (true, false);

-- One terminal outcome per embryo ordinal for the live attempt. `passed`
-- keeps the embryo's validated rows pending; `qc_fail_no_source` keeps only a
-- closed reason and the measurements, never a genotype.
create table private.embryo_split_ordinals (
  session_id uuid not null references public.embryo_ingest_sessions (id) on delete restrict,
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  worker_job_id uuid not null references public.worker_jobs (id) on delete restrict,
  attempt smallint not null check (attempt between 1 and 20),
  outcome text not null check (outcome in ('passed', 'qc_fail_no_source')),
  qc_verdict text not null check (qc_verdict in ('pass', 'marginal', 'fail')),
  qc_reasons text[] not null check (qc_reasons <@ array[
    'embryo_call_rate', 'embryo_parent_discordant', 'contamination',
    'dropout_too_high', 'qc_review_required']::text[]),
  failure_reason text check (failure_reason in (
    'embryo_call_rate', 'embryo_parent_discordant', 'contamination',
    'dropout_too_high', 'qc_review_required')),
  sites_expected integer not null check (sites_expected between 1 and 10000000),
  sites_called integer not null check (sites_called >= 0 and sites_called <= sites_expected),
  call_rate double precision not null check (call_rate between 0 and 1),
  autosomal_het_rate double precision check (autosomal_het_rate between 0 and 1),
  mean_depth double precision check (mean_depth >= 0),
  variant_count integer not null check (variant_count between 0 and 10000000),
  source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (session_id, sample_ordinal),
  check (abs(call_rate - sites_called::double precision / sites_expected) < 1e-9),
  check ((outcome = 'qc_fail_no_source') = (qc_verdict = 'fail')),
  check ((outcome = 'qc_fail_no_source') = (failure_reason is not null)),
  check (failure_reason is null or failure_reason = 'qc_review_required'
    or failure_reason = any (qc_reasons)),
  check (outcome = 'qc_fail_no_source' or variant_count >= 1),
  check ((outcome = 'passed') = (source_sha256 is not null)),
  check (outcome = 'passed' or variant_count = 0)
);

-- Validated genotype rows of one embryo, from that embryo's own fragments
-- only. A genotype is made of called alleles present at the locus: a no-call,
-- a partial call or an allele the locus does not carry cannot be stored, so
-- nothing can be filled in from a parent, a sibling or a panel.
create table private.embryo_split_variants (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.embryo_ingest_sessions (id) on delete restrict,
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  worker_job_id uuid not null references public.worker_jobs (id) on delete restrict,
  attempt smallint not null check (attempt between 1 and 20),
  batch integer not null check (batch between 0 and 100000),
  chromosome smallint not null check (chromosome between 1 and 22),
  position integer not null check (position > 0),
  reference_allele text not null check (reference_allele ~ '^[ACGTN]+$' and length(reference_allele) <= 100000),
  alternate_allele text check (alternate_allele ~ '^[ACGTN]+(,[ACGTN]+)*$' and length(alternate_allele) <= 100000),
  genotype text not null check (genotype ~ '^[ACGTN]+(/[ACGTN]+)*$' and length(genotype) <= 200001)
);
create index embryo_split_variants_ordinal_idx
  on private.embryo_split_variants (session_id, sample_ordinal, batch);

alter table private.embryo_split_config enable row level security;
alter table private.embryo_split_ordinals enable row level security;
alter table private.embryo_split_variants enable row level security;
revoke all on private.embryo_split_config, private.embryo_split_ordinals, private.embryo_split_variants
  from public, anon, authenticated, inherit_upload_only, service_role;

-- Both stores are attempt-owned prepublication state: the one cohort-wide
-- unwind (and the pre-publication purge class, which includes both targets)
-- must delete them. Provisional QC outcomes sit with embryo QC, genotype rows
-- with the other variant stores.
insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'embryo-qc', 'private.embryo_split_ordinals', coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'embryo-qc';
insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'variant-rows', 'private.embryo_split_variants', coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'variant-rows';

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (no service grant)
-- ---------------------------------------------------------------------------

-- The composed source digest of one embryo: its fragments' recorded digests
-- and sizes in chunk order. The worker proves each fragment's bytes match its
-- digest before parsing; this binds the pending embryo to exactly those bytes.
create function private.embryo_split_source_sha256_v1(p_session_id uuid, p_ordinal integer)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(
    private.length_prefix_utf8('embryo-split-source-v1')
    || private.length_prefix_utf8(p_session_id::text)
    || private.length_prefix_utf8(p_ordinal::text)
    || coalesce(string_agg(
      private.length_prefix_utf8(f.sequence::text)
      || private.length_prefix_utf8(f.content_sha256)
      || private.length_prefix_utf8(f.byte_count::text), ''::bytea order by f.sequence), ''::bytea),
    'sha256'), 'hex')
  from public.embryo_ingest_fragments f
  where f.session_id = p_session_id and f.sample_ordinal = p_ordinal;
$$;

-- End the job for good. The claim columns clear with `running`.
create function private.end_embryo_split_job_v1(p_job_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('failed', 'cancelled') then
    raise exception using errcode = '22023', message = 'invalid split job status';
  end if;
  update public.worker_jobs
    set status = p_status, finished_at = clock_timestamp(), claim_token_hash = null,
      claim_expires_at = null, claimed_by = null, progress_note = null
    where id = p_job_id and kind = 'split_cohort_vcf' and status in ('queued', 'running');
end $$;

-- A terminal attempt failure: the durable marker plus the ended job. Never
-- the unwind, never a delete.
create function private.fail_embryo_split_v1(p_session_id uuid, p_job_id uuid, p_code text, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.embryo_ingest_sessions%rowtype;
begin
  perform private.mark_embryo_ingest_failure_v1(p_session_id, p_code);
  perform private.end_embryo_split_job_v1(p_job_id, p_status);
  select * into strict s from public.embryo_ingest_sessions where id = p_session_id;
  return jsonb_build_object('status', 'failure_pending', 'cohortId', s.cohort_id,
    'ingestRevision', s.ingest_revision, 'failureCode', s.failure_code);
end $$;

create function private.embryo_split_claim_receipt_v1(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', 'embryo-split-claim-v1', 'jobId', w.id,
    'attempt', w.attempts, 'claimExpiresAt', w.claim_expires_at, 'deadline', s.expires_at,
    'sessionId', s.id, 'cohortId', s.cohort_id, 'format', s.source_format,
    'build', s.reference_build, 'embryoCount', c.embryo_count,
    'manifestSha256', s.manifest_sha256,
    -- Fragments are named by (session, sequence, ordinal) only. Where the
    -- bytes live is the fragment store's concern, not the worker's.
    'fragments', (select coalesce(jsonb_agg(jsonb_build_object('ordinal', f.sample_ordinal,
        'sequence', f.sequence, 'byteCount', f.byte_count, 'sha256', f.content_sha256,
        'lineCount', f.line_count)
        order by f.sample_ordinal, f.sequence), '[]'::jsonb)
      from public.embryo_ingest_fragments f where f.session_id = s.id))
  from public.worker_jobs w
  join public.embryo_ingest_sessions s on s.id = w.source_binding_id
  join public.embryo_cohorts c on c.id = s.cohort_id
  where w.id = p_job_id;
$$;

-- What a check or renewal answers: the lease, never the fragment list.
create function private.embryo_split_lease_receipt_v1(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', 'embryo-split-lease-v1', 'jobId', w.id,
    'attempt', w.attempts, 'claimExpiresAt', w.claim_expires_at, 'deadline', s.expires_at,
    'sessionId', s.id, 'manifestSha256', s.manifest_sha256)
  from public.worker_jobs w
  join public.embryo_ingest_sessions s on s.id = w.source_binding_id
  where w.id = p_job_id;
$$;

-- Everything a claim must still hold, rechecked with the session locked:
-- the attempt is live and bound to this job, the authority is unchanged and
-- the manifest reproduces. Returns a failure receipt (already marked) or null.
create function private.recheck_embryo_split_binding_v1(p_session_id uuid, p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.embryo_ingest_sessions%rowtype; w public.worker_jobs%rowtype; v_failure text;
begin
  select * into strict s from public.embryo_ingest_sessions where id = p_session_id;
  select * into strict w from public.worker_jobs where id = p_job_id;
  v_failure := private.embryo_ingest_binding_failure_v1(s.id);
  if v_failure is not null then
    return private.fail_embryo_split_v1(s.id, w.id, v_failure, 'cancelled');
  end if;
  if s.manifest_sha256 is null or s.manifest_sha256 is distinct from w.file_sha256
    or private.embryo_ingest_manifest_sha256_v1(s.id) is distinct from s.manifest_sha256 then
    return private.fail_embryo_split_v1(s.id, w.id, 'stale-binding', 'cancelled');
  end if;
  return null;
end $$;

revoke all on function private.embryo_split_source_sha256_v1(uuid, integer),
  private.end_embryo_split_job_v1(uuid, text),
  private.fail_embryo_split_v1(uuid, uuid, text, text),
  private.embryo_split_claim_receipt_v1(uuid),
  private.embryo_split_lease_receipt_v1(uuid),
  private.recheck_embryo_split_binding_v1(uuid, uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 3. The claim and its lease
-- ---------------------------------------------------------------------------

-- Claim the oldest eligible `split_cohort_vcf` job: queued and due, or a
-- running job whose lease lapsed at least the backoff ago. The session is
-- locked before the job, as every other ingest writer locks it. Stale work
-- found on the way is terminalized, never skipped silently. A new attempt
-- starts empty: an earlier attempt's pending rows are discarded here.
create function private.claim_embryo_split_job_v1(p_claim_token_hash text, p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  candidate record;
  s public.embryo_ingest_sessions%rowtype;
  w public.worker_jobs%rowtype;
  v_now timestamptz;
  v_failed jsonb;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$'
    or p_worker_id is null or p_worker_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception using errcode = '22023', message = 'invalid split claim';
  end if;
  if not exists (select 1 from private.embryo_split_config where singleton and enabled for share) then
    raise exception using errcode = '55000', message = 'embryo split disabled';
  end if;
  for candidate in select w0.id, w0.source_binding_id from public.worker_jobs w0
    where w0.kind = 'split_cohort_vcf' and (
      (w0.status = 'queued' and w0.not_before <= clock_timestamp())
      or (w0.status = 'running' and w0.claim_expires_at
        + make_interval(secs => 30 * power(2, w0.attempts)::integer) <= clock_timestamp()))
    order by w0.created_at, w0.id limit 5
  loop
    select * into s from public.embryo_ingest_sessions where id = candidate.source_binding_id
      for update skip locked;
    if not found then continue; end if;
    select * into w from public.worker_jobs where id = candidate.id for update skip locked;
    if not found then continue; end if;
    v_now := clock_timestamp();
    if w.kind <> 'split_cohort_vcf' or not (
      (w.status = 'queued' and w.not_before <= v_now)
      or (w.status = 'running' and w.claim_expires_at
        + make_interval(secs => 30 * power(2, w.attempts)::integer) <= v_now)) then
      continue;
    end if;
    if s.worker_job_id is distinct from w.id then
      -- A job no attempt is bound to has no authority to run.
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if s.status = 'failure_pending' then
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if s.status not in ('sanitization_pending', 'processing') then
      perform private.end_embryo_split_job_v1(w.id, 'cancelled');
      continue;
    end if;
    if w.attempts >= w.max_attempts then
      perform private.fail_embryo_split_v1(s.id, w.id, 'retry-exhaustion', 'failed');
      continue;
    end if;
    v_failed := private.recheck_embryo_split_binding_v1(s.id, w.id);
    if v_failed is not null then continue; end if;
    if s.source_format is distinct from 'vcf' then
      -- Only the VCF configure path is registered (ADR 0035); a table or gVCF
      -- attempt has no fragment reader yet and ends with a closed code.
      perform private.fail_embryo_split_v1(s.id, w.id, 'format', 'failed');
      continue;
    end if;
    delete from private.embryo_split_variants where session_id = s.id;
    delete from private.embryo_split_ordinals where session_id = s.id;
    update public.worker_jobs
      set status = 'running', attempts = attempts + 1, claim_token_hash = p_claim_token_hash,
        claim_expires_at = least(v_now + interval '5 minutes', s.expires_at),
        claimed_by = p_worker_id, started_at = coalesce(started_at, v_now),
        progress_note = 'splitting'
      where id = w.id;
    update public.embryo_ingest_sessions set status = 'processing'
      where id = s.id and status = 'sanitization_pending';
    return private.embryo_split_claim_receipt_v1(w.id);
  end loop;
  return null;
end $$;

-- The live claim, locked in the claim's order. A lost or foreign claim is
-- 42501 with nothing written. A stale binding is marked and ended, and its
-- failure receipt is returned so the caller commits it and stops.
create function private.lock_embryo_split_claim_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.embryo_ingest_sessions%rowtype; w public.worker_jobs%rowtype; v_failed jsonb;
begin
  if not exists (select 1 from private.embryo_split_config where singleton and enabled for share) then
    raise exception using errcode = '55000', message = 'embryo split disabled';
  end if;
  if p_job_id is null or p_attempt is null or p_claim_token_hash is null
    or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'split claim unavailable';
  end if;
  select * into w from public.worker_jobs where id = p_job_id and kind = 'split_cohort_vcf';
  if not found then raise exception using errcode = '42501', message = 'split claim unavailable'; end if;
  select * into s from public.embryo_ingest_sessions where id = w.source_binding_id for update;
  if not found then raise exception using errcode = '42501', message = 'split claim unavailable'; end if;
  select * into w from public.worker_jobs where id = p_job_id for update;
  if w.status <> 'running' or w.claim_token_hash is distinct from p_claim_token_hash
    or w.attempts <> p_attempt or s.worker_job_id is distinct from w.id then
    raise exception using errcode = '42501', message = 'split claim unavailable';
  end if;
  if s.status = 'failure_pending' then
    -- Another writer already failed the attempt: end this job with it.
    perform private.end_embryo_split_job_v1(w.id, 'cancelled');
    return jsonb_build_object('status', 'failure_pending', 'cohortId', s.cohort_id,
      'ingestRevision', s.ingest_revision, 'failureCode', s.failure_code);
  end if;
  if w.claim_expires_at <= clock_timestamp() or s.status <> 'processing' then
    raise exception using errcode = '42501', message = 'split claim unavailable';
  end if;
  v_failed := private.recheck_embryo_split_binding_v1(s.id, w.id);
  if v_failed is not null then return v_failed; end if;
  return null;
end $$;

create function private.check_embryo_split_claim_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  return private.embryo_split_lease_receipt_v1(p_job_id);
end $$;

-- The read authority for one fragment, established under the live claim
-- immediately before the worker reads it: the claim and binding are
-- rechecked, and the fragment's write intent must still be `landed`. The
-- answer names the fragment by (session, sequence, ordinal) and carries only
-- its landed identity: for R2 the exact receipt, provider version and ETag
-- `readEmbryoFragment` requires; for the test-only Supabase backend nothing
-- beyond the backend, since no production reader exists for it.
create function private.read_embryo_split_fragment_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_sequence integer
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; w public.worker_jobs%rowtype; f public.embryo_ingest_fragments%rowtype;
  i private.embryo_ingest_write_intents%rowtype;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into f from public.embryo_ingest_fragments
    where session_id = w.source_binding_id and sequence = p_sequence and sample_ordinal = p_ordinal;
  if not found then raise exception using errcode = '22023', message = 'invalid split fragment'; end if;
  select * into i from private.embryo_ingest_write_intents
    where session_id = f.session_id and sequence = f.sequence and sample_ordinal = f.sample_ordinal for share;
  if not found or i.state <> 'landed' or i.byte_count <> f.byte_count or i.sha256 <> f.content_sha256 then
    -- The landing record the manifest was locked on is gone or changed.
    return private.fail_embryo_split_v1(f.session_id, w.id, 'chunk', 'failed');
  end if;
  return jsonb_build_object('version', 'embryo-split-fragment-v1', 'sessionId', f.session_id,
    'ordinal', f.sample_ordinal, 'sequence', f.sequence, 'byteCount', f.byte_count,
    'sha256', f.content_sha256, 'landed', case i.backend
      when 'r2' then jsonb_build_object('backend', 'r2', 'stored', jsonb_build_object(
        'receipt', private.embryo_ingest_write_target_v1(i),
        'providerVersion', i.provider_version, 'etag', i.provider_etag))
      else jsonb_build_object('backend', i.backend) end);
end $$;

create function private.renew_embryo_split_claim_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  update public.worker_jobs w
    set claim_expires_at = least(clock_timestamp() + interval '5 minutes', s.expires_at)
    from public.embryo_ingest_sessions s
    where w.id = p_job_id and s.id = w.source_binding_id;
  return private.embryo_split_lease_receipt_v1(p_job_id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Per-embryo pending writes
-- ---------------------------------------------------------------------------

-- Stage one bounded batch of one embryo's validated rows, in order. Each row
-- is [chromosome, position, reference, alternate or null, genotype]. The
-- genotype may use only the locus's own alleles; anything else is refused.
create function private.stage_embryo_split_variants_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text,
  p_ordinal integer, p_batch integer, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; w public.worker_jobs%rowtype; s public.embryo_ingest_sessions%rowtype;
  v_count integer; v_next integer; v_inserted integer;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select embryo_count into strict v_count from public.embryo_cohorts where id = s.cohort_id;
  if p_ordinal is null or p_ordinal < 0 or p_ordinal >= v_count
    or exists (select 1 from private.embryo_split_ordinals o
      where o.session_id = s.id and o.sample_ordinal = p_ordinal) then
    raise exception using errcode = '22023', message = 'invalid split batch';
  end if;
  select coalesce(max(v.batch) + 1, 0) into v_next from private.embryo_split_variants v
    where v.session_id = s.id and v.sample_ordinal = p_ordinal;
  if p_batch is distinct from v_next or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
    or exists (select 1 from jsonb_array_elements(p_rows) r(value) where
      jsonb_typeof(r.value) is distinct from 'array' or jsonb_array_length(r.value) <> 5
      or jsonb_typeof(r.value->0) is distinct from 'number' or (r.value->>0) !~ '^([1-9]|1[0-9]|2[0-2])$'
      or jsonb_typeof(r.value->1) is distinct from 'number' or (r.value->>1) !~ '^[1-9][0-9]{0,9}$'
      or (r.value->>1)::bigint > 2147483647
      or jsonb_typeof(r.value->2) is distinct from 'string' or (r.value->>2) !~ '^[ACGTN]+$'
      or (jsonb_typeof(r.value->3) is distinct from 'null'
        and (jsonb_typeof(r.value->3) is distinct from 'string' or (r.value->>3) !~ '^[ACGTN]+(,[ACGTN]+)*$'))
      or jsonb_typeof(r.value->4) is distinct from 'string' or (r.value->>4) !~ '^[ACGTN]+(/[ACGTN]+)*$'
      or not (string_to_array(r.value->>4, '/') <@
        (array[r.value->>2] || coalesce(string_to_array(r.value->>3, ','), '{}'::text[])))) then
    raise exception using errcode = '22023', message = 'invalid split batch';
  end if;
  insert into private.embryo_split_variants (session_id, sample_ordinal, worker_job_id, attempt,
    batch, chromosome, position, reference_allele, alternate_allele, genotype)
  select s.id, p_ordinal, w.id, w.attempts, p_batch, (r.value->>0)::smallint, (r.value->>1)::integer,
    r.value->>2, r.value->>3, r.value->>4
  from jsonb_array_elements(p_rows) with ordinality r(value, n) order by r.n;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('status', 'staged', 'batch', p_batch, 'rows', v_inserted);
end $$;

-- Record one embryo's terminal outcome in its own transaction. A QC failure
-- deletes only this embryo's staged rows and keeps the closed reason; a pass
-- requires exactly the rows it staged and binds them to its fragment digests.
-- The result object is closed: outcome, qc, failureReason, variantCount.
create function private.finish_embryo_split_ordinal_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; w public.worker_jobs%rowtype; s public.embryo_ingest_sessions%rowtype;
  v_count integer; q jsonb; v_outcome text; v_staged integer; v_done integer;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select embryo_count into strict v_count from public.embryo_cohorts where id = s.cohort_id;
  q := p_result->'qc';
  v_outcome := p_result->>'outcome';
  if p_ordinal is null or p_ordinal < 0 or p_ordinal >= v_count
    or exists (select 1 from private.embryo_split_ordinals o
      where o.session_id = s.id and o.sample_ordinal = p_ordinal)
    or jsonb_typeof(p_result) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_result) k)
      is distinct from array['failureReason', 'outcome', 'qc', 'variantCount']
    or v_outcome is null or v_outcome not in ('passed', 'qc_fail_no_source')
    or jsonb_typeof(q) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(q) k)
      is distinct from array['autosomal_het_rate', 'call_rate', 'mean_depth', 'qc_reasons',
        'qc_verdict', 'sites_called', 'sites_expected']
    or jsonb_typeof(q->'sites_expected') is distinct from 'number'
    or jsonb_typeof(q->'sites_called') is distinct from 'number'
    or jsonb_typeof(q->'call_rate') is distinct from 'number'
    or jsonb_typeof(q->'autosomal_het_rate') not in ('number', 'null')
    or jsonb_typeof(q->'mean_depth') not in ('number', 'null')
    or jsonb_typeof(q->'qc_verdict') is distinct from 'string'
    or jsonb_typeof(q->'qc_reasons') is distinct from 'array'
    or exists (select 1 from jsonb_array_elements(q->'qc_reasons') e where jsonb_typeof(e) <> 'string')
    or jsonb_typeof(p_result->'variantCount') is distinct from 'number'
    or (p_result->>'variantCount') !~ '^(0|[1-9][0-9]{0,7})$'
    or (q->>'sites_expected') !~ '^[1-9][0-9]{0,7}$' or (q->>'sites_called') !~ '^(0|[1-9][0-9]{0,7})$'
    or jsonb_typeof(p_result->'failureReason') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'invalid split outcome';
  end if;
  if v_outcome = 'qc_fail_no_source' then
    delete from private.embryo_split_variants where session_id = s.id and sample_ordinal = p_ordinal;
  else
    select count(*) into v_staged from private.embryo_split_variants
      where session_id = s.id and sample_ordinal = p_ordinal
        and worker_job_id = w.id and attempt = w.attempts;
    if v_staged <> (p_result->>'variantCount')::integer or v_staged <> (
      select count(*) from private.embryo_split_variants
        where session_id = s.id and sample_ordinal = p_ordinal) then
      raise exception using errcode = '22023', message = 'invalid split outcome';
    end if;
  end if;
  begin
    insert into private.embryo_split_ordinals (session_id, sample_ordinal, worker_job_id, attempt,
      outcome, qc_verdict, qc_reasons, failure_reason, sites_expected, sites_called, call_rate,
      autosomal_het_rate, mean_depth, variant_count, source_sha256)
    values (s.id, p_ordinal, w.id, w.attempts, v_outcome, q->>'qc_verdict',
      array(select jsonb_array_elements_text(q->'qc_reasons')), p_result->>'failureReason',
      (q->>'sites_expected')::integer, (q->>'sites_called')::integer, (q->>'call_rate')::double precision,
      (q->>'autosomal_het_rate')::double precision, (q->>'mean_depth')::double precision,
      case when v_outcome = 'passed' then (p_result->>'variantCount')::integer else 0 end,
      case when v_outcome = 'passed' then private.embryo_split_source_sha256_v1(s.id, p_ordinal) end);
  exception when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid split outcome';
  end;
  select count(*) into v_done from private.embryo_split_ordinals where session_id = s.id;
  return jsonb_build_object('status', 'recorded', 'ordinal', p_ordinal, 'outcome', v_outcome,
    'remaining', v_count - v_done);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Failure reports
-- ---------------------------------------------------------------------------

-- The worker reports a non-QC failure of its own attempt. `transient` (a read
-- or transport error) returns the job to the queue after 30 s x 2^attempts,
-- or ends the attempt as `retry-exhaustion` after its last try. `format`,
-- `build` and `chunk` (a fragment that no longer validates, names another
-- build or does not match its digest) are terminal at once. A lapsed lease
-- may still report; a claim another attempt has taken may not.
create function private.fail_embryo_split_attempt_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare s public.embryo_ingest_sessions%rowtype; w public.worker_jobs%rowtype;
begin
  if p_reason is null or p_reason not in ('transient', 'format', 'build', 'chunk') then
    raise exception using errcode = '22023', message = 'invalid split failure';
  end if;
  select * into w from public.worker_jobs where id = p_job_id and kind = 'split_cohort_vcf';
  if not found then raise exception using errcode = '42501', message = 'split claim unavailable'; end if;
  select * into s from public.embryo_ingest_sessions where id = w.source_binding_id for update;
  select * into w from public.worker_jobs where id = p_job_id for update;
  if s.id is null or w.status <> 'running' or w.claim_token_hash is distinct from p_claim_token_hash
    or w.attempts is distinct from p_attempt or s.worker_job_id is distinct from w.id then
    raise exception using errcode = '42501', message = 'split claim unavailable';
  end if;
  if s.status = 'failure_pending' then
    perform private.end_embryo_split_job_v1(w.id, 'cancelled');
    return jsonb_build_object('status', 'failure_pending', 'cohortId', s.cohort_id,
      'ingestRevision', s.ingest_revision, 'failureCode', s.failure_code);
  end if;
  if p_reason <> 'transient' then
    return private.fail_embryo_split_v1(s.id, w.id, p_reason, 'failed');
  end if;
  if w.attempts >= w.max_attempts then
    return private.fail_embryo_split_v1(s.id, w.id, 'retry-exhaustion', 'failed');
  end if;
  update public.worker_jobs
    set status = 'queued', claim_token_hash = null, claim_expires_at = null, claimed_by = null,
      not_before = clock_timestamp() + make_interval(secs => 30 * power(2, attempts)::integer),
      progress_note = 'retrying'
    where id = w.id;
  return jsonb_build_object('status', 'queued');
end $$;

revoke all on function private.claim_embryo_split_job_v1(text, text),
  private.lock_embryo_split_claim_v1(uuid, integer, text),
  private.check_embryo_split_claim_v1(uuid, integer, text),
  private.read_embryo_split_fragment_v1(uuid, integer, text, integer, integer),
  private.renew_embryo_split_claim_v1(uuid, integer, text),
  private.stage_embryo_split_variants_v1(uuid, integer, text, integer, integer, jsonb),
  private.finish_embryo_split_ordinal_v1(uuid, integer, text, integer, jsonb),
  private.fail_embryo_split_attempt_v1(uuid, integer, text, text)
  from public, anon, authenticated, inherit_upload_only, service_role;
grant execute on function private.claim_embryo_split_job_v1(text, text),
  private.check_embryo_split_claim_v1(uuid, integer, text),
  private.read_embryo_split_fragment_v1(uuid, integer, text, integer, integer),
  private.renew_embryo_split_claim_v1(uuid, integer, text),
  private.stage_embryo_split_variants_v1(uuid, integer, text, integer, integer, jsonb),
  private.finish_embryo_split_ordinal_v1(uuid, integer, text, integer, jsonb),
  private.fail_embryo_split_attempt_v1(uuid, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Doors for the operator-started worker (service role only, invoker)
-- ---------------------------------------------------------------------------

create function public.claim_embryo_split_job_v1(p_claim_token_hash text, p_worker_id text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_embryo_split_job_v1(p_claim_token_hash, p_worker_id);
$$;
create function public.check_embryo_split_claim_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.check_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
$$;
create function public.read_embryo_split_fragment_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_sequence integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.read_embryo_split_fragment_v1(p_job_id, p_attempt, p_claim_token_hash, p_ordinal, p_sequence);
$$;
create function public.renew_embryo_split_claim_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.renew_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
$$;
create function public.stage_embryo_split_variants_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_batch integer, p_rows jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.stage_embryo_split_variants_v1(p_job_id, p_attempt, p_claim_token_hash, p_ordinal, p_batch, p_rows);
$$;
create function public.finish_embryo_split_ordinal_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_result jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.finish_embryo_split_ordinal_v1(p_job_id, p_attempt, p_claim_token_hash, p_ordinal, p_result);
$$;
create function public.fail_embryo_split_attempt_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_reason text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.fail_embryo_split_attempt_v1(p_job_id, p_attempt, p_claim_token_hash, p_reason);
$$;
revoke all on function public.claim_embryo_split_job_v1(text, text),
  public.check_embryo_split_claim_v1(uuid, integer, text),
  public.read_embryo_split_fragment_v1(uuid, integer, text, integer, integer),
  public.renew_embryo_split_claim_v1(uuid, integer, text),
  public.stage_embryo_split_variants_v1(uuid, integer, text, integer, integer, jsonb),
  public.finish_embryo_split_ordinal_v1(uuid, integer, text, integer, jsonb),
  public.fail_embryo_split_attempt_v1(uuid, integer, text, text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.claim_embryo_split_job_v1(text, text),
  public.check_embryo_split_claim_v1(uuid, integer, text),
  public.read_embryo_split_fragment_v1(uuid, integer, text, integer, integer),
  public.renew_embryo_split_claim_v1(uuid, integer, text),
  public.stage_embryo_split_variants_v1(uuid, integer, text, integer, integer, jsonb),
  public.finish_embryo_split_ordinal_v1(uuid, integer, text, integer, jsonb),
  public.fail_embryo_split_attempt_v1(uuid, integer, text, text)
  to service_role;
