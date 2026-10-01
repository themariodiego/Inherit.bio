begin;
select no_plan();
-- Only the signing cipher is an explicit metadata seam. The original attested
-- approval, real release activation, own Auth binding and complete relocation
-- protocols still create every authority row themselves. No provider/browser
-- evidence is asserted by synthetic SQL transport receipts.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
\ir fixtures/future_person_recorded_scientific_members.inc
grant select on recorded_finding to service_role;
create temporary table owned_archive(origin jsonb,capture jsonb,created jsonb,attempt uuid,context jsonb,source jsonb);
insert into owned_archive(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),gen_random_uuid());
grant select,update on owned_archive to service_role;grant select on custody_ids to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update owned_archive set capture=public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001');
select is((select capture->'subjectPartitions' from owned_archive),
 (select jsonb_agg(id order by id) from public.subjects where subject_account_id='7b100000-0000-4000-8000-000000000001' and lifecycle<>'purged'),
 'whole own capture contains every real current self and claimed-bound subject exactly once');
select is((select capture->>'fileCount' from owned_archive),'1','whole own capture contains the exact one fully moved canonical source');
select is((select public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001')->>'authorityReceipt'
 from owned_archive),(select capture->>'authorityReceipt' from owned_archive),'fresh bounded source envelopes preserve the exact complete stable authority receipt');
update owned_archive set created=public.export_archive_request_v1('create',origin,'account','7b100000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','7b100000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('a',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','actual whole-account export creation flushes every deferred invariant before a later worker transaction');
set constraints all deferred;
select throws_ok($$select public.export_archive_account_members_v1('context',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive))$$,'42501','export_source_unavailable',
 'a genuine consumed account request still gives no members without a live writing attempt');
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from owned_archive$$,
 'the actual durable worker starts exactly this whole-account attempt');
update owned_archive set context=public.export_archive_account_members_v1('context',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt');
select is((select array_agg(k order by k) from owned_archive,jsonb_object_keys(context) k),
 array['actor','authorityReceipt','capturedAt','deadline','fileCount','partitions','targetId','targetKind','version'],'the worker context has exactly its closed registered fields');
select ok((select context->>'version'='account-archive-members-v1' and context->>'targetKind'='account'
 and context#>>'{actor,accountId}'='7b100000-0000-4000-8000-000000000001'
 and context#>>'{actor,sessionId}'='7b100000-0000-4000-8000-000000000002' and jsonb_array_length(context->'partitions')=2
 and context->>'fileCount'='1' from owned_archive),'the background worker selects the stored genuine account/session and complete own partition graph');
select is((select x->'fileIds' from owned_archive,jsonb_array_elements(context->'partitions') x where x->>'class'='claimed-bound'),
 jsonb_build_array((select file from custody_ids)),'the bound class contains exactly its actual immutable source file');
select is((select public.export_archive_account_members_v1('ordinary-files',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt')
 from owned_archive),'[]'::jsonb,'the actual file-free ordinary self partition has no fabricated file');
select is((select public.export_archive_account_members_v1('bound-context',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))#>>'{membership,reports}' from owned_archive),'1','all real recorded reports are included in the bound scientific snapshot');
select is((select public.export_archive_account_members_v1('variants',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))->>'count' from owned_archive),'2','every real immutable canonical call is selected under the same account job');
select is((select public.export_archive_account_members_v1('variants',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids),(select max(id)::text from public.embryo_variants where source_file_id=(select file from custody_ids)))->>'count' from owned_archive),'0','bounded keyset pagination proves real complete variant EOF');
select is((select public.export_archive_account_members_v1('figures',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))->>'count' from owned_archive),'4','every original historical figure remains bound to its actual finding');
select is((select public.export_archive_account_members_v1('reports',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))#>'{rows,0,artifact}' from owned_archive),(select body from recorded_finding),
 'actual historical report bytes are returned without substituting a current template');
select is((select public.export_archive_account_members_v1('legal-audit',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))#>>'{rows,0,event,event_code}' from owned_archive),'claimant.account_bound',
 'the genuine binding audit selector yields only its actually issued binding event');
update owned_archive set source=public.export_archive_account_bound_source_v1('manifest',(created->>'exportId')::uuid,attempt,
 capture->>'authorityReceipt',(select subject from custody_ids));
select ok((select jsonb_array_length(source#>'{source,parts}')=2 and source#>>'{source,actor,sessionId}'=context#>>'{actor,sessionId}' from owned_archive),
 'the exact consumed whole-account job selects every completely moved own canonical part');
select is((select public.export_archive_account_bound_source_v1('check',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids),source->'source') from owned_archive),(select source from owned_archive),'full exact source proof rechecks before any returned byte');
select throws_ok($$select public.export_archive_account_members_v1('bound-context',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive),(select id from claimant_account_self))$$,
 '42501','not_found','an ordinary partition cannot choose a bound scientific reader');
select throws_ok($$select public.export_archive_account_bound_source_v1('manifest',(select (created->>'exportId')::uuid from owned_archive),
 gen_random_uuid(),(select capture->>'authorityReceipt' from owned_archive),(select subject from custody_ids))$$,
 '42501','export_source_unavailable','a foreign attempt cannot use the genuine subject source');
reset role;
savepoint revoked_session;
delete from auth.sessions where id='7b100000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.export_archive_account_members_v1('context',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive))$$,'42501',null,
 'a revoked actual account session stops whole-account reads');
reset role;rollback to revoked_session;
savepoint changed_report;
update public.report_artifacts set artifact='{"changed":true}' where id='7a300000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.export_archive_account_members_v1('context',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive))$$,'42501',null,
 'a changed real historical report invalidates the complete original job receipt');
reset role;rollback to changed_report;
savepoint unsupported_graph;
insert into public.subjects(owner_account_id,subject_class,upload_class,display_label)
 values('7b100000-0000-4000-8000-000000000001','other_adult','adult','Synthetic unsupported unbound adult');
set local role service_role;
select throws_ok($$select public.export_archive_request_v1('capture',(select origin from owned_archive),'account',
 '7b100000-0000-4000-8000-000000000001')$$,'0A000','export_partition_projection_unavailable',
 'a newly unsupported non-self partition refuses the whole account rather than returning the supported subset');
reset role;rollback to unsupported_graph;
select ok(not has_function_privilege(r,f,'execute'),r||' remains denied the closed owned archive helper '||f)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.future_person_bound_export_audit_v1(uuid)',
 'private.future_person_bound_export_snapshot_v1(jsonb,uuid)',
 'private.export_account_owned_capture_v1(jsonb,text,uuid)',
 'private.export_account_archive_attempt_v1(uuid,uuid,text)'])f;
select is(has_function_privilege(r,f,'execute'),r='service_role',r||' exact distinct account worker grant '||f)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)',
 'public.export_archive_account_bound_source_v1(text,uuid,uuid,text,uuid,jsonb)'])f;
select ok((select value=jsonb_build_object('parts',
 (select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p),'sources',
 (select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s)) from reader_original),
 'whole-account projection and refusals preserve every original parent/sibling source descriptor');
select ok(position('export_publication_not_integrated' in pg_get_functiondef('private.guard_segmented_export_publication_v1()'::regprocedure))>0,
 'actual source and historical members leave READY and public delivery closed');
select * from finish();rollback;
