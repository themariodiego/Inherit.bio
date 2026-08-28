-- Sequence core schema.
-- Every table holding user data has RLS enabled with owner-only policies.
-- Reference tables (ref_*) hold public dataset subsets and are world-readable.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  digest_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Genome files (Tier 1 fully processed; Tier 2 stored + hashed)
-- ---------------------------------------------------------------------------
create type public.genome_file_type as enum (
  'array_23andme', 'array_ancestry', 'array_myheritage', 'array_ftdna',
  'vcf', 'gvcf', 'bam', 'cram'
);

create type public.genome_file_status as enum (
  'uploading', 'uploaded', 'parsing', 'parsed', 'annotated', 'failed', 'stored'
);

create table public.genome_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket_path text not null,
  original_name text not null,
  file_type public.genome_file_type not null,
  tier smallint not null check (tier in (1, 2)),
  size_bytes bigint not null,
  sha256 text,
  status public.genome_file_status not null default 'uploading',
  build text check (build in ('GRCh37', 'GRCh38', 'unknown')),
  variant_count integer,
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, bucket_path)
);

create index genome_files_user_idx on public.genome_files (user_id);

alter table public.genome_files enable row level security;

create policy "genome_files_select_own" on public.genome_files
  for select using (auth.uid() = user_id);
create policy "genome_files_insert_own" on public.genome_files
  for insert with check (auth.uid() = user_id);
create policy "genome_files_update_own" on public.genome_files
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "genome_files_delete_own" on public.genome_files
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Canonical per-user variant store (GRCh38 positions)
-- ---------------------------------------------------------------------------
create table public.user_variants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid not null references public.genome_files (id) on delete cascade,
  rsid bigint,                    -- numeric part of rsID; null when unknown
  chrom smallint not null,        -- 1-22, 23=X, 24=Y, 25=MT
  pos integer not null,           -- GRCh38 position
  ref text,
  alt text,
  genotype text not null          -- e.g. 'A/G', 'T', '--' (no-call)
);

-- Parsers delete-and-reinsert per file; dedup is the parser's job.
create index user_variants_file_idx on public.user_variants (file_id);

create index user_variants_rsid_idx on public.user_variants (user_id, rsid)
  where rsid is not null;
create index user_variants_pos_idx on public.user_variants (user_id, chrom, pos);

alter table public.user_variants enable row level security;

create policy "user_variants_select_own" on public.user_variants
  for select using (auth.uid() = user_id);
create policy "user_variants_insert_own" on public.user_variants
  for insert with check (auth.uid() = user_id);
create policy "user_variants_delete_own" on public.user_variants
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Reference store: report-relevant variants joined from public datasets.
-- Refreshed by the scheduled annotation job. No user data.
-- ---------------------------------------------------------------------------
create table public.ref_variants (
  rsid bigint primary key,
  chrom smallint not null,
  pos37 integer,
  pos38 integer,
  ref text,
  alt text,
  gene_symbol text,
  clinvar_significance text,
  clinvar_review_status text,
  gnomad_af real,
  gnomad_af_by_pop jsonb,
  sources jsonb not null default '{}'::jsonb,  -- {clinvar: vcv, gwas: [...], dbsnp: build}
  updated_at timestamptz not null default now()
);

create index ref_variants_gene_idx on public.ref_variants (gene_symbol);
create index ref_variants_pos_idx on public.ref_variants (chrom, pos38);

alter table public.ref_variants enable row level security;
create policy "ref_variants_public_read" on public.ref_variants
  for select using (true);

create table public.ref_genes (
  symbol text primary key,
  name text,
  chrom smallint,
  start_pos integer,
  end_pos integer,
  summary text
);

alter table public.ref_genes enable row level security;
create policy "ref_genes_public_read" on public.ref_genes
  for select using (true);

-- ---------------------------------------------------------------------------
-- Report templates (the report library) + review queue + changelog
-- ---------------------------------------------------------------------------
create type public.template_status as enum ('draft', 'review', 'published', 'retired');
create type public.evidence_level as enum ('established', 'moderate', 'preliminary');

