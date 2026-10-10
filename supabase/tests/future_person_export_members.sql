begin;
select no_plan();
\ir fixtures/future_person_export_authority.inc
-- Recorded historical components are written before the authority capture,
-- then frozen by that exact capture. No current-catalog substitution occurs.
\ir fixtures/future_person_recorded_scientific_members.inc
select throws_ok($$select pg_temp.probe('update public.embryo_scores set source_binding_fingerprint=pg_temp.h(''foreign-historical-finding'')
 where id=''7a100000-0000-4000-8000-000000000001''','select public.future_person_export_request_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_source_unavailable','a historical finding with a different actual source refuses authority capture');
select throws_ok($$select pg_temp.probe('update public.report_artifacts set source_binding_fingerprint=pg_temp.h(''foreign-historical-report'')
 where id=''7a300000-0000-4000-8000-000000000001''','select public.future_person_export_request_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_source_unavailable','a historical report with a different actual source refuses authority capture');
create temporary table member_authority as select public.future_person_export_request_v1('capture',pg_temp.h('rights')) body;
create function pg_temp.claimant_export(p_nonce text) returns jsonb language sql as $$
 select public.future_person_export_request_v1('create',pg_temp.h('rights'),jsonb_build_object(
  'exportCookieHash',pg_temp.h('export-cookie'),'envelope',jsonb_build_object(
   'routeId','api.future-person-export','origin','independent-rights','principalId',body->>'principalId',
   'targetKind','subject','targetId',(select subject from custody_ids)::text,'exportContract','approved-future-person-export-v1',
   'originBinding',body->>'originBinding','authorityReceipt',body->>'authorityReceipt','csrfBinding',pg_temp.h('csrf'),
   'operation','create','nonceHash',pg_temp.h(p_nonce),'issuedAt',n,'expiresAt',n+300000)),pg_temp.h('csrf'))
 from member_authority cross join lateral (select floor(extract(epoch from clock_timestamp())*1000)::bigint n) clock;
$$;
create temporary table member_export as select pg_temp.claimant_export('create-export') body;
select is((select count(*) from public.generated_exports where id=(select (body->>'exportId')::uuid from member_export)
 and origin_kind='independent-rights' and account_id is null and target_id=(select subject from custody_ids)),1::bigint,
 'the actual claimant job has exactly one accountless subject origin without a fabricated account');
set constraints all immediate;
set constraints all deferred;
select throws_ok($$select pg_temp.claimant_export('duplicate-export')$$,'55000','export_already_pending',
 'a current exact subject export cannot be duplicated with a second operation nonce');
create temporary table member_attempt as select extensions.gen_random_uuid() id;
select lives_ok($$select public.export_archive_worker_v1('preflight',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'the existing durable worker preflight resolves the live claimant origin');
select lives_ok($$select public.export_archive_worker_v1('begin',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'the real worker starts exactly this registered claimant attempt');
create temporary table member_page as select public.future_person_export_members_v1('variants',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),
 (select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from member_page),2,'the leased worker reads every actual own canonical call');
select is((select array_agg(k order by k) from member_page,jsonb_object_keys(body->'rows'->0) k),
 array['alternateAllele','chromosome','genotype','id','position','referenceAllele'],'worker variants have exactly the registered own fields');
select lives_ok($$select public.future_person_export_members_v1('quality',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'own quality is read under the same genuine durable attempt');
create temporary table historical_figure_page as select public.future_person_export_members_v1('figures',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),(select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from historical_figure_page),4,'all four genuine historical figure rows are included before projection');
select is((select array_agg(k order by k collate "C") from historical_figure_page,jsonb_object_keys(body->'rows'->0) k),
 array['created_at','figure_kind','figure_revision','findingRecord','finding_id','id','payload'],'the figure envelope has exactly the recorded fields and bound finding');
select ok((select bool_and(row->>'finding_id'=row#>>'{findingRecord,id}' and row#>>'{findingRecord,model_id}'='retired-synthetic-model'
 and row#>>'{findingRecord,model_version}'='original' and row#>>'{findingRecord,computation_revision}'='2'
 and row#>>'{findingRecord,source_binding_fingerprint}'=(select source_sha256 from private.embryo_canonical_sources where file_id=(select file from custody_ids))
 and not(row->'findingRecord'?'embryo_id')) from historical_figure_page,jsonb_array_elements(body->'rows') row),
 'every figure binds the real historical own finding and preserves its original scientific version without a parent selector');
select is((select body->'rows'->0->'payload' from historical_figure_page),(select body->'finding' from recorded_finding),
 'the stored absolute-risk payload is returned exactly, never recreated from a current model');
create temporary table historical_report_page as select public.future_person_export_members_v1('reports',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),(select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from historical_report_page),1,'the actual stored subject report is included');
select is((select array_agg(k order by k) from historical_report_page,jsonb_object_keys(body->'rows'->0) k),
 array['artifact','created_at','embryoId','id','report_kind','report_revision','source_binding_fingerprint'],
 'the report envelope is closed to exact stored evidence and the authority-derived embryo binding');
select is((select (body#>>'{rows,0,embryoId}')::uuid from historical_report_page),(select embryo from custody_ids),
 'a caller cannot supply a different embryo for the historical report');
select is((select body#>'{rows,0,artifact}' from historical_report_page),(select body from recorded_finding),
 'all actual recorded report bytes precede the runtime closed DTO projection');
select throws_ok($$select pg_temp.probe('update public.embryo_figures set payload=jsonb_build_object(''changed'',true)
 where id=''7a200000-0000-4000-8000-000000000001''','select public.future_person_export_members_v1(''figures'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'a changed stored figure invalidates the originating receipt before another byte is returned');
select throws_ok($$select pg_temp.probe('update public.report_artifacts set artifact=jsonb_build_object(''changed'',true)
 where id=''7a300000-0000-4000-8000-000000000001''','select public.future_person_export_members_v1(''reports'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'a changed stored report invalidates the originating receipt before another byte is returned');
select throws_ok($$update public.embryo_variants set genotype='G/G' where source_file_id=(select file from custody_ids)$$,
 '55000','canonical_calls_immutable','published canonical calls cannot change while the archive is reading');
select throws_ok($$delete from public.embryo_variants where source_file_id=(select file from custody_ids)$$,
 '42501','embryo_source_unavailable','the claimed source cannot disappear between content passes');
select throws_ok($$select public.future_person_export_members_v1('variants',(select (body->>'exportId')::uuid from member_export),
 extensions.gen_random_uuid(),(select body->>'authorityReceipt' from member_authority))$$,'42501','not_found',
 'a receipt cannot replace the exact registered writing attempt');
select throws_ok($$select pg_temp.probe('update public.rights_sessions set status=''revoked'',ended_at=clock_timestamp()
 where session_hash=pg_temp.h(''rights'')','select public.future_person_export_members_v1(''context'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'revoked claimant authority stops the actual durable worker before another member is returned');
select ok(not has_function_privilege('authenticated','public.future_person_export_members_v1(text,uuid,uuid,text,text)','execute')
 and not has_function_privilege('anon','public.future_person_export_request_v1(text,text,jsonb,text)','execute'),
 'browser JWTs cannot invoke the service member/request doors directly');
select is((select call_immutability_proof from private.embryo_canonical_sources where file_id=(select file from custody_ids)),
 'exact-staged-calls-v1','the genuine new producer has exact immutable staged-copy proof');
select throws_ok($$select pg_temp.probe('alter table private.embryo_canonical_sources disable trigger user;
 update private.embryo_canonical_sources set call_immutability_proof=null where file_id=(select file from custody_ids);
 alter table private.embryo_canonical_sources enable trigger user',
 'select public.future_person_export_source_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_source_immutability_unproven','a legacy source remains fail-closed without an invented historical proof');
select is((select count(*) from public.purge_target_stores),173::bigint,'all existing stores retain exact purge and credential dispositions');
\ir fixtures/purge_store_census_173.inc
select ok(position('export_publication_not_integrated' in pg_get_functiondef('private.guard_segmented_export_publication_v1()'::regprocedure))>0,
 'the whole-account and incomplete claim archive READY hold remains exact');
select * from finish();
rollback;
