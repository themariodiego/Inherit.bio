begin;
select no_plan();
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
-- Complete documentary/binding/physical-source predecessor above; this actual
-- service-role protocol consumes a real create envelope and begins a durable
-- writing attempt. Synthetic accounts/provider ACKs remain explicit boundaries.
create temporary table bound_archive(origin jsonb,capture jsonb,created jsonb,attempt uuid,source jsonb);
insert into bound_archive(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),gen_random_uuid());
grant select,update on bound_archive to service_role;grant select on custody_ids to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update bound_archive set capture=public.export_archive_request_v1('capture',origin,'subject',(select subject from custody_ids));
select ok((select capture->'subjectPartitions'=jsonb_build_array((select subject from custody_ids)) and capture->>'fileCount'='1'
 from bound_archive),'durable account origin captures exactly its current moved claimed-bound subject');
select is((select public.export_archive_request_v1('capture',origin,'subject',(select subject from custody_ids))->>'authorityReceipt'
 from bound_archive),(select capture->>'authorityReceipt' from bound_archive),'dynamic read deadlines never change the stable source authority digest');
update bound_archive set created=public.export_archive_request_v1('create',origin,'subject',(select subject from custody_ids),
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.subject-export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','subject','targetId',(select subject from custody_ids),
 'exportContract','subject-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('a',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','actual queued export creation flushes every deferred origin and storage invariant');
set constraints all deferred;
select throws_ok($$select public.export_archive_bound_source_v1('manifest',(select (created->>'exportId')::uuid from bound_archive),
 (select attempt from bound_archive),(select capture->>'authorityReceipt' from bound_archive))$$,'42501','export_source_unavailable',
 'a genuine consumed request still gives no source before an actual writing attempt begins');
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from bound_archive$$,
 'the actual durable worker claims one fresh writing attempt');
update bound_archive set source=public.export_archive_bound_source_v1('manifest',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt');
select ok((select source->>'version'='bound-account-archive-source-v1' and jsonb_array_length(source#>'{source,parts}')=2
 and source#>>'{source,actor,sessionId}'='7b100000-0000-4000-8000-000000000002' from bound_archive),
 'service worker source is selected by stored real account/session and complete source proof without a human JWT');
select is((select public.export_archive_bound_source_v1('check',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',source->'source')
 from bound_archive),(select source from bound_archive),'the exact durable source receipt rechecks through the service-only worker door');
select throws_ok($$select public.export_archive_bound_source_v1('manifest',(select (created->>'exportId')::uuid from bound_archive),
 gen_random_uuid(),(select capture->>'authorityReceipt' from bound_archive))$$,'42501','export_source_unavailable','foreign attempt cannot use another durable source');
select throws_ok($$select public.export_archive_bound_source_v1('check',(select (created->>'exportId')::uuid from bound_archive),
 (select attempt from bound_archive),(select capture->>'authorityReceipt' from bound_archive),
 (select source->'source'||jsonb_build_object('purpose','embryo.analysis') from bound_archive))$$,'42501','export_source_unavailable',
 'a durable source worker cannot turn own access into an analytical grant');
select ok((select public.export_archive_request_v1('capture',origin,'account',
 '7b100000-0000-4000-8000-000000000001')->'subjectPartitions'=(select jsonb_agg(id order by id) from public.subjects
 where subject_account_id='7b100000-0000-4000-8000-000000000001' and lifecycle<>'purged')
 and public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001')->>'fileCount'='1'
 from bound_archive),'whole own authority includes the exact current self and complete bound source without omitting either partition');
reset role;
select ok(not has_function_privilege('authenticated','public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb)','execute')
 and not has_function_privilege('anon','public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb)','execute')
 and has_function_privilege('service_role','public.export_archive_bound_source_v1(text,uuid,uuid,text,jsonb)','execute'),
 'only the actual service worker can use the distinct durable source door');
select ok(not has_function_privilege('service_role','public.future_person_bound_source_manifest_v1(uuid)','execute')
 and not has_function_privilege('service_role','public.check_future_person_bound_source_v1(uuid,jsonb)','execute'),
 'background source integration leaves both human reading doors denied to service role');
select ok((select not(origin ? 'jwt') and not(origin ? 'accessToken') from private.export_archive_jobs),
 'durable origin persists no human JWT or access token');
savepoint no_create_nonce;
delete from private.export_archive_nonce_uses where export_id=(select (created->>'exportId')::uuid from bound_archive);
set local role service_role;
select throws_ok($$select public.export_archive_bound_source_v1('manifest',(select (created->>'exportId')::uuid from bound_archive),
 (select attempt from bound_archive),(select capture->>'authorityReceipt' from bound_archive))$$,'42501','export_source_unavailable',
 'a stored job/attempt without its real consumed create envelope refuses');
reset role;rollback to no_create_nonce;
savepoint revoked_session;
delete from auth.sessions where id='7b100000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.export_archive_bound_source_v1('manifest',(select (created->>'exportId')::uuid from bound_archive),
 (select attempt from bound_archive),(select capture->>'authorityReceipt' from bound_archive))$$,'42501',null,
 'a revoked real account session refuses background source access');
reset role;rollback to revoked_session;
create temporary table stale_source_jobs_before as select jsonb_build_object(
 'exports',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.generated_exports r),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from private.export_archive_jobs r),
 'nonceUses',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from private.export_archive_nonce_uses r)
) snapshot;
savepoint stale_source;
update public.subjects set lifecycle_revision=lifecycle_revision+1 where id=(select subject from custody_ids);
set local role service_role;
select throws_ok($$select public.export_archive_bound_source_v1('manifest',(select (created->>'exportId')::uuid from bound_archive),
 (select attempt from bound_archive),(select capture->>'authorityReceipt' from bound_archive))$$,'42501','not_found',
 'a changed bound source/current revision refuses the original durable receipt');
reset role;
select is(jsonb_build_object(
 'exports',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.generated_exports r),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from private.export_archive_jobs r),
 'nonceUses',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from private.export_archive_nonce_uses r)
),(select snapshot from stale_source_jobs_before),'stale source refusal leaves every durable export, job and consumed envelope byte-identical');
rollback to stale_source;
select ok(not has_function_privilege('service_role','private.future_person_bound_source_for_actor_v1(uuid,timestamptz,jsonb)','execute')
 and not has_function_privilege('authenticated','private.future_person_archive_account_actor_v1(uuid,uuid)','execute'),
 'a caller cannot supply actor IDs directly to the private source core');
select * from finish();rollback;
