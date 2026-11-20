begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- api.subject-export (20261016196000_subject_export.sql), owner decision of
-- 16 October 2026: the one-record export on the account producer, refused
-- with a stated reason while the record has live joint results. Every
-- request, job, attempt, reservation and READY here is produced by the
-- current doors; owner-only rows are synthetic fixtures named as such and
-- roll back. No provider is called: the TEST R2 rows are the existing
-- synthetic owner callback metadata the account suite already uses.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/account_archive_ordinary_scientific.inc
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
-- A genuine catalog version for the ordinary original (synthetic metadata).
update storage.objects set version='77900000-0000-4000-8000-000000000021' where id='77900000-0000-4000-8000-000000000020';
-- An account-level legacy consent: never one record's (subject-export-v1
-- alwaysExcluded: unrelated-account-legacy-consents).
insert into public.consent_grants(user_id,provider_key,data_classes)
 values('77900000-0000-4000-8000-000000000001','legacy-fixture',array['raw']);
-- A second real account, the other contributor in the joint-result probes.
insert into auth.users(id,email) values('7a520000-0000-4000-8000-000000000001','subject-export-other@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a520000-0000-4000-8000-000000000010','7a520000-0000-4000-8000-000000000001',now(),now(),'aal1');

create temporary table sx(label text primary key,origin jsonb,target_kind text,subject uuid,capture jsonb,created jsonb,attempt uuid,context jsonb);
insert into sx(label,origin,target_kind,subject,attempt) values
 ('subject',jsonb_build_object('kind','account','accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),
  'subject',(select id from normalization_subject),'7a510000-0000-4000-8000-000000000001'),
 ('account',jsonb_build_object('kind','account','accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),
  'account','77900000-0000-4000-8000-000000000001','7a510000-0000-4000-8000-000000000002');
create temporary table other_ids as select id subject from public.subjects
 where subject_account_id='7a520000-0000-4000-8000-000000000001' and subject_class='self';
grant select,update on sx to service_role;grant select on normalization_subject,export_snapshot,other_ids,custody_ids to service_role;

create function pg_temp.envelope(which text,op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId',case when target_kind='account' then 'api.export' else 'api.subject-export' end,
  'origin','authenticated','principalId',capture->>'principalId','targetKind',target_kind,'targetId',subject,
  'exportContract',case when target_kind='account' then 'account-export-v1' else 'subject-export-v1' end,
  'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
  'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)
  ||case when op='open-ready' then jsonb_build_object('exportId',created->>'exportId','exportRevision',(created->>'exportRevision')::bigint)
   else '{}'::jsonb end from sx where label=which;
$$;
create function pg_temp.request(which text,op text,payload jsonb default null,csrf text default null) returns jsonb language sql as $$
 select case when target_kind='subject' then public.subject_export_request_v1(op,origin,subject,payload,csrf)
  else public.export_archive_request_v1(op,origin,'account',subject,payload,csrf) end from sx where label=which;
$$;
create function pg_temp.members(which text,op text,p_subject uuid default null,p_after text default null) returns jsonb language sql as $$
 select public.export_archive_account_members_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',p_subject,p_after)
 from sx where label=which;
$$;
create function pg_temp.inventory(which text,op text,kind text default null,after uuid default null) returns jsonb language sql as $$
 select public.export_archive_account_inventory_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,after)
 from sx where label=which;
$$;
create function pg_temp.classes(which text,op text,kind text default null) returns jsonb language sql as $$
 select public.export_archive_account_classes_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,null)
 from sx where label=which;
$$;
create function pg_temp.metadata(which text,op text) returns jsonb language sql as $$
 select public.export_archive_account_metadata_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',null)
 from sx where label=which;
$$;
create function pg_temp.graph(which text,kind text) returns jsonb language sql as $$
 select public.export_archive_account_graph_rows_v2((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,null)
 from sx where label=which;
$$;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- 1. Scope: the caller's own ordinary record, and nothing else.
update sx set capture=pg_temp.request(label,'capture');
select is((select capture->'subjectPartitions' from sx where label='subject'),
 jsonb_build_array((select id from normalization_subject)),'the one-record capture holds exactly the route subject');
select is((select capture->>'fileCount' from sx where label='subject'),'1','the one-record capture counts its one ordinary file');
select is((select array_agg(k order by k) from sx,jsonb_object_keys(capture)k where label='subject'),
 array['accountRevision','authorityReceipt','fileCount','lifecycleRevision','originBinding','principalGraphRevision',
  'principalHash','principalId','subjectPartitions'],'the one-record capture keeps the closed nine-field receipt');
select is((select (capture->>'lifecycleRevision')::bigint from sx where label='subject'),
 (select lifecycle_revision from public.subjects where id=(select id from normalization_subject)),
 'the one-record receipt carries the record''s own lifecycle revision');
select is((select public.export_archive_request_v1('capture',origin,'subject',subject) from sx where label='subject'),
 (select capture from sx where label='subject'),'the route door hands the self-or-adult case to the unchanged request door');
select is((select pg_temp.request('subject','capture')),(select capture from sx where label='subject'),'a repeated capture is stable');
select isnt((select capture->>'authorityReceipt' from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='account'),
 'the one-record authority is its own, not the whole account''s');
select throws_ok($$select public.subject_export_request_v1('capture',(select origin from sx where label='subject'),(select subject from other_ids))$$,
 '42501','not_found','another person''s record is not found');
select throws_ok($$select public.subject_export_request_v1('capture',(select origin from sx where label='subject'),'7a5f0000-0000-4000-8000-000000000001')$$,
 '42501','not_found','an unknown record is not found');
select throws_ok($$select public.subject_export_request_v1('capture',(select origin from sx where label='subject'),null)$$,
 '42501','not_found','a missing record is not found');
select throws_ok($$select public.subject_export_request_v1('capture','{"kind":"independent-rights","sessionHash":"x"}',(select subject from sx where label='subject'))$$,
 '42501','not_found','a rights-session origin never reaches the route door');
select throws_ok($$select public.subject_export_request_v1('capture',
 jsonb_build_object('kind','account','accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),
 (select subject from custody_ids))$$,'42501','not_found','a claimed embryo is resource-not-found-v1 at the route door');
select ok((select public.export_archive_request_v1('capture',
 jsonb_build_object('kind','account','accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),
 'subject',(select subject from custody_ids))->'subjectPartitions'=jsonb_build_array((select subject from custody_ids))),
 'the claimed-bound subject capture itself is unchanged');
select is((select public.subject_export_request_v1('capture',
 jsonb_build_object('kind','account','accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),
 s.id)->'subjectPartitions' from public.subjects s where s.subject_account_id='7b100000-0000-4000-8000-000000000001' and s.subject_class='self'),
 (select jsonb_build_array(s.id) from public.subjects s where s.subject_account_id='7b100000-0000-4000-8000-000000000001' and s.subject_class='self'),
 'the self record of an account that also holds a claimed record exports alone');

-- 2. Create: the request door records the registered route and contract.
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',repeat(case when label='subject' then 'a' else 'b' end,64)),
 'exportCookieHash',repeat(case when label='subject' then '9' else '8' end,64)),repeat('c',64));
select lives_ok('set constraints all immediate','both genuine requests flush every deferred creation invariant');
set constraints all deferred;
reset role;
select ok((select e.target_kind='subject' and e.target_id=(select id from normalization_subject) and e.export_kind='subject_raw'
 and e.subject_partitions=jsonb_build_array((select id from normalization_subject)) and j.route_id='api.subject-export'
 and j.export_contract='subject-export-v1' and j.authority_receipt=(select capture->>'authorityReceipt' from sx where label='subject')
 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
 where e.id=(select (created->>'exportId')::uuid from sx where label='subject')),'the queued job carries the subject route, contract and partition');
set local role service_role;
select throws_ok($$select pg_temp.request('subject','create',jsonb_build_object('envelope',pg_temp.envelope('subject','create',repeat('d',64)),
 'exportCookieHash',repeat('7',64)),repeat('c',64))$$,'55000','export_already_pending','one live export per record');
select is((select jsonb_agg(v->>'exportId') from jsonb_array_elements(public.export_archive_subject_due_v1())v),
 (select jsonb_build_array(created->>'exportId') from sx where label='subject'),'the subject due reader lists exactly the queued subject job');
select is((select array_agg(k order by k) from jsonb_array_elements(public.export_archive_subject_due_v1())v,jsonb_object_keys(v)k),
 array['authorityReceipt','deadline','exportId','principalHash'],'each subject descriptor has the four closed due fields');
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_account_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from sx where label='subject')),'the account due reader still never lists a subject job');
select ok(not exists(select 1 from jsonb_array_elements(public.export_archive_subject_due_v1())v
 where v->>'exportId'=(select created->>'exportId' from sx where label='account')),'the subject due reader never lists the account job');
