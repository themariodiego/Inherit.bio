-- Put the contact keyring and the invitation-attempt quota in front of every
-- RPC that receives a contact digest from the application.
--
-- Each authority body moves unchanged into `private` as a `*_core_v1`
-- function no API role can call. A private definer takes the shared
-- invitation transition lock first (the lock checks in
-- scripts/invitation-transition-locks.mjs still see it before any authority
-- read), then:
--
--  1. for invitation creation only, reserves and increments the
--     global-contact-refusal-bar-v1.quotaAuthority buckets before any
--     identity, resource, token or target match. A missing key set fails the
--     whole call; an exhausted quota writes nothing else and returns the same
--     empty receipt a barred address gets;
--  2. resolves the presented contact digest set against the keyring, failing
--     closed when a usable revision is missing (hmac_keyring migration);
--  3. declares the set for this transaction, so the body's own bar checks
--     match every usable revision and the rows it writes carry the revision
--     of the digest they store;
--  4. hands the body the one digest it compares: the revision the stored row
--     was written under when one is being matched, otherwise the active one;
--  5. clears the declaration once the body returns, so no later statement in
--     the same transaction inherits it.
--
-- The public names keep their argument lists as a prefix, with the new
-- arguments defaulted, as security-invoker doors granted only to
-- service_role.

-- ---------------------------------------------------------------------------
-- api.embryo-cohort-drafts: contacts named in a new cohort draft.
alter function public.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean
) set schema private;
alter function private.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean
) rename to create_embryo_cohort_draft_core_v1;
revoke all on function private.create_embryo_cohort_draft_core_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean
) from public, anon, authenticated, service_role;

create function private.create_embryo_cohort_draft_keyed_v1(
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
  p_test_jurisdiction boolean,
  p_owner_contact_hmac_set jsonb,
  p_contact_hmac_sets jsonb
)
returns table (draft_id uuid, expires_at timestamptz, required_principal_slots text[])
language plpgsql security definer set search_path = '' as $$
declare
  v_active text;
  v_owner jsonb;
  v_set jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_contacts text[];
  v_count integer;
  v_i integer;
begin
  perform private.lock_invitation_transitions_v1();
  v_active := private.hmac_active_revision_v1('contact')::text;

  v_owner := private.resolve_hmac_set_v1(
    'contact', p_owner_contact_hmac, p_owner_contact_hmac_set);
  if v_owner is not null then v_groups := v_groups || jsonb_build_array(v_owner); end if;

  if p_contact_hmac_sets is null then
    v_contacts := p_contact_hmacs;
    v_count := coalesce(cardinality(p_contact_hmacs), 0);
  else
    if jsonb_typeof(p_contact_hmac_sets) <> 'array'
      or jsonb_array_length(p_contact_hmac_sets) > 2
      or (p_contact_hmacs is not null
        and cardinality(p_contact_hmacs) <> jsonb_array_length(p_contact_hmac_sets))
    then
      raise exception using errcode = '22023', message = 'invalid contact';
    end if;
    v_contacts := '{}'::text[];
    v_count := jsonb_array_length(p_contact_hmac_sets);
  end if;
  for v_i in 1..v_count loop
    v_set := private.resolve_hmac_set_v1(
      'contact', p_contact_hmacs[v_i], p_contact_hmac_sets -> (v_i - 1));
    if v_set is not null then
      v_groups := v_groups || jsonb_build_array(v_set);
      if p_contact_hmac_sets is not null then
        v_contacts := v_contacts || (v_set ->> v_active);
      end if;
    end if;
  end loop;
  perform private.declare_contact_alias_groups_v1(v_groups);

  return query select * from private.create_embryo_cohort_draft_core_v1(
    p_account_id, p_session_id, p_upload_situation, p_basis_case, p_embryo_count,
    p_owner_contact_ciphertext, coalesce(v_owner ->> v_active, p_owner_contact_hmac),
    p_contact_ciphertexts, v_contacts, p_token_nonce, p_test_jurisdiction);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
end;
$$;
revoke all on function private.create_embryo_cohort_draft_keyed_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_embryo_cohort_draft_keyed_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean, jsonb, jsonb
) to service_role;

