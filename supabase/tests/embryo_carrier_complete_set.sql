-- Actual owned database producer persistence/recovery rehearsal. All source,
-- assertions, reviews and admission below are synthetic and rollback-only.
-- Original positive fixtures and assertions remain unchanged in their suites.
begin;
select no_plan();
\ir fixtures/embryo_cohort_published_carrier_refusals.inc

create temporary table carrier_ids as select (select cohort_id from live) cohort;
create function pg_temp.grant_carrier(account uuid,session uuid,nonce text) returns uuid language sql as $$
 select public.grant_cohort_purpose_v1(account,session,(select cohort from carrier_ids),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','grant'),decode('deadbeef','hex'),'GB',nonce);$$;
select pg_temp.grant_carrier('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1','nonce-carrier-grant-a');
select pg_temp.grant_carrier('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1','nonce-carrier-grant-b');
select is((select count(*) from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids)),0::bigint,
 'source publication and both grants are durably committed even when the application intake hint never ran');
select is(public.embryo_carrier_worker_v1('reconcile',null,null,repeat('d',64),'{"afterCohortId":null}',true),
 '{"status":"held","reason":"no_registered_conditions"}'::jsonb,'empty admission reads no recovery inventory');

create temporary table reviewed_alleles(condition_id text,variation_id integer,chrom integer,pos integer,ref text,alt text);
insert into reviewed_alleles values('SYNTHETIC:1',1,1,1000,'A','G'),('SYNTHETIC:1',2,7,3000,'T','C'),
 ('SYNTHETIC:1',3,1,1001,'A','G'),('SYNTHETIC:1',4,13,4000,'A','G'),('SYNTHETIC:2',5,1,1000,'A','G');
select public.import_clinical_assertion_release_v1(jsonb_build_object(
 'release',jsonb_build_object('releaseId','synthetic-embryo-worker','source','synthetic',
 'sourceUrl','https://example.invalid/carrier-worker','sourceSha256',repeat('a',64),'sourceBytes',1,
 'sourcePublishedOn','2026-10-02','retrievedAt','2026-10-02T00:00:00Z','extractSha256',repeat('b',64),
 'geneValidityUrl','https://example.invalid/synthetic-gene-validity','geneValiditySha256',repeat('c',64),'geneValidityCreatedOn','2026-10-02'),
 'conditions',(select jsonb_agg(jsonb_build_object('conditionId',id,'conditionName','Synthetic carrier '||id,
  'geneSymbol','SYNTHGENE','inheritanceMode','autosomal_recessive','geneValidityClassification','Definitive',
  'geneValidityClassifiedOn','2026-10-02','geneValidityUrl','https://example.invalid/synthetic-gene-validity') order by id)
  from (values('SYNTHETIC:1'),('SYNTHETIC:2')) condition(id)),
 'assertions',(select jsonb_agg(jsonb_build_object('variationId',variation_id,'conditionId',condition_id,'geneSymbol','SYNTHGENE',
  'variantName','Synthetic reviewed allele '||variation_id,'classification','Pathogenic','reviewStatus','reviewed by expert panel',
  'reviewStars',3,'conflict',false,'lastEvaluated',null,'grch38',jsonb_build_array(chrom,pos,ref,alt),'grch37',null,
  'grch38Equivalents','[]'::jsonb) order by variation_id) from reviewed_alleles)));
select public.review_carrier_condition_v1(id,1,'activate','Synthetic reviewer','Synthetic test role',
 'supabase/tests/embryo_carrier_complete_set.sql','not_serious') from (values('SYNTHETIC:1'),('SYNTHETIC:2')) condition(id);
insert into public.condition_registry(condition_id,condition_name,category,phenotype_class,inheritance_mode,active,
 registry_revision,citation_ids,gene_symbols) select id,'Synthetic carrier '||id,'Having children',
 'synthetic','autosomal_recessive',true,1,'{}','{SYNTHGENE}' from (values('SYNTHETIC:1'),('SYNTHETIC:2')) condition(id);
create temporary table synthetic_registry as select jsonb_set(private.embryo_carrier_registry_v1(),'{conditions}',
 (select jsonb_agg(jsonb_build_object('condition_id',id,'condition_name','Synthetic carrier '||id,'category','Having children',
 'permitted_result_kinds','["carrier_status"]'::jsonb,'risk_model_id',null,'enabled_by_default',true) order by id)
 from (values('SYNTHETIC:1'),('SYNTHETIC:2')) condition(id))) value;
create or replace function private.embryo_carrier_registry_v1() returns jsonb language sql stable set search_path=''
 as $$select value from pg_temp.synthetic_registry;$$;

-- No enqueue hint: the actual service worker recovers directly from durable
-- publication/grant/source state, including a lost request/process after commit.
grant usage on schema pg_temp to service_role;
set local role service_role;
create temporary table recovery as select public.embryo_carrier_worker_v1('reconcile',null,null,repeat('d',64),
 '{"afterCohortId":null}',true) body;
reset role;
select is((select body->>'version' from recovery),'embryo-carrier-reconcile-v1','actual service reconciliation creates current intake');
select is((select count(*) from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids)),1::bigint,
 'missing enqueue is recovered without a repeated upload or grant');
