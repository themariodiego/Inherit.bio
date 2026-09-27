-- Deleting a pending adult reservation is not an invitation refusal.
-- Preserve the complete shared response transaction and both entry points;
-- only explicit refuse creates or refreshes the two global refusal stores.
-- Existing bars are never cleared, shortened or extended by delete.

create or replace function private.adult_subject_invitation_response_v1(
  p_token_hash_id uuid,
  p_session_id uuid,
  p_action text,
  p_account_id uuid,
  p_account_email_hmac text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.adult_subject_drafts%rowtype;
  v_principal public.subject_principals%rowtype;
  v_account_principal public.subject_principals%rowtype;
  v_profile public.profiles%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_signature_id uuid;
  v_contact_id uuid;
  v_terminal_status text;
begin
  if p_action not in ('confirm', 'refuse', 'delete') then return 'unavailable'; end if;

  select th.* into v_token
  from public.token_hashes th
  where th.id = p_token_hash_id
  for update;
  if v_token.id is null then return 'unavailable'; end if;

  v_invitation := private.current_adult_subject_invitation_v1(
    p_token_hash_id, p_session_id
  );
  if v_invitation.id is null
    or private.invitation_contact_barred_v1(v_invitation.email_hmac) then
    return 'unavailable';
  end if;

  select tc.* into v_candidate
  from public.token_candidates tc
  where tc.id = v_token.candidate_id
  for update;
  if v_candidate.id is null then return 'unavailable'; end if;

  select d.* into v_draft
  from public.adult_subject_drafts d
  where d.subject_id = v_invitation.target_id
    and d.state = 'invited'
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return 'unavailable'; end if;

  select ic.contact_reference_id into v_contact_id
  from public.invitation_candidates ic
  where ic.invitation_id = v_invitation.id
  for update;

  select sp.* into strict v_principal
  from public.subject_principals sp
  where sp.id = v_invitation.invitee_principal_id
    and sp.subject_id = v_invitation.target_id
    and sp.status = 'pending'
  for update;

  if p_action = 'confirm' then
    if p_account_id is null
      or p_account_email_hmac is null
      or p_account_email_hmac <> v_invitation.email_hmac
      or p_account_id = v_draft.owner_account_id
    then
      return 'unavailable';
    end if;

    select sp.* into strict v_account_principal
    from public.subject_principals sp
    join public.subjects s on s.id = sp.subject_id
    where sp.account_id = p_account_id
      and sp.principal_kind = 'account_subject'
      and sp.status = 'active'
      and s.subject_class = 'self'
      and s.subject_account_id = p_account_id
      and s.lifecycle = 'active'
    order by sp.created_at
    limit 1
    for update of sp, s;

    select * into strict v_profile
    from public.profiles where id = p_account_id for update;
    select * into strict v_artifact
    from public.consent_artifacts
    where artifact_key = 'consent.subject-adult'
      and version = 1;

    update public.subjects
    set owner_account_id = null,
        subject_account_id = p_account_id,
        lifecycle = 'active',
        subject_binding_revision = subject_binding_revision + 1,
        lifecycle_revision = lifecycle_revision + 1,
        updated_at = v_now
    where id = v_invitation.target_id;

    update public.subject_principals
    set account_id = p_account_id,
        principal_kind = 'account_subject',
        principal_revision = principal_revision + 1,
        status = 'active'
    where id = v_principal.id
    returning * into v_principal;

    insert into public.subject_account_bindings (
      subject_id, subject_principal_id, account_id, account_principal_id,
      binding_kind, binding_revision, status
    ) values (
      v_invitation.target_id, v_principal.id, p_account_id,
      v_account_principal.id, 'adult_claim', 1, 'current'
    );

    insert into public.subject_relationships (
      subject_id, data_subject_principal_id, recipient_principal_id,
      recipient_account_id, relationship_kind, relationship_revision, status
    ) values (
      v_invitation.target_id, v_principal.id, v_principal.id,
      p_account_id, 'self', 1, 'current'
    );

    insert into public.consent_signatures (
      artifact_key, artifact_version, artifact_body_sha256,
      signer_principal_id, signer_account_id, target_kind, target_id,
      purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
      subject_binding_revision
    ) values (
      v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
      v_principal.id, p_account_id, 'subject', v_invitation.target_id,
      'adult-subject-account-acceptance',
      array['age-18-plus', 'mailbox-control', 'no-inviter-access',
        'identity-not-verified', 'revocable'],
      coalesce(v_profile.jurisdiction_code, 'ZZ'),
      v_profile.jurisdiction_revision, 2
    ) returning id into v_signature_id;

    insert into public.subject_consents (
      signature_id, subject_id, account_id, consent_type, scope,
      grant_revision
    ) values (
      v_signature_id, v_invitation.target_id, p_account_id, 'adult_source',
      array['variants', 'reports.monogenic', 'reports.polygenic', 'ancestry',
        'copilot.local', 'family.portrait', 'raw.export', 'raw.browse'], 1
    );

    update public.subject_invitations
    set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days'
    where id = v_invitation.id;

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id and status = 'current';
    update public.token_candidates
    set state = 'invalidated' where id = v_candidate.id;
    if p_session_id is not null then
      update public.rights_sessions
      set status = 'consumed', ended_at = v_now
      where id = p_session_id;
    end if;
    delete from public.adult_subject_drafts where id = v_draft.id;

    perform private.append_legal_audit_event(
      'invitation.accepted', null, 'api.withdraw', 'accepted',
      jsonb_build_object('invitation_kind', 'adult_subject', 'revision', 1)
    );
    return 'accepted';
  end if;

  v_terminal_status := case when p_action = 'refuse' then 'refused' else 'revoked' end;
  update public.subject_invitations
  set status = v_terminal_status, terminal_at = v_now,
      contact_purge_due_at = v_now + interval '30 days',
      email_encrypted = null
  where id = v_invitation.id;

  if p_action = 'refuse' then
  insert into public.invitation_refusal_hmacs (
    email_hmac, refusal_revision, created_at, expires_at
  ) values (
    v_invitation.email_hmac, 1, v_now, v_now + interval '365 days'
  ) on conflict (email_hmac) do update
    set refusal_revision = public.invitation_refusal_hmacs.refusal_revision + 1,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;

  insert into public.contact_refusal_bars (
    contact_hmac, target_kind, target_id, refusal_revision, expires_at
  ) values (
    v_invitation.email_hmac, 'subject', v_invitation.target_id, 1,
    v_now + interval '365 days'
  ) on conflict (contact_hmac, target_kind, target_id, refusal_revision)
    do nothing;
  end if;

  update public.encrypted_contact_references
  set contact_ciphertext = null, status = 'shredded', ended_at = v_now
  where id = v_contact_id;
  update public.contact_hmac_indexes
  set status = 'revoked', expires_at = least(expires_at, v_now)
  where contact_reference_id = v_contact_id and status = 'current';
  update public.subject_principals
  set status = 'deleted', principal_revision = principal_revision + 1
  where id = v_principal.id;
  update public.subjects
  set lifecycle = 'purged', lifecycle_revision = lifecycle_revision + 1,
      updated_at = v_now
  where id = v_invitation.target_id;
  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id and status = 'current';
  update public.token_candidates
  set state = 'invalidated' where id = v_candidate.id;
  if p_session_id is not null then
    update public.rights_sessions
    set status = 'consumed', ended_at = v_now
    where id = p_session_id;
  end if;
  update public.mail_outbox
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_terminal'
  where id = v_candidate.outbox_id and state in ('queued', 'claimed');
  delete from public.adult_subject_drafts where id = v_draft.id;

  perform private.append_legal_audit_event(
    case when p_action = 'refuse' then 'invitation.refused'
      else 'invitation.deleted' end,
    null, 'api.withdraw', v_terminal_status,
    jsonb_build_object('invitation_kind', 'adult_subject', 'revision', 1)
  );
  return case when p_action = 'refuse' then 'refused' else 'deleted' end;
end;
$$;

revoke all on function private.adult_subject_invitation_response_v1(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

