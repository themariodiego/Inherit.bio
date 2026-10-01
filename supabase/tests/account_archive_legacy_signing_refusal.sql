\ir fixtures/future_person_completed_bound_source.inc
-- The original narrow source fixture has no fabricated historical name. It
-- still proves real approval/binding/current-location access above, but cannot
-- become a complete scientific and signed-agreement archive without that proof.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.export_archive_request_v1('capture',jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),
 'subject',(select subject from custody_ids))$$,'55000','export_historical_agreement_unavailable',
 'complete bound subject capture refuses the actual abbreviated historical signing predecessor');
select throws_ok($$select public.export_archive_request_v1('capture',jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),
 'account','7b100000-0000-4000-8000-000000000001')$$,'55000','export_historical_agreement_unavailable',
 'whole-account capture cannot hide that incomplete historical partition');
reset role;
select is((select count(*) from public.generated_exports),0::bigint,'every legacy signing refusal creates no export job');
select * from finish();rollback;
