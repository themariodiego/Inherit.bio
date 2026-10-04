-- A distinct private-refusal synthetic cohort: the completed upload of
-- embryo_ingest_completed.inc run through the split worker's own functions
-- and the whole-cohort publication, exactly as
-- supabase/tests/embryo_split_publication.sql drives them. Embryo 1 passes,
-- embryo 2 fails QC with a closed reason and no source, embryo 3 is
-- also passes. Calls are synthetic haploid, multiallelic and literal N rows; no genome.
\ir embryo_ingest_completed.inc

update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.split_token() returns text language sql as $$
  select encode(extensions.digest('synthetic-cohort-copilot-claim','sha256'),'hex');
$$;
create function pg_temp.split_outcome(p_outcome text,p_verdict text,p_reasons text[],p_called integer,p_rows integer,
  p_reason text default null) returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('figure_basis',pg_temp.qc_receipt(0.4,12.5),'sites_expected',10,'sites_called',p_called,
    'call_rate',p_called::double precision/10,'autosomal_het_rate',0.4,'mean_depth',12.5,
    'qc_verdict',p_verdict,'qc_reasons',to_jsonb(p_reasons)),'failureReason',p_reason,'variantCount',p_rows);
$$;
create temporary table split_claim as
  select public.claim_embryo_split_job_v1(pg_temp.split_token(),'synthetic-worker') as body;
select public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.split_token(),0,0,
  '[[1,1000,"A","G","G"],[7,3000,"T","C,G","C/G"],[1,1001,"A","N","N/A"]]');
select public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.split_token(),2,0,
  '[[13,4000,"A","G","G/G"]]');
select is(pg_temp.land_parts(0,pg_temp.split_token()),2,'fixture: both first-embryo canonical parts are acknowledged before passing');
select is(pg_temp.land_parts(2,pg_temp.split_token()),2,'fixture: both third-embryo canonical parts are acknowledged before passing');
select public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.split_token(),0,
  pg_temp.split_outcome('passed','pass','{}',10,3));
select public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.split_token(),1,
  pg_temp.split_outcome('qc_fail_no_source','fail',array['embryo_call_rate'],7,0,'embryo_call_rate'));
select public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.split_token(),2,
  pg_temp.split_outcome('passed','pass','{}',10,1));
create temporary table published as
  select public.publish_embryo_split_v1((select id from job),1,pg_temp.split_token()) as body;
select is((select body->>'status' from published),'published','fixture: the whole cohort publishes');
