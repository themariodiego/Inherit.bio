-- The three registered auth endpoints (G2.1; owner decision 2026-10-16,
-- "Auth endpoints: jurisdiction, date of birth, reset and limits"):
--
--   auth.sign-up-submit           POST /api/auth/sign-up
--   auth.forgot-password-submit   POST /api/auth/forgot-password
--   auth.reset-password-submit    POST /api/auth/reset-password
--
-- This migration adds only what the database must hold for them. Nothing
-- existing is altered, so it can be applied and removed without touching any
-- other object.
--
-- 1. One-time public form tokens. The sign-up and forgot-password pages are
--    served with a sealed form token bound to a host-only cookie. The route
--    checks the seal and the cookie; this table spends the token's nonce
--    once, by hash, for at most the token's ten-minute lifetime.
--
-- 2. The rate limits the owner set, counted in the existing
--    securityRateLimitContract buckets (public.rate_limit_hmac_buckets) by the
--    existing private.consume_rate_limit_buckets_v1, before anything else is
--    decided:
--      sign-up          5 an hour per normalized email, 20 an hour per network
--      forgot-password  3 an hour per email,            10 an hour per network
--    Only keyed digests reach the database. A limited request spends its
--    form nonce and returns 'limited'; the route answers it exactly like an
--    admitted one, so nothing can tell a limit from an identity.
--
-- 3. The reset session (authContracts.reset-session-api-v1). After the
--    callback has checked the PKCE state cookie and exchanged a recovery
--    code, it issues a 256-bit secret in a host-only, HttpOnly, SameSite=
--    Strict cookie. Only its SHA-256 is stored here, for 15 minutes, for one
--    use. Issuance requires the exchanged auth session to be this account's
--    own, fresh and minted by a recovery link, and then revokes that session,
--    whose tokens never left the server: the link grants no general access.
--
-- 4. The reset transaction (auth.reset-password-submit.policy.transaction).
--    In one transaction it stores the new password's bcrypt hash (computed by
--    the route; the plaintext never reaches the database), deletes every auth
--    session of the account (refresh tokens and AMR claims cascade), raises
--    profiles.auth_session_revision so every capability minted from an older
--    session fails its per-use recheck, and consumes the reset session.
--
-- Every function is service-role only. A public SQL wrapper is the only door
-- PostgREST can reach; the definer body repeats the service-role check.

create table private.auth_form_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  route_id text not null check (route_id in ('auth.sign-up-submit', 'auth.forgot-password-submit')),
  expires_at timestamptz not null
);
create index auth_form_nonces_expiry_idx on private.auth_form_nonces (expires_at);

