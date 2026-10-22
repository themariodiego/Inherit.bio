begin;
select plan(17);

-- What `/genome/[subject]/carrier` relies on in the database (owner decision of
-- 22 October 2026, "Carrier status and carrier-pair arithmetic (G7.4)";
-- src/lib/family/own-carrier-read.ts). No migration: this suite pins the
-- existing doors the page reads through. Synthetic release and conditions
-- only; the outer transaction rolls back.
--
-- 1. The TEST-LOCAL activation path is the real one: a synthetic release is
--    imported inactive, a reviewer identity marked as a browser test identity
--    activates a condition through `review_carrier_condition_v1`, the review
--    is recorded under that identity, and only then does the rule return it.
-- 2. The production guard (`rowsForBuild` refuses every row whose release id
--    starts `synthetic-` or whose condition id starts `SYNTHETIC:` outside the
--    TEST-LOCAL build) is complete only because the two always travel
--    together. The import door refuses a synthetic condition under a ClinVar
--    release AND a ClinVar-shaped condition under a synthetic release.
-- 3. The service door returns exactly the keys the application's strict
--    parser (`carrierAssertionRowSchema`) admits, so a renamed or added column
--    is caught here rather than turning every carrier page "unavailable".
-- 4. The own-file authority the page asks before reading any call fails
--    closed for an unknown account, session or file.

-- ---------------------------------------------------------------------------
-- 1. The activation path
-- ---------------------------------------------------------------------------

create temporary table oc_payload as select jsonb_build_object(
 'release',jsonb_build_object('releaseId','synthetic-pgtap-own-carrier','source','synthetic',
  'sourceUrl','https://example.invalid/synthetic-own-carrier','sourceSha256',repeat('a',64),'sourceBytes',1,
  'sourcePublishedOn','2026-09-03','retrievedAt','2026-09-28T08:40:57Z','extractSha256',repeat('b',64),
  'geneValidityUrl','https://example.invalid/gene-validity','geneValiditySha256',repeat('c',64),'geneValidityCreatedOn','2026-09-28'),
 'conditions',jsonb_build_array(
  jsonb_build_object('conditionId','SYNTHETIC:8891','conditionName','Synthetic own condition','geneSymbol','SYNOWNPG',
   'inheritanceMode','autosomal_recessive','geneValidityClassification','Definitive','geneValidityClassifiedOn','2022-06-01',
   'geneValidityUrl','https://example.invalid/validity-own')),
 'assertions',jsonb_build_array(
  jsonb_build_object('variationId',889101,'conditionId','SYNTHETIC:8891','geneSymbol','SYNOWNPG','variantName','synthetic own change',
   'classification','Pathogenic','reviewStatus','practice guideline','reviewStars',4,'conflict',false,
   'lastEvaluated','2023-06-15','grch38',jsonb_build_array(1,21000000,'A','G'),'grch37',null,'grch38Equivalents','[]'::jsonb),
  jsonb_build_object('variationId',889102,'conditionId','SYNTHETIC:8891','geneSymbol','SYNOWNPG','variantName','synthetic own deletion',
   'classification','Likely pathogenic','reviewStatus','criteria provided, multiple submitters, no conflicts','reviewStars',2,
   'conflict',false,'lastEvaluated',null,'grch38',jsonb_build_array(1,30000000,'ATCT','A'),'grch37',null,
   'grch38Equivalents','[[30000001,"TCTT","T"]]'::jsonb))) p;

select is((select public.import_clinical_assertion_release_v1(p)->>'releaseId' from oc_payload), 'synthetic-pgtap-own-carrier',
 'the import door writes the synthetic release');
select is((select active from public.carrier_conditions where condition_id='SYNTHETIC:8891'), false,
 'the imported condition starts inactive');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id='SYNTHETIC:8891'), 0::bigint,
 'an inactive condition gives the own page nothing to read, so it says the check is unavailable');
select ok((select public.review_carrier_condition_v1('SYNTHETIC:8891',1,'activate','Synthetic test reviewer',
 'Browser test identity, not a person','supabase/tests/own_carrier_status.sql','not_serious')) > 0,
 'the review door activates the condition under a reviewer identity marked as a test identity');
select is((select jsonb_build_object('reviewer',r.reviewer_name,'role',r.reviewer_role,'reference',r.review_reference,
  'decision',r.decision,'severity',r.severity_class)
 from public.carrier_conditions c join public.carrier_condition_reviews r on r.review_id=c.active_review_id
 where c.condition_id='SYNTHETIC:8891'),
 '{"reviewer":"Synthetic test reviewer","role":"Browser test identity, not a person","reference":"supabase/tests/own_carrier_status.sql","decision":"activate","severity":"not_serious"}'::jsonb,
 'the activation is recorded under the test identity, so no review by a person is claimed');
