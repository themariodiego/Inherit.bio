begin;
select plan(51);

-- The reviewed carrier assertion rule (docs/carrier-importer-design.md,
-- migration 20260929130000_carrier_assertions.sql). Synthetic releases and
-- conditions only; the outer transaction rolls back.
--
-- What the suite holds: the reader returns an assertion only when it is
-- pathogenic or likely pathogenic, has two review stars or more, has no
-- conflict, sits in a current release, and belongs to an active condition a
-- named reviewer activated whose ClinGen link is Definitive or Strong. A
-- legacy rsID-wide label, a one-star label, a conflicting label, a variant of
-- uncertain significance, an inactive condition and a retired release each
-- produce nothing.

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('authenticated','public.clinical_assertions','select')
 and not has_table_privilege('anon','public.clinical_assertions','select')
 and not has_table_privilege('authenticated','public.carrier_conditions','select')
 and not has_table_privilege('authenticated','public.carrier_condition_reviews','select')
 and not has_table_privilege('authenticated','public.clinical_assertion_releases','select'),
 'no browser role reads the assertion tables');
select ok(has_table_privilege('service_role','public.clinical_assertions','select')
 and not has_table_privilege('service_role','public.clinical_assertions','insert')
 and not has_table_privilege('service_role','public.carrier_conditions','update')
 and not has_table_privilege('service_role','public.carrier_condition_reviews','insert'),
 'the service reads the tables and writes only through the doors');
select ok(not has_function_privilege('authenticated','public.carrier_assertions_v1()','execute')
 and not has_function_privilege('anon','public.import_clinical_assertion_release_v1(jsonb)','execute')
 and not has_function_privilege('authenticated','public.review_carrier_condition_v1(text,bigint,text,text,text,text,text)','execute')
 and not has_function_privilege('authenticated','public.family_portrait_carrier_calls_v1(uuid,uuid,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.record_own_normalization_runs_v1(uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','public.record_own_normalization_runs_v1(uuid,uuid,uuid,jsonb)','execute'),
 'every door is closed to browser roles');
select ok(has_function_privilege('service_role','public.carrier_assertions_v1()','execute')
 and has_function_privilege('service_role','public.import_clinical_assertion_release_v1(jsonb)','execute')
 and has_function_privilege('service_role','public.review_carrier_condition_v1(text,bigint,text,text,text,text,text)','execute')
 and has_function_privilege('service_role','public.family_portrait_carrier_calls_v1(uuid,uuid,uuid,uuid,text)','execute')
 and has_function_privilege('service_role','public.record_own_normalization_runs_v1(uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','private.carrier_assertion_rule_v1()','execute'),
 'the service reaches the doors, never the private rule directly');

-- ---------------------------------------------------------------------------
-- Allele keys
-- ---------------------------------------------------------------------------

select ok(private.carrier_allele_key_valid_v1('G','T'), 'a single-letter change is a key');
select ok(private.carrier_allele_key_valid_v1('ATCT','A'), 'a left-aligned deletion is a key');
select ok(private.carrier_allele_key_valid_v1('A','ATC'), 'a left-aligned insertion is a key');
select ok(not private.carrier_allele_key_valid_v1('TCTT','T'), 'a right-shifted spelling is not a key');
select ok(not private.carrier_allele_key_valid_v1('AA','G') and not private.carrier_allele_key_valid_v1('AG','TC')
 and not private.carrier_allele_key_valid_v1('A','<DEL>') and not private.carrier_allele_key_valid_v1('A','A')
 and not private.carrier_allele_key_valid_v1(null,'A'), 'complex, symbolic, unchanged and missing alleles are not keys');
select ok(private.carrier_equivalents_valid_v1('[[101,"TCTT","T"]]',100,'ATCT','A')
 and not private.carrier_equivalents_valid_v1('[[99,"TCTT","T"]]',100,'ATCT','A')
 and not private.carrier_equivalents_valid_v1('[[101,"TCT","T"]]',100,'ATCT','A')
 and not private.carrier_equivalents_valid_v1('[[101,"G","T"]]',100,'G','T'),
 'other spellings lie to the right, keep their shape, and a single-letter change has none');

-- ---------------------------------------------------------------------------
-- A synthetic release
-- ---------------------------------------------------------------------------

