-- Safe Path A for inviting another adult. A draft carries no file or analysis
-- authority. Acceptance transfers the reserved subject to the invited
-- adult's own account; it never grants the inviter access to genetic data.

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown,
  effective_on
)
select
  'consent.subject-adult',
  1,
  encode(extensions.digest(convert_to(
    'I am 18 or over. I control the email address used for this invitation. I understand that accepting creates a genetic-data subject under my account, grants the inviter no access by itself, and can be withdrawn. We cannot check that the person accepting this invitation is the person whose DNA this is.',
    'UTF8'
  ), 'sha256'), 'hex'),
  'I am 18 or over. I control the email address used for this invitation. I understand that accepting creates a genetic-data subject under my account, grants the inviter no access by itself, and can be withdrawn. We cannot check that the person accepting this invitation is the person whose DNA this is.',
  'Accepting reserves a subject under your own account. It does not share genetic data or authorize analysis for the inviter.',
  date '2026-09-01'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.subject-adult' and version = 1
);

create or replace function public.create_adult_subject_invitation_v1(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_idempotency_key text,
  p_test_jurisdiction boolean
)
returns table (
  invitation_id uuid,
  subject_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + interval '30 days';
  v_inviter public.subject_principals%rowtype;
  v_subject_id uuid;
  v_subject_principal_id uuid;
  v_draft_id uuid;
  v_slot_id uuid;
  v_invitation_id uuid;
  v_contact_id uuid;
  v_outbox_id uuid;
  v_placeholder_hash text;
begin
  if not p_test_jurisdiction
    or p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '42501', message = 'adult invitation unavailable';
  end if;

  select sp.* into strict v_inviter
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

  if exists (
    select 1 from public.account_deletion_requests adr
    where adr.account_id = p_account_id
      and adr.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;

  select m.target_id into v_invitation_id
  from public.mail_outbox m
  where m.idempotency_key = p_idempotency_key
    and m.template_id = 'adult-subject-invitation'
    and m.target_kind = 'subject_invitation';
  if v_invitation_id is not null then
    select si.target_id, si.expires_at
      into strict v_subject_id, v_expires_at
    from public.subject_invitations si
    where si.id = v_invitation_id;
    return query select v_invitation_id, v_subject_id, v_expires_at;
    return;
  end if;

  -- A live refusal bar is deliberately indistinguishable to the caller. The
  -- API returns the same accepted receipt but no invitation or mail is made.
  if exists (
    select 1 from public.contact_refusal_bars b
    where b.contact_hmac = p_contact_hmac and b.expires_at > v_now
  ) or exists (
    select 1 from public.invitation_refusal_hmacs b
    where b.email_hmac = p_contact_hmac and b.expires_at > v_now
  ) then
    return query select null::uuid, null::uuid, v_expires_at;
    return;
  end if;

  insert into public.subjects (
    owner_account_id, subject_account_id, subject_class, upload_class,
    display_label, lifecycle
  ) values (
    p_account_id, null, 'other_adult', 'adult', 'Invited adult', 'draft'
  ) returning id into v_subject_id;

  insert into public.subject_principals (
    subject_id, account_id, principal_kind, status
  ) values (
    v_subject_id, null, 'non_account_subject', 'pending'
  ) returning id into v_subject_principal_id;

  insert into public.adult_subject_drafts (
    owner_account_id, subject_id, draft_revision, state, fixed_expires_at
  ) values (
    p_account_id, v_subject_id, 1, 'invited', v_expires_at
  ) returning id into v_draft_id;

  insert into public.draft_participant_slots (
    adult_draft_id, slot_kind, principal_id, slot_revision, state
  ) values (
    v_draft_id, 'adult_subject', v_subject_principal_id, 1, 'pending'
  ) returning id into v_slot_id;

  v_placeholder_hash := encode(extensions.digest(
    extensions.gen_random_bytes(32), 'sha256'
  ), 'hex');

  insert into public.subject_invitations (
    target_kind, target_id, inviter_principal_id, invitee_principal_id,
    email_hmac, email_encrypted, token_hash, invitation_kind, status,
    invitation_revision, expires_at
  ) values (
    'subject', v_subject_id, v_inviter.id, v_subject_principal_id,
    p_contact_hmac, p_contact_ciphertext, v_placeholder_hash,
    'adult_subject', 'pending', 1, v_expires_at
  ) returning id into v_invitation_id;

  insert into public.encrypted_contact_references (
    principal_id, contact_ciphertext, contact_hmac, key_revision,
    authority_revision, status
  ) values (
    v_subject_principal_id, p_contact_ciphertext, p_contact_hmac, 1, 1,
    'current'
  ) returning id into v_contact_id;

  insert into public.contact_hmac_indexes (
    contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
  ) values (v_contact_id, p_contact_hmac, 1, 'current', v_expires_at);

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    token_purpose, token_target_id, template_payload, expires_at
  ) values (
    'adult-subject-invitation', 'adult-subject-invitation',
    'subject_invitation', v_invitation_id,
    v_subject_principal_id, v_contact_id,
    1, 1, p_idempotency_key,
    'adult-subject-invitation', v_invitation_id, '{}'::jsonb, v_expires_at
  ) returning id into v_outbox_id;

  insert into public.token_candidates (
    outbox_id, purpose, target_kind, target_id, token_revision, state,
    expires_at
  ) values (
    v_outbox_id, 'adult-subject-invitation', 'subject_invitation',
    v_invitation_id, 1, 'pending', v_expires_at
  );

  insert into public.invitation_candidates (
    invitation_id, draft_slot_id, contact_reference_id,
    candidate_revision, state
  ) values (v_invitation_id, v_slot_id, v_contact_id, 1, 'issued');

  perform private.append_legal_audit_event(
    'invitation.issued', null, 'api.subject-drafts', 'accepted',
    jsonb_build_object('invitation_kind', 'adult_subject', 'revision', 1)
  );

  return query select v_invitation_id, v_subject_id, v_expires_at;
end;
$$;

revoke all on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean
) to service_role;

