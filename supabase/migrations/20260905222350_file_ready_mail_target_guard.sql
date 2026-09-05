-- File readiness cannot outlive its source. Research digests and already-sent
-- history keep their existing behavior. This does not recall a provider request
-- already submitted by a worker before the deletion boundary.
create function private.guard_file_ready_mail_insert_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_file_id uuid;
begin
  if new.template_id <> 'report-ready' then return new; end if;
  -- Serialize enqueue with deletion's parent-file lock, including the small
  -- interval between marking a process annotated and its later mail enqueue.
  if new.target_kind = 'genome_file' then
    select f.id into v_file_id
    from public.genome_files f
    join public.subject_principals sp on sp.id = new.recipient_principal_id
    where f.id = new.target_id and f.user_id = sp.account_id
      and f.subject_id = sp.subject_id and f.status = 'annotated'
    for share of f;
  end if;
  if v_file_id is null or exists (
    select 1 from private.genome_file_deletions where file_id = v_file_id
  ) then
    raise exception using errcode = '55000', message = 'file_target_unavailable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_file_ready_mail_insert_v1() from public, anon, authenticated;
create trigger guard_file_ready_mail_insert before insert on public.mail_outbox
  for each row execute function private.guard_file_ready_mail_insert_v1();

-- Preserve the current claim RPC and invitation/token behavior verbatim except
-- for exact-file readiness eligibility at invalidation and selection.
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
