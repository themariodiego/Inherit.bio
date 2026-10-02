begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Real empty own accounts and live sessions. Request/nonce/attempt authority is
-- produced by the current doors, never inserted. Negative classification
-- mutations below are owner-only rollback corruption tests, not valid claims.
insert into auth.users(id,email)
 select ('79d00000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'due-'||i||'@e2e.local' from generate_series(1,18)i;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('79d10000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('79d00000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,now(),now(),'aal1' from generate_series(1,18)i;
create temporary table account_due_requests(n integer primary key,origin jsonb,capture jsonb,created jsonb);
insert into account_due_requests(n,origin)select i,jsonb_build_object('kind','account',
 'accountId',('79d00000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'sessionId',('79d10000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid)from generate_series(1,17)i;
grant select,update on account_due_requests to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update account_due_requests set capture=public.export_archive_request_v1('capture',origin,'account',(origin->>'accountId')::uuid);
update account_due_requests set created=public.export_archive_request_v1('create',origin,'account',(origin->>'accountId')::uuid,
 jsonb_build_object('exportCookieHash',md5(n::text)||md5(n::text||'cookie'),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId',origin->>'accountId',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',md5(n::text)||md5(n::text||'nonce'),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','every genuine request creation flushes deferred provenance before discovery');
set constraints all deferred;
create temporary table due_first as select public.export_archive_account_due_v1() value;
select is((select jsonb_array_length(value)from due_first),16,'account discovery retains the exact sixteen-job page cap');
select results_eq($$select item->>'exportId' as export_id from due_first d cross join lateral jsonb_array_elements(d.value)v(item)$$,
 $$select created->>'exportId' as export_id from account_due_requests order by created->>'exportId' limit 16$$,
 'all and only the first ordered genuine account jobs are discovered');
select set_eq($$select distinct k from due_first d cross join lateral jsonb_array_elements(d.value)v(item) cross join lateral jsonb_object_keys(item)k$$,
 $$select field from(values('exportId'),('authorityReceipt'),('principalHash'),('deadline'))expected(field)$$,
 'each descriptor contains only its four closed metadata fields');
select ok((select bool_and(item->>'authorityReceipt'=r.capture->>'authorityReceipt' and item->>'principalHash'=r.capture->>'principalHash')
 from due_first d cross join lateral jsonb_array_elements(d.value)v(item) join account_due_requests r on r.created->>'exportId'=item->>'exportId'),
 'discovered digests are the actually captured own request digests');
select is(jsonb_array_length(public.export_archive_account_due_v1((select (value->15->>'exportId')::uuid from due_first))),1,
 'the exact UUID cursor selects the remaining genuine job without overlap');
reset role;
select is((select count(*)from private.export_archive_attempts),0::bigint,'discovery creates no attempt');
select is((select count(*)from private.export_archive_segments),0::bigint,'discovery reserves or writes no object');
select is((select count(*)from private.export_archive_downloads),0::bigint,'discovery creates no download');
select is((select count(*)from public.generated_exports where status='ready'),0::bigint,'discovery publishes no READY');
select is((select count(*)from private.export_archive_nonce_uses),17::bigint,'discovery consumes no additional nonce');
select is((select md5(prosrc)from pg_proc where oid='public.export_archive_due_v1(text,uuid)'::regprocedure),
 'de5c138161172f8b1d49a93c4b66db13','the original mixed dispatcher body is unchanged');
select ok((select prosecdef and proconfig=array['search_path=pg_catalog','lock_timeout=250ms']::text[]
 and pg_get_userbyid(proowner)='postgres' and proargnames=array['p_after']::text[] and pronargs=1 and pronargdefaults=1
 and pg_get_expr(proargdefaults,0)='NULL::uuid' and prorettype='jsonb'::regtype
 from pg_proc where oid='public.export_archive_account_due_v1(uuid)'::regprocedure),
 'the exact narrow ABI/default/owner/configuration remains closed');
select ok(has_function_privilege('service_role','public.export_archive_account_due_v1(uuid)','execute'),
 'only the service API receives the new discovery door');
select ok(not has_table_privilege('service_role','private.export_archive_jobs','select'),
 'no private job SELECT grant is introduced');
select ok((select cardinality(proacl)=2 and not exists(select 1 from aclexplode(proacl)a
 where a.privilege_type<>'EXECUTE' or a.is_grantable or a.grantor<>proowner
 or a.grantee not in(proowner,(select oid from pg_roles where rolname='service_role')))
 from pg_proc where oid='public.export_archive_account_due_v1(uuid)'::regprocedure),
 'only exact owner and service EXECUTE ACL entries exist without grant options');
select ok(not has_function_privilege('anon','public.export_archive_account_due_v1(uuid)','execute'), 'anon cannot discover jobs');
select ok(not has_function_privilege('authenticated','public.export_archive_account_due_v1(uuid)','execute'), 'browser Auth cannot discover jobs');
select ok(not has_function_privilege('inherit_upload_only','public.export_archive_account_due_v1(uuid)','execute'), 'upload-only cannot discover jobs');
select throws_ok($$set local role anon;select public.export_archive_account_due_v1()$$,'42501',
 'permission denied for function export_archive_account_due_v1','actual anon invocation is denied');
select throws_ok($$set local role authenticated;select public.export_archive_account_due_v1()$$,'42501',
 'permission denied for function export_archive_account_due_v1','actual browser invocation is denied');
select throws_ok($$set local role inherit_upload_only;select public.export_archive_account_due_v1()$$,'42501',
 'permission denied for function export_archive_account_due_v1','actual upload invocation is denied before private reads');
select throws_ok($$select public.export_archive_account_due_v1()$$,'42501','not_found',
 'owner with service JWT cannot impersonate the actual service role');
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.export_archive_account_due_v1()$$,'42501','not_found','service role with human JWT is refused');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.export_archive_account_due_v1()$$,'42501','not_found','service role without service JWT is refused');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Owner-only corrupt classification probes all roll back; no attempt or
-- delivery is planted. The original due dispatcher retains its old selection.
savepoint wrong_route;
update private.export_archive_jobs set route_id='api.subject-export' where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'wrong registered route is excluded');
rollback to wrong_route;
savepoint wrong_contract;
update private.export_archive_jobs set export_contract='subject-export-v1' where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'wrong registered contract is excluded');
rollback to wrong_contract;
savepoint wrong_owner;
update private.export_archive_jobs set origin=jsonb_set(origin,'{accountId}','"79d00000-0000-4000-8000-000000000018"')
 where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'foreign origin owner is excluded');
