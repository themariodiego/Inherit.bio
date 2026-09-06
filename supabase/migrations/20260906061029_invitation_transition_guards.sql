-- A refusal receipt survives its draft/session purge. Only hashes and the
-- original session deadline remain; no new contact or draft store is added.
alter table public.embryo_operation_nonces
 add column rights_session_hash text,
 add column rights_receipt_expires_at timestamptz,
 add constraint embryo_refusal_receipt_shape check (
  (rights_session_hash is null and rights_receipt_expires_at is null)
  or (rights_session_hash is not null and rights_receipt_expires_at is not null
   and operation='invitation_refuse' and account_id is null and session_id is null
   and target_kind='rights_session' and rights_session_hash ~ '^[0-9a-f]{64}$'
   and rights_receipt_expires_at>consumed_at
   and rights_receipt_expires_at<=consumed_at+interval '24 hours')
 );
create index embryo_refusal_receipt_hash_idx on public.embryo_operation_nonces(rights_session_hash)
 where rights_session_hash is not null;

create or replace function private.invitation_contact_barred_v1(p_hmac text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.contact_refusal_bars b
  where b.contact_hmac=any(private.invitation_contact_aliases_v1(p_hmac)) and b.expires_at>statement_timestamp())
 or exists(select 1 from public.invitation_refusal_hmacs b
  where b.email_hmac=any(private.invitation_contact_aliases_v1(p_hmac)) and b.expires_at>statement_timestamp());
$$;
revoke all on function private.invitation_contact_barred_v1(text) from public,anon,authenticated;
grant execute on function private.invitation_contact_barred_v1(text) to service_role;

create or replace function private.invitation_mail_current_v1(m public.mail_outbox)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.subject_invitations i
  join public.subject_principals sp on sp.id=i.invitee_principal_id
  join public.encrypted_contact_references e on e.id=m.contact_reference_id and e.principal_id=sp.id
  join public.token_candidates tc on tc.outbox_id=m.id
  where m.target_kind='subject_invitation' and i.id=m.target_id
   and m.purpose=m.token_purpose and m.template_id=m.purpose
   and m.purpose=case i.invitation_kind when 'co_parent' then 'co-parent-invitation'
    when 'adult_subject' then 'adult-subject-invitation' end
   and i.status='pending' and i.expires_at>statement_timestamp()
   and i.invitation_revision=m.semantic_revision
   and sp.id=m.recipient_principal_id and sp.status='pending'
   and sp.principal_revision=m.recipient_authority_revision
   and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=m.recipient_authority_revision and e.contact_hmac=i.email_hmac
   and tc.target_kind='subject_invitation' and tc.target_id=i.id and tc.purpose=m.purpose
   and tc.state in('pending','issued') and tc.expires_at>statement_timestamp()
   and tc.token_revision=i.invitation_revision
   and not private.invitation_contact_barred_v1(i.email_hmac)
   and (
    (i.invitation_kind='co_parent' and i.target_kind='cohort_draft' and exists(
      select 1 from public.embryo_cohort_drafts d join public.draft_participant_slots slot
       on slot.embryo_draft_id=d.id and slot.principal_id=sp.id
      where d.id=i.target_id and d.state in('draft','evidence_pending','ready')
       and d.fixed_expires_at>statement_timestamp() and slot.state='pending'
       and slot.slot_kind in('parent_a','parent_b')
    ))
    or (i.invitation_kind='adult_subject' and i.target_kind='subject' and exists(
     select 1 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
     where d.subject_id=i.target_id and d.state='invited' and d.fixed_expires_at>statement_timestamp()
      and s.lifecycle='draft' and s.subject_account_id is null
    ))
   )
 );
$$;
revoke all on function private.invitation_mail_current_v1(public.mail_outbox) from public,anon,authenticated;
grant execute on function private.invitation_mail_current_v1(public.mail_outbox) to service_role;