drop function public.claim_mail_outbox();

create function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea,
  delivery_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_raw_token text;
  v_token_hash text;
begin
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.state in ('queued', 'claimed')
    and not exists (
      select 1
      from public.subject_principals sp
      join public.encrypted_contact_references ecr
        on ecr.id = m.contact_reference_id
       and ecr.principal_id = sp.id
      where sp.id = m.recipient_principal_id
        and (
          sp.status = 'active'
          or (
            m.purpose = 'adult-subject-invitation'
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  select m.* into v_outbox
  from public.mail_outbox m
  where (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
  order by m.not_before, m.created_at
  for update skip locked
  limit 1;

  if v_outbox.id is null then return; end if;

  update public.mail_outbox m
  set state = 'claimed',
      claimed_at = clock_timestamp(),
      attempt_count = (m.attempt_count + 1)::smallint,
      last_outcome_code = null
  where m.id = v_outbox.id
  returning m.* into v_outbox;

  if v_outbox.token_purpose = 'adult-subject-invitation' then
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.target_kind = 'subject_invitation'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;

    update public.subject_invitations
    set token_hash = v_token_hash
    where id = v_candidate.target_id
      and status = 'pending'
      and expires_at > clock_timestamp();
    if not found then
      raise exception using errcode = '55000', message = 'invitation is not current';
    end if;
  end if;

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    v_outbox.idempotency_key,
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;

revoke all on function public.claim_mail_outbox()
  from public, anon, authenticated;
grant execute on function public.claim_mail_outbox() to service_role;

create or replace function public.resolve_adult_subject_invitation_v1(
  p_token_hash text
)
returns table (state text, requires_account boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when exists (
      select 1
      from public.token_hashes th
      join public.token_candidates tc on tc.id = th.candidate_id
      join public.subject_invitations si on si.id = tc.target_id
      where th.token_hash = p_token_hash
        and th.status = 'current'
        and tc.purpose = 'adult-subject-invitation'
        and tc.state = 'issued'
        and tc.expires_at > clock_timestamp()
        and si.status = 'pending'
        and si.expires_at > clock_timestamp()
    ) then 'available' else 'unavailable' end,
    true;
$$;

revoke all on function public.resolve_adult_subject_invitation_v1(text)
  from public, anon, authenticated;
grant execute on function public.resolve_adult_subject_invitation_v1(text)
  to service_role;

create or replace function public.respond_adult_subject_invitation_v1(
  p_token_hash text,
  p_action text,
  p_account_id uuid default null,
  p_account_email_hmac text default null
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
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_action not in ('confirm', 'refuse', 'delete')
  then
    return 'unavailable';
  end if;

  select th.* into v_token
  from public.token_hashes th
  where th.token_hash = p_token_hash and th.status = 'current'
  for update;
  if v_token.id is null then return 'unavailable'; end if;

  select tc.* into v_candidate
  from public.token_candidates tc
  where tc.id = v_token.candidate_id
    and tc.purpose = 'adult-subject-invitation'
    and tc.state = 'issued'
  for update;
  if v_candidate.id is null then return 'unavailable'; end if;

  select si.* into v_invitation
  from public.subject_invitations si
  where si.id = v_candidate.target_id
    and si.status = 'pending'
  for update;
  if v_invitation.id is null or v_invitation.expires_at <= v_now then
    return 'unavailable';
  end if;

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
        'copilot.local', 'family.portrait', 'raw.export'], 1
    );

    update public.subject_invitations
    set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days'
    where id = v_invitation.id;

    update public.token_hashes
    set status = 'consumed', ended_at = v_now where id = v_token.id;
    update public.token_candidates
    set state = 'invalidated' where id = v_candidate.id;
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
  set status = 'consumed', ended_at = v_now where id = v_token.id;
  update public.token_candidates
  set state = 'invalidated' where id = v_candidate.id;
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

revoke all on function public.respond_adult_subject_invitation_v1(
  text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.respond_adult_subject_invitation_v1(
  text, text, uuid, text
) to service_role;

create or replace function public.expire_due_adult_subject_invitations_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row record;
  v_count integer := 0;
begin
  -- Terminal contact material is destroyed at its fixed deadline.
  for v_row in
    select si.id, m.contact_reference_id
    from public.subject_invitations si
    join public.mail_outbox m
      on m.target_kind = 'subject_invitation' and m.target_id = si.id
    where si.status <> 'pending'
      and si.contact_purge_due_at <= v_now
    for update of si, m skip locked
  loop
    update public.subject_invitations
    set email_encrypted = null, contact_purge_due_at = null
    where id = v_row.id;
    update public.encrypted_contact_references
    set contact_ciphertext = null, status = 'shredded', ended_at = v_now
    where id = v_row.contact_reference_id and status <> 'shredded';
    update public.contact_hmac_indexes
    set status = 'expired', expires_at = least(expires_at, v_now)
    where contact_reference_id = v_row.contact_reference_id
      and status = 'current';
  end loop;

  for v_row in
    select si.id, si.target_id, si.invitee_principal_id,
           d.id as draft_id, tc.id as candidate_id,
           th.id as token_hash_id, m.id as outbox_id,
           m.contact_reference_id
    from public.subject_invitations si
    join public.adult_subject_drafts d on d.subject_id = si.target_id
    join public.mail_outbox m
      on m.target_kind = 'subject_invitation' and m.target_id = si.id
    left join public.token_candidates tc on tc.outbox_id = m.id
    left join public.token_hashes th
      on th.candidate_id = tc.id and th.status = 'current'
    where si.status = 'pending' and si.expires_at <= v_now
    order by si.expires_at, si.id
    for update of si, d, m skip locked
  loop
    update public.subject_invitations
    set status = 'expired', terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days',
        email_encrypted = null
    where id = v_row.id;
    update public.encrypted_contact_references
    set contact_ciphertext = null, status = 'shredded', ended_at = v_now
    where id = v_row.contact_reference_id;
    update public.contact_hmac_indexes
    set status = 'expired', expires_at = least(expires_at, v_now)
    where contact_reference_id = v_row.contact_reference_id
      and status = 'current';
    update public.subject_principals
    set status = 'deleted', principal_revision = principal_revision + 1
    where id = v_row.invitee_principal_id;
    update public.subjects
    set lifecycle = 'purged', lifecycle_revision = lifecycle_revision + 1,
        updated_at = v_now
    where id = v_row.target_id;
    update public.token_hashes
    set status = 'expired', ended_at = v_now
    where id = v_row.token_hash_id;
    update public.token_candidates
    set state = 'expired' where id = v_row.candidate_id;
    update public.mail_outbox
    set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
    where id = v_row.outbox_id and state in ('queued', 'claimed');
    delete from public.adult_subject_drafts where id = v_row.draft_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.expire_due_adult_subject_invitations_v1()
  from public, anon, authenticated;
grant execute on function public.expire_due_adult_subject_invitations_v1()
  to service_role;
