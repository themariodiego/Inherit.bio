begin;
select no_plan();
\ir fixtures/embryo_ingest_completed.inc

-- ADR 0037, 20261016195000_embryo_table_call_hash.sql: a laboratory-table
-- attempt stages its genotypes with no reference allele and must publish
-- through the call fence, exactly as a VCF attempt does. Invented autosomal
-- calls only; no genome.
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

-- The completed fixture is recorded as a table attempt, with its manifest
-- recomputed so only the format differs (as embryo_canonical_sources.sql).
set local session_replication_role=replica;
update public.embryo_ingest_sessions set source_format='pgt_table' where id=(select id from live);
update public.embryo_ingest_sessions set manifest_sha256=private.embryo_ingest_manifest_sha256_v1(id) where id=(select id from live);
update public.worker_jobs set file_sha256=(select manifest_sha256 from public.embryo_ingest_sessions
  where id=(select id from live)) where id=(select id from job);
set local session_replication_role=origin;

create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-table-call-hash-claim','sha256'),'hex');
$$;
create function pg_temp.outcome(p_outcome text,p_verdict text,p_called integer,p_rows integer,p_reason text default null)
returns jsonb language sql as $$
  select jsonb_build_object('outcome',p_outcome,'qc',jsonb_build_object('figure_basis',pg_temp.qc_receipt(0.4,null),
    'sites_expected',10,'sites_called',p_called,'call_rate',p_called::double precision/10,'autosomal_het_rate',0.4,
    'mean_depth',null,'qc_verdict',p_verdict,
    'qc_reasons',case when p_reason is null then '[]'::jsonb else jsonb_build_array(p_reason) end),
    'failureReason',p_reason,'variantCount',p_rows);
$$;
create function pg_temp.hash(p_chr integer,p_position bigint,p_ref text,p_alt text,p_genotype text) returns text
language sql as $$ select private.embryo_call_value_hash_v1(p_chr,p_position,p_ref,p_alt,p_genotype) $$;

-- ---------------------------------------------------------------------------
-- The call hash
-- ---------------------------------------------------------------------------
select is(pg_temp.hash(1,22133085,'T','C','C/C'),'9f07a2324b90688b18cfddb64ab2e88983f8fa4e00551573dc1b60907b513637',
  'a call with a reference allele hashes exactly as before');
select is(pg_temp.hash(2,1000,'A',null,'A/A'),'2062e9f15b93e5529e93d74006eff0c31d4f51359a2fdf56b4b1c2cd7d44bdca',
  'a reference call with no alternate allele hashes exactly as before');
select isnt(pg_temp.hash(1,22133085,null,null,'T/T'),null,'a table call with no reference allele has a hash');
select isnt(pg_temp.hash(1,22133085,null,null,'T/T'),pg_temp.hash(1,22133085,'',null,'T/T'),
  'a missing reference allele never hashes as an empty one');
select isnt(pg_temp.hash(1,22133085,null,null,'T/T'),pg_temp.hash(1,22133085,'T',null,'T/T'),
  'a missing reference allele never hashes as a stated one');
select is(pg_temp.hash(1,22133085,null,null,'T/T'),pg_temp.hash(1,22133085,null,null,'T/T'),
  'the same table call always hashes the same');
select ok(not has_function_privilege('service_role','private.embryo_call_value_hash_v1(integer,bigint,text,text,text)','execute')
  and not has_function_privilege('authenticated','private.embryo_call_value_hash_v1(integer,bigint,text,text,text)','execute')
  and not has_function_privilege('anon','private.embryo_call_value_hash_v1(integer,bigint,text,text,text)','execute'),
  'no API role can call the hash');
select ok((select indisvalid and indisready from pg_index where indexrelid='private.embryo_split_exact_call_lookup'::regclass),
  'the fence''s lookup index is valid');

