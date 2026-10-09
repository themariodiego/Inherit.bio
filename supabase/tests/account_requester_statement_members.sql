begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic ciphertext tests native custody/authorization, not cryptography.
-- The unit counterpart seals/opens genuine envelopes and proves literal EOF.
insert into auth.users(id,email) values
 ('83000000-0000-4000-8000-000000000001','requester-owner@e2e.local'),
 ('83000000-0000-4000-8000-000000000002','requester-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('83000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001',now(),now(),'aal1');
create temporary table requester_ids as select s.id subject,p.id principal from public.subjects s
 join public.subject_principals p on p.subject_id=s.id and p.account_id=s.subject_account_id and p.principal_kind='account_subject'
 where s.subject_account_id='83000000-0000-4000-8000-000000000001' and s.subject_class='self' and p.status='active';
select is((select count(*) from requester_ids),1::bigint,'one genuine account self principal is the author');
insert into public.correction_requests(id,subject_id,claimant_principal_id,correction_kind,correction_revision,statement_ciphertext)
 select '83000000-0000-4000-8000-000000000010',subject,principal,'record_metadata',1,decode(repeat('ab',48),'hex') from requester_ids;
insert into public.correction_working_data(correction_id,working_ciphertext,working_revision,expires_at)
 select id,decode(repeat('cd',48),'hex'),1,submitted_at+interval '30 days' from public.correction_requests
 where id='83000000-0000-4000-8000-000000000010';
insert into public.appeal_intakes(id,appellant_principal_id,appellant_account_id,target_kind,target_id,appeal_revision,statement_ciphertext)
 select '83000000-0000-4000-8000-000000000020',principal,'83000000-0000-4000-8000-000000000001',
 'access_decision','83000000-0000-4000-8000-000000000021',1,decode(repeat('ef',48),'hex') from requester_ids;
create function pg_temp.scope(kind text,id uuid) returns jsonb language sql as $$
 select jsonb_build_object('version',1,'caseKind',kind,'caseId',id,'originalAuthorPrincipalId',c->>'principalId',
 'initialStatementRevision',1,'originalSubmittedAt',c->'submittedAt','originalDeadline',c->'deadline')
 ||case when kind='correction' then jsonb_build_object('requestedField','display-label','originalSubjectId',c->'subjectId')
 else jsonb_build_object('intakeKind','access-or-review-appeal') end from(select private.account_requester_case_v1(kind,id)c)x
$$;
create function pg_temp.envelope(kind text,id uuid) returns jsonb language sql as $$
 select jsonb_build_object('format','reviewer-only-case-statement-v1','statementCiphertextHex',c->>'statementHex',
 'wrappedCaseKeyHex',repeat('de',72))||case when kind='correction' then jsonb_build_object('workingCiphertextHex',repeat('cd',48)) else '{}'::jsonb end
 from(select private.account_requester_case_v1(kind,id)c)x
$$;
select throws_ok($$select private.export_account_requester_rows_v1('83000000-0000-4000-8000-000000000001',
 array[(select subject from requester_ids)])$$,'0A000','export_requester_statement_format_unavailable',
 'opaque legacy statements refuse the whole owned class instead of guessing an encryption format');
select throws_ok($$select private.register_account_requester_statement_v1('correction','83000000-0000-4000-8000-000000000010',
 pg_temp.scope('correction','83000000-0000-4000-8000-000000000010')||jsonb_build_object('originalAuthorPrincipalId',gen_random_uuid()),
 pg_temp.envelope('correction','83000000-0000-4000-8000-000000000010'))$$,'42501','not_found','foreign author cannot be registered');
select throws_ok($$select private.register_account_requester_statement_v1('correction','83000000-0000-4000-8000-000000000010',
 pg_temp.scope('correction','83000000-0000-4000-8000-000000000010'),
 pg_temp.envelope('correction','83000000-0000-4000-8000-000000000010')||jsonb_build_object('statementCiphertextHex',repeat('aa',48)))$$,
 '42501','not_found','registration cannot substitute original statement bytes');
select throws_ok($$select private.register_account_requester_statement_v1('appeal','83000000-0000-4000-8000-000000000020',
 pg_temp.scope('appeal','83000000-0000-4000-8000-000000000020'),
 pg_temp.envelope('appeal','83000000-0000-4000-8000-000000000020')||jsonb_build_object('contactCiphertextHex',repeat('aa',48)))$$,
 '42501','not_found','an appeal contact or reviewer package is not an own-statement envelope');
select private.register_account_requester_statement_v1('correction','83000000-0000-4000-8000-000000000010',
 pg_temp.scope('correction','83000000-0000-4000-8000-000000000010'),pg_temp.envelope('correction','83000000-0000-4000-8000-000000000010'));
select private.register_account_requester_statement_v1('appeal','83000000-0000-4000-8000-000000000020',
 pg_temp.scope('appeal','83000000-0000-4000-8000-000000000020'),pg_temp.envelope('appeal','83000000-0000-4000-8000-000000000020'));
select throws_ok($$select private.register_account_requester_statement_v1('correction','83000000-0000-4000-8000-000000000010',
 pg_temp.scope('correction','83000000-0000-4000-8000-000000000010'),pg_temp.envelope('correction','83000000-0000-4000-8000-000000000010'))$$,
 '23505',null,'registered case identity/key is one-shot and cannot be rewritten');
-- A different author's request about the owned subject is not owned prose.
insert into public.correction_requests(id,subject_id,claimant_principal_id,correction_kind,correction_revision,statement_ciphertext)
 select '83000000-0000-4000-8000-000000000030',r.subject,p.id,'record_metadata',1,decode(repeat('aa',48),'hex')
 from requester_ids r join public.subject_principals p on p.account_id='83000000-0000-4000-8000-000000000002' and p.principal_kind='account_subject' and p.status='active';
-- A separate reviewer working row cannot leak into the exact original package.
insert into public.correction_working_data(correction_id,working_ciphertext,working_revision,expires_at)
 values('83000000-0000-4000-8000-000000000010',convert_to('Synthetic reviewer notes never exported','UTF8'),2,now()+interval '1 day');
select set_eq($$select id from private.export_account_requester_rows_v1('83000000-0000-4000-8000-000000000001',array[(select subject from requester_ids)])$$,
 $$values('83000000-0000-4000-8000-000000000010'::uuid),('83000000-0000-4000-8000-000000000020'::uuid)$$,
 'the complete own census includes correction and appeal, excluding another author even on the same owned subject');
select is((select count(*) from private.export_account_requester_rows_v1('83000000-0000-4000-8000-000000000002',array[(select subject from requester_ids)])),
 0::bigint,'another account cannot select the owned subject');
create temporary table requester_census as select private.export_account_own_statement_capture_v1('83000000-0000-4000-8000-000000000001',
 jsonb_build_object('authority',jsonb_build_object('subjectPartitions',jsonb_build_array((select subject from requester_ids)))))value;
select is((select value->>'corrections' from requester_census),'1','complete correction count');
select is((select value->>'appeals' from requester_census),'1','complete appeal count');
select is(private.export_account_own_statement_capture_v1('83000000-0000-4000-8000-000000000001',
 jsonb_build_object('authority',jsonb_build_object('subjectPartitions',jsonb_build_array((select subject from requester_ids))))),
 (select value from requester_census),'regeneration recomputes the unchanged complete membership, not a saved plaintext result');
create temporary table requester_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into requester_job(origin,attempt) values(jsonb_build_object('kind','account','accountId','83000000-0000-4000-8000-000000000001',
 'sessionId','83000000-0000-4000-8000-000000000003'),gen_random_uuid());
grant select,update on requester_job to service_role;grant select on requester_ids to service_role;
set local role service_role;select set_config('request.jwt.claims','{"role":"service_role"}',true);
update requester_job set capture=public.export_archive_request_v1('capture',origin,'account','83000000-0000-4000-8000-000000000001');
update requester_job set created=public.export_archive_request_v1('create',origin,'account','83000000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export','origin','authenticated',
 'principalId',capture->>'principalId','targetKind','account','targetId','83000000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('a',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from requester_job;
create function pg_temp.own_page(after_id text default null) returns jsonb language sql as $$
 select public.export_archive_account_members_v1('own-statements',(created->>'exportId')::uuid,attempt,
 capture->>'authorityReceipt',(select subject from requester_ids),after_id) from requester_job
$$;
create temporary table requester_page as select pg_temp.own_page()value;
select is((select value->>'count' from requester_page),'2','real consumed account pager returns the whole owned partition');
select set_eq($$select k from requester_page,jsonb_array_elements(value->'rows')r,jsonb_object_keys(r->'frame')k$$,
 $$values('scope'),('envelope'),('binding')$$,'each native frame contains only original scope, envelope and authority binding');
select ok((select not(value::text like '%Synthetic reviewer notes%' or value::text like '%contactCiphertext%') from requester_page),
 'no reviewer notes/contact package are returned');
select is(pg_temp.own_page((select value->>'nextAfterId' from requester_page))->'rows','[]'::jsonb,'exact keyset EOF is empty');
select throws_ok($$select public.export_archive_account_members_v1('own-statements',(select (created->>'exportId')::uuid from requester_job),
 gen_random_uuid(),(select capture->>'authorityReceipt' from requester_job),(select subject from requester_ids))$$,
 '42501','export_source_unavailable','a foreign attempt cannot borrow the owned requester pager');
reset role;
savepoint changed_statement;
update public.correction_requests set statement_ciphertext=decode(repeat('cc',48),'hex') where id='83000000-0000-4000-8000-000000000010';
select throws_ok($$select private.export_account_requester_rows_v1('83000000-0000-4000-8000-000000000001',array[(select subject from requester_ids)])$$,
 '42501','not_found','same-count original ciphertext change refuses the bound capsule');
rollback to changed_statement;
savepoint binding_ended;
update public.subject_account_bindings set status='revoked',ended_at=now() where subject_id=(select subject from requester_ids) and status='current';
select is((select count(*) from private.export_account_requester_rows_v1('83000000-0000-4000-8000-000000000001',array[(select subject from requester_ids)])),
 0::bigint,'revoked current binding does not return stale statements');
rollback to binding_ended;
savepoint case_closed;
update public.correction_requests set state='rejected',decided_at=now() where id='83000000-0000-4000-8000-000000000010';
select is((select count(*) from private.account_requester_statement_capsules where case_id='83000000-0000-4000-8000-000000000010'),
 0::bigint,'closing the actual case destroys its export key envelope');
rollback to case_closed;
savepoint case_deleted;
delete from public.appeal_intakes where id='83000000-0000-4000-8000-000000000020';
select is((select count(*) from private.account_requester_statement_capsules where case_id='83000000-0000-4000-8000-000000000020'),
 0::bigint,'source case deletion leaves no orphaned statement key');
rollback to case_deleted;
select is((select store_name from public.purge_target_stores where store_name='private.account_requester_statement_capsules'),
 'private.account_requester_statement_capsules','new encrypted store is declared in physical purge registry');
select ok(not has_function_privilege(r,'private.register_account_requester_statement_v1(text,uuid,jsonb,jsonb)','execute'),
 r||' cannot invent a NEW envelope for opaque legacy data') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select ok(not has_table_privilege(r,'private.account_requester_statement_capsules','select'),r||' cannot read case keys directly')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select is(has_function_privilege(r,'public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)','execute'),r='service_role',
 r||' exact service pager grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select lives_ok('set constraints all immediate','every original deferred invariant remains checked');
select * from finish();rollback;
