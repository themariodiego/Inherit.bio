-- Exact server-side authorization and queue mutation surface.

create or replace function private.resource_authorized_v1(
  p_account_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_purpose text,
  p_lifecycle_revision bigint,
  p_grant_revision bigint default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_direct boolean := false;
  v_granted boolean := false;
begin
  if p_target_kind = 'subject' then
    select exists (
      select 1 from public.subjects s
      where s.id = p_target_id
        and s.lifecycle_revision = p_lifecycle_revision
        and s.lifecycle in ('active', 'claimed_bound')
        and (s.owner_account_id = p_account_id or s.subject_account_id = p_account_id)
    ) into v_direct;
  elsif p_target_kind = 'cohort' then
    select exists (
      select 1 from public.embryo_cohorts c
      where c.id = p_target_id
        and c.lifecycle_revision = p_lifecycle_revision
        and c.status in ('upload_pending', 'ingesting', 'active', 'claimed_bound')
        and c.owner_account_id = p_account_id
    ) into v_direct;
  elsif p_target_kind = 'family_pair' then
    select exists (
      select 1
      from public.family_pairs fp
      join public.subjects a on a.id = fp.subject_a_id
      join public.subjects b on b.id = fp.subject_b_id
      where fp.id = p_target_id
        and fp.pair_revision = p_lifecycle_revision
        and fp.status = 'current'
        and (a.owner_account_id = p_account_id or b.owner_account_id = p_account_id)
    ) into v_direct;
  else
    return false;
  end if;

  if v_direct and p_grant_revision is null then return true; end if;

  select exists (
    select 1
    from public.purpose_grants pg
    join public.directional_grants dg
      on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
    where pg.target_kind = p_target_kind
      and pg.target_id = p_target_id
      and pg.purpose = p_purpose
      and pg.grant_revision = p_grant_revision
      and pg.revoked_at is null
      and (pg.expires_at is null or pg.expires_at > clock_timestamp())
      and dg.recipient_account_id = p_account_id
      and dg.status = 'current'
  ) into v_granted;

  return v_granted or (v_direct and p_grant_revision is not null and v_granted);
end;
$$;

revoke all on function private.resource_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.resource_authorized_v1(uuid, text, uuid, text, bigint, bigint)
  to service_role;

create or replace function private.enqueue_worker_job_v2(
  p_account_id uuid,
  p_kind text,
  p_output_kind text,
  p_subject_id uuid,
  p_cohort_id uuid,
  p_source_binding_kind text,
  p_source_binding_id uuid,
  p_source_binding_revision bigint,
  p_file_sha256 text,
  p_computation_revision text,
  p_file_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.worker_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_kind text;
  v_target_id uuid;
  v_key text;
  v_row public.worker_jobs;
begin
  if num_nonnulls(p_subject_id, p_cohort_id) <> 1 then
    raise exception using errcode = '22023', message = 'exactly one worker target is required';
  end if;
  if p_kind in ('align_fastq', 'call_variants') then
    raise exception using errcode = '0A000', message = 'worker kind is withheld';
  end if;

  v_target_kind := case when p_subject_id is not null then 'subject' else 'cohort' end;
  v_target_id := coalesce(p_subject_id, p_cohort_id);
  v_key := private.worker_job_idempotency_key(
    p_kind, p_output_kind, v_target_kind, v_target_id,
    p_source_binding_kind, p_source_binding_id, p_source_binding_revision,
    lower(p_file_sha256), p_computation_revision
  );

  insert into public.worker_jobs (
    user_id, file_id, kind, status, payload, subject_id, cohort_id,
    output_kind, source_binding_kind, source_binding_id,
    source_binding_revision, file_sha256, computation_revision,
    idempotency_key
  ) values (
    p_account_id, p_file_id, p_kind, 'queued', coalesce(p_payload, '{}'::jsonb),
    p_subject_id, p_cohort_id, p_output_kind, p_source_binding_kind,
    p_source_binding_id, p_source_binding_revision, lower(p_file_sha256),
    p_computation_revision, v_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.worker_jobs where idempotency_key = v_key for update;
    if row(
      v_row.kind, v_row.output_kind, v_row.target_kind,
      coalesce(v_row.subject_id, v_row.cohort_id), v_row.source_binding_kind,
      v_row.source_binding_id, v_row.source_binding_revision,
      v_row.file_sha256, v_row.computation_revision
    ) is distinct from row(
      p_kind, p_output_kind, v_target_kind, v_target_id, p_source_binding_kind,
      p_source_binding_id, p_source_binding_revision, lower(p_file_sha256),
      p_computation_revision
    ) then
      raise exception using errcode = '23505', message = 'worker idempotency collision';
    end if;
  end if;
  return v_row;
end;
$$;

revoke all on function private.enqueue_worker_job_v2(
  uuid, text, text, uuid, uuid, text, uuid, bigint, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function private.enqueue_worker_job_v2(
  uuid, text, text, uuid, uuid, text, uuid, bigint, text, text, uuid, jsonb
) to service_role;

create or replace function private.claim_worker_job_v2(
  p_worker_id text,
  p_claim_token_hash text,
  p_lease_seconds integer default 60
)
returns public.worker_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.worker_jobs;
begin
  if p_claim_token_hash !~ '^[0-9a-f]{64}$' or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'invalid worker claim parameters';
  end if;

  select * into v_row
  from public.worker_jobs
  where status = 'queued'
    and not_before <= clock_timestamp()
    and attempts < max_attempts
  order by created_at, id
  for update skip locked
  limit 1;

  if v_row.id is null then return null; end if;

  update public.worker_jobs
  set status = 'running', attempts = attempts + 1,
      claim_token_hash = p_claim_token_hash,
      claim_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      claimed_by = p_worker_id,
      started_at = coalesce(started_at, clock_timestamp())
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function private.claim_worker_job_v2(text, text, integer)
  from public, anon, authenticated;
grant execute on function private.claim_worker_job_v2(text, text, integer) to service_role;

-- Remove legacy client-side mutations. Application routes now validate a
-- session and use the server-only resolver for all sensitive writes.
drop policy if exists "genome_files_insert_own" on public.genome_files;
drop policy if exists "genome_files_update_own" on public.genome_files;
drop policy if exists "genome_files_delete_own" on public.genome_files;
drop policy if exists "user_variants_insert_own" on public.user_variants;
drop policy if exists "user_variants_delete_own" on public.user_variants;
drop policy if exists "ancestry_insert_own" on public.ancestry_results;
drop policy if exists "ancestry_delete_own" on public.ancestry_results;
drop policy if exists "user_prs_insert_own" on public.user_prs;
drop policy if exists "user_prs_delete_own" on public.user_prs;
drop policy if exists "consent_insert_own" on public.consent_grants;
drop policy if exists "consent_update_own" on public.consent_grants;
drop policy if exists "consent_delete_own" on public.consent_grants;
drop policy if exists "chats_insert_own" on public.chats;
drop policy if exists "chats_update_own" on public.chats;
drop policy if exists "chats_delete_own" on public.chats;
drop policy if exists "chat_messages_insert_own" on public.chat_messages;
drop policy if exists "chat_messages_delete_own" on public.chat_messages;

revoke insert, update, delete on table public.genome_files, public.user_variants,
  public.ancestry_results, public.user_prs, public.consent_grants,
  public.chats, public.chat_messages from anon, authenticated;

-- Retire the public cross-account SECURITY DEFINER aggregate. Its replacement
-- is server-only in the unexposed private schema.
revoke all on function public.processing_time_stats() from public, anon, authenticated;
create or replace function private.processing_time_stats()
returns table (file_tier smallint, n bigint, p50_seconds numeric, p95_seconds numeric)
language sql
security definer
set search_path = ''
stable
as $$
  select
    f.tier,
    count(*),
    round(percentile_cont(0.5) within group (order by extract(epoch from (f.processing_finished_at - f.processing_started_at)))::numeric, 1),
    round(percentile_cont(0.95) within group (order by extract(epoch from (f.processing_finished_at - f.processing_started_at)))::numeric, 1)
  from public.genome_files f
  where f.processing_finished_at is not null
    and f.processing_started_at is not null
    and f.created_at > clock_timestamp() - interval '90 days'
  group by f.tier
$$;
revoke all on function private.processing_time_stats() from public, anon, authenticated;
grant execute on function private.processing_time_stats() to service_role;