select is((select public.export_archive_request_v1('check',origin,'subject',subject,jsonb_build_object('exportId',created->>'exportId',
 'exportCookieHash',repeat('9',64))) from sx where label='subject')->>'status','queued','the subject cookie hash polls its own job');
select throws_ok($$select pg_temp.request('subject','check',jsonb_build_object('exportId',(select created->>'exportId' from sx where label='account'),
 'exportCookieHash',repeat('8',64)))$$,'42501','not_found','the account job cannot be polled through the record route');

-- 3. Doors: every account-producer read accepts the one ordinary subject job.
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from sx$$,
 'the durable worker begins both attempts');
update sx set context=pg_temp.members(label,'context');
select ok((select context->>'targetKind'='subject' and context->>'targetId'=subject::text and context->>'fileCount'='1'
 and context->'partitions'=jsonb_build_array(jsonb_build_object('subjectId',subject,'class','ordinary','fileCount',1,
  'fileIds',jsonb_build_array('77900000-0000-4000-8000-000000000040'))) from sx where label='subject'),
 'the worker context is the one ordinary partition with its file');
select is((select jsonb_agg(x#>>'{file,id}') from jsonb_array_elements(pg_temp.members('subject','ordinary-files'))x),
 '["77900000-0000-4000-8000-000000000040"]'::jsonb,'the ordinary file reader returns the record''s file');
select is(pg_temp.metadata('subject','context')->'rows'->0->'fileCount','1'::jsonb,'metadata counts the record''s file');
select is(jsonb_array_length(pg_temp.metadata('subject','profile')->'rows'),1,'the requester''s own profile row is read once');
select is(pg_temp.metadata('subject','purpose-grants')->'rows',pg_temp.metadata('account','purpose-grants')->'rows',
 'a one-self account''s grants on its record are the same rows');
select is((select (x->>'rows')::bigint from jsonb_array_elements(pg_temp.inventory('subject','context')->'classes')x where x->>'kind'='legacy-consents'),
 0::bigint,'the account-level legacy consent is not the record''s');
select is((select (x->>'rows')::bigint from jsonb_array_elements(pg_temp.inventory('account','context')->'classes')x where x->>'kind'='legacy-consents'),
 1::bigint,'the whole-account export still carries it');
select is(pg_temp.inventory('subject','history','legacy-consents')->'rows','[]'::jsonb,'no legacy consent row is paged for the record');
select is(pg_temp.inventory('subject','history','recipient-grants')->'rows','[]'::jsonb,'no account recipient grant is paged for the record');
select ok((select bool_and((r->>'rowText')::jsonb->>'subject_id'=(select subject::text from sx where label='subject'))
 and count(*)>0 from jsonb_array_elements(pg_temp.inventory('subject','history','principals')->'rows')r),
 'every principal row names the record');
select ok((select bool_and((r->>'rowText')::jsonb->>'target_kind'='subject' and (r->>'rowText')::jsonb->>'target_id'=(select subject::text from sx where label='subject'))
 from jsonb_array_elements(pg_temp.inventory('subject','history','signatures')->'rows')r),'every signature row targets the record');
select is(jsonb_array_length(pg_temp.inventory('subject','context')->'classes'),9,'all nine history kinds are inventoried');
select is(jsonb_array_length(pg_temp.classes('subject','context')->'classes'),29,'all 29 class kinds are inventoried');
select ok((select bool_and(x->'partitions'<@jsonb_build_array(jsonb_build_object('subjectId',(select subject from sx where label='subject'),'rows',x->'rows'))
 or x->'partitions'='[]'::jsonb) from jsonb_array_elements(pg_temp.classes('subject','context')->'classes')x),
 'every class count is the record''s own');
select is(pg_temp.classes('subject','context')->'boundSnapshots','[]'::jsonb,'no claimed-bound snapshot is part of an ordinary record');
select ok(pg_temp.classes('subject','context') ? 'ownStatements','the record''s own statements are captured');
select is(jsonb_array_length(public.export_archive_account_content_v1('variants',(select (created->>'exportId')::uuid from sx where label='subject'),
 (select attempt from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='subject'),
 jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040','snapshot',(select value from export_snapshot),'offset',0))),1,
 'the content door reads the record''s variants');
select ok((select x->'source' is not null and x->>'fileId'='77900000-0000-4000-8000-000000000040' from (select
 public.export_archive_account_original_v1('descriptor',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',
  '77900000-0000-4000-8000-000000000040') x from sx where label='subject')y),'the original door describes the record''s original');
select ok((select bool_and((pg_temp.graph('subject',k)->'membership'->>'rows')='0' and pg_temp.graph('subject',k)->'rows'='[]'::jsonb)
 from unnest(array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs'])k),'a record with no pair has no graph row');
select is(public.export_archive_account_path_b_v1((select (created->>'exportId')::uuid from sx where label='subject'),
 (select attempt from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='subject'),
 (select subject from sx where label='subject'))#>'{snapshot,rows}','0'::jsonb,'a record with no Path B result has an empty result snapshot');
select is(pg_temp.members('subject','own-statements',(select subject from sx where label='subject'))->'rows','[]'::jsonb,
 'the record''s own statements page is read');
select throws_ok($$select public.export_archive_account_audit_v1('context',(select (created->>'exportId')::uuid from sx where label='subject'),
 (select attempt from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='subject'))$$,
 '42501','not_found','the audit door stays account only: a record export leaves the log out');
select throws_ok($$select public.export_archive_account_complete_v1('context',(select (created->>'exportId')::uuid from sx where label='subject'),
 (select attempt from sx where label='subject'),(select capture->>'authorityReceipt' from sx where label='subject'))$$,
 '42501','not_found','the complete-capture door stays account only');
select is(pg_temp.members('account','context')->>'targetKind','account','the account job''s context is unchanged');
reset role;
select lives_ok($$select private.account_archive_r2_write_context_v1((select attempt from sx where label='subject'),
 (select capture->>'authorityReceipt' from sx where label='subject'))$$,'the TEST R2 write context admits the writing subject attempt');
select ok((select bool_and(private.account_archive_job_scope_v1(j,e)) and count(*)=2 from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
 where j.export_id in(select (created->>'exportId')::uuid from sx)),
 'the closed TEST job predicate admits the account and the subject job');
savepoint wrong_contract;
update private.export_archive_jobs set export_contract='approved-future-person-export-v1' where export_id=(select (created->>'exportId')::uuid from sx where label='subject');
select ok((select not private.account_archive_job_scope_v1(j,e) from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
 where j.export_id=(select (created->>'exportId')::uuid from sx where label='subject')),'another contract on a subject job is not admitted');
rollback to wrong_contract;
-- The export identity is immutable, so the claimed target is a composite
-- probe of the predicate only.
select ok((select not private.account_archive_job_scope_v1(j,jsonb_populate_record(null::public.generated_exports,
 to_jsonb(e)||jsonb_build_object('target_id',(select subject from custody_ids))))
 from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
 where j.export_id=(select (created->>'exportId')::uuid from sx where label='subject')),'a subject job on a claimed embryo is not admitted');
select ok((select not private.account_archive_job_scope_v1(j,jsonb_populate_record(null::public.generated_exports,
 to_jsonb(e)||jsonb_build_object('target_id',(select subject from other_ids))))
 from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
 where j.export_id=(select (created->>'exportId')::uuid from sx where label='subject')),'a subject job on another person''s record is not admitted');

-- 4. The stated refusal: the joint results nothing projects yet, now and
-- after the request. Since 20261023100000_subject_export_joint_results.sql
-- a family pair and a Portrait result no longer refuse the record: the pair
-- is its history and a Portrait result is projected only while the other
-- parent's permission is live (supabase/tests/subject_export_joint_results.sql).
-- Since 20261023110000_export_completeness.sql a family group conversation is
-- projected and a cohort role no longer refuses; a canonical conversation
-- anchored on the record's pair still refuses, as here.
create function pg_temp.family_conversation(p_pair uuid) returns void language sql as $$
 insert into public.chats(id,user_id,scope_kind,family_pair_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,legacy_unverified)
 values('7a5c0000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000001','family',p_pair,1,'local',1,1,repeat('d',64),false);
 insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
  provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified)
 values('7a5c0000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000001','user','{"text":"synthetic"}',
  '7a5c0000-0000-4000-8000-000000000002',1,'user',1,repeat('d',64),'local',1,1,false);
$$;
savepoint live_conversation;
-- Synthetic owner-only rows: a pair and one family conversation turn on it.
insert into public.family_pairs(id,subject_a_id,subject_b_id,status) values('7a5e0000-0000-4000-8000-000000000002',(select id from normalization_subject),(select subject from other_ids),'pending');
select pg_temp.family_conversation('7a5e0000-0000-4000-8000-000000000002');
set local role service_role;
select throws_ok($$select pg_temp.request('subject','capture')$$,'0A000','export_joint_results_pending',
 'a record with a family conversation on its pair is refused with the stated reason');
select throws_ok($$select pg_temp.members('subject','context')$$,'0A000','export_joint_results_pending',
 'a conversation that appears after the request fails the job at its next read');
select throws_ok($$select public.export_archive_request_v1('capture',origin,'subject',subject) from sx where label='subject'$$,
 '0A000','export_joint_results_pending','the request door gives the same refusal');
reset role;
rollback to live_conversation;
savepoint live_pair;
insert into public.family_pairs(subject_a_id,subject_b_id,status) values((select id from normalization_subject),(select subject from other_ids),'pending');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,
 'a record with a live family pair is captured: the pair is its history, not a joint result');
select throws_ok($$select pg_temp.members('subject','context')$$,'42501','not_found',
 'a pair that appears after the request still fails the job at its next read, through the receipt');
select is((select public.export_archive_request_v1('capture',origin,'subject',subject) from sx where label='subject'),
 pg_temp.request('subject','capture'),'the request door gives the same capture');
reset role;
rollback to live_pair;
savepoint revoked_pair;
insert into public.family_pairs(subject_a_id,subject_b_id,status) values((select subject from other_ids),(select id from normalization_subject),'revoked');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'a revoked pair that is not purged no longer refuses the record');
reset role;
rollback to revoked_pair;
savepoint portrait;
insert into public.family_pairs(id,subject_a_id,subject_b_id,status) values('7a5e0000-0000-4000-8000-000000000001',(select id from normalization_subject),(select subject from other_ids),'purged');
insert into public.portrait_results(owner_account_id,parent_a_subject_id,parent_b_subject_id,family_pair_id,kind,trait_key,result,coverage,method_version,
 source_binding_fingerprint,computation_revision) values('7a520000-0000-4000-8000-000000000001',(select subject from other_ids),(select id from normalization_subject),
 '7a5e0000-0000-4000-8000-000000000001','carrier_pair','fixture','{}',1,'fixture',repeat('f',64),1);
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'a Portrait result naming the record as a parent no longer refuses it');
reset role;
select is((select x->>'rows' from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'subject',subject)->'classInventory')x
 where label='subject' and x->>'kind'='portrait_results'),'0','with its pair purged the result is not live, so it is left out');
rollback to portrait;
savepoint purged_pair;
insert into public.family_pairs(subject_a_id,subject_b_id,status) values((select id from normalization_subject),(select subject from other_ids),'purged');
set local role service_role;
select lives_ok($$select pg_temp.request('subject','capture')$$,'a purged pair is history, not a live joint result');
select throws_ok($$select pg_temp.members('subject','context')$$,'42501','not_found',
 'the purged pair changes the record''s graph, so the earlier job no longer matches its receipt');
reset role;
select is((select x->'partitions' from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'subject',subject)->'classInventory')x
 where label='subject' and x->>'kind'='family_pairs'),jsonb_build_array(jsonb_build_object('subjectId',(select id from normalization_subject),'rows',1)),
 'the purged pair''s history row is routed to the record');
