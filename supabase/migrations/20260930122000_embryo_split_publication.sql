-- Whole-cohort publication for `split_cohort_vcf` (ADR 0020 decisions 1-3;
-- register `policyResolvers.embryo-ingest-session-v1.workerCompletion` and
-- `terminalResolutionBranches`). TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE`
-- stays false and `private.embryo_split_config` stays off.
--
-- One terminal transaction publishes every embryo ordinal at once, each
-- either with its own validated genotypes and QC (`qc_pass` or `qc_marginal`)
-- or as `qc_fail` with its closed reason and no source. Before it commits,
-- nothing about any embryo is visible: embryos stay `pending`, subjects stay
-- `quarantined`, and no QC, variant or score row exists. At commit:
--   * each embryo's QC row and, for a pass, exactly its own staged genotypes
--     are written, bound to its own composed fragment digest. Nothing moves
--     between ordinals, and no genotype is written that its own fragments did
--     not call (no parental substitution, no imputation);
--   * every embryo subject leaves quarantine together (G5.3);
--   * the cohort takes publication revision 1 and becomes `active`, with
--     `uploaded_at` when any embryo published a source, else `qc_failed_at`;
--   * the exact `embryo.ingest-session-24h` due phase for this ingest
--     revision is cancelled, the session is `published`, the job is `done`
--     (`partial` when any embryo failed QC), and the attempt-owned pending
--     rows are deleted.
--
-- Deliberately not here, and still required before activation:
--   * per-embryo canonical Storage objects and `genome_files` rows, and the
--     `normalization_complete` marking that depends on them;
--   * the authoritative `embryo.stored-or-unknown-24mo` deadline, the Record
--     Key card `date_revision` bump and the date-only addenda (the provisional
--     card date is left exactly as issued, never made authoritative);
--   * upload-time rights notices;
--   * deletion of fragment objects and the handle map after this commit.
-- No score job is evaluated or queued: `data/embryo/allowed_conditions.json`
-- is empty, so no condition is scored and the unavailable state stands.
-- No sex, karyotype or label is read or written; genotype rows are autosomal
-- only by the schema.

create function private.publish_embryo_split_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  v_failed jsonb;
  w public.worker_jobs%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype;
  v_now timestamptz;
  v_passed integer;
  v_qc_failed integer;
  v_cancelled integer;
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

  -- Each passed embryo's own genotypes, joined on its own ordinal and bound
  -- to its own fragment digest. A failed embryo gets none.
  insert into public.embryo_variants (embryo_id, source_file_id, chromosome, position,
    reference_allele, alternate_allele, genotype, source_binding_fingerprint)
  select e.id, null, v.chromosome, v.position, v.reference_allele, v.alternate_allele, v.genotype,
    o.source_sha256
  from private.embryo_split_variants v
  join private.embryo_split_ordinals o on o.session_id = v.session_id
    and o.sample_ordinal = v.sample_ordinal and o.outcome = 'passed'
  join public.embryos e on e.cohort_id = c.id and e.sample_ordinal = v.sample_ordinal
  where v.session_id = s.id
  order by v.sample_ordinal, v.batch, v.id;

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

  -- The pending rows are now the published rows; nothing attempt-owned remains.
  delete from private.embryo_split_variants where session_id = s.id;
  delete from private.embryo_split_ordinals where session_id = s.id;

  perform private.append_legal_audit_event(
    'embryo.cohort.published', null, null, 'accepted',
    jsonb_build_object('embryo_count', c.embryo_count, 'publication_revision', 1));

  return jsonb_build_object('status', 'published', 'publicationRevision', 1,
    'published', v_passed, 'qcFailed', v_qc_failed);
end $$;

revoke all on function private.publish_embryo_split_v1(uuid, integer, text)
  from public, anon, authenticated, inherit_upload_only, service_role;
grant execute on function private.publish_embryo_split_v1(uuid, integer, text) to service_role;

create function public.publish_embryo_split_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.publish_embryo_split_v1(p_job_id, p_attempt, p_claim_token_hash);
$$;
revoke all on function public.publish_embryo_split_v1(uuid, integer, text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.publish_embryo_split_v1(uuid, integer, text) to service_role;
