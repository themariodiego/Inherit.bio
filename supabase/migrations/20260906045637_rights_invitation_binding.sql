-- Bind rights actions to the exact invitation that issued the token.
-- A matching principal/draft pair does not authorize a replacement invitation.
create or replace function private.current_co_parent_invitation_v1(
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
  join public.embryo_cohort_drafts d on d.id = si.target_id
  where th.id = p_token_hash_id
    and th.status = case when p_session_id is null then 'current' else 'consumed' end
    and th.token_revision = tc.token_revision
    and tc.purpose = 'co-parent-invitation'
    and tc.target_kind = 'subject_invitation'
    and tc.state = 'issued' and tc.expires_at > v_now
    and si.token_hash = th.token_hash
    and si.invitation_kind = 'co_parent' and si.target_kind = 'cohort_draft'
    and si.status = 'pending' and si.expires_at > v_now
    and ic.state = 'issued' and ic.candidate_revision = si.invitation_revision
    and s.embryo_draft_id = d.id and s.principal_id = sp.id
    and s.slot_kind in ('parent_a', 'parent_b') and s.state = 'pending'
    and sp.principal_kind = 'genetic_parent' and sp.status = 'pending'
    and ecr.principal_id = sp.id and ecr.status = 'current'
    and ecr.contact_ciphertext is not null
    and ecr.contact_hmac = si.email_hmac
    and ecr.authority_revision = sp.principal_revision
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
    and (p_session_id is null or exists (
      select 1 from public.rights_sessions rs
      where rs.id = p_session_id and rs.token_hash_id = th.id
        and rs.purpose = 'co-parent-invitation'
        and rs.target_kind = 'cohort_draft' and rs.target_id = d.id
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

revoke all on function private.current_co_parent_invitation_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

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
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_expires_at timestamptz;
begin
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

  v_invitation := private.current_co_parent_invitation_v1(v_token.id);
  if v_invitation.id is null then return; end if;

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

-- api.invitation-accept (co_parent): bind the accepting account to the exact
-- parent slot and record its two Tier-2 signatures. The account must control
-- the invited address; Inherit does not claim this verifies parentage.
create or replace function public.accept_embryo_co_parent_invitation_v1(
  p_session_hash text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_upload_statement_keys text[],
  p_parentage_statement_keys text[],
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.rights_sessions%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_slot public.draft_participant_slots%rowtype;
  v_principal public.subject_principals%rowtype;
  v_profile public.profiles%rowtype;
  v_upload public.consent_artifacts%rowtype;
  v_parentage public.consent_artifacts%rowtype;
  v_signature_id uuid;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'rights session unavailable';
  end if;

  select rs.* into v_session
  from public.rights_sessions rs
  where rs.session_hash = p_session_hash
    and rs.purpose = 'co-parent-invitation'
    and rs.status = 'active'
    and rs.expires_at > v_now
  for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'rights session unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, null, 'invitation_accept',
    'rights_session', v_session.id
  );

  v_invitation := private.current_co_parent_invitation_v1(
    v_session.token_hash_id, v_session.id
  );
  if v_invitation.id is null then
    raise exception using errcode = '42501', message = 'invitation unavailable';
  end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null or v_draft.owner_account_id = p_account_id then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  select s.* into v_slot
  from public.draft_participant_slots s
  where s.embryo_draft_id = v_draft.id
    and s.principal_id = v_session.principal_id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'pending'
  for update;
  if v_slot.id is null then
    raise exception using errcode = '42501', message = 'slot unavailable';
  end if;

  select sp.* into v_principal
  from public.subject_principals sp
  where sp.id = v_session.principal_id
    and sp.principal_kind = 'genetic_parent'
    and sp.status = 'pending'
  for update;
  if v_principal.id is null then
    raise exception using errcode = '42501', message = 'principal unavailable';
  end if;

  if p_account_email_hmac is null
    or p_account_email_hmac <> v_invitation.email_hmac
  then
    raise exception using errcode = '42501', message = 'address does not match';
  end if;

  if not exists (
    select 1
    from public.subject_principals sp
    join public.subjects s on s.id = sp.subject_id
    where sp.account_id = p_account_id
      and sp.principal_kind = 'account_subject'
      and sp.status = 'active'
      and s.subject_class = 'self'
      and s.lifecycle = 'active'
  ) or exists (
    select 1 from public.account_deletion_requests adr
    where adr.account_id = p_account_id
      and adr.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;

  if p_signing_name_ciphertext is null
    or p_jurisdiction_code !~ '^[A-Z]{2}$'
    or p_upload_statement_keys is distinct from
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent')
    or p_parentage_statement_keys is distinct from
      private.embryo_statement_keys_v1('attestation.embryo-parentage')
  then
    raise exception using errcode = '22023', message = 'invalid acceptance';
  end if;

  v_upload := private.current_embryo_artifact_v1('consent.upload-embryo', null);
  v_parentage := private.current_embryo_artifact_v1('attestation.embryo-parentage', null);
  select * into v_profile from public.profiles where id = p_account_id;

  update public.subject_principals
  set account_id = p_account_id,
      status = 'active',
      principal_revision = principal_revision + 1
  where id = v_principal.id
  returning * into v_principal;

  update public.encrypted_contact_references
  set authority_revision = v_principal.principal_revision
  where principal_id = v_principal.id and status = 'current';

  update public.draft_participant_slots
  set state = 'current', slot_revision = slot_revision + 1
  where id = v_slot.id;

  update public.subject_invitations
  set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
      email_encrypted = null
  where id = v_invitation.id;

  update public.invitation_candidates
  set state = 'accepted'
  where invitation_id = v_invitation.id;

  update public.rights_sessions
  set status = 'consumed', ended_at = v_now
  where id = v_session.id;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_upload.artifact_key, v_upload.version, v_upload.body_sha256,
    v_principal.id, p_account_id, 'cohort_draft', v_draft.id,
    'embryo-upload-parent-class', p_upload_statement_keys,
    p_signing_name_ciphertext, p_jurisdiction_code,
    coalesce(v_profile.jurisdiction_revision, 1)
  );

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_parentage.artifact_key, v_parentage.version, v_parentage.body_sha256,
    v_principal.id, p_account_id, 'cohort_draft', v_draft.id,
    'embryo-parentage-attestation', p_parentage_statement_keys,
    p_signing_name_ciphertext, p_jurisdiction_code,
    coalesce(v_profile.jurisdiction_revision, 1)
  ) returning id into v_signature_id;

  insert into public.attestations (
    signature_id, principal_id, target_kind, target_id, kind,
    statement_keys, affirmed
  ) values (
    v_signature_id, v_principal.id, 'cohort_draft', v_draft.id,
    'genetic_parent', p_parentage_statement_keys, true
  );

  perform private.append_legal_audit_event(
    'invitation.accepted', null, 'api.invitation-accept', 'accepted',
    jsonb_build_object('invitation_kind', 'co_parent')
  );

  return v_draft.id;
end;
$$;

revoke all on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) from public, anon, authenticated;
grant execute on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) to service_role;
