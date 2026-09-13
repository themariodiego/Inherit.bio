-- D-081 step 1: the adult-subject invitation gets the same rights-session
-- activation the co-parent invitation already has.
--
-- Today `activate_rights_session_v1` resolves exactly one thing —
-- `private.current_co_parent_invitation_v1` — and writes a hard-coded
-- `purpose = 'co-parent-invitation'` / `target_kind = 'cohort_draft'` row.
-- That is why the adult invitation still travels as a raw token in a URL
-- path: there is nothing for its token to activate. This migration adds the
-- resolver and the branch. It does not change how the adult token is mailed,
-- and it does not remove the token-hash responder: both wait for the later
-- steps, because a mailed token outlives the change that replaces it.
--
-- The resolver is a copy of the co-parent one in shape and in strictness,
-- over the adult chain that `create_adult_subject_invitation_v1` builds:
--   token_hashes -> token_candidates -> subject_invitations
--     -> invitation_candidates -> draft_participant_slots
--     -> subject_principals -> encrypted_contact_references
--     -> adult_subject_drafts
-- with every revision on that chain required to agree. A matching principal
-- and draft do not authorize a replacement invitation.

create or replace function private.current_adult_subject_invitation_v1(
  p_token_hash_id uuid,
  p_session_id uuid default null
)
returns public.subject_invitations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_invitation public.subject_invitations%rowtype;
begin
  select si.* into v_invitation
  from public.token_hashes th
  join public.token_candidates tc on tc.id = th.candidate_id
  join public.subject_invitations si on si.id = tc.target_id
  join public.invitation_candidates ic on ic.invitation_id = si.id
  join public.draft_participant_slots s on s.id = ic.draft_slot_id
  join public.subject_principals sp on sp.id = si.invitee_principal_id
  join public.encrypted_contact_references ecr on ecr.id = ic.contact_reference_id
  join public.adult_subject_drafts d on d.subject_id = si.target_id
  where th.id = p_token_hash_id
    -- Before activation the token is the live one; afterwards the session
    -- carries the authority and the token is spent.
    and th.status = case when p_session_id is null then 'current' else 'consumed' end
    and th.token_revision = tc.token_revision
    and tc.purpose = 'adult-subject-invitation'
    and tc.target_kind = 'subject_invitation'
    and tc.state = 'issued' and tc.expires_at > v_now
    and si.token_hash = th.token_hash
    and si.invitation_kind = 'adult_subject' and si.target_kind = 'subject'
    and si.status = 'pending' and si.expires_at > v_now
    and ic.state = 'issued' and ic.candidate_revision = si.invitation_revision
    and s.adult_draft_id = d.id and s.principal_id = sp.id
    and s.slot_kind = 'adult_subject' and s.state = 'pending'
    and sp.subject_id = si.target_id
    and sp.principal_kind = 'non_account_subject' and sp.status = 'pending'
    and ecr.principal_id = sp.id and ecr.status = 'current'
    and ecr.contact_ciphertext is not null
    and ecr.contact_hmac = si.email_hmac
    and ecr.authority_revision = sp.principal_revision
    and d.state = 'invited'
    and d.fixed_expires_at > v_now
    and (p_session_id is null or exists (
      select 1 from public.rights_sessions rs
      where rs.id = p_session_id and rs.token_hash_id = th.id
        and rs.purpose = 'adult-subject-invitation'
        and rs.target_kind = 'subject' and rs.target_id = si.target_id
        and rs.principal_id = sp.id
        and rs.authority_revision = si.invitation_revision
        and rs.status = 'active' and rs.expires_at > v_now
    ))
    and not exists (
      select 1 from public.contact_refusal_bars b
      where b.contact_hmac = si.email_hmac and b.expires_at > v_now
    )
    and not exists (
      select 1 from public.invitation_refusal_hmacs b
      where b.email_hmac = si.email_hmac and b.expires_at > v_now
    )
  for update of th, tc, si, ic, s, sp, ecr, d;
  return v_invitation;
end;
$$;

revoke all on function private.current_adult_subject_invitation_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Same authority and operation body as before; the token's own candidate
-- purpose chooses the branch, so neither invitation kind can be activated
-- through the other's checks.
create or replace function public.activate_rights_session_v1(
  p_token_hash text,
  p_session_hash text,
  p_form_nonce text
)
returns table (
  purpose text,
  target_kind text,
  target_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_purpose text;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_adult_draft public.adult_subject_drafts%rowtype;
  v_expires_at timestamptz;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if p_token_hash is null or p_session_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  -- The activation form's one-time nonce is recorded before any read, so a
  -- replayed form fails closed even when its token is still current.
  perform private.consume_embryo_operation_nonce_v1(
    p_form_nonce, null, null, 'rights_activate', 'form', null
  );

  select th.* into v_token
  from public.token_hashes th
  where th.token_hash = p_token_hash and th.status = 'current'
  for update;
  if v_token.id is null then return; end if;

  select tc.purpose into v_purpose
  from public.token_candidates tc
  where tc.id = v_token.candidate_id;

  if v_purpose = 'adult-subject-invitation' then
    v_invitation := private.current_adult_subject_invitation_v1(v_token.id);
    if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

    select d.* into v_adult_draft
    from public.adult_subject_drafts d
    where d.subject_id = v_invitation.target_id
      and d.state = 'invited'
      and d.fixed_expires_at > v_now
    for update;
    if v_adult_draft.id is null then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_invitation.invitee_principal_id, 'adult-subject-invitation',
      'subject', v_invitation.target_id, v_invitation.invitation_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-subject-invitation')
    );

    return query select
      'adult-subject-invitation'::text, 'subject'::text,
      v_invitation.target_id, v_expires_at;
    return;
  end if;

  if v_purpose is distinct from 'co-parent-invitation' then return; end if;

  v_invitation := private.current_co_parent_invitation_v1(v_token.id);
  if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return; end if;

  v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

  insert into public.rights_sessions (
    token_hash_id, principal_id, purpose, target_kind, target_id,
    authority_revision, session_hash, status, expires_at
  ) values (
    v_token.id, v_invitation.invitee_principal_id, 'co-parent-invitation',
    'cohort_draft', v_draft.id, v_invitation.invitation_revision,
    p_session_hash, 'active', v_expires_at
  );

  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id;

  perform private.append_legal_audit_event(
    'rights.session.activated', null, 'api.rights-activate', 'accepted',
    jsonb_build_object('purpose', 'co-parent-invitation')
  );

  return query select
    'co-parent-invitation'::text, 'cohort_draft'::text, v_draft.id, v_expires_at;
end;
$$;

revoke all on function public.activate_rights_session_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.activate_rights_session_v1(text, text, text)
  to service_role;
