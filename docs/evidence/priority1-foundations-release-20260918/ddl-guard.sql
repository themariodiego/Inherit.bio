-- Read-only DDL guard for 20260918080000_own_preparation_monthly_cap.sql and
-- 20260918113000_source_revocation_inline.sql. Raises (and therefore returns
-- nothing) unless the Inherit project matches the reviewed 18 September
-- preflight exactly; both migrations are applied only after this passes in the
-- same minute. Nothing is written.
do $guard$
declare problems text[] := '{}';
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name in ('own_preparation_monthly_cap','source_revocation_inline')) then
  problems := problems || 'ledger already carries one of the two migrations'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> 113
  or (select name from supabase_migrations.schema_migrations order by version desc limit 1) <> 'family_ancestry_shared_authority' then
  problems := problems || 'ledger differs from the 18 September preflight (113 rows ending in family_ancestry_shared_authority)'; end if;
 -- The bodies the fold migration moves verbatim, and the enqueue body it extends, must be the reviewed text.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname,md5(p.prosrc)) in (
   ('public','prepare_genome_file_deletion_v1','d27d8c27a9a61de3b46e681848aa34f3'),
   ('public','finish_genome_file_deletion_v1','1f085ef0a4ac0bb24b673859f5fc0f1c'),
   ('private','enqueue_own_preparation_v1','2668282374e1eedd8fc5afea6db4c7f5'))) <> 3 then
  problems := problems || 'a function body the migrations build on differs from the reviewed text'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (
   ('private','prepare_genome_file_deletion_body_v1'),('private','finish_genome_file_deletion_body_v1'),
   ('private','authorize_genome_file_deletion_claim_v1'),('public','claim_due_genome_file_deletion_v1'),
   ('public','prepare_own_prepared_file_cleanup_claimed_v1'),('public','finish_genome_file_deletion_claimed_v1'),
   ('public','fail_genome_file_deletion_claim_v1'))) then problems := problems || 'a function the fold migration creates already exists'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='own_preparation_monthly_admissions') then
  problems := problems || 'private.own_preparation_monthly_admissions already exists'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='own_preparation_config' and column_name='monthly_admission_limit') then
  problems := problems || 'monthly_admission_limit already exists'; end if;
 if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='private' and table_name='genome_file_deletions')
   is distinct from array['file_id','account_id','token','bucket_id','object_name','started_at','canonical_chat_manifest'] then
  problems := problems || 'private.genome_file_deletions columns differ from the preflight'; end if;
 if (select execution_class from public.retention_registry where retention_id='source.revocation-7d') is distinct from 'revocationDispositionWorker' then
  problems := problems || 'source.revocation-7d is not in the revocationDispositionWorker class'; end if;
 if not exists(select 1 from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
   where n.nspname='public' and r.relname='retention_registry' and pg_get_constraintdef(c.oid) like '%inlineEventDriven%') then
  problems := problems || 'retention_registry does not admit inlineEventDriven'; end if;
 if (select count(*) from pg_roles where rolname in ('anon','authenticated','inherit_upload_only','service_role')) <> 4 then
  problems := problems || 'a role named by the migration ACLs is missing'; end if;
 if (select pg_get_userbyid(nspowner) from pg_namespace where nspname='private') <> 'postgres' then
  problems := problems || 'private schema owner is not postgres'; end if;
 if (select count(*) from private.genome_file_deletions) <> 0 then
  problems := problems || 'a deletion record exists; the fold must not be applied over live pending deletions without reading them first'; end if;
 if exists(select 1 from private.own_preparation_config where singleton and enabled) then
  problems := problems || 'preparation is enabled; the cap must be applied with preparation disabled'; end if;
 if array_length(problems,1) > 0 then
  raise exception 'DDL guard failed: %', array_to_string(problems,'; '); end if;
end $guard$;
select 'ddl guard passed' as result;
