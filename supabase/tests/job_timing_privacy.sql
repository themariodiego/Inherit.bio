begin;
select plan(38);

insert into auth.users (id, email, raw_user_meta_data)
values ('8f000000-0000-0000-0000-000000000001', 'timing-owner@example.invalid', '{}'),
  ('8f000000-0000-0000-0000-000000000002', 'timing-reader@example.invalid', '{}');
insert into public.subjects (owner_account_id, subject_account_id, subject_class, upload_class, display_label)
select '8f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001', 'self', 'self', 'Timing test'
where not exists (select 1 from public.subjects where subject_account_id = '8f000000-0000-0000-0000-000000000001');

create function pg_temp.add_timing_jobs(p_n integer, p_kind text, p_age interval default interval '1 day', p_seconds integer default 100)
returns void language sql as $$
  insert into public.worker_jobs (user_id, subject_id, kind, status, output_kind,
    source_binding_kind, source_binding_id, source_binding_revision, file_sha256,
    computation_revision, idempotency_key, created_at, started_at, finished_at)
  select '8f000000-0000-0000-0000-000000000001',
    (select id from public.subjects where subject_account_id = '8f000000-0000-0000-0000-000000000001'),
    p_kind, 'done',
    case p_kind when 'compute_portrait' then 'family.portrait' when 'score_embryo' then 'embryo.single-locus' else 'ingest.normalize' end,
    case p_kind when 'compute_portrait' then 'family-pair-source-set' when 'score_embryo' then 'cohort-source-set' else 'embryo-ingest-fragment-set' end,
    gen_random_uuid(), 1, repeat('a',64), 'timing-test-v1', repeat(md5(gen_random_uuid()::text),2),
    now() - p_age - make_interval(secs => p_seconds), now() - p_age - make_interval(secs => p_seconds), now() - p_age
  from generate_series(1,p_n);
$$;

select is((select n_bucket from public.job_time_stats('compute_portrait')), '<20', 'zero jobs has only a bucket');
select is((select p50_seconds from public.job_time_stats('compute_portrait')), null, 'zero jobs withholds median');
select is((select p95_seconds from public.job_time_stats('compute_portrait')), null, 'zero jobs withholds p95');
select pg_temp.add_timing_jobs(19,'compute_portrait');
select is((select n_bucket from public.job_time_stats('compute_portrait')), '<20', 'nineteen jobs has the same bucket');
select is((select p50_seconds from public.job_time_stats('compute_portrait')), null, 'nineteen jobs withholds median');
select is((select p95_seconds from public.job_time_stats('compute_portrait')), null, 'nineteen jobs withholds p95');
select pg_temp.add_timing_jobs(1,'compute_portrait',interval '1 day',300);
select is((select n_bucket from public.job_time_stats('compute_portrait')), '20-99', 'twenty jobs reaches middle bucket');
select is((select p50_seconds from public.job_time_stats('compute_portrait')), 100, 'median computed from eligible jobs');
select is((select p95_seconds from public.job_time_stats('compute_portrait')), 110, 'p95 is computed, not the old p90 of 100');
select pg_temp.add_timing_jobs(79,'compute_portrait');
select is((select n_bucket from public.job_time_stats('compute_portrait')), '20-99', 'ninety-nine remains middle bucket');
select pg_temp.add_timing_jobs(1,'compute_portrait');
select is((select n_bucket from public.job_time_stats('compute_portrait')), '100+', 'one hundred reaches final bucket');
select is((select array_agg(k order by k) from public.job_time_stats('compute_portrait') s,
  lateral jsonb_object_keys(to_jsonb(s)) k), array['n_bucket','p50_seconds','p95_seconds'], 'response exposes no exact count or legacy percentile');

select pg_temp.add_timing_jobs(19,'score_embryo',interval '89 days');
select pg_temp.add_timing_jobs(1,'score_embryo',interval '90 days');
select pg_temp.add_timing_jobs(1,'score_embryo',interval '91 days');
select pg_temp.add_timing_jobs(1,'score_embryo',interval '-1 day');
select is((select n_bucket from public.job_time_stats('score_embryo')), '<20', 'exact ninety-day boundary, older and future finishes excluded');
select is((select p50_seconds from public.job_time_stats('score_embryo')), null, 'time-window exclusions cannot lift suppression');
select pg_temp.add_timing_jobs(1,'score_embryo',interval '90 days' - interval '1 second');
select is((select n_bucket from public.job_time_stats('score_embryo')), '20-99', 'just within ninety days is included, not only thirty days');

