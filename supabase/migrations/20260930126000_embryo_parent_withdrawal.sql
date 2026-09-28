-- The `embryo-parent-withdrawal` rights purpose and the upload-time rights
-- notice that carries it (register `policyContracts.upload-time-rights-notice-v1.embryo`,
-- `policyResolvers.withdrawal-target-v1`, `api.withdraw`, `rightsEmbryoWithdrawal`).
-- TEST-LOCAL only; `EMBRYO_INGEST_AVAILABLE` stays false and
-- `private.embryo_split_config` stays off.
--
-- In the publication transaction, when a genetic source was published, every
-- current notice recipient other than the uploader is sent one
-- `embryo-upload-notice`. A recipient who is also a current disposition
-- authority gets a hash-only withdrawal credential with it, bound to the exact
-- cohort, basis, participant set, lifecycle and publication revisions and to
-- that principal. The mail worker mints the raw token only while that binding
-- is still current, and rechecks it before the provider call. Activation
-- opens a rights session on the whole cohort; `api.withdraw` then refuses or
-- deletes through the cohort restriction, rechecking the purpose matrix
-- (#265), the session, the one-time form nonce and the binding. The page reads
-- a closed read-only projection. Nothing in the credential, the session or
-- the projection names an embryo, a file or a contact.
--
-- The restriction is split in two (owner-approved): the account door keeps its
-- signature, checks and effect, and a private core does the rest for both
-- doors. The safeguards stream's source deletion goes in the core.
--
-- Not here: the `export` action (api.third-party-subject-export is not built,
-- so the page offers only refuse and delete), a reissue of a lost or expired
-- link (api.rights-reissue), and any revocation other than the recheck: a
-- change to any bound revision makes every older credential, outbox row and
-- session unusable at its next use.

-- The purpose's one issuer now exists, bound to the whole cohort.
insert into private.rights_session_purposes (session_purpose, matrix_purpose, invitation_kind, target_kind)
values ('embryo-parent-withdrawal', 'embryo-parent-withdrawal', null, 'cohort');

-- The binding of each withdrawal credential. One row per token candidate; a
-- delivery retry re-mints the raw token under the same binding.
create table private.embryo_withdrawal_credentials (
  candidate_id uuid primary key references public.token_candidates (id) on delete cascade,
  cohort_id uuid not null,
  principal_id uuid not null,
  basis_revision bigint not null check (basis_revision > 0),
  participant_set_revision bigint not null check (participant_set_revision > 0),
  lifecycle_revision bigint not null check (lifecycle_revision > 0),
  publication_revision bigint not null check (publication_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (cohort_id, principal_id, publication_revision)
);
alter table private.embryo_withdrawal_credentials enable row level security;
revoke all on private.embryo_withdrawal_credentials
  from public, anon, authenticated, inherit_upload_only, service_role;
create function private.freeze_embryo_withdrawal_credential_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'embryo withdrawal credential immutable';
end $$;
revoke all on function private.freeze_embryo_withdrawal_credential_v1()
  from public, anon, authenticated, inherit_upload_only, service_role;
create trigger embryo_withdrawal_credential_immutable before update on private.embryo_withdrawal_credentials
  for each row execute function private.freeze_embryo_withdrawal_credential_v1();

insert into public.purge_target_stores (target_id, store_name, store_order)
  select 'mail-token-and-rights-delivery-state', 'private.embryo_withdrawal_credentials',
    coalesce(max(store_order), 0) + 1
  from public.purge_target_stores where target_id = 'mail-token-and-rights-delivery-state';

-- Whether one credential may still be used: its candidate is live, its cohort
-- is active with exactly the bound revisions, and its principal is still an
-- active member of both the notice recipients and the disposition authorities.
create function private.embryo_withdrawal_current_v1(p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.embryo_withdrawal_credentials b
    join public.token_candidates tc on tc.id = b.candidate_id
    join public.embryo_cohorts c on c.id = b.cohort_id
    join public.embryo_basis_bindings bb on bb.cohort_id = c.id
    join public.subject_principals sp on sp.id = b.principal_id
    where b.candidate_id = p_candidate_id
      and tc.purpose = 'embryo-parent-withdrawal' and tc.target_kind = 'cohort'
      and tc.target_id = c.id and tc.state in ('pending', 'issued')
      and tc.expires_at > clock_timestamp()
      and c.status = 'active' and c.publication_revision = b.publication_revision
      and c.lifecycle_revision = b.lifecycle_revision
      and c.participant_set_revision = b.participant_set_revision
      and c.basis_revision = b.basis_revision and bb.basis_revision = b.basis_revision
      and sp.status = 'active'
      and b.principal_id = any (private.embryo_cohort_set_v1(c.id, 'disposition_authorities'))
      and b.principal_id = any (private.embryo_cohort_set_v1(c.id, 'notice_recipients'))
  );
$$;
revoke all on function private.embryo_withdrawal_current_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 1. Restriction, split so a rights session can reach it
-- ---------------------------------------------------------------------------

-- Everything the restriction does once its actor is resolved: 20260905103317's
-- body from the status check on, unchanged except that the audit route is the
-- caller's. The actor must still be a current disposition authority of the
-- cohort. No role may execute it; only the two definer doors below call it.
-- [SOURCE DELETION] The safeguards stream's private.delete_embryo_cohort_sources_v1
-- call belongs here, once, so both doors delete the cohort's sources.
create function private.restrict_embryo_cohort_core_v1(
  p_cohort_id uuid,
  p_actor_principal uuid,
  p_route_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_recipient uuid;
  v_grant record;
begin
  if p_route_id is null or p_route_id not in ('api.cohort-restrict', 'api.withdraw') then
    raise exception using errcode = '22023', message = 'invalid restriction route';
  end if;
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;
  if p_actor_principal is null or not (p_actor_principal = any (
      private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities'))) then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;
  if v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '55000', message = 'already restricted';
  end if;

  update public.embryo_cohorts
  set status = 'restricted', lifecycle_revision = lifecycle_revision + 1
  where id = v_cohort.id;

  update public.subjects
  set lifecycle = 'restricted', lifecycle_revision = lifecycle_revision + 1,
      updated_at = v_now
  where cohort_id = v_cohort.id and lifecycle <> 'purged';

  delete from public.embryo_figures f
  using public.embryo_scores sc, public.embryos e
  where f.finding_id = sc.id and sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_scores sc
  using public.embryos e
  where sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_qc q
  using public.embryos e
  where q.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_variants v
  using public.embryos e
  where v.embryo_id = e.id and e.cohort_id = v_cohort.id;

  update public.future_person_record_key_hashes h
  set status = 'revoked', ended_at = v_now
  from public.embryos e
  where h.embryo_id = e.id and e.cohort_id = v_cohort.id and h.status = 'current';
  update public.future_person_record_key_print_rights pr
  set status = 'revoked'
  from public.embryos e
  where pr.embryo_id = e.id and e.cohort_id = v_cohort.id and pr.status = 'unconsumed';

  for v_grant in
    select pg.grant_id
    from public.purpose_grants pg
    where pg.target_kind = 'cohort' and pg.target_id = v_cohort.id
      and pg.revoked_at is null
    for update
  loop
    update public.purpose_grants
    set revoked_at = v_now, revocation_reason = 'cohort_restricted'
    where grant_id = v_grant.grant_id;
    update public.directional_grants
    set status = 'revoked', ended_at = v_now
    where grant_id = v_grant.grant_id and status = 'current';
  end loop;

  foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'notice_recipients') loop
    perform private.enqueue_embryo_principal_mail_v1(
      v_recipient, 'cohort-restriction-notice', 'cohort-restriction-notice',
      'cohort', v_cohort.id,
      jsonb_build_object('embryoCount', v_cohort.embryo_count),
      encode(extensions.digest(convert_to(
        concat_ws(':', 'cohort-restriction-notice', v_cohort.id::text,
          v_recipient::text), 'UTF8'), 'sha256'), 'hex'),
      v_now + interval '30 days', null, null
    );
  end loop;

  perform private.append_legal_audit_event(
    'embryo.cohort.restricted', null, p_route_id, 'accepted',
    jsonb_build_object('embryo_count', v_cohort.embryo_count)
  );
end;
$$;
revoke all on function private.restrict_embryo_cohort_core_v1(uuid, uuid, text)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- api.cohort-restrict (and its alias api.embryo-withdraw): the same signature,
-- checks and effect as before. It resolves the signed-in disposition
-- authority, then runs the core.
create or replace function public.restrict_embryo_cohort_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_token_nonce text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cohort public.embryo_cohorts%rowtype;
  v_actor uuid;
begin
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_restrict',
    'cohort', v_cohort.id
  );

  v_actor := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities')
  );
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;
  perform private.restrict_embryo_cohort_core_v1(v_cohort.id, v_actor, 'api.cohort-restrict');
end;
$$;
revoke all on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. The upload-time rights notice and its credential
-- ---------------------------------------------------------------------------

-- The safe display name the notice may carry: letters, spaces, apostrophes,
-- hyphens and full stops, at most 60 characters, or nothing.
create function private.embryo_notice_display_name_v1(p_account_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when n ~ '^[[:alpha:]][[:alpha:] .''-]{0,59}$' then n end
  from (select btrim(p.display_name) n from public.profiles p where p.id = p_account_id) x;
$$;
revoke all on function private.embryo_notice_display_name_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- One notice per current notice recipient other than the uploader, per
-- publication revision. A recipient with no live delivery channel is not
-- sent one (the register's "with a live delivery channel"); a recipient who
-- is also a current disposition authority gets a withdrawal credential bound
-- to this exact authority. The token expires with the mail row: 30 days, or
-- the retention deadline if sooner.
create function private.enqueue_embryo_upload_notices_v1(p_cohort_id uuid, p_session_id uuid, p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  c public.embryo_cohorts%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  v_authorities uuid[];
  v_recipient uuid;
  v_outbox uuid;
  v_candidate uuid;
  v_payload jsonb;
  v_expires timestamptz;
  v_uploaded date;
  v_sent integer := 0;
begin
  select * into strict c from public.embryo_cohorts where id = p_cohort_id;
  select * into strict s from public.embryo_ingest_sessions where id = p_session_id and cohort_id = c.id;
  if c.status <> 'active' or c.publication_revision is null or c.uploaded_at is null then
    raise exception using errcode = '55000', message = 'upload notice unavailable';
  end if;
  v_authorities := private.embryo_cohort_set_v1(c.id, 'disposition_authorities');
  v_uploaded := (c.uploaded_at at time zone 'UTC')::date;
  v_expires := least(p_now + interval '30 days', c.retention_expires_at);
  v_payload := jsonb_build_object(
    'embryoCount', c.embryo_count,
    'uploaderName', private.embryo_notice_display_name_v1(s.account_id),
    'uploadedBy', case c.upload_class when 'embryo_own' then 'genetic-parent' else 'someone-else' end,
    'uploadDateIso', to_char(v_uploaded, 'YYYY-MM-DD'),
    'uploadDateWords', to_char(v_uploaded, 'FMDD FMMonth YYYY'),
    'retentionDays', (c.retention_expires_at at time zone 'UTC')::date - v_uploaded);
  foreach v_recipient in array private.embryo_cohort_set_v1(c.id, 'notice_recipients') loop
    -- The acting recipient is the uploader, by principal or by account.
    continue when v_recipient is not distinct from s.uploader_principal_id
      or exists (select 1 from public.subject_principals sp where sp.id = v_recipient
        and sp.account_id is not null and sp.account_id = s.account_id);
    v_outbox := private.enqueue_embryo_principal_mail_v1(
      v_recipient, 'embryo-upload-notice', 'upload-time-rights-notice', 'cohort', c.id, v_payload,
      encode(extensions.digest(convert_to(concat_ws(':', 'upload-time-rights-notice', c.id::text,
        c.publication_revision::text, v_recipient::text), 'UTF8'), 'sha256'), 'hex'),
      v_expires,
      case when v_recipient = any (v_authorities) then 'embryo-parent-withdrawal' end,
      case when v_recipient = any (v_authorities) then c.id end);
    continue when v_outbox is null;
    v_sent := v_sent + 1;
    if v_recipient = any (v_authorities) then
      select tc.id into strict v_candidate from public.token_candidates tc
        where tc.outbox_id = v_outbox and tc.purpose = 'embryo-parent-withdrawal';
      insert into private.embryo_withdrawal_credentials (candidate_id, cohort_id, principal_id,
        basis_revision, participant_set_revision, lifecycle_revision, publication_revision)
      values (v_candidate, c.id, v_recipient, c.basis_revision, c.participant_set_revision,
        c.lifecycle_revision, c.publication_revision)
      on conflict (candidate_id) do nothing;
    end if;
  end loop;
  return v_sent;
end $$;
revoke all on function private.enqueue_embryo_upload_notices_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- ---------------------------------------------------------------------------
-- 4. Mail: the withdrawal link is minted only for a current credential
-- ---------------------------------------------------------------------------

-- 20260907060854's body with one stale-row sweep and one token branch added.
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
    and private.file_ready_mail_current_v1(m) is not true;

  -- Recheck the exact invitation and all stored contact-key aliases before
  -- token creation, under the same transition lock as refusal/acceptance.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='invitation_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose in('adult-subject-invitation','co-parent-invitation')
    and not private.invitation_mail_current_v1(m);

  -- An embryo withdrawal credential's row lives only while the cohort, its
  -- basis, its sets and the recipient are exactly those it was bound to.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='embryo_withdrawal_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose='embryo-parent-withdrawal'
    and not exists (select 1 from public.token_candidates tc
      where tc.outbox_id=m.id and private.embryo_withdrawal_current_v1(tc.id));

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
    and (m.template_id <> 'report-ready' or private.file_ready_mail_current_v1(m) is true)
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

  -- The withdrawal link of an upload-time rights notice: a new raw token for
  -- the exact bound credential, rechecked here, replacing any earlier hash.
  if v_outbox.token_purpose = 'embryo-parent-withdrawal' then
    select tc.* into v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.purpose = 'embryo-parent-withdrawal'
      and tc.target_kind = 'cohort'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;
    if v_candidate.id is null or not private.embryo_withdrawal_current_v1(v_candidate.id) then return; end if;

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

-- 20260907060854's body with one pre-submit check added.
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
 if m.token_purpose='embryo-parent-withdrawal' and not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
    and private.embryo_withdrawal_current_v1(tc.id)
  ) then return false; end if;
 if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;
 return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Activation: 20260913070000's body with the embryo branch added
-- ---------------------------------------------------------------------------

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
  v_purpose text;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_adult_draft public.adult_subject_drafts%rowtype;
  v_expires_at timestamptz;
  v_credential private.embryo_withdrawal_credentials%rowtype;
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

  select tc.purpose into v_purpose
  from public.token_candidates tc
  where tc.id = v_token.candidate_id;

  if v_purpose = 'adult-subject-invitation' then
    v_invitation := private.current_adult_subject_invitation_v1(v_token.id);
    if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

    select d.* into v_adult_draft
    from public.adult_subject_drafts d
    where d.subject_id = v_invitation.target_id
      and d.state = 'invited'
      and d.fixed_expires_at > v_now
    for update;
    if v_adult_draft.id is null then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_invitation.invitee_principal_id, 'adult-subject-invitation',
      'subject', v_invitation.target_id, v_invitation.invitation_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-subject-invitation')
    );

    return query select
      'adult-subject-invitation'::text, 'subject'::text,
      v_invitation.target_id, v_expires_at;
    return;
  end if;

  -- An upload-time rights notice's withdrawal link: the exact credential the
  -- notice bound, still current, opens a session on its whole cohort.
  if v_purpose = 'embryo-parent-withdrawal' then
    if not private.embryo_withdrawal_current_v1(v_token.candidate_id) then return; end if;
    select b.* into strict v_credential from private.embryo_withdrawal_credentials b
      where b.candidate_id = v_token.candidate_id;
    select least(v_now + interval '24 hours', tc.expires_at) into strict v_expires_at
      from public.token_candidates tc where tc.id = v_token.candidate_id;

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_credential.principal_id, 'embryo-parent-withdrawal',
      'cohort', v_credential.cohort_id, v_credential.participant_set_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'embryo-parent-withdrawal')
    );

    return query select
      'embryo-parent-withdrawal'::text, 'cohort'::text, v_credential.cohort_id, v_expires_at;
    return;
  end if;

  if v_purpose is distinct from 'co-parent-invitation' then return; end if;

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
revoke all on function public.activate_rights_session_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.activate_rights_session_v1(text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Publication: 20260930124000's body plus the notices
-- ---------------------------------------------------------------------------

create or replace function private.publish_embryo_split_v1(p_job_id uuid, p_attempt integer, p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms'
as $$
declare
  v_failed jsonb;
  w public.worker_jobs%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype;
  v_ordinal private.embryo_split_ordinals%rowtype;
  v_embryo public.embryos%rowtype;
  v_now timestamptz;
  v_passed integer;
  v_qc_failed integer;
  v_cancelled integer;
  v_file uuid;
  v_parts uuid[];
  v_bytes bigint;
  v_rows integer;
begin
  -- Session, then authority rows, then the job: the claim's lock order. This
  -- reruns the binding check and recomputes the manifest digest.
  v_failed := private.lock_embryo_split_claim_v1(p_job_id, p_attempt, p_claim_token_hash);
  if v_failed is not null then return v_failed; end if;
  select * into strict w from public.worker_jobs where id = p_job_id;
  select * into strict s from public.embryo_ingest_sessions where id = w.source_binding_id;
  select * into strict c from public.embryo_cohorts where id = s.cohort_id for update;

  -- The whole ordinal set, recorded by this attempt and no other.
  perform 1 from private.embryo_split_ordinals where session_id = s.id order by sample_ordinal for update;
  if (select count(*) from private.embryo_split_ordinals o where o.session_id = s.id
      and o.worker_job_id = w.id and o.attempt = w.attempts
      and o.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and (o.worker_job_id <> w.id or o.attempt <> w.attempts)) then
    raise exception using errcode = '22023', message = 'split incomplete';
  end if;

  -- Pending genotypes belong only to a passed embryo of this attempt, and
  -- every pass accounts for exactly its own rows and its own fragments. An
  -- inconsistency rolls back; the next attempt starts again from nothing.
  if exists (select 1 from private.embryo_split_variants v where v.session_id = s.id
      and (v.worker_job_id <> w.id or v.attempt <> w.attempts or not exists (
        select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = v.sample_ordinal and o.outcome = 'passed')))
    or exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
      and o.outcome = 'passed' and (
        o.variant_count <> (select count(*) from private.embryo_split_variants v
          where v.session_id = s.id and v.sample_ordinal = o.sample_ordinal)
        or o.source_sha256 is distinct from private.embryo_split_source_sha256_v1(s.id, o.sample_ordinal))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- Canonical parts: a pass holds exactly one landed part of this attempt per
  -- fragment, byte-identical to it by size and SHA-256; a failure holds none.
  perform 1 from private.embryo_canonical_parts where session_id = s.id order by id for update;
  if exists (select 1 from private.embryo_split_ordinals o
      join public.embryo_ingest_fragments f on f.session_id = o.session_id and f.sample_ordinal = o.sample_ordinal
      where o.session_id = s.id and o.outcome = 'passed' and not exists (
        select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id and p.attempt = w.attempts
          and p.session_id = s.id and p.sample_ordinal = f.sample_ordinal and p.sequence = f.sequence
          and p.state = 'landed' and p.sha256 = f.content_sha256 and p.observed_sha256 = f.content_sha256
          and p.byte_count = f.byte_count))
    or exists (select 1 from private.embryo_canonical_parts p where p.worker_job_id = w.id
      and p.attempt = w.attempts and (p.session_id <> s.id
        or not exists (select 1 from private.embryo_split_ordinals o where o.session_id = s.id
          and o.sample_ordinal = p.sample_ordinal and o.outcome = 'passed')
        or not exists (select 1 from public.embryo_ingest_fragments f where f.session_id = s.id
          and f.sample_ordinal = p.sample_ordinal and f.sequence = p.sequence))) then
    raise exception using errcode = '55000', message = 'split pending state inconsistent';
  end if;

  -- The one-to-one reservation made at finalization, untouched until now.
  perform 1 from public.embryos where cohort_id = c.id order by sample_ordinal for update;
  perform 1 from public.subjects where cohort_id = c.id order by id for update;
  if (select count(*) from public.embryos e join public.subjects sub on sub.id = e.subject_id
      where e.cohort_id = c.id and sub.cohort_id = c.id and sub.subject_class = 'embryo'
        and sub.lifecycle = 'quarantined' and e.status = 'pending'
        and e.sample_ordinal between 0 and c.embryo_count - 1) <> c.embryo_count
    or (select count(*) from public.embryos e where e.cohort_id = c.id) <> c.embryo_count
    or (select count(*) from public.subjects sub where sub.cohort_id = c.id) <> c.embryo_count
    or exists (select 1 from public.embryo_qc q join public.embryos e on e.id = q.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_variants v join public.embryos e on e.id = v.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.embryo_scores x join public.embryos e on e.id = x.embryo_id where e.cohort_id = c.id)
    or exists (select 1 from public.genome_files f join public.subjects sub on sub.id = f.subject_id
      where sub.cohort_id = c.id)
    or exists (select 1 from public.genome_files f where f.cohort_id = c.id)
    or exists (select 1 from private.embryo_canonical_sources x where x.cohort_id = c.id)
    or c.publication_revision is not null or c.status <> 'ingesting'
    or c.uploaded_at is not null or c.qc_failed_at is not null then
    return private.fail_embryo_split_v1(s.id, w.id, 'stale-binding', 'cancelled');
  end if;

  v_now := clock_timestamp();
  select count(*) filter (where outcome = 'passed'), count(*) filter (where outcome = 'qc_fail_no_source')
    into v_passed, v_qc_failed from private.embryo_split_ordinals where session_id = s.id;

  -- One QC row per embryo, measured from its own calls only. What the file
  -- does not report stays null; nothing is estimated or imputed.
  insert into public.embryo_qc (embryo_id, sites_expected, sites_called, call_rate, autosomal_het_rate,
    mean_depth, parent_a_concordance, parent_b_concordance, allelic_dropout_estimate,
    imputation_performed, imputation_panel, contamination_estimate, qc_verdict, qc_reasons, computed_at)
  select e.id, o.sites_expected, o.sites_called, o.call_rate, o.autosomal_het_rate, o.mean_depth,
    null, null, null, false, null, null, o.qc_verdict,
    case when o.failure_reason is not null and not (o.failure_reason = any (o.qc_reasons))
      then o.qc_reasons || o.failure_reason else o.qc_reasons end,
    v_now
  from private.embryo_split_ordinals o
  join public.embryos e on e.cohort_id = c.id and e.sample_ordinal = o.sample_ordinal
  where o.session_id = s.id;

  -- Each passed embryo, alone: its canonical source over its own landed
  -- parts, one `genome_files` row bound to its own digest and complete, and
  -- its own genotypes pointing at that row. A failed embryo gets none of it.
  for v_ordinal in select * from private.embryo_split_ordinals x where x.session_id = s.id and x.outcome = 'passed'
    order by x.sample_ordinal
  loop
    select * into strict v_embryo from public.embryos x where x.cohort_id = c.id and x.sample_ordinal = v_ordinal.sample_ordinal;
    select array_agg(p.id order by p.sequence), sum(p.byte_count) into v_parts, v_bytes
      from private.embryo_canonical_parts p
      where p.worker_job_id = w.id and p.attempt = w.attempts and p.sample_ordinal = v_ordinal.sample_ordinal;
    v_file := gen_random_uuid();
    -- The name is a neutral server label, never a laboratory or source name.
    -- There is no single raw object: `sha256` stays null and the composed
    -- digest over the parts is the source digest.
    insert into public.genome_files (id, user_id, bucket_path, original_name, file_type, tier, size_bytes,
      sha256, status, build, variant_count, processing_started_at, processing_finished_at, subject_id,
      cohort_id, is_cohort_file, sample_count, source_publication_state, source_publication_revision,
      source_binding_fingerprint, storage_object_id, structural_validator_version,
      single_logical_sample_verified_at, source_sha256, canonical_build, upload_revision,
      normalization_completed_at, normalization_source_revision)
    values (v_file, c.owner_account_id, 'embryo-source/' || v_file, 'embryo-autosomal-source.vcf', 'vcf', 1, v_bytes,
      null, 'stored', s.reference_build, v_ordinal.variant_count, null, v_now, v_embryo.subject_id,
      null, false, 1, 'published', 1,
      v_ordinal.source_sha256, null, 'embryo-ordinal-fragment-v1',
      v_now, v_ordinal.source_sha256, s.reference_build, 1,
      v_now, 1);
    insert into private.embryo_canonical_sources (file_id, embryo_id, subject_id, cohort_id, sample_ordinal,
      session_id, worker_job_id, attempt, publication_revision, reference_build, source_sha256,
      membership_sha256, part_count, byte_count, variant_count, published_at)
    values (v_file, v_embryo.id, v_embryo.subject_id, c.id, v_ordinal.sample_ordinal, s.id, w.id, w.attempts, 1, s.reference_build,
      v_ordinal.source_sha256, private.embryo_canonical_membership_sha256_v1(v_parts), cardinality(v_parts), v_bytes,
      v_ordinal.variant_count, v_now);
    insert into private.embryo_canonical_source_parts (file_id, part_id, sequence)
      select v_file, p.id, p.sequence from private.embryo_canonical_parts p where p.id = any (v_parts);
    if private.embryo_canonical_source_sha256_v1(v_file) is distinct from v_ordinal.source_sha256 then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
    insert into public.embryo_variants (embryo_id, source_file_id, chromosome, position,
      reference_allele, alternate_allele, genotype, source_binding_fingerprint)
    select v_embryo.id, v_file, v.chromosome, v.position, v.reference_allele, v.alternate_allele, v.genotype,
      v_ordinal.source_sha256
    from private.embryo_split_variants v
    where v.session_id = s.id and v.sample_ordinal = v_ordinal.sample_ordinal
    order by v.batch, v.id;
    get diagnostics v_rows = row_count;
    if v_rows <> v_ordinal.variant_count then
      raise exception using errcode = '55000', message = 'split pending state inconsistent';
    end if;
  end loop;

  update public.embryos e
    set status = case o.qc_verdict when 'pass' then 'qc_pass' when 'marginal' then 'qc_marginal' else 'qc_fail' end
    from private.embryo_split_ordinals o
    where e.cohort_id = c.id and o.session_id = s.id and o.sample_ordinal = e.sample_ordinal;

  -- G5.3: quarantine lifts for every embryo subject at once, and only here.
  update public.subjects set lifecycle = 'active', lifecycle_revision = lifecycle_revision + 1
    where cohort_id = c.id and subject_class = 'embryo' and lifecycle = 'quarantined';

  update public.embryo_cohorts
    set status = 'active', publication_revision = 1,
      uploaded_at = case when v_passed > 0 then v_now end,
      qc_failed_at = case when v_passed = 0 then v_now end
    where id = c.id;

  -- Every ordinal's authoritative deadline, card date and addenda, from this
  -- commit time; a missing required addendum rolls the whole commit back.
  perform private.embryo_publication_dates_v1(c.id, v_now);

  -- The upload-time rights notice, with its withdrawal credential, when the
  -- published set holds a genetic source (upload-time-rights-notice-v1.embryo).
  if v_passed > 0 then
    perform private.enqueue_embryo_upload_notices_v1(c.id, s.id, v_now);
  end if;

  -- Only a success or partial publication cancels the exact due phase.
  update public.retention_due_phases
    set status = 'cancelled', terminal_outcome_code = 'ingest_published', completed_at = v_now
    where retention_id = 'embryo.ingest-session-24h' and phase_id = 'ingest-abandoned-no-source'
      and target_kind = 'ingest_session' and target_id = s.id and phase_revision = s.ingest_revision
      and status in ('pending', 'retry');
  get diagnostics v_cancelled = row_count;
  if v_cancelled <> 1 then
    raise exception using errcode = '55000', message = 'ingest due phase unavailable';
  end if;

  update public.embryo_ingest_sessions set status = 'published' where id = s.id;
  update public.worker_jobs
    set status = 'done', finished_at = v_now, partial = v_qc_failed > 0, progress = 100,
      progress_note = 'complete', claim_token_hash = null, claim_expires_at = null, claimed_by = null
    where id = w.id;

  -- The pending rows are now the published rows; nothing attempt-owned remains
  -- in them. Canonical parts stay: they are the published sources' objects.
  delete from private.embryo_split_variants where session_id = s.id;
  delete from private.embryo_split_ordinals where session_id = s.id;

  perform private.append_legal_audit_event(
    'embryo.cohort.published', null, null, 'accepted',
    jsonb_build_object('embryo_count', c.embryo_count, 'publication_revision', 1));

  return jsonb_build_object('status', 'published', 'publicationRevision', 1,
    'published', v_passed, 'qcFailed', v_qc_failed);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The rights session: the read-only view and the two actions
-- ---------------------------------------------------------------------------

-- The live embryo-parent-withdrawal session for a cookie hash, with its
-- credential still current, or nothing.
create function private.embryo_withdrawal_session_v1(p_session_hash text, p_lock boolean)
returns public.rights_sessions language plpgsql security definer set search_path = '' as $$
declare v_session public.rights_sessions%rowtype; v_candidate uuid;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  if p_lock then
    select rs.* into v_session from public.rights_sessions rs
      where rs.session_hash = p_session_hash for update;
  else
    select rs.* into v_session from public.rights_sessions rs where rs.session_hash = p_session_hash;
  end if;
  if v_session.id is null or v_session.purpose <> 'embryo-parent-withdrawal' or v_session.target_kind <> 'cohort'
    or v_session.status <> 'active' or v_session.expires_at <= clock_timestamp() then return null; end if;
  select th.candidate_id into v_candidate from public.token_hashes th
    where th.id = v_session.token_hash_id and th.status = 'consumed';
  if v_candidate is null or not private.embryo_withdrawal_current_v1(v_candidate)
    or not exists (select 1 from private.embryo_withdrawal_credentials b where b.candidate_id = v_candidate
      and b.cohort_id = v_session.target_id and b.principal_id = v_session.principal_id
      and b.participant_set_revision = v_session.authority_revision) then
    return null;
  end if;
  return v_session;
end $$;
revoke all on function private.embryo_withdrawal_session_v1(text, boolean)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- rightsEmbryoWithdrawal's facts, closed: the date the embryos were added,
-- each embryo's status code in ordinal order, the cohort's live purposes, the
-- retention maximum in days and the actions this page offers. There are no
-- findings while the condition registry is empty; a cohort holding any score
-- is refused rather than shown without them.
create function private.embryo_parent_withdrawal_view_v1(p_session_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_session public.rights_sessions%rowtype; c public.embryo_cohorts%rowtype;
begin
  v_session := private.embryo_withdrawal_session_v1(p_session_hash, false);
  if v_session.id is null then return null; end if;
  select * into strict c from public.embryo_cohorts where id = v_session.target_id;
  if exists (select 1 from public.embryo_scores x join public.embryos e on e.id = x.embryo_id
      where e.cohort_id = c.id) then
    return null;
  end if;
  return jsonb_build_object(
    'version', 'embryo-parent-withdrawal-view-v1',
    'addedOn', to_char((c.uploaded_at at time zone 'UTC')::date, 'YYYY-MM-DD'),
    'embryoCount', c.embryo_count,
    'statuses', (select jsonb_agg(e.status order by e.sample_ordinal) from public.embryos e where e.cohort_id = c.id),
    'purposes', coalesce((select jsonb_agg(distinct pg.purpose) from public.purpose_grants pg
      where pg.target_kind = 'cohort' and pg.target_id = c.id and pg.revoked_at is null), '[]'::jsonb),
    'retentionMaximumDays', (c.retention_expires_at at time zone 'UTC')::date - (c.uploaded_at at time zone 'UTC')::date,
    'allowedActionIds', coalesce((select jsonb_agg(m.action order by m.action)
      from private.rights_purpose_matrix m where m.purpose = 'embryo-parent-withdrawal'
        and m.route_id = 'api.withdraw'
        and private.rights_action_permitted_v1(v_session.purpose, m.action, 'api.withdraw')), '[]'::jsonb));
end $$;
revoke all on function private.embryo_parent_withdrawal_view_v1(text)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- api.withdraw for this purpose. The one-time form nonce is spent before any
-- target is read; the matrix must permit the action on this route; the
-- credential must still be current. Refuse and delete both end the cohort's
-- parent-controlled life through the restriction (upload-time-rights-notice-v1
-- .embryo.effect); the session is then spent.
create function private.respond_embryo_parent_withdrawal_v1(p_session_hash text, p_action text, p_nonce text)
returns text language plpgsql security definer set search_path = '' set lock_timeout = '250ms' as $$
declare v_session public.rights_sessions%rowtype; v_id uuid;
begin
  if p_action is null or p_action not in ('refuse', 'delete') then return 'unavailable'; end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return 'unavailable'; end if;
  select rs.id into v_id from public.rights_sessions rs
    where rs.session_hash = p_session_hash and rs.purpose = 'embryo-parent-withdrawal'
      and rs.status = 'active' and rs.expires_at > clock_timestamp();
  if v_id is null then return 'unavailable'; end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce, null, null, 'embryo_parent_withdraw',
    'rights_session', v_id);
  if not private.rights_action_permitted_v1('embryo-parent-withdrawal', p_action, 'api.withdraw') then
    return 'unavailable';
  end if;
  v_session := private.embryo_withdrawal_session_v1(p_session_hash, true);
  if v_session.id is null or v_session.id <> v_id then return 'unavailable'; end if;
  perform private.restrict_embryo_cohort_core_v1(v_session.target_id, v_session.principal_id, 'api.withdraw');
  update public.rights_sessions set status = 'consumed', ended_at = clock_timestamp() where id = v_session.id;
  return case p_action when 'refuse' then 'refused' else 'deleted' end;
end $$;
revoke all on function private.respond_embryo_parent_withdrawal_v1(text, text, text)
  from public, anon, authenticated, inherit_upload_only, service_role;

create function public.embryo_parent_withdrawal_view_v1(p_session_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.embryo_parent_withdrawal_view_v1(p_session_hash);
$$;
create function public.respond_embryo_parent_withdrawal_v1(p_session_hash text, p_action text, p_nonce text)
returns text language sql security invoker set search_path = '' as $$
  select private.respond_embryo_parent_withdrawal_v1(p_session_hash, p_action, p_nonce);
$$;
revoke all on function public.embryo_parent_withdrawal_view_v1(text),
  public.respond_embryo_parent_withdrawal_v1(text, text, text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function private.embryo_parent_withdrawal_view_v1(text),
  private.respond_embryo_parent_withdrawal_v1(text, text, text),
  public.embryo_parent_withdrawal_view_v1(text),
  public.respond_embryo_parent_withdrawal_v1(text, text, text)
  to service_role;

notify pgrst, 'reload schema';
