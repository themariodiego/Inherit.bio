import { requireLocal } from "./self-host-local-contract";

/** Executed only over stdin to psql in the exact inspected local DB container. */
export function localConfigurationSql(versions: string[]): string {
  requireLocal(versions.length > 0 && versions.every(v => /^\d{14}$/.test(v))
    && new Set(versions).size === versions.length, "migration_names");
  const expected = JSON.stringify([...versions].sort());
  return `BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL search_path=pg_catalog;
DO $setup$
DECLARE actual jsonb;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres'
   OR current_setting('session_replication_role')<>'origin' THEN
  RAISE EXCEPTION 'local_setup_session'; END IF;
 LOCK TABLE auth.users,public.profiles,public.subjects,public.genome_files,
   public.upload_sessions,storage.objects IN SHARE MODE;
 LOCK TABLE private.upload_authorization_config IN ACCESS EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='private.upload_authorization_config'::regclass
   AND relkind='r' AND NOT relispartition)
  OR EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid='private.upload_authorization_config'::regclass
    OR inhparent='private.upload_authorization_config'::regclass)
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='private.upload_authorization_config'::regclass AND NOT tgisinternal)
  OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class='private.upload_authorization_config'::regclass)
 THEN RAISE EXCEPTION 'local_setup_schema'; END IF;
 SELECT jsonb_agg(version ORDER BY version) INTO actual FROM supabase_migrations.schema_migrations;
 IF actual IS DISTINCT FROM '${expected}'::jsonb THEN RAISE EXCEPTION 'local_setup_migrations'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.profiles)
  OR EXISTS(SELECT 1 FROM public.subjects) OR EXISTS(SELECT 1 FROM public.genome_files)
  OR EXISTS(SELECT 1 FROM public.upload_sessions) OR EXISTS(SELECT 1 FROM storage.objects)
  OR EXISTS(SELECT 1 FROM private.upload_authorization_config)
 THEN RAISE EXCEPTION 'local_setup_not_empty'; END IF;
 INSERT INTO private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,
  maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads,maximum_gvcf_bytes)
 VALUES(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32,52428800);
 SELECT jsonb_agg(to_jsonb(c)) INTO actual FROM private.upload_authorization_config c;
 IF actual IS DISTINCT FROM '[{"singleton":true,"auth_issuer":"http://127.0.0.1:54321/auth/v1",
  "maximum_array_bytes":52428800,"maximum_vcf_bytes":52428800,"maximum_account_bytes":1073741824,
  "maximum_active_uploads":32,"maximum_gvcf_bytes":52428800}]'::jsonb
 THEN RAISE EXCEPTION 'local_setup_postcondition'; END IF;
END;
$setup$;
COMMIT;
SELECT 'local_setup_committed';
`;
}
