begin;
select no_plan();
-- Original genuine attested review, release, own Auth/MFA binding and complete
-- relocation assertions remain in these unchanged includes. Physical/provider
-- metadata is synthetic; this is never a hosted/provider completion claim.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_binding_lifecycle.inc
\ir fixtures/future_person_completed_bound_relocation.inc
\ir fixtures/future_person_recorded_scientific_members.inc
-- Historical metadata is recorded without creating a grant or authority row.
insert into public.suppressions(subject_id,condition_id,reason_code,suppression_revision)
 select id,'synthetic-condition-'||i,'synthetic-recorded-history',1
 from claimant_account_self cross join generate_series(1,1103)i;
insert into auth.users(id,email) values('79200000-0000-4000-8000-000000000001','class-foreign@e2e.local');
insert into public.suppressions(subject_id,condition_id,reason_code,suppression_revision)
 select id,'synthetic-foreign-condition','synthetic-foreign-history',1 from public.subjects
 where subject_account_id='79200000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.family_sharing_pauses(account_low_id,account_high_id,paused_by_account_id,paused_at,
 ended_at,ended_by_account_id,end_reason) values('79200000-0000-4000-8000-000000000001',
 '7b100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',
 clock_timestamp()-interval '1 day',clock_timestamp(),'7b100000-0000-4000-8000-000000000001','resumed');
insert into public.family_sharing_stops(account_low_id,account_high_id,stopped_by_account_id,deleted_counts)
 values('79200000-0000-4000-8000-000000000001','7b100000-0000-4000-8000-000000000001',
 '7b100000-0000-4000-8000-000000000001','{"synthetic_private_count":99}');
create temporary table actual_class_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_class_job(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','7b100000-0000-4000-8000-000000000001','sessionId','7b100000-0000-4000-8000-000000000002'),gen_random_uuid());
grant select,update on actual_class_job to service_role;
grant select on custody_ids,claimant_account_self to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_class_job set capture=public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001');
update actual_class_job set created=public.export_archive_request_v1('create',origin,'account','7b100000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','7b100000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('a',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','the actual class request flushes every deferred creation invariant before its worker');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_class_job;
create function pg_temp.classes(op text,kind text default null,after_id uuid default null) returns jsonb language sql as $$
 select public.export_archive_account_classes_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,after_id)
 from actual_class_job
$$;
create temporary table actual_class_context as select pg_temp.classes('context') value;
select set_eq($$select k from actual_class_context,jsonb_object_keys(value)k$$,
 $$select k from(values('version'),('authorityReceipt'),('classes'),('boundSnapshots'))x(k)$$,
 'the actual class context has exactly its four closed fields');
select is((select value->>'authorityReceipt' from actual_class_context),(select capture->>'authorityReceipt' from actual_class_job),
 'class inventory is bound to the exact actually consumed request receipt');
select is((select value->'boundSnapshots'->0 from actual_class_context),
 (select public.export_archive_account_members_v1('bound-context',(created->>'exportId')::uuid,attempt,
 capture->>'authorityReceipt',(select subject from custody_ids)) from actual_class_job),
 'the declared immutable scientific snapshot equals the real separate current bound reader');
select is((select jsonb_array_length(value->'classes') from actual_class_context),29,
 'all original27 deferred classes and both withheld Path B stores are classified');
select set_eq($$select c->>'kind',c->>'mode' from actual_class_context,jsonb_array_elements(value->'classes')c$$,
 $$select * from(values
 ('ancestry_regions','unsupported'),
 ('appeal_intakes','unsupported'),
 ('attestation_contradictions','metadata'),
 ('correction_requests','unsupported'),
 ('directional_grants','metadata'),
 ('embryo_basis_bindings','unsupported'),
 ('embryo_cohorts','unsupported'),
 ('embryo_disposition_confirmations','unsupported'),
 ('embryo_disposition_proposals','unsupported'),
 ('embryo_donor_attributions','unsupported'),
 ('embryo_figures','claimed-bound'),
 ('embryo_participant_sets','unsupported'),
 ('embryo_qc','claimed-bound'),
 ('embryo_scores','claimed-bound'),
 ('embryo_variants','claimed-bound'),
 ('embryos','claimed-bound'),
 ('family_pairs','unsupported'),
 ('family_sharing_pauses','metadata'),
 ('family_sharing_stops','metadata'),
 ('future_person_claim_objections','metadata'),
 ('future_person_claimant_principals','metadata'),
 ('future_person_claims','metadata'),
 ('portrait_results','unsupported'),
 ('report_artifacts','claimed-bound'),
 ('subject_control_refusal_authorities','metadata'),
 ('subject_relationships','metadata'),
 ('suppressions','metadata'),
 ('other_adult_held_uploads','unsupported'),
 ('path_b_report_bindings','unsupported'))expected(kind,mode)$$,
 'the complete literal class/mode inventory accepts no missing, added or recategorized class');
