-- A complete actual split/publication and operation-specific producer rehearsal.
-- Synthetic reference and registry exist only inside this rollback transaction;
-- they confer no clinical review, activation, provider or acceptance credit.
begin;
select no_plan();
\ir fixtures/embryo_cohort_published.inc

create temporary table carrier_ids as select (select cohort_id from live) cohort;
create function pg_temp.grant_carrier(account uuid,session uuid,nonce text) returns uuid language sql as $$
 select public.grant_cohort_purpose_v1(account,session,(select cohort from carrier_ids),'consent.upload-embryo',1,
  private.embryo_statement_keys_v1('consent.upload-embryo','grant'),decode('deadbeef','hex'),'GB',nonce);$$;
select pg_temp.grant_carrier('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1','nonce-carrier-grant-a');
select pg_temp.grant_carrier('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1','nonce-carrier-grant-b');

select ok(not has_function_privilege('anon','public.enqueue_embryo_carrier_v1(uuid,boolean)','execute')
 and not has_function_privilege('authenticated','public.embryo_carrier_worker_v1(text,uuid,integer,text,jsonb,boolean)','execute')
 and not has_function_privilege('inherit_upload_only','public.embryo_carrier_worker_v1(text,uuid,integer,text,jsonb,boolean)','execute')
 and not has_function_privilege('service_role','private.capture_embryo_carrier_v1(uuid,boolean)','execute'),
 'browser/upload roles cannot claim, read, save or capture, and service reaches only public doors');
select is(public.enqueue_embryo_carrier_v1((select cohort from carrier_ids),true),
 '{"status":"held","reason":"no_registered_conditions"}'::jsonb,'the real compiled empty registry admits no job');
select is((select count(*) from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids)),0::bigint,
 'empty registry creates no computation or receipt');
select throws_ok($$select public.enqueue_embryo_carrier_v1((select cohort from carrier_ids),false)$$,
 '42501','embryo_carrier_unavailable','production policy refuses before source capture');

-- The real importer/review doors build one explicitly synthetic recessive row.
select public.import_clinical_assertion_release_v1(jsonb_build_object(
 'release',jsonb_build_object('releaseId','synthetic-embryo-worker','source','synthetic',
 'sourceUrl','https://example.invalid/carrier-worker','sourceSha256',repeat('a',64),'sourceBytes',1,
 'sourcePublishedOn','2026-10-02','retrievedAt','2026-10-02T00:00:00Z','extractSha256',repeat('b',64),
 'geneValidityUrl','https://example.invalid/synthetic-gene-validity','geneValiditySha256',repeat('c',64),'geneValidityCreatedOn','2026-10-02'),
 'conditions',jsonb_build_array(jsonb_build_object('conditionId','SYNTHETIC:1','conditionName','Synthetic carrier worker condition',
 'geneSymbol','SYNTHGENE','inheritanceMode','autosomal_recessive','geneValidityClassification','Definitive',
 'geneValidityClassifiedOn','2026-10-02','geneValidityUrl','https://example.invalid/synthetic-gene-validity')),
 'assertions',jsonb_build_array(jsonb_build_object('variationId',1,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE',
 'variantName','Synthetic A>G at 1:1000','classification','Pathogenic','reviewStatus','reviewed by expert panel',
 'reviewStars',3,'conflict',false,'lastEvaluated',null,'grch38',jsonb_build_array(1,1000,'A','G'),'grch37',null,
 'grch38Equivalents','[]'::jsonb))));
select public.review_carrier_condition_v1('SYNTHETIC:1',1,'activate','Synthetic reviewer','Synthetic test role',
 'supabase/tests/embryo_carrier_worker.sql','not_serious');
insert into public.condition_registry(condition_id,condition_name,category,phenotype_class,inheritance_mode,active,
 registry_revision,citation_ids,gene_symbols) values('SYNTHETIC:1','Synthetic carrier worker condition','Having children',
 'synthetic','autosomal_recessive',true,1,'{}','{SYNTHGENE}');
create temporary table synthetic_registry as select jsonb_set(private.embryo_carrier_registry_v1(),'{conditions}',
 '[{"condition_id":"SYNTHETIC:1","condition_name":"Synthetic carrier worker condition","category":"Having children",
 "permitted_result_kinds":["carrier_status"],"risk_model_id":null,"enabled_by_default":true}]'::jsonb) value;
create or replace function private.embryo_carrier_registry_v1() returns jsonb language sql stable set search_path=''
 as $$select value from pg_temp.synthetic_registry;$$;

-- Every actual operation executes as service_role. Test helper selection is
-- granted only on synthetic temporary state, never a source table/role/catalog.
select is((select status from public.embryos where cohort_id=(select cohort from carrier_ids) and sample_ordinal=1),
 'qc_fail','the real publisher represents its failed no-source ordinal through the native embryo status');