-- Private definer: the service-only facade may inspect the private authority
-- chain but no account role may use it. The bearer is the hashed rights
-- session, not an account identity; refusal intentionally needs no login.
create or replace function private.co_parent_refusal_state_v1(p_session_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare s public.rights_sessions%rowtype; i public.subject_invitations%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 if exists(select 1 from public.embryo_operation_nonces where rights_session_hash=p_session_hash
  and rights_receipt_expires_at>clock_timestamp() and operation='invitation_refuse') then return 'done'; end if;
 select * into s from public.rights_sessions where session_hash=p_session_hash
  and purpose='co-parent-invitation' and target_kind='cohort_draft'
  and status='active' and expires_at>clock_timestamp() for update;
 if s.id is null then return null; end if;
 i:=private.current_co_parent_invitation_v1(s.token_hash_id,s.id);
 if i.id is null then return null; end if;
 return 'ready';
end;
$$;
revoke all on function private.co_parent_refusal_state_v1(text) from public,anon,authenticated;
grant execute on function private.co_parent_refusal_state_v1(text) to service_role;
create or replace function public.read_co_parent_refusal_v1(p_session_hash text)
returns text language sql security invoker set search_path='' as $$
 select private.co_parent_refusal_state_v1(p_session_hash);
$$;
revoke all on function public.read_co_parent_refusal_v1(text) from public,anon,authenticated;
grant execute on function public.read_co_parent_refusal_v1(text) to service_role;

create or replace function private.submit_co_parent_refusal_v1(p_session_hash text,p_nonce text)
returns void language plpgsql security definer set search_path='' as $$
declare s public.rights_sessions%rowtype; v_hash text;
begin
 perform private.lock_invitation_transitions_v1();
 if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
  or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]+$' or length(p_nonce) not between 16 and 256 then
  raise exception using errcode='42501',message='rights session unavailable';
 end if;
 v_hash:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
 if exists(select 1 from public.embryo_operation_nonces where nonce_hash=v_hash
  and rights_session_hash=p_session_hash and rights_receipt_expires_at>clock_timestamp()
  and operation='invitation_refuse') then return; end if;
 select * into s from public.rights_sessions where session_hash=p_session_hash
  and purpose='co-parent-invitation' and target_kind='cohort_draft'
  and status='active' and expires_at>clock_timestamp() for update;
 if s.id is null then raise exception using errcode='42501',message='rights session unavailable'; end if;
 perform private.refuse_co_parent_invitation_v1(p_session_hash,p_nonce);
 update public.embryo_operation_nonces set rights_session_hash=p_session_hash,
  rights_receipt_expires_at=least(s.expires_at,consumed_at+interval '24 hours')
 where nonce_hash=v_hash and operation='invitation_refuse' and target_id=s.id;
 if not found then raise exception using errcode='55000',message='refusal receipt missing'; end if;
end;
$$;
revoke all on function private.submit_co_parent_refusal_v1(text,text) from public,anon,authenticated;
grant execute on function private.submit_co_parent_refusal_v1(text,text) to service_role;
create or replace function public.refuse_co_parent_invitation_session_v1(p_session_hash text,p_nonce text)
returns void language sql security invoker set search_path='' as $$
 select private.submit_co_parent_refusal_v1(p_session_hash,p_nonce);
$$;
revoke all on function public.refuse_co_parent_invitation_session_v1(text,text) from public,anon,authenticated;
grant execute on function public.refuse_co_parent_invitation_session_v1(text,text) to service_role;

create or replace function public.expire_invitation_refusal_receipts_v1()
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 perform private.lock_invitation_transitions_v1();
 delete from public.embryo_operation_nonces where operation='invitation_refuse'
  and rights_receipt_expires_at<=clock_timestamp();
 get diagnostics n=row_count;
 return n;
end;
$$;
revoke all on function public.expire_invitation_refusal_receipts_v1() from public,anon,authenticated;
grant execute on function public.expire_invitation_refusal_receipts_v1() to service_role;

create or replace function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox for update;
 if m.id is null or m.state<>'claimed' or m.attempt_count is distinct from p_attempt
  or m.expires_at<=clock_timestamp() or m.invitation_terminal_notice_id is not null then return false; end if;
 if not exists(select 1 from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id
  where e.id=m.contact_reference_id and sp.id=m.recipient_principal_id
   and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=m.recipient_authority_revision and sp.principal_revision=m.recipient_authority_revision
   and (sp.status='active' or (sp.status='pending' and m.token_purpose in('adult-subject-invitation','co-parent-invitation')))
 ) then return false; end if;
 if m.token_purpose in('adult-subject-invitation','co-parent-invitation') then
  if not private.invitation_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   join public.subject_invitations i on i.id=tc.target_id and i.token_hash=th.token_hash
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 if m.template_id='report-ready' and not (m.target_kind='genome_file' and exists(
  select 1 from public.genome_files f join public.subject_principals sp on sp.id=m.recipient_principal_id
  where f.id=m.target_id and f.status='annotated' and f.user_id=sp.account_id and f.subject_id=sp.subject_id
   and not exists(select 1 from private.genome_file_deletions d where d.file_id=f.id)
 )) then return false; end if;
 return true;
end;
$$;
revoke all on function private.authorize_mail_submission_v1(uuid,smallint) from public,anon,authenticated;
grant execute on function private.authorize_mail_submission_v1(uuid,smallint) to service_role;
create or replace function public.authorize_mail_submission_v1(p_outbox_id uuid,p_attempt_ordinal smallint)
returns boolean language sql security invoker set search_path='' as $$
 select private.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal);
$$;
revoke all on function public.authorize_mail_submission_v1(uuid,smallint) from public,anon,authenticated;
grant execute on function public.authorize_mail_submission_v1(uuid,smallint) to service_role;

