begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Unchanged real Auth/signing/normalization/report producers. Storage catalog
-- metadata is synthetic SQL-only identity evidence, never provider byte proof.
\ir fixtures/account_archive_ordinary_scientific.inc
create temporary table actual_original_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_original_job(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),gen_random_uuid());
grant select,update on actual_original_job to service_role;
grant select on export_snapshot,normalization_subject to service_role;

savepoint unproved_original_version;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_original_job set capture=public.export_archive_request_v1('capture',origin,'account','77900000-0000-4000-8000-000000000001');
update actual_original_job set created=public.export_archive_request_v1('create',origin,'account','77900000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','77900000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('7',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','real original request commits every deferred creation invariant before worker reads');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_original_job;

select throws_ok($$select public.export_archive_account_original_v1('descriptor',
 (select (created->>'exportId')::uuid from actual_original_job),(select attempt from actual_original_job),
 (select capture->>'authorityReceipt' from actual_original_job),'77900000-0000-4000-8000-000000000040')$$,
 '42501','not_found','an actual consumed request cannot invent an absent legacy Storage version');
reset role;
rollback to unproved_original_version;
-- A genuine catalog version, fixed synthetic UUID, exists before the new
-- capture. Updating metadata in SQL does not attest to actual provider bytes.
update storage.objects set version='77900000-0000-4000-8000-000000000021'
 where id='77900000-0000-4000-8000-000000000020';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_original_job set capture=public.export_archive_request_v1('capture',origin,'account','77900000-0000-4000-8000-000000000001');
update actual_original_job set created=public.export_archive_request_v1('create',origin,'account','77900000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','77900000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('7',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','real original request commits every deferred creation invariant before worker reads');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_original_job;

create function pg_temp.original(op text,expected jsonb default null) returns jsonb language sql as $$
 select public.export_archive_account_original_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 '77900000-0000-4000-8000-000000000040',expected) from actual_original_job
$$;
create temporary table actual_original_descriptor as select pg_temp.original('descriptor') value;
grant select on actual_original_descriptor to service_role;
select is(pg_temp.original('check',(select value from actual_original_descriptor)),
 (select value from actual_original_descriptor),'a real current consumed writing attempt rechecks the exact descriptor');
select set_eq($$select jsonb_object_keys(value) from actual_original_descriptor$$,
 $$values('version'),('exportId'),('attemptId'),('authorityReceipt'),('fileId'),('state'),('source'),('decodedSha256'),('actor')$$,
 'the actual source response has the exact nine-field closed envelope');
select is((select value->>'version' from actual_original_descriptor),'account-archive-original-v1','the actual ordinary descriptor has its own fixed kind');
select is((select value->'actor' from actual_original_descriptor),
 '{"accountId":"77900000-0000-4000-8000-000000000001","sessionId":"77900000-0000-4000-8000-000000000010"}'::jsonb,
 'actor and session come from the actual consumed request rather than caller arguments');
select is((select value->'state' from actual_original_descriptor),jsonb_build_object('version','own-original-download-state-v1',
 'fileId','77900000-0000-4000-8000-000000000040','prepared',false,'retired',false,'expiresAt',null),
 'the actual legacy source cannot invent preparation or an original retirement warning');
select is((select value->'source'-'expiresAt' from actual_original_descriptor),jsonb_build_object(
 'version','account-original-download-v1','fileId','77900000-0000-4000-8000-000000000040',
 'sourceRevision',1,'rawSha256',repeat('a',64),'bucket','genomes','objectId','77900000-0000-4000-8000-000000000020',
 'objectKey','77900000-0000-4000-8000-000000000030','storageVersion','77900000-0000-4000-8000-000000000021','sizeBytes',8),
 'every actual legacy locator/revision/raw hash equals independent real Storage and file metadata, without a prepared manifest');
select is((select value->>'decodedSha256' from actual_original_descriptor),repeat('b',64),
 'the actual decoded source identity remains distinct from the raw original identity');
select throws_ok($$select pg_temp.original('check',(select jsonb_set(value,'{actor,accountId}',to_jsonb(gen_random_uuid()))
 from actual_original_descriptor))$$,'42501','not_found','a forged actor cannot reuse current original authority');
