-- The upload page proves its current account and auth session before the
-- server reads a bounded legal-signing stage. No nonce is issued or stored.
-- This uses the same recent authentication and MFA boundary as finalization.
create function public.embryo_upload_account_live_v1(
  p_account_id uuid,
  p_auth_session_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_account_id is null or p_auth_session_id is null then
    return false;
  end if;
  perform private.validate_sensitive_account_session_v1(p_account_id, p_auth_session_id);
  perform 1 from auth.users u
    where u.id = p_account_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    for share;
  if not found then return false; end if;
  perform 1 from public.profiles p
    where p.id = p_account_id and p.deletion_requested_at is null
    for share;
  return found;
exception when insufficient_privilege then
  -- The validator's expired, missing and insufficient-MFA refusals all have
  -- the same closed projection. No account or session detail crosses it.
  return false;
end $$;
revoke all on function public.embryo_upload_account_live_v1(uuid,uuid)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.embryo_upload_account_live_v1(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
