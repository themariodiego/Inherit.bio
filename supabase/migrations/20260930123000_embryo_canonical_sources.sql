-- Per-embryo canonical sources for `split_cohort_vcf` (register
-- `policyResolvers.embryo-ingest-session-v1.workerCompletion`,
-- `policyContracts.canonical-source-publication-v1`). TEST-LOCAL only;
-- `EMBRYO_INGEST_AVAILABLE` stays false and `private.embryo_split_config`
-- stays off.
--
-- Each embryo that passes QC gets exactly one canonical source: its own
-- sanitized single-embryo fragments, copied byte for byte into new R2 objects
-- the worker writes create-only through the fragment gateway, the way the
-- own-preparation backend writes its artifacts:
--   * before each write, `reserve_embryo_canonical_part_v1` registers the
--     part's identity (a fresh `embryo/<uuid>` key, and the exact size and
--     SHA-256 of the fragment it copies) under the live claim;
--   * the transport writes, reads the version back to EOF and hashes it, and
--     only then `ack_embryo_canonical_part_v1` lands the part with the
--     observed identity, under the live claim again;
--   * an embryo can be recorded as passed only when every one of its fragments
--     has exactly one landed part of this attempt; an embryo that fails QC
--     can have none, so no object is ever written for it.
-- The terminal publication then binds each passing embryo's exact landed
-- parts into one immutable canonical source and one `genome_files` row, bound
-- to that embryo's own composed digest, marks it `normalization_complete` and
-- points the embryo's published genotypes at it. Nothing is written for a QC
-- failure. Nothing exists before that commit, so nothing is visible early.
--
-- The composed digest is the one `private.embryo_split_source_sha256_v1`
-- computes over the fragments. The parts are byte-identical to the fragments
-- (same size and SHA-256), so recomputing it over the bound parts gives the
-- same value, and it survives the fragments' later deletion.
--
-- The owner's generic RLS read of `genome_files` (Files list, downloads)
-- no longer returns an embryo-subject or cohort row. It cannot check a
-- cohort's publication revision, so an embryo source stays opaque to it; the
-- server-mediated embryo reads are not built.
--
-- Deliberately not here, and still required before activation:
--   * canonical parts in the unwind inventory, and disposal (tombstoning) of
--     parts an abandoned or failed attempt wrote. Parts are never deleted by
--     this code; they hold `on delete restrict` references to the session and
--     the job, so the terminal graph deletion cannot remove either while a
--     part is unresolved;
--   * source deletion at the retention deadline, at restriction and in the
--     terminal purge (the three stores are registered for purge below);
--   * the authoritative retention date, card dates, addenda and rights
--     notices (unit 4b), and the post-publication fragment cleanup.

-- ---------------------------------------------------------------------------
-- 1. Stores
-- ---------------------------------------------------------------------------

-- Every canonical part an attempt reserved, landed or not. A row is the only
-- record that an object may exist under its key, so it outlives the attempt.
create table private.embryo_canonical_parts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.embryo_ingest_sessions (id) on delete restrict,
  worker_job_id uuid not null references public.worker_jobs (id) on delete restrict,
  attempt smallint not null check (attempt between 1 and 20),
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  sequence smallint not null check (sequence between 0 and 49),
  provider_bucket text not null check (provider_bucket ~ '^inherit-embryo-[a-z0-9-]{1,40}$'),
  provider_key text not null
    check (provider_key ~ '^embryo/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  byte_count integer not null check (byte_count between 1 and 4004096),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'open' check (state in ('open', 'landed')),
  created_at timestamptz not null,
  write_expires_at timestamptz not null,
  provider_version text check (provider_version ~ '^[0-9a-f]{32}$'),
  provider_etag text check (provider_etag ~ '^[0-9a-f]{32}$'),
  observed_sha256 text check (observed_sha256 ~ '^[0-9a-f]{64}$'),
  landed_at timestamptz,
  unique (provider_bucket, provider_key),
  unique (worker_job_id, attempt, sample_ordinal, sequence),
  check (write_expires_at > created_at),
  check ((state = 'landed') = (provider_version is not null)),
  check ((state = 'landed') = (provider_etag is not null)),
  check ((state = 'landed') = (landed_at is not null)),
  check ((state = 'landed') = (observed_sha256 is not null)),
  check (observed_sha256 is null or observed_sha256 = sha256),
  check (landed_at is null or (landed_at >= created_at and landed_at < write_expires_at))
);
create index embryo_canonical_parts_session_idx
  on private.embryo_canonical_parts (session_id, sample_ordinal, sequence);

