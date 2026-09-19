-- Read-only DDL guard for 20260918213000_shared_report_readiness_completed_runs.sql.
-- Raises (and therefore returns nothing) unless the Inherit project matches the
-- reviewed 18 September preflight exactly; the migration is applied only after
-- this passes in the same minute. Nothing is written.
do $guard$
declare problems text[] := '{}';
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name='shared_report_readiness_completed_runs') then
  problems := problems || 'ledger already carries shared_report_readiness_completed_runs'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> 116
  or (select name from supabase_migrations.schema_migrations order by version desc limit 1) <> 'own_upload_gvcf_ceiling' then
  problems := problems || 'ledger differs from the preflight (116 rows ending in own_upload_gvcf_ceiling)'; end if;
 -- The two bodies the migration replaces must be the reviewed text (repository md5 = deployed md5 at preflight),
 -- definer functions with the pinned search_path and the ACLs the preflight recorded.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef
   and array_to_string(p.proconfig,',')='search_path=pg_catalog' and pg_get_userbyid(p.proowner)='postgres'
   and (n.nspname,p.proname,md5(p.prosrc),length(p.prosrc),p.proacl::text) in (
   ('public','family_shared_report_results_v1','7c9f5c3ff3ee1c7a458f1852d48a1630',4205,'{postgres=X/postgres,service_role=X/postgres}'),
   ('private','health_picture_own_page_v1','437aa615409b0506ecb4cd5ff2fcf2fa',4599,'{postgres=X/postgres}'))) <> 2 then
  problems := problems || 'a function body, ACL or definer setting the migration replaces differs from the reviewed preflight'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where (n.nspname,p.proname) in (('public','family_shared_report_results_v1'),('private','health_picture_own_page_v1'))) <> 2 then
  problems := problems || 'one of the two functions is missing or overloaded'; end if;
 if (select count(*) from pg_roles where rolname in ('anon','authenticated','inherit_upload_only','service_role')) <> 4 then
  problems := problems || 'a role named by the function ACLs is missing'; end if;
 if (select pg_get_userbyid(nspowner) from pg_namespace where nspname='private') <> 'postgres' then
  problems := problems || 'private schema owner is not postgres'; end if;
 if cardinality(problems) > 0 then raise exception 'DDL guard refused: %', array_to_string(problems, '; '); end if;
end $guard$;
select 'ddl guard passed at '||clock_timestamp()::text as guard;
