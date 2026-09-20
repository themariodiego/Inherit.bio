-- Bounded, rollback-only production probe for 20260920150000_own_preparation_budget_failure.sql.
-- Every call uses a fresh random identity that matches no row, so refusals are
-- exercised without touching stored data; the migration writes no data and the
-- probe writes none. Observations live in a temporary table that is read once
-- and discarded with the session.
--
-- Run while preparation is still disabled, which is the state the preflight
-- recorded. That is why the authority refusal below expects 55000
-- preparation_disabled rather than 42501 not_found: check_own_preparation_claim_v1
-- tests the enabled flag first. The two argument refusals are checked before
-- authority, so they read the same either way.
create temporary table probe_receipt(check_name text, outcome text, passed boolean);
do $probe$
declare sqlstate_out text; msg text; c bigint; g text; s text;
begin
  -- 1. All four bodies are the repository text, with definer status, the pinned
  --    search_path and the ACLs the release expects.
  select count(*) into c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef
    and array_to_string(p.proconfig,',')='search_path=pg_catalog, private' and pg_get_userbyid(p.proowner)='postgres'
    and (n.nspname,p.proname,md5(p.prosrc),length(p.prosrc),p.proacl::text) in (
    ('private','guard_own_preparation_identity_v1','d6c8b0991bce13efdcabeafac56f851c',1365,'{postgres=X/postgres}'),
    ('private','own_preparation_status_v1','dc17bd5dd763072a1492d393394a12ef',2871,'{postgres=X/postgres,service_role=X/postgres}'),
    ('private','fail_own_preparation_claim_v1','972630d8bcd79fd5c78933c7385df94e',1754,'{postgres=X/postgres,service_role=X/postgres}'));
  insert into probe_receipt values('three private bodies equal the repository text with definer status, pinned search_path and the expected ACLs', c::text, c = 3);
  select count(*) into c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fail_own_preparation_claim_v1' and not p.prosecdef
    and md5(p.prosrc)='e21f3da3f6c35e3ac3b16e0954fbd977' and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}';
  insert into probe_receipt values('the public wrapper is security invoker with the expected body and ACL', c::text, c = 1);

  -- 2. The replaced guard kept every rule it had. These three are the ones a
  --    body copied from the wrong migration would have dropped, which is how
  --    this release came to check bodies at all.
  select p.prosrc into g from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='guard_own_preparation_identity_v1';
  insert into probe_receipt values('guard still forbids changing a published row',
    (g like '%old.state in(''frozen'',''published'')%')::text, g like '%old.state in(''frozen'',''published'')%');
  insert into probe_receipt values('guard still forbids publishing from a state other than claimed',
    (g like '%new.state=''published'' and old.state<>''claimed''%')::text, g like '%new.state=''published'' and old.state<>''claimed''%');
  insert into probe_receipt values('guard still lets an artifact row change provider_version and provider_etag',
    (g like '%''provider_version'',''provider_etag''%')::text, g like '%''provider_version'',''provider_etag''%');
  insert into probe_receipt values('guard knows the new column and makes it write-once',
    (g like '%''frozen_reason''%' and g like '%old.frozen_reason is not null%')::text,
    g like '%''frozen_reason''%' and g like '%old.frozen_reason is not null%');

  -- 3. The status answer is byte-identical for a job with no reason.
  select p.prosrc into s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='own_preparation_status_v1';
  insert into probe_receipt values('status emits the reason key only when a reason is recorded',
    (s like '%case when j.frozen_reason is null then ''{}''::jsonb%')::text,
    s like '%case when j.frozen_reason is null then ''{}''::jsonb%');

  -- 4. The column exists as a nullable text with the closed set, and nothing carries a value.
  select count(*) into c from information_schema.columns where table_schema='private'
    and table_name='own_preparation_jobs' and column_name='frozen_reason' and data_type='text' and is_nullable='YES';
  insert into probe_receipt values('frozen_reason is a nullable text column', c::text, c = 1);
  select count(*) into c from pg_constraint con join pg_class t on t.oid=con.conrelid
    join pg_namespace n on n.oid=t.relnamespace where n.nspname='private' and t.relname='own_preparation_jobs'
    and con.contype='c' and pg_get_constraintdef(con.oid) like '%artifact_budget_exhausted%';
  insert into probe_receipt values('the closed set is enforced by a check constraint', c::text, c = 1);

  -- 5. Privileges: no browser role can reach either new function.
  select count(*) into c from (values ('anon'),('authenticated'),('inherit_upload_only')) r(role)
    where has_function_privilege(r.role,'public.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint)','execute')
       or has_function_privilege(r.role,'private.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint)','execute');
  insert into probe_receipt values('no browser role can execute the new function', c::text, c = 0);
  insert into probe_receipt values('service role keeps the public wrapper',
    has_function_privilege('service_role','public.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint)','execute')::text,
    has_function_privilege('service_role','public.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint)','execute'));

  -- 6. Refusals, on identities that match no row.
  begin
    perform public.fail_own_preparation_claim_v1(gen_random_uuid(),gen_random_uuid(),repeat('0',64),'too_big',2000);
    insert into probe_receipt values('a reason outside the closed set is refused','no exception',false);
  exception when others then get stacked diagnostics sqlstate_out=returned_sqlstate, msg=message_text;
    insert into probe_receipt values('a reason outside the closed set is refused', sqlstate_out||' '||msg,
      sqlstate_out='22023' and msg='invalid_request');
  end;
  begin
    perform public.fail_own_preparation_claim_v1(gen_random_uuid(),gen_random_uuid(),repeat('0',64),'artifact_budget_exhausted',0);
    insert into probe_receipt values('a byte count of zero is refused','no exception',false);
  exception when others then get stacked diagnostics sqlstate_out=returned_sqlstate, msg=message_text;
    insert into probe_receipt values('a byte count of zero is refused', sqlstate_out||' '||msg,
      sqlstate_out='22023' and msg='invalid_request');
  end;
  begin
    perform public.fail_own_preparation_claim_v1(gen_random_uuid(),gen_random_uuid(),repeat('0',64),'artifact_budget_exhausted',2000);
    insert into probe_receipt values('a well-formed call still refuses while preparation is disabled','no exception',false);
  exception when others then get stacked diagnostics sqlstate_out=returned_sqlstate, msg=message_text;
    insert into probe_receipt values('a well-formed call still refuses while preparation is disabled', sqlstate_out||' '||msg,
      sqlstate_out='55000' and msg='preparation_disabled');
  end;

  -- 7. Nothing was written, by the migration or by this probe.
  select count(*) into c from private.own_preparation_jobs;
  insert into probe_receipt values('no preparation job exists', c::text, c = 0);
  select count(*) into c from private.own_preparation_artifacts;
  insert into probe_receipt values('no preparation artifact exists', c::text, c = 0);
  select count(*) into c from private.own_preparation_config where singleton and not enabled and max_artifact_bytes=104857600;
  insert into probe_receipt values('the configuration is untouched: still disabled at the preflight budget', c::text, c = 1);
end $probe$;
select jsonb_build_object('observedAt', now(), 'checks', count(*), 'passed', count(*) filter (where passed), 'failed', jsonb_agg(check_name) filter (where not passed), 'rows', jsonb_agg(jsonb_build_object('check', check_name, 'outcome', outcome, 'passed', passed))) from probe_receipt;