-- Same authority and operation body; acquire the shared lock first.
create or replace function public.create_embryo_cohort_draft_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_upload_situation text,
  p_basis_case text,
  p_embryo_count integer,
  p_owner_contact_ciphertext bytea,
  p_owner_contact_hmac text,
  p_contact_ciphertexts text[],
  p_contact_hmacs text[],
  p_token_nonce text,
  p_test_jurisdiction boolean
)
returns table (
  draft_id uuid,
  expires_at timestamptz,
  required_principal_slots text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz := clock_timestamp() + interval '30 days';
  v_uploader public.subject_principals%rowtype;
  v_expected_contacts integer;
  v_upload_class text;
  v_state text;
  v_draft_id uuid;
  v_retention_id uuid;
  v_slot_kinds text[];
  v_slot_labels text[];
  v_i integer;
  v_principal_id uuid;
  v_contact_id uuid;
  v_slot_offset integer := 0;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if not p_test_jurisdiction then
    raise exception using errcode = '42501', message = 'embryo analysis unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_draft_create',
    'account', p_account_id
  );

  if p_upload_situation not in ('own_embryos', 'with_genetic_parents_permission')
    or p_basis_case not in (
      'true_two_parent', 'anonymous_donor', 'parent_deceased', 'sole_legal_authority'
    )
    or p_embryo_count is null or p_embryo_count < 1 or p_embryo_count > 64
    or p_owner_contact_ciphertext is null
    or p_owner_contact_hmac !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid draft request';
  end if;

  v_expected_contacts := case
    when p_upload_situation = 'own_embryos' and p_basis_case = 'true_two_parent' then 1
    when p_upload_situation = 'own_embryos' then 0
    when p_basis_case = 'true_two_parent' then 2
    else 1
  end;
  if coalesce(cardinality(p_contact_hmacs), 0) <> v_expected_contacts
    or coalesce(cardinality(p_contact_ciphertexts), 0) <> v_expected_contacts
  then
    raise exception using errcode = '22023', message = 'invalid contact cardinality';
  end if;
  for v_i in 1..v_expected_contacts loop
    if p_contact_hmacs[v_i] is null
      or p_contact_hmacs[v_i] !~ '^[0-9a-f]{64}$'
      or p_contact_ciphertexts[v_i] is null
      or p_contact_ciphertexts[v_i] !~ '^([0-9a-f]{2}){16,}$'
      or p_contact_hmacs[v_i] = p_owner_contact_hmac
      or (v_i = 2 and p_contact_hmacs[1] = p_contact_hmacs[2])
    then
      raise exception using errcode = '22023', message = 'invalid contact';
    end if;
  end loop;

  select sp.* into v_uploader
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
  if v_uploader.id is null then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;
  if exists (
    select 1 from public.account_deletion_requests adr
    where adr.account_id = p_account_id
      and adr.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;

  v_upload_class := case when p_upload_situation = 'own_embryos'
    then 'embryo_own' else 'embryo_third_party' end;
  v_state := case when p_basis_case in ('parent_deceased', 'sole_legal_authority')
    then 'evidence_pending' else 'draft' end;

  insert into public.embryo_cohort_drafts (
    owner_account_id, uploader_principal_id, upload_class, basis_case,
    embryo_count, state, fixed_expires_at, upload_situation
  ) values (
    p_account_id, v_uploader.id, v_upload_class, p_basis_case,
    p_embryo_count, v_state, v_deadline, p_upload_situation
  ) returning id into v_draft_id;

  -- Slot layout: own embryos put the uploader in parent_a; a third-party
  -- upload fills parent_a (and parent_b) from the typed contacts.
  if p_upload_situation = 'own_embryos' then
    insert into public.subject_principals (
      account_id, principal_kind, principal_revision, status
    ) values (p_account_id, 'genetic_parent', 1, 'active')
    returning id into v_principal_id;
    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal_id, p_owner_contact_ciphertext, p_owner_contact_hmac, 1, 1,
      'current'
    ) returning id into v_contact_id;
    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (v_contact_id, p_owner_contact_hmac, 1, 'current', v_deadline);
    insert into public.draft_participant_slots (
      embryo_draft_id, slot_kind, principal_id, slot_revision, state
    ) values (v_draft_id, 'parent_a', v_principal_id, 1, 'current');
    v_slot_offset := 1;
    v_slot_labels := case when p_basis_case = 'true_two_parent'
      then array['other-genetic-parent'] else '{}'::text[] end;
  else
    v_slot_labels := case when p_basis_case = 'true_two_parent'
      then array['genetic-parent', 'genetic-parent'] else array['genetic-parent'] end;
  end if;

  v_slot_kinds := array['parent_a', 'parent_b'];
  for v_i in 1..v_expected_contacts loop
    insert into public.subject_principals (
      principal_kind, principal_revision, status
    ) values ('genetic_parent', 1, 'pending')
    returning id into v_principal_id;
    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal_id, decode(p_contact_ciphertexts[v_i], 'hex'),
      p_contact_hmacs[v_i], 1, 1, 'current'
    ) returning id into v_contact_id;
    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (v_contact_id, p_contact_hmacs[v_i], 1, 'current', v_deadline);
    insert into public.draft_participant_slots (
      embryo_draft_id, slot_kind, principal_id, slot_revision, state
    ) values (
      v_draft_id, v_slot_kinds[v_slot_offset + v_i], v_principal_id, 1, 'pending'
    );
  end loop;

  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline, state
  ) values (
    'embryo.cohort-draft-30d', 'cohort', v_draft_id, 1, 1, 1, v_deadline,
    'scheduled'
  ) returning id into v_retention_id;

  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'embryo.cohort-draft-30d', 'embryo-cohort-draft-expiry',
    'compound-atomic', 1, v_deadline, 'cohort', v_draft_id, 1, 1,
    'account-subject-principal', v_uploader.principal_revision,
    jsonb_build_object('draftId', v_draft_id)
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'embryo-cohort-draft-expiry', 1, 'cohort-draft-complete', 1,
    encode(extensions.digest(convert_to(
      concat_ws(':', 'embryo-cohort-draft-v1', v_draft_id::text,
        p_account_id::text, v_deadline::text),
      'UTF8'), 'sha256'), 'hex'),
    'frozen'
  );

  perform private.append_legal_audit_event(
    'embryo.draft.created', null, 'api.embryo-cohort-drafts', 'accepted',
    jsonb_build_object(
      'basis_case', p_basis_case, 'upload_class', v_upload_class,
      'embryo_count', p_embryo_count
    )
  );

  return query select v_draft_id, v_deadline, v_slot_labels;