select is((select (x->>'rows')::bigint from sx,jsonb_array_elements(private.export_account_owned_capture_v1(origin,'subject',subject)#>'{readableGraph,inventory}')x
 where label='subject' and x->>'kind'='embryo_cohorts'),0::bigint,'a record whose account has no cohort has no cohort row');
rollback to purged_pair;
select ok(not private.export_subject_joint_results_v1((select id from normalization_subject)),'the fixture record has no joint result');
select ok(not private.export_subject_cohort_role_v1((select id from normalization_subject)),'the fixture record has no cohort role');

-- 5. Privileges: one service door each; every helper is owner-only.
select ok(has_function_privilege('service_role','public.subject_export_request_v1(text,jsonb,uuid,jsonb,text)','execute')
 and has_function_privilege('service_role','public.export_archive_subject_due_v1(uuid)','execute'),'the service role holds the two new doors');
select ok(not has_function_privilege(r,p,'execute'),r||' cannot execute '||p) from unnest(array['anon','authenticated','inherit_upload_only'])r,
 unnest(array['public.subject_export_request_v1(text,jsonb,uuid,jsonb,text)','public.export_archive_subject_due_v1(uuid)'])p;
select ok(not has_function_privilege(r,p,'execute'),r||' cannot execute '||p) from unnest(array['anon','authenticated','inherit_upload_only','service_role'])r,
 unnest(array['private.export_subject_ordinary_target_v1(uuid,uuid)','private.export_subject_cohort_role_v1(uuid)',
  'private.export_subject_joint_results_v1(uuid)','private.export_subject_scope_v1(jsonb,uuid)',
  'private.export_capture_ordinary_subject_v1(text,uuid,jsonb)','private.export_subject_history_projection_v1(uuid,uuid[],text)',
  'private.export_subject_class_projection_v1(uuid,uuid[],text)','private.export_subject_graph_projection_v1(uuid,uuid[],text)',
  'private.export_scoped_history_projection_v1(text,uuid,uuid[],text)','private.export_scoped_class_projection_v1(text,uuid,uuid[],text)',
  'private.export_scoped_graph_projection_v1(text,uuid,uuid[],text)','private.export_account_door_scope_v1(jsonb)',
  'private.account_archive_job_scope_v1(private.export_archive_jobs,public.generated_exports)',
  'private.export_subject_history_inventory_v1(uuid,uuid[])','private.export_subject_graph_capture_v1(uuid,jsonb)',
  'private.export_subject_class_inventory_v1(uuid,jsonb)','private.export_subject_family_turn_rows_v1(jsonb,uuid)',
  'private.export_subject_family_turn_capture_v1(jsonb,uuid)',
  'private.export_subject_portrait_rows_v1(jsonb,uuid)','private.export_scoped_class_rows_v1(jsonb,uuid[],text)'])p;
select throws_ok($$set local role service_role;select set_config('request.jwt.claims','{"role":"authenticated"}',true);select public.export_archive_subject_due_v1()$$,
 '42501','not_found','the subject due reader needs the service JWT too');
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- 6. TEST R2 completion and delivery for a subject job: the same synthetic
-- owner callback metadata as account_archive_test_completion.sql, no provider.
insert into auth.users(id,email) values('7a530000-0000-4000-8000-000000000001','subject-export-test@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a530000-0000-4000-8000-000000000010','7a530000-0000-4000-8000-000000000001',now(),now(),'aal1');
select is(public.declare_jurisdiction_v2('7a530000-0000-4000-8000-000000000001','7a530000-0000-4000-8000-000000000010','GB',null,
 (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),true)->>'jurisdiction','GB',
 'the TEST record owner declares a country through the current writer');
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
insert into sx(label,origin,target_kind,subject,attempt) select 'test',jsonb_build_object('kind','account','accountId','7a530000-0000-4000-8000-000000000001',
 'sessionId','7a530000-0000-4000-8000-000000000010'),'subject',s.id,'7a530000-0000-4000-8000-000000000030' from public.subjects s
 where s.subject_account_id='7a530000-0000-4000-8000-000000000001' and s.subject_class='self';
update sx set capture=pg_temp.request(label,'capture') where label='test';
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',repeat('e',64)),
 'exportCookieHash',repeat('6',64)),repeat('c',64)) where label='test';
