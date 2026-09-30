-- Synthetic canonical publication for the Future Person custody boundary.
\ir account_cohort_r2_ingest_completed.inc

update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-restriction-claim','sha256'),'hex');
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_rows integer) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('sites_expected',10,
    'sites_called',case p_outcome when 'passed' then 10 else 6 end,
    'call_rate',case p_outcome when 'passed' then 1 else 0.6 end,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',case p_outcome when 'passed' then '[]'::jsonb else '["embryo_call_rate"]'::jsonb end),
    'failureReason',case p_outcome when 'passed' then null else 'embryo_call_rate' end,'variantCount',p_rows);
$$;
create function pg_temp.restrict(p_nonce text) returns void language sql as $$
  select public.restrict_embryo_cohort_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',(select cohort_id from live),p_nonce);
$$;

-- ---------------------------------------------------------------------------
-- The published cohort
-- ---------------------------------------------------------------------------
select is((public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker')->>'attempt')::integer,1,
  'the split job is claimed');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),0,0,
  '[[1,1000,"A","G","A/G"],[7,3000,"T","C","C/C"]]')->>'rows','2','embryo 1 stages its calls');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),2,0,
  '[[22,9000,"C","T","C/T"]]')->>'rows','1','embryo 3 stages its call');
select is(pg_temp.land_parts(0,pg_temp.token())+pg_temp.land_parts(2,pg_temp.token()),4,
  'embryos 1 and 3 are copied into canonical parts');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),0,
  pg_temp.outcome('passed','pass',2))->>'outcome','passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),1,
  pg_temp.outcome('qc_fail_no_source','fail',0))->>'outcome','qc_fail_no_source','embryo 2 fails QC');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),2,
  pg_temp.outcome('passed','marginal',1))->>'outcome','passed','embryo 3 is marginal');
select is(public.publish_embryo_split_v1((select id from job),1,pg_temp.token())->>'status','published',
  'the cohort publishes two sources');
create temporary table sources as select x.file_id, x.embryo_id, x.subject_id from private.embryo_canonical_sources x
  where x.cohort_id=(select cohort_id from live);
create temporary table source_parts as select m.part_id id, p.provider_bucket||'/'||p.provider_key object
  from private.embryo_canonical_source_parts m join private.embryo_canonical_parts p on p.id=m.part_id
  where m.file_id in (select file_id from sources);
select is((select count(*) from sources),2::bigint,'two canonical sources exist');
select is((select count(*) from source_parts),4::bigint,'they bind four parts');

