-- The authoritative `embryo.stored-or-unknown-24mo` deadline, the Record Key
-- Card `date_revision` bump and the date-only addenda, set by the terminal
-- publication transaction (register `policyResolvers.embryo-ingest-session-v1.
-- workerCompletion`; `docs/retention.md#embryo-stored-or-unknown-24mo`).
-- TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE` stays false and
-- `private.embryo_split_config` stays off.
--
-- At the publication commit, for every ordinal:
--   * the deadline is the commit time plus 24 months. A source is anchored at
--     its actual upload (the same commit time; nothing was analysed yet). A
--     `qc_fail` is anchored at its own terminal publication, cannot be
--     renewed, and borrows no sibling's time;
--   * the card date becomes that deadline's date, `definitive_stored_or_unknown`,
--     with `date_revision` + 1, and the cohort deadline follows;
--   * one `embryo.stored-or-unknown-24mo` retention row on the embryo subject,
--     with its three registered phases (a notice 30 days before, then deny and
--     purge at the deadline) and a frozen `complete-retention` purge manifest.
--     The phase envelope records the branch, the anchor and the publication
--     revision;
--   * addenda to every current Record Key recipient, as `record-key-addendum`
--     outbox rows with no key: a source gets `date-changed` only when the
--     printed date changes; a `qc_fail` always gets one `no-source` notice
--     that carries its date, once per ordinal and publication revision. If a
--     required row cannot be created the whole publication rolls back.
-- A later transfer, donation or discard supersedes the row and cancels its
-- open phases, so the stored-branch purge can never run on such an embryo.
--
-- Not here: the upload-time rights notice (reported to the lead: the
-- `embryo-parent-withdrawal` credential it must carry has no redemption path
-- yet), renewal of a source deadline, and the executor for these phases.

-- ---------------------------------------------------------------------------
-- 1. Dates, retention rows and addenda
-- ---------------------------------------------------------------------------

create function private.embryo_publication_dates_v1(p_cohort_id uuid, p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.embryo_cohorts%rowtype;
  v_embryo public.embryos%rowtype;
  v_deadline timestamptz := p_now + interval '24 months';
  v_date date := (p_now + interval '24 months')::date;
  v_recipients uuid[];
  v_recipient uuid;
  v_branch text;
  v_changed boolean;
  v_row uuid;
  v_payload jsonb;
  v_key text;
  v_envelope jsonb;
begin
  select * into strict c from public.embryo_cohorts where id = p_cohort_id;
  if c.publication_revision is distinct from 1 or c.status <> 'active' then
    raise exception using errcode = '55000', message = 'publication dates unavailable';
  end if;
  v_recipients := private.embryo_cohort_set_v1(c.id, 'record_key_recipients');
  for v_embryo in select * from public.embryos x where x.cohort_id = c.id order by x.sample_ordinal for update
  loop
    if v_embryo.status not in ('qc_pass', 'qc_marginal', 'qc_fail')
      or v_embryo.closing_date_state <> 'provisional_until_terminal_ordinal_resolution' then
      raise exception using errcode = '55000', message = 'publication dates unavailable';
    end if;
    v_branch := case when v_embryo.status = 'qc_fail' then 'no-source' else 'source' end;
    v_changed := v_embryo.closing_date is distinct from v_date;
    update public.embryos
      set retention_expires_at = v_deadline, closing_date = v_date,
        closing_date_state = 'definitive_stored_or_unknown', date_revision = date_revision + 1
      where id = v_embryo.id
      returning * into v_embryo;

    v_envelope := jsonb_build_object('branch', v_branch, 'anchor', p_now,
      'renewable', v_branch = 'source', 'publicationRevision', c.publication_revision);
    insert into public.retention_rows (retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state)
    values ('embryo.stored-or-unknown-24mo', 'subject', v_embryo.subject_id, v_embryo.date_revision,
      c.lifecycle_revision, v_embryo.disposition_revision, v_deadline, 'scheduled')
    returning id into v_row;
    insert into public.retention_due_phases (retention_row_id, retention_id, phase_id, phase_kind,
      phase_revision, phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind, recipient_authority_revision, immutable_envelope)
    values
      (v_row, 'embryo.stored-or-unknown-24mo', 'stored-expiry-notice-30d', 'notice-enqueue', 1,
        v_deadline - interval '30 days', 'subject', v_embryo.subject_id, c.lifecycle_revision,
        v_embryo.disposition_revision, 'notice-recipients', c.participant_set_revision, v_envelope),
      (v_row, 'embryo.stored-or-unknown-24mo', 'stored-expiry-deny', 'deny', 1,
        v_deadline, 'subject', v_embryo.subject_id, c.lifecycle_revision,
        v_embryo.disposition_revision, 'notice-recipients', c.participant_set_revision, v_envelope),
      (v_row, 'embryo.stored-or-unknown-24mo', 'stored-expiry-purge', 'purge', 1,
        v_deadline, 'subject', v_embryo.subject_id, c.lifecycle_revision,
        v_embryo.disposition_revision, 'notice-recipients', c.participant_set_revision, v_envelope);
    insert into public.purge_manifests (retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state)
    values (v_row, 'stored-expiry-purge', 1, 'complete-retention', 1,
      encode(extensions.digest(convert_to(concat_ws(':', 'embryo-stored-v1', v_embryo.id::text,
        v_embryo.date_revision::text, v_branch), 'UTF8'), 'sha256'), 'hex'),
      'frozen');

    -- A no-key addendum to every current Record Key recipient: the date for
    -- a source only when it moved, and always the no-source notice.
    if v_branch = 'no-source' or v_changed then
      v_payload := jsonb_build_object('kind', case v_branch when 'no-source' then 'no-source' else 'date-changed' end,
        'displayLabel', 'Embryo ' || (v_embryo.sample_ordinal + 1)::text,
        'closingDateIso', to_char(v_date, 'YYYY-MM-DD'), 'closingDateWords', to_char(v_date, 'FMDD FMMonth YYYY'));
      foreach v_recipient in array v_recipients loop
        v_key := encode(extensions.digest(convert_to(concat_ws(':', 'record-key-addendum', v_payload->>'kind',
          v_embryo.id::text, case v_branch when 'no-source' then 'publication-' || c.publication_revision::text
            else 'date-' || v_embryo.date_revision::text end, v_recipient::text), 'UTF8'), 'sha256'), 'hex');
        if private.enqueue_embryo_principal_mail_v1(v_recipient, 'record-key-addendum', 'record-key-addendum',
            'embryo', v_embryo.id, v_payload, v_key, least(p_now + interval '30 days', v_deadline), null, null) is null then
          raise exception using errcode = '55000', message = 'record key addendum unavailable';
        end if;
      end loop;
    end if;
  end loop;
  update public.embryo_cohorts set retention_expires_at = v_deadline where id = c.id;
end $$;

-- A transfer, donation or discard leaves this class: its row is superseded,
-- its open phases are cancelled and its purge manifest is cancelled.
create function private.supersede_embryo_stored_retention_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if new.status in ('transferred', 'donated', 'discarded') and old.status is distinct from new.status then
    update public.retention_due_phases p set status = 'cancelled',
        terminal_outcome_code = 'disposition_superseded', completed_at = v_now
      from public.retention_rows r
      where p.retention_row_id = r.id and r.retention_id = 'embryo.stored-or-unknown-24mo'
        and r.target_kind = 'subject' and r.target_id = new.subject_id
        and r.state in ('scheduled', 'active') and p.status in ('pending', 'retry');
    update public.purge_manifests m set state = 'cancelled'
      from public.retention_rows r
      where m.retention_row_id = r.id and r.retention_id = 'embryo.stored-or-unknown-24mo'
        and r.target_kind = 'subject' and r.target_id = new.subject_id
        and r.state in ('scheduled', 'active') and m.state = 'frozen';
    update public.retention_rows set state = 'superseded', ended_at = v_now
      where retention_id = 'embryo.stored-or-unknown-24mo' and target_kind = 'subject'
        and target_id = new.subject_id and state in ('scheduled', 'active');
  end if;
  return new;
end $$;
create trigger embryo_stored_retention_superseded after update of status on public.embryos
  for each row execute function private.supersede_embryo_stored_retention_v1();

revoke all on function private.embryo_publication_dates_v1(uuid, timestamptz),
  private.supersede_embryo_stored_retention_v1()
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 2. Publication: 20260930123000's body, plus the call above
-- ---------------------------------------------------------------------------

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

notify pgrst, 'reload schema';