create function pg_temp.worker(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.export_archive_worker_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload) from sx where label='test';
$$;
create function pg_temp.segment() returns jsonb language sql as $$
 select jsonb_build_object('ordinal',0,'offset',0,'sizeBytes',3,'sha256',repeat('d',64),
 'objectKey',capture->>'principalHash'||'/'||(created->>'exportId')||'/7a530000-0000-4000-8000-000000000030-0.part') from sx where label='test';
$$;
create temporary table test_frame(frame jsonb,ready jsonb);
select is(pg_temp.worker('begin')->>'attemptId','7a530000-0000-4000-8000-000000000030','the subject attempt starts');
select is(pg_temp.worker('reserve',pg_temp.segment())->>'ordinal','0','the native reservation precedes allocation');
insert into test_frame(frame) select private.reserve_account_archive_r2_write_v1(attempt,0,capture->>'authorityReceipt',repeat('1',64)) from sx where label='test';
select is(private.complete_account_archive_r2_write_v1('7a530000-0000-4000-8000-000000000030',0,
 (select capture->>'authorityReceipt' from sx where label='test'),repeat('1',64),(select frame from test_frame),'version1','etag1'),
 (select (frame->>'objectId')::uuid from test_frame),'the trusted owner records the synthetic provider identity for the subject attempt');
