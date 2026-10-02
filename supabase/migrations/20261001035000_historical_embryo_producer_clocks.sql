-- Owner-only finite logical-clock cores for a labeled historical fixture.
-- Public/current callers keep their original ABIs/ACLs and real-clock rules.
-- Current Auth, parent artifacts, operation scope, source and audit recording
-- time remain real; this is not historical signing, delivery or human proof.
do $historical_predecessors$
declare expected record; predecessor oid; api text;
begin
  for expected in select * from (values
    ('public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)','jsonb',
      array['p_account_id','p_session_id','p_embryo_id','p_action','p_disposition','p_proposal_id','p_token_nonce'],
      0,'2bb7b725bdab60364579c6ab762988cb',true),
    ('private.record_embryo_disposition_before_current_authority_v1(uuid,uuid,uuid,text,text,uuid,text)','jsonb',
      array['p_account_id','p_session_id','p_embryo_id','p_action','p_disposition','p_proposal_id','p_token_nonce'],
      0,'b18530af4f18a8b9ca56c5c26d95acb2',false),
    ('private.embryo_disposition_authority_v1(uuid,uuid,uuid,boolean)','jsonb',
      array['p_account','p_session','p_embryo','p_mutation'],1,'7f0a7979b8b4fa89f54ff7e2bbccad5a',false),
    ('private.close_embryo_disposition_proposal_v1(uuid,text,text)','void',
      array['p_proposal_id','p_status','p_outcome_code'],0,'35c9b48a2e92be399a8a2e87350e95fe',true),
    ('private.enqueue_embryo_principal_mail_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid)','uuid',
      array['p_principal_id','p_template_id','p_purpose','p_target_kind','p_target_id','p_payload',
        'p_idempotency_key','p_expires_at','p_token_purpose','p_token_target_id'],
      0,'2029cdb2a9fbb44cebc321c2c8a113ca',true)
  ) x(signature,result_type,argument_names,default_count,body_hash,service_execute) loop
    predecessor:=to_regprocedure(expected.signature);
    if predecessor is null or not exists(select 1 from pg_proc p
      join pg_language lang on lang.oid=p.prolang join pg_roles owner_role on owner_role.oid=p.proowner
      join pg_namespace ns on ns.oid=p.pronamespace
      where p.oid=predecessor and owner_role.rolname='postgres' and lang.lanname='plpgsql'
        and ns.nspname=split_part(expected.signature,'.',1) and p.prosecdef and p.prokind='f'
        and not p.proretset and not p.proleakproof and p.provolatile='v' and p.proparallel='u'
        and p.prorettype=to_regtype(expected.result_type) and p.pronargs=cardinality(expected.argument_names)
        and p.pronargdefaults=expected.default_count and p.provariadic=0 and p.proallargtypes is null and p.proargmodes is null
        and (case when expected.default_count=0 then p.proargdefaults is null
          else pg_get_expr(p.proargdefaults,0)='false' end)
        and p.proargnames=expected.argument_names and p.proconfig=array['search_path=""']::text[]
        and md5(p.prosrc)=expected.body_hash)
      or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=predecessor and (acl.privilege_type<>'EXECUTE' or acl.is_grantable or acl.grantor<>p.proowner
          or (acl.grantee<>p.proowner and (not expected.service_execute or acl.grantee<>'service_role'::regrole)))) then
      raise exception using errcode='55000',message='historical producer predecessor differs';end if;
    foreach api in array array['anon','authenticated','inherit_upload_only','service_role'] loop
      if has_function_privilege(api,predecessor,'execute') is distinct from
        (api='service_role' and expected.service_execute) then
        raise exception using errcode='55000',message='historical producer predecessor privileges differ';end if;
    end loop;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='private' and p.proname in ('record_embryo_disposition_at_v1',
      'close_embryo_disposition_proposal_at_v1','enqueue_embryo_principal_mail_at_v1',
      'enqueue_embryo_principal_mail_clock_core_v1','record_embryo_disposition_clock_core_v1')) then
    raise exception using errcode='55000',message='historical producer core already exists';end if;