create function public.create_embryo_cohort_draft_v1(
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
  p_test_jurisdiction boolean,
  p_owner_contact_hmac_set jsonb default null,
  p_contact_hmac_sets jsonb default null
)
returns table (draft_id uuid, expires_at timestamptz, required_principal_slots text[])
language sql security invoker set search_path = '' as $$
  select * from private.create_embryo_cohort_draft_keyed_v1(
    p_account_id, p_session_id, p_upload_situation, p_basis_case, p_embryo_count,
    p_owner_contact_ciphertext, p_owner_contact_hmac, p_contact_ciphertexts,
    p_contact_hmacs, p_token_nonce, p_test_jurisdiction,
    p_owner_contact_hmac_set, p_contact_hmac_sets);
$$;
revoke all on function public.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- api.invitations (co-parent body): quota, then the keyed slot match.
alter function public.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean
) set schema private;
alter function private.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean
) rename to create_embryo_draft_invitation_core_v1;
revoke all on function private.create_embryo_draft_invitation_core_v1(
  uuid, uuid, uuid, text, text, text, boolean
) from public, anon, authenticated, service_role;

create function private.create_embryo_draft_invitation_keyed_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_contact_hmac text,
  p_idempotency_key text,
  p_token_nonce text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb,
  p_quota_keys jsonb
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_contact text := p_contact_hmac;
  v_slot_contact text;
begin
  perform private.lock_invitation_transitions_v1();
  if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then
    return query select null::uuid, null::timestamptz;
    return;
  end if;

  v_set := private.resolve_hmac_set_v1('contact', p_contact_hmac, p_contact_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
    -- A pending parent contact keeps the revision it was written under; the
    -- body matches the slot by that exact digest.
    select e.contact_hmac into v_slot_contact
    from public.draft_participant_slots s
    join public.subject_principals sp on sp.id = s.principal_id
    join public.encrypted_contact_references e
      on e.principal_id = sp.id and e.status = 'current'
    where s.embryo_draft_id = p_draft_id
      and s.slot_kind in ('parent_a', 'parent_b') and s.state = 'pending'
      and sp.status = 'pending'
      and e.contact_hmac in (select x.value from jsonb_each_text(v_set) x)
    order by s.slot_kind
    limit 1;
    v_contact := coalesce(v_slot_contact,
      v_set ->> private.hmac_active_revision_v1('contact')::text);
  end if;

  return query select * from private.create_embryo_draft_invitation_core_v1(
    p_account_id, p_session_id, p_draft_id, v_contact, p_idempotency_key,
    p_token_nonce, p_test_jurisdiction);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
end;
$$;
revoke all on function private.create_embryo_draft_invitation_keyed_v1(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_embryo_draft_invitation_keyed_v1(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, jsonb
) to service_role;

create function public.create_embryo_draft_invitation_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_contact_hmac text,
  p_idempotency_key text,
  p_token_nonce text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb default null,
  p_quota_keys jsonb default null
)
returns table (invitation_id uuid, expires_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.create_embryo_draft_invitation_keyed_v1(
    p_account_id, p_session_id, p_draft_id, p_contact_hmac, p_idempotency_key,
    p_token_nonce, p_test_jurisdiction, p_contact_hmac_set, p_quota_keys);
$$;
revoke all on function public.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- api.subject-drafts (adult invitation): quota, then the keyed bar check.
alter function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean
) set schema private;
alter function private.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean
) rename to create_adult_subject_invitation_core_v1;
revoke all on function private.create_adult_subject_invitation_core_v1(
  uuid, bytea, text, text, boolean
) from public, anon, authenticated, service_role;

create function private.create_adult_subject_invitation_keyed_v1(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_idempotency_key text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb,
  p_quota_keys jsonb
)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
begin
  perform private.lock_invitation_transitions_v1();
  if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then
    -- The same shape a barred address returns: no subject, draft or mail.
    return query select null::uuid, null::uuid, clock_timestamp() + interval '30 days';
    return;
  end if;

  v_set := private.resolve_hmac_set_v1('contact', p_contact_hmac, p_contact_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
  end if;

  return query select * from private.create_adult_subject_invitation_core_v1(
    p_account_id, p_contact_ciphertext,
    coalesce(v_set ->> private.hmac_active_revision_v1('contact')::text, p_contact_hmac),
    p_idempotency_key, p_test_jurisdiction);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
end;
$$;
revoke all on function private.create_adult_subject_invitation_keyed_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_adult_subject_invitation_keyed_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb
) to service_role;

