begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Public panel metadata plus invented shares/identifiers only. These tests
-- create no source, account, grant, journal or storage object. All DDL rolls back.
create temporary table seven_capture(c jsonb);
insert into seven_capture values ('{"schemaVersion":3,"computationRevision":"own-ancestry-content-v3","source":{"fileId":"78830000-0000-4000-8000-000000000001","subjectId":"78830000-0000-4000-8000-000000000002","normalizedBuild":"GRCh38","sourceRevision":1,"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","callEncoding":"vcf-literal","normalizedAt":"2026-09-15T00:00:00Z"},"panel":{"id":"aims-hgdp-tgp-168","version":"hgdp-1kg-v3.1.2-cap30-168-v1","provenance":"data/ref/AIMS_SEVEN_REGION_PROVENANCE.md","markerSha256":"54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163","markerCount":168,"minimumMarkers":168},"admixture":{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.1,"CSA":0.15,"EAS":0.15,"EUR":0.25,"MID":0.1,"OCE":0.05},"markersUsed":168,"note":"These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.","fit":{"iterations":30,"converged":true},"reporting":{"policy":"merge-eur-mid-csa-v1","threshold":0.1,"merged":true,"caveat":"This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often."}},"support_note":"These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.","model_id":"aims-hgdp-tgp-168","model_version":"hgdp-1kg-v3.1.2-cap30-168-v1","coverage":1,"result_state":"available","basis":"modelled","range":{"unavailable":true},"resolution":"seven-regions-adaptive-v1"},"panelPositions":{"called":168,"missing":0,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0},"lineages":[{"kind":"mtdna","state":"unavailable","tree":{"id":"inherit-mtdna-curated-subset","version":"Build 17, Forensic Update 1a","sha256":"fb34d38ac78a900172a398e168b54b786711dbe662c12659db5fd09c6666efd1"},"markerPositions":106,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"},{"kind":"ydna","state":"unavailable","tree":{"id":"inherit-ydna-curated-subset","version":"2016 index (4 January 2016)","sha256":"b5e956ec511dc3c4c3c40e38862c2e5af513be675cacead0b31469b174a168e3"},"markerPositions":31,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"}]}'::jsonb);
create function pg_temp.validate(c jsonb, encoding text default 'vcf-literal') returns void language sql as $$
 select private.validate_own_ancestry_content_v1(c,
  '78830000-0000-4000-8000-000000000001','78830000-0000-4000-8000-000000000002',
  jsonb_build_object('sourceRevision',1,'sourceSha256',repeat('a',64),'normalizedAt','2026-09-15T00:00:00Z'),encoding);
$$;
create function pg_temp.with_note(c jsonb, note text) returns jsonb language sql as $$
 select jsonb_set(jsonb_set(c,'{admixture,result,note}',to_jsonb(note)),'{admixture,support_note}',to_jsonb(note));
$$;
-- Preserve the quotient through JSON serialization even on a server configured
-- to print fewer float digits; the production writer uses JSON.stringify.
create function pg_temp.with_used(c jsonb, used integer) returns jsonb language sql set extra_float_digits=1 as $$
 select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(c,
  '{panelPositions,called}',to_jsonb(used)),
  '{panelPositions,missing}',to_jsonb(168-used)),
  '{admixture,result,markersUsed}',to_jsonb(used)),
  '{admixture,coverage}',to_jsonb(used::double precision/168)),
  '{admixture,result_state}',to_jsonb(case when used=0 then 'not_covered' when used<168 then 'partial' else 'available' end));
$$;
select lives_ok($$select pg_temp.validate(c) from seven_capture$$,'complete seven-region capture accepted through existing entrypoint');
select lives_ok(format('select pg_temp.validate(%L::jsonb)',pg_temp.with_used(c,1)),
 'one usable marker is partial; its coverage is not borrowed from the full panel') from seven_capture;
select lives_ok(format('select pg_temp.validate(%L::jsonb)',pg_temp.with_used(c,167)),
 '167 usable markers remain partial until this reference has full-panel coverage') from seven_capture;
select lives_ok(format('select pg_temp.validate(%L::jsonb)',pg_temp.with_note(jsonb_set(c,'{admixture,result,fit}','{"iterations":50000,"converged":false}'),'These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places. The fit reached its calculation limit, so these shares may still change with more fitting steps.')),
 'iteration-cap result remains readable with explicit nonconvergence') from seven_capture;