end;
$historical_predecessors$;

-- Compare the actual strict clock constraints with PostgreSQL's own canonical
-- expressions. No constraint or original column/default is changed.
create temporary table historical_clock_shape_owner_v1(
  created_at timestamptz,expires_at timestamptz,
  constraint historical_after_creation check(expires_at>created_at),
  constraint historical_mail_limit check(expires_at<=created_at+interval '30 days'));
do $historical_clock_shapes$
declare expected record;
begin
  for expected in select * from (values
    ('public.embryo_disposition_proposals','embryo_disposition_proposals_check','historical_after_creation'),
    ('public.mail_outbox','mail_outbox_check','historical_after_creation'),
    ('public.mail_outbox','mail_outbox_provider_retention_limit','historical_mail_limit')
  ) x(relation_name,constraint_name,expected_name) loop
    if not exists(select 1 from pg_constraint c join pg_class relation on relation.oid=c.conrelid
      join pg_roles owner_role on owner_role.oid=relation.relowner
      where c.conrelid=to_regclass(expected.relation_name) and c.conname=expected.constraint_name
        and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred
        and owner_role.rolname='postgres' and pg_get_constraintdef(c.oid)=(select pg_get_constraintdef(shape.oid)
          from pg_constraint shape where shape.conrelid='pg_temp.historical_clock_shape_owner_v1'::regclass
            and shape.conname=expected.expected_name)) then
      raise exception using errcode='55000',message='historical producer clock constraint differs';end if;
  end loop;
  if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.embryo_disposition_proposals'::regclass and a.attname='created_at'
      and a.atttypid='timestamptz'::regtype and a.attnotnull and not a.attisdropped
      and pg_get_expr(d.adbin,d.adrelid)='clock_timestamp()') then
    raise exception using errcode='55000',message='historical proposal recording default differs';end if;
end;
$historical_clock_shapes$;
drop table pg_temp.historical_clock_shape_owner_v1;

