-- One creation event for embryo principal mail. Preserve the ten-argument
-- identity, all existing grants, every explicit fixed expiry and replay.
-- The strict expires_at > created_at and <= created_at + 30 days checks are
-- unchanged. Separate default expression evaluations do not set these two
-- fields on this producer; no deadline is clamped or anchor inferred from it.
-- The observed failing run had an expiry anchor 20ms after row creation;
-- source/catalog already used clock_timestamp(), so a now() cause is not
-- asserted. Runtime clock binding/order remains subject to fresh PG proof.

create or replace function private.enqueue_embryo_principal_mail_v1(
  p_principal_id uuid,
  p_template_id text,
  p_purpose text,
  p_target_kind text,
  p_target_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_token_purpose text,
  p_token_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.subject_principals%rowtype;
  v_contact public.encrypted_contact_references%rowtype;
  v_outbox_id uuid;
  v_created_at timestamptz;
begin
  select m.id into v_outbox_id
  from public.mail_outbox m
  where m.idempotency_key = p_idempotency_key;
  if v_outbox_id is not null then
    return v_outbox_id;
  end if;

  select sp.* into v_principal
  from public.subject_principals sp
  where sp.id = p_principal_id
  for update;
  if v_principal.id is null or v_principal.status not in ('active', 'pending') then
    return null;
  end if;

  select ecr.* into v_contact
  from public.encrypted_contact_references ecr
  where ecr.principal_id = p_principal_id
    and ecr.status = 'current'
    and ecr.contact_ciphertext is not null
  order by ecr.created_at desc
  limit 1
  for update;
  if v_contact.id is null then
    return null;
  end if;

  -- The mail worker delivers only while the contact's authority revision
  -- equals the principal's; keep them aligned.
  if v_contact.authority_revision <> v_principal.principal_revision then
    update public.encrypted_contact_references
    set authority_revision = v_principal.principal_revision
    where id = v_contact.id;
  end if;

  -- Queue creation is one event. Capture its wall-clock instant after the
  -- authority/contact locks, before constructing the row. Both timestamps
  -- use this same value; the caller's fixed expiry is preserved exactly.
  v_created_at := pg_catalog.clock_timestamp();
  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    token_purpose, token_target_id, template_payload, expires_at, created_at, not_before
  ) values (
    p_template_id, p_purpose, p_target_kind, p_target_id,
    p_principal_id, v_contact.id,
    v_principal.principal_revision, 1, p_idempotency_key,
    p_token_purpose, p_token_target_id, coalesce(p_payload, '{}'::jsonb),
    p_expires_at, v_created_at, v_created_at
  ) returning id into v_outbox_id;

  if p_token_purpose is not null then
    insert into public.token_candidates (
      outbox_id, purpose, target_kind, target_id, token_revision, state,
      expires_at
    ) values (
      v_outbox_id, p_token_purpose, p_target_kind, p_token_target_id, 1,
      'pending', p_expires_at
    );
  end if;

  return v_outbox_id;
end;
$$;