create function public.create_adult_subject_invitation_v1(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_idempotency_key text,
  p_test_jurisdiction boolean,
  p_contact_hmac_set jsonb default null,
  p_quota_keys jsonb default null
)
returns table (invitation_id uuid, subject_id uuid, expires_at timestamptz)
language sql security invoker set search_path = '' as $$
  select * from private.create_adult_subject_invitation_keyed_v1(
    p_account_id, p_contact_ciphertext, p_contact_hmac, p_idempotency_key,
    p_test_jurisdiction, p_contact_hmac_set, p_quota_keys);
$$;
revoke all on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_adult_subject_invitation_v1(
  uuid, bytea, text, text, boolean, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- The account-address matches. A live invitation keeps the revision it was
-- written under until it ends, so the digest handed to the body is the
-- presented one under that revision: rotation strands no pending invitation
-- or rights session, and a retired revision is never presented.

-- The digest a body should compare with a stored one: the presented digest
-- under the stored row's own revision when it matches, otherwise the active
-- revision's digest (which the body then refuses).
create function private.presented_contact_digest_v1(
  p_set jsonb, p_stored_hmac text, p_stored_revision bigint
)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when p_stored_hmac is not null
      and p_set ->> p_stored_revision::text = p_stored_hmac then p_stored_hmac
    else p_set ->> private.hmac_active_revision_v1('contact')::text
  end;
$$;
revoke all on function private.presented_contact_digest_v1(jsonb, text, bigint)
  from public, anon, authenticated, service_role;

-- api.invitation-accept (co-parent).
alter function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) set schema private;
alter function private.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) rename to accept_embryo_co_parent_invitation_core_v1;
revoke all on function private.accept_embryo_co_parent_invitation_core_v1(
  text, uuid, text, bytea, text, text[], text[], text
) from public, anon, authenticated, service_role;

