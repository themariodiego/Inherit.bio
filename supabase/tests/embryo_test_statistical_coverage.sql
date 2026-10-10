-- Pure-input native controls. This file never installs disposable admission,
-- creates authority or inserts a result; the real browser worker proves that.
begin;
select plan(19);
create function pg_temp.statistical_source() returns jsonb language sql as $$
 select '{"cohort_id":"90000000-0000-4000-8000-000000000001","embryo_id":"90000000-0000-4000-8000-000000000002",
 "subject_id":"90000000-0000-4000-8000-000000000003","file_id":"90000000-0000-4000-8000-000000000004",
 "canonical_build":"GRCh38","source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 "source_binding_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 "source_publication_revision":1,"upload_revision":1,"normalization_source_revision":1,
 "call_immutability_proof":"exact-staged-calls-v1"}'::jsonb;
$$;
create function pg_temp.statistical_calls(n integer) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('fileId',pg_temp.statistical_source()->'file_id',
 'chrom',row->'chrom','pos',row->'pos','ref',row->'otherAllele','alt',row->'effectAllele',
 'genotype',(row->>'otherAllele')||'/'||(row->>'effectAllele')) order by ordinal),'[]'::jsonb)
 from jsonb_array_elements(private.embryo_test_statistical_panel_v1()->'variants') with ordinality as v(row,ordinal)
 where ordinal<=n;
$$;
select is((select count(*) from private.embryo_test_statistical_admission),0::bigint,'admission is empty by default');
select is(private.current_embryo_test_statistical_admission_v1(),null::jsonb,'absence denies before private source reads');
select ok(not has_table_privilege('service_role','private.embryo_test_statistical_admission','INSERT'),'worker cannot install admission');
select ok(not has_table_privilege('authenticated','private.embryo_test_statistical_admission','UPDATE'),'API cannot modify admission');
select is(jsonb_array_length(private.embryo_carrier_registry_v1()->'conditions'),0,'clinical registry stays empty');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),'[]')#>>'{measurement,matchedVariants}','0','no calls does not fabricate matches');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(7))#>>'{measurement,scoreCoverage}','0.7','seven retains complete denominator');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(7))#>>'{finding,kind}','coverage_failure','below floor emits only coverage failure');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(8))->'finding','null'::jsonb,'inclusive floor does not invent a fitted model');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(10))#>>'{measurement,scoreCoverage}','1','all complete rows counted');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(1)||pg_temp.statistical_calls(1))#>>'{measurement,matchedVariants}','1','agreeing duplicates cannot add positions');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(1)||jsonb_set(pg_temp.statistical_calls(1),'{0,genotype}','"G/G"'))#>>'{measurement,rows,0,state}','source_call_disputed','conflicting duplicates cannot select first dose');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),jsonb_set(pg_temp.statistical_calls(1),'{0,genotype}','"--"'))#>>'{measurement,rows,0,state}','not_covered','unreadable call stays in denominator');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),jsonb_set(pg_temp.statistical_calls(1),'{0,genotype}','"A"'))->>'reason','invalid_calls','haploid input refused');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),jsonb_set(pg_temp.statistical_calls(1),'{0,fileId}','"90000000-0000-4000-8000-000000000099"'))->>'reason','invalid_calls','foreign source refused');
select is(private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),jsonb_set(pg_temp.statistical_calls(1),'{0,ref}','null'))->>'reason','invalid_calls','null allele pair fails closed');
select is(private.measure_embryo_test_statistical_v1(jsonb_set(pg_temp.statistical_source(),'{source_sha256}','null'),pg_temp.statistical_calls(1))->>'reason','invalid_source','null source hash fails closed');
select is(private.measure_embryo_test_statistical_v1(jsonb_set(jsonb_set(pg_temp.statistical_source(),'{source_sha256}',to_jsonb(repeat('1',64)::numeric)),
 '{source_binding_fingerprint}',to_jsonb(repeat('1',64)::numeric)),pg_temp.statistical_calls(1))->>'reason','invalid_source','numeric JSON cannot impersonate source hash text');
select ok(not ((private.measure_embryo_test_statistical_v1(pg_temp.statistical_source(),pg_temp.statistical_calls(10))->'measurement') ?| array['raw_score','percentile','absolute_risk','interval']),'no risk or raw score fields exist');
select * from finish();
rollback;
