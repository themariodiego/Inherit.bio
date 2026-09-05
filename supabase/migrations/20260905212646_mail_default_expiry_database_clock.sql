-- Keep the existing ten-argument RPC identity and grants. Omitted/null expiry
-- delegates only the default mail deadline to the database clock; an explicit
-- deadline is preserved exactly and still rejected outside the existing cap.
-- Application/DB skew must never be addressed by adding retention slack.
create or replace function public.enqueue_account_mail(
  p_account_id uuid,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_template_id text,
  p_purpose text,
  p_target_kind text,
  p_target_id uuid,
  p_template_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.subject_principals%rowtype;
  v_contact_id uuid;
  v_outbox_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := coalesce(p_expires_at, v_now + interval '30 days');
begin
  if p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_template_payload) <> 'object'
    or p_template_id not in ('report-ready', 'research-digest', 'embryo-draft-expired')
    or v_expires_at <= v_now
    or v_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'invalid mail candidate';
  end if;

  select sp.*
  into strict v_principal
  from public.subject_principals sp
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
  order by sp.created_at
  limit 1
  for update;

  select ecr.id
  into v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id
    and ecr.contact_hmac = p_contact_hmac
    and ecr.status = 'current'
  order by ecr.created_at desc
  limit 1
  for update;

  if v_contact_id is null then
    update public.encrypted_contact_references
    set status = 'rotated', ended_at = clock_timestamp()
    where principal_id = v_principal.id
      and status = 'current';

    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    )
    values (
      v_principal.id, p_contact_ciphertext, p_contact_hmac, 1,
      v_principal.principal_revision, 'current'
    )
    returning id into v_contact_id;

    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    )
    values (
      v_contact_id, p_contact_hmac, 1, 'current',
      v_expires_at
    );
  end if;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at
  )
  values (
    p_template_id, p_purpose, p_target_kind, p_target_id,
    v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_idempotency_key,
    p_template_payload, v_expires_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    select id into strict v_outbox_id
    from public.mail_outbox
    where idempotency_key = p_idempotency_key;
  end if;

  return v_outbox_id;
end;
$$;