create function private.accept_embryo_co_parent_invitation_keyed_v1(
  p_session_hash text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_upload_statement_keys text[],
  p_parentage_statement_keys text[],
  p_token_nonce text,
  p_account_email_hmac_set jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_contact text := p_account_email_hmac;
  v_session public.rights_sessions%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_result uuid;
begin
  perform private.lock_invitation_transitions_v1();
  v_set := private.resolve_hmac_set_v1(
    'contact', p_account_email_hmac, p_account_email_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
    select rs.* into v_session from public.rights_sessions rs
    where rs.session_hash = p_session_hash and rs.purpose = 'co-parent-invitation'
      and rs.status = 'active' and rs.expires_at > clock_timestamp();
    if v_session.id is not null then
      v_invitation := private.current_co_parent_invitation_v1(
        v_session.token_hash_id, v_session.id);
    end if;
    v_contact := private.presented_contact_digest_v1(
      v_set, v_invitation.email_hmac, v_invitation.email_hmac_key_revision);
  end if;

  v_result := private.accept_embryo_co_parent_invitation_core_v1(
    p_session_hash, p_account_id, v_contact, p_signing_name_ciphertext,
    p_jurisdiction_code, p_upload_statement_keys, p_parentage_statement_keys,
    p_token_nonce);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
  return v_result;
end;
$$;
revoke all on function private.accept_embryo_co_parent_invitation_keyed_v1(
  text, uuid, text, bytea, text, text[], text[], text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.accept_embryo_co_parent_invitation_keyed_v1(
  text, uuid, text, bytea, text, text[], text[], text, jsonb
) to service_role;

create function public.accept_embryo_co_parent_invitation_v1(
  p_session_hash text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_upload_statement_keys text[],
  p_parentage_statement_keys text[],
  p_token_nonce text,
  p_account_email_hmac_set jsonb default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.accept_embryo_co_parent_invitation_keyed_v1(
    p_session_hash, p_account_id, p_account_email_hmac, p_signing_name_ciphertext,
    p_jurisdiction_code, p_upload_statement_keys, p_parentage_statement_keys,
    p_token_nonce, p_account_email_hmac_set);
$$;
revoke all on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text, jsonb
) to service_role;

-- api.withdraw, mailed-token entry point (adult subject).
alter function public.respond_adult_subject_invitation_v1(text, text, uuid, text)
  set schema private;
alter function private.respond_adult_subject_invitation_v1(text, text, uuid, text)
  rename to respond_adult_subject_invitation_core_v1;
revoke all on function private.respond_adult_subject_invitation_core_v1(text, text, uuid, text)
  from public, anon, authenticated, service_role;

create function private.respond_adult_subject_invitation_keyed_v1(
  p_token_hash text,
  p_action text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_account_email_hmac_set jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_contact text := p_account_email_hmac;
  v_token_id uuid;
  v_invitation public.subject_invitations%rowtype;
  v_result text;
begin
  perform private.lock_invitation_transitions_v1();
  v_set := private.resolve_hmac_set_v1(
    'contact', p_account_email_hmac, p_account_email_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
    select th.id into v_token_id from public.token_hashes th
    where th.token_hash = p_token_hash and th.status = 'current';
    if v_token_id is not null then
      v_invitation := private.current_adult_subject_invitation_v1(v_token_id, null);
    end if;
    v_contact := private.presented_contact_digest_v1(
      v_set, v_invitation.email_hmac, v_invitation.email_hmac_key_revision);
  end if;
  v_result := private.respond_adult_subject_invitation_core_v1(
    p_token_hash, p_action, p_account_id, v_contact);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
  return v_result;
end;
$$;
revoke all on function private.respond_adult_subject_invitation_keyed_v1(
  text, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.respond_adult_subject_invitation_keyed_v1(
  text, text, uuid, text, jsonb
) to service_role;

create function public.respond_adult_subject_invitation_v1(
  p_token_hash text,
  p_action text,
  p_account_id uuid default null,
  p_account_email_hmac text default null,
  p_account_email_hmac_set jsonb default null
)
returns text language sql security invoker set search_path = '' as $$
  select private.respond_adult_subject_invitation_keyed_v1(
    p_token_hash, p_action, p_account_id, p_account_email_hmac, p_account_email_hmac_set);
$$;
revoke all on function public.respond_adult_subject_invitation_v1(text, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.respond_adult_subject_invitation_v1(text, text, uuid, text, jsonb)
  to service_role;

-- api.withdraw, rights-session entry point (adult subject).
alter function public.respond_adult_subject_invitation_session_v1(
  text, text, text, uuid, text
) set schema private;
alter function private.respond_adult_subject_invitation_session_v1(
  text, text, text, uuid, text
) rename to respond_adult_subject_invitation_session_core_v1;
revoke all on function private.respond_adult_subject_invitation_session_core_v1(
  text, text, text, uuid, text
) from public, anon, authenticated, service_role;

create function private.respond_adult_subject_invitation_session_keyed_v1(
  p_session_hash text,
  p_action text,
  p_nonce text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_account_email_hmac_set jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_contact text := p_account_email_hmac;
  v_session public.rights_sessions%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_result text;
begin
  perform private.lock_invitation_transitions_v1();
  v_set := private.resolve_hmac_set_v1(
    'contact', p_account_email_hmac, p_account_email_hmac_set);
  if v_set is not null then
    perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
    select rs.* into v_session from public.rights_sessions rs
    where rs.session_hash = p_session_hash and rs.purpose = 'adult-subject-invitation'
      and rs.target_kind = 'subject' and rs.status = 'active'
      and rs.expires_at > clock_timestamp();
    if v_session.id is not null then
      v_invitation := private.current_adult_subject_invitation_v1(
        v_session.token_hash_id, v_session.id);
    end if;
    v_contact := private.presented_contact_digest_v1(
      v_set, v_invitation.email_hmac, v_invitation.email_hmac_key_revision);
  end if;
  v_result := private.respond_adult_subject_invitation_session_core_v1(
    p_session_hash, p_action, p_nonce, p_account_id, v_contact);
  perform private.declare_contact_alias_groups_v1('[]'::jsonb);
  return v_result;
end;
$$;
revoke all on function private.respond_adult_subject_invitation_session_keyed_v1(
  text, text, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.respond_adult_subject_invitation_session_keyed_v1(
  text, text, text, uuid, text, jsonb
) to service_role;

create function public.respond_adult_subject_invitation_session_v1(
  p_session_hash text,
  p_action text,
  p_nonce text,
  p_account_id uuid default null,
  p_account_email_hmac text default null,
  p_account_email_hmac_set jsonb default null
)
returns text language sql security invoker set search_path = '' as $$
  select private.respond_adult_subject_invitation_session_keyed_v1(
    p_session_hash, p_action, p_nonce, p_account_id, p_account_email_hmac,
    p_account_email_hmac_set);
$$;
revoke all on function public.respond_adult_subject_invitation_session_v1(
  text, text, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.respond_adult_subject_invitation_session_v1(
  text, text, text, uuid, text, jsonb
) to service_role;