end;
$$;

-- Same authority and operation body; acquire the shared lock first.
create or replace function public.sign_embryo_artifact_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_artifact_key text,
  p_artifact_version integer,
  p_statement_keys text[],
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_profile public.profiles%rowtype;
  v_actor_parent uuid;
  v_signer uuid;
  v_keys text[];
  v_purpose text;
  v_kind text;
  v_role text;
  v_signature_id uuid;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if p_target_kind <> 'cohort_draft' then
    raise exception using errcode = '42501', message = 'target unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'artifact_sign',
    'cohort_draft', p_target_id
  );

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_target_id
  for update;
  if v_draft.id is null
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  if p_signing_name_ciphertext is null
    or p_jurisdiction_code !~ '^[A-Z]{2}$'
    or p_statement_keys is null
  then
    raise exception using errcode = '22023', message = 'invalid signature request';
  end if;

  select sp.id into v_actor_parent
  from public.draft_participant_slots s
  join public.subject_principals sp on sp.id = s.principal_id
  where s.embryo_draft_id = v_draft.id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'current'
    and sp.account_id = p_account_id
    and sp.status = 'active'
  order by s.slot_kind
  limit 1;

  case p_artifact_key
    when 'consent.upload-embryo' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      if v_draft.upload_situation = 'own_embryos' then
        v_signer := v_actor_parent;
        v_keys := private.embryo_statement_keys_v1('consent.upload-embryo', 'parent');
        v_purpose := 'embryo-upload-parent-class';
        v_role := 'parent';
      else
        v_signer := v_draft.uploader_principal_id;
        v_keys := private.embryo_statement_keys_v1('consent.upload-embryo', 'uploader');
        v_purpose := 'embryo-upload-uploader-class';
        v_role := 'uploader';
      end if;
    when 'attestation.embryo-parentage' then
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-parentage-attestation';
      v_kind := 'genetic_parent';
      v_role := 'parent';
    when 'attestation.embryo-disposition-rights' then
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-disposition-rights-attestation';
      v_kind := 'disposition_rights';
      v_role := 'parent';
    when 'attestation.embryo-single-parent-basis' then
      if v_draft.basis_case = 'true_two_parent' then
        raise exception using errcode = '22023', message = 'basis does not take this artifact';
      end if;
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-single-parent-basis-attestation';
      v_kind := 'single_parent_authority';
      v_role := 'parent';
    when 'charter.future-person' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      v_signer := v_draft.uploader_principal_id;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'future-person-charter-acknowledgement';
      v_kind := 'future_person_acknowledgement';
      v_role := 'owner';
    when 'disclosure.insurance-and-discrimination' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      v_signer := v_draft.uploader_principal_id;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'disclosure-acknowledgement';
      v_role := 'owner';
    else
      raise exception using errcode = '42501', message = 'artifact unavailable';
  end case;

  if v_signer is null then
    raise exception using errcode = '42501', message = 'not a current parent';
  end if;
  if p_statement_keys <> v_keys then
    raise exception using errcode = '22023', message = 'statement keys differ from the published set';
  end if;

  v_artifact := private.current_embryo_artifact_v1(p_artifact_key, p_artifact_version);

  select cs.id into v_signature_id
  from public.consent_signatures cs
  where cs.signer_principal_id = v_signer
    and cs.artifact_key = v_artifact.artifact_key
    and cs.artifact_version = v_artifact.version
    and cs.target_kind = 'cohort_draft'
    and cs.target_id = v_draft.id
    and cs.purpose = v_purpose
  order by cs.signed_at desc
  limit 1;
  if v_signature_id is not null then
    return v_signature_id;
  end if;

  select * into v_profile from public.profiles where id = p_account_id;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signer, p_account_id, 'cohort_draft', v_draft.id,
    v_purpose, v_keys, p_signing_name_ciphertext,
    p_jurisdiction_code, coalesce(v_profile.jurisdiction_revision, 1)
  ) returning id into v_signature_id;

  if v_kind is not null then
    insert into public.attestations (
      signature_id, principal_id, target_kind, target_id, kind,
      statement_keys, affirmed
    ) values (
      v_signature_id, v_signer, 'cohort_draft', v_draft.id, v_kind,
      v_keys, true
    );
  end if;

  perform private.append_legal_audit_event(
    'embryo.artifact.signed', null, 'api.consents', 'accepted',
    jsonb_build_object(
      'artifact_key', v_artifact.artifact_key, 'version', v_artifact.version,
      'role', v_role
    )
  );

  return v_signature_id;
