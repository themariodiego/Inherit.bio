-- Bounded, rollback-only production probe for 20260918213000_shared_report_readiness_completed_runs.sql.
-- Every RPC call uses fresh random identities that match no row, so refusals
-- are exercised without touching stored data; the migration writes no data and
-- the probe writes none. Observations live in a temporary table that is read
-- once and discarded with the session.
create temporary table probe_receipt(check_name text, outcome text, passed boolean);
do $probe$
declare sqlstate_out text; msg text; c bigint; before_n bigint; after_n bigint;
begin
  -- 1. Both replaced bodies are the repository text with definer status, the pinned search_path and unchanged ACLs.
  select count(*) into c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef
    and array_to_string(p.proconfig,',')='search_path=pg_catalog' and pg_get_userbyid(p.proowner)='postgres'
    and (n.nspname,p.proname,md5(p.prosrc),length(p.prosrc),p.proacl::text) in (
    ('public','family_shared_report_results_v1','f760ed0078c2f66208e81c27f7f5aff9',4171,'{postgres=X/postgres,service_role=X/postgres}'),
    ('private','health_picture_own_page_v1','62c04f1a13844e4ff826c8197892da1b',4565,'{postgres=X/postgres}'));
  insert into probe_receipt values('two replaced bodies equal the repository text with definer status, pinned search_path and unchanged ACLs', c::text, c = 2);
  -- 2. The deployed readiness predicate no longer names coverage; the content branch is untouched.
  select count(*) into c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname,p.proname) in (('public','family_shared_report_results_v1'),('private','health_picture_own_page_v1'))
    and p.prosrc not like '%item->''covered''=''true''::jsonb%'
    and p.prosrc like '%''reports'',r.result->''reports'') end);%';
  insert into probe_receipt values('deployed readiness predicate drops the covered conjunct and keeps the content branch', c::text, c = 2);
  -- 3. Privileges: the browser roles cannot call either reader; the service role keeps the public projection only.
  select count(*) into c from (values ('anon'),('authenticated'),('inherit_upload_only')) r(role)
    where has_function_privilege(r.role,'public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text)','execute')
       or has_function_privilege(r.role,'private.health_picture_own_page_v1(uuid,uuid,uuid,text,uuid,text)','execute');
  insert into probe_receipt values('no browser role can execute either reader', c::text, c = 0);
  insert into probe_receipt values('service role keeps the public projection and not the private page',
    (has_function_privilege('service_role','public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text)','execute'))::text||'/'||
    (has_function_privilege('service_role','private.health_picture_own_page_v1(uuid,uuid,uuid,text,uuid,text)','execute'))::text,
    has_function_privilege('service_role','public.family_shared_report_results_v1(uuid,uuid,uuid,text,uuid,text)','execute')
    and not has_function_privilege('service_role','private.health_picture_own_page_v1(uuid,uuid,uuid,text,uuid,text)','execute'));
  -- 4. Contracts unchanged for unknown identities: an unknown mode is refused before any authority read; unknown recipients and owners are refused as not found in both modes.
  begin perform public.family_shared_report_results_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'reports.polygenic', null, 'unknown'); insert into probe_receipt values('unknown projection mode refused before authority','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('unknown projection mode refused before authority', sqlstate_out||' '||msg, sqlstate_out='22023' and msg='invalid_request'); end;
  begin perform public.family_shared_report_results_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'reports.polygenic', null, 'readiness'); insert into probe_receipt values('readiness for an unknown recipient refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('readiness for an unknown recipient refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  begin perform public.family_shared_report_results_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'reports.monogenic', null, 'content'); insert into probe_receipt values('content for an unknown recipient refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('content for an unknown recipient refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  begin perform public.family_shared_report_results_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'ancestry', null, 'readiness'); insert into probe_receipt values('unshared purpose refused as not found','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('unshared purpose refused as not found', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  begin perform private.health_picture_own_page_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'reports.polygenic', null, 'readiness'); insert into probe_receipt values('own page for an unknown owner refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('own page for an unknown owner refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  begin perform private.health_picture_own_page_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'ancestry', null, 'content'); insert into probe_receipt values('own page refuses a purpose outside the two report layers','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('own page refuses a purpose outside the two report layers', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='not_found'); end;
  -- 5. Stored results are untouched and every completed report run in production is announced under both predicates.
  select count(*) into c from private.own_analysis_runs;
  insert into probe_receipt values('analysis runs unchanged since the preflight', c::text, c = 3);
  select count(*) filter (where exists(select 1 from jsonb_array_elements(r.result->'reports') i where i->'covered'='true'::jsonb and jsonb_typeof(i->'catalogSnapshot')='object' and i->>'slug' not like 'auto-e2e-%')),
         count(*) filter (where exists(select 1 from jsonb_array_elements(r.result->'reports') i where jsonb_typeof(i->'catalogSnapshot')='object' and i->>'slug' not like 'auto-e2e-%'))
    into before_n, after_n from private.own_analysis_runs r where r.purpose in ('reports.monogenic','reports.polygenic') and r.state='complete';
  insert into probe_receipt values('every completed report run announced under the old predicate is announced under the new one and no card changes', before_n::text||'/'||after_n::text, before_n = 2 and after_n = 2);
  -- 6. Nothing was written by the probe.
  select count(*) into c from private.own_analysis_runs where completed_at > clock_timestamp() - interval '10 minutes';
  insert into probe_receipt values('no analysis run completed during the probe', c::text, c = 0);
end $probe$;
select jsonb_build_object('observedAt', now(), 'checks', count(*), 'passed', count(*) filter (where passed), 'failed', jsonb_agg(check_name) filter (where not passed), 'rows', jsonb_agg(jsonb_build_object('check', check_name, 'outcome', outcome, 'passed', passed))) from probe_receipt;