select is(pg_temp.worker('acknowledge',pg_temp.segment()||jsonb_build_object('objectId',(select frame->>'objectId' from test_frame)))->>'ordinal','0','the recorded ACK supplies the exact object');
select is(pg_temp.worker('page',jsonb_build_object('page',0,'segments',jsonb_build_array(pg_temp.segment()||jsonb_build_object('objectId',(select frame->>'objectId' from test_frame)))))->>'page','0','the manifest page is recorded');
create function pg_temp.manifest_hash() returns text language sql as $$
 select encode(digest(convert_to(format('[0,0,3,%s,%s,%s]%s',to_json(repeat('d',64))::text,
 to_json(pg_temp.segment()->>'objectKey')::text,to_json((select frame->>'objectId' from test_frame))::text,chr(10)),'UTF8'),'sha256'),'hex');
$$;
select is(pg_temp.worker('bytes-complete',jsonb_build_object('sizeBytes',3,'segmentCount',1,'pageCount',1,
 'sha256',repeat('d',64),'manifestSha256',pg_temp.manifest_hash()))->>'state','bytes-complete','the subject attempt records its byte counters');
select throws_ok($$update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 minute',
 archive_sha256=repeat('d',64),manifest_sha256=pg_temp.manifest_hash(),byte_count=3 where id=(select (created->>'exportId')::uuid from sx where label='test')$$,
 '55000','export_publication_not_integrated','status-only publication of a subject export is still refused');