select lives_ok(format('select pg_temp.validate(%L::jsonb, ''array-genotype'')',jsonb_set(c,'{source,callEncoding}','"array-genotype"')),
 'separately checked array encoding remains supported') from seven_capture;

create temporary table zero_capture as select pg_temp.with_note(jsonb_set(jsonb_set(jsonb_set(pg_temp.with_used(c,0),
 '{admixture,result,proportions}','null'),'{admixture,result,fit}','{"iterations":0,"converged":false}'),
 '{admixture,result,reporting,merged}','false'),'No usable ancestry markers were read. No region shares were computed.') c from seven_capture;
select lives_ok($$select pg_temp.validate(c) from zero_capture$$,'zero usable markers retain no fabricated proportions or completed fit');

-- Coverage uses the exact IEEE754 quotient also checked by the TypeScript DTO.
-- These adjacent representable values differ by far less than the old tolerance.
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(pg_temp.with_used(c,1),'{admixture,coverage}',coverage)),
 '22023','invalid_ancestry_content',label)
from seven_capture cross join (values
 ('0.005952380952380951'::jsonb,'coverage immediately below the one-marker quotient is rejected'),
 ('0.005952380952380953'::jsonb,'coverage immediately above the one-marker quotient is rejected')
) neighbors(coverage,label);
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,coverage}','-0.0000000000001')),
 '22023','invalid_ancestry_content','tiny negative coverage is rejected at zero markers') from zero_capture;
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,coverage}','1.0000000000001')),
 '22023','invalid_ancestry_content','coverage just above one is rejected at full coverage') from seven_capture;

-- Strictly greater than the trigger, tested before rounding the stored doubles.
create temporary table threshold_capture as select jsonb_set(jsonb_set(c,'{admixture,result,proportions}',
 '{"AFR":0.3,"AMR":0.1,"CSA":0.1,"EAS":0.2,"EUR":0.1,"MID":0.1,"OCE":0.1}'),
 '{admixture,result,reporting,merged}','false') c from seven_capture;
select lives_ok($$select pg_temp.validate(c) from threshold_capture$$,'three shares exactly at 0.10 do not trigger a merge');
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,reporting,merged}','true')),
 '22023','invalid_ancestry_content','exact-threshold shares cannot be misreported as merged') from threshold_capture;
create temporary table above_threshold as select jsonb_set(jsonb_set(c,'{admixture,result,proportions}',
 '{"AFR":0.29999999999999993,"AMR":0.1,"CSA":0.10000000000000002,"EAS":0.2,"EUR":0.10000000000000002,"MID":0.1,"OCE":0.1}'),
 '{admixture,result,reporting,merged}','true') c from seven_capture;
select lives_ok($$select pg_temp.validate(c) from above_threshold$$,'unrounded shares immediately above 0.10 trigger the merge');
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,reporting,merged}','false')),
 '22023','invalid_ancestry_content','rounded-to-threshold reporting cannot override the raw fit') from above_threshold;

-- JSON can spell more precision than JavaScript's parsed IEEE754 value retains.
-- MID is above the trigger; EUR must be compared as the same parsed double.
create temporary table precision_threshold as select label, merged,
 jsonb_set(jsonb_set(c,'{admixture,result,proportions}',jsonb_build_object(
  'AFR',0.79,'AMR',0,'CSA',0,'EAS',0,'EUR',eur,'MID',0.11,'OCE',0)),
  '{admixture,result,reporting,merged}',to_jsonb(merged)) c
from seven_capture cross join (values
 ('adjacent double below threshold','0.09999999999999999'::jsonb,false),
 ('excess decimal precision above threshold parses to threshold','0.100000000000000001'::jsonb,false),
 ('excess decimal precision below threshold parses to threshold','0.099999999999999999'::jsonb,false),
 ('adjacent double above threshold','0.10000000000000002'::jsonb,true),
 ('excess decimal precision parses above threshold','0.100000000000000015'::jsonb,true)
) inputs(label,eur,merged);
select lives_ok(format('select pg_temp.validate(%L::jsonb)',c),label||' uses the JavaScript merge decision') from precision_threshold;
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,reporting,merged}',to_jsonb(not merged))),
 '22023','invalid_ancestry_content',label||' refuses the opposite merge decision') from precision_threshold;
select lives_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,proportions,AFR}','0.2000000000000001')),
 'ordinary double arithmetic noise does not invalidate a captured simplex') from seven_capture;

-- Independently vary identity, closed shapes, coverage and reporting. A JSON
-- field being present is insufficient: its type and meaning must also agree.
select throws_ok(format('select pg_temp.validate(%L::jsonb)',bad),
 '22023','invalid_ancestry_content',label)
