-- Processing timestamps for honest, measured turnaround labels (p50/p95
-- shown in the UI instead of marketing claims), plus the aggregate function.

alter table public.genome_files
  add column processing_started_at timestamptz,
  add column processing_finished_at timestamptz;

-- Aggregate processing stats over the last 90 days. Definer so it can read
-- across users, but it returns only aggregate durations — no user data.
create function public.processing_time_stats()
returns table (file_tier smallint, n bigint, p50_seconds numeric, p95_seconds numeric)
language sql
security definer
set search_path = ''
stable
as $$
  select
    tier as file_tier,
    count(*) as n,
    round(percentile_cont(0.5) within group (order by
      extract(epoch from (processing_finished_at - processing_started_at)))::numeric, 1) as p50_seconds,
    round(percentile_cont(0.95) within group (order by
      extract(epoch from (processing_finished_at - processing_started_at)))::numeric, 1) as p95_seconds
  from public.genome_files
  where processing_finished_at is not null
    and processing_started_at is not null
    and created_at > now() - interval '90 days'
  group by tier;
$$;

grant execute on function public.processing_time_stats() to anon, authenticated;
