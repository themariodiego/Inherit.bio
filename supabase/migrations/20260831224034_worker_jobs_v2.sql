-- Immutable, idempotent v2 worker dispatch bindings.

create or replace function private.length_prefix_utf8(p_value text)
returns bytea
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(p_value, 'utf8')))
    || pg_catalog.convert_to(p_value, 'utf8')
$$;

revoke all on function private.length_prefix_utf8(text) from public, anon, authenticated;
grant execute on function private.length_prefix_utf8(text) to service_role;

create or replace function private.worker_job_idempotency_key(
  p_kind text,
  p_output_kind text,
  p_target_kind text,
  p_target_id uuid,
  p_source_binding_kind text,
  p_source_binding_id uuid,
  p_source_binding_revision bigint,
  p_file_sha256 text,
  p_computation_revision text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(
    private.length_prefix_utf8('worker-job-v2')
    || private.length_prefix_utf8(p_kind)
    || private.length_prefix_utf8(p_output_kind)
    || private.length_prefix_utf8(p_target_kind)
    || private.length_prefix_utf8(p_target_id::text)
    || private.length_prefix_utf8(p_source_binding_kind)
    || private.length_prefix_utf8(p_source_binding_id::text)
    || private.length_prefix_utf8(p_source_binding_revision::text)
    || private.length_prefix_utf8(p_file_sha256)
    || private.length_prefix_utf8(p_computation_revision),
    'sha256'
  ), 'hex')
$$;

revoke all on function private.worker_job_idempotency_key(
  text, text, text, uuid, text, uuid, bigint, text, text
) from public, anon, authenticated;
grant execute on function private.worker_job_idempotency_key(
  text, text, text, uuid, text, uuid, bigint, text, text
) to service_role;

alter table public.worker_jobs
  drop constraint worker_jobs_kind_check,
  drop constraint worker_jobs_status_check;

alter table public.worker_jobs
  add column subject_id uuid references public.subjects (id) on delete restrict,
  add column cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  add column target_kind text generated always as (
    case when subject_id is not null then 'subject' else 'cohort' end
  ) stored,
  add column output_kind text,
  add column source_binding_kind text,
  add column source_binding_id uuid,
  add column source_binding_revision bigint,
  add column file_sha256 text,
  add column computation_revision text,
  add column idempotency_key text,
  add column attempts smallint not null default 0,
  add column max_attempts smallint not null default 3,
  add column not_before timestamptz not null default clock_timestamp(),
  add column progress smallint not null default 0,
  add column progress_note text,
  add column partial boolean not null default false,
  add column claim_token_hash text,
  add column claim_expires_at timestamptz,
  add column claimed_by text;

update public.worker_jobs j
set subject_id = f.subject_id,
    output_kind = 'ingest.normalize',
    source_binding_kind = 'genome-file',
    source_binding_id = f.id,
    source_binding_revision = greatest(f.source_publication_revision, 1),
    file_sha256 = lower(f.sha256),
    computation_revision = 'legacy-v1'
from public.genome_files f
where j.file_id = f.id
  and j.kind = 'annotate_vcf';

do $$
begin
  if exists (
    select 1 from public.worker_jobs
    where subject_id is null and cohort_id is null
  ) then
    raise exception 'legacy worker job cannot be assigned a v2 target';
  end if;
end;
$$;

update public.worker_jobs
set idempotency_key = private.worker_job_idempotency_key(
  kind, output_kind, target_kind,
  coalesce(subject_id, cohort_id), source_binding_kind, source_binding_id,
  source_binding_revision, file_sha256, computation_revision
);