select lives_ok($$select private.capture_embryo_carrier_v1((select cohort from carrier_ids),true)$$,
 'the complete published mixed-QC cohort resolves through the native source and status contract');
create temporary table carrier_queue as select public.enqueue_embryo_carrier_v1((select cohort from carrier_ids),true) body;
select is((select body->>'status' from carrier_queue),'queued','a complete current capture enqueues one actual carrier attempt');
create function pg_temp.carrier_token() returns text language sql as $$select repeat('d',64);$$;
create function pg_temp.carrier(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.embryo_carrier_worker_v1(op,case when op='claim' then null else (select (body->>'jobId')::uuid from pg_temp.carrier_queue) end,
 case when op='claim' then null else 1 end,pg_temp.carrier_token(),payload,true);$$;
grant select on carrier_queue to service_role;
select ok(pg_catalog.pg_my_temp_schema()<>0
 and not pg_catalog.pg_is_other_temp_schema(pg_catalog.pg_my_temp_schema())
 and has_schema_privilege('service_role',pg_catalog.pg_my_temp_schema(),'usage'),
 'service test helpers use the existing own-session temporary namespace');
grant execute on function pg_temp.carrier_token(),pg_temp.carrier(text,jsonb) to service_role;
set local role service_role;
create temporary table carrier_claim as select pg_temp.carrier('claim') body;
reset role;
select is((select body->>'version' from carrier_claim),'embryo-carrier-claim-v1','the service claimant returns the closed operation receipt');
select is((select jsonb_array_length(body#>'{capture,embryos}') from carrier_claim),3,'capture includes every original published ordinal');
select is((select body#>'{capture,embryos,1,source}' from carrier_claim),'null'::jsonb,
 'the published failed ordinal has a truthful null source in the whole capture');
select is((select body#>'{capture,embryos,1,qc,qc_verdict}' from carrier_claim),'"fail"'::jsonb,
 'no-source capture preserves the failed ordinal''s own measured QC verdict');
select is((select body#>'{capture,embryos,1,qc,qc_reasons}' from carrier_claim),'["embryo_call_rate"]'::jsonb,
 'no-source capture preserves the actual measured QC reason');
select ok(not exists(select 1 from private.embryo_canonical_sources x join public.embryos e on e.id=x.embryo_id
  where e.cohort_id=(select cohort from carrier_ids) and e.sample_ordinal=1)
 and not exists(select 1 from public.genome_files f join public.embryos e on e.subject_id=f.subject_id
  where e.cohort_id=(select cohort from carrier_ids) and e.sample_ordinal=1)
 and not exists(select 1 from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
  where e.cohort_id=(select cohort from carrier_ids) and e.sample_ordinal=1),
 'capture does not synthesize a canonical file, genome file or call for the genuine failed ordinal');
select is((select jsonb_array_length(body#>'{capture,authority,grants}') from carrier_claim),2,'the job binds both complete current analysis grants');
select is((select count(*) from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids)),1::bigint,
 'exact enqueue replay never creates an extra attempt');
select is(public.enqueue_embryo_carrier_v1((select cohort from carrier_ids),true),(select body from carrier_queue),
 'same complete source/authority capture is idempotent');
select throws_ok($$select public.embryo_carrier_worker_v1('check',(select (body->>'jobId')::uuid from carrier_queue),1,repeat('e',64),null,true)$$,
 '42501','embryo_carrier_unavailable','another token cannot renew or borrow the exact attempt');
select throws_ok($$select public.embryo_carrier_worker_v1('check',(select (body->>'jobId')::uuid from carrier_queue),2,pg_temp.carrier_token(),null,true)$$,
 '42501','embryo_carrier_unavailable','another attempt cannot adopt the exact source');
select throws_ok($$update public.worker_jobs set payload='{}' where id=(select (body->>'jobId')::uuid from carrier_queue)$$,
 '23514','embryo_carrier_capture_immutable','full captured authority cannot be swapped behind the immutable dispatch');

create temporary table carrier_measurements as select jsonb_build_object('measurements',
 (select jsonb_agg(private.expected_embryo_carrier_measurement_v1(e.value,c.value) order by e.ordinality,c.ordinality)
 from carrier_claim claim cross join lateral jsonb_array_elements(claim.body#>'{capture,embryos}') with ordinality e
 cross join lateral jsonb_array_elements(claim.body#>'{capture,conditions}') with ordinality c)) value;
select is((select value#>>'{measurements,0,observation,observed_copies}' from carrier_measurements),'1',
 'the measured pass embryo has exactly its own observed heterozygous dose');
select is((select value#>>'{measurements,1,reason}' from carrier_measurements),'embryo_call_rate',
 'a true failed no-source ordinal keeps its measured QC reason');
select is((select value#>>'{measurements,2,reason}' from carrier_measurements),'embryo_call_rate',
 'a marginal ordinal below the canonical figure floor never becomes a finding');
select throws_ok($$select pg_temp.carrier('save',jsonb_set((select value from carrier_measurements),
 '{measurements,0,observation,observed_copies}','2'))$$,'42501','embryo_carrier_measurement_mismatch',
 'the persistence boundary independently refuses a dose that the actual immutable file does not contain');
select throws_ok($$select pg_temp.carrier('save',jsonb_build_object('measurements',
 (select value->'measurements'->0 from carrier_measurements)))$$,'22023','invalid_request',
 'a partial cohort cannot save an output');
select is((select count(*) from public.embryo_scores where computation_receipt is not null),0::bigint,
 'refused saves leave no partial observation or public row');
grant select on carrier_measurements to service_role;
set local role service_role;
select is(pg_temp.carrier('save',(select value from carrier_measurements))->>'status','saved_held',
 'the actual service save persists the whole exact cohort atomically');
reset role;
select is((select count(*) from public.embryo_scores where computation_receipt is not null),3::bigint,
 'every ordinal has one truthful private result receipt');
select is((select finding->>'observed_copies' from public.embryo_scores where finding is not null and computation_receipt is not null),'1',
 'a QC-passed saved observation keeps its real dose rather than a disclosure-shaped null finding');
select is((select coverage_state||' / '||coalesce(not_covered_reason,'<null>') from public.embryo_scores
 where finding is not null and computation_receipt is not null),'covered / <null>',
 'public disclosure hold is independent of source QC and preserves the original constraint');
select is((select count(*) from public.embryo_scores where computation_receipt is null),0::bigint,
 'the existing clinical reader filter exposes no held worker row');
select ok((select bool_and(computation_receipt->>'publication'='held'
 and computation_receipt->>'hold_reason'='scientific_disclosures_pending') from public.embryo_scores),
 'all private observations remain held until mandatory scientific disclosure presentation ships');
select ok((select bool_and(not(computation_receipt ? 'authority') and not(computation_receipt ? 'grants')
 and not(finding ? 'probability') and not(finding ? 'rank')) from public.embryo_scores where finding is not null),
 'source receipts expose no other-principal full authority capture, modelled probability or ranking');
select throws_ok($$update public.embryo_scores set finding=jsonb_set(finding,'{observed_copies}','2') where finding is not null$$,
 '55000','embryo_carrier_score_immutable','persisted carrier observations cannot be edited after their producer closes');
select throws_ok($$update public.embryo_scores set computation_receipt=null where computation_receipt is not null$$,
 '55000','embryo_carrier_score_immutable','a private receipt cannot be cleared to pass an old clinical reader');
select is((select status from public.worker_jobs where id=(select (body->>'jobId')::uuid from carrier_queue)),'done',
 'the exact finite attempt completes without a live token');
select ok((select claim_token_hash is null and claim_expires_at is null and claimed_by is null from public.worker_jobs
 where id=(select (body->>'jobId')::uuid from carrier_queue)), 'completion closes all claim credentials');
select throws_ok($$select pg_temp.carrier('read','{}')$$,'42501','embryo_carrier_unavailable',
 'a completed token cannot read source data again');
select is(public.current_embryo_carrier_hold_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select cohort from carrier_ids),true),
 '{"status":"held","reason":"scientific_disclosures_pending"}'::jsonb,
 'a real current authorized saved reader reveals only the public disclosure hold');
select is(public.current_embryo_carrier_hold_v1('7a000000-0000-0000-0000-000000000003',
 '7a000000-0000-4000-8000-0000000000c1',(select cohort from carrier_ids),true),null::jsonb,
 'an unrelated account learns no saved result or hold state');

-- Separate coverage-only read from the very same real publication and worker
-- save. The synthetic rollback review proves doors, not a human review,
-- live registry activation, clinical interpretation or browser acceptance.
select ok(not has_function_privilege('anon','public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean)','execute')
 and not has_function_privilege('authenticated','public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean)','execute')
 and not has_function_privilege('inherit_upload_only','public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean)','execute')
 and has_function_privilege('service_role','public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean)','execute')
 and not has_function_privilege('service_role','private.embryo_carrier_library_coverage_v1(jsonb,jsonb)','execute'),
 'only the service current-read door reaches coverage; no role can borrow its private projection');
create temporary table carrier_library_read as select public.current_embryo_carrier_library_coverage_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select cohort from carrier_ids),true) body;
select is((select jsonb_array_length(body->'rows') from carrier_library_read),3,
 'the complete published cohort is returned, including both genuine QC refusals');
select is((select body#>'{rows,0,coverage}' from carrier_library_read),jsonb_build_object(
 'version','embryo-carrier-library-coverage-v1','basis','distinct-grch38-reviewed-loci-v1',
 'conditionId','SYNTHETIC:1','conditionName','Synthetic carrier worker condition',
 'referenceReleaseId','synthetic-embryo-worker','checkedPositions',1,'requiredPositions',1,
 'coverageState','covered','unresolved','[]'::jsonb,'interpretationStatus','held','holdReason','scientific_disclosures_pending'),
 'the genuine own-call result reveals exact reviewed position coverage with interpretation still held');
select ok((select bool_and(row->'coverage'='null'::jsonb and row->>'qualityReason'='embryo_call_rate')
 from carrier_library_read cross join lateral jsonb_array_elements(body->'rows') with ordinality rows(row,n) where n>1),
 'both failed-quality ordinals remain unmeasurable, never zero scientific coverage');
select ok((select body::text!~'observed_copies|genotype|carrier_state|absolute_risk|source_sha256|reviewer|assertion_measurements'
 from carrier_library_read),'the service summary serializes no clinical observation, private call or review record');
select is(public.current_embryo_carrier_library_coverage_v1('7a000000-0000-0000-0000-000000000003',
 '7a000000-0000-4000-8000-0000000000c1',(select cohort from carrier_ids),true),null::jsonb,
 'an unrelated current account learns no position or reference count');
select throws_ok($$select public.current_embryo_carrier_library_coverage_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select cohort from carrier_ids),false)$$,'42501','not_found','production policy cannot use the TEST coverage door');
savepoint carrier_library_retirement;
update public.clinical_assertion_releases set retired_at=clock_timestamp() where release_id='synthetic-embryo-worker';
select is(public.current_embryo_carrier_library_coverage_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select cohort from carrier_ids),true),null::jsonb,
 'retiring the exact current reference withholds a formerly valid count without a publication shortcut');
rollback to carrier_library_retirement;

-- Pure native projection controls use copies of the complete synthetic rule
-- only as function inputs; they cannot become a current worker/public row.
create temporary table carrier_library_projection as
 select jsonb_set(body#>'{capture,conditions,0}','{assertions}',jsonb_build_array(
  body#>'{capture,conditions,0,assertions,0}',
  jsonb_set(body#>'{capture,conditions,0,assertions,0}','{assertion_id}','900001'),
  jsonb_set(jsonb_set(body#>'{capture,conditions,0,assertions,0}','{assertion_id}','900002'),'{pos}','2000'))) c,
 jsonb_build_array(
  jsonb_build_object('assertion_id',body#>'{capture,conditions,0,assertions,0,assertion_id}','observed_copies',0,'reason',null),
  jsonb_build_object('assertion_id',900001,'observed_copies',2,'reason',null),
  jsonb_build_object('assertion_id',900002,'observed_copies',null,'reason','not_covered')) m from carrier_claim;
select is((select private.embryo_carrier_library_coverage_v1(c,m)->'requiredPositions' from carrier_library_projection),'2'::jsonb,
 'three complete reviewed assertions at two distinct loci need two positions, not three');
select is((select private.embryo_carrier_library_coverage_v1(c,m)->'checkedPositions' from carrier_library_projection),'1'::jsonb,
 'all undisputed own readings at one locus give one checked position regardless of doses');
select is((select private.embryo_carrier_library_coverage_v1(c,m)->'unresolved' from carrier_library_projection),
 '[{"reasons":["not_covered"],"positions":1}]'::jsonb,'the unread other locus retains its explicit cause');
select is((select private.embryo_carrier_library_coverage_v1(c,jsonb_set(jsonb_set(m,'{1,observed_copies}','null'),
 '{1,reason}','"source_call_disputed"'))->'checkedPositions' from carrier_library_projection),'0'::jsonb,
 'a disputed allele keeps its shared locus unresolved, without inferring the missing reading');
select throws_ok($$select private.embryo_carrier_library_coverage_v1(c,m->0) from carrier_library_projection$$,
 '22023','invalid_carrier_position_coverage','a partial or malformed measurement set cannot form a coverage figure');
select throws_ok($$select private.embryo_carrier_library_coverage_v1(c,jsonb_set(m,'{2,reason}','null'))
 from carrier_library_projection$$,'22023','invalid_carrier_position_coverage',
 'a missing reading without an explicit reason is refused rather than hidden by SQL null logic');
select * from finish();
rollback;