-- One published canonical source per passing embryo.
create table private.embryo_canonical_sources (
  file_id uuid primary key references public.genome_files (id) on delete restrict,
  embryo_id uuid not null unique references public.embryos (id) on delete restrict,
  subject_id uuid not null unique,
  cohort_id uuid not null,
  sample_ordinal smallint not null check (sample_ordinal between 0 and 63),
  session_id uuid not null,
  worker_job_id uuid not null,
  attempt smallint not null check (attempt between 1 and 20),
  publication_revision bigint not null check (publication_revision > 0),
  reference_build text not null check (reference_build in ('GRCh37', 'GRCh38')),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  membership_sha256 text not null check (membership_sha256 ~ '^[0-9a-f]{64}$'),
  part_count smallint not null check (part_count between 1 and 50),
  byte_count bigint not null check (byte_count > 0),
  variant_count integer not null check (variant_count between 1 and 10000000),
  published_at timestamptz not null,
  unique (cohort_id, sample_ordinal)
);

-- Its exact parts, one per fragment sequence.
create table private.embryo_canonical_source_parts (
  file_id uuid not null references private.embryo_canonical_sources (file_id) on delete restrict,
  part_id uuid not null unique references private.embryo_canonical_parts (id) on delete restrict,
  sequence smallint not null check (sequence between 0 and 49),
  primary key (file_id, sequence)
);

alter table private.embryo_canonical_parts enable row level security;
alter table private.embryo_canonical_sources enable row level security;
alter table private.embryo_canonical_source_parts enable row level security;
revoke all on private.embryo_canonical_parts, private.embryo_canonical_sources,
  private.embryo_canonical_source_parts
  from public, anon, authenticated, inherit_upload_only, service_role;

-- A published source's own genotype rows are found through its file.
create index embryo_variants_source_file_idx on public.embryo_variants (source_file_id);

-- All three belong with the other canonical-source and variant stores.
insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'variant-rows', 'private.embryo_canonical_source_parts', coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'variant-rows';
insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'variant-rows', 'private.embryo_canonical_sources', coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'variant-rows';
insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'variant-rows', 'private.embryo_canonical_parts', coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'variant-rows';

-- A part only ever lands, once, keeping its identity. A published source and
-- its membership never change.
create function private.guard_embryo_canonical_part_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (old.state = 'open' and new.state = 'landed'
    and (new.id, new.session_id, new.worker_job_id, new.attempt, new.sample_ordinal, new.sequence,
      new.provider_bucket, new.provider_key, new.byte_count, new.sha256, new.created_at, new.write_expires_at)
    is not distinct from (old.id, old.session_id, old.worker_job_id, old.attempt, old.sample_ordinal, old.sequence,
      old.provider_bucket, old.provider_key, old.byte_count, old.sha256, old.created_at, old.write_expires_at)) then
    raise exception using errcode = '55000', message = 'embryo canonical part immutable';
  end if;
  return new;
end $$;
create trigger embryo_canonical_part_immutable before update on private.embryo_canonical_parts
  for each row execute function private.guard_embryo_canonical_part_v1();

create function private.freeze_embryo_canonical_source_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'embryo canonical source immutable';
end $$;
create trigger embryo_canonical_source_immutable before update on private.embryo_canonical_sources
  for each row execute function private.freeze_embryo_canonical_source_v1();
create trigger embryo_canonical_source_part_immutable before update on private.embryo_canonical_source_parts
  for each row execute function private.freeze_embryo_canonical_source_v1();

-- ---------------------------------------------------------------------------
-- 2. Receipts and digests
-- ---------------------------------------------------------------------------

-- The exact write receipt a part is reserved with. It has the fragment store's
-- R2 target shape, so the one transport writes both; the ACK door differs.
create function private.embryo_canonical_part_target_v1(p private.embryo_canonical_parts)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('version', 'embryo-ingest-write-target-v1', 'sessionId', p.session_id,
    'sequence', p.sequence, 'ordinal', p.sample_ordinal, 'backend', 'r2', 'bucket', p.provider_bucket,
    'objectKey', p.provider_key, 'byteCount', p.byte_count, 'sha256', p.sha256,
    'writeExpiresAt', p.write_expires_at);
$$;

