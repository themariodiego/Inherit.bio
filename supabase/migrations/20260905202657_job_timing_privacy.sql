-- Brief turnaround contract: coarse sample counts, p50/p95, trailing 90 days.
-- The old return type cannot be changed with CREATE OR REPLACE. No tracked
-- application consumes it; keep the RPC name and p_kind argument, not the
-- unsafe exact-count response or a falsely labelled p90 compatibility alias.
begin;
drop function public.job_time_stats(text);

create function public.job_time_stats(p_kind text)
returns table (n_bucket text, p50_seconds integer, p95_seconds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Cross-account aggregates are deliberate. No rows, identities, exact
  -- sample counts or lifecycle/purge activity are returned to the caller.
  if current_setting('role', true) = 'authenticated' and auth.uid() is null then
    raise exception 'authenticated account required' using errcode = '42501';
  end if;
  -- Registry: worker_jobs_dispatch_check; only embryo/family turnaround.
  if p_kind is null or p_kind not in ('split_cohort_vcf', 'score_embryo', 'compute_portrait') then
    raise exception 'unsupported turnaround kind' using errcode = '22023';
  end if;
  return query
  select
    case when count(*) < 20 then '<20' when count(*) < 100 then '20-99' else '100+' end,
    case when count(*) >= 20 then
      (percentile_cont(0.5) within group (
        order by extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at)))
      ))::integer end,
    case when count(*) >= 20 then
      (percentile_cont(0.95) within group (
        order by extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at)))
      ))::integer end
  from public.worker_jobs j
  where j.kind = p_kind and j.status = 'done' and not j.partial
    and j.finished_at > now() - interval '90 days'
    and j.finished_at <= now()
    and isfinite(j.finished_at)
    and isfinite(j.created_at)
    and isfinite(coalesce(j.started_at, j.created_at))
    and j.created_at <= coalesce(j.started_at, j.created_at)
    and j.finished_at >= coalesce(j.started_at, j.created_at)
    and extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at))) <= 2147483647;
end;
$$;

revoke all on function public.job_time_stats(text) from public, anon, authenticated;
grant execute on function public.job_time_stats(text) to authenticated, service_role;
comment on function public.job_time_stats(text) is
  'Reviewed cross-account turnaround aggregate: three allowed report job kinds, coarse counts, suppressed below twenty, p50/p95 over ninety days. No exact counts or lifecycle-job statistics.';
notify pgrst, 'reload schema';
commit;
