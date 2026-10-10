-- Source-authored native controls, UNRUN. Pure invented inputs supply no
-- current account, native source, admission, claim, score or read authority.
-- The additive genuine upload/worker/read journey exercises those doors.
begin;
select plan(35);

create function pg_temp.fit_source() returns jsonb language sql as $$
 select '{"cohort_id":"90000000-0000-4000-8000-000000000001","embryo_id":"90000000-0000-4000-8000-000000000002",
 "subject_id":"90000000-0000-4000-8000-000000000003","file_id":"90000000-0000-4000-8000-000000000004",
 "canonical_build":"GRCh38","source_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 "source_binding_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 "source_publication_revision":1,"upload_revision":1,"normalization_source_revision":1,
 "call_immutability_proof":"exact-staged-calls-v1"}'::jsonb;
$$;
create function pg_temp.fit_calls(n integer) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('fileId',pg_temp.fit_source()->'file_id',
  'chrom',row->'chrom','pos',row->'pos','ref',row->'otherAllele','alt',row->'effectAllele',
  'genotype',(row->>'otherAllele')||'/'||(row->>'effectAllele')) order by ordinal),'[]'::jsonb)
 from jsonb_array_elements(private.embryo_test_statistical_panel_v1()->'variants') with ordinality as v(row,ordinal) where ordinal<=n;
$$;
create function pg_temp.fit_qc(dropout jsonb default '0'::jsonb) returns jsonb language sql as $$
 select jsonb_build_object('callRate',1,'contamination',0,'alleleDropout',dropout);
$$;
create temporary table fitted_original on commit drop as
 select private.embryo_test_fit_package_raw_v1(private.embryo_test_fit_artifact_v1()) raw,
  private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1()) canonical;
create temporary table fitted_evaluations on commit drop as
 select n,private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),pg_temp.fit_calls(n),pg_temp.fit_qc()) result
 from generate_series(7,10) n;