end;
$$;

-- Same authority and operation body; acquire the shared lock first.
create or replace function public.create_embryo_draft_invitation_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_contact_hmac text,
  p_idempotency_key text,
  p_token_nonce text,
  p_test_jurisdiction boolean
)
returns table (
  invitation_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_slot public.draft_participant_slots%rowtype;
  v_contact public.encrypted_contact_references%rowtype;
  v_invitation_id uuid;
  v_outbox_id uuid;
  v_placeholder_hash text;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if not p_test_jurisdiction
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '42501', message = 'invitation unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'invitation_create',
    'cohort_draft', p_draft_id
  );

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_draft_id
  for update;
  if v_draft.id is null
    or v_draft.owner_account_id <> p_account_id
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  -- The uploader's own class artifact comes first (uploaderArtifactPrecondition).
  if not exists (
    select 1
    from public.consent_signatures cs
    where cs.signer_account_id = p_account_id
      and cs.artifact_key = 'consent.upload-embryo'
      and cs.target_kind = 'cohort_draft'
      and cs.target_id = v_draft.id
  ) then
    raise exception using errcode = '42501', message = 'uploader artifact missing';
  end if;

  select m.target_id into v_invitation_id
  from public.mail_outbox m
  where m.idempotency_key = p_idempotency_key
    and m.template_id = 'co-parent-invitation';
  if v_invitation_id is not null then
    return query select v_invitation_id, v_draft.fixed_expires_at;
    return;
  end if;

  if private.invitation_contact_barred_v1(p_contact_hmac) then
    return query select null::uuid, v_draft.fixed_expires_at;
    return;
  end if;

  select s.* into v_slot
  from public.draft_participant_slots s
  join public.subject_principals sp on sp.id = s.principal_id
  join public.encrypted_contact_references ecr
    on ecr.principal_id = sp.id and ecr.status = 'current'
  where s.embryo_draft_id = v_draft.id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'pending'
    and sp.status = 'pending'
    and ecr.contact_hmac = p_contact_hmac
    and not exists (
      select 1 from public.subject_invitations si
      where si.invitee_principal_id = sp.id
        and si.status in ('pending', 'accepted')
    )
  order by s.slot_kind
  limit 1
  for update of s;
  if v_slot.id is null then
    return query select null::uuid, v_draft.fixed_expires_at;
    return;
  end if;

  select ecr.* into v_contact
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_slot.principal_id and ecr.status = 'current'
  order by ecr.created_at desc
  limit 1;

  v_placeholder_hash := encode(extensions.digest(
    extensions.gen_random_bytes(32), 'sha256'
  ), 'hex');

  insert into public.subject_invitations (
    target_kind, target_id, inviter_principal_id, invitee_principal_id,
    email_hmac, email_encrypted, token_hash, invitation_kind, status,
    invitation_revision, expires_at
  ) values (
    'cohort_draft', v_draft.id, v_draft.uploader_principal_id, v_slot.principal_id,
    p_contact_hmac, v_contact.contact_ciphertext, v_placeholder_hash,
    'co_parent', 'pending', 1, v_draft.fixed_expires_at
  ) returning id into v_invitation_id;

  v_outbox_id := private.enqueue_embryo_principal_mail_v1(
    v_slot.principal_id, 'co-parent-invitation', 'co-parent-invitation',
    'subject_invitation', v_invitation_id, '{}'::jsonb, p_idempotency_key,
    v_draft.fixed_expires_at, 'co-parent-invitation', v_invitation_id
  );
  if v_outbox_id is null then
    raise exception using errcode = '55000', message = 'contact unavailable';
  end if;

  insert into public.invitation_candidates (
    invitation_id, draft_slot_id, contact_reference_id,
    candidate_revision, state
  ) values (v_invitation_id, v_slot.id, v_contact.id, 1, 'issued');

  perform private.append_legal_audit_event(
    'invitation.issued', null, 'api.invitations', 'accepted',
    jsonb_build_object('invitation_kind', 'co_parent', 'revision', 1)
  );

  return query select v_invitation_id, v_draft.fixed_expires_at;