select ok((select bool_and((c->>'rows')::bigint=0) from actual_class_context,jsonb_array_elements(value->'classes')c where c->>'mode'='unsupported'),
 'every unproved class is independently absent before this account may proceed');
create temporary table actual_class_page1 as select pg_temp.classes('metadata','suppressions') value;
create temporary table actual_class_page2 as select pg_temp.classes('metadata','suppressions',
 (select (value->>'nextAfterId')::uuid from actual_class_page1)) value;
create temporary table actual_class_page3 as select pg_temp.classes('metadata','suppressions',
 (select (value->>'nextAfterId')::uuid from actual_class_page2)) value;
select is((select (c->>'rows')::bigint from actual_class_context,jsonb_array_elements(value->'classes')c where c->>'kind'='suppressions'),
 1103::bigint,'independent metadata membership exceeds the source page and old API cap');
select is((select jsonb_array_length(value->'rows') from actual_class_page1),500,'first real class page has exactly500 rows');
select is((select jsonb_array_length(value->'rows') from actual_class_page2),500,'second real class page has exactly500 rows');
select is((select jsonb_array_length(value->'rows') from actual_class_page3),103,'third real class page contains every remaining row');
select is((select value->'nextAfterId' from actual_class_page3),'null'::jsonb,'the last real class page has the exact EOF cursor');
reset role;
select results_eq($$select c->>'kind',(c->>'rows')::bigint from actual_class_context,
 jsonb_array_elements(value->'classes')c where c->>'mode'='claimed-bound' order by c->>'kind'$$,
 $$select kind,rows from(values
 ('embryo_figures',(select count(*) from public.embryo_figures f join public.embryo_scores sc on sc.id=f.finding_id where sc.embryo_id=(select embryo from custody_ids))),
 ('embryo_qc',(select count(*) from public.embryo_qc where embryo_id=(select embryo from custody_ids))),
 ('embryo_scores',(select count(*) from public.embryo_scores where embryo_id=(select embryo from custody_ids))),
 ('embryo_variants',(select count(*) from public.embryo_variants where source_file_id=(select file from custody_ids))),
 ('embryos',(select count(*) from public.embryos where subject_id=(select subject from custody_ids))),
 ('report_artifacts',(select count(*) from public.report_artifacts where subject_id=(select subject from custody_ids)))
 )expected(kind,rows) order by kind$$,'all six scientific counts equal independent actual complete source-table memberships');
create temporary table all_actual_class_rows as select r from(
 select value from actual_class_page1 union all select value from actual_class_page2 union all select value from actual_class_page3)x,
 jsonb_array_elements(x.value->'rows')r;
select set_eq($$select (r->>'id')::uuid from all_actual_class_rows$$,
 $$select id from public.suppressions where subject_id=(select id from claimant_account_self)$$,
 'complete pages contain every actual own suppression ID and no foreign row');
select ok(not exists(select 1 from all_actual_class_rows where r->>'subjectId' is distinct from (select id::text from claimant_account_self)),
 'every metadata row carries its exact genuinely captured subject partition');
select set_eq($$select distinct k from all_actual_class_rows,jsonb_object_keys((r->>'rowText')::jsonb)k$$,
 $$select k from(values('id'),('condition_id'),('reason_code'),('suppression_revision'),('active_from'),('ended_at'))x(k)$$,
 'the row projection has exactly its six approved scientific/refusal metadata fields');
create function pg_temp.check_class_digest() returns text language plpgsql as $$declare digest bytea;item record;begin
 digest:=extensions.digest(convert_to('account-class-members-v1|suppressions','UTF8'),'sha256');
 for item in select * from public.suppressions where subject_id=(select id from claimant_account_self) order by id loop
  digest:=extensions.digest(digest||convert_to(item.id::text||':'||item.subject_id::text||':'||jsonb_build_object(
   'id',item.id,'condition_id',item.condition_id,'reason_code',item.reason_code,'suppression_revision',item.suppression_revision,
   'active_from',item.active_from,'ended_at',item.ended_at)::text||E'\n','UTF8'),'sha256');
 end loop;
 return is((select c->>'membershipSha256' from actual_class_context,jsonb_array_elements(value->'classes')c where c->>'kind'='suppressions'),
  encode(digest,'hex'),'independent ordered source rows reproduce the complete identity/content digest');