select is((select array_agg(release_id||'|'||condition_id||'|'||variation_id order by variation_id)
 from private.carrier_assertion_rule_v1() where condition_id='SYNTHETIC:8891'),
 array['synthetic-pgtap-own-carrier|SYNTHETIC:8891|889101','synthetic-pgtap-own-carrier|SYNTHETIC:8891|889102'],
 'the rule returns the activated condition''s assertions, each carrying its synthetic release id');

-- ---------------------------------------------------------------------------
-- 2. Synthetic rows always say so twice
-- ---------------------------------------------------------------------------

select is((select count(*) from private.carrier_assertion_rule_v1()
 where (release_id like 'synthetic-%') is distinct from (condition_id like 'SYNTHETIC:%')), 0::bigint,
 'every rule row is synthetic by its release exactly when it is synthetic by its condition');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(jsonb_set(p,'{release,releaseId}','"clinvar-2026-11"'),'{release,source}','"clinvar"'),
  '{release,sourceUrl}','"https://ftp.ncbi.nlm.nih.gov/x"') from oc_payload)),
 '22023','invalid_request','a ClinVar release cannot carry a synthetic condition');
select throws_ok(format($$select public.import_clinical_assertion_release_v1(%L)$$,
 (select jsonb_set(jsonb_set(jsonb_set(jsonb_set(p,'{release,releaseId}','"synthetic-pgtap-own-mondo"'),
  '{conditions,0,conditionId}','"MONDO:0999991"'),'{assertions,0,conditionId}','"MONDO:0999991"'),
  '{assertions,1,conditionId}','"MONDO:0999991"') from oc_payload)),
 '22023','invalid_request','a synthetic release cannot carry a ClinVar-shaped condition');
select throws_ok($$insert into public.clinical_assertion_releases(release_id,source,source_url,source_sha256,source_bytes,
 source_published_on,retrieved_at,extract_sha256,gene_validity_url,gene_validity_sha256,gene_validity_created_on)
 values('synthetic-pgtap-own-shape','clinvar','https://example.invalid/x',repeat('a',64),1,'2026-09-03','2026-09-28T08:40:57Z',
 repeat('b',64),'https://example.invalid/y',repeat('c',64),'2026-09-28')$$,'23514',null,
 'a release id cannot claim to be synthetic while its source is ClinVar');

-- ---------------------------------------------------------------------------
-- 3. The service door's row shape is the parser's
-- ---------------------------------------------------------------------------

select is((select array_agg(k order by k) from jsonb_object_keys(public.carrier_assertions_v1()->0) k),
 array['alt','assertion_id','chrom','classification','condition_id','condition_name','equivalents','gene_symbol',
  'gene_validity_read_on','inheritance_mode','last_evaluated','penetrance_citation','penetrance_class','pos','ref',
  'release_id','review_stars','review_status','variant_name','variation_id'],
 'each row the service door returns has exactly the keys the application''s strict parser admits');
select is((select jsonb_build_object('key',jsonb_build_array(x->'chrom',x->'pos',x->'ref',x->'alt'),'equivalents',x->'equivalents',
  'evaluated',x->'last_evaluated','penetrance',x->'penetrance_class')
 from jsonb_array_elements(public.carrier_assertions_v1()) x where (x->>'variation_id')::bigint=889102),
 '{"key":[1,30000000,"ATCT","A"],"equivalents":[[30000001,"TCTT","T"]],"evaluated":null,"penetrance":"unestablished"}'::jsonb,
 'the page reads each allele by its exact key and other spellings, and an absent date stays absent');

-- ---------------------------------------------------------------------------
-- 4. The own-file authority fails closed, and withdrawal is through the door
-- ---------------------------------------------------------------------------

select is(public.filter_own_analysis_files_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'reports.monogenic',
 array[gen_random_uuid()],false), '{}'::uuid[],
 'no file is admitted for an unknown account, session or file, so nothing is read');
select ok(not has_function_privilege('authenticated','public.filter_own_analysis_files_v1(uuid,uuid,uuid,text,uuid[],boolean)','execute')
 and not has_function_privilege('authenticated','public.carrier_assertions_v1()','execute'),
 'neither door the page uses is open to a browser role');
select ok((select public.review_carrier_condition_v1('SYNTHETIC:8891',1,'deactivate','Synthetic test reviewer',
 'Browser test identity, not a person','supabase/tests/own_carrier_status.sql')) > 0,
 'the same test identity withdraws the condition through the review door');
select is((select count(*) from private.carrier_assertion_rule_v1() where condition_id='SYNTHETIC:8891'), 0::bigint,
 'a withdrawn condition is gone from the rule, so the page is unavailable again');
select is((select count(*) from public.carrier_condition_reviews where condition_id='SYNTHETIC:8891'), 2::bigint,
 'both decisions are kept');

select * from finish();
rollback;