end;
$$;

-- Same authority and operation body; acquire the shared lock first.
create or replace function public.finalize_embryo_cohort_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_insurance_ack_id uuid,
  p_charter_ack_id uuid,
  p_token_nonce text
)
returns table (
  cohort_id uuid,
  embryo_count integer,
  recipient_set_revision bigint,
  key_revision bigint,
  caller_state text,
  cards jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_authority record;
  v_parent uuid;
  v_missing text[] := '{}'::text[];
  v_upload_version integer;
  v_parentage_version integer;
  v_rights_version integer;
  v_single_version integer;
  v_disclosure_version integer;
  v_charter_version integer;
  v_single_signature uuid;
  v_review_id uuid;
  v_evidence_id uuid;
  v_evidence_kind text;
  v_cohort_id uuid;
  v_retention_deadline timestamptz := clock_timestamp() + interval '24 months';
  v_ordinal integer;
  v_subject_id uuid;
  v_embryo_id uuid;
  v_recipient uuid;
  v_actor_principal uuid;
  v_record_key text;
  v_cards jsonb := '[]'::jsonb;
  v_signature_ids uuid[];
  v_fingerprint text;
  v_set_kind text;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_draft_id
  for update;
  if v_draft.id is null
    or v_draft.owner_account_id <> p_account_id
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_finalize',
    'cohort_draft', v_draft.id
  );

  select * into v_authority
  from private.resolve_embryo_basis_authority_v1(v_draft.id);

  select a.version into v_upload_version from public.consent_artifacts a
    where a.artifact_key = 'consent.upload-embryo' and a.superseded_at is null;
  select a.version into v_parentage_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-parentage' and a.superseded_at is null;
  select a.version into v_rights_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-disposition-rights' and a.superseded_at is null;
  select a.version into v_single_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-single-parent-basis' and a.superseded_at is null;
  select a.version into v_disclosure_version from public.consent_artifacts a
    where a.artifact_key = 'disclosure.insurance-and-discrimination' and a.superseded_at is null;
  select a.version into v_charter_version from public.consent_artifacts a
    where a.artifact_key = 'charter.future-person' and a.superseded_at is null;

  -- caseArtifactMatrix: the common artifacts for every required principal.
  foreach v_parent in array v_authority.required_upload_principals loop
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'consent.upload-embryo'
        and cs.artifact_version = v_upload_version
        and cs.purpose = 'embryo-upload-parent-class'
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'upload-embryo');
    end if;
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'attestation.embryo-parentage'
        and cs.artifact_version = v_parentage_version
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'parentage');
    end if;
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'attestation.embryo-disposition-rights'
        and cs.artifact_version = v_rights_version
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'disposition-rights');
    end if;
  end loop;

  -- The basis-specific additional artifact and reviewed evidence.
  if v_authority.basis_case = 'true_two_parent' then
    if exists (
      select 1 from public.consent_signatures cs
      where cs.artifact_key = 'attestation.embryo-single-parent-basis'
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      raise exception using errcode = '55000', message = 'single-parent basis artifact present';
    end if;
  else
    select cs.id into v_single_signature
    from public.consent_signatures cs
    where cs.signer_principal_id = v_authority.required_upload_principals[1]
      and cs.artifact_key = 'attestation.embryo-single-parent-basis'
      and cs.artifact_version = v_single_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    order by cs.signed_at desc
    limit 1;
    if v_single_signature is null then
      v_missing := array_append(v_missing, 'single-parent-basis');
    end if;
  end if;

  if v_authority.basis_case in ('parent_deceased', 'sole_legal_authority') then
    v_evidence_kind := case when v_authority.basis_case = 'parent_deceased'
      then 'parent-death-certificate' else 'sole-disposition-authority' end;
    select lr.id, re.id into v_review_id, v_evidence_id
    from public.legal_reviews lr
    join public.reviewed_evidence re on re.review_id = lr.id
    where lr.target_kind = 'single_parent_basis'
      and lr.target_id = v_draft.id
      and lr.decision = 'approved'
      and re.evidence_kind = v_evidence_kind
      and re.purged_at is null
    order by lr.review_revision desc, re.evidence_revision desc
    limit 1;
    if v_review_id is null then
      v_missing := array_append(v_missing, 'reviewed-evidence');
    end if;
  end if;

  if v_draft.upload_class = 'embryo_third_party' and not exists (
    select 1 from public.consent_signatures cs
    where cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.artifact_key = 'consent.upload-embryo'
      and cs.artifact_version = v_upload_version
      and cs.purpose = 'embryo-upload-uploader-class'
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'upload-embryo');
  end if;

  if p_insurance_ack_id is null or not exists (
    select 1 from public.consent_signatures cs
    where cs.id = p_insurance_ack_id
      and cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.signer_account_id = p_account_id
      and cs.artifact_key = 'disclosure.insurance-and-discrimination'
      and cs.artifact_version = v_disclosure_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'insurance-disclosure');
  end if;
  if p_charter_ack_id is null or not exists (
    select 1 from public.consent_signatures cs
    where cs.id = p_charter_ack_id
      and cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.signer_account_id = p_account_id
      and cs.artifact_key = 'charter.future-person'
      and cs.artifact_version = v_charter_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'future-person-charter');
  end if;

  if cardinality(v_missing) > 0 then
    select array_agg(distinct m order by m) into v_missing from unnest(v_missing) as m;
    raise exception using
      errcode = '55000',
      message = 'consent_required',
      detail = array_to_string(v_missing, ',');
  end if;

  -- The acting parent must be a required principal (embryo_own) or the
  -- class-D uploader (embryo_third_party); ownership adds nothing else.
  v_actor_principal := private.acting_embryo_principal_v1(
    p_account_id, v_authority.required_upload_principals
  );
  if v_draft.upload_class = 'embryo_own' and v_actor_principal is null then
    raise exception using errcode = '42501', message = 'not a required principal';
  end if;

  select coalesce(array_agg(cs.id order by cs.id), '{}'::uuid[]) into v_signature_ids
  from public.consent_signatures cs
  where cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id;
  v_fingerprint := encode(extensions.digest(convert_to(
    concat_ws(':', v_authority.basis_case, v_draft.basis_revision::text,
      array_to_string(v_signature_ids, ',')),
    'UTF8'), 'sha256'), 'hex');

  insert into public.embryo_cohorts (
    draft_id, owner_account_id, upload_class, basis_case, basis_revision,
    participant_set_revision, donor_attribution_revision,
    recipient_set_revision, key_revision, lifecycle_revision, status,
    embryo_count, retention_expires_at
  ) values (
    v_draft.id, p_account_id, v_draft.upload_class, v_authority.basis_case,
    v_draft.basis_revision, 1, 1, 1, 1, 1, 'upload_pending',
    v_draft.embryo_count, v_retention_deadline
  ) returning id into v_cohort_id;

  foreach v_set_kind in array array[
    'required_upload_principals', 'disposition_authorities',
    'notice_recipients', 'record_key_recipients'
  ] loop
    foreach v_parent in array v_authority.required_upload_principals loop
      insert into public.embryo_participant_sets (
        cohort_id, set_kind, principal_id, set_revision, membership_revision
      ) values (v_cohort_id, v_set_kind, v_parent, 1, 1);
      insert into public.embryo_draft_participants (
        draft_id, set_kind, principal_id, set_revision, membership_revision
      ) values (v_draft.id, v_set_kind, v_parent, 1, 1)
      on conflict do nothing;
    end loop;
  end loop;

  insert into public.embryo_basis_bindings (
    cohort_id, basis_case, basis_revision, participant_set_revision,
    case_artifact_signature_id, reviewed_evidence_id, legal_review_id,
    artifact_matrix_fingerprint
  ) values (
    v_cohort_id, v_authority.basis_case, v_draft.basis_revision, 1,
    v_single_signature, v_evidence_id, v_review_id, v_fingerprint
  );

  insert into public.embryo_donor_attributions (
    cohort_id, donor_slot, classification, attribution_revision
  )
  select v_cohort_id, 'parent_b', 'anonymous', 1
  where v_authority.basis_case = 'anonymous_donor';

  for v_ordinal in 0..(v_draft.embryo_count - 1) loop
    insert into public.subjects (
      owner_account_id, subject_account_id, subject_class, upload_class,
      display_label, lifecycle, cohort_id
    ) values (
      p_account_id, null, 'embryo', v_draft.upload_class,
      'Embryo ' || (v_ordinal + 1)::text, 'quarantined', v_cohort_id
    ) returning id into v_subject_id;

    insert into public.embryos (
      cohort_id, subject_id, sample_ordinal, status, retention_expires_at,
      closing_date, closing_date_state, date_revision
    ) values (
      v_cohort_id, v_subject_id, v_ordinal, 'pending', v_retention_deadline,
      v_retention_deadline::date, 'provisional_until_terminal_ordinal_resolution', 1
    ) returning id into v_embryo_id;

    foreach v_recipient in array v_authority.record_key_recipients loop
      insert into public.future_person_record_key_print_rights (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, status, delivery_kind
      ) values (v_embryo_id, v_recipient, 1, 1, 'unconsumed', 'initial');
    end loop;

    if v_actor_principal is not null then
      v_record_key := private.embryo_record_key_v1();
      insert into public.future_person_record_key_hashes (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, key_hash, status
      ) values (
        v_embryo_id, v_actor_principal, 1, 1,
        encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
        'current'
      );
      update public.future_person_record_key_print_rights
      set status = 'consumed', consumed_at = v_now
      where embryo_id = v_embryo_id
        and recipient_principal_id = v_actor_principal
        and status = 'unconsumed';
      v_cards := v_cards || jsonb_build_object(
        'embryo_id', v_embryo_id,
        'display_label', 'Embryo ' || (v_ordinal + 1)::text,
        'record_key', v_record_key,
        'closing_date_iso', to_char(v_retention_deadline::date, 'YYYY-MM-DD'),
        'closing_date_state', 'provisional_until_terminal_ordinal_resolution',
        'date_revision', 1
      );
    end if;
  end loop;

  update public.embryo_cohort_drafts
  set state = 'finalized', finalized_at = v_now
  where id = v_draft.id;

  update public.retention_due_phases
  set status = 'cancelled', terminal_outcome_code = 'draft_finalized',
      completed_at = v_now
  where retention_id = 'embryo.cohort-draft-30d'
    and target_kind = 'cohort' and target_id = v_draft.id
    and status = 'pending';
  update public.purge_manifests pm
  set state = 'cancelled'
  from public.retention_rows rr
  where pm.retention_row_id = rr.id
    and rr.retention_id = 'embryo.cohort-draft-30d'
    and rr.target_kind = 'cohort' and rr.target_id = v_draft.id
    and pm.state = 'frozen';
  update public.retention_rows
  set state = 'cancelled', ended_at = v_now
  where retention_id = 'embryo.cohort-draft-30d'
    and target_kind = 'cohort' and target_id = v_draft.id
    and state in ('scheduled', 'active');

  perform private.append_legal_audit_event(
    'embryo.cohort.finalized', null, 'api.embryo-cohorts', 'accepted',
    jsonb_build_object(
      'basis_case', v_authority.basis_case,
      'embryo_count', v_draft.embryo_count,
      'caller_state', case when v_actor_principal is null
        then 'not_a_card_recipient' else 'delivered_inline' end
    )
  );

  return query select
    v_cohort_id, v_draft.embryo_count::integer, 1::bigint, 1::bigint,
    case when v_actor_principal is null
      then 'not_a_card_recipient' else 'delivered_inline' end,
    v_cards;
end;
$$;

-- Same authority and operation body; acquire the shared lock first.
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

-- Same authority and operation body; acquire the shared lock first.
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
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
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
  if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then
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

-- Same authority and operation body; acquire the shared lock first.
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
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
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
  if private.invitation_contact_barred_v1(p_contact_hmac) then
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

-- Same authority and operation body; acquire the shared lock first.
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

-- Same authority and operation body; acquire the shared lock first.
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
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
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

-- Same authority and operation body; acquire the shared lock first.
create or replace function public.claim_mail_outbox()
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
  perform private.lock_invitation_transitions_v1();
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.invitation_terminal_notice_id is null
    and m.state in ('queued', 'claimed')
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
            m.purpose in ('adult-subject-invitation', 'co-parent-invitation')
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  -- A live contact is not enough: readiness belongs to this exact source.
  -- Invalidated rows retain their ordinary history/retention rules.
  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'file_target_unavailable'
  where m.template_id = 'report-ready' and m.state in ('queued', 'claimed')
    and not (m.target_kind = 'genome_file' and exists (
        select 1 from public.genome_files f
        join public.subject_principals sp on sp.id = m.recipient_principal_id
        where f.id = m.target_id and f.user_id = sp.account_id
          and f.subject_id = sp.subject_id and f.status = 'annotated'
          and not exists (select 1 from private.genome_file_deletions d where d.file_id = f.id)
      ));

  -- Recheck the exact invitation and all stored contact-key aliases before
  -- token creation, under the same transition lock as refusal/acceptance.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='invitation_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose in('adult-subject-invitation','co-parent-invitation')
    and not private.invitation_mail_current_v1(m);

  select m.* into v_outbox
  from public.mail_outbox m
  where m.invitation_terminal_notice_id is null and (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
    and (m.template_id <> 'report-ready' or (m.target_kind = 'genome_file' and exists (
        select 1 from public.genome_files f
        join public.subject_principals sp on sp.id = m.recipient_principal_id
        where f.id = m.target_id and f.user_id = sp.account_id
          and f.subject_id = sp.subject_id and f.status = 'annotated'
          and not exists (select 1 from private.genome_file_deletions d where d.file_id = f.id)
      )))
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

  if v_outbox.token_purpose in ('adult-subject-invitation', 'co-parent-invitation') then
    if not private.invitation_mail_current_v1(v_outbox) then return; end if;
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
