-- D-085: the register's `embryo-closed-schema-v1` requires "exactly one
-- pseudonymized legal audit event for the whole blocked attempt, with a
-- server-coded registered consumer and shape reference, and never key names,
-- values, target IDs or payload fragments". `blockedResponse` wrote a log
-- line and nothing else, because no route-callable audit RPC existed.
--
-- This is that RPC. It takes no principal, no target and no payload: the
-- ONLY caller-supplied value is the consumer id, and anything that is not a
-- registered-shaped id becomes 'unregistered' here as well as in the route,
-- so a payload fragment cannot reach the ledger even if a caller passes one.
-- The shape reference is a constant written by the database.

create or replace function public.record_blocked_embryo_response_v1(p_consumer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumer text;
begin
  -- The same shape the route enforces (`OPERATION_ID_PATTERN` in
  -- src/lib/embryos/api.ts), narrowed to what `route_id` accepts. A value
  -- outside it is not rejected — the blocked attempt still has to be
  -- recorded — it is replaced.
  v_consumer := case
    when p_consumer ~ '^[a-z][a-z0-9.-]{2,63}$' then p_consumer
    else 'unregistered'
  end;

  perform private.append_legal_audit_event(
    'embryo.response.blocked',
    null,
    v_consumer,
    'unsafe_response_blocked',
    jsonb_build_object('shape_reference', 'embryo-closed-schema-v1')
  );
end;
$$;

revoke all on function public.record_blocked_embryo_response_v1(text)
  from public, anon, authenticated;
grant execute on function public.record_blocked_embryo_response_v1(text)
  to service_role;