create table public.report_templates (
  slug text primary key,
  category text not null,
  title text not null,
  summary text not null,             -- plain-language effect summary
  status public.template_status not null default 'published',
  evidence public.evidence_level not null,
  -- Genotype-specific logic: [{rsid, ref, alt, interpretations: {"AA": "...", ...}}]
  variants jsonb not null default '[]'::jsonb,
  pgs_id text,                       -- set for PRS-backed templates
  citations jsonb not null default '[]'::jsonb, -- [{pmid?, doi?, label}]
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create index report_templates_category_idx on public.report_templates (category, status);

alter table public.report_templates enable row level security;
create policy "report_templates_public_read" on public.report_templates
  for select using (status = 'published');

create table public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  template_slug text references public.report_templates (slug),
  published_at timestamptz not null default now()
);

alter table public.changelog_entries enable row level security;
create policy "changelog_public_read" on public.changelog_entries
  for select using (true);

-- Tracks which upstream releases the research pipeline has processed.
create table public.research_releases (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gwas_catalog', 'pgs_catalog', 'clinvar')),
  release_key text not null,
  processed_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  unique (source, release_key)
);

alter table public.research_releases enable row level security;
-- service-role only: no policies (deny all through PostgREST for users).

-- ---------------------------------------------------------------------------
-- Polygenic scores
-- ---------------------------------------------------------------------------
create table public.prs_scores (
  pgs_id text primary key,           -- e.g. PGS000123
  name text not null,
  trait text not null,
  n_variants integer not null,
  citation jsonb not null,           -- {pmid?, doi?, label}
  source_url text not null,
  ancestry_note text not null,       -- mandatory portability caveat text
  percentile_ref jsonb,              -- reference distribution {mean, sd, source}
  updated_at timestamptz not null default now()
);

alter table public.prs_scores enable row level security;
create policy "prs_scores_public_read" on public.prs_scores
  for select using (true);

create table public.prs_weights (
  pgs_id text not null references public.prs_scores (pgs_id) on delete cascade,
  chrom smallint not null,
  pos38 integer not null,
  effect_allele text not null,
  other_allele text,
  weight real not null,
  rsid bigint,
  primary key (pgs_id, chrom, pos38, effect_allele)
);

create index prs_weights_pos_idx on public.prs_weights (chrom, pos38);

alter table public.prs_weights enable row level security;
create policy "prs_weights_public_read" on public.prs_weights
  for select using (true);

-- ---------------------------------------------------------------------------
-- Ancestry results
-- ---------------------------------------------------------------------------
create table public.ancestry_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid not null references public.genome_files (id) on delete cascade,
  kind text not null check (kind in ('admixture', 'mtdna', 'ydna')),
  result jsonb not null,
  support_note text not null,        -- honest "what your file supports" label
  created_at timestamptz not null default now(),
  unique (file_id, kind)
);

alter table public.ancestry_results enable row level security;
create policy "ancestry_select_own" on public.ancestry_results
  for select using (auth.uid() = user_id);
create policy "ancestry_insert_own" on public.ancestry_results
  for insert with check (auth.uid() = user_id);
create policy "ancestry_delete_own" on public.ancestry_results
  for delete using (auth.uid() = user_id);

-- Reference data for ancestry: ancestry-informative markers with 1000G
-- superpopulation allele frequencies; haplogroup-defining markers.
create table public.ref_aims (
  rsid bigint primary key,
  chrom smallint not null,
  pos38 integer not null,
  ref text not null,
  alt text not null,
  freqs jsonb not null               -- {AFR: 0.1, AMR: ..., EAS, EUR, SAS}
);

alter table public.ref_aims enable row level security;
create policy "ref_aims_public_read" on public.ref_aims for select using (true);

create table public.ref_haplogroup_markers (
  id serial primary key,
  lineage text not null check (lineage in ('mt', 'y')),
  haplogroup text not null,
  chrom smallint not null,           -- 25 = MT, 24 = Y
  pos38 integer not null,
  ancestral text not null,
  derived text not null,
  marker_name text
);

create index ref_haplo_pos_idx on public.ref_haplogroup_markers (chrom, pos38);

