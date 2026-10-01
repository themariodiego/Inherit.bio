begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Unchanged actual Auth/signing/normalization/report assertions. Only physical
-- source metadata is synthetic. SQL/RPC evidence never substitutes for provider.
\ir fixtures/account_archive_ordinary_scientific.inc
-- A genuine settings/presentation/grant producer records the destination and
-- the private fingerprints. No fabricated signature or authority row is seeded.
grant select on normalization_subject to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.save_own_copilot_settings_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',jsonb_build_object('provider','openai_compatible',
 'baseUrl','https://model.e2e.local/v1','model','synthetic-model','origin','https://model.e2e.local',
 'providerLabel','Synthetic model','providerClass','cloud','runtimeAttestationFingerprint',repeat('f',64)),
 null,repeat('e',64),null)->>'saved','true','actual settings producer stores private credential and transport fingerprints');
create temporary table actual_copilot_presentation as select public.own_copilot_presentation_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject)) value;
create temporary table actual_copilot_grant as select public.grant_own_copilot_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from normalization_subject),(select value->'snapshot' from actual_copilot_presentation),
 (select value->'artifacts' from actual_copilot_presentation),repeat('d',64),clock_timestamp()+interval '9 minutes') value;
select ok((select value->>'providerGrantId' is not null from actual_copilot_grant),
 'actual signed cloud disclosure produces its own distinct consent record');
reset role;
select ok((select copilot_recipient ?& array['credentialFingerprint','runtimeAttestationFingerprint'] from public.subject_consents
 where id=((select value->>'providerGrantId' from actual_copilot_grant))::uuid),
 'independent source actually holds both fields the new archive must withhold');
-- Synthetic recorded legacy history is not a new analytical grant. Its count
-- exceeds both the fixed500 source page and ordinary API row cap.
insert into public.consent_grants(user_id,provider_key,data_classes,granted_at,revoked_at)
 select '77900000-0000-4000-8000-000000000001','synthetic-history-'||i,array['recorded-history'],
 clock_timestamp()-interval '1 day',clock_timestamp() from generate_series(1,1103)i;
create temporary table actual_inventory_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_inventory_job(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),gen_random_uuid());
grant select,update on actual_inventory_job to service_role;
grant select on export_snapshot,normalization_subject to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_inventory_job set capture=public.export_archive_request_v1('capture',origin,'account','77900000-0000-4000-8000-000000000001');
update actual_inventory_job set created=public.export_archive_request_v1('create',origin,'account','77900000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','77900000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('7',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','real inventory request commits every deferred creation invariant before worker reads');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_inventory_job;

create function pg_temp.inventory(op text,kind text default null,after_id uuid default null) returns jsonb language sql as $$
 select public.export_archive_account_inventory_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,after_id)
 from actual_inventory_job
$$;
create temporary table actual_inventory_context as select pg_temp.inventory('context') value;
create temporary table actual_inventory_page1 as select pg_temp.inventory('history','legacy-consents') value;
create temporary table actual_inventory_page2 as select pg_temp.inventory('history','legacy-consents',
 (select (value->>'nextAfterId')::uuid from actual_inventory_page1)) value;
create temporary table actual_inventory_page3 as select pg_temp.inventory('history','legacy-consents',
 (select (value->>'nextAfterId')::uuid from actual_inventory_page2)) value;
create temporary table actual_inventory_consents as select pg_temp.inventory('history','account-consents') value;
select is((select c->>'rows' from actual_inventory_context,jsonb_array_elements(value->'classes')c where c->>'kind'='legacy-consents'),
 '1103','independent complete class count cannot be inferred from a short source page');
select is((select jsonb_array_length(value->'rows') from actual_inventory_page1),500,'the first real metadata page has500 rows');
select is((select jsonb_array_length(value->'rows') from actual_inventory_page2),500,'the second real metadata page has500 rows');
select is((select jsonb_array_length(value->'rows') from actual_inventory_page3),103,'the third page retains every row past the API cap');
select is((select value->'nextAfterId' from actual_inventory_page3),'null'::jsonb,'actual final metadata page has the exact closed cursor');
reset role;
select results_eq($$select c->>'kind',(c->>'rows')::bigint from actual_inventory_context,
 jsonb_array_elements(value->'classes')c order by c->>'kind'$$,
 $$select * from(values
 ('legacy-consents',(select count(*) from public.consent_grants where user_id='77900000-0000-4000-8000-000000000001')),
 ('subjects',(select count(*) from public.subjects where id=(select id from normalization_subject))),
 ('demographics',(select count(*) from public.subject_demographics where subject_id=(select id from normalization_subject))),
 ('principals',(select count(*) from public.subject_principals where account_id='77900000-0000-4000-8000-000000000001')),
 ('bindings',(select count(*) from public.subject_account_bindings where account_id='77900000-0000-4000-8000-000000000001')),
 ('account-consents',(select count(*) from public.subject_consents where account_id='77900000-0000-4000-8000-000000000001')),
 ('signatures',(select count(*) from public.consent_signatures where signer_account_id='77900000-0000-4000-8000-000000000001')),
 ('attestations',(select count(*) from public.attestations where principal_id in(select id from public.subject_principals
  where account_id='77900000-0000-4000-8000-000000000001') or signature_id in(select id from public.consent_signatures
  where signer_account_id='77900000-0000-4000-8000-000000000001'))),
 ('recipient-grants',(select count(*) from public.provider_recipient_grants where account_id='77900000-0000-4000-8000-000000000001'))
 )x(kind,rows) order by kind$$,'all nine independent class counts equal their actual requester-scoped source tables');
