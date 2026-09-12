-- `raw.browse`: reading another adult's coverage and variant calls IN THE APP,
-- granted separately from `raw.export`.
--
-- Operator decision, 2026-09-12. The question was which grant authorises a
-- relative's raw data on `/genome/[subject]/data` and
-- `/genome/[subject]/data/browser`, now that those routes resolve a family
-- segment. `DIRECTIONAL_PURPOSES` had no browse purpose, so the only candidate
-- was `raw.export` — and using it would have silently widened every export
-- grant already given into a browsing grant as well. Both release the same
-- bytes, which is an argument for asking rather than a reason not to: somebody
-- who agreed to "they can download my file" did not thereby agree to "they can
-- read my variants whenever they like", and the brief requires storage,
-- analysis, sharing and AI permissions to stay separate.
--
-- No new consent artifact. Every directional purpose is signed against
-- `consent.share-with-adult`, so this adds a row to the permissions page and
-- nothing to the consent library.
--
-- HOW THE TWO FUNCTION BODIES BELOW WERE PRODUCED: each is the definition
-- installed in this database, read with `pg_get_functiondef`, with exactly ONE
-- textual substitution asserted to apply exactly once. Nothing else in either
-- body moved. Migrations here are append-only, so deriving from the installed
-- definition rather than from an earlier migration file is the only way to be
-- sure what is being replaced.
--
-- `subject_consents.scope` gains `raw.browse` for NEW acceptances. That array
-- is descriptive, not enforcing — `grant_directional_purpose_v1` never reads
-- it — so existing pairings are unaffected and no grant depends on it. It is
-- updated anyway, because an acceptance that lists what could later be asked
-- for should list this too.

alter table public.purpose_grants drop constraint purpose_grants_purpose_check;
alter table public.purpose_grants add constraint purpose_grants_purpose_check
  check (purpose = any (array['reports.monogenic'::text, 'reports.polygenic'::text,
    'ancestry'::text, 'copilot.local'::text, 'copilot.cloud'::text,
    'family.heritability'::text, 'family.portrait'::text, 'export.share-link'::text,
    'raw.export'::text, 'raw.browse'::text, 'embryo.analysis'::text]));

-- `generated_exports.purpose` is deliberately NOT widened: browsing generates
-- no export artifact, and a `raw.browse` row in that table would mean an
-- archive nobody asked for.

