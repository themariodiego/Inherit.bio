-- Read-only DDL guard for 20260915120846_family_ancestry_shared_authority.sql.
-- Raises (and therefore returns nothing) unless production matches the reviewed
-- 17 September preflight exactly; the migration must only be applied after this
-- passes in the same minute. Nothing is written.
do $guard$
declare problems text[] := '{}'; expected_events text;
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name='family_ancestry_shared_authority') then
  problems := problems || 'ledger already carries family_ancestry_shared_authority'; end if;
 if (select count(*) from supabase_migrations.schema_migrations) <> 112
  or (select name from supabase_migrations.schema_migrations order by version desc limit 1) <> 'own_upload_finalization_fenced_recovery' then
  problems := problems || 'ledger differs from the 17 September preflight (112 rows ending in own_upload_finalization_fenced_recovery)'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (
   ('private','grant_family_ancestry_purpose_v1'),('private','family_ancestry_recipient_v1'),('private','family_source_ancestry_grant_v1'),
   ('private','family_source_ancestry_authority_v1'),('private','family_ancestry_grant_presentation_v1'),('private','family_ancestry_input_view_v1'),
   ('private','family_shared_ancestry_results_v1'),('private','confirm_family_shared_ancestry_results_v1'),('public','family_ancestry_grant_presentation_v1'),
   ('public','grant_family_ancestry_purpose_v1'),('public','family_shared_ancestry_results_v1'),('public','confirm_family_shared_ancestry_results_v1'),
   ('private','clear_family_ancestry_snapshot_v1'))) then problems := problems || 'a function this migration creates already exists'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='family_ancestry_grant_snapshots') then
  problems := problems || 'private.family_ancestry_grant_snapshots already exists'; end if;
 if exists(select 1 from pg_trigger where tgname like 'clear_family_ancestry_snapshot%') then
  problems := problems || 'a clear_family_ancestry_snapshot trigger already exists'; end if;
 -- Prerequisite definitions must be byte-identical to the reviewed preflight.
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname,md5(pg_get_functiondef(p.oid))) in (
   ('private','family_report_endpoints_v1','70683c77cef0f00c9803414a394fbd64'),
   ('private','family_report_session_v1','ea133f42c429244bc25781d8329a9d69'),
   ('private','family_source_report_context_v1','7655c6adef89defc6e69325839a42940'),
   ('private','own_analysis_completion_matches_v1','21fc418c1566f7e70241780a6c5e8d49'),
   ('private','validate_own_ancestry_content_v1','15e0e9b7198fec45816812d36f4a3db9'),
   ('public','grant_directional_purpose_v1','a2578b450aecc8819e18702554b738ed'),
   ('public','revoke_directional_purpose_v1','4f27d161fa534eee20f4c099eef2e61e'),
   ('public','pause_family_sharing_v1','1d1dcfcec73f35c5f9fd94987c563306'),
   ('public','resume_family_sharing_v1','c4112cfaeff8dacd2c5a58e904f04716'),
   ('extensions','digest','95de9cf8798b911a1fe38c27bdb570de'),
   ('extensions','digest','85b88685f74a398b1ff164ad33eeaaca'))) <> 11 then
  problems := problems || 'a prerequisite function definition changed since the preflight'; end if;
 if (select array_agg(enumlabel::text order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace
   where n.nspname='public' and t.typname='genome_file_status') is distinct from array['uploading','uploaded','parsing','parsed','annotated','failed','stored'] then
  problems := problems || 'public.genome_file_status enum differs'; end if;
 if (select count(*) from pg_roles where rolname in ('anon','authenticated','inherit_upload_only','service_role')) <> 4 then
  problems := problems || 'a role named by the migration ACLs is missing'; end if;
 expected_events := 'embryo_forbidden_columns_guard:O,issue_graphql_placeholder:O,issue_pg_cron_access:O,issue_pg_graphql_access:O,issue_pg_net_access:O,pgrst_ddl_watch:O,pgrst_drop_watch:O';
 if (select string_agg(evtname||':'||evtenabled::text, ',' order by evtname) from pg_event_trigger) is distinct from expected_events then
  problems := problems || 'enabled event triggers differ from the preflight'; end if;
 if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('purpose_grants','directional_grants') and not t.tgisinternal) <> 8 then
  problems := problems || 'grant-table trigger inventory differs from the preflight (expected 8)'; end if;
 if not exists(select 1 from pg_constraint where conname='purpose_grants_pair_check' and condeferrable and condeferred)
  or not exists(select 1 from pg_constraint where conname='directional_grants_pair_check' and condeferrable and condeferred)
  or not exists(select 1 from pg_constraint where conname='normalization_source_completion') then
  problems := problems || 'a constraint the proof relies on is missing'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='genome_files' and column_name in
   ('single_logical_sample_verified_at','subject_id','tier','status','structural_validator_version','normalization_completed_at',
    'normalization_source_revision','upload_revision','build','sha256','source_sha256','storage_object_id','bucket_path','size_bytes',
    'input_provenance','input_source_sha256','processing_finished_at','file_type','user_id')) <> 19 then
  problems := problems || 'public.genome_files lacks a column the reader uses'; end if;
 if (select pg_get_userbyid(nspowner) from pg_namespace where nspname='private') <> 'postgres' then
  problems := problems || 'private schema owner is not postgres'; end if;
 if array_length(problems,1) > 0 then
  raise exception 'DDL guard failed: %', array_to_string(problems,'; '); end if;
end $guard$;
select jsonb_build_object('ddlGuard','passed','observedAt',clock_timestamp(),
 'ledgerCount',(select count(*) from supabase_migrations.schema_migrations),
 'ledgerHead',(select name from supabase_migrations.schema_migrations order by version desc limit 1)) as ddl_guard;
