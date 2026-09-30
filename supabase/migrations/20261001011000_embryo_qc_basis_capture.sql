-- Only the real called-VCF producer can classify this revision. Historical rows
-- keep NULL; neither SQL nor readers reconstruct an old receipt.
alter table public.embryo_qc add column figure_basis jsonb;
alter table private.embryo_split_ordinals add column figure_basis jsonb;

create function private.valid_embryo_vcf_qc_basis_v1(p_receipt jsonb, p_het double precision, p_depth double precision)
returns boolean language sql immutable set search_path = '' as $basis$
  select coalesce(p_receipt = jsonb_build_object('version', 1, 'producer', 'embryo-split-calls-v1',
    'coverage', '{"version":1,"basis":"observed"}'::jsonb, 'call_rate', '{"version":1,"basis":"observed"}'::jsonb,
    'autosomal_het_rate', case when p_het is null then 'null'::jsonb else '{"version":1,"basis":"observed"}'::jsonb end,
    'mean_depth', case when p_depth is null then 'null'::jsonb else '{"version":1,"basis":"observed"}'::jsonb end), false)
$basis$;
revoke all on function private.valid_embryo_vcf_qc_basis_v1(jsonb, double precision, double precision) from public, anon, authenticated, service_role;
-- CHECK expressions execute as the actual table writer. This pure immutable
-- validator reads only its arguments; it grants no classification mutation.
grant execute on function private.valid_embryo_vcf_qc_basis_v1(jsonb, double precision, double precision) to service_role;

alter table public.embryo_qc add constraint embryo_qc_figure_basis_closed check (figure_basis is null or
  (private.valid_embryo_vcf_qc_basis_v1(figure_basis, autosomal_het_rate, mean_depth)
    and sites_expected > 0 and call_rate = sites_called::double precision / sites_expected
    and parent_a_concordance is null and parent_b_concordance is null
    and allelic_dropout_estimate is null and allelic_dropout_interval_low is null
    and allelic_dropout_interval_high is null and contamination_estimate is null));
alter table private.embryo_split_ordinals add constraint embryo_split_qc_basis_closed check (figure_basis is null or
  private.valid_embryo_vcf_qc_basis_v1(figure_basis, autosomal_het_rate, mean_depth));


-- A saved classification is not a label that can be backfilled or erased later.
create function private.guard_embryo_qc_figure_basis_v1()
returns trigger language plpgsql set search_path = '' as $guard$
begin
  if new.figure_basis is distinct from old.figure_basis then
    raise exception using errcode = '42501', message = 'immutable QC classification';
  end if;
  return new;
end $guard$;
revoke all on function private.guard_embryo_qc_figure_basis_v1() from public, anon, authenticated, service_role;
create trigger embryo_qc_figure_basis_immutable before update of figure_basis on public.embryo_qc
for each row execute function private.guard_embryo_qc_figure_basis_v1();
create trigger embryo_split_qc_basis_immutable before update of figure_basis on private.embryo_split_ordinals
for each row execute function private.guard_embryo_qc_figure_basis_v1();

create or replace function private.finish_embryo_split_ordinal_v1(
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
      is distinct from array['autosomal_het_rate', 'call_rate', 'figure_basis', 'mean_depth', 'qc_reasons',
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
  if not private.valid_embryo_vcf_qc_basis_v1(q->'figure_basis', (q->>'autosomal_het_rate')::double precision, (q->>'mean_depth')::double precision) then
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
      autosomal_het_rate, mean_depth, variant_count, source_sha256, figure_basis)
    values (s.id, p_ordinal, w.id, w.attempts, v_outcome, q->>'qc_verdict',
      array(select jsonb_array_elements_text(q->'qc_reasons')), p_result->>'failureReason',
      (q->>'sites_expected')::integer, (q->>'sites_called')::integer, (q->>'call_rate')::double precision,
      (q->>'autosomal_het_rate')::double precision, (q->>'mean_depth')::double precision,
      case when v_outcome = 'passed' then (p_result->>'variantCount')::integer else 0 end,
      case when v_outcome = 'passed' then private.embryo_split_source_sha256_v1(s.id, p_ordinal) end, q->'figure_basis');
  exception when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid split outcome';
  end;
  select count(*) into v_done from private.embryo_split_ordinals where session_id = s.id;
  return jsonb_build_object('status', 'recorded', 'ordinal', p_ordinal, 'outcome', v_outcome,
    'remaining', v_count - v_done);
end $$;

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

  if exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id and o.figure_basis is null) then
    raise exception using errcode = '22023', message = 'unclassified split QC';
  end if;

  -- One QC row per embryo, measured from its own calls only. What the file
  -- does not report stays null; nothing is estimated or imputed.
  insert into public.embryo_qc (embryo_id, sites_expected, sites_called, call_rate, autosomal_het_rate,
    mean_depth, parent_a_concordance, parent_b_concordance, allelic_dropout_estimate,
    imputation_performed, imputation_panel, contamination_estimate, qc_verdict, qc_reasons, computed_at, figure_basis)
  select e.id, o.sites_expected, o.sites_called, o.call_rate, o.autosomal_het_rate, o.mean_depth,
    null, null, null, false, null, null, o.qc_verdict,
    case when o.failure_reason is not null and not (o.failure_reason = any (o.qc_reasons))
      then o.qc_reasons || o.failure_reason else o.qc_reasons end,
    v_now, o.figure_basis
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

  -- Every ordinal's authoritative deadline, card date and addenda, from this
  -- commit time; a missing required addendum rolls the whole commit back.
  perform private.embryo_publication_dates_v1(c.id, v_now);

  -- The upload-time rights notice, with its withdrawal credential, when the
  -- published set holds a genetic source (upload-time-rights-notice-v1.embryo).
  if v_passed > 0 then
    perform private.enqueue_embryo_upload_notices_v1(c.id, s.id, v_now);
  end if;

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