-- ---------------------------------------------------------------------------
-- A table attempt through the worker's own doors
-- ---------------------------------------------------------------------------
select is(public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker')->>'format','pgt_table',
  'the table attempt is claimed');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),0,0,
  '[[1,22133085,null,null,"T/T"],[7,3000,null,null,"C/G"]]')->>'rows','2','embryo 1 stages its called bases');
select is(public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),2,0,
  '[[13,4000,null,null,"G/G"]]')->>'rows','1','embryo 3 stages its called bases');
select is((select count(*) from private.embryo_split_variants v where v.session_id=(select id from live)
    and v.sample_ordinal=0 and v.worker_job_id=(select id from job) and v.attempt=1
    and private.embryo_call_value_hash_v1(v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype)
      =pg_temp.hash(1,22133085,null,null,'T/T')),1::bigint,
  'the fence finds a staged table call by its hash');
select is(pg_temp.land_parts(0,pg_temp.token()),2,'embryo 1 lands its two parts');
select is(pg_temp.land_parts(2,pg_temp.token()),2,'embryo 3 lands its two parts');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),0,
  pg_temp.outcome('passed','pass',10,2))->>'outcome','passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),1,
  pg_temp.outcome('qc_fail_no_source','fail',5,0,'embryo_call_rate'))->>'outcome','qc_fail_no_source','embryo 2 fails QC');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),2,
  pg_temp.outcome('passed','pass',10,1))->>'remaining','0','embryo 3 passes and every embryo has an outcome');

create temporary table published as select public.publish_embryo_split_v1((select id from job),1,pg_temp.token()) as body;
select is((select body from published),'{"status":"published","publicationRevision":1,"published":2,"qcFailed":1}'::jsonb,
  'the table cohort publishes two sources and one QC failure');
select is((select array_agg(format('%s:%s:%s',e.sample_ordinal,f.file_type,s.call_immutability_proof) order by e.sample_ordinal)
    from public.genome_files f join public.embryos e on e.subject_id=f.subject_id
    join private.embryo_canonical_sources s on s.file_id=f.id
    where e.cohort_id=(select cohort_id from live)),
  array['0:pgt_table:exact-staged-calls-v1','2:pgt_table:exact-staged-calls-v1'],
  'each passing embryo has one table source, fenced by its exact staged calls');
select is((select array_agg(format('%s:%s:%s:%s:%s:%s',e.sample_ordinal,v.chromosome,v.position,
      coalesce(v.reference_allele,'none'),coalesce(v.alternate_allele,'none'),v.genotype) order by e.sample_ordinal,v.id)
    from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
    where e.cohort_id=(select cohort_id from live)),
  array['0:1:22133085:none:none:T/T','0:7:3000:none:none:C/G','2:13:4000:none:none:G/G'],
  'each published table call is exactly its staged called bases, with no reference or alternate allele');
select ok((select bool_and(v.source_file_id=s.file_id and v.source_binding_fingerprint=s.source_sha256)
    from public.embryo_variants v join private.embryo_canonical_sources s on s.embryo_id=v.embryo_id
    where s.cohort_id=(select cohort_id from live)),
  'every published table call points at its own embryo''s source and digest');
select is((select status::text||':'||publication_revision from public.embryo_cohorts where id=(select cohort_id from live)),
  'active:1','the cohort is active at publication revision 1');
select is((select count(*) from private.embryo_split_variants where session_id=(select id from live)),0::bigint,
  'no staged table call remains after publication');
select throws_ok($$insert into public.embryo_variants(embryo_id,source_file_id,chromosome,position,reference_allele,
    alternate_allele,genotype,source_binding_fingerprint)
  select s.embryo_id,s.file_id,1,22133085,null,null,'T/T',s.source_sha256 from private.embryo_canonical_sources s
  where s.cohort_id=(select cohort_id from live) and s.sample_ordinal=0$$,'42501','embryo_source_unavailable',
  'a published table source takes no further call, even one equal to a published call');

select * from finish();
rollback;
