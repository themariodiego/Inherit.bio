-- Durable, service-only mail delivery primitives. Recipient addresses remain
-- envelope-encrypted; workers claim due rows atomically and provider events
-- are joined through keyed hashes instead of durable provider identifiers.

alter table public.mail_outbox
  add column template_payload jsonb not null default '{}'::jsonb,
  add column claimed_at timestamptz,
  add column attempt_count smallint not null default 0
    check (attempt_count between 0 and 10),
  add column last_outcome_code text,
  add constraint mail_outbox_template_payload_object
    check (jsonb_typeof(template_payload) = 'object'),
  add constraint mail_outbox_provider_retention_limit
    check (expires_at <= created_at + interval '30 days');

create unique index mail_provider_attempts_message_hmac_idx
  on public.mail_provider_attempts (provider_message_id_hmac)
  where provider_message_id_hmac is not null;

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
  p_expires_at timestamptz
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
begin
  if p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_template_payload) <> 'object'
    or p_template_id not in ('report-ready', 'research-digest')
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '30 days'
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
      least(p_expires_at, clock_timestamp() + interval '30 days')
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
    p_template_payload, p_expires_at
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

create or replace function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea
)
language plpgsql
security definer
set search_path = ''
as $$
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
        and sp.status = 'active'
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  return query
  with candidate as (
    select m.id
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
    limit 1
  ),
  claimed as (
    update public.mail_outbox m
    set state = 'claimed',
        claimed_at = clock_timestamp(),
        attempt_count = (m.attempt_count + 1)::smallint,
        last_outcome_code = null
    from candidate c
    where m.id = c.id
    returning m.*
  )
  select
    c.id,
    c.template_id,
    c.template_payload,
    c.idempotency_key,
    c.attempt_count,
    ecr.contact_ciphertext
  from claimed c
  join public.encrypted_contact_references ecr
    on ecr.id = c.contact_reference_id;
end;
$$;

create or replace function public.complete_mail_attempt(
  p_outbox_id uuid,
  p_attempt_ordinal smallint,
  p_success boolean,
  p_provider_message_id_hmac text,
  p_outcome_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_attempt_id uuid;
  v_retry_minutes integer;
begin
  select * into strict v_outbox
  from public.mail_outbox
  where id = p_outbox_id
  for update;

  if v_outbox.state <> 'claimed'
    or v_outbox.attempt_count <> p_attempt_ordinal
    or p_attempt_ordinal not between 1 and 10
    or (p_success and p_provider_message_id_hmac !~ '^[0-9a-f]{64}$')
  then
    raise exception using errcode = '22023', message = 'invalid mail completion';
  end if;

  insert into public.mail_provider_attempts (
    outbox_id, attempt_ordinal, provider, provider_message_id_hmac,
    outcome_code, submitted_at, completed_at
  )
  values (
    p_outbox_id, p_attempt_ordinal, 'resend',
    case when p_success then p_provider_message_id_hmac else null end,
    left(coalesce(p_outcome_code, 'unknown'), 100),
    case when p_success then clock_timestamp() else null end,
    clock_timestamp()
  )
  on conflict (outbox_id, attempt_ordinal) do update
  set provider_message_id_hmac = excluded.provider_message_id_hmac,
      outcome_code = excluded.outcome_code,
      submitted_at = excluded.submitted_at,
      completed_at = excluded.completed_at
  returning id into v_attempt_id;

  if p_success then
    insert into public.mail_deliveries (
      outbox_id, provider_attempt_id, status, occurred_at
    )
    values (p_outbox_id, v_attempt_id, 'accepted', clock_timestamp())
    on conflict (outbox_id) do update
    set provider_attempt_id = excluded.provider_attempt_id,
        status = 'accepted',
        occurred_at = excluded.occurred_at,
        recorded_at = clock_timestamp();

    update public.mail_outbox
    set state = 'submitted', claimed_at = null,
        last_outcome_code = left(coalesce(p_outcome_code, 'accepted'), 100)
    where id = p_outbox_id;
  elsif p_attempt_ordinal < 10 and v_outbox.expires_at > clock_timestamp() then
    v_retry_minutes := least(
      60,
      power(2, greatest(0, p_attempt_ordinal::integer - 1))::integer
    );
    update public.mail_outbox
    set state = 'queued', claimed_at = null,
        not_before = clock_timestamp() + (interval '1 minute' * v_retry_minutes),
        last_outcome_code = left(coalesce(p_outcome_code, 'provider_error'), 100)
    where id = p_outbox_id;
  else
    update public.mail_outbox
    set state = 'failed', claimed_at = null,
        last_outcome_code = left(coalesce(p_outcome_code, 'provider_error'), 100)
    where id = p_outbox_id;
  end if;
end;
$$;

create or replace function public.record_resend_mail_event(
  p_provider_message_id_hmac text,
  p_provider_event_hmac text,
  p_status text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.mail_provider_attempts%rowtype;
begin
  if p_provider_message_id_hmac !~ '^[0-9a-f]{64}$'
    or p_provider_event_hmac !~ '^[0-9a-f]{64}$'
    or p_status not in (
      'accepted', 'delivered', 'bounced', 'complained',
      'reviewed_undeliverable'
    )
  then
    raise exception using errcode = '22023', message = 'invalid mail event';
  end if;

  select * into v_attempt
  from public.mail_provider_attempts
  where provider_message_id_hmac = p_provider_message_id_hmac
  for update;

  if not found then
    return false;
  end if;

  update public.mail_deliveries
  set status = case
        when status = 'complained' or p_status = 'complained'
          then 'complained'
        when status in ('bounced', 'reviewed_undeliverable')
          then status
        when p_status in ('bounced', 'reviewed_undeliverable')
          then p_status
        when status = 'delivered' or p_status = 'delivered'
          then 'delivered'
        else 'accepted'
      end,
      provider_event_hmac = p_provider_event_hmac,
      occurred_at = p_occurred_at,
      recorded_at = clock_timestamp()
  where outbox_id = v_attempt.outbox_id;

  update public.mail_outbox
  set state = case
      when state = 'failed' then 'failed'
      when p_status in ('bounced', 'complained', 'reviewed_undeliverable')
        then 'failed'
      when p_status = 'delivered' then 'delivered'
      else state
    end,
    last_outcome_code = 'resend.' || p_status
  where id = v_attempt.outbox_id;

  return true;
end;
$$;

revoke all on function public.enqueue_account_mail(
  uuid, bytea, text, text, text, text, uuid, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_mail_outbox()
  from public, anon, authenticated;
revoke all on function public.complete_mail_attempt(
  uuid, smallint, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.record_resend_mail_event(
  text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.enqueue_account_mail(
  uuid, bytea, text, text, text, text, uuid, jsonb, text, timestamptz
) to service_role;
grant execute on function public.claim_mail_outbox() to service_role;
grant execute on function public.complete_mail_attempt(
  uuid, smallint, boolean, text, text
) to service_role;
grant execute on function public.record_resend_mail_event(
  text, text, text, timestamptz
) to service_role;
