-- Read-only DDL guard for 20260918150000_own_upload_gvcf_ceiling.sql. Raises
-- (and therefore returns nothing) unless the Inherit project matches the
-- reviewed 18 September preflight exactly; the migration is applied only after
-- this passes in the same minute, and only after the deployment carrying the
-- app change that accepts the new disclosure key is READY. Nothing is written.
do $guard$
declare problems text[] := '{}';
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name='own_upload_gvcf_ceiling') then
  problems := problems || 'ledger already carries own_upload_gvcf_ceiling'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> 115
  or (select name from supabase_migrations.schema_migrations order by version desc limit 1) <> 'source_revocation_inline' then
  problems := problems || 'ledger differs from the preflight (115 rows ending in source_revocation_inline)'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='upload_authorization_config' and column_name='maximum_gvcf_bytes') then
  problems := problems || 'maximum_gvcf_bytes already exists'; end if;
 if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='private' and table_name='upload_authorization_config')
   is distinct from array['singleton','auth_issuer','maximum_array_bytes','maximum_vcf_bytes','maximum_account_bytes','maximum_active_uploads'] then
  problems := problems || 'upload_authorization_config columns differ from the preflight'; end if;
 -- The four bodies the migration replaces must be the reviewed text (repository md5 = deployed md5 at preflight).
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef and (p.proname,md5(p.prosrc)) in (
   ('issue_own_storage_upload_v1','3c2c9dec48dae998235888ebd00228cc'),
   ('own_upload_normalization_v1','c19d70e13b39b90a277afc3d6dafb683'),
   ('own_preparation_source_v1','ab46603f468b5948c8b9bbf6bc1ba374'),
   ('own_upload_limits_v1','9c590cf4ca5110be93135343e1e16692'))) <> 4 then
  problems := problems || 'a function body the migration replaces differs from the reviewed text'; end if;
 if (select count(*) from pg_roles where rolname in ('anon','authenticated','inherit_upload_only','service_role')) <> 4 then
  problems := problems || 'a role named by the function ACLs is missing'; end if;
 if (select pg_get_userbyid(nspowner) from pg_namespace where nspname='private') <> 'postgres' then
  problems := problems || 'private schema owner is not postgres'; end if;
 if (select maximum_vcf_bytes from private.upload_authorization_config where singleton) <> 25165824 then
  problems := problems || 'maximum_vcf_bytes is not the preflight value 25165824'; end if;
 if cardinality(problems) > 0 then raise exception 'DDL guard refused: %', array_to_string(problems, '; '); end if;
end $guard$;
select 'ddl guard passed at '||clock_timestamp()::text as guard;
