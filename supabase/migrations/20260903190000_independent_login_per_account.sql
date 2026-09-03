-- The independent-login marker, corrected to an account-wide rule (D-028).
--
-- The first version excluded only subjects that an accepted invitation
-- targeted. The Portrait guard in grant_directional_purpose_v1 reads the
-- data subject's own marker, and that subject is the account's `self`
-- record, which no invitation targets; so the session an invitation was
-- accepted in stamped the self record on its first server-verified request
-- and the lock never engaged. The rule is now per account: a session that
-- predates any adult-subject invitation this account accepted stamps
-- nothing, for any of the account's subjects.

create or replace function public.mark_independent_login_v1(
  p_account_id uuid,
  p_auth_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session auth.sessions%rowtype;
  v_count integer := 0;
begin
  select s.* into v_session
  from auth.sessions s
  where s.id = p_auth_session_id and s.user_id = p_account_id;
  if v_session.id is null
    or (v_session.not_after is not null and v_session.not_after <= clock_timestamp()) then
    raise exception using errcode = '42501', message = 'auth session is unavailable';
  end if;

  -- The session an invitation was accepted in, or any session opened before
  -- that acceptance, proves nothing about who holds the account.
  if exists (
    select 1
    from public.subject_invitations si
    left join public.subject_principals ip on ip.id = si.invitee_principal_id
    left join public.subjects t on t.id = si.target_id
    where si.invitation_kind = 'adult_subject'
      and si.status = 'accepted'
      and si.accepted_at >= v_session.created_at
      and (ip.account_id = p_account_id or t.subject_account_id = p_account_id)
  ) then
    return 0;
  end if;

  update public.subjects s
  set independent_login_at = clock_timestamp()
  where s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle in ('active', 'claimed_bound')
    and s.independent_login_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_independent_login_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_independent_login_v1(uuid, uuid) to service_role;