-- The single shared mail algorithm captures the real clock at the original
-- position AFTER the principal/contact locks and early idempotency return.
-- NULL is an internal real-clock instruction, never an API or finite_at ABI.
create function private.enqueue_embryo_principal_mail_clock_core_v1(p_principal_id uuid,p_template_id text,p_purpose text,p_target_kind text,p_target_id uuid,
  p_payload jsonb,p_idempotency_key text,p_expires_at timestamptz,p_token_purpose text,p_token_target_id uuid,p_created_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_principal public.subject_principals%rowtype;
  v_contact public.encrypted_contact_references%rowtype;
  v_outbox_id uuid;
  v_created_at timestamptz;
begin
  if p_created_at is not null and not isfinite(p_created_at) then
    raise exception using errcode='22023',message='invalid mail creation clock';end if;
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
  v_created_at := coalesce(p_created_at,pg_catalog.clock_timestamp());
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
revoke all on function private.enqueue_embryo_principal_mail_clock_core_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.enqueue_embryo_principal_mail_v1(p_principal_id uuid,p_template_id text,p_purpose text,p_target_kind text,p_target_id uuid,
  p_payload jsonb,p_idempotency_key text,p_expires_at timestamptz,p_token_purpose text,p_token_target_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  return private.enqueue_embryo_principal_mail_clock_core_v1(p_principal_id,p_template_id,p_purpose,p_target_kind,p_target_id,p_payload,p_idempotency_key,p_expires_at,p_token_purpose,p_token_target_id,null);
end;
$$;

create function private.enqueue_embryo_principal_mail_at_v1(p_principal_id uuid,p_template_id text,p_purpose text,p_target_kind text,p_target_id uuid,
  p_payload jsonb,p_idempotency_key text,p_expires_at timestamptz,p_token_purpose text,p_token_target_id uuid,p_created_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if p_created_at is null or not isfinite(p_created_at) then
    raise exception using errcode='22023',message='invalid mail creation clock';end if;
  return private.enqueue_embryo_principal_mail_clock_core_v1(p_principal_id,p_template_id,p_purpose,p_target_kind,p_target_id,p_payload,p_idempotency_key,p_expires_at,p_token_purpose,p_token_target_id,p_created_at);
end;
$$;
revoke all on function private.enqueue_embryo_principal_mail_at_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- One closure algorithm; all existing real-time callers retain their ABI.
create function private.close_embryo_disposition_proposal_at_v1(
  p_proposal_id uuid,p_status text,p_outcome_code text,p_now timestamptz
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := p_now;
  v_phase record;
begin
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode='22023',message='invalid proposal clock';end if;
  update public.embryo_disposition_proposals
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' then v_now else confirmed_at end
  where id = p_proposal_id;

  for v_phase in
    select p.retention_row_id, p.phase_id, p.phase_revision
    from public.retention_due_phases p
    where p.retention_id = 'embryo.disposition-proposal-7d'
      and p.phase_id = 'embryo-disposition-proposal-expiry'
      and p.immutable_envelope ->> 'proposalId' = p_proposal_id::text
      and p.status = 'pending'
    for update
  loop
    update public.retention_due_phases
    set status = case when p_status = 'expired' then 'succeeded' else 'cancelled' end,
        terminal_outcome_code = p_outcome_code, completed_at = v_now
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
    update public.purge_manifests
    set state = case when p_status = 'expired' then 'complete' else 'cancelled' end
    where retention_row_id = v_phase.retention_row_id and state = 'frozen';
    update public.retention_rows
    set state = case when p_status = 'expired' then 'complete' else 'cancelled' end,
        ended_at = v_now
    where id = v_phase.retention_row_id and state in ('scheduled', 'active');
  end loop;
end;
$$;
revoke all on function private.close_embryo_disposition_proposal_at_v1(uuid,text,text,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;
create or replace function private.close_embryo_disposition_proposal_v1(
  p_proposal_id uuid,p_status text,p_outcome_code text
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.close_embryo_disposition_proposal_at_v1(p_proposal_id,p_status,p_outcome_code,clock_timestamp());
end;
$$;

-- The exact original disposition algorithm, with only explicit logical
-- clock propagation plus the genuine current250 authority prerequisite.
-- Row defaults/source/signatures/audit recording remain actual; a synthetic
-- effective event must never be described as genuine historical evidence.
create function private.record_embryo_disposition_clock_core_v1(
  p_account_id uuid,p_session_id uuid,p_embryo_id uuid,p_action text,p_disposition text,
  p_proposal_id uuid,p_token_nonce text,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz := coalesce(p_now,clock_timestamp());
  v_embryo public.embryos%rowtype;
  v_cohort public.embryo_cohorts%rowtype;
  v_binding public.embryo_basis_bindings%rowtype;
  v_authorities uuid[];
  v_actor uuid;
  v_mode text;
  v_proposal public.embryo_disposition_proposals%rowtype;
  v_existing public.embryo_disposition_proposals%rowtype;
  v_proposal_ordinal bigint;
  v_retention_id uuid;
  v_deadline timestamptz;
  v_recipient uuid;
  v_record_key text;
  v_card jsonb := 'null'::jsonb;
  v_caller_state text := 'not_a_card_recipient';
  v_result jsonb;
begin
  if p_now is not null and not isfinite(p_now) then
    raise exception using errcode='22023',message='invalid disposition clock';end if;
  if p_action is null or p_disposition is null or p_action not in ('propose','confirm','commit-single-authority')
    or p_disposition not in ('stored','transferred','donated','discarded')
    or (p_action='confirm')<>(p_proposal_id is not null)
  then raise exception using errcode='22023',message='invalid disposition request';end if;
  perform private.embryo_disposition_authority_v1(p_account_id,p_session_id,p_embryo_id,true);
  if p_action not in ('propose', 'confirm', 'commit-single-authority')
    or p_disposition not in ('stored', 'transferred', 'donated', 'discarded')
    or (p_action = 'confirm') <> (p_proposal_id is not null)
  then
    raise exception using errcode = '22023', message = 'invalid disposition request';
  end if;

  select e.* into v_embryo
  from public.embryos e
  where e.id = p_embryo_id
  for update;
  if v_embryo.id is null then
    raise exception using errcode = '42501', message = 'embryo unavailable';
  end if;
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = v_embryo.cohort_id
  for update;
  if v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'embryo_disposition',
    'embryo', v_embryo.id
  );

  v_authorities := private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities');
  v_actor := private.acting_embryo_principal_v1(p_account_id, v_authorities);
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;

  select b.* into v_binding from public.embryo_basis_bindings b where b.cohort_id = v_cohort.id;
  v_mode := case when v_binding.basis_case = 'true_two_parent'
    then 'two-parent-propose-confirm' else 'single-authority-direct' end;
  if (v_mode = 'two-parent-propose-confirm' and p_action = 'commit-single-authority')
    or (v_mode = 'single-authority-direct' and p_action <> 'commit-single-authority')
  then
    raise exception using errcode = '22023', message = 'action does not match the disposition mode';
  end if;

  -- The state machine: unknown → any; stored → transferred/donated/discarded.
  if not (
    v_embryo.status in ('pending', 'qc_pass', 'qc_marginal', 'qc_fail', 'excluded')
    or (v_embryo.status = 'stored' and p_disposition <> 'stored')
  ) then
    raise exception using errcode = '55000', message = 'disposition final';
  end if;

  if p_action = 'propose' then
    -- One live proposal per embryo. A lapsed one is closed here so a new
    -- proposal can be made even before the expiry phase runs.
    select p.* into v_existing
    from public.embryo_disposition_proposals p
    where p.embryo_id = v_embryo.id and p.status = 'pending'
    for update;
    if v_existing.id is not null then
      if v_existing.expires_at > v_now then
        raise exception using errcode = '55000', message = 'proposal pending';
      end if;
      perform private.close_embryo_disposition_proposal_at_v1(v_existing.id, 'expired', 'proposal_lapsed',coalesce(p_now,clock_timestamp()));
    end if;

    insert into public.embryo_disposition_proposals (
      embryo_id, proposer_principal_id, disposition, basis_revision,
      authority_set_revision, status, expires_at, created_at
    ) values (
      v_embryo.id, v_actor, p_disposition, v_cohort.basis_revision,
      v_cohort.participant_set_revision, 'pending', v_now + interval '7 days', coalesce(p_now,clock_timestamp())
    ) returning * into v_proposal;

    select count(*) into v_proposal_ordinal
    from public.embryo_disposition_proposals p
    where p.embryo_id = v_embryo.id;

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.disposition-proposal-7d', 'subject', v_embryo.subject_id,
      v_proposal_ordinal, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_proposal.expires_at, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    ) values (
      v_retention_id, 'embryo.disposition-proposal-7d',
      'embryo-disposition-proposal-expiry', 'purge', 1, v_proposal.expires_at,
      'subject', v_embryo.subject_id, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, 'disposition-authorities',
      v_cohort.participant_set_revision,
      jsonb_build_object('proposalId', v_proposal.id)
    );
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'embryo-disposition-proposal-expiry', 1, 'proposal-working', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-proposal-v1', v_proposal.id::text),
        'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );

    perform private.append_legal_audit_event(
      'embryo.disposition.proposed', null, 'api.embryo-disposition', 'accepted',
      jsonb_build_object('disposition', p_disposition, 'mode', v_mode)
    );

    return jsonb_build_object(
      'status', 'awaiting_other_parent',
      'proposalId', v_proposal.id,
      'expiresAt', to_char(v_proposal.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  if p_action = 'confirm' then
    select p.* into v_proposal
    from public.embryo_disposition_proposals p
    where p.id = p_proposal_id
      and p.embryo_id = v_embryo.id
      and p.status = 'pending'
      and p.expires_at > v_now
      and p.disposition = p_disposition
      and p.basis_revision = v_cohort.basis_revision
      and p.authority_set_revision = v_cohort.participant_set_revision
      and p.proposer_principal_id <> v_actor
    for update;
    if v_proposal.id is null then
      raise exception using errcode = '42501', message = 'proposal unavailable';
    end if;
    perform private.close_embryo_disposition_proposal_at_v1(v_proposal.id, 'confirmed', 'proposal_confirmed',coalesce(p_now,clock_timestamp()));
  end if;

  -- Commit.
  update public.embryos
  set status = p_disposition,
      disposition_effective_at = v_now,
      disposition_revision = disposition_revision + 1
  where id = v_embryo.id
  returning * into v_embryo;

  if p_disposition in ('donated', 'discarded') then
    v_deadline := v_now + interval '90 days';
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_embryo.id and status = 'current';
    update public.future_person_record_key_print_rights
    set status = 'revoked'
    where embryo_id = v_embryo.id and status = 'unconsumed';
    update public.embryos set retention_expires_at = v_deadline
    where id = v_embryo.id
    returning * into v_embryo;

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.donated-or-discarded-90d', 'subject', v_embryo.subject_id,
      v_embryo.disposition_revision, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_deadline, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    ) values
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-notice-30d', 'notice-enqueue', 1,
       v_deadline - interval '30 days', 'subject', v_embryo.subject_id,
       v_cohort.lifecycle_revision, v_embryo.disposition_revision,
       'notice-recipients', v_cohort.participant_set_revision, '{}'::jsonb),
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-deny', 'deny', 1, v_deadline, 'subject',
       v_embryo.subject_id, v_cohort.lifecycle_revision,
       v_embryo.disposition_revision, 'notice-recipients',
       v_cohort.participant_set_revision, '{}'::jsonb),
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-purge', 'purge', 1, v_deadline, 'subject',
       v_embryo.subject_id, v_cohort.lifecycle_revision,
       v_embryo.disposition_revision, 'notice-recipients',
       v_cohort.participant_set_revision, '{}'::jsonb);
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'disposition-expiry-purge', 1, 'complete-retention', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-v1', v_embryo.id::text,
          v_embryo.disposition_revision::text), 'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );
  elsif p_disposition = 'transferred' then
    v_deadline := v_now + interval '18 years 9 months' + interval '24 months';
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_embryo.id and status = 'current';
    update public.future_person_record_key_print_rights
    set status = 'revoked'
    where embryo_id = v_embryo.id and status = 'unconsumed';
    update public.embryo_cohorts
    set recipient_set_revision = recipient_set_revision + 1,
        key_revision = key_revision + 1
    where id = v_cohort.id
    returning * into v_cohort;
    update public.embryos
    set transferred_at = v_now,
        retention_expires_at = v_deadline,
        closing_date = v_deadline::date,
        closing_date_state = 'definitive_transferred_claim_window',
        date_revision = date_revision + 1
    where id = v_embryo.id
    returning * into v_embryo;

    foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients') loop
      insert into public.future_person_record_key_print_rights (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, status, delivery_kind
      ) values (
        v_embryo.id, v_recipient, v_cohort.recipient_set_revision,
        v_cohort.key_revision, 'unconsumed', 'transfer_replacement'
      );
    end loop;

    if v_actor = any (private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients')) then
      v_record_key := private.embryo_record_key_v1();
      insert into public.future_person_record_key_hashes (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, key_hash, status
      ) values (
        v_embryo.id, v_actor, v_cohort.recipient_set_revision, v_cohort.key_revision,
        encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
        'current'
      );
      update public.future_person_record_key_print_rights
      set status = 'consumed', consumed_at = v_now
      where embryo_id = v_embryo.id and recipient_principal_id = v_actor
        and status = 'unconsumed';
      v_caller_state := 'delivered_inline';
      v_card := jsonb_build_object(
        'record_key', v_record_key,
        'closing_date_iso', to_char(v_embryo.closing_date, 'YYYY-MM-DD'),
        'closing_date_state', v_embryo.closing_date_state
      );
    end if;

    update public.purpose_grants
    set revoked_at = v_now, revocation_reason = 'embryo_transferred'
    where target_kind = 'cohort' and target_id = v_cohort.id and revoked_at is null;
    update public.directional_grants dg
    set status = 'revoked', ended_at = v_now
    from public.purpose_grants pg
    where dg.grant_id = pg.grant_id and pg.revocation_reason = 'embryo_transferred'
      and dg.status = 'current';

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.transferred-claim-window', 'subject', v_embryo.subject_id,
      v_embryo.disposition_revision, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_deadline, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    )
    select v_retention_id, 'embryo.transferred-claim-window', x.phase_id, x.phase_kind, 1,
           x.deadline, 'subject', v_embryo.subject_id, v_cohort.lifecycle_revision,
           v_embryo.disposition_revision, 'notice-recipients',
           v_cohort.participant_set_revision, '{}'::jsonb
    from (values
      ('transferred-claim-window-open-notice', 'notice-enqueue', v_now + interval '17 years'),
      ('transferred-deletion-notice-90d', 'notice-enqueue', v_deadline - interval '90 days'),
      ('transferred-final-deletion-notice', 'notice-enqueue', v_deadline - interval '31 days'),
      ('transferred-closing-deny', 'deny', v_deadline),
      ('transferred-closing-purge', 'purge', v_deadline)
    ) as x(phase_id, phase_kind, deadline);
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'transferred-closing-purge', 1, 'complete-retention', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-transfer-v1', v_embryo.id::text,
          v_embryo.disposition_revision::text), 'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );
  end if;

  foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'notice_recipients') loop
    perform private.enqueue_embryo_principal_mail_clock_core_v1(
      v_recipient, 'embryo-disposition-notice', 'embryo-disposition-notice',
      'subject', v_embryo.subject_id,
      jsonb_build_object(
        'displayLabel', v_embryo.display_label,
        'disposition', p_disposition,
        'effectiveAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'retentionExpiresAt', to_char(v_embryo.retention_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-notice', v_embryo.id::text,
          v_embryo.disposition_revision::text, v_recipient::text),
        'UTF8'), 'sha256'), 'hex'),
      v_now + interval '30 days', null, null, p_now
    );
  end loop;

  perform private.append_legal_audit_event(
    'embryo.disposition.recorded', null, 'api.embryo-disposition', 'accepted',
    jsonb_build_object('disposition', p_disposition, 'mode', v_mode)
  );

  v_result := jsonb_build_object(
    'embryoId', v_embryo.id,
    'disposition', p_disposition,
    'effectiveAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retentionExpiresAt', to_char(v_embryo.retention_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if p_disposition = 'transferred' then
    v_result := v_result || jsonb_build_object(
      'recipientSetRevision', v_cohort.recipient_set_revision,
      'callerState', v_caller_state,
      'card', v_card
    );
  end if;
  return v_result;
end;
$$;
revoke all on function private.record_embryo_disposition_clock_core_v1(uuid,uuid,uuid,text,text,uuid,text,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Owner-only finite-clock entry; NULL is never accepted at this ABI.
create function private.record_embryo_disposition_at_v1(
  p_account_id uuid,p_session_id uuid,p_embryo_id uuid,p_action text,p_disposition text,
  p_proposal_id uuid,p_token_nonce text,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_now is null or not isfinite(p_now) then
    raise exception using errcode='22023',message='invalid disposition clock';end if;
  return private.record_embryo_disposition_clock_core_v1(p_account_id,p_session_id,p_embryo_id,p_action,p_disposition,
    p_proposal_id,p_token_nonce,p_now);
end;
$$;
revoke all on function private.record_embryo_disposition_at_v1(uuid,uuid,uuid,text,text,uuid,text,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;

--250's public wrapper remains BYTE-IDENTICAL. Its denied seven-argument
-- delegate selects internal real-clock behavior; callers cannot add a clock.
create or replace function private.record_embryo_disposition_before_current_authority_v1(
  p_account_id uuid,p_session_id uuid,p_embryo_id uuid,p_action text,p_disposition text,
  p_proposal_id uuid,p_token_nonce text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return private.record_embryo_disposition_clock_core_v1(p_account_id,p_session_id,p_embryo_id,p_action,p_disposition,
    p_proposal_id,p_token_nonce,null);
end;
$$;