select pg_temp.add_timing_jobs(11,'split_cohort_vcf');
-- Eleven separately invalid rows; without each filter nineteen good jobs below
-- would cross the reporting threshold. No production constraints are disabled.
update public.worker_jobs set
  status = case n when 1 then 'failed' when 2 then 'queued' when 3 then 'cancelled' when 11 then 'running' else 'done' end,
  claim_token_hash = case when n=11 then repeat('a',64) end,
  claim_expires_at = case when n=11 then now()+interval '1 minute' end,
  claimed_by = case when n=11 then 'timing-test' end,
  partial = n = 4,
  finished_at = case n when 5 then null else finished_at end,
  started_at = case n when 6 then finished_at + interval '1 second'
    when 7 then created_at - interval '1 second' when 8 then '-infinity'::timestamptz
    when 9 then '1900-01-01'::timestamptz else started_at end,
  created_at = case n when 8 then '-infinity'::timestamptz when 9 then '1900-01-01'::timestamptz
    when 10 then '-infinity'::timestamptz else created_at end
from (select id, row_number() over (order by id) n from public.worker_jobs where kind='split_cohort_vcf') bad
where worker_jobs.id=bad.id;
select pg_temp.add_timing_jobs(19,'split_cohort_vcf');
select is((select n_bucket from public.job_time_stats('split_cohort_vcf')), '<20', 'invalid, unfinished, failed and partial jobs cannot lift threshold');
select is((select p95_seconds from public.job_time_stats('split_cohort_vcf')), null, 'invalid rows cannot produce p95');
select pg_temp.add_timing_jobs(1,'split_cohort_vcf', interval '2 days');
update public.worker_jobs set started_at=null where kind='split_cohort_vcf' and finished_at=now()-interval '2 days';
select is((select n_bucket from public.job_time_stats('split_cohort_vcf')), '20-99', 'missing start uses valid creation-to-finish duration');
select is((select p50_seconds from public.job_time_stats('split_cohort_vcf')), 100, 'creation fallback preserves measured seconds');

select throws_ok($$select public.job_time_stats('revoke_purge')$$,'22023','unsupported turnaround kind','revocation activity not exposed');
select throws_ok($$select public.job_time_stats('retention_purge')$$,'22023','unsupported turnaround kind','retention activity not exposed');
select throws_ok($$select public.job_time_stats('annotate_vcf')$$,'22023','unsupported turnaround kind','unrelated turnaround not mixed into report jobs');
select throws_ok($$select public.job_time_stats('align_fastq')$$,'22023','unsupported turnaround kind','withheld alignment kind refused');
select throws_ok($$select public.job_time_stats('call_variants')$$,'22023','unsupported turnaround kind','withheld variant-calling kind refused');
select throws_ok($$select public.job_time_stats('compute_ancestry_regional')$$,'22023','unsupported turnaround kind','ancestry timing not mixed with embryo and family timing');
select throws_ok($$select public.job_time_stats('unknown')$$,'22023','unsupported turnaround kind','unknown kind refused');
select throws_ok($$select public.job_time_stats(null)$$,'22023','unsupported turnaround kind','null kind refused');
select is(has_function_privilege('authenticated','public.job_time_stats(text)','execute'),true,'authenticated has execute');
select is(has_function_privilege('anon','public.job_time_stats(text)','execute'),false,'anon has no execute');
select is(has_function_privilege('service_role','public.job_time_stats(text)','execute'),true,'internal service keeps execute');

set local role anon;
select throws_ok($$select public.job_time_stats('compute_portrait')$$,'42501','permission denied for function job_time_stats','anon actual call refused');
reset role;
set local role authenticated;
select throws_ok($$select public.job_time_stats('compute_portrait')$$,'42501','authenticated account required','missing user claim refused');
select set_config('request.jwt.claim.sub','8f000000-0000-0000-0000-000000000002',true);
select is((select n_bucket from public.job_time_stats('compute_portrait')),'100+','signed-in aggregate is intentionally cross-account but count-bucketed');
select throws_ok($$select completed_count from public.job_time_stats('compute_portrait')$$,'42703','column "completed_count" does not exist','legacy exact-count projection impossible');
select throws_ok($$select p90_seconds from public.job_time_stats('compute_portrait')$$,'42703','column "p90_seconds" does not exist','no falsely labelled legacy percentile alias');
select throws_ok($$select count(*) from public.worker_jobs$$,'42501','permission denied for table worker_jobs','statistics do not grant raw-job access');
reset role;
set local role service_role;
select is((select n_bucket from public.job_time_stats('compute_portrait')),'100+','service call uses same coarse contract');
reset role;
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.job_time_stats(text)'::regprocedure),'definer search path fixed');

select * from finish();
rollback;
