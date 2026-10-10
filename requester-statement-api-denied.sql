-- AUTHORED AND UNRUN. Apply only after root binds and qualifies the exact
-- predecessor/source in a disposable native database. No authority fixture is
-- synthesized by this catalog test. Positive native flows are a separate gate.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(28);
select ok(not has_table_privilege(role_name,'private.'||store_name,'SELECT'),role_name||' cannot read '||store_name)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
 cross join unnest(array['new_requester_statement_test_scope','new_correction_archive_cases','new_correction_archive_runs',
  'new_correction_archive_provider_dispositions','new_correction_archive_r2_configuration','new_correction_archive_r2_allocations'])store_name;
select ok(not has_function_privilege('service_role',function_name,'EXECUTE'),'service cannot forge native issuer or ACK '||function_name)
 from unnest(array['private.current_account_correction_statement_v1(jsonb,uuid)',
  'private.current_new_correction_archive_r2_write_v1(uuid,bigint,text)',
  'private.claim_new_correction_archive_r2_disposal_v1(uuid,bigint,text)',
  'private.ack_new_correction_archive_r2_disposal_v1(uuid,bigint,text,jsonb,jsonb)'])function_name;
select * from finish();
rollback;
