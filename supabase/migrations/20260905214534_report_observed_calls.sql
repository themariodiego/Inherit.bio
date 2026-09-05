-- Literal observed calls are genetic source rows, separate from variant-only
-- ancestry/PRS/carrier inputs. No historical source is reprocessed here.
alter table public.genome_files
  add constraint genome_files_report_call_owner_key unique (id, user_id, subject_id),
  add column observed_call_sha256 text check (observed_call_sha256 ~ '^[0-9a-f]{64}$'),
  add column observed_call_version text,
  add constraint genome_files_observed_call_completion_check check (
    (observed_call_sha256 is null and observed_call_version is null)
    or (observed_call_sha256 is not null and observed_call_version = 'vcf-literal-diploid-snp-v1')
  );

create table public.report_observed_calls (
  file_id uuid not null,
  user_id uuid not null,
  subject_id uuid not null,
  source_line bigint not null check (source_line > 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  extraction_version text not null check (extraction_version = 'vcf-literal-diploid-snp-v1'),
  source_build text not null check (source_build in ('GRCh37','GRCh38')),
  source_chrom smallint not null check (source_chrom between 1 and 25),
  source_pos bigint not null check (source_pos > 0),
  source_ref text not null check (source_ref ~ '^[ACGT]$'),
  source_alt text not null check (source_alt ~ '^[ACGT]$' and source_alt <> source_ref),
  source_gt text,
  rsid bigint not null check (rsid > 0),
  chrom smallint not null check (chrom between 1 and 25),
  pos bigint not null check (pos > 0),
  ref text not null check (ref ~ '^[ACGT]$'),
  alt text not null check (alt ~ '^[ACGT]$' and alt <> ref),
  genotype text not null check (genotype = '--' or genotype ~ '^[ACGT]/[ACGT]$'),
  site_filter text,
  sample_filter text,
  genotype_quality numeric check (genotype_quality >= 0),
  read_depth numeric check (read_depth >= 0),
  quality_state text not null check (quality_state in ('pass','unknown','failed')),
  usable boolean not null,
  primary key (file_id, source_line),
  foreign key (file_id, user_id, subject_id)
    references public.genome_files(id, user_id, subject_id) on delete cascade on update cascade,
  check (not usable or (genotype <> '--' and quality_state <> 'failed' and source_gt ~ '^[01][/|][01]$'))
);
create index report_observed_calls_subject_rsid_idx on public.report_observed_calls(subject_id, rsid, file_id);
alter table public.report_observed_calls enable row level security;
revoke all on public.report_observed_calls from anon, authenticated;
grant select on public.report_observed_calls to authenticated;
grant all on public.report_observed_calls to service_role;
-- Subject rows are not exposed to authenticated clients. This narrow private
-- predicate checks the actual caller, never a caller-supplied owner identity.
create or replace function private.report_observed_call_readable_v1(p_file_id uuid, p_sha256 text, p_version text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.genome_files f join public.subjects s on s.id=f.subject_id
    where f.id=p_file_id and f.user_id=(select auth.uid())
      and s.owner_account_id=(select auth.uid()) and s.lifecycle='active'
      and f.status='annotated' and f.observed_call_sha256=p_sha256 and f.observed_call_version=p_version
  );
$$;
revoke all on function private.report_observed_call_readable_v1(uuid,text,text) from public,anon;
grant execute on function private.report_observed_call_readable_v1(uuid,text,text) to authenticated;
create policy report_observed_calls_select_owner on public.report_observed_calls
  for select to authenticated using (
    user_id = (select auth.uid()) and private.report_observed_call_readable_v1(file_id,source_sha256,extraction_version)
  );
insert into public.purge_target_stores(target_id, store_name, store_order)
  values ('variant-rows','public.report_observed_calls',3);
comment on table public.report_observed_calls is
  'Exact source-bound observed SNP calls, including unusable-call evidence; variant-rows retention, file/owner/subject composite FK cascade. Never infer reference from absence or block anchors.';