-- A canonical source's composed digest, recomputed from its bound parts. It is
-- `private.embryo_split_source_sha256_v1`'s composition, so it equals the
-- digest the embryo's genotypes were bound to when its fragments were locked.
create function private.embryo_canonical_source_sha256_v1(p_file_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(
    private.length_prefix_utf8('embryo-split-source-v1')
    || private.length_prefix_utf8(c.session_id::text)
    || private.length_prefix_utf8(c.sample_ordinal::text)
    || coalesce((select string_agg(
        private.length_prefix_utf8(p.sequence::text)
        || private.length_prefix_utf8(p.sha256)
        || private.length_prefix_utf8(p.byte_count::text), ''::bytea order by p.sequence)
      from private.embryo_canonical_source_parts m
      join private.embryo_canonical_parts p on p.id = m.part_id
      where m.file_id = c.file_id), ''::bytea),
    'sha256'), 'hex')
  from private.embryo_canonical_sources c where c.file_id = p_file_id;
$$;

-- The exact landed identities a source binds: key, provider version and ETag
-- included, so a replaced object is a different membership.
create function private.embryo_canonical_membership_sha256_v1(p_part_ids uuid[])
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_array(p.id, p.session_id,
      p.worker_job_id, p.attempt, p.sample_ordinal, p.sequence, p.provider_bucket, p.provider_key,
      p.provider_version, p.provider_etag, p.byte_count, p.sha256) order by p.sequence, p.id),
    '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  from private.embryo_canonical_parts p where p.id = any (p_part_ids);
$$;

revoke all on function private.guard_embryo_canonical_part_v1(),
  private.freeze_embryo_canonical_source_v1(),
  private.embryo_canonical_part_target_v1(private.embryo_canonical_parts),
  private.embryo_canonical_source_sha256_v1(uuid),
  private.embryo_canonical_membership_sha256_v1(uuid[])
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 3. Reserve and land, under the live claim
-- ---------------------------------------------------------------------------

-- Reserve one part: a copy of fragment (sequence, ordinal) of this attempt's
-- session, for an embryo with no recorded outcome yet. The claim and binding
-- are rechecked first, and the fragment must still be landed as locked. One
-- reservation per fragment per attempt; a new attempt reserves new keys.
create function private.reserve_embryo_canonical_part_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_sequence integer
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; w public.worker_jobs%rowtype; s public.embryo_ingest_sessions%rowtype;
  f public.embryo_ingest_fragments%rowtype; i private.embryo_ingest_write_intents%rowtype;
  p private.embryo_canonical_parts%rowtype; v_bucket text; v_key text; v_now timestamptz;
begin
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select * into f from public.embryo_ingest_fragments
    where session_id = s.id and sequence = p_sequence and sample_ordinal = p_ordinal;
  if not found
    or exists (select 1 from private.embryo_split_ordinals o
      where o.session_id = s.id and o.sample_ordinal = p_ordinal)
    or exists (select 1 from private.embryo_canonical_parts x where x.worker_job_id = w.id
      and x.attempt = w.attempts and x.sample_ordinal = p_ordinal and x.sequence = p_sequence) then
    raise exception using errcode = '22023', message = 'invalid canonical part';
  end if;
  select * into i from private.embryo_ingest_write_intents
    where session_id = f.session_id and sequence = f.sequence and sample_ordinal = f.sample_ordinal for share;
  if not found or i.state <> 'landed' or i.byte_count <> f.byte_count or i.sha256 <> f.content_sha256 then
    return private.fail_embryo_split_v1(s.id, w.id, 'chunk', 'failed');
  end if;
  select r2_bucket into v_bucket from private.embryo_ingest_object_config where singleton for share;
  v_key := 'embryo/' || gen_random_uuid();
  if v_bucket is null or exists (select 1 from private.embryo_ingest_write_intents x
      where x.provider_bucket = v_bucket and x.provider_key = v_key) then
    raise exception using errcode = '55000', message = 'embryo canonical storage unavailable';
  end if;
  v_now := clock_timestamp();
  insert into private.embryo_canonical_parts (session_id, worker_job_id, attempt, sample_ordinal, sequence,
    provider_bucket, provider_key, byte_count, sha256, created_at, write_expires_at)
  values (s.id, w.id, w.attempts, p_ordinal, p_sequence, v_bucket, v_key, f.byte_count, f.content_sha256,
    v_now, least(v_now + interval '60 seconds', w.claim_expires_at, s.expires_at))
  returning * into p;
  return private.embryo_canonical_part_target_v1(p);
end $$;

