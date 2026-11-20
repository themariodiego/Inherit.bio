-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It adds objects only; nothing existing is altered, so it
-- can be applied and removed without touching any other object. The routes
-- that call it refuse every state-changing request until it is applied.
-- =====================================================================
--
-- The one-time X-Inherit-CSRF token (mutationSecurityBindings.csrfTransport,
-- authContracts.authenticated-mutation-v1.csrf, token-api-v1.stateChangingRequest;
-- owner decision 2026-10-23, "CSRF: build the token everywhere").
--
-- A page renders the token as a keyed digest of the session it is bound to,
-- the registered route, an expiry and 32 random bytes
-- (src/lib/security/session-csrf-core.ts). Nothing stores it when it is
-- rendered (brief X1.5 applies to the paired operation nonces; this keeps the
-- same rule). The route verifies the digest against the live request and
-- then calls public.consume_session_csrf_v1, which spends the token's SHA-256
-- once, here, for at most the token's twelve-hour lifetime:
--
--   1. private.session_csrf_token_uses holds the spent hash, the route and
--      the expiry, and nothing else: no account, session, cookie or address.
--      A token that verifies is a random value bound to one session; its hash
--      identifies nobody.
--   2. For a token bound to an authenticated session, the account's
--      auth.sessions row must still be live and its user not deleted, so a
--      token outlives neither sign-out nor a revoked session.
--   3. A second presentation of the same token, on any route, returns false.
--      So does a token whose expiry is past or further away than its
--      lifetime allows. Expired hashes are removed on every call.
--
-- An operation nonce is separate (operationNonceIsNotCsrf): every route that
-- requires one goes on recording it through its own door.
--
-- Service-role only. The table is closed to every role; the definer body
-- repeats the service-role check.

do $predecessor$
begin
 if to_regclass('private.session_csrf_token_uses') is not null
  or to_regprocedure('public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)') is not null then
  raise exception using errcode='55000',message='session csrf successor already exists'; end if;
 if to_regclass('auth.sessions') is null or to_regclass('auth.users') is null then
  raise exception using errcode='55000',message='session csrf prerequisite missing'; end if;
end;
$predecessor$;

create table private.session_csrf_token_uses (
 token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
 route_id text not null check (route_id ~ '^(api|auth)\.[a-z0-9-]{2,80}$'),
 expires_at timestamptz not null
);
create index session_csrf_token_uses_expiry_idx on private.session_csrf_token_uses (expires_at);
alter table private.session_csrf_token_uses enable row level security;
revoke all on private.session_csrf_token_uses from public, anon, authenticated, service_role, inherit_upload_only;

create function public.consume_session_csrf_v1(
 p_route_id text,
 p_session_kind text,
 p_token_hash text,
 p_expires_at timestamptz,
 p_account_id uuid default null,
 p_session_id uuid default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_spent integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_route_id is null or p_route_id!~'^(api|auth)\.[a-z0-9-]{2,80}$'
  or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_kind is null or p_session_kind not in ('authenticated','token','token-candidate')
  or (p_session_kind='authenticated') is distinct from (p_account_id is not null and p_session_id is not null)
  or (p_session_kind<>'authenticated' and (p_account_id is not null or p_session_id is not null)) then
  raise exception using errcode='22023',message='session csrf request invalid'; end if;
 if p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '12 hours' then return false; end if;
 if p_session_kind='authenticated' and not exists(
  select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session_id and s.user_id=p_account_id and u.deleted_at is null
   and (s.not_after is null or s.not_after>v_now)) then
  return false;
 end if;
 delete from private.session_csrf_token_uses where expires_at<=v_now;
 insert into private.session_csrf_token_uses(token_hash,route_id,expires_at)
 values(p_token_hash,p_route_id,p_expires_at)
 on conflict(token_hash) do nothing;
 get diagnostics v_spent=row_count;
 return v_spent=1;
end $$;
revoke all on function public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid) to service_role;