alter table public.worker_jobs
  alter column output_kind set not null,
  alter column source_binding_kind set not null,
  alter column source_binding_id set not null,
  alter column source_binding_revision set not null,
  alter column file_sha256 set not null,
  alter column computation_revision set not null,
  alter column idempotency_key set not null,
  add constraint worker_jobs_one_target_check
    check (num_nonnulls(subject_id, cohort_id) = 1),
  add constraint worker_jobs_kind_check check (kind in (
    'annotate_vcf', 'align_fastq', 'call_variants', 'split_cohort_vcf',
    'score_embryo', 'compute_portrait', 'compute_ancestry_regional',
    'revoke_purge', 'retention_purge'
  )),
  add constraint worker_jobs_status_check check (status in (
    'queued', 'running', 'done', 'failed', 'cancelled'
  )),
  add constraint worker_jobs_source_kind_check check (source_binding_kind in (
    'genome-file', 'embryo-ingest-fragment-set', 'cohort-source-set',
    'family-pair-source-set', 'revocation-disposition', 'retention-disposition'
  )),
  add constraint worker_jobs_output_kind_check check (output_kind in (
    'ingest.normalize', 'embryo.single-locus', 'embryo.statistical-estimate',
    'embryo.carrier-match', 'family.portrait', 'ancestry.estimate',
    'lifecycle.revoke-purge', 'lifecycle.retention-purge'
  )),
  add constraint worker_jobs_dispatch_check check (
    (kind = 'annotate_vcf' and output_kind = 'ingest.normalize' and source_binding_kind = 'genome-file')
    or (kind = 'split_cohort_vcf' and output_kind = 'ingest.normalize' and source_binding_kind = 'embryo-ingest-fragment-set')
    or (kind = 'score_embryo' and output_kind in ('embryo.single-locus', 'embryo.statistical-estimate', 'embryo.carrier-match') and source_binding_kind = 'cohort-source-set')
    or (kind = 'compute_portrait' and output_kind = 'family.portrait' and source_binding_kind = 'family-pair-source-set')
    or (kind = 'compute_ancestry_regional' and output_kind = 'ancestry.estimate' and source_binding_kind = 'genome-file')
    or (kind = 'revoke_purge' and output_kind = 'lifecycle.revoke-purge' and source_binding_kind = 'revocation-disposition')
    or (kind = 'retention_purge' and output_kind = 'lifecycle.retention-purge' and source_binding_kind = 'retention-disposition')
  ),
  add constraint worker_jobs_source_revision_check check (source_binding_revision > 0),
  add constraint worker_jobs_file_sha256_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint worker_jobs_idempotency_key_check check (idempotency_key ~ '^[0-9a-f]{64}$'),
  add constraint worker_jobs_attempts_check check (attempts between 0 and max_attempts and max_attempts between 1 and 20),
  add constraint worker_jobs_progress_check check (progress between 0 and 100),
  add constraint worker_jobs_progress_note_check check (progress_note is null or progress_note in (
    'queued', 'validating', 'parsing', 'normalizing', 'splitting', 'scoring',
    'aggregating', 'writing', 'purging', 'retrying', 'complete'
  )),
  add constraint worker_jobs_claim_shape_check check (
    (status = 'running') = (claim_token_hash is not null and claim_expires_at is not null and claimed_by is not null)
  );

create unique index worker_jobs_idempotency_idx on public.worker_jobs (idempotency_key);
create index worker_jobs_ready_idx on public.worker_jobs (status, not_before, created_at, id);

create or replace function private.guard_worker_job_binding_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    new.kind, new.output_kind, new.subject_id, new.cohort_id,
    new.source_binding_kind, new.source_binding_id, new.source_binding_revision,
    new.file_sha256, new.computation_revision, new.idempotency_key
  ) is distinct from row(
    old.kind, old.output_kind, old.subject_id, old.cohort_id,
    old.source_binding_kind, old.source_binding_id, old.source_binding_revision,
    old.file_sha256, old.computation_revision, old.idempotency_key
  ) then
    raise exception using errcode = '23514', message = 'worker job dispatch binding is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_worker_job_binding_update() from public, anon, authenticated;
grant execute on function private.guard_worker_job_binding_update() to service_role;
create trigger worker_jobs_binding_immutable
before update on public.worker_jobs
for each row execute function private.guard_worker_job_binding_update();

drop policy if exists "worker_jobs_select_own" on public.worker_jobs;
drop policy if exists "worker_jobs_insert_own" on public.worker_jobs;
revoke all on table public.worker_jobs from anon, authenticated;
grant all on table public.worker_jobs to service_role;
