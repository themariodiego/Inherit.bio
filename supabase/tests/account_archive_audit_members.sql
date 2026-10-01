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
-- The inherited approval/binding/relocation calls above produce the source
-- and its genuine assigned selector. These next calls append through the real
-- actor writer; resetting transaction-local proof marks separate HTTP commits
-- in this deliberately single-transaction SQL fixture.
select set_config('inherit.legal_audit_actor','',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7b100000-0000-4000-8000-000000000001"}',true);
select private.append_legal_audit_event('purpose.granted',null,'api.consents','accepted','{"purpose":"ancestry","revision":1}');
select private.append_legal_audit_event('family.sharing_paused',null,'api.family-sharing','accepted','{}');
select set_config('inherit.legal_audit_actor','',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7a000000-0000-0000-0000-000000000001"}',true);
select private.append_legal_audit_event('purpose.granted',null,'api.consents','accepted','{"purpose":"ancestry","revision":1}');
select set_config('inherit.legal_audit_actor','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select private.append_legal_audit_event('purpose.purge-complete',null,'api.jobs.retention','purged','{}');
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
create temporary table account_audit_result(context jsonb,events jsonb,ordinary jsonb);
grant select,update on account_audit_result to service_role;
insert into account_audit_result select
 public.export_archive_account_audit_v1('context',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt'),
 public.export_archive_account_audit_v1('events',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt'),
 public.export_archive_account_audit_v1('ordinary-subject',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
  '7b100000-0000-4000-8000-000000000003') from owned_archive;
reset role;
-- Independent exact selection from the underlying ledger; no fixture-created
-- archive authority or assigned-selector shortcut supplies the expected set.
select set_eq($$select (e->>'seq')::bigint from account_audit_result,jsonb_array_elements(events->'events') e$$,
 $$select l.seq from public.legal_audit_log l where l.audit_principal_id in
  (select audit_principal_id from private.legal_audit_account_principals where account_id='7b100000-0000-4000-8000-000000000001'
   union select audit_principal_id from private.future_person_account_bindings where subject_id=(select subject from custody_ids)
   union select audit_principal_id from private.future_person_custody_slices where subject_id=(select subject from custody_ids))$$,
 'the canonical account member contains every actual own actor and genuine custody/binding event exactly once');
select ok((select count(*)>=2 from public.legal_audit_log l join private.legal_audit_account_principals m
 on m.audit_principal_id=l.audit_principal_id where m.account_id='7b100000-0000-4000-8000-000000000001'),
 'the positive account ledger is genuinely nonempty independently of the retained binding event');
select is((select count(*) from account_audit_result,jsonb_array_elements(events->'events')e),
 (select count(distinct e->>'seq') from account_audit_result,jsonb_array_elements(events->'events')e),
 'actual global events appear once, without copying any event for an ordinary subject');
select is((select context->>'eventCount' from account_audit_result),
 (select jsonb_array_length(events->'events')::text from account_audit_result),'captured global event count equals the complete actual selected member');
select is((select ordinary from account_audit_result),jsonb_build_object('schema_version','legal-audit-v1',
 'attribution','unrecorded','attribution_started_at',null,
 'note','These audit records do not identify the subject of each action. Your recorded account actions are in legal-audit.json. This does not mean that nothing happened to this record.',
 'events','[]'::jsonb),'ordinary targeting is expressly unrecorded with a count-free historical uncertainty note');
select is((select count(*) from account_audit_result,jsonb_array_elements(events->'events') e join public.legal_audit_log l
 on l.seq=(e->>'seq')::bigint where l.audit_principal_id is null or l.audit_principal_id in(select audit_principal_id
 from private.legal_audit_account_principals where account_id='7a000000-0000-0000-0000-000000000001')),0::bigint,
 'foreign and service-caused canonical events never enter the requester archive');
select ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k)=
 array['coded_context','event_code','occurred_at','outcome_code','route_id','seq'])
 from account_audit_result,jsonb_array_elements(events->'events')e),
 'every actual event has exactly six closed fields, no actor pseudonym, subject inference or chain hash');
select throws_ok($$select private.export_ordinary_audit_unrecorded_v1((select subject from custody_ids),
 '7b100000-0000-4000-8000-000000000001')$$,'42501','export_audit_unavailable',
 'the genuine issued bound-custody selector can never receive ordinary unrecorded metadata');
set local role service_role;
select throws_ok($$select public.export_archive_account_audit_v1('ordinary-subject',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive),(select subject from custody_ids))$$,
 '42501','export_audit_unavailable','the actual worker refuses a claimed-bound subject at the ordinary audit door');
select is((select public.export_archive_account_members_v1('legal-audit',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
 (select subject from custody_ids))#>>'{rows,0,event,event_code}' from owned_archive),'claimant.account_bound',
 'the same genuine assigned subject retains its exact existing bound event producer');
select throws_ok($$select public.export_archive_account_audit_v1('events',(select (created->>'exportId')::uuid from owned_archive),
 gen_random_uuid(),(select capture->>'authorityReceipt' from owned_archive))$$,'42501','export_source_unavailable',
 'a foreign writing attempt cannot read the global actor slice');
select throws_ok($$select public.export_archive_account_audit_v1('ordinary-subject',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive),gen_random_uuid())$$,'42501','export_audit_unavailable',
 'a foreign or unproven ordinary mapping refuses the whole read');
reset role;
savepoint changed_actual_global;
select set_config('inherit.legal_audit_actor','',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7b100000-0000-4000-8000-000000000001"}',true);
select private.append_legal_audit_event('purpose.revoked',null,'api.consent-revoke','accepted','{"purpose":"ancestry"}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.export_archive_account_audit_v1('events',(select (created->>'exportId')::uuid from owned_archive),
 (select attempt from owned_archive),(select capture->>'authorityReceipt' from owned_archive))$$,'42501',null,
 'a real newly appended account event invalidates the old full graph receipt rather than understating history');
reset role;rollback to changed_actual_global;
select ok(not has_function_privilege(r,'private.export_ordinary_audit_unrecorded_v1(uuid,uuid)','execute'),
 r||' cannot enumerate ordinary audit selector absence') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select is(has_function_privilege(r,'public.export_archive_account_audit_v1(text,uuid,uuid,text,uuid,bigint)','execute'),r='service_role',
 r||' receives exactly the reviewed consumed-job audit worker grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select * from finish();rollback;
