-- Brief X1.5 (owner decision 2026-09-28, evening): operation nonces are
-- rendered, never fetched. /settings/data renders a stateless nonce for
-- account deletion or its cancellation; only the POST consumes it, recording
-- its hash once in the same transaction as the operation. No GET creates,
-- rotates or stores one.
--
-- This half only adds. The v2 functions record the verified nonce and hand
-- it straight to the unchanged v1 body in one transaction:
--
--   - The route has already checked the nonce's MAC against the live account,
--     session and operation, and its expiry; the database checks the expiry
--     bound again and refuses a hash it has seen, so a replay inside the
--     nonce's lifetime fails as invalid_operation_nonce.
--   - A failed operation rolls back its own record, so a nonce is spent only
--     by an operation that happened, exactly as before.
--   - A spent hash is kept until its nonce would have expired, and pruned by
--     a later call; account purge still removes every row for the account.
--
-- 20260930140300 retires the old path. Apply this one before the code that
-- calls v2 deploys, and that one after it, so account deletion never points
-- at a function that is not there.

create function private.record_account_operation_nonce_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_operation text,
  p_nonce_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  if p_operation not in ('account_delete', 'account_delete_cancel')
    or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  delete from public.account_operation_nonces
  where operation in ('account_delete', 'account_delete_cancel')
    and expires_at <= clock_timestamp();

  insert into public.account_operation_nonces (
    nonce_hash, account_id, session_id, operation, expires_at
  ) values (
    p_nonce_hash, p_account_id, p_session_id, p_operation, p_expires_at
  ) on conflict (nonce_hash) do nothing;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;
end;
$$;

revoke all on function private.record_account_operation_nonce_v1(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create function public.request_account_deletion_v2(
  p_account_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_nonce_expires_at timestamptz,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_notice_idempotency_key text
)
returns table (deletion_id uuid, status text, notice_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_account_operation_nonce_v1(
    p_account_id, p_session_id, 'account_delete', p_nonce_hash, p_nonce_expires_at);
  return query select * from public.request_account_deletion_v1(
    p_account_id, p_session_id, p_nonce_hash, p_contact_ciphertext, p_contact_hmac,
    p_notice_idempotency_key);
end;
$$;

create function public.cancel_account_deletion_v2(
  p_account_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_nonce_expires_at timestamptz,
  p_notice_idempotency_key text
)
returns table (status text, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_account_operation_nonce_v1(
    p_account_id, p_session_id, 'account_delete_cancel', p_nonce_hash, p_nonce_expires_at);
  return query select * from public.cancel_account_deletion_v1(
    p_account_id, p_session_id, p_nonce_hash, p_notice_idempotency_key);
end;
$$;

revoke all on function public.request_account_deletion_v2(uuid, uuid, text, timestamptz, bytea, text, text)
  from public, anon, authenticated;
grant execute on function public.request_account_deletion_v2(uuid, uuid, text, timestamptz, bytea, text, text)
  to service_role;
revoke all on function public.cancel_account_deletion_v2(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.cancel_account_deletion_v2(uuid, uuid, text, timestamptz, text)
  to service_role;

notify pgrst, 'reload schema';