create temporary table ca_payload as select jsonb_build_object(
 'release',jsonb_build_object('releaseId','synthetic-pgtap-1','source','synthetic',
  'sourceUrl','https://example.invalid/synthetic-release-1','sourceSha256',repeat('a',64),'sourceBytes',1,
  'sourcePublishedOn','2026-09-03','retrievedAt','2026-09-28T08:40:57Z','extractSha256',repeat('b',64),
  'geneValidityUrl','https://example.invalid/gene-validity','geneValiditySha256',repeat('c',64),'geneValidityCreatedOn','2026-09-28'),
 'conditions',jsonb_build_array(
  jsonb_build_object('conditionId','SYNTHETIC:1','conditionName','Synthetic recessive condition','geneSymbol','SYNTHGENE1',
   'inheritanceMode','autosomal_recessive','geneValidityClassification','Definitive','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-1'),
  jsonb_build_object('conditionId','SYNTHETIC:2','conditionName','Synthetic moderate link','geneSymbol','SYNTHGENE2',
   'inheritanceMode','autosomal_recessive','geneValidityClassification','Moderate','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-2'),
  jsonb_build_object('conditionId','SYNTHETIC:3','conditionName','Synthetic X-linked condition','geneSymbol','SYNTHGENE3',
   'inheritanceMode','x_linked','geneValidityClassification','Strong','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-3')),
 'assertions',jsonb_build_array(
  -- Meets the bar: four stars.
  jsonb_build_object('variationId',1,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE1','variantName','synthetic change 1',
   'classification','Pathogenic','reviewStatus','practice guideline','reviewStars',4,'conflict',false,
   'lastEvaluated','2004-03-03','grch38',jsonb_build_array(1,21000000,'A','G'),'grch37',jsonb_build_array(1,20900000,'A','G'),
   'grch38Equivalents','[]'::jsonb),
  -- Meets the bar: two stars, a deletion with one other spelling.
  jsonb_build_object('variationId',2,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE1','variantName','synthetic change 2',
   'classification','Likely pathogenic','reviewStatus','criteria provided, multiple submitters, no conflicts','reviewStars',2,
   'conflict',false,'lastEvaluated','2020-01-02','grch38',jsonb_build_array(1,21000100,'ATCT','A'),'grch37',null,
   'grch38Equivalents','[[21000101,"TCTT","T"]]'::jsonb),
  -- One star: refused.
  jsonb_build_object('variationId',3,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE1','variantName','synthetic change 3',
   'classification','Pathogenic','reviewStatus','criteria provided, single submitter','reviewStars',1,'conflict',false,
   'lastEvaluated',null,'grch38',jsonb_build_array(1,21000200,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  -- A conflict: refused, whatever the stars.
  jsonb_build_object('variationId',4,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE1','variantName','synthetic change 4',
   'classification','Pathogenic','reviewStatus','reviewed by expert panel','reviewStars',3,'conflict',true,
   'lastEvaluated',null,'grch38',jsonb_build_array(1,21000300,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  -- Uncertain significance: refused.
  jsonb_build_object('variationId',5,'conditionId','SYNTHETIC:1','geneSymbol','SYNTHGENE1','variantName','synthetic change 5',
   'classification','Uncertain significance','reviewStatus','criteria provided, multiple submitters, no conflicts','reviewStars',2,
   'conflict',false,'lastEvaluated',null,'grch38',jsonb_build_array(1,21000400,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  -- A condition whose gene-disease link is only Moderate.
  jsonb_build_object('variationId',6,'conditionId','SYNTHETIC:2','geneSymbol','SYNTHGENE2','variantName','synthetic change 6',
   'classification','Pathogenic','reviewStatus','reviewed by expert panel','reviewStars',3,'conflict',false,
   'lastEvaluated',null,'grch38',jsonb_build_array(2,1000,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  -- An X-linked condition no reviewer has judged serious.
  jsonb_build_object('variationId',7,'conditionId','SYNTHETIC:3','geneSymbol','SYNTHGENE3','variantName','synthetic change 7',
   'classification','Pathogenic','reviewStatus','reviewed by expert panel','reviewStars',3,'conflict',false,
   'lastEvaluated',null,'grch38',jsonb_build_array(3,1000,'C','T'),'grch37',null,'grch38Equivalents','[]'::jsonb))) p;

select is((select public.import_clinical_assertion_release_v1(p) from ca_payload),
 '{"releaseId":"synthetic-pgtap-1","retired":[],"conditions":3,"assertions":7}'::jsonb,
 'the import door writes the release, its conditions and its assertions');
select is((select count(*) from public.carrier_conditions where condition_id like 'SYNTHETIC:%' and active), 0::bigint,
 'every imported condition starts inactive');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id like 'SYNTHETIC:%'), 0::bigint,
 'with no condition active, the rule returns nothing');

-- A legacy rsID-wide label, the shape the old reader refused, still activates nothing.
insert into public.ref_variants(rsid,chrom,pos38,ref,alt,gene_symbol,clinvar_significance,clinvar_review_status,sources)
 values(999999901,1,21000000,'A','G','SYNTHGENE1','Pathogenic','practice guideline','{"synthetic":"carrier_assertions.sql"}');
insert into public.condition_registry(condition_id,condition_name,category,phenotype_class,inheritance_mode,active,
 registry_revision,citation_ids,gene_symbols)
 values('pgtap-legacy-label','Synthetic legacy entry','Having children','synthetic','autosomal_recessive',true,1,'{}','{SYNTHGENE1}');
select is((select count(*) from private.carrier_assertion_rule_v1() where gene_symbol='SYNTHGENE1'), 0::bigint,
 'a legacy rsID-wide label and an active legacy registry row activate nothing');

-- ---------------------------------------------------------------------------
-- Review
-- ---------------------------------------------------------------------------

select throws_ok($$select public.review_carrier_condition_v1('SYNTHETIC:2',1,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap','not_serious')$$,'55000','carrier_condition_not_activatable',
 'a Moderate gene-disease link cannot be activated');
select throws_ok($$select public.review_carrier_condition_v1('SYNTHETIC:3',1,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap','not_serious')$$,'55000','carrier_condition_not_activatable',
 'an X-linked condition needs a reviewer to judge it serious (ADR 0034)');
select throws_ok($$select public.review_carrier_condition_v1('SYNTHETIC:1',2,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap','not_serious')$$,'22023','invalid_request',
 'a review names the revision it reviewed');
select throws_ok($$select public.review_carrier_condition_v1('SYNTHETIC:1',1,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap',null)$$,'55000','carrier_condition_not_activatable',
 'an activation records the reviewer''s severity judgement');
select throws_ok($$select public.review_carrier_condition_v1('SYNTHETIC:1',1,'activate','  ','Genetic counsellor',
 'docs/reviews/pgtap','not_serious')$$,'22023','invalid_request',
 'a review has a named reviewer');
select throws_ok($$update public.carrier_conditions set active=true where condition_id='SYNTHETIC:1'$$,'42501',
 'carrier_condition_review_required',
 'no condition becomes active without a review');

select ok((select public.review_carrier_condition_v1('SYNTHETIC:1',1,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap','not_serious')) > 0, 'a named reviewer activates the Definitive recessive condition');
select is((select jsonb_build_object('active',c.active,'severity',c.severity_class,'reviewer',r.reviewer_name,'decision',r.decision)
 from public.carrier_conditions c join public.carrier_condition_reviews r on r.review_id=c.active_review_id
 where c.condition_id='SYNTHETIC:1'),
 '{"active":true,"severity":"not_serious","reviewer":"A Reviewer","decision":"activate"}'::jsonb,
 'the activation is recorded with the reviewer''s name');

select is((select array_agg(variation_id order by variation_id) from private.carrier_assertion_rule_v1()
 where condition_id like 'SYNTHETIC:%'), array[1,2]::bigint[],
 'the rule returns exactly the two assertions that meet the bar');
select is((select jsonb_build_object('classification',classification,'status',review_status,'stars',review_stars,
 'evaluated',last_evaluated,'key',jsonb_build_array(chrom,pos,ref,alt),'equivalents',equivalents,'mode',inheritance_mode,
 'penetrance',penetrance_class)
 from private.carrier_assertion_rule_v1() where variation_id=2 and condition_id='SYNTHETIC:1'),
 '{"classification":"Likely pathogenic","status":"criteria provided, multiple submitters, no conflicts","stars":2,"evaluated":"2020-01-02","key":[1,21000100,"ATCT","A"],"equivalents":[[21000101,"TCTT","T"]],"mode":"autosomal_recessive","penetrance":"unestablished"}'::jsonb,
 'each rule row carries its exact key, other spellings, classification, review status and date');
select is(jsonb_array_length(public.carrier_assertions_v1()),
 (select count(*)::integer from private.carrier_assertion_rule_v1()),
 'the service door returns the rule''s rows and nothing else');

-- ---------------------------------------------------------------------------
-- What the import door refuses
-- ---------------------------------------------------------------------------

select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-bad"'),'{assertions,0,grch38}','[1,21000001,"TCTT","T"]')
  from ca_payload)),'22023','invalid_request','a right-shifted spelling is refused as a key');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-bad"'),'{assertions,0,reviewStars}','2') from ca_payload)),
 '22023','invalid_request','stars that disagree with the review status are refused');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-bad"'),'{assertions,2,reviewStatus}',
  '"criteria provided, conflicting classifications"') from ca_payload)),
 '22023','invalid_request','a conflicting review status without the conflict flag is refused');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(jsonb_set(p,'{release,releaseId}','"clinvar-2026-10"'),'{release,source}','"clinvar"'),
  '{release,sourceUrl}','"https://ftp.ncbi.nlm.nih.gov/x"') from ca_payload)),
 '22023','invalid_request','a ClinVar release cannot carry synthetic conditions');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-bad"'),'{assertions,0,geneSymbol}','"SYNTHGENE2"')
  from ca_payload)),'22023','invalid_request','an assertion''s gene must be its condition''s');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-bad"'),'{assertions,0,grch38}','[23,21000000,"A","G"]')
  from ca_payload)),'22023','invalid_request','only autosomal keys are held');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select p||'{"extra":1}'::jsonb from ca_payload)),'22023','invalid_request','the payload shape is closed');
