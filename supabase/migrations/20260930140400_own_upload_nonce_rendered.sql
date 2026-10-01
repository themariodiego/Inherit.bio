-- Brief X1.5 for the own-upload page: the page renders its consent and
-- account-completion presentation tokens and stores nothing; only the POST
-- records the token's nonce hash, once, in the same transaction as the
-- signature or the completion.
--
-- Until now prepareOwnUpload stored each nonce hash through
-- issue_own_upload_nonce_v1 while /files or /files/upload rendered, so every
-- render wrote a row. The tokens themselves were already signed, stateless
-- and bound to the account, session, subject and revisions; the routes verify
-- that signature before any database call.
--
-- This half only adds. The v2 bodies record the nonce and hand it straight to
-- the unchanged v1 body in one transaction:
--
--   - The recorder checks the expiry bound (at most ten minutes, the same
--     ceiling issue_own_upload_nonce_v1 enforced) and refuses a hash it has
--     seen, so a replay inside the token's lifetime fails as not_found, the
--     answer v1 already gave for a spent nonce.
--   - The v1 body then rechecks the live account, session, subject,
--     revisions and birth-date state exactly as before, and consumes the row.
--   - A failed operation rolls back its own record, so a nonce is spent only
--     by an operation that happened.
--
-- 20260930140500 retires the stored path. Apply this one before the code that
-- calls v2 deploys, and that one after it.

create function private.record_own_upload_nonce_v1(
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
  if p_operation is null or p_operation not in ('own_upload_artifact_sign', 'own_account_completion')
    or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes'
  then
    raise exception using errcode = '42501', message = 'not_found';
  end if;

  delete from public.account_operation_nonces
  where account_id = p_account_id
    and operation in ('own_upload_artifact_sign', 'own_account_completion')
    and expires_at <= clock_timestamp();

  insert into public.account_operation_nonces (
    nonce_hash, account_id, session_id, operation, expires_at
  ) values (
    p_nonce_hash, p_account_id, p_session_id, p_operation, p_expires_at
  ) on conflict (nonce_hash) do nothing;
  if not found then
    raise exception using errcode = '42501', message = 'not_found';
  end if;
end;
$$;

revoke all on function private.record_own_upload_nonce_v1(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create function private.sign_own_upload_artifact_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_artifact_key text, p_artifact_version integer, p_artifact_body_sha256 text,
  p_statement_keys text[], p_account_revision bigint, p_auth_session_revision bigint,
  p_jurisdiction_revision bigint, p_subject_binding_revision bigint, p_account_binding_revision bigint,
  p_nonce_hash text, p_nonce_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_own_upload_nonce_v1(
    p_account_id, p_session_id, 'own_upload_artifact_sign', p_nonce_hash, p_nonce_expires_at);
  return private.sign_own_upload_artifact_v1(p_account_id, p_session_id, p_subject_id,
    p_artifact_key, p_artifact_version, p_artifact_body_sha256, p_statement_keys, p_account_revision,
    p_auth_session_revision, p_jurisdiction_revision, p_subject_binding_revision,
    p_account_binding_revision, p_nonce_hash);
end;
$$;

create function private.complete_own_upload_account_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_account_revision bigint, p_auth_session_revision bigint, p_jurisdiction_revision bigint,
  p_subject_binding_revision bigint, p_account_binding_revision bigint, p_date_of_birth date,
  p_nonce_hash text, p_nonce_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_own_upload_nonce_v1(
    p_account_id, p_session_id, 'own_account_completion', p_nonce_hash, p_nonce_expires_at);
  return private.complete_own_upload_account_v1(p_account_id, p_session_id, p_subject_id,
    p_account_revision, p_auth_session_revision, p_jurisdiction_revision, p_subject_binding_revision,
    p_account_binding_revision, p_date_of_birth, p_nonce_hash);
end;
$$;

-- Invoker doors: the inner EXECUTE check is the real barrier, and only
-- service_role holds it.
create function public.sign_own_upload_artifact_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_artifact_key text, p_artifact_version integer, p_artifact_body_sha256 text,
  p_statement_keys text[], p_account_revision bigint, p_auth_session_revision bigint,
  p_jurisdiction_revision bigint, p_subject_binding_revision bigint, p_account_binding_revision bigint,
  p_nonce_hash text, p_nonce_expires_at timestamptz)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.sign_own_upload_artifact_v2(p_account_id, p_session_id, p_subject_id,
    p_artifact_key, p_artifact_version, p_artifact_body_sha256, p_statement_keys, p_account_revision,
    p_auth_session_revision, p_jurisdiction_revision, p_subject_binding_revision,
    p_account_binding_revision, p_nonce_hash, p_nonce_expires_at);
$$;

create function public.complete_own_upload_account_v2(p_account_id uuid, p_session_id uuid, p_subject_id uuid,
  p_account_revision bigint, p_auth_session_revision bigint, p_jurisdiction_revision bigint,
  p_subject_binding_revision bigint, p_account_binding_revision bigint, p_date_of_birth date,
  p_nonce_hash text, p_nonce_expires_at timestamptz)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.complete_own_upload_account_v2(p_account_id, p_session_id, p_subject_id,
    p_account_revision, p_auth_session_revision, p_jurisdiction_revision, p_subject_binding_revision,
    p_account_binding_revision, p_date_of_birth, p_nonce_hash, p_nonce_expires_at);
$$;

revoke all on function
  private.sign_own_upload_artifact_v2(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text, timestamptz),
  public.sign_own_upload_artifact_v2(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text, timestamptz),
  private.complete_own_upload_account_v2(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text, timestamptz),
  public.complete_own_upload_account_v2(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  private.sign_own_upload_artifact_v2(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text, timestamptz),
  public.sign_own_upload_artifact_v2(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text, timestamptz),
  private.complete_own_upload_account_v2(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text, timestamptz),
  public.complete_own_upload_account_v2(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
