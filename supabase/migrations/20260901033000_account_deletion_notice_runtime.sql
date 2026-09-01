-- Cancellable account-deletion notice period. Physical deletion remains a
-- retention-worker responsibility and may not begin before the fixed deadline.

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  request_account_revision bigint not null check (request_account_revision > 0),
  request_auth_session_revision bigint not null check (request_auth_session_revision > 0),
  principal_graph_revision bigint not null check (principal_graph_revision > 0),
  deletion_hold_revision bigint not null check (deletion_hold_revision > 0),
  state text not null default 'notice_period' check (state in (
    'notice_period', 'cancelled', 'delete_started', 'complete', 'failed'
  )),
  requested_at timestamptz not null,
  notice_ends_at timestamptz not null,
  delete_started_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (notice_ends_at = requested_at + interval '7 days'),
  check ((state = 'cancelled') = (cancelled_at is not null)),
  check ((state in ('delete_started', 'complete')) = (delete_started_at is not null)),
  check ((state = 'complete') = (completed_at is not null))
);

create unique index account_deletion_requests_one_active_idx
  on public.account_deletion_requests (account_id)
  where state in ('notice_period', 'delete_started');
create index account_deletion_requests_due_idx
  on public.account_deletion_requests (state, notice_ends_at, id);

create table public.account_operation_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  operation text not null check (operation in (
    'account_delete', 'account_delete_cancel'
  )),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes')
);

create index account_operation_nonces_expiry_idx
  on public.account_operation_nonces (expires_at);

alter table public.account_deletion_requests enable row level security;
alter table public.account_operation_nonces enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;
revoke all on table public.account_operation_nonces from anon, authenticated;
grant all on table public.account_deletion_requests to service_role;
grant all on table public.account_operation_nonces to service_role;

create or replace function private.validate_sensitive_account_session_v1(
  p_account_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session auth.sessions%rowtype;
begin
  select s.* into v_session
  from auth.sessions s
  where s.id = p_session_id and s.user_id = p_account_id
  for update;

  if v_session.id is null
    or v_session.created_at < clock_timestamp() - interval '15 minutes'
    or (v_session.not_after is not null and v_session.not_after <= clock_timestamp())
  then
    raise exception using errcode = '42501', message = 'recent_reauthentication_required';
  end if;

  if exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p_account_id and f.status::text = 'verified'
  ) and coalesce(v_session.aal::text, 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'mfa_required';
  end if;
end;
$$;

revoke all on function private.validate_sensitive_account_session_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.issue_account_operation_nonce_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_operation text,
  p_nonce_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  if p_operation not in ('account_delete', 'account_delete_cancel')
    or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  delete from public.account_operation_nonces
  where expires_at <= clock_timestamp() or consumed_at is not null;

  insert into public.account_operation_nonces (
    nonce_hash, account_id, session_id, operation, expires_at
  ) values (
    p_nonce_hash, p_account_id, p_session_id, p_operation, p_expires_at
  );
end;
$$;

revoke all on function public.issue_account_operation_nonce_v1(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.issue_account_operation_nonce_v1(
  uuid, uuid, text, text, timestamptz
) to service_role;

create or replace function public.request_account_deletion_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_notice_idempotency_key text
)
returns table (
  deletion_id uuid,
  status text,
  notice_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_profile public.profiles%rowtype;
  v_principal public.subject_principals%rowtype;
  v_graph_revision bigint;
  v_request public.account_deletion_requests%rowtype;
  v_retention_id uuid;
  v_contact_id uuid;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  if p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_notice_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_deletion_request';
  end if;

  update public.account_operation_nonces
  set consumed_at = v_now
  where nonce_hash = p_nonce_hash
    and account_id = p_account_id
    and session_id = p_session_id
    and operation = 'account_delete'
    and consumed_at is null
    and expires_at > v_now;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  select p.* into strict v_profile
  from public.profiles p where p.id = p_account_id for update;

  if exists (
    select 1 from public.account_deletion_requests d
    where d.account_id = p_account_id
      and d.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '23505', message = 'deletion_request_exists';
  end if;

  select sp.* into strict v_principal
  from public.subject_principals sp
  join public.subjects s on s.id = sp.subject_id
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and s.subject_class = 'self'
    and s.subject_account_id = p_account_id
  order by sp.created_at, sp.id
  limit 1
  for update of sp;

  select greatest(coalesce(max(sp.principal_revision), 1), 1)
  into v_graph_revision
  from public.subject_principals sp
  where sp.account_id = p_account_id;

  update public.profiles
  set deletion_requested_at = v_now,
      account_revision = account_revision + 1,
      auth_session_revision = auth_session_revision + 1
  where id = p_account_id
  returning * into v_profile;

  insert into public.account_deletion_requests (
    account_id, request_account_revision, request_auth_session_revision,
    principal_graph_revision, deletion_hold_revision, state,
    requested_at, notice_ends_at
  ) values (
    p_account_id, v_profile.account_revision,
    v_profile.auth_session_revision, v_graph_revision,
    v_profile.account_revision, 'notice_period', v_now,
    v_now + interval '7 days'
  ) returning * into v_request;

  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline, state
  ) values (
    'account-deletion.notice-7d', 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    v_profile.account_revision, v_request.notice_ends_at, 'scheduled'
  ) returning id into v_retention_id;

  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'account-deletion.notice-7d',
    'account-deletion-notice-deadline', 'compound-atomic', 1,
    v_request.notice_ends_at, 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    'account-subject-principal', v_principal.principal_revision,
    jsonb_build_object(
      'deletionRequestId', v_request.id,
      'principalGraphRevision', v_graph_revision,
      'originalNoticeEndsAt', v_request.notice_ends_at
    )
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'account-deletion-notice-deadline', 1,
    'complete-retention', 1,
    encode(extensions.digest(
      concat_ws(':', 'account-deletion-v1', v_request.id::text,
        p_account_id::text, v_graph_revision::text,
        v_request.notice_ends_at::text),
      'sha256'
    ), 'hex'),
    'frozen'
  );

  select ecr.id into v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id
    and ecr.contact_hmac = p_contact_hmac
    and ecr.status = 'current'
  order by ecr.created_at desc limit 1 for update;

  if v_contact_id is null then
    update public.encrypted_contact_references ecr
    set status = 'rotated', ended_at = v_now
    where ecr.principal_id = v_principal.id and ecr.status = 'current';

    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal.id, p_contact_ciphertext, p_contact_hmac, 1,
      v_principal.principal_revision, 'current'
    ) returning id into v_contact_id;

    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (
      v_contact_id, p_contact_hmac, 1, 'current',
      v_request.notice_ends_at + interval '1 day'
    );
  end if;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at
  ) values (
    'account-deletion-notice', 'account-deletion-notice', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object(
      'noticeEndsAt', v_request.notice_ends_at,
      'cancelPath', '/settings/data',
      'exportPath', '/api/export'
    ),
    v_request.notice_ends_at + interval '1 day'
  );

  -- Keep only the verified session that requested deletion. The proxy limits
  -- that session to export, revocation, transfer, and cancellation operations.
  delete from auth.sessions
  where user_id = p_account_id and id <> p_session_id;

  return query select v_request.id, 'notice_period'::text, v_request.notice_ends_at;
