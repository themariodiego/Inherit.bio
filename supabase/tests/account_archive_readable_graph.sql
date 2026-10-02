-- Authored strict rollback fixture; database/provider execution is not claimed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/account_export_saved_path_b.inc
select lives_ok('set constraints all immediate','the actual saved Path B completion commits every real deferred invariant before account capture');
set constraints all deferred;
-- Current ordinary relationship exists independently of source ownership.
insert into public.family_pairs(subject_a_id,subject_b_id)
 select p.id,u.id from public.subjects p cross join public.subjects u
 where p.subject_class='self' and p.subject_account_id=pg_temp.a('2')
 and u.subject_class='self' and u.subject_account_id=pg_temp.a('1');
create temporary table actual_readable_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_readable_job(origin,attempt) values(jsonb_build_object('kind','account','accountId',pg_temp.a('2'),'sessionId',pg_temp.s('2')),gen_random_uuid());
grant select,update on actual_readable_job to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_readable_job set capture=public.export_archive_request_v1('capture',origin,'account',pg_temp.a('2'));
update actual_readable_job set created=public.export_archive_request_v1('create',origin,'account',pg_temp.a('2'),
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export','origin','authenticated',
 'principalId',capture->>'principalId','targetKind','account','targetId',pg_temp.a('2'),'exportContract','account-export-v1',
 'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
 'operation','create','nonceHash',repeat('a',64),'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','the readable graph request flushes the genuine deferred independent-origin constraint');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_readable_job;
