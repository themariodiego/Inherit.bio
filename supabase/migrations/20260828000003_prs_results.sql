-- Computed polygenic scores per file (written at process time from the
-- bundled, license-audited PGS Catalog seed data).
create table public.user_prs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid not null references public.genome_files (id) on delete cascade,
  pgs_id text not null references public.prs_scores (pgs_id),
  raw_score real not null,
  zscore real,
  percentile real,
  coverage real not null,          -- fraction of score variants usable, 0-1
  matched integer not null,
  computed_at timestamptz not null default now(),
  unique (file_id, pgs_id)
);

alter table public.user_prs enable row level security;
create policy "user_prs_select_own" on public.user_prs
  for select using (auth.uid() = user_id);
create policy "user_prs_insert_own" on public.user_prs
  for insert with check (auth.uid() = user_id);
create policy "user_prs_delete_own" on public.user_prs
  for delete using (auth.uid() = user_id);

-- The admixture/haplogroup reference data ships inside the application
-- bundle (data/ref/*.json, license-audited); these tables were superseded
-- before ever being seeded.
drop table public.ref_aims;
drop table public.ref_haplogroup_markers;
