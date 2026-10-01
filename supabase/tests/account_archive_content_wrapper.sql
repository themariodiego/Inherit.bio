begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/account_archive_ordinary_scientific.inc
create temporary table actual_account_content(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_account_content(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),gen_random_uuid());
grant select,update on actual_account_content to service_role;
grant select on export_snapshot,normalization_subject to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_account_content set capture=public.export_archive_request_v1('capture',origin,'account','77900000-0000-4000-8000-000000000001');
update actual_account_content set created=public.export_archive_request_v1('create',origin,'account','77900000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','77900000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('7',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','real ordinary account archive creation commits every deferred source/nonce invariant before the worker');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_account_content;
create function pg_temp.actual_content(op text,payload jsonb) returns jsonb language sql as $$
 select public.export_archive_account_content_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload)
 from actual_account_content
$$;
select is(pg_temp.actual_content('variants',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',(select value from export_snapshot),'offset',0)),pg_temp.export_content('variants'),
 'the real consumed account worker returns exactly the actual normalized own variants');
select is(pg_temp.actual_content('reports',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',(select value from export_snapshot),'offset',0)),pg_temp.export_content('reports'),
 'the actual completed report is returned verbatim under BOTH original source and durable request authority');
select is(pg_temp.actual_content('prs',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',(select value from export_snapshot),'offset',0)),pg_temp.export_content('prs'),
 'actual completed PRS coverage preserves the original numeric-field exclusions');
select is(pg_temp.actual_content('history','{"kind":"subjects","afterId":null}')#>>'{rows,0,id}',
 (select id::text from normalization_subject),'complete ordinary own metadata uses the actual current subject rather than a client-selected actor');
select throws_ok($$select pg_temp.actual_content('variants',jsonb_build_object('fileId',gen_random_uuid(),
 'snapshot',(select value from export_snapshot),'offset',0))$$,'42501','not_found','a foreign or unenumerated source cannot compose ordinary read authority');
select throws_ok($$select pg_temp.actual_content('check',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',jsonb_set((select value from export_snapshot),'{binding,sessionId}',to_jsonb(gen_random_uuid()))))$$,
 '42501','not_found','a forged human session cannot be substituted into the actual stored worker source');
select throws_ok($$select pg_temp.actual_content('history','{"kind":"subjects","afterId":null,"accountId":"77900000-0000-4000-8000-000000000001"}')$$,
 '22023','invalid_request','the existing closed reader refuses extra actor/selection payload fields');
select throws_ok($$select pg_temp.actual_content('files','{}')$$,'22023','invalid_request','the wrapper cannot replace exhaustive server file selection with a narrowed old list');
reset role;
savepoint revoked_actual_purpose;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where target_id=(select id from normalization_subject) and purpose='reports.polygenic';
set local role service_role;
select throws_ok($$select pg_temp.actual_content('reports',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',(select value from export_snapshot),'offset',0))$$,'42501',null,
 'actual purpose withdrawal invalidates the old complete receipt and refuses stored report delivery');
reset role;rollback to revoked_actual_purpose;
savepoint revoked_actual_session;
delete from auth.sessions where id='77900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.actual_content('variants',jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040',
 'snapshot',(select value from export_snapshot),'offset',0))$$,'42501',null,'logout refuses raw calls through the account worker before any returned page');
reset role;rollback to revoked_actual_session;
select is(has_function_privilege(r,'public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb)','execute'),r='service_role',
 r||' exact distinct account content worker grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select * from finish();rollback;