-- Land one reserved part with the identity the transport observed after
-- reading the object back to EOF: the exact receipt, its size and SHA-256,
-- a provider version and an ETag, inside the write window and the live claim.
-- A replay with the same identity answers the same; any other is refused.
create function private.ack_embryo_canonical_part_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text,
  p_session_id uuid, p_sequence integer, p_ordinal integer, p_expected jsonb,
  p_provider_version text, p_etag text, p_observed_sha256 text, p_observed_byte_count bigint
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare v_failed jsonb; p private.embryo_canonical_parts%rowtype; v_now timestamptz;
begin
  if p_provider_version is null or p_provider_version !~ '^[0-9a-f]{32}$'
    or p_etag is null or p_etag !~ '^[0-9a-f]{32}$'
    or p_observed_sha256 is null or p_observed_sha256 !~ '^[0-9a-f]{64}$'
    or p_observed_byte_count is null or p_session_id is null or p_sequence is null or p_ordinal is null
    or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text) > 2048 then
    raise exception using errcode = '22023', message = 'invalid canonical part';
  end if;
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into p from private.embryo_canonical_parts where worker_job_id = p_job_id and attempt = p_attempt
    and sample_ordinal = p_ordinal and sequence = p_sequence for update;
  if not found or p.session_id is distinct from p_session_id
    or p_expected is distinct from private.embryo_canonical_part_target_v1(p)
    or p_observed_sha256 <> p.sha256 or p_observed_byte_count <> p.byte_count then
    raise exception using errcode = '42501', message = 'canonical part unavailable';
  end if;
  if p.state = 'landed' then
    if (p.provider_version, p.provider_etag) is distinct from (p_provider_version, p_etag) then
      raise exception using errcode = '42501', message = 'canonical part unavailable';
    end if;
  else
    v_now := clock_timestamp();
    if v_now >= p.write_expires_at then
      raise exception using errcode = '42501', message = 'canonical part unavailable';
    end if;
    update private.embryo_canonical_parts set state = 'landed', provider_version = p_provider_version,
      provider_etag = p_etag, observed_sha256 = p_observed_sha256, landed_at = v_now
      where id = p.id returning * into p;
  end if;
  return jsonb_build_object('receipt', private.embryo_canonical_part_target_v1(p),
    'providerVersion', p.provider_version, 'etag', p.provider_etag);
end $$;

-- An embryo is recorded as passed only with its whole canonical source landed
-- (exactly one landed part per fragment, byte-identical to it by size and
-- SHA-256), and as failed only with no part at all.
create function private.require_embryo_canonical_parts_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.embryo_canonical_parts where worker_job_id = new.worker_job_id
    and attempt = new.attempt and sample_ordinal = new.sample_ordinal order by id for share;
  if new.outcome = 'passed' then
    if exists (select 1 from public.embryo_ingest_fragments f
        where f.session_id = new.session_id and f.sample_ordinal = new.sample_ordinal
          and not exists (select 1 from private.embryo_canonical_parts p
            where p.worker_job_id = new.worker_job_id and p.attempt = new.attempt
              and p.session_id = f.session_id and p.sample_ordinal = f.sample_ordinal and p.sequence = f.sequence
              and p.state = 'landed' and p.sha256 = f.content_sha256 and p.byte_count = f.byte_count))
      or exists (select 1 from private.embryo_canonical_parts p
        where p.worker_job_id = new.worker_job_id and p.attempt = new.attempt
          and p.sample_ordinal = new.sample_ordinal and not exists (select 1 from public.embryo_ingest_fragments f
            where f.session_id = new.session_id and f.sample_ordinal = p.sample_ordinal and f.sequence = p.sequence)) then
      raise exception using errcode = '55000', message = 'canonical source unlanded';
    end if;
  elsif exists (select 1 from private.embryo_canonical_parts p where p.worker_job_id = new.worker_job_id
      and p.attempt = new.attempt and p.sample_ordinal = new.sample_ordinal) then
    raise exception using errcode = '55000', message = 'canonical source for a failed embryo';
  end if;
  return new;
end $$;
create trigger embryo_split_ordinal_canonical_parts before insert on private.embryo_split_ordinals
  for each row execute function private.require_embryo_canonical_parts_v1();

revoke all on function private.reserve_embryo_canonical_part_v1(uuid, integer, text, integer, integer),
  private.ack_embryo_canonical_part_v1(uuid, integer, text, uuid, integer, integer, jsonb, text, text, text, bigint),
  private.require_embryo_canonical_parts_v1()
  from public, anon, authenticated, inherit_upload_only, service_role;
grant execute on function private.reserve_embryo_canonical_part_v1(uuid, integer, text, integer, integer),
  private.ack_embryo_canonical_part_v1(uuid, integer, text, uuid, integer, integer, jsonb, text, text, text, bigint)
  to service_role;

