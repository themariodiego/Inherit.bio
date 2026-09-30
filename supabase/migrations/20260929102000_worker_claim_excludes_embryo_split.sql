-- The generic worker claim must not hand out an embryo split job.
--
-- private.claim_worker_job_v2 (20260831224035) is unused and granted to
-- service_role. It claims the oldest queued job of any kind. A split_cohort_vcf
-- job belongs only to the split worker's own claim, which reruns the ingest
-- attempt's binding check and manifest digest on every step. Claiming it here
-- would skip both. This restates the function with that one kind excluded;
-- everything else is unchanged. Nothing else calls it.
create or replace function private.claim_worker_job_v2(
  p_worker_id text, p_claim_token_hash text, p_lease_seconds integer default 60
) returns public.worker_jobs language plpgsql security definer set search_path = ''
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
    and kind <> 'split_cohort_vcf'
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
revoke all on function private.claim_worker_job_v2(text, text, integer) from public, anon, authenticated;
grant execute on function private.claim_worker_job_v2(text, text, integer) to service_role;