select is((select count(*) from private.embryo_test_statistical_admission),0::bigint,'migration installs no runtime admission');
select is(private.current_embryo_test_fit_admission_v1(),null::jsonb,'fit absent admission refuses before source');
select is(public.enqueue_embryo_test_statistical_fit_v1('90000000-0000-4000-8000-000000000001',true),
 '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb,'no job is fabricated from pure fit');
select is(public.current_embryo_test_statistical_fit_v1('90000000-0000-4000-8000-000000000001',
 '90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000003',true),null::jsonb,'no positive read without runtime admission');
select throws_ok($$select public.enqueue_embryo_test_statistical_fit_v1('90000000-0000-4000-8000-000000000001',false)$$,
 '42501','embryo_test_statistical_fit_unavailable','ordinary jurisdiction cannot select synthetic producer');
select ok(not has_table_privilege('service_role','private.embryo_test_statistical_admission','INSERT'),'worker cannot install fit authority');
select ok(not has_table_privilege('authenticated','private.embryo_test_statistical_admission','UPDATE'),'API cannot alter immutable fit authority');
select ok(not has_function_privilege('anon','public.embryo_test_statistical_fit_worker_v1(text,uuid,integer,text,jsonb,boolean)','EXECUTE'),
 'anonymous caller cannot claim or save');
select ok(not has_function_privilege('authenticated','public.current_embryo_test_statistical_fit_v1(uuid,uuid,uuid,boolean)','EXECUTE'),
 'account API cannot bypass current service read');
select is(jsonb_array_length(private.embryo_carrier_registry_v1()->'conditions'),0,'no clinical registry activated');
select is(private.embryo_test_fit_decimal_v1(-0.0000000001),'0.000000000','negative zero normalized exactly');
select is(private.embryo_test_fit_decimal_v1(-0.0000000005),'-0.000000001','nine-place ties round away from zero');
select throws_ok($$select private.embryo_test_fit_decimal_v1('Infinity')$$,'22023','synthetic_fit_numeric_refused','nonfinite output refused');
select throws_ok($$select private.embryo_test_fit_package_v1(jsonb_set(private.embryo_test_fit_artifact_v1(),'{training,0,liability}','0'))$$,
 '22023','synthetic_fit_artifact_refused','one modified training cell refused');
select throws_ok($$select private.embryo_test_fit_package_v1(jsonb_set(private.embryo_test_fit_artifact_v1(),'{reference}','[]'))$$,
 '22023','synthetic_fit_artifact_refused','reference subset refused');
select is((select raw#>>'{fit,observations}' from fitted_original),'64','actual complete training count');
select is((select raw#>>'{fit,degreesOfFreedom}' from fitted_original),'53','residual degrees reflect eleven fitted parameters');
select is((select jsonb_array_length(raw#>'{fit,covariance}') from fitted_original),11,'complete coefficient covariance has eleven rows');
select ok((select not exists(select 1 from generate_series(0,10) i,generate_series(0,10) j
 where canonical#>array['fit','covariance',i::text,j::text] is distinct from canonical#>array['fit','covariance',j::text,i::text]) from fitted_original),
 'whole canonical covariance symmetric');
-- Independent normal-equation check uses the original complete training rows
-- and raw coefficients. It quantizes the residual to the declared output unit;
-- no hidden epsilon or comparison tolerance supplies receipt authority.
select ok((select not exists(
 select 1 from generate_series(0,10) column_index
 where private.embryo_test_fit_decimal_v1((select sum(
  (case when column_index=0 then 1 else (row#>>array['dosages',(column_index-1)::text])::double precision
   -(raw#>>array['reference','centers',(column_index-1)::text])::double precision end)
  *((row->>'liability')::double precision-(select sum(
    (case when coefficient_index=0 then 1 else (row#>>array['dosages',(coefficient_index-1)::text])::double precision
     -(raw#>>array['reference','centers',(coefficient_index-1)::text])::double precision end)
     *(raw#>>array['fit','coefficients',coefficient_index::text])::double precision)
    from generate_series(0,10) coefficient_index)))
  from jsonb_array_elements(private.embryo_test_fit_artifact_v1()->'training') row))<>'0.000000000') from fitted_original),
 'complete native coefficients satisfy all eleven normal equations');
select ok((select (raw#>>'{reference,covariance,0,1}')::double precision<>0 from fitted_original),'off-diagonal reference covariance retained');
select is((select canonical->'withinFamily' from fitted_original),
 '{"status":"not_measured","enabledByDefault":false,"betaRatio":null,"interval":null,"familyCount":null,"citation":null}'::jsonb,
 'invented pairs do not become human sibling evidence');
select ok((select canonical->'publicationEligible'='false'::jsonb and canonical->'clinicalRegistryEligible'='false'::jsonb from fitted_original),
 'fit cannot activate clinical publication');
select is((select private.embryo_test_fit_package_digest_v1(canonical) from fitted_original),
 private.embryo_test_fit_package_digest_v1(private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1())),
 'whole independent recomputation retains exact canonical digest');
select is((select result->>'reason' from fitted_evaluations where n=7),'below_coverage_floor','below floor never yields numerical TEST result');
select is((select result#>>'{result,figureBasis,basis}' from fitted_evaluations where n=8),'modelled','inclusive floor result is honestly modelled');
select is((select result#>>'{result,coverageBasis,basis}' from fitted_evaluations where n=8),'observed','actual own score coverage stays observed');
select ok((select (result#>>'{result,varianceComponents,missingCoverage}')::numeric>0 from fitted_evaluations where n=8),
 'missing own rows retain complete covariance uncertainty');
select is((select result#>>'{result,varianceComponents,missingCoverage}' from fitted_evaluations where n=10),'0.000000000','complete own panel has no missing variance');
select is(private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),pg_temp.fit_calls(8),pg_temp.fit_qc('null'))#>>'{result,dropoutMultiplier}',
 '1.500000000','unmeasured dropout widens actual interval');
select is(private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),pg_temp.fit_calls(8),jsonb_set(pg_temp.fit_qc(),'{callRate}','0.949999999'))->>'reason',
 'qc_not_reportable','file QC failure is not missing statistical coverage');
select is(private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),pg_temp.fit_calls(8),pg_temp.fit_qc('0.100000001'))->>'reason',
 'qc_not_reportable','dropout ceiling unchanged');
select is(private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),jsonb_set(pg_temp.fit_calls(8),'{0,fileId}',
 '"90000000-0000-4000-8000-000000000099"'),pg_temp.fit_qc())->>'reason','invalid_calls','foreign own-call source refused');
select is(private.evaluate_embryo_test_fit_v1(pg_temp.fit_source(),pg_temp.fit_calls(8)||jsonb_set(pg_temp.fit_calls(1),'{0,genotype}','"G/G"'),
 pg_temp.fit_qc())->>'reason','below_coverage_floor','disputed call cannot be selected to cross floor');
select ok((select result#>'{result,clinicalPublication}'='false'::jsonb
 and not((result->'result') ?| array['raw_score','risk_model_id','clinical_model_id','rank','recommendation','sibling_beta_ratio'])
 from fitted_evaluations where n=8),'no clinical or raw score output');
select * from finish();
rollback;
