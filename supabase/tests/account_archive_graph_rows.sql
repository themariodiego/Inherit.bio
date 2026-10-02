begin;
select no_plan();
-- Preserve the original genuine documentary/MFA/current own binding and real
-- relocation protocols. Provider object metadata is synthetic, never credit.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
\ir fixtures/future_person_recorded_scientific_members.inc
create temporary table actual_graph_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_graph_job(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),gen_random_uuid());
grant select,update on actual_graph_job to service_role;
grant select on custody_ids,claimant_account_self to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_graph_job set capture=public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001');
update actual_graph_job set created=public.export_archive_request_v1('create',origin,'account','7b100000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','7b100000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('a',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','the actual graph request flushes every deferred creation invariant before its worker');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_graph_job;

create function pg_temp.graph(kind text,after_key jsonb default null) returns jsonb language sql as $$
 select public.export_archive_account_graph_rows_v1((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,after_key) from actual_graph_job
$$;
create temporary table graph_pages as select kind,pg_temp.graph(kind) value from unnest(array[
 'embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
 'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'])kind;
select extensions.is((select count(*)::integer from graph_pages),7,'all seven fixed kinds use the actual consumed current own-account request');
select extensions.ok((select bool_and(value->>'authorityReceipt'=capture->>'authorityReceipt'
 and value->>'version'='account-graph-page-v1' and value->>'kind'=kind and value->'rows'='[]'::jsonb
 and value->'nextAfterKey'='null'::jsonb and value#>>'{membership,rows}'='0'
 and value#>>'{membership,sha256}'=encode(extensions.digest(convert_to('account-graph-source-v1|'||kind,'UTF8'),'sha256'),'hex'))
 from graph_pages cross join actual_graph_job),'exact own/claimed-bound source contains no owned parent/joint graph metadata; empty source has its true hash');
select extensions.set_eq($$select distinct k from graph_pages,jsonb_object_keys(value)k$$,
 $$select k from(values('version'),('kind'),('authorityReceipt'),('membership'),('rows'),('nextAfterKey'))x(k)$$,
 'every actual graph page has exactly the six registered metadata fields');
select extensions.throws_ok($$select pg_temp.graph('family_pairs','["8b900000-0000-4000-8000-000000000099"]')$$,
 '22023','invalid_request','an absent cursor cannot narrow a true empty complete source');
select extensions.throws_ok($$select pg_temp.graph('ancestry_regions')$$,'22023','invalid_request','no scientific result/unknown class is a metadata selector');
select extensions.throws_ok($$select pg_temp.graph('embryo_participant_sets','["8b900000-0000-4000-8000-000000000099","disposition_authorities","8b900000-0000-4000-8000-000000000098",1.5]')$$,
 '22023','invalid_request','noninteger composite revision is refused before current source lookup');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select extensions.throws_ok($$select pg_temp.graph('family_pairs')$$,'42501','not_found','actual service role with wrong JWT cannot invoke the graph reader');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select extensions.throws_ok($$select public.export_archive_account_graph_rows_v1('8b900000-0000-4000-8000-000000000097',
 '8b900000-0000-4000-8000-000000000096',repeat('a',64),'family_pairs',null)$$,'42501','not_found','foreign durable request/attempt cannot supply source scope');
reset role;
-- These source-only owner projections are not an API authority or a successful
-- whole-account export. The actual produced cohort/basis/participant records
-- provide nonvacuous private projection positives under the original FK graph.
select extensions.cmp_ok((select count(*) from private.export_account_graph_projection_v1(
 (select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),array[(select subject from custody_ids)],'embryo_cohorts')),'>',0::bigint,
 'real intake-produced parent cohort projection is nonempty without claiming export authority');
select extensions.cmp_ok((select count(*) from private.export_account_graph_projection_v1(
 (select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),array[(select subject from custody_ids)],'embryo_basis_bindings')),'>',0::bigint,
 'real intake-produced basis projection is nonempty without a manufactured basis');
select extensions.cmp_ok((select count(*) from private.export_account_graph_projection_v1(
 (select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),array[(select subject from custody_ids)],'embryo_participant_sets')),'>',0::bigint,
 'real intake-produced participant identities remain nonempty without an authority shortcut');
select extensions.ok((select bool_and(projected_row->'owner_is_requester'='true'::jsonb
 and not(projected_row ?| array['owner_account_id','draft_id','principal_id','signature_id']))
 from private.export_account_graph_projection_v1((select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),
 array[(select subject from custody_ids)],'embryo_cohorts')),'actual cohort projection has requester equality and zero private identity columns');
select extensions.ok((select bool_and(jsonb_array_length(projected_key)=4 and projected_key->>0=projected_row->>'cohort_id'
 and projected_key->>1=projected_row->>'set_kind' and projected_key->>3=projected_row->>'membership_revision'
 and not(projected_row ? 'principal_id')) from private.export_account_graph_projection_v1(
 (select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),
 array[(select subject from custody_ids)],'embryo_participant_sets')),
 'actual persisted memberships retain every PK column internally and redact the counterparty identity from archive rows');
select extensions.is(private.export_account_graph_cursor_v1('embryo_participant_sets',
 '["8b900000-0000-4000-8000-000000000099","disposition_authorities","8b900000-0000-4000-8000-000000000098",10]'),
 '["8b900000-0000-4000-8000-000000000099","disposition_authorities","8b900000-0000-4000-8000-000000000098",10]',
 'actual composite key retains every real component and canonical numeric revision');
select extensions.is(private.export_account_graph_cursor_v1('embryo_disposition_confirmations',
 '["8b900000-0000-4000-8000-000000000099","8b900000-0000-4000-8000-000000000098"]'),
 '["8b900000-0000-4000-8000-000000000099","8b900000-0000-4000-8000-000000000098"]','confirmation key retains both real columns');
select extensions.throws_ok($$select private.export_account_graph_cursor_v1('embryo_participant_sets',
 '["8b900000-0000-4000-8000-000000000099","disposition_authorities","8b900000-0000-4000-8000-000000000098"]')$$,
 '22023','invalid_request','missing composite key column is not an invented UUID identity');
select extensions.throws_ok($$select private.export_account_graph_cursor_v1('family_pairs','["8b900000-0000-4000-8000-000000000099",1]')$$,
 '22023','invalid_request','single-key class cannot carry extra cursor selectors');
select extensions.throws_ok($$set local role anon;
select public.export_archive_account_graph_rows_v1('8b900000-0000-4000-8000-000000000097',
 '8b900000-0000-4000-8000-000000000096',repeat('a',64),'family_pairs',null)$$,
 '42501','permission denied for function export_archive_account_graph_rows_v1','actual anon role cannot cross the service-only graph door');
select extensions.is(current_user::text,session_user::text,'caught anon refusal restores the actual test owner');
select extensions.throws_ok($$set local role authenticated;
select public.export_archive_account_graph_rows_v1('8b900000-0000-4000-8000-000000000097',
 '8b900000-0000-4000-8000-000000000096',repeat('a',64),'family_pairs',null)$$,
 '42501','permission denied for function export_archive_account_graph_rows_v1','actual authenticated role cannot cross the service-only graph door');
select extensions.is(current_user::text,session_user::text,'caught authenticated refusal restores the actual test owner');
select extensions.throws_ok($$set local role inherit_upload_only;
select public.export_archive_account_graph_rows_v1('8b900000-0000-4000-8000-000000000097',
 '8b900000-0000-4000-8000-000000000096',repeat('a',64),'family_pairs',null)$$,
 '42501','permission denied for function export_archive_account_graph_rows_v1','actual inherit_upload_only role cannot cross the service-only graph door');
select extensions.is(current_user::text,session_user::text,'caught inherit_upload_only refusal restores the actual test owner');
select extensions.is(has_function_privilege(r,'public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)','execute'),r='service_role',
 r||' exact distinct consumed graph-row grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select extensions.ok(not has_function_privilege(r,f,'execute'),r||' cannot invoke an internal source/cursor projector')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.export_account_graph_cursor_v1(text,jsonb)','private.export_account_graph_projection_v1(uuid,uuid[],text)'])f;
select extensions.throws_ok($$select private.export_account_owned_capture_v1(jsonb_build_object('kind','account',
 'accountId',(select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)),
 'sessionId','7a000000-0000-4000-8000-0000000000a1'),'account',
 (select owner_account_id from public.embryo_cohorts where id=(select cohort_id from live)))$$,
 '0A000','export_partition_projection_unavailable','the original014 nonempty parent graph remains a whole refusal despite private metadata projection');
select extensions.lives_ok('set constraints all immediate','all original and new final deferred invariants are enforced');
select * from finish();rollback;
