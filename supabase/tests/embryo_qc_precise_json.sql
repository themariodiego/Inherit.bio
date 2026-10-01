begin;
select no_plan();
\ir fixtures/embryo_cohort_published.inc
set constraints all immediate;

-- Representation-only probe on the actual published synthetic fixture. These
-- counters reproduce the separately measured native seed-B ratio; the include's
-- invented ten-site calls/provider metadata are not claimed as native evidence.
update public.embryo_qc set sites_expected=1200,sites_called=1184,
 call_rate=1184::double precision/1200 where embryo_id=(select min(id::text)::uuid from public.embryos
 where cohort_id=(select cohort_id from live));
set local extra_float_digits=3;
create temporary table precise_expected as select (select cohort_id from live)cohort_id,
 array_agg(q.embryo_id order by q.embryo_id)ids,jsonb_agg(to_jsonb(q)order by q.embryo_id)body
 from public.embryo_qc q join public.embryos e on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live);
grant select on precise_expected to service_role;
set local extra_float_digits=0;
select is((select to_jsonb(q.call_rate)#>>'{}' from public.embryo_qc q
 where q.embryo_id=(select ids[1] from precise_expected)), '0.986666666666667',
 'actual default0 JSON formation truncates the unchanged binary ratio');
select is((select encode(pg_catalog.float8send(q.call_rate),'hex') from public.embryo_qc q
 where q.embryo_id=(select ids[1] from precise_expected)), '3fef92c5f92c5f93',
 'the stored binary double is the measured1184/1200 ratio');

select ok(not has_function_privilege(r,'public.read_embryo_qc_rows_v1(uuid,uuid[])','execute'),
 r||' cannot call the internal QC reader')from(values('anon'),('authenticated'),('inherit_upload_only'))roles(r);
select ok(has_function_privilege('service_role','public.read_embryo_qc_rows_v1(uuid,uuid[])','execute'),
 'only the genuine service transport has reader execution');
select ok((select not prosecdef and proconfig=array['search_path=""','extra_float_digits=3']::text[]
 from pg_proc where oid='public.read_embryo_qc_rows_v1(uuid,uuid[])'::regprocedure),
 'new reader is invoker-only with exact local precision and empty search path');
select ok((select p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and md5(p.prosrc)=x.body_md5
 and p.proconfig=array['search_path=""','extra_float_digits=3']::text[]
 and has_function_privilege('service_role',p.oid,'execute')=x.service_execute
 and not has_function_privilege('anon',p.oid,'execute')
 and not has_function_privilege('authenticated',p.oid,'execute')
 and not has_function_privilege('inherit_upload_only',p.oid,'execute')
 from pg_proc p where p.oid=x.signature::regprocedure),
 x.signature||' preserves its exact body, owner, security and ACL with one intentional local setting')
 from(values
 ('private.future_person_export_snapshot_v1(text)','7ae505cb92d301a41a2a263be1702547',false),
 ('private.future_person_bound_export_snapshot_v1(jsonb,uuid)','6f202bda0cc049ed12306e4ef5916352',false),
 ('public.future_person_export_members_v1(text,uuid,uuid,text,text)','8510090f140b1680cca24da74fdc48c5',true),
 ('public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)','36f818dc8b24f0f7ff9ceb431eb7ce46',true)
 )x(signature,body_md5,service_execute);

set local role anon;
select throws_ok($$select public.read_embryo_qc_rows_v1('ad340000-0000-4000-8000-000000000001',array['ad340000-0000-4000-8000-000000000002']::uuid[])$$,
 '42501','permission denied for function read_embryo_qc_rows_v1','actual anonymous invocation is denied before any QC read');
reset role;
set local role authenticated;
select throws_ok($$select public.read_embryo_qc_rows_v1('ad340000-0000-4000-8000-000000000001',array['ad340000-0000-4000-8000-000000000002']::uuid[])$$,
 '42501','permission denied for function read_embryo_qc_rows_v1','actual authenticated invocation is denied before any QC read');
reset role;
set local role inherit_upload_only;
select throws_ok($$select public.read_embryo_qc_rows_v1('ad340000-0000-4000-8000-000000000001',array['ad340000-0000-4000-8000-000000000002']::uuid[])$$,
 '42501','permission denied for function read_embryo_qc_rows_v1','actual upload-only invocation is denied before any QC read');
reset role;

-- A JWT string alone never turns a PostgreSQL caller into the service role.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected))$$,
 '42501','not_found','a postgres caller with service claims is refused');
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected))$$,
 '42501','not_found','actual service role with a foreign JWT is refused');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected))$$,
 '42501','not_found','actual service role without the genuine service JWT is refused');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected)),
 (select body from precise_expected),'genuine role+JWT preserve the complete22-field QC rows and immutable provenance');
select is(public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected))->0->>'call_rate',
 '0.9866666666666667','scoped reader returns the exact measured nonterminating ratio');
select is((select count(*)from jsonb_object_keys(public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 (select ids from precise_expected))->0)),22::bigint,'the complete closed QC row has exactly22 registered fields');
select is(encode(pg_catalog.float8send((public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 (select ids from precise_expected))->0->>'call_rate')::double precision),'hex'),'3fef92c5f92c5f93',
 'a complete JSON read roundtrips to the identical stored double bits');
select is(current_setting('extra_float_digits'),'0','successful reader restores the original session setting');
select throws_ok($$select public.read_embryo_qc_rows_v1('ad340000-0000-4000-8000-0000000000ff',(select ids from precise_expected))$$,
 '42501','not_found','foreign cohort refuses the whole request');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 array[(select ids[1] from precise_expected),'ad340000-0000-4000-8000-0000000000ff'::uuid])$$,
 '42501','not_found','one missing or foreign embryo refuses the whole request');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 array[(select ids[1] from precise_expected),(select ids[1] from precise_expected)])$$,
 '22023','invalid_request','duplicate identity cannot pretend to be a complete selection');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),array[]::uuid[])$$,
 '22023','invalid_request','empty identity selection is refused');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),null)$$,
 '22023','invalid_request','null identity selection is refused');
select throws_ok($$select public.read_embryo_qc_rows_v1(null,(select ids from precise_expected))$$,
 '22023','invalid_request','null cohort is refused');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),array[null::uuid])$$,
 '22023','invalid_request','null embryo is refused');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 array[[(select ids[1] from precise_expected),(select ids[2] from precise_expected)]])$$,
 '22023','invalid_request','multidimensional selection is refused before array_position');
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),
 array_fill((select ids[1] from precise_expected),array[65]))$$,
 '22023','invalid_request','above the original registered64-sample capacity is refused');
select is(current_setting('extra_float_digits'),'0','all refused readers restore the original session setting');
reset role;
set local extra_float_digits=3;
select is((select jsonb_agg(to_jsonb(q)order by q.embryo_id)from public.embryo_qc q
 where q.embryo_id in(select unnest(ids)from precise_expected)), (select body from precise_expected),
 'all reads and refusals leave every stored value and source receipt unchanged');
delete from public.embryo_qc where embryo_id=(select ids[2] from precise_expected);
set local extra_float_digits=0;
set local role service_role;
select throws_ok($$select public.read_embryo_qc_rows_v1((select cohort_id from precise_expected),(select ids from precise_expected))$$,
 '42501','not_found','an otherwise valid published selection with a missing QC row refuses all rows');
select is(current_setting('extra_float_digits'),'0','partial-row refusal also restores the original session setting');
reset role;
select *from finish();
rollback;