alter table public.ref_haplogroup_markers enable row level security;
create policy "ref_haplo_public_read" on public.ref_haplogroup_markers
  for select using (true);

-- ---------------------------------------------------------------------------
-- Provider directory (data, not copy)
-- ---------------------------------------------------------------------------
create table public.providers (
  slug text primary key,
  name text not null,
  website text not null,
  checkout_url text not null,
  privacy_policy_url text,
  data_practices_note text,
  products jsonb not null default '[]'::jsonb,
  raw_formats text[] not null default '{}',
  ships_to text not null,
  ships_to_countries text[] not null default '{}',
  us_state_exclusions text[] not null default '{}',
  turnaround text,
  gating text,
  affiliate boolean not null default false,
  source_urls text[] not null default '{}',
  last_verified_at date not null,
  status text not null default 'operating'
    check (status in ('operating', 'operating-restricted'))
);

alter table public.providers enable row level security;
create policy "providers_public_read" on public.providers
  for select using (true);

-- ---------------------------------------------------------------------------
-- LLM copilot: BYOK settings, consent grants, chats
-- ---------------------------------------------------------------------------
create table public.llm_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai_compatible')),
  base_url text,                     -- for openai_compatible (incl. local)
  model text not null,
  key_last4 text,
  updated_at timestamptz not null default now()
);

alter table public.llm_settings enable row level security;
create policy "llm_settings_insert_own" on public.llm_settings
  for insert with check (auth.uid() = user_id);
create policy "llm_settings_update_own" on public.llm_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "llm_settings_delete_own" on public.llm_settings
  for delete using (auth.uid() = user_id);
create policy "llm_settings_select_own" on public.llm_settings
  for select using (auth.uid() = user_id);

-- BYOK ciphertext lives in a table with ZERO client grants: only the
-- service role (server) can touch it. AES-256-GCM under BYOK_ENCRYPTION_KEY.
create table public.llm_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_key bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.llm_keys enable row level security;
revoke all on public.llm_keys from anon, authenticated;

create table public.consent_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_key text not null,        -- 'anthropic' or normalized base host
  data_classes text[] not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index consent_grants_active_idx
  on public.consent_grants (user_id, provider_key)
  where revoked_at is null;

alter table public.consent_grants enable row level security;
create policy "consent_select_own" on public.consent_grants
  for select using (auth.uid() = user_id);
create policy "consent_insert_own" on public.consent_grants
  for insert with check (auth.uid() = user_id);
create policy "consent_update_own" on public.consent_grants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "consent_delete_own" on public.consent_grants
  for delete using (auth.uid() = user_id);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now()
);

alter table public.chats enable row level security;
create policy "chats_select_own" on public.chats
  for select using (auth.uid() = user_id);
create policy "chats_insert_own" on public.chats
  for insert with check (auth.uid() = user_id);
create policy "chats_update_own" on public.chats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chats_delete_own" on public.chats
  for delete using (auth.uid() = user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

alter table public.chat_messages enable row level security;
create policy "chat_messages_select_own" on public.chat_messages
  for select using (auth.uid() = user_id);
create policy "chat_messages_insert_own" on public.chat_messages
  for insert with check (auth.uid() = user_id);
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Worker job queue (Tier 3 self-host worker consumes via direct Postgres)
-- ---------------------------------------------------------------------------
create table public.worker_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid references public.genome_files (id) on delete cascade,
  kind text not null check (kind in ('annotate_vcf', 'align_fastq', 'call_variants')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index worker_jobs_queue_idx on public.worker_jobs (status, created_at);

alter table public.worker_jobs enable row level security;
create policy "worker_jobs_select_own" on public.worker_jobs
  for select using (auth.uid() = user_id);
create policy "worker_jobs_insert_own" on public.worker_jobs
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private per-user genome bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('genomes', 'genomes', false)
on conflict (id) do nothing;

create policy "genomes_select_own" on storage.objects
  for select using (
    bucket_id = 'genomes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "genomes_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'genomes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "genomes_update_own" on storage.objects
  for update using (
    bucket_id = 'genomes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "genomes_delete_own" on storage.objects
  for delete using (
    bucket_id = 'genomes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