end;
$$;

revoke all on function public.request_account_deletion_v1(
  uuid, uuid, text, bytea, text, text
) from public, anon, authenticated;
grant execute on function public.request_account_deletion_v1(
  uuid, uuid, text, bytea, text, text
) to service_role;

create or replace function public.cancel_account_deletion_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_notice_idempotency_key text
)
returns table (status text, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.account_deletion_requests%rowtype;
  v_retention public.retention_rows%rowtype;
  v_principal public.subject_principals%rowtype;
  v_contact_id uuid;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  if p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_notice_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_deletion_cancellation';
  end if;

  update public.account_operation_nonces
  set consumed_at = v_now
  where nonce_hash = p_nonce_hash
    and account_id = p_account_id
    and session_id = p_session_id
    and operation = 'account_delete_cancel'
    and consumed_at is null
    and expires_at > v_now;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  select d.* into v_request
  from public.account_deletion_requests d
  where d.account_id = p_account_id and d.state = 'notice_period'
  order by d.requested_at desc limit 1 for update;

  if v_request.id is null or v_request.notice_ends_at <= v_now then
    raise exception using errcode = 'P0002', message = 'deletion_request_not_cancellable';
  end if;

  select r.* into strict v_retention
  from public.retention_rows r
  where r.retention_id = 'account-deletion.notice-7d'
    and r.target_kind = 'account'
    and r.target_id = p_account_id
    and r.state = 'scheduled'
  order by r.created_at desc limit 1 for update;

  if exists (
    select 1 from public.retention_due_phases p
    where p.retention_row_id = v_retention.id
      and p.status not in ('pending', 'retry')
  ) or exists (
    select 1 from public.purge_manifests m
    where m.retention_row_id = v_retention.id and m.state = 'executing'
  ) then
    raise exception using errcode = 'P0002', message = 'deletion_request_not_cancellable';
  end if;

  update public.account_deletion_requests
  set state = 'cancelled', cancelled_at = v_now
  where id = v_request.id;
  update public.retention_rows
  set state = 'cancelled', ended_at = v_now
  where id = v_retention.id;
  update public.retention_due_phases
  set status = 'cancelled', terminal_outcome_code = 'cancelled_by_account',
      completed_at = v_now
  where retention_row_id = v_retention.id;
  update public.purge_manifests
  set state = 'cancelled'
  where retention_row_id = v_retention.id;

  update public.profiles
  set deletion_requested_at = null,
      account_revision = account_revision + 1,
      auth_session_revision = auth_session_revision + 1
  where id = p_account_id;

  select sp.* into strict v_principal
  from public.subject_principals sp
  join public.subjects s on s.id = sp.subject_id
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and s.subject_class = 'self'
    and s.subject_account_id = p_account_id
  order by sp.created_at, sp.id limit 1;

  select ecr.id into strict v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id and ecr.status = 'current'
  order by ecr.created_at desc limit 1;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at
  ) values (
    'account-deletion-cancelled', 'account-deletion-cancelled', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object('settingsPath', '/settings/data'),
    v_now + interval '30 days'
  );

  return query select 'active'::text, v_now;
end;
$$;

revoke all on function public.cancel_account_deletion_v1(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.cancel_account_deletion_v1(
  uuid, uuid, text, text
) to service_role;
