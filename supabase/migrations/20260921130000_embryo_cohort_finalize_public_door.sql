-- The one transaction that finalizes an embryo cohort draft and mints its
-- ingest session lives in `private`, and its own comment says "The eventual
-- cohort-finalize route calls this one transaction". No route can: PostgREST
-- is configured for `public, graphql_public` (supabase/config.toml), the
-- hosted `authenticator` role carries no `pgrst.db_schemas` override,
-- `createAdminClient()` sets no `db.schema`, and nothing in `src/` calls
-- `.schema(...)`. Every one of the 27 RPCs the app tier calls today is
-- `public`. So `private.finalize_embryo_cohort_ingest_v1` has been
-- unreachable from the application since it was written, and the gap stayed
-- invisible because no route was ever written to hit it.
--
-- The gap is wider than this one function, and the shape of it matters to
-- whoever writes the remaining ingest routes. Read from the live catalogue on
-- 21 September 2026, the ingest write path divides in three:
--
--   * Reachable already: `public.authorize_embryo_ingest_request_v1` and
--     `public.prepare_embryo_ingest_unwind_v1`. Two, and no more.
--   * Private, but granted to `service_role`, so a door like this one works:
--     `create_embryo_ingest_session_v1` (through the wrapper below),
--     `reserve_embryo_ingest_chunk_v1`, `commit_embryo_ingest_chunk_v1`,
--     `mark_embryo_ingest_failure_v1` and `consume_embryo_operation_nonce_v1`.
--     The chunk route will need the reserve and commit pair.
--   * Private with NO `service_role` grant, so an invoker wrapper would fail
--     and one must not be written: `freeze_embryo_ingest_session_v1` and
--     `bind_embryo_fragment_object_v1`. These are internal helpers other
--     database functions call, and the missing grant is the design saying so.
--     The completion route therefore does not reach freezing directly, and
--     whoever builds it should establish how it is meant to — not add a grant.
--
-- This is the door, and deliberately nothing else. It adds no check, no
-- branch and no state: every authority decision — the jurisdiction guard, the
-- draft lock, the basis-authority case, the acknowledgements, the nonce —
-- stays in the private body, so this wrapper cannot drift away from it or be
-- mistaken for a second place where authority is decided.
--
-- It is `security invoker`, unlike the `security definer` functions around
-- it, because it needs no privilege of its own. `security definer` here would
-- let any role holding execute on this wrapper reach the private transaction
-- as its owner; invoker means the inner call is still checked against the
-- caller, and only `service_role` holds execute on the private function. The
-- revoke below is therefore the second of two independent barriers rather
-- than the only one.
create function public.finalize_embryo_cohort_ingest_v1(
  p_account_id uuid, p_auth_session_id uuid, p_draft_id uuid, p_insurance_ack_id uuid,
  p_charter_ack_id uuid, p_token_nonce text, p_origin text, p_test_jurisdiction boolean default false
) returns jsonb language sql security invoker
set search_path = ''
as $$
  select private.finalize_embryo_cohort_ingest_v1(
    p_account_id, p_auth_session_id, p_draft_id, p_insurance_ack_id,
    p_charter_ack_id, p_token_nonce, p_origin, p_test_jurisdiction);
$$;

revoke all on function public.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)
  to service_role;