select is((select count(*) from public.clinical_assertion_releases where release_id in ('synthetic-pgtap-bad','clinvar-2026-10')),
 0::bigint,'a refused import leaves nothing behind');

-- ---------------------------------------------------------------------------
-- A new release retires the old one
-- ---------------------------------------------------------------------------

select is((select public.import_clinical_assertion_release_v1(
  jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-2"'),'{assertions}',
   jsonb_build_array(p#>'{assertions,0}'))) from ca_payload),
 '{"releaseId":"synthetic-pgtap-2","retired":["synthetic-pgtap-1"],"conditions":3,"assertions":1}'::jsonb,
 'importing a new release retires the current one');
select is((select array_agg(release_id||':'||variation_id order by release_id,variation_id) from private.carrier_assertion_rule_v1()
 where condition_id like 'SYNTHETIC:%'), array['synthetic-pgtap-2:1'],
 'a retired release''s assertions are no longer read');
select ok((select active from public.carrier_conditions where condition_id='SYNTHETIC:1'),
 'an unchanged condition keeps its review across releases');

select is((select public.import_clinical_assertion_release_v1(
  jsonb_set(jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-3"'),'{assertions}',
   jsonb_build_array(p#>'{assertions,0}')),'{conditions,0,geneValidityClassification}','"Strong"')) from ca_payload)->>'assertions',
 '1','a release may change what ClinGen says about a condition');
select is((select jsonb_build_object('active',active,'revision',registry_revision,'severity',severity_class)
 from public.carrier_conditions where condition_id='SYNTHETIC:1'),
 '{"active":false,"revision":2,"severity":"unreviewed"}'::jsonb,
 'a changed condition is a new revision, inactive until reviewed again');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id like 'SYNTHETIC:%'), 0::bigint,
 'an inactive condition''s assertions are not read');
select ok((select public.review_carrier_condition_v1('SYNTHETIC:1',2,'activate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap-2','not_serious')) > 0, 'the new revision is reviewed');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id like 'SYNTHETIC:%'), 1::bigint,
 'a review of the new revision reads it again');
select ok((select public.review_carrier_condition_v1('SYNTHETIC:1',2,'deactivate','A Reviewer','Genetic counsellor',
 'docs/reviews/pgtap-3')) > 0, 'a reviewer withdraws the condition');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id like 'SYNTHETIC:%'), 0::bigint,
 'a withdrawn condition''s assertions are not read');
select is((select count(*) from public.carrier_condition_reviews where condition_id='SYNTHETIC:1'), 3::bigint,
 'every review is kept');

-- ---------------------------------------------------------------------------
-- The readers that touch a person's data refuse without authority
-- ---------------------------------------------------------------------------

select is(public.family_portrait_carrier_calls_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 repeat('0',64)), null::jsonb, 'the Portrait carrier reader answers nothing for an unknown pair');
select is(public.family_portrait_carrier_calls_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null),
 null::jsonb, 'the Portrait carrier reader needs the captured readiness receipt');
select throws_ok(format($$select public.record_own_normalization_runs_v1(%L,%L,%L,'{"status":"measured"}')$$,
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),'22023','invalid_request','a runs measure has a closed shape');
select throws_ok(format($$select public.record_own_normalization_runs_v1(%L,%L,%L,'{"status":"not_measurable","reason":"no-reference-calls"}')$$,
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),'42501','not_found','a runs measure needs the file''s own authority');
select throws_ok(format($$select public.record_own_normalization_runs_v1(%L,%L,%L,'{"status":"unknown"}')$$,
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),'22023','invalid_request','an unknown status is refused');

-- ---------------------------------------------------------------------------
-- Nothing in this migration is a person's data or an active condition
-- ---------------------------------------------------------------------------

select is((select count(*) from public.carrier_conditions where active and not synthetic), 0::bigint,
 'no real condition is active');
select is((select count(*) from public.clinical_assertion_releases where source='clinvar' and imported_at<now()), 0::bigint,
 'the migration imports no ClinVar release; that is a separate guarded apply');

select * from finish();
rollback;