select public.embryo_carrier_worker_v1('reconcile',null,null,repeat('e',64),'{"afterCohortId":null}',true);
select is((select count(*) from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids)),1::bigint,
 'restarting reconciliation is idempotent against the complete source and authority capture');
create temporary table carrier_queue as select id from public.worker_jobs where kind='score_embryo' and cohort_id=(select cohort from carrier_ids);
grant select on carrier_queue to service_role;
create function pg_temp.carrier(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.embryo_carrier_worker_v1(op,case when op='claim' then null else (select id from pg_temp.carrier_queue) end,
 case when op='claim' then null else 1 end,repeat('d',64),payload,true);$$;
grant execute on function pg_temp.carrier(text,jsonb) to service_role;
set local role service_role;
create temporary table carrier_claim as select pg_temp.carrier('claim') body;
reset role;
select is((select jsonb_array_length(body#>'{capture,conditions,0,assertions}') from carrier_claim),4,
 'capture binds the complete reviewed condition set rather than selecting one allele');
select is((select jsonb_array_length(body#>'{capture,conditions,0,reference_receipt,assertions}') from carrier_claim),4,
 'all reviewed variant/classification/date/penetrance evidence is pinned with the reference receipt');
create temporary table measured as select jsonb_build_object('measurements',
 (select jsonb_agg(private.expected_embryo_carrier_measurement_v1(e.value,c.value) order by e.ordinality,c.ordinality)
 from carrier_claim claim cross join lateral jsonb_array_elements(claim.body#>'{capture,embryos}') with ordinality e
 cross join lateral jsonb_array_elements(claim.body#>'{capture,conditions}') with ordinality c)) value;
select is((select value#>>'{measurements,0,assertion_measurements,0,reason}' from measured),'invalid_calls','haploid stays a named scientific refusal');
select is((select value#>>'{measurements,0,assertion_measurements,1,reason}' from measured),'invalid_calls','multiallelic ALT stays a named refusal before spelling matching');
select is((select value#>>'{measurements,0,assertion_measurements,2,reason}' from measured),'invalid_calls','literal N stays a named scientific refusal');
select is((select value#>>'{measurements,4,observation,covered_assertions}' from measured),'1','the final passing embryo covers one reviewed assertion');
select is((select value#>>'{measurements,4,observation,required_assertions}' from measured),'4','the full denominator retains all four reviewed assertions');
select is((select value#>>'{measurements,4,assertion_measurements,3,observed_copies}' from measured),'2','its own immutable source contains exactly two copies at that allele');
select throws_ok($$select pg_temp.carrier('read_batch',jsonb_build_object('embryoId',
 (select body#>>'{capture,embryos,0,embryoId}' from carrier_claim),'conditionId','SYNTHETIC:1','assertionIds','[999999999]'::jsonb))$$,
 '42501','embryo_carrier_unavailable','a batch cannot select an assertion outside the captured complete rule');
select throws_ok($$select pg_temp.carrier('save',jsonb_set((select value from measured),
 '{measurements,4,assertion_measurements,3,observed_copies}','1'))$$,'42501','embryo_carrier_measurement_mismatch',
 'independent save validation refuses a fabricated per-assertion dose');
select is((select count(*) from public.embryo_scores where computation_receipt is not null),0::bigint,'refused saves publish no partial evidence');
grant select on measured to service_role;
set local role service_role;
select is(pg_temp.carrier('save',(select value from measured))->>'status','saved_held','actual service save persists all six current measurements atomically');
reset role;
select is((select count(*) from public.embryo_scores where computation_receipt is not null),6::bigint,'every embryo and condition has a private truthful result');
select is((select coverage_state from public.embryo_scores where embryo_id=(select (body#>>'{capture,embryos,0,embryoId}')::uuid from carrier_claim)
 and condition_id='SYNTHETIC:2'),'not_covered','a QC-passed unsupported call is distinct from a failed source quality check');
select is((select not_covered_reason from public.embryo_scores where embryo_id=(select (body#>>'{capture,embryos,0,embryoId}')::uuid from carrier_claim)
 and condition_id='SYNTHETIC:2'),'invalid_calls','the original core refusal survives actual persistence');
select is((select computation_receipt->'assertion_coverage' from public.embryo_scores where finding->>'version'='2'),
 '{"covered":1,"required":4}'::jsonb,'saved compact evidence retains true n/N coverage');
select is((select coverage_state from public.embryo_scores where finding->>'version'='2'),'partial','partial complete-set coverage remains partial');
select is((select finding->>'interpretation_status' from public.embryo_scores where finding->>'version'='2'),'held','multi-allele condition interpretation is not inferred');
select ok((select bool_and(not(finding ? 'carrier_state') and not(finding ? 'probability') and not(finding ? 'phase'))
 from public.embryo_scores where finding->>'version'='2'),'complete private observations contain no allele sum, phase or disease probability');
select is((select count(*) from public.embryo_scores where computation_receipt is null),0::bigint,'existing public clinical readers reveal no held measurement');
select is(public.current_embryo_carrier_hold_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select cohort from carrier_ids),true),
 '{"status":"held","reason":"scientific_disclosures_pending"}'::jsonb,'the actual current saved reader admits only the whole-set disclosure hold');
select * from finish();
rollback;
