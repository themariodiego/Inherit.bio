-- Read-only DDL guard for 20260920150000_own_preparation_budget_failure.sql.
-- Raises (and therefore returns nothing) unless the Inherit project matches the
-- reviewed 20 September preflight exactly; the migration is applied only after
-- this passes in the same minute. Nothing is written.
--
-- The function-body check is the one that earns its place here. This migration
-- carries two `create or replace` statements, and `create or replace` takes
-- whatever body it is given: a body copied from the wrong migration reverts
-- everything added after it, silently, with nothing in the diff to show it.
-- That happened to the guard in this very migration, caught by comparing the
-- deployed md5 against the repository source. The pinned md5s below are the
-- deployed ones, which equal their repository source byte for byte.
do $guard$
declare problems text[] := '{}';
begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20260920150000') then
  problems := problems || 'ledger already carries 20260920150000'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> 117
  or (select name from supabase_migrations.schema_migrations order by version desc limit 1) <> 'shared_report_readiness_completed_runs' then
  problems := problems || 'ledger differs from the preflight (117 rows ending in shared_report_readiness_completed_runs)'; end if;
 -- The two bodies the migration replaces must be the reviewed text, definer
 -- functions with the pinned search_path and the ACLs the preflight recorded.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef
   and array_to_string(p.proconfig,',')='search_path=pg_catalog, private' and pg_get_userbyid(p.proowner)='postgres'
   and (n.nspname,p.proname,md5(p.prosrc),length(p.prosrc),p.proacl::text) in (
   ('private','guard_own_preparation_identity_v1','2293d0d5d954294d83100417f6fa8d47',1238,'{postgres=X/postgres}'),
   ('private','own_preparation_status_v1','2321841e0495d426ffa1d47fcb15ad1e',2756,'{postgres=X/postgres,service_role=X/postgres}'))) <> 2 then
  problems := problems || 'a function body, ACL or definer setting the migration replaces differs from the reviewed preflight'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where (n.nspname,p.proname) in (('private','guard_own_preparation_identity_v1'),('private','own_preparation_status_v1'))) <> 2 then
  problems := problems || 'one of the two functions is missing or overloaded'; end if;
 -- Nothing the migration creates may already exist.
 if exists(select 1 from pg_proc where proname='fail_own_preparation_claim_v1') then
  problems := problems || 'fail_own_preparation_claim_v1 already exists'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private'
   and table_name='own_preparation_jobs' and column_name='frozen_reason') then
  problems := problems || 'own_preparation_jobs already carries frozen_reason'; end if;
 -- Everything the migration depends on must be present and single.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
   and p.proname in ('check_own_preparation_claim_v1','freeze_own_preparation_job_v1',
   'reserve_own_preparation_artifact_v1','freeze_due_own_preparations_v1')) <> 4 then
  problems := problems || 'a function the new one calls is missing or overloaded'; end if;
 if (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where p.proname='guard_own_preparation_identity_v1' and not t.tgisinternal) <> 2 then
  problems := problems || 'the identity guard is not attached to exactly two tables'; end if;
 if (select count(*) from pg_roles where rolname in ('anon','authenticated','inherit_upload_only','service_role')) <> 4 then
  problems := problems || 'a role named by the revoke or grant is missing'; end if;
 if (select pg_get_userbyid(nspowner) from pg_namespace where nspname='private') <> 'postgres' then
  problems := problems || 'private schema owner is not postgres'; end if;
 -- An empty table validates the new CHECK instantly and cannot hold a row that
 -- would carry a reason across the apply.
 if (select count(*) from private.own_preparation_jobs) <> 0 then
  problems := problems || 'own_preparation_jobs is no longer empty; re-read the preflight before applying'; end if;
 if cardinality(problems) > 0 then raise exception 'DDL guard refused: %', array_to_string(problems, '; '); end if;
end $guard$;
select 'ddl guard passed at '||clock_timestamp()::text as guard;