from seven_capture cross join lateral (values
 ('wrong content revision',jsonb_set(c,'{computationRevision}','"own-ancestry-content-v2"')),
 ('wrong panel identity',jsonb_set(c,'{panel,id}','"aims-kidd-seldin-168"')),
 ('wrong panel digest',jsonb_set(c,'{panel,markerSha256}',to_jsonb(repeat('b',64)))),
 ('wrong panel version',jsonb_set(c,'{panel,version}','"another-version"')),
 ('wrong reference provenance',jsonb_set(c,'{panel,provenance}','"data/ref/AIMS_PROVENANCE.md"')),
 ('inherited unvalidated marker threshold',jsonb_set(c,'{panel,minimumMarkers}','42')),
 ('wrong model version',jsonb_set(c,'{admixture,model_version}','"2026-08-28"')),
 ('old five-region resolution',jsonb_set(c,'{admixture,resolution}','"five-broad-regions"')),
 ('other source file',jsonb_set(c,'{source,fileId}','"78830000-0000-4000-8000-000000000099"')),
 ('other subject',jsonb_set(c,'{source,subjectId}','"78830000-0000-4000-8000-000000000099"')),
 ('other source revision',jsonb_set(c,'{source,sourceRevision}','2')),
 ('other source bytes',jsonb_set(c,'{source,sourceSha256}',to_jsonb(repeat('b',64)))),
 ('other normalization time',jsonb_set(c,'{source,normalizedAt}','"2026-09-15T00:00:01Z"')),
 ('wrong source encoding',jsonb_set(c,'{source,callEncoding}','"array-genotype"')),
 ('extra source field',jsonb_set(c,'{source,extra}','true')),
 ('extra top-level field',c||'{"unexpected":true}'),
 ('wrong marker sum',jsonb_set(c,'{panelPositions,missing}','1')),
 ('fractional marker count',jsonb_set(c,'{panelPositions,called}','167.5')),
 ('mismatched used count',jsonb_set(c,'{admixture,result,markersUsed}','167')),
 ('mismatched coverage',jsonb_set(c,'{admixture,coverage}','0.99')),
 ('false availability at 167 markers',jsonb_set(pg_temp.with_used(c,167),'{admixture,result_state}','"available"')),
 ('missing proportions',c#-'{admixture,result,proportions}'),
 ('null proportions with observed markers',jsonb_set(c,'{admixture,result,proportions}','null')),
 ('missing region',c#-'{admixture,result,proportions,OCE}'),
 ('legacy SAS key',jsonb_set(c,'{admixture,result,proportions,SAS}','0')),
 ('negative share',jsonb_set(c,'{admixture,result,proportions,AFR}','-0.01')),
 ('share beyond one',jsonb_set(c,'{admixture,result,proportions,AFR}','1.01')),
 ('string share',jsonb_set(c,'{admixture,result,proportions,AFR}','"0.2"')),
 ('null share',jsonb_set(c,'{admixture,result,proportions,AFR}','null')),
 ('simplex outside arithmetic tolerance',jsonb_set(c,'{admixture,result,proportions,AFR}','0.20000000001')),
 ('unvalidated seven-region ranges',jsonb_set(c,'{admixture,result,ranges}','{}')),
 ('invented interval',jsonb_set(c,'{admixture,range}','{"low":0,"high":1}')),
 ('missing fit diagnostics',c#-'{admixture,result,fit}'),
 ('fractional iteration count',jsonb_set(c,'{admixture,result,fit,iterations}','1.5')),
 ('iteration count over cap',jsonb_set(c,'{admixture,result,fit,iterations}','50001')),
 ('zero iterations with a fit',jsonb_set(c,'{admixture,result,fit,iterations}','0')),
 ('nonconvergence before cap',jsonb_set(c,'{admixture,result,fit,converged}','false')),
 ('extra fit diagnostic',jsonb_set(c,'{admixture,result,fit,extra}','true')),
 ('missing merge policy',c#-'{admixture,result,reporting}'),
 ('wrong merge policy',jsonb_set(c,'{admixture,result,reporting,policy}','"another-policy"')),
 ('wrong merge threshold',jsonb_set(c,'{admixture,result,reporting,threshold}','0.2')),
 ('hidden required merge',jsonb_set(c,'{admixture,result,reporting,merged}','false')),
 ('wrong merge flag type',jsonb_set(c,'{admixture,result,reporting,merged}','"true"')),
 ('missing caveat',c#-'{admixture,result,reporting,caveat}'),
 ('weakened caveat',jsonb_set(c,'{admixture,result,reporting,caveat}','"These shares are certain."')),
 ('extra reporting field',jsonb_set(c,'{admixture,result,reporting,extra}','true')),
 ('note contradicts fit',pg_temp.with_note(c,'These shares are certain.')),
 ('mismatched support note',jsonb_set(c,'{admixture,support_note}','"different"')),
 ('lineage tree digest drift',jsonb_set(c,'{lineages,0,tree,sha256}',to_jsonb(repeat('b',64)))),
 ('null lineage state',jsonb_set(c,'{lineages,0,state}','null')),
 ('invented lineage availability',jsonb_set(c,'{lineages,0,state}','"available"')),
 ('lineage observations exceed its panel',jsonb_set(c,'{lineages,0,observedPositions}','107')),
 ('lineage order changed',jsonb_set(c,'{lineages}',jsonb_build_array(c#>'{lineages,1}',c#>'{lineages,0}')))
) cases(label,bad);
select throws_ok(format('select pg_temp.validate(%L::jsonb)',bad),
 '22023','invalid_ancestry_content',label)
from zero_capture cross join lateral (values
 ('zero calls cannot carry a prior mixture',jsonb_set(c,'{admixture,result,proportions}','{"AFR":1,"AMR":0,"CSA":0,"EAS":0,"EUR":0,"MID":0,"OCE":0}')),
 ('zero calls cannot be merged',jsonb_set(c,'{admixture,result,reporting,merged}','true')),
 ('zero calls cannot claim convergence',jsonb_set(c,'{admixture,result,fit,converged}','true')),
 ('zero calls cannot claim fit iterations',jsonb_set(c,'{admixture,result,fit,iterations}','1'))
) cases(label,bad);

-- A real lineage shape remains available beside v3's independent region fit.
create temporary table called_lineage as select jsonb_set(c,'{lineages,0}',
 (c#>'{lineages,0}') || '{"state":"available","observedPositions":1,"readablePositions":1,"reason":null,"call":{"haplogroup":"L3","path":["L3"],"matched":1,"tested":1,"support":"partial","note":"Synthetic lineage call"}}') c from seven_capture;
select lives_ok($$select pg_temp.validate(c) from called_lineage$$,'computed v2 lineage shape survives in a v3 capture');
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{lineages,0,call,support}','null')),
 '22023','invalid_ancestry_content','null lineage support is not an allowed support state') from called_lineage;

-- Historical captures remain attached to the old five-region panel, including
-- captures made before ranges existed and both stored lineage revisions.
create temporary table historical as select jsonb_set(jsonb_set(jsonb_set(jsonb_set(c,
 '{schemaVersion}','2'),'{computationRevision}','"own-ancestry-content-v2"'),'{panel}',
 '{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'),
 '{admixture}',jsonb_build_object('kind','admixture','model_id','aims-kidd-seldin-168','model_version','2026-08-28',
  'coverage',1,'result_state','available','basis','modelled','range','{"unavailable":true}'::jsonb,'resolution','five-broad-regions',
  'support_note','Synthetic historical fit','result','{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":168,"note":"Synthetic historical fit"}'::jsonb)) c
from seven_capture;
select lives_ok($$select pg_temp.validate(c) from historical$$,'v2 capture without ranges remains accepted');
select lives_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,ranges}','{"EUR":{"low":0.1,"high":0.3}}')),
 'historical v2 optional ranges retain their original contract') from historical;
select lives_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(jsonb_set(jsonb_set(c,
 '{schemaVersion}','1'),'{computationRevision}','"own-ancestry-content-v1"'),'{lineages}',
 '[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]')),
 'v1 capture retains its original uncomputed-lineage shape') from historical;
select throws_ok(format('select pg_temp.validate(%L::jsonb)',jsonb_set(c,'{admixture,result,proportions,OCE}','0')),
 '22023','invalid_ancestry_content','v3 support does not admit seven-region keys into historical v2 captures') from historical;

select ok(not has_function_privilege(role_name, 'private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)', 'execute'),
 role_name||' cannot invoke the existing private validator') from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok(not has_function_privilege(role_name, 'private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text)', 'execute'),
 role_name||' cannot invoke the new private validator') from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok(has_function_privilege('service_role', 'private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)', 'execute'),
 'service role retains existing validator access');
select ok(has_function_privilege('service_role', 'private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text)', 'execute'),
 'service role can invoke the new private validator');
select * from finish();
rollback;