create table private.auth_recovery_sessions (
  session_hash text primary key check (session_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null unique references auth.users (id) on delete cascade,
  origin_session_id uuid not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes')
);
create index auth_recovery_sessions_expiry_idx on private.auth_recovery_sessions (expires_at);

do $private$
declare table_name text;
begin
  foreach table_name in array array['auth_form_nonces', 'auth_recovery_sessions'] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role, inherit_upload_only', table_name);
  end loop;
end
$private$;

-- ---------------------------------------------------------------------------
-- Sign-up and forgot-password: count, then spend the form nonce.
create function private.admit_auth_public_request_v1(
  p_route_id text,
  p_form_nonce_hash text,
  p_identifier_digests jsonb,
  p_network_digests jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_identifier_limit integer;
  v_network_limit integer;
  v_identifiers jsonb;
  v_networks jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_pair record;
  v_allowed boolean;
  v_spent integer;
begin
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  if p_route_id is null or p_route_id not in ('auth.sign-up-submit', 'auth.forgot-password-submit')
    or p_form_nonce_hash is null or p_form_nonce_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'auth request invalid';
  end if;
  v_identifier_limit := case p_route_id when 'auth.sign-up-submit' then 5 else 3 end;
  v_network_limit := case p_route_id when 'auth.sign-up-submit' then 20 else 10 end;

  -- Buckets first, before the nonce or anything else is read
  -- (securityRateLimitContract.decisionOrder). Each digest set must cover
  -- every usable rate-limit revision; a missing one refuses with 55000.
  v_identifiers := private.resolve_hmac_set_v1('rate-limit', null, p_identifier_digests);
  v_networks := private.resolve_hmac_set_v1('rate-limit', null, p_network_digests);
  for v_pair in select e.key, e.value from jsonb_each_text(coalesce(v_identifiers, '{}'::jsonb)) e loop
    v_keys := v_keys || jsonb_build_object(v_pair.key, jsonb_build_object(
      'normalized-identifier', v_pair.value,
      'source-network', v_networks ->> v_pair.key));
  end loop;
  v_allowed := private.consume_rate_limit_buckets_v1(
    p_route_id,
    jsonb_build_array(
      jsonb_build_object('dimension', 'normalized-identifier', 'windowSeconds', 3600, 'limit', v_identifier_limit),
      jsonb_build_object('dimension', 'source-network', 'windowSeconds', 3600, 'limit', v_network_limit)),
    v_keys);

  -- The nonce is spent whether or not the request is within its limits, and
  -- stays spent until its token could no longer be fresh.
  delete from private.auth_form_nonces n where n.expires_at <= v_now;
  insert into private.auth_form_nonces (nonce_hash, route_id, expires_at)
  values (p_form_nonce_hash, p_route_id, v_now + interval '10 minutes')
  on conflict (nonce_hash) do nothing;
  get diagnostics v_spent = row_count;
  if v_spent = 0 then
    return 'replayed';
  end if;
  return case when v_allowed then 'admitted' else 'limited' end;
end;
$$;
revoke all on function private.admit_auth_public_request_v1(text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role, inherit_upload_only;
grant execute on function private.admit_auth_public_request_v1(text, text, jsonb, jsonb) to service_role;

create function public.admit_auth_public_request_v1(
  p_route_id text,
  p_form_nonce_hash text,
  p_identifier_digests jsonb,
  p_network_digests jsonb
)
returns text language sql security invoker set search_path = '' as $$
  select private.admit_auth_public_request_v1(
    p_route_id, p_form_nonce_hash, p_identifier_digests, p_network_digests);
$$;
revoke all on function public.admit_auth_public_request_v1(text, text, jsonb, jsonb)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.admit_auth_public_request_v1(text, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The callback: one reset session per account, from a fresh recovery session.
create function private.issue_auth_recovery_session_v1(
  p_session_hash text,
  p_account_id uuid,
  p_origin_session_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_account_id is null or p_origin_session_id is null
  then
    raise exception using errcode = '22023', message = 'auth recovery invalid';
  end if;
  perform 1 from auth.users u where u.id = p_account_id and u.deleted_at is null for update;
  if not found then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  -- The exchanged session is this account's own, minutes old, and was minted
  -- by a recovery link, not by a password, OAuth or sign-up confirmation.
  perform 1 from auth.sessions s
  where s.id = p_origin_session_id and s.user_id = p_account_id
    and (s.not_after is null or s.not_after > v_now)
    and s.created_at > v_now - interval '5 minutes'
    and exists (
      select 1 from auth.mfa_amr_claims c
      where c.session_id = s.id and c.authentication_method = 'recovery')
  for update of s;
  if not found then
    raise exception using errcode = '42501', message = 'not_found';
  end if;

  -- A newer link replaces an older one; expired sessions go with it.
  delete from private.auth_recovery_sessions r
  where r.account_id = p_account_id or r.expires_at <= v_now;
  insert into private.auth_recovery_sessions (session_hash, account_id, origin_session_id, issued_at, expires_at)
  values (p_session_hash, p_account_id, p_origin_session_id, v_now, v_now + interval '15 minutes');
  -- Its tokens never left the server. Revoking it now means a recovery link
  -- can only ever change the password, never sign anyone in.
  delete from auth.sessions s where s.id = p_origin_session_id;
  return 'issued';
end;
$$;
revoke all on function private.issue_auth_recovery_session_v1(text, uuid, uuid)
  from public, anon, authenticated, service_role, inherit_upload_only;
grant execute on function private.issue_auth_recovery_session_v1(text, uuid, uuid) to service_role;

create function public.issue_auth_recovery_session_v1(
  p_session_hash text,
  p_account_id uuid,
  p_origin_session_id uuid
)
returns text language sql security invoker set search_path = '' as $$
  select private.issue_auth_recovery_session_v1(p_session_hash, p_account_id, p_origin_session_id);
$$;
revoke all on function public.issue_auth_recovery_session_v1(text, uuid, uuid)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.issue_auth_recovery_session_v1(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The reset: new password, every session revoked, the reset session spent.
create function private.reset_password_with_recovery_v1(
  p_session_hash text,
  p_password_hash text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_account uuid;
begin
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or p_password_hash is null or p_password_hash !~ '^\$2[aby]\$1[0-4]\$[./A-Za-z0-9]{53}$'
  then
    raise exception using errcode = '22023', message = 'auth reset invalid';
  end if;
  select r.account_id into v_account
  from private.auth_recovery_sessions r
  where r.session_hash = p_session_hash and r.expires_at > v_now
  for update;
  if v_account is null then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  perform 1 from auth.users u where u.id = v_account and u.deleted_at is null for update;
  if not found then
    raise exception using errcode = '42501', message = 'not_found';
  end if;

  update auth.users set encrypted_password = p_password_hash, updated_at = v_now where id = v_account;
  -- Every session, the recovery origin included; refresh tokens and AMR
  -- claims cascade. The revision makes every capability minted from any of
  -- them fail its next per-use recheck.
  delete from auth.sessions s where s.user_id = v_account;
  update public.profiles p set auth_session_revision = p.auth_session_revision + 1 where p.id = v_account;
  delete from private.auth_recovery_sessions r where r.account_id = v_account;
  return 'reset';
end;
$$;
revoke all on function private.reset_password_with_recovery_v1(text, text)
  from public, anon, authenticated, service_role, inherit_upload_only;
grant execute on function private.reset_password_with_recovery_v1(text, text) to service_role;

create function public.reset_password_with_recovery_v1(p_session_hash text, p_password_hash text)
returns text language sql security invoker set search_path = '' as $$
  select private.reset_password_with_recovery_v1(p_session_hash, p_password_hash);
$$;
revoke all on function public.reset_password_with_recovery_v1(text, text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.reset_password_with_recovery_v1(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- jobs.retention: spent form nonces after their token's lifetime, and reset
-- sessions after their 15 minutes, whether or not any request comes.
create function private.purge_expired_auth_credentials_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_nonces integer;
  v_sessions integer;
begin
  if auth.jwt() ->> 'role' is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
  delete from private.auth_form_nonces n where n.expires_at <= clock_timestamp();
  get diagnostics v_nonces = row_count;
  delete from private.auth_recovery_sessions r where r.expires_at <= clock_timestamp();
  get diagnostics v_sessions = row_count;
  return v_nonces + v_sessions;
end;
$$;
revoke all on function private.purge_expired_auth_credentials_v1()
  from public, anon, authenticated, service_role, inherit_upload_only;
grant execute on function private.purge_expired_auth_credentials_v1() to service_role;

create function public.purge_expired_auth_credentials_v1()
returns integer language sql security invoker set search_path = '' as $$
  select private.purge_expired_auth_credentials_v1();
$$;
revoke all on function public.purge_expired_auth_credentials_v1()
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.purge_expired_auth_credentials_v1() to service_role;