end $$;
select pg_temp.check_class_digest();
set local role service_role;
create temporary table actual_class_pause as select pg_temp.classes('metadata','family_sharing_pauses') value;
create temporary table actual_class_stop as select pg_temp.classes('metadata','family_sharing_stops') value;
reset role;
select is((select (value->'rows'->0->>'rowText')::jsonb from actual_class_pause),
 (select jsonb_build_object('id',p.id,'paused_by_requester',false,'ended_by_requester',true,
 'paused_at',p.paused_at,'ended_at',p.ended_at,'end_reason','resumed') from public.family_sharing_pauses p
 where p.account_low_id='79200000-0000-4000-8000-000000000001' and p.account_high_id='7b100000-0000-4000-8000-000000000001'),
 'actual other-party action retains its safe requester-relative flags and recorded clocks');
select ok((select value->'rows'->0->'subjectId'='null'::jsonb from actual_class_pause),
 'account history never guesses a foreign action target or assigns it to the self subject');
select ok((select (value->'rows'->0->>'rowText')::jsonb->>'stopped_by_requester'='true' from actual_class_stop)
 and (select not ((value->'rows'->0->>'rowText')::jsonb ?| array['account_low_id','account_high_id','stopped_by_account_id','deleted_counts']) from actual_class_stop),
 'stopped history preserves own action without counterparty identifiers or private graph counts');
set local role service_role;
select throws_ok($$select pg_temp.classes('context','suppressions')$$,'22023','invalid_request','context cannot be narrowed to a caller-selected class');
select throws_ok($$select pg_temp.classes('metadata','embryo_variants')$$,'22023','invalid_request','scientific calls cannot use the metadata door');
select throws_ok($$select pg_temp.classes('metadata','credential-keys')$$,'22023','invalid_request','no caller-selected private table or credential class is accepted');
select throws_ok($$select public.export_archive_account_classes_v1('context',
 (select (created->>'exportId')::uuid from actual_class_job),gen_random_uuid(),
 (select capture->>'authorityReceipt' from actual_class_job))$$,'42501','export_source_unavailable','a foreign attempt cannot borrow the genuine consumed inventory');
reset role;
create temporary table unchanged_class_job as select jsonb_build_object(
 'export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_class_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_class_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_class_job))) value;
savepoint same_count_class_edit;
update public.suppressions set reason_code='synthetic-changed' where id=(select min(id::text)::uuid from public.suppressions
 where subject_id=(select id from claimant_account_self));
set local role service_role;
select throws_ok($$select pg_temp.classes('metadata','suppressions')$$,'42501','not_found',
 'same-count current source modification refuses the original consumed member frame before another page');
reset role;rollback to same_count_class_edit;
savepoint actual_class_logout;
delete from auth.sessions where id='7b100000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select pg_temp.classes('context')$$,'42501','not_found','real own Auth logout refuses all class reads before returned data');
reset role;rollback to actual_class_logout;
savepoint nonempty_unproved_class;
insert into public.correction_requests(subject_id,claimant_principal_id,correction_kind,correction_revision,statement_ciphertext)
 select s.id,p.id,'record_metadata',1,decode('00','hex') from claimant_account_self s
 join public.subject_principals p on p.subject_id=s.id and p.account_id='7b100000-0000-4000-8000-000000000001'
 where p.status='active' and p.principal_kind='account_subject';
select is((select count(*) from public.correction_requests where subject_id=(select id from claimant_account_self)),1::bigint,
 'the unproved producer refusal has an actual nonempty current row');
set local role service_role;
select throws_ok($$select public.export_archive_request_v1('capture',origin,'account','7b100000-0000-4000-8000-000000000001') from actual_class_job$$,
 '0A000','export_class_projection_unavailable','a nonempty unproved class refuses the whole request rather than silently omitting it');
reset role;rollback to nonempty_unproved_class;
select is(jsonb_build_object(
 'export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_class_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_class_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_class_job))),
 (select value from unchanged_class_job),'all refused probes leave exact durable export/job/attempt bytes unchanged');
select is(has_function_privilege(r,'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','execute'),r='service_role',
 r||' exact distinct consumed class reader grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call internal class projection/capture helpers')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.export_account_class_projection_v1(uuid,uuid[],text)','private.export_account_class_inventory_v1(uuid,jsonb)',
 'private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)'])f;
select lives_ok('set constraints all immediate','every final deferred invariant remains enforced');
select * from finish();rollback;
