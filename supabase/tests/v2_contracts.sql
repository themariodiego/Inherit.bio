begin;
select plan(22);

select is((select count(*) from public.retention_registry), 49::bigint,
  'all 49 retention IDs are registered exactly once');
select is((select count(*) from public.retention_phase_registry), 53::bigint,
  '52 scheduled phases plus the canonical own-report revocation phase are registered');
select is((select count(*) from public.purge_manifest_classes), 25::bigint,
  'all 25 purge manifest classes are registered');
select is((select count(*) from public.purge_targets), 33::bigint,
  'all 33 ordered purge targets are registered');
-- Canonical normalization adds private.own_normalization_batches and
-- private.own_normalization_runs; report generation adds private.own_analysis_runs.
-- Incremental VCF preparation adds the genetic own_normalization_positions index.
-- The inactive object backend also registers its job and artifact identities.
select is((select count(*) from public.purge_target_stores), 119::bigint,
  'all 119 purge stores, including private prepared-object working identities, are classified');
select is((select target_id from public.purge_target_stores
  where store_name='private.own_preparation_jobs'),'variant-rows',
  'preparation jobs belong to the source-working purge inventory');
select is((select target_id from public.purge_target_stores
  where store_name='private.own_preparation_artifacts'),'variant-rows',
  'preparation artifacts retain registered cleanup membership');
select is((select target_id from public.purge_target_stores
  where store_name = 'public.embryo_ingest_chunks'), 'upload-and-ingest-working-state',
  'chunk receipts are classified for attempt cleanup');
select is((select target_id from public.purge_target_stores
  where store_name='public.embryo_ingest_delete_objects'),'upload-and-ingest-working-state',
  'exact unwind object inventory is classified for attempt cleanup');
select is((select target_id from public.purge_target_stores
  where store_name='public.embryo_ingest_unwinds'),'upload-and-ingest-working-state',
  'unwind planning identity is classified for attempt cleanup');
select is((select count(*) from public.risk_models where subject_class = 'embryo'), 0::bigint,
  'the empty embryo allowlist produces no enabled model binding');

select is(has_table_privilege('authenticated', 'public.worker_jobs', 'insert'), false,
  'authenticated clients cannot enqueue worker jobs');
select is(has_table_privilege('authenticated', 'public.embryo_scores', 'select'), false,
  'authenticated clients cannot directly read embryo scores');
select is(has_function_privilege('authenticated', 'public.processing_time_stats()', 'execute'), false,
  'the cross-account processing aggregate is no longer client executable');

select is(
  private.worker_job_idempotency_key(
    'score_embryo', 'embryo.single-locus', 'cohort',
    '40000000-0000-0000-0000-000000000004', 'cohort-source-set',
    '30000000-0000-0000-0000-000000000003', 1, repeat('a', 64), 'v1'
  ),
  private.worker_job_idempotency_key(
    'score_embryo', 'embryo.single-locus', 'cohort',
    '40000000-0000-0000-0000-000000000004', 'cohort-source-set',
    '30000000-0000-0000-0000-000000000003', 1, repeat('a', 64), 'v1'
  ),
  'identical worker tuples replay the same key'
);
select isnt(
  private.worker_job_idempotency_key(
    'score_embryo', 'embryo.single-locus', 'cohort',
    '40000000-0000-0000-0000-000000000004', 'cohort-source-set',
    '30000000-0000-0000-0000-000000000003', 1, repeat('a', 64), 'v1'
  ),
  private.worker_job_idempotency_key(
    'score_embryo', 'embryo.statistical-estimate', 'cohort',
    '40000000-0000-0000-0000-000000000004', 'cohort-source-set',
    '30000000-0000-0000-0000-000000000003', 1, repeat('a', 64), 'v1'
  ),
  'distinct embryo output kinds produce distinct worker keys'
);

select ok(private.valid_embryo_findings(
  '[{"embryo_label":"Embryo 1","condition_id":"fixture","condition_name":"Fixture","finding":null,"evidence_label":"preliminary","coverage_state":"not_covered","citation_ids":[],"not_covered_reason":"model_unavailable"}]'::jsonb
), 'the exact eight-key embryo finding leaf is accepted');
select is(private.valid_embryo_findings(
  '[{"embryo_label":"Embryo 1","condition_id":"fixture","condition_name":"Fixture","finding":null,"evidence_label":"preliminary","coverage_state":"not_covered","citation_ids":[],"not_covered_reason":"model_unavailable","sex":"XX"}]'::jsonb
), false, 'an extra sex field is rejected from the embryo finding leaf');

select is((private.append_legal_audit_event(
  'test.first', null, null, 'completed', '{"code":"first"}'::jsonb
)).seq, 1::bigint, 'the database allocates the first audit sequence');
select is((private.append_legal_audit_event(
  'test.second', null, null, 'completed', '{"code":"second"}'::jsonb
)).seq, 2::bigint, 'the database allocates the next audit sequence');
select ok((select bool_and(b.occurred_at >= a.occurred_at)
  from public.legal_audit_log a
  join public.legal_audit_log b on b.seq = a.seq + 1),
  'audit timestamps are monotonic');
select throws_ok(
  $$delete from public.legal_audit_log where seq = 1$$,
  '42501', 'legal audit ledger is append-only',
  'direct audit deletion is denied'
);

select * from finish();
rollback;