update test_frame set ready=private.complete_test_account_archive_v1('7a530000-0000-4000-8000-000000000030',
 (select capture->>'authorityReceipt' from sx where label='test'),jsonb_build_object('version','complete-account-zip64-producer-v1',
 'memberCount',2,'payloadBytes',1,'memberSha256',repeat('e',64),'manifestMemberSha256',repeat('f',64)));
select is((select ready->>'status' from test_frame),'ready','the explicit TEST owner completion reaches READY for the subject job');
select is(private.account_archive_test_ready_v1((select origin from sx where label='test'),(select (created->>'exportId')::uuid from sx where label='test'),repeat('6',64)),
 (select ready from test_frame),'the READY poll returns the same completion for the subject cookie');
select throws_ok($$select private.account_archive_test_ready_v1((select origin from sx where label='test'),(select (created->>'exportId')::uuid from sx where label='test'),repeat('5',64))$$,
 '42501','account_archive_test_unavailable','the READY poll refuses another cookie');
select is(public.subject_export_request_v1('open-ready',(select origin from sx where label='test'),(select subject from sx where label='test'),
 jsonb_build_object('exportId',(select created->>'exportId' from sx where label='test'),'exportCookieHash',repeat('6',64),
 'envelope',pg_temp.envelope('test','open-ready',repeat('f',64)),'downloadCookieHash',repeat('4',64)),repeat('c',64))->>'chunkBytes','4000000',
 'open-ready through the route door creates the native download session');
select is(private.account_archive_test_delivery_context_v1((select id from private.export_archive_downloads where cookie_hash=repeat('4',64)),
 repeat('4',64),(select origin from sx where label='test'))->'ready',(select ready from test_frame),'the shared chunk door admits the subject download');
select ok(private.issue_account_archive_test_chunk_v1((select id from private.export_archive_downloads where cookie_hash=repeat('4',64)),
 repeat('4',64),(select origin from sx where label='test'),0,repeat('3',64),repeat('d',64),3),'the subject chunk is issued');
select ok(private.ack_account_archive_test_chunk_v1((select id from private.export_archive_downloads where cookie_hash=repeat('4',64)),
 repeat('4',64),(select origin from sx where label='test'),0,repeat('3',64),repeat('d',64),3),'and acknowledged once');
select throws_ok($$select private.account_archive_test_delivery_context_v1((select id from private.export_archive_downloads where cookie_hash=repeat('4',64)),
 repeat('4',64),'{"kind":"account","accountId":"7a520000-0000-4000-8000-000000000001","sessionId":"7a520000-0000-4000-8000-000000000010"}')$$,
 '42501','account_archive_test_unavailable','another account cannot use the subject download');

select * from finish();
rollback;