create function pg_temp.path_b_export(p_subject uuid) returns jsonb language sql as $$
 select public.export_archive_account_path_b_v1((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',p_subject) from actual_readable_job
$$;
create function pg_temp.routed_graph(p_kind text,p_after jsonb default null) returns jsonb language sql as $$
 select public.export_archive_account_graph_rows_v2((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',p_kind,p_after) from actual_readable_job
$$;
create temporary table actual_saved_export as select pg_temp.path_b_export(pg_temp.sid('main')) value;
create temporary table actual_routed_graph as select kind,pg_temp.routed_graph(kind) value from unnest(array[
 'embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
 'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'])kind;
create temporary table readable_context as select public.export_archive_account_members_v1('context',(created->>'exportId')::uuid,
 attempt,capture->>'authorityReceipt') value from actual_readable_job;
select is((select value#>>'{snapshot,rows}' from actual_saved_export),'1','the actual completed purpose produces exactly one saved result');
select is((select value#>>'{snapshot,excludedHeldUploads}' from actual_saved_export),'1','held original inventory is explicitly excluded without fabricated retirement');
select is((select value->>'authorityReceipt' from actual_saved_export),(select capture->>'authorityReceipt' from actual_readable_job),
 'saved outputs bind the exact current consumed account request');
select is((select value->>'fileCount' from readable_context),'0','held Path B original is not included in ordinary own-file descriptors');
select ok((select value->'partitions' @> jsonb_build_array(jsonb_build_object('subjectId',pg_temp.sid('main'),'class','ordinary','fileCount',0,'fileIds','[]'::jsonb)) from readable_context),
 'the actual own subject partition remains despite its distinct results-only source');
select is((select count(*)::integer from actual_routed_graph),7,'all seven versioned kinds are consumed, not a narrowed selector');
select is((select value#>>'{membership,rows}' from actual_routed_graph where kind='family_pairs'),'1','the actual pair is retained as safe metadata');
select set_eq($$select k from actual_saved_export,jsonb_object_keys(value)k$$,
 $$select k from(values('version'),('authorityReceipt'),('snapshot'))expected(k)$$,'the saved-result envelope has only its three closed fields');
select set_eq($$select k from actual_saved_export,jsonb_object_keys(value->'snapshot')k$$,
 $$select k from(values('subjectId'),('records'),('rows'),('sha256'),('excludedHeldUploads'))expected(k)$$,
 'the snapshot contains only the exact reviewed record/EOF/content receipt');
select set_eq($$select k from actual_saved_export,jsonb_object_keys((value#>>'{snapshot,records,0,rowText}')::jsonb)k$$,
 $$select k from(values('bindingRevision'),('fileId'),('subjectId'),('purpose'),('completedAt'),('source'),('reports'),('prs'))expected(k)$$,
 'every stored result carries its full source and catalogue with no grant/session/provider/counterparty fields');
select set_eq($$select k from actual_routed_graph,jsonb_object_keys((value#>>'{rows,0,rowText}')::jsonb)k where kind='family_pairs'$$,
 $$select k from(values('id'),('pair_revision'),('status'),('created_at'))expected(k)$$,'pair content excludes both counterpart subject identities');
select is((select value#>>'{rows,0,scope}' from actual_routed_graph where kind='family_pairs'),'requester-account-history',
 'a safe pair record is own account history, never a raw source or analytical permission');
reset role;
select is((select ((value#>>'{snapshot,records,0,rowText}')::jsonb)->'reports' from actual_saved_export),
 (select result->'reports' from private.path_b_report_bindings), 'actual complete saved catalogue/outcomes are preserved without recomputation or display filtering');
select is((select ((value#>>'{snapshot,records,0,rowText}')::jsonb)->'prs' from actual_saved_export),
 (select result->'prs' from private.path_b_report_bindings), 'actual stored PRS values are preserved, including genuine absence');
select is((select ((value#>>'{snapshot,records,0,rowText}')::jsonb)#>>'{source,decodedSha256}' from actual_saved_export),
 (select source_sha256 from public.genome_files where id=pg_temp.fxv('main','revision')::uuid),'the actual normalized source SHA binds the saved science');
create temporary table unchanged_readable_job as select jsonb_build_object('export',(select to_jsonb(e) from public.generated_exports e
 where e.id=(select(created->>'exportId')::uuid from actual_readable_job)), 'job',(select to_jsonb(j) from private.export_archive_jobs j
 where j.export_id=(select(created->>'exportId')::uuid from actual_readable_job)), 'attempt',(select to_jsonb(a) from private.export_archive_attempts a
 where a.id=(select attempt from actual_readable_job))) value;
set local role service_role;
select throws_ok($$select pg_temp.path_b_export(pg_temp.sid('unknown'))$$,'22023','invalid_request','an absent subject is refused before source reads');
select throws_ok($$select pg_temp.path_b_export((select id from public.subjects where subject_class='self' and subject_account_id=pg_temp.a('1')))$$,
 '42501','not_found','a foreign uploader subject cannot borrow the consumed own request');
select throws_ok($$select pg_temp.routed_graph('credential-keys')$$,'22023','invalid_request','no arbitrary table or internal credential class is accepted');
select throws_ok($$select pg_temp.routed_graph('family_pairs','[]')$$,'22023','invalid_request','an incomplete composite cursor is refused');
select throws_ok($$select public.export_archive_account_path_b_v1((created->>'exportId')::uuid,gen_random_uuid(),capture->>'authorityReceipt',pg_temp.sid('main')) from actual_readable_job$$,
 '42501','export_source_unavailable','a different durable attempt cannot borrow saved results');
reset role;
savepoint saved_result_revoked;
update public.purpose_grants set revoked_at=clock_timestamp() where grant_id=(select grant_id from private.path_b_report_bindings);
set local role service_role;
select throws_ok($$select pg_temp.path_b_export(pg_temp.sid('main'))$$,'42501','not_found','actual current purpose revocation refuses the complete result before returned bytes');
reset role;rollback to saved_result_revoked;
savepoint result_same_count_mutated;
-- Do not tamper with immutable result rows: change the current published catalogue through its ordinary producer seam.
update public.report_templates set summary='Changed current catalogue after capture' where slug='synthetic-path-b-variant';
set local role service_role;
select throws_ok($$select pg_temp.path_b_export(pg_temp.sid('main'))$$,'42501','not_found','same-count current catalogue change refuses the old consumed source');
reset role;rollback to result_same_count_mutated;
savepoint pair_source_changed;
update public.family_pairs set pair_revision=pair_revision+1 where subject_a_id in(select id from public.subjects where subject_class='self' and subject_account_id=pg_temp.a('2'));
set local role service_role;
select throws_ok($$select pg_temp.routed_graph('family_pairs')$$,'42501','not_found','same-count pair source changes refuse the whole old receipt');
reset role;rollback to pair_source_changed;
savepoint actual_readable_logout;
delete from auth.sessions where id=pg_temp.s('2');
set local role service_role;
select throws_ok($$select pg_temp.path_b_export(pg_temp.sid('main'))$$,'42501','not_found','actual own Auth logout refuses the stored science');
reset role;rollback to actual_readable_logout;
select is(jsonb_build_object('export',(select to_jsonb(e) from public.generated_exports e where e.id=(select(created->>'exportId')::uuid from actual_readable_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select(created->>'exportId')::uuid from actual_readable_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_readable_job))),
 (select value from unchanged_readable_job),'all refused probes preserve exact durable export/job/attempt bytes');
select is(has_function_privilege(role_name,signature,'execute'),role_name='service_role',role_name||' exact service-only consumed reader ACL')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name cross join unnest(array[
 'public.export_archive_account_graph_rows_v2(uuid,uuid,text,text,jsonb)','public.export_archive_account_path_b_v1(uuid,uuid,text,uuid)'])signature;
select ok(not has_function_privilege(role_name,signature,'execute'),role_name||' cannot bypass the internal full capture/projectors')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name cross join unnest(array[
 'private.export_account_graph_capture_v1(uuid,jsonb)','private.export_account_path_b_snapshot_v1(jsonb,uuid)','private.export_account_path_b_file_v1(uuid)',
 'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','private.export_account_owned_capture_pre_readable_graph_v1(jsonb,text,uuid)'])signature;
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.path_b_export(pg_temp.sid('main'))$$,'42501','not_found','an actual service role with the wrong JWT cannot return saved source');
select throws_ok($$select pg_temp.routed_graph('family_pairs')$$,'42501','not_found','an actual service role with the wrong JWT cannot return graph metadata');
reset role;
select lives_ok('set constraints all immediate','all original source, current grant, result and independent export invariants remain enforced');
select * from finish();rollback;
