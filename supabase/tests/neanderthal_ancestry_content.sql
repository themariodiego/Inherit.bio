begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- The Neanderthal estimate's content validation (migration
-- 20261022100000). Assumes that migration is applied (the test DB applies all
-- migrations first). Every assertion uses public panel metadata and invented
-- counts only; it creates no source, account, grant, journal or storage
-- object, and all DDL rolls back.
--
-- It proves two things: revision 5 is accepted only with a strict `neanderthal`
-- block and refused for each way of corrupting it, and revisions 1 to 4 are
-- validated exactly as before (the v5 branch is reached only for
-- schemaVersion=5, and it hands the rest to the unchanged v4 branch).

-- A valid revision-3 seven-region capture (the same shape the existing suite
-- uses), from which v4 and v5 are derived by jsonb_set.
create temporary table base(v3 jsonb);
insert into base values ('{"schemaVersion":3,"computationRevision":"own-ancestry-content-v3","source":{"fileId":"78830000-0000-4000-8000-000000000001","subjectId":"78830000-0000-4000-8000-000000000002","normalizedBuild":"GRCh38","sourceRevision":1,"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","callEncoding":"vcf-literal","normalizedAt":"2026-09-15T00:00:00Z"},"panel":{"id":"aims-hgdp-tgp-168","version":"hgdp-1kg-v3.1.2-cap30-168-v1","provenance":"data/ref/AIMS_SEVEN_REGION_PROVENANCE.md","markerSha256":"54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163","markerCount":168,"minimumMarkers":168},"admixture":{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.1,"CSA":0.15,"EAS":0.15,"EUR":0.25,"MID":0.1,"OCE":0.05},"markersUsed":168,"note":"These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.","fit":{"iterations":30,"converged":true},"reporting":{"policy":"merge-eur-mid-csa-v1","threshold":0.1,"merged":true,"caveat":"This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often."}},"support_note":"These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.","model_id":"aims-hgdp-tgp-168","model_version":"hgdp-1kg-v3.1.2-cap30-168-v1","coverage":1,"result_state":"available","basis":"modelled","range":{"unavailable":true},"resolution":"seven-regions-adaptive-v1"},"panelPositions":{"called":168,"missing":0,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0},"lineages":[{"kind":"mtdna","state":"unavailable","tree":{"id":"inherit-mtdna-curated-subset","version":"Build 17, Forensic Update 1a","sha256":"fb34d38ac78a900172a398e168b54b786711dbe662c12659db5fd09c6666efd1"},"markerPositions":106,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"},{"kind":"ydna","state":"unavailable","tree":{"id":"inherit-ydna-curated-subset","version":"2016 index (4 January 2016)","sha256":"b5e956ec511dc3c4c3c40e38862c2e5af513be675cacead0b31469b174a168e3"},"markerPositions":31,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"}]}'::jsonb);

create function pg_temp.validate(c jsonb, encoding text default 'vcf-literal') returns void language sql as $$
 select private.validate_own_ancestry_content_v1(c,
  '78830000-0000-4000-8000-000000000001','78830000-0000-4000-8000-000000000002',
  jsonb_build_object('sourceRevision',1,'sourceSha256',repeat('a',64),'normalizedAt','2026-09-15T00:00:00Z'),encoding);
$$;

-- v4 = v3 plus figureBasis; v5 = v4 plus a neanderthal block.
create function pg_temp.v4(v3 jsonb) returns jsonb language sql as $$
 select jsonb_set(jsonb_set(jsonb_set(v3,'{schemaVersion}','4'),'{computationRevision}','"own-ancestry-content-v4"'),
  '{figureBasis}','{"shares":{"version":1,"basis":"modelled"},"coverage":{"version":1,"basis":"observed"}}');
$$;
create function pg_temp.v5(v3 jsonb, neanderthal jsonb) returns jsonb language sql as $$
 select jsonb_set(jsonb_set(jsonb_set(pg_temp.v4(v3),'{schemaVersion}','5'),'{computationRevision}','"own-ancestry-content-v5"'),
  '{neanderthal}',neanderthal);
$$;

create temporary table block(covered jsonb, empty jsonb);
insert into block values (
 '{"panelId":"neanderthal-sprime-1kg-v1","panelVersion":"browning2018-sprime-ceu-chb-gih-grch38-2026-10-22","markerSha256":"21f0862ed04f21ddd3fc338b599088e8f5d24b1f928547b4b79030a1b4709e93","panelSites":3110,"coveredSites":200,"archaicSites":80,"estimate":0.4,"interval":{"low":0.33,"high":0.46},"resamples":200,"basis":"modelled"}'::jsonb,
 '{"panelId":"neanderthal-sprime-1kg-v1","panelVersion":"browning2018-sprime-ceu-chb-gih-grch38-2026-10-22","markerSha256":"21f0862ed04f21ddd3fc338b599088e8f5d24b1f928547b4b79030a1b4709e93","panelSites":3110,"coveredSites":0,"archaicSites":0,"estimate":null,"interval":null,"resamples":200,"basis":"modelled"}'::jsonb);

-- Revisions 1 to 4 are validated exactly as before the migration.
select lives_ok($$select pg_temp.validate(v3) from base$$,'v3 capture still accepted after the v5 branch is added');
select lives_ok($$select pg_temp.validate(pg_temp.v4(v3)) from base$$,'v4 capture still accepted');
select throws_ok($$select pg_temp.validate(pg_temp.v4(v3) - 'figureBasis') from base$$,
 '22023','invalid_ancestry_content','v4 still refuses a missing figureBasis');
select throws_ok($$select pg_temp.validate(jsonb_set(v3,'{admixture,result,proportions,OCE}','0')) from base$$,
 '22023','invalid_ancestry_content','v3 still refuses proportions that do not sum to one');
select throws_ok($$select pg_temp.validate(jsonb_set(v3,'{extra}','1')) from base$$,
 '22023','invalid_ancestry_content','v3 still refuses an unknown top-level key');

-- Revision 5 is accepted only with a strict, consistent neanderthal block.
select lives_ok($$select pg_temp.validate(pg_temp.v5(v3,covered)) from base,block$$,'v5 covered estimate accepted');
select lives_ok($$select pg_temp.validate(pg_temp.v5(v3,empty)) from base,block$$,'v5 no-coverage estimate accepted (null estimate and interval)');

select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,covered || '{"extra":1}')) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses an unknown key in the neanderthal block');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.v5(v3,covered),'{extra}','1')) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses an unknown top-level key');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{estimate}','0.9'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses an estimate that is not archaic/covered');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{interval}','{"low":0.46,"high":0.33}'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses an inverted interval');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{interval}','{"low":0.1,"high":0.2}'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses an interval that does not bracket the estimate');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{markerSha256}',to_jsonb(repeat('b',64))))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses a wrong panel sha256');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{panelSites}','3109'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses a wrong panel site count');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{basis}','"observed"'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses a non-modelled basis');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(covered,'{archaicSites}','500'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses more archaic sites than covered');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,covered - 'interval')) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses a missing required key');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.v5(v3,covered),'{padding}',to_jsonb(repeat('x',70000)))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses content over the 64 KiB cap');
select throws_ok($$select pg_temp.validate(pg_temp.v5(v3,jsonb_set(jsonb_set(empty,'{coveredSites}','5'),'{archaicSites}','2'))) from base,block$$,
 '22023','invalid_ancestry_content','v5 refuses a covered count with a null estimate');

select * from finish();
rollback;