CREATE OR REPLACE FUNCTION public.grant_directional_purpose_v1(p_account_id uuid, p_data_subject_id uuid, p_recipient_principal_id uuid, p_purpose text, p_artifact_key text, p_artifact_version integer, p_token_nonce text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_subject public.subjects%rowtype;
  v_signer public.subject_principals%rowtype;
  v_recipient public.subject_principals%rowtype;
  v_recipient_self_subject_id uuid;
  v_profile public.profiles%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_nonce_hash text;
  v_existing_grant_id uuid;
  v_relationship_id uuid;
  v_relationship_revision bigint;
  v_pair public.family_pairs%rowtype;
  v_signature_id uuid;
  v_grant_id uuid;
  v_reverse_live boolean := false;
begin
  if p_purpose is null or p_purpose not in (
    'reports.monogenic', 'reports.polygenic', 'ancestry', 'copilot.local',
    'family.heritability', 'family.portrait', 'export.share-link', 'raw.export',
    'raw.browse'
  ) then
    raise exception using errcode = '22023', message = 'purpose is not directional';
  end if;
  if p_token_nonce is null
    or char_length(p_token_nonce) not between 16 and 256
    or p_token_nonce ~ '\s' then
    raise exception using errcode = '22023', message = 'invalid presentation nonce';
  end if;

  -- The data subject must be a record the caller's own account holds.
  select s.* into v_subject
  from public.subjects s
  where s.id = p_data_subject_id
    and s.subject_account_id = p_account_id
    and s.subject_class in ('self', 'other_adult')
    and s.lifecycle = 'active'
  for update;
  if v_subject.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.* into v_signer
  from public.subject_principals sp
  where sp.subject_id = v_subject.id
    and sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
  order by sp.created_at
  limit 1
  for update;
  if v_signer.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select sp.* into v_recipient
  from public.subject_principals sp
  where sp.id = p_recipient_principal_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and sp.account_id is not null
    and sp.account_id <> p_account_id;
  if v_recipient.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select s.id into v_recipient_self_subject_id
  from public.subjects s
  where s.subject_account_id = v_recipient.account_id
    and s.subject_class = 'self'
    and s.lifecycle = 'active'
  order by s.created_at, s.id
  limit 1;
  if v_recipient_self_subject_id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  select * into v_profile from public.profiles where id = p_account_id for update;
  if v_profile.id is null then
    raise exception using errcode = '42501', message = 'grant authority is unavailable';
  end if;

  if p_artifact_key is distinct from 'consent.share-with-adult' then
    raise exception using errcode = '22023',
      message = 'consent artifact does not govern directional sharing';
  end if;
  select * into v_artifact
  from public.consent_artifacts a
  where a.artifact_key = p_artifact_key
    and a.version = p_artifact_version
    and a.superseded_at is null
    and a.published_at <= v_now;
  if v_artifact.artifact_key is null then
    raise exception using errcode = '55000', message = 'consent artifact is not current';
  end if;

  if private.family_sharing_paused_v1(p_account_id, v_recipient.account_id) then
    raise exception using errcode = '55000', message = 'family sharing is paused';
  end if;

  if p_purpose in ('family.heritability', 'family.portrait')
    and v_subject.independent_login_at is null then
    raise exception using errcode = '55000', message = 'independent login is required';
  end if;

  -- The presentation token is single-use: the nonce is consumed before any
  -- grant write, and a second presentation of the same nonce fails closed.
  v_nonce_hash := encode(extensions.digest(convert_to(p_token_nonce, 'UTF8'), 'sha256'), 'hex');
  begin
    insert into public.purpose_grant_nonces (nonce_hash, account_id)
    values (v_nonce_hash, p_account_id);
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'presentation nonce already used';
  end;

  -- An identical live grant is returned rather than duplicated.
  select pg.grant_id into v_existing_grant_id
  from public.purpose_grants pg
  join public.directional_grants dg
    on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
  where pg.target_kind = 'subject'
    and pg.target_id = v_subject.id
    and pg.purpose = p_purpose
    and pg.data_subject_principal_id = v_signer.id
    and pg.revoked_at is null
    and (pg.expires_at is null or pg.expires_at > v_now)
    and dg.recipient_principal_id = v_recipient.id
    and dg.status = 'current'
  limit 1;
  if v_existing_grant_id is not null then
    update public.purpose_grant_nonces
    set grant_id = v_existing_grant_id
    where nonce_hash = v_nonce_hash;
    return v_existing_grant_id;
  end if;

  if p_purpose = 'family.portrait' then
    select fp.* into v_pair
    from public.family_pairs fp
    where fp.subject_low_id = least(v_subject.id, v_recipient_self_subject_id)
      and fp.subject_high_id = greatest(v_subject.id, v_recipient_self_subject_id)
    for update;
    if v_pair.id is null then
      insert into public.family_pairs (subject_a_id, subject_b_id, status)
      values (v_subject.id, v_recipient_self_subject_id, 'pending')
      returning * into v_pair;
    elsif v_pair.status = 'purged' then
      raise exception using errcode = '42501', message = 'grant authority is unavailable';
    elsif v_pair.status = 'revoked' then
      update public.family_pairs
      set status = 'pending', pair_revision = pair_revision + 1
      where id = v_pair.id
      returning * into v_pair;
    end if;
  else
    select sr.id, sr.relationship_revision
      into v_relationship_id, v_relationship_revision
    from public.subject_relationships sr
    where sr.subject_id = v_subject.id
      and sr.data_subject_principal_id = v_signer.id
      and sr.recipient_principal_id = v_recipient.id
      and sr.relationship_kind = 'family_member'
      and sr.status = 'current'
    for update;
    if v_relationship_id is null then
      insert into public.subject_relationships (
        subject_id, data_subject_principal_id, recipient_principal_id,
        recipient_account_id, relationship_kind, relationship_revision, status
      ) values (
        v_subject.id, v_signer.id, v_recipient.id, v_recipient.account_id,
        'family_member', 1, 'current'
      ) returning id, relationship_revision
        into v_relationship_id, v_relationship_revision;
    end if;
  end if;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
    subject_binding_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signer.id, p_account_id, 'subject', v_subject.id,
    p_purpose,
    array['one-purpose', 'one-named-adult', 'own-account', 'pause-or-stop-any-time'],
    coalesce(v_profile.jurisdiction_code, 'ZZ'),
    v_profile.jurisdiction_revision, v_subject.subject_binding_revision
  ) returning id into v_signature_id;

  insert into public.purpose_grants (
    grant_revision, target_kind, target_id, purpose,
    artifact_key, artifact_version, artifact_body_sha256, signature_id,
    signer_principal_id, data_subject_principal_id, subject_binding_revision,
    jurisdiction_code, jurisdiction_revision
  ) values (
    1, 'subject', v_subject.id, p_purpose,
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signature_id, v_signer.id, v_signer.id, v_subject.subject_binding_revision,
    coalesce(v_profile.jurisdiction_code, 'ZZ'), v_profile.jurisdiction_revision
  ) returning grant_id into v_grant_id;

  insert into public.directional_grants (
    grant_id, grant_revision, recipient_principal_id, recipient_account_id,
    relationship_id, pair_id, relationship_or_pair_revision, direction, status
  ) values (
    v_grant_id, 1, v_recipient.id, v_recipient.account_id,
    v_relationship_id, v_pair.id,
    coalesce(v_pair.pair_revision, v_relationship_revision), 'subject_to_recipient',
    'current'
  );

  update public.purpose_grant_nonces
  set grant_id = v_grant_id
  where nonce_hash = v_nonce_hash;

  if p_purpose = 'family.portrait' and v_pair.status = 'pending' then
    select exists (
      select 1
      from public.purpose_grants pg
      join public.directional_grants dg
        on dg.grant_id = pg.grant_id and dg.grant_revision = pg.grant_revision
      join public.subject_principals dsp on dsp.id = pg.data_subject_principal_id
      where pg.purpose = 'family.portrait'
        and pg.target_kind = 'subject'
        and pg.target_id = v_recipient_self_subject_id
        and dsp.account_id = v_recipient.account_id
        and pg.revoked_at is null
        and (pg.expires_at is null or pg.expires_at > v_now)
        and dg.recipient_account_id = p_account_id
        and dg.status = 'current'
    ) into v_reverse_live;
    if v_reverse_live then
      update public.family_pairs
      set status = 'current'
      where id = v_pair.id;
    end if;
  end if;

  perform private.append_legal_audit_event(
    'purpose.granted', null, 'api.consents', 'accepted',
    jsonb_build_object('purpose', p_purpose, 'direction', 'subject_to_recipient',
      'revision', 1)
  );

  return v_grant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.respond_adult_subject_invitation_v1(p_token_hash text, p_action text, p_account_id uuid DEFAULT NULL::uuid, p_account_email_hmac text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
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
  if v_invitation.id is null or v_invitation.expires_at <= v_now
    or private.invitation_contact_barred_v1(v_invitation.email_hmac) then
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
        'copilot.local', 'family.portrait', 'raw.export', 'raw.browse'], 1
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
$function$;