select throws_ok($$select pg_temp.original('check',(select jsonb_set(value,'{source,storageVersion}',to_jsonb(gen_random_uuid()))
 from actual_original_descriptor))$$,'42501','not_found','a caller cannot retarget the physical version');
select throws_ok($$select pg_temp.original('descriptor','{}')$$,'22023','invalid_request','descriptor does not accept caller-selected source metadata');
select throws_ok($$select pg_temp.original('check')$$,'22023','invalid_request','check cannot silently mint a new receipt');
select throws_ok($$select pg_temp.original('check',(select value||'{"humanJwt":"forbidden"}'::jsonb from actual_original_descriptor))$$,
 '22023','invalid_request','open extra credentials cannot cross the closed source envelope');
select throws_ok($$select public.export_archive_account_original_v1('descriptor',
 (select (created->>'exportId')::uuid from actual_original_job),gen_random_uuid(),
 (select capture->>'authorityReceipt' from actual_original_job),'77900000-0000-4000-8000-000000000040')$$,
 '42501','export_source_unavailable','a foreign writing attempt cannot borrow an ordinary source');
select throws_ok($$select public.export_archive_account_original_v1('descriptor',
 (select (created->>'exportId')::uuid from actual_original_job),(select attempt from actual_original_job),
 (select capture->>'authorityReceipt' from actual_original_job),gen_random_uuid())$$,
 '42501','not_found','an unselected file is not a narrowed worker source');
reset role;
select ok((select (d.value#>>'{source,expiresAt}')::timestamptz>clock_timestamp()
 and (d.value#>>'{source,expiresAt}')::timestamptz<=clock_timestamp()+interval '270 seconds'
 and (d.value#>>'{source,expiresAt}')::timestamptz<=j.deadline-interval '30 seconds'
 and (d.value#>>'{source,expiresAt}')::timestamptz<=a.lease_expires_at
 from actual_original_descriptor d cross join actual_original_job fixture
 join private.export_archive_jobs j on j.export_id=(fixture.created->>'exportId')::uuid
 join private.export_archive_attempts a on a.id=fixture.attempt),
 'the actual byte lease never extends the independent current writing or whole-job deadline');
create function pg_temp.original_job_state() returns jsonb language sql as $$
 select jsonb_build_object('export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_original_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_original_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_original_job)))
$$;
create temporary table unchanged_original_job as select pg_temp.original_job_state() value;
savepoint changed_actual_version;
update storage.objects set version=gen_random_uuid()::text where id='77900000-0000-4000-8000-000000000020';
set local role service_role;
select throws_ok($$select pg_temp.original('descriptor')$$,'42501','not_found','even descriptor minting cannot adopt a changed actual version into the old consumed graph');
select throws_ok($$select pg_temp.original('check',(select value from actual_original_descriptor))$$,
 '42501','not_found','the actual version change refuses the original exact byte receipt');
reset role;rollback to changed_actual_version;
savepoint changed_actual_size;
update storage.objects set metadata='{"size":9}' where id='77900000-0000-4000-8000-000000000020';
set local role service_role;
select throws_ok($$select pg_temp.original('descriptor')$$,'42501','not_found','physical size mismatch refuses the whole original reader');
reset role;rollback to changed_actual_size;
savepoint actual_original_logout;
delete from auth.sessions where id='77900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.original('check',(select value from actual_original_descriptor))$$,
 '42501','not_found','real logout refuses every later byte range and archive open');
reset role;rollback to actual_original_logout;
select is(has_function_privilege(r,'public.export_archive_account_original_v1(text,uuid,uuid,text,uuid,jsonb)','execute'),r='service_role',
 r||' exact consumed original-source reader grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call the internal original/frame predecessor')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.export_account_original_frame_v1(uuid,boolean)','private.export_account_owned_capture_pre_original_v1(jsonb,text,uuid)'])f;
select is(pg_temp.original_job_state(),(select value from unchanged_original_job),
 'all actual source reads and strict refusals preserve every durable export/job/attempt byte');
select lives_ok('set constraints all immediate','the actual positive read journey ends with every real deferred transaction invariant valid');
select * from finish();rollback;