create function public.reserve_embryo_canonical_part_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text, p_ordinal integer, p_sequence integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_embryo_canonical_part_v1(p_job_id, p_attempt, p_claim_token_hash, p_ordinal, p_sequence);
$$;
create function public.ack_embryo_canonical_part_v1(
  p_job_id uuid, p_attempt integer, p_claim_token_hash text,
  p_session_id uuid, p_sequence integer, p_ordinal integer, p_expected jsonb,
  p_provider_version text, p_etag text, p_observed_sha256 text, p_observed_byte_count bigint
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.ack_embryo_canonical_part_v1(p_job_id, p_attempt, p_claim_token_hash, p_session_id,
    p_sequence, p_ordinal, p_expected, p_provider_version, p_etag, p_observed_sha256, p_observed_byte_count);
$$;
revoke all on function public.reserve_embryo_canonical_part_v1(uuid, integer, text, integer, integer),
  public.ack_embryo_canonical_part_v1(uuid, integer, text, uuid, integer, integer, jsonb, text, text, text, bigint)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.reserve_embryo_canonical_part_v1(uuid, integer, text, integer, integer),
  public.ack_embryo_canonical_part_v1(uuid, integer, text, uuid, integer, integer, jsonb, text, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Publication: the same terminal transaction, now with canonical sources
-- ---------------------------------------------------------------------------

-- 20260930122000's body with three changes: every pass must hold exactly its
-- landed canonical parts (and a failure none), each pass gets its canonical
-- source and `genome_files` row, and its genotypes point at that row.
create or replace function private.publish_embryo_split_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  v_failed jsonb;
  w public.worker_jobs%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype;
  v_ordinal private.embryo_split_ordinals%rowtype;
  v_embryo public.embryos%rowtype;
  v_now timestamptz;
  v_passed integer;
  v_qc_failed integer;
  v_cancelled integer;
  v_file uuid;
  v_parts uuid[];
  v_bytes bigint;
  v_rows integer;
begin
  -- Session, then authority rows, then the job: the claim's lock order. This
  -- reruns the binding check and recomputes the manifest digest.
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select * into strict c from public.embryo_cohorts where id = s.cohort_id for update;

  -- The whole ordinal set, recorded by this attempt and no other.
  perform 1 from private.embryo_split_ordinals where session_id = s.id order by sample_ordinal for update;
  if (select count(*) from private.embryo_split_ordinals o where o.session_id = s.id
      and o.worker_job_id = w.id and o.attempt = w.attempts
      and o.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and (o.worker_job_id <> w.id or o.attempt <> w.attempts)) then
    raise exception using errcode = '22023', message = 'split incomplete';
  end if;

  -- Pending genotypes belong only to a passed embryo of this attempt, and
  -- every pass accounts for exactly its own rows and its own fragments. An
  -- inconsistency rolls back; the next attempt starts again from nothing.
  if exists (select 1 from private.embryo_split_variants v where v.session_id = s.id
      and (v.worker_job_id <> w.id or v.attempt <> w.attempts or not exists (
        select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = v.sample_ordinal and o.outcome = 'passed')))
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and o.outcome = 'passed' and (
        o.variant_count <> (select count(*) from private.embryo_split_variants v
          where v.session_id = s.id and v.sample_ordinal = o.sample_ordinal)
        or o.source_sha256 is distinct from private.embryo_split_source_sha256_v1(s.id, o.sample_ordinal))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- Canonical parts: a pass holds exactly one landed part of this attempt per
  -- fragment, byte-identical to it by size and SHA-256; a failure holds none.
  perform 1 from private.embryo_canonical_parts where session_id = s.id order by id for update;
  if exists (select 1 from private.embryo_split_ordinals o
      join public.embryo_ingest_fragments f on f.session_id = o.session_id and f.sample_ordinal = o.sample_ordinal
      where o.session_id = s.id and o.outcome = 'passed' and not exists (
        select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id and p.attempt = w.attempts
          and p.session_id = s.id and p.sample_ordinal = f.sample_ordinal and p.sequence = f.sequence
          and p.state = 'landed' and p.sha256 = f.content_sha256 and p.observed_sha256 = f.content_sha256
          and p.byte_count = f.byte_count))
    or exists (select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id
      and p.attempt = w.attempts and (p.session_id <> s.id
        or not exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = p.sample_ordinal and o.outcome = 'passed')
        or not exists (select 1 from public.embryo_ingest_fragments f where f.session_id = s.id
          and f.sample_ordinal = p.sample_ordinal and f.sequence = p.sequence))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- The one-to-one reservation made at finalization, untouched until now.
  perform 1 from public.embryos where cohort_id = c.id order by sample_ordinal for update;
  perform 1 from public.subjects where cohort_id = c.id order by id for update;
  if (select count(*) from public.embryos e join public.subjects sub on sub.id = e.subject_id
      where e.cohort_id = c.id and sub.cohort_id = c.id and sub.subject_class = 'embryo'
        and sub.lifecycle = 'quarantined' and e.status = 'pending'
        and e.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or (select count(*) from public.embryos e where e.cohort_id = c.id) <> c.embryo_count
    or (select count(*) from public.subjects sub where sub.cohort_id = c.id) <> c.embryo_count
    or exists (select 1 from public.embryo_qc q join public.embryos e on e.id = q.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_variants v join public.embryos e on e.id = v.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_scores x join public.embryos e on e.id = x.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.genome_files f join public.subjects sub on sub.id = f.subject_id
      where sub.cohort_id = c.id)
    or exists (select 1 from public.genome_files f where f.cohort_id = c.id)
    or exists (select 1 from private.embryo_canonical_sources x where x.cohort_id = c.id)
    or c.publication_revision is not null or c.status <> 'ingesting'
    or c.uploaded_at is not null or c.qc_failed_at is not null then
    return private.fail_embryo_split_v1(s.id, w.id, 'stale-binding', 'cancelled');
  end if;

  v_now := clock_timestamp();
  select count(*) filter (where outcome = 'passed'), count(*) filter (where outcome = 'qc_fail_no_source')
    into v_passed, v_qc_failed from private.embryo_split_ordinals where session_id = s.id;

  -- One QC row per embryo, measured from its own calls only. What the file
  -- does not report stays null; nothing is estimated or imputed.
  insert into public.embryo_qc (embryo_id, sites_expected, sites_called, call_rate, autosomal_het_rate,
    mean_depth, parent_a_concordance, parent_b_concordance, allelic_dropout_estimate,
    imputation_performed, imputation_panel, contamination_estimate, qc_verdict, qc_reasons, computed_at)
  select e.id, o.sites_expected, o.sites_called, o.call_rate, o.autosomal_het_rate, o.mean_depth,
    null, null, null, false, null, null, o.qc_verdict,
    case when o.failure_reason is not null and not (o.failure_reason = any (o.qc_reasons))
      then o.qc_reasons || o.failure_reason else o.qc_reasons end,
    v_now
  from private.embryo_split_ordinals o
  join public.embryos e on e.cohort_id = c.id and e.sample_ordinal = o.sample_ordinal
  where o.session_id = s.id;

  -- Each passed embryo, alone: its canonical source over its own landed
  -- parts, one `genome_files` row bound to its own digest and complete, and
  -- its own genotypes pointing at that row. A failed embryo gets none of it.
  for v_ordinal in select * from private.embryo_split_ordinals x where x.session_id = s.id and x.outcome = 'passed'
    order by x.sample_ordinal
  loop
    select * into strict v_embryo from public.embryos x where x.cohort_id = c.id and x.sample_ordinal = v_ordinal.sample_ordinal;
    select array_agg(p.id order by p.sequence), sum(p.byte_count) into v_parts, v_bytes
      from private.embryo_canonical_parts p
      where p.worker_job_id = w.id and p.attempt = w.attempts and p.sample_ordinal = v_ordinal.sample_ordinal;
    v_file := gen_random_uuid();
    -- The name is a neutral server label, never a laboratory or source name.
    -- There is no single raw object: `sha256` stays null and the composed
    -- digest over the parts is the source digest.
    insert into public.genome_files (id, user_id, bucket_path, original_name, file_type, tier, size_bytes,
      sha256, status, build, variant_count, processing_started_at, processing_finished_at, subject_id,
      cohort_id, is_cohort_file, sample_count, source_publication_state, source_publication_revision,
      source_binding_fingerprint, storage_object_id, structural_validator_version,
      single_logical_sample_verified_at, source_sha256, canonical_build, upload_revision,
      normalization_completed_at, normalization_source_revision)
    values (v_file, c.owner_account_id, 'embryo-source/' || v_file, 'embryo-autosomal-source.vcf', 'vcf', 1, v_bytes,
      null, 'stored', s.reference_build, v_ordinal.variant_count, null, v_now, v_embryo.subject_id,
      null, false, 1, 'published', 1,
      v_ordinal.source_sha256, null, 'embryo-ordinal-fragment-v1',
      v_now, v_ordinal.source_sha256, s.reference_build, 1,
      v_now, 1);
    insert into private.embryo_canonical_sources (file_id, embryo_id, subject_id, cohort_id, sample_ordinal,
      session_id, worker_job_id, attempt, publication_revision, reference_build, source_sha256,
      membership_sha256, part_count, byte_count, variant_count, published_at)
    values (v_file, v_embryo.id, v_embryo.subject_id, c.id, v_ordinal.sample_ordinal, s.id, w.id, w.attempts, 1, s.reference_build,
      v_ordinal.source_sha256, private.embryo_canonical_membership_sha256_v1(v_parts), cardinality(v_parts), v_bytes,
      v_ordinal.variant_count, v_now);
    insert into private.embryo_canonical_source_parts (file_id, part_id, sequence)
      select v_file, p.id, p.sequence from private.embryo_canonical_parts p where p.id = any (v_parts);
    if private.embryo_canonical_source_sha256_v1(v_file) is distinct from v_ordinal.source_sha256 then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
    insert into public.embryo_variants (embryo_id, source_file_id, chromosome, position,
      reference_allele, alternate_allele, genotype, source_binding_fingerprint)
    select v_embryo.id, v_file, v.chromosome, v.position, v.reference_allele, v.alternate_allele, v.genotype,
      v_ordinal.source_sha256
    from private.embryo_split_variants v
    where v.session_id = s.id and v.sample_ordinal = v_ordinal.sample_ordinal
    order by v.batch, v.id;
    get diagnostics v_rows = row_count;
    if v_rows <> v_ordinal.variant_count then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
  end loop;

  update public.embryos e
    set status = case o.qc_verdict when 'pass' then 'qc_pass' when 'marginal' then 'qc_marginal' else 'qc_fail' end
    from private.embryo_split_ordinals o
    where e.cohort_id = c.id and o.session_id = s.id and o.sample_ordinal = e.sample_ordinal;

  -- G5.3: quarantine lifts for every embryo subject at once, and only here.
  update public.subjects set lifecycle = 'active', lifecycle_revision = lifecycle_revision + 1
    where cohort_id = c.id and subject_class = 'embryo' and lifecycle = 'quarantined';

  update public.embryo_cohorts
    set status = 'active', publication_revision = 1,
      uploaded_at = case when v_passed > 0 then v_now end,
      qc_failed_at = case when v_passed = 0 then v_now end
    where id = c.id;

  -- Only a success or partial publication cancels the exact due phase.
  update public.retention_due_phases
    set status = 'cancelled', terminal_outcome_code = 'ingest_published', completed_at = v_now
    where retention_id = 'embryo.ingest-session-24h' and phase_id = 'ingest-abandoned-no-source'
      and target_kind = 'ingest_session' and target_id = s.id and phase_revision = s.ingest_revision
      and status in ('pending', 'retry');
  get diagnostics v_cancelled = row_count;
  if v_cancelled <> 1 then
    raise exception using errcode = '55000', message = 'ingest due phase unavailable';
  end if;

  update public.embryo_ingest_sessions set status = 'published' where id = s.id;
  update public.worker_jobs
    set status = 'done', finished_at = v_now, partial = v_qc_failed > 0, progress = 100,
      progress_note = 'complete', claim_token_hash = null, claim_expires_at = null, claimed_by = null
    where id = w.id;

  -- The pending rows are now the published rows; nothing attempt-owned remains
  -- in them. Canonical parts stay: they are the published sources' objects.
  delete from private.embryo_split_variants where session_id = s.id;
  delete from private.embryo_split_ordinals where session_id = s.id;

  perform private.append_legal_audit_event(
    'embryo.cohort.published', null, null, 'accepted',
    jsonb_build_object('embryo_count', c.embryo_count, 'publication_revision', 1));

  return jsonb_build_object('status', 'published', 'publicationRevision', 1,
    'published', v_passed, 'qcFailed', v_qc_failed);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The owner's generic file read never returns an embryo or cohort source
-- ---------------------------------------------------------------------------

-- True only for the signed-in owner's own non-embryo, non-cohort file row. It
-- answers nothing about another account's row or an arbitrary subject.
create function private.genome_file_owner_listable_v1(p_file_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.genome_files f join public.subjects s on s.id = f.subject_id
    where f.id = p_file_id and f.user_id = (select auth.uid()) and f.cohort_id is null
      and s.subject_class <> 'embryo');
$$;
revoke all on function private.genome_file_owner_listable_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;
grant execute on function private.genome_file_owner_listable_v1(uuid) to authenticated;

-- A fresh chronological replay reaches the legacy owner-only policy here.
-- An append to the already deployed main graph reaches the later Path B
-- policy. Compose both refusals immediately in that case; the final privacy
-- migration verifies the same composition. Never overwrite the newer refusal
-- with the older embryo-only rule, even between committed migrations.
do $canonical_owner_policy$
declare actual_qual text; actual_roles oid[]; legacy_qual text; path_b_qual text;
  path_b_helper oid := to_regprocedure('private.is_path_b_file_v1(uuid)');
begin
  if not exists(select 1 from pg_catalog.pg_class file_table
    join pg_catalog.pg_policy policy on policy.polrelid=file_table.oid
    where file_table.oid='public.genome_files'::regclass and file_table.relkind='r'
      and file_table.relrowsecurity and not file_table.relforcerowsecurity
      and file_table.relowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
      and policy.polname='genome_files_select_own' and policy.polcmd='r'
      and policy.polpermissive and policy.polwithcheck is null)
    or exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='public.genome_files'::regclass and policy.polcmd in('r','*')
        and policy.polname<>'genome_files_select_own') then
    raise exception using errcode='55000',message='unexpected canonical owner policy';
  end if;
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),policy.polroles
    into actual_qual,actual_roles from pg_catalog.pg_policy policy
    where policy.polrelid='public.genome_files'::regclass and policy.polname='genome_files_select_own';
  create temporary table canonical_owner_policy_predecessor(like public.genome_files) on commit drop;
  create policy canonical_owner_legacy on canonical_owner_policy_predecessor
    using((select auth.uid())=user_id);
  select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) into legacy_qual
    from pg_catalog.pg_policy policy
    where policy.polrelid='pg_temp.canonical_owner_policy_predecessor'::regclass
      and policy.polname='canonical_owner_legacy';
  if path_b_helper is null then
    if actual_roles is distinct from array[0]::oid[] or actual_qual is distinct from legacy_qual then
      raise exception using errcode='55000',message='unexpected canonical owner predecessor';
    end if;
    alter policy genome_files_select_own on public.genome_files to authenticated
      using((select auth.uid())=user_id and private.genome_file_owner_listable_v1(id));
  else
    if not exists(select 1 from pg_catalog.pg_proc helper where helper.oid=path_b_helper
      and helper.proowner=(select oid from pg_catalog.pg_roles where rolname='postgres')
      and helper.prokind='f' and helper.prosecdef and helper.provolatile='s'
      and not helper.proisstrict and not helper.proleakproof and helper.proparallel='u'
      and not helper.proretset and helper.prorettype='boolean'::regtype
      and helper.pronargs=1 and helper.proargtypes[0]='uuid'::regtype and helper.proargnames=array['p_file_id']::text[]
      and helper.proargmodes is null and helper.proallargtypes is null
      and helper.pronargdefaults=0 and helper.proargdefaults is null and helper.provariadic=0
      and helper.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
      and helper.proconfig=array['search_path=""']::text[] and helper.probin is null
      and helper.procost=100 and helper.prorows=0
      and md5(helper.prosrc)='fae16b4a98c3e99447754ac6b284a412'
      and array(select grant_entry::text from unnest(helper.proacl) grant_entry order by grant_entry::text)
        =array['authenticated=X/postgres','postgres=X/postgres']::text[]
      and has_function_privilege('authenticated',helper.oid,'execute')
      and not has_function_privilege('anon',helper.oid,'execute')
      and not has_function_privilege('inherit_upload_only',helper.oid,'execute')
      and not has_function_privilege('service_role',helper.oid,'execute')) then
      raise exception using errcode='55000',message='unexpected canonical Path B helper';
    end if;
    create policy canonical_owner_path_b on canonical_owner_policy_predecessor to authenticated
      using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(id));
    select pg_catalog.pg_get_expr(policy.polqual,policy.polrelid) into path_b_qual
      from pg_catalog.pg_policy policy
      where policy.polrelid='pg_temp.canonical_owner_policy_predecessor'::regclass
        and policy.polname='canonical_owner_path_b';
    if actual_roles is distinct from array[(select oid from pg_catalog.pg_roles where rolname='authenticated')]::oid[]
      or actual_qual is distinct from path_b_qual then
      raise exception using errcode='55000',message='unexpected canonical Path B predecessor';
    end if;
    alter policy genome_files_select_own on public.genome_files to authenticated
      using(user_id=(select auth.uid()) and private.genome_file_owner_listable_v1(id)
        and not private.is_path_b_file_v1(id));
  end if;
  drop table canonical_owner_policy_predecessor;
end
$canonical_owner_policy$;

notify pgrst, 'reload schema';