create temporary table all_actual_inventory_rows as select r->>'id' id,r->>'rowText' row_text from(
 select value from actual_inventory_page1 union all select value from actual_inventory_page2 union all select value from actual_inventory_page3)x,
 jsonb_array_elements(x.value->'rows')r;
select set_eq($$select id::uuid from all_actual_inventory_rows$$,
 $$select id from public.consent_grants where user_id='77900000-0000-4000-8000-000000000001'$$,
 'actual service pages equal every real source identity exactly once');
select is((select count(*) from all_actual_inventory_rows),1103::bigint,'the source identity equality cannot conceal duplicate output');
select results_eq($$select row_text::jsonb from all_actual_inventory_rows order by id::uuid$$,
 $$select jsonb_build_object('id',id,'provider_key',provider_key,'data_classes',data_classes,
 'granted_at',granted_at,'revoked_at',revoked_at) from public.consent_grants
 where user_id='77900000-0000-4000-8000-000000000001' order by id$$,
 'all actual source fields are preserved, with no inferred or unrelated account row');
create function pg_temp.independent_membership() returns text language plpgsql as $$
declare item record;digest bytea:=extensions.digest(convert_to('account-history-members-v1|legacy-consents','UTF8'),'sha256');
begin
 for item in select id,row_text from all_actual_inventory_rows order by id::uuid loop
  digest:=extensions.digest(digest||convert_to(item.id||':'||item.row_text||E'\n','UTF8'),'sha256');
 end loop;return encode(digest,'hex');end $$;
select is(pg_temp.independent_membership(),(select c->>'membershipSha256' from actual_inventory_context,
 jsonb_array_elements(value->'classes')c where c->>'kind'='legacy-consents'),
 'actual canonical page bytes independently reconstruct the complete source membership receipt');
select ok(not exists(select 1 from actual_inventory_consents,jsonb_array_elements(value->'rows')r
 where (r->>'rowText')::jsonb->'copilot_recipient' ?| array['credentialFingerprint','runtimeAttestationFingerprint','apiKey','key_last4']),
 'actual recorded cloud consent withholds private credential and transport fields before leaving the source reader');
select is((select (r->>'rowText')::jsonb->'copilot_recipient' from actual_inventory_consents,jsonb_array_elements(value->'rows')r
 where r->>'id'=(select value->>'providerGrantId' from actual_copilot_grant)),
 (select jsonb_build_object('providerLabel',copilot_recipient->'providerLabel','origin',copilot_recipient->'origin',
 'revision',copilot_recipient->'revision','providerClass',copilot_recipient->'providerClass','baseUrl',copilot_recipient->'baseUrl',
 'provider',copilot_recipient->'provider','model',copilot_recipient->'model') from public.subject_consents
 where id=((select value->>'providerGrantId' from actual_copilot_grant))::uuid),
 'the actual recorded provider destination and model remain intact after internal-field withholding');
create temporary table unchanged_inventory_job as select jsonb_build_object(
 'export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_inventory_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_inventory_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_inventory_job))) value;
set local role service_role;
select throws_ok($$select pg_temp.inventory('context','subjects')$$,'22023','invalid_request','context refuses a caller narrowed class');
select throws_ok($$select pg_temp.inventory('history','credential-keys')$$,'22023','invalid_request','unknown private classes have no selector');
select throws_ok($$select public.export_archive_account_inventory_v1('context',
 (select (created->>'exportId')::uuid from actual_inventory_job),gen_random_uuid(),
 (select capture->>'authorityReceipt' from actual_inventory_job))$$,'42501','export_source_unavailable',
 'a foreign attempt cannot borrow the real metadata inventory');
reset role;
savepoint same_count_source_edit;
update public.consent_grants set data_classes=array['changed-recorded-history'] where id=(select min(id::text)::uuid from public.consent_grants
 where user_id='77900000-0000-4000-8000-000000000001');
set local role service_role;
select throws_ok($$select pg_temp.inventory('history','legacy-consents')$$,'42501','not_found',
 'same-count actual source modification cannot enter the old consumed member frame');
reset role;rollback to same_count_source_edit;
savepoint actual_logout;
delete from auth.sessions where id='77900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.inventory('context')$$,'42501','not_found','actual session revocation refuses every buffered class');
reset role;rollback to actual_logout;
select is(has_function_privilege(r,'public.export_archive_account_inventory_v1(text,uuid,uuid,text,text,uuid)','execute'),r='service_role',
 r||' exact consumed inventory grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call the internal inventory/projection/frame helper')
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.export_account_history_projection_v1(uuid,uuid[],text)','private.export_account_history_inventory_v1(uuid,uuid[])',
 'private.export_account_owned_capture_pre_inventory_v1(jsonb,text,uuid)'])f;
select is(jsonb_build_object(
 'export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_inventory_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_inventory_job)),
 'attempt',(select to_jsonb(a) from private.export_archive_attempts a where a.id=(select attempt from actual_inventory_job))),
 (select value from unchanged_inventory_job),'all inventory reads and refusals preserve every durable export/job/attempt byte');
select * from finish();rollback;