rollback to wrong_owner;
savepoint rights_origin;
update private.export_archive_jobs set origin=jsonb_set(origin,'{kind}','"rights"')where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'independent-rights origin is never assigned to the account worker');
rollback to rights_origin;
savepoint subject_target;
update public.generated_exports set target_kind='subject' where id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'subject target is not an account request');
rollback to subject_target;
savepoint expired_job;
update private.export_archive_jobs set created_at=clock_timestamp()-interval '2 hours',deadline=clock_timestamp()-interval '1 hour'
 where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'expired immutable job is excluded');
rollback to expired_job;
savepoint too_close_deadline;
update private.export_archive_jobs set deadline=clock_timestamp()+interval '30 seconds'
 where export_id=(select (created->>'exportId')::uuid from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first));
set local role service_role;
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),
 'a job too near its original deadline cannot begin new generation');
rollback to too_close_deadline;
set local role service_role;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,'79d20000-0000-4000-8000-000000000001',capture->>'authorityReceipt')
 from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first);
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from account_due_requests where created->>'exportId'=(select value->0->>'exportId' from due_first))),'genuine current claimed attempt is excluded');
reset role;
select is((select count(*)from private.export_archive_attempts),1::bigint,'only the explicit genuine begin created an attempt');
select is((select count(*)from private.export_archive_segments),0::bigint,'no provider bytes or receipt are fabricated');
select * from finish();
rollback;
