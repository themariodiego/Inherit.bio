-- Public doors for the two chunk-transport transactions.
--
-- PostgREST exposes only `public` and `graphql_public` (supabase/config.toml),
-- and nothing overrides `pgrst.db_schemas` on the `authenticator` role, so a
-- route cannot reach a `private` function however it is granted. These two are
-- granted to service_role and still unreachable; this is what makes them
-- callable, and nothing more.
--
-- `security invoker`, deliberately, as in
-- 20260921130000_embryo_cohort_finalize_public_door.sql: a definer wrapper
-- would carry the owner's privilege, so any role holding execute on the door
-- would reach the private transaction as `postgres`. Invoker means the revoke
-- below is not the only barrier - the inner EXECUTE check is the real one, and
-- `authenticated` holds USAGE on `private` (verified against the deployed
-- catalogue, 21 September 2026), so a grant made by mistake fails at the
-- function rather than resolving into the schema.
--
-- Verified read-only against the deployed catalogue before writing, both
-- functions: prosecdef = true, proconfig = {search_path=""}, owner postgres,
-- service_role EXECUTE true, anon and authenticated EXECUTE false, and no
-- public wrapper of either name already present.
--
-- The write path, so a later reading does not add a grant that is absent on
-- purpose:
--   public already          authorize_embryo_ingest_request_v1,
--                           prepare_embryo_ingest_unwind_v1
--   private + service_role  create_embryo_ingest_session_v1,
--                           reserve_embryo_ingest_chunk_v1,
--                           commit_embryo_ingest_chunk_v1,
--                           mark_embryo_ingest_failure_v1,
--                           consume_embryo_operation_nonce_v1
--   private, NO grant       freeze_embryo_ingest_session_v1,
--                           bind_embryo_fragment_object_v1
--                           - internal helpers; the missing grant is the
--                             design saying so. Do not add one.

create function public.reserve_embryo_ingest_chunk_v1(
  p_session_id uuid, p_sequence integer, p_sha256 text, p_byte_count integer,
  p_record_count integer, p_maximum_line_bytes integer, p_fragments jsonb
) returns jsonb language sql security invoker
set search_path = ''
as $$
  select private.reserve_embryo_ingest_chunk_v1(
    p_session_id, p_sequence, p_sha256, p_byte_count,
    p_record_count, p_maximum_line_bytes, p_fragments);
$$;
revoke all on function public.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_embryo_ingest_chunk_v1(uuid,integer,text,integer,integer,integer,jsonb)
  to service_role;

create function public.commit_embryo_ingest_chunk_v1(
  p_session_id uuid, p_sequence integer, p_sha256 text
) returns jsonb language sql security invoker
set search_path = ''
as $$
  select private.commit_embryo_ingest_chunk_v1(p_session_id, p_sequence, p_sha256);
$$;
revoke all on function public.commit_embryo_ingest_chunk_v1(uuid,integer,text)
  from public, anon, authenticated;
grant execute on function public.commit_embryo_ingest_chunk_v1(uuid,integer,text)
  to service_role;
