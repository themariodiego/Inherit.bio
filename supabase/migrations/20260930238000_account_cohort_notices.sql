-- Account/cohort notice envelope. No public nonce door or worker grant is
-- widened. The existing v2 nonce transaction calls these replaced v1 bodies.
-- Mandatory contacts are exact current bindings, never a newest-row fallback.
create function private.account_affected_notice_envelope_v1(p_account uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.embryo_cohorts; p public.subject_principals; e public.encrypted_contact_references;
 ids uuid[]:='{}'; members uuid[]; result jsonb:='[]'; cohorts jsonb:='[]'; recipient uuid;
begin
 perform private.lock_invitation_transitions_v1();
 for c in select * from public.embryo_cohorts where owner_account_id=p_account order by id for update loop
  perform 1 from public.embryo_basis_bindings b where b.cohort_id=c.id
   and b.basis_case=c.basis_case and b.basis_revision=c.basis_revision
   and b.participant_set_revision=c.participant_set_revision for update;
  if not found then raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  perform 1 from public.embryo_participant_sets where cohort_id=c.id order by set_kind,principal_id for update;
  perform 1 from public.embryo_donor_attributions where cohort_id=c.id order by id for update;
  members:=private.embryo_cohort_set_v1(c.id,'notice_recipients');
  if cardinality(members)=0 then raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  ids:=ids||members||array(select d.donor_principal_id from public.embryo_donor_attributions d
   join public.consent_signatures s on s.id=d.signature_id and s.signer_principal_id=d.donor_principal_id
    and s.target_kind='cohort_draft' and s.target_id=c.draft_id and s.artifact_key='consent.embryo-donor-attribution'
    and exists(select 1 from public.subject_consents sc where sc.signature_id=s.id and sc.cohort_id=c.id
     and sc.consent_type='donor_attribution' and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp()))
   where d.cohort_id=c.id and d.revoked_at is null and d.classification='identified_consented'
    and d.attribution_revision=c.donor_attribution_revision);
  if exists(select 1 from public.embryo_donor_attributions d where d.cohort_id=c.id and d.revoked_at is null
   and d.classification='identified_consented' and (d.attribution_revision<>c.donor_attribution_revision
    or not exists(select 1 from public.consent_signatures s where s.id=d.signature_id
     and s.signer_principal_id=d.donor_principal_id and s.target_kind='cohort_draft' and s.target_id=c.draft_id
     and s.artifact_key='consent.embryo-donor-attribution' and exists(select 1 from public.subject_consents sc where sc.signature_id=s.id and sc.cohort_id=c.id
     and sc.consent_type='donor_attribution' and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp()))))) then
   raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  cohorts:=cohorts||jsonb_build_array(jsonb_build_object('cohortId',c.id,'basisRevision',c.basis_revision,
   'participantSetRevision',c.participant_set_revision,'recipientSetRevision',c.recipient_set_revision,
   'donorAttributionRevision',c.donor_attribution_revision,'lifecycleRevision',c.lifecycle_revision));
 end loop;
 -- Current no-account adult control and other current affected authority.
 ids:=ids||array(select sp.id from public.subjects s join public.subject_principals sp on sp.subject_id=s.id
  where s.owner_account_id=p_account and s.subject_class='other_adult' and sp.status='active'
   and sp.principal_kind in('account_subject','non_account_subject') and sp.account_id is distinct from p_account);
 ids:=ids||array(select d.recipient_principal_id from public.directional_grants d join public.purpose_grants g
  on g.grant_id=d.grant_id and g.grant_revision=d.grant_revision where d.status='current'
   and g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp()) and (
    (g.target_kind='subject' and g.target_id in(select id from public.subjects where owner_account_id=p_account))
    or (g.target_kind='cohort' and g.target_id in(select id from public.embryo_cohorts where owner_account_id=p_account)))
   and d.recipient_account_id is distinct from p_account);
 ids:=ids||array(select recipient_principal_id from public.provider_recipient_grants
  where account_id=p_account and status='current');
 for recipient in select distinct x from unnest(ids) x order by x loop
  select * into p from public.subject_principals where id=recipient for update;
  if p.id is null or p.status<>'active' then raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  perform 1 from public.encrypted_contact_references where principal_id=p.id and status='current' order by id for update;
  if (select count(*) from public.encrypted_contact_references where principal_id=p.id and status='current')<>1 then
   raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  select * into strict e from public.encrypted_contact_references where principal_id=p.id and status='current';
  if e.contact_ciphertext is null or e.authority_revision<>p.principal_revision then
   raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  result:=result||jsonb_build_array(jsonb_build_object('principalId',p.id,'principalRevision',p.principal_revision,'contactId',e.id));
 end loop;
 return jsonb_build_object('version','account-affected-notice-v1','cohorts',cohorts,'recipients',result);
end $$;
revoke all on function private.account_affected_notice_envelope_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.enqueue_account_affected_notice_v1(p_deletion uuid,p_binding jsonb,p_cancelled boolean,p_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.subject_principals; e public.encrypted_contact_references; result uuid; t timestamptz:=pg_catalog.clock_timestamp();
 template text:=case when p_cancelled then 'account-deletion-affected-cancelled' else 'account-deletion-affected' end;
begin
 select * into p from public.subject_principals where id=(p_binding->>'principalId')::uuid for update;
 select * into e from public.encrypted_contact_references where id=(p_binding->>'contactId')::uuid for update;
 if p.id is null or p.status<>'active' or p.principal_revision<>(p_binding->>'principalRevision')::bigint
  or e.id is null or e.principal_id<>p.id or e.status<>'current' or e.contact_ciphertext is null
  or e.authority_revision<>p.principal_revision or (select count(*) from public.encrypted_contact_references
   where principal_id=p.id and status='current')<>1 then
  raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,created_at,not_before)
 values(template,template,'account',p_deletion,p.id,e.id,p.principal_revision,1,
  encode(extensions.digest(concat_ws(':',template,p_deletion::text,p.id::text),'sha256'),'hex'),
  jsonb_build_object(case when p_cancelled then 'cancelledAt' else 'noticeEndsAt' end,p_at),
  p_at+interval '1 day',t,t) returning id into result;
 return result;
end $$;
revoke all on function private.enqueue_account_affected_notice_v1(uuid,jsonb,boolean,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;


create function private.assert_account_affected_notice_receipt_v1(p_deletion uuid,p_envelope jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests; current_envelope jsonb; r jsonb; saved jsonb;
begin
 select * into strict d from public.account_deletion_requests where id=p_deletion for update;
 saved:=p_envelope->'affectedNotice';
 if coalesce(saved->>'version','')<>'account-affected-notice-v1' then
  raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
 current_envelope:=private.account_affected_notice_envelope_v1(d.account_id);
 if exists(select 1 from jsonb_array_elements(current_envelope->'cohorts') c where not exists(
  select 1 from jsonb_array_elements(saved->'cohorts') s where s->>'cohortId'=c->>'cohortId')) then
  raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
 for r in select value from jsonb_array_elements(current_envelope->'recipients') loop
  if not exists(select 1 from jsonb_array_elements(saved->'recipients') s join public.mail_outbox m
   on m.id=(s->>'outboxId')::uuid where s->>'principalId'=r->>'principalId'
    and m.template_id='account-deletion-affected' and m.purpose=m.template_id and m.target_kind='account' and m.target_id=d.id
    and m.recipient_principal_id=(s->>'principalId')::uuid and m.contact_reference_id=(s->>'contactId')::uuid
    and m.recipient_authority_revision=(s->>'principalRevision')::bigint and m.expires_at=d.notice_ends_at+interval '1 day'
    and m.template_payload=jsonb_build_object('noticeEndsAt',d.notice_ends_at) and m.token_purpose is null and m.token_target_id is null) then
   raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
 end loop;
end $$;
revoke all on function private.assert_account_affected_notice_receipt_v1(uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

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
  v_notice jsonb; v_binding jsonb; v_bound jsonb:='[]'; v_mail uuid;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  if exists(select 1 from public.embryo_cohorts where owner_account_id=p_account_id) then
    perform private.assert_supported_self_deletion_graph_v1(p_account_id);
  end if;
  v_notice := private.account_affected_notice_envelope_v1(p_account_id);

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

  if (select count(*) from public.encrypted_contact_references where principal_id=v_principal.id and status='current')>1 then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;

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

  for v_binding in select value from jsonb_array_elements(v_notice->'recipients') loop
    v_mail:=private.enqueue_account_affected_notice_v1(v_request.id,v_binding,false,v_request.notice_ends_at);
    v_bound:=v_bound||jsonb_build_array(v_binding||jsonb_build_object('outboxId',v_mail));
  end loop;
  update public.retention_due_phases
  set immutable_envelope=immutable_envelope||jsonb_build_object('affectedNotice',
    jsonb_set(v_notice,'{recipients}',v_bound))
  where retention_row_id=v_retention_id and phase_id='account-deletion-notice-deadline';

  -- Keep only the verified session that requested deletion. The proxy limits
  -- that session to export, revocation, transfer, and cancellation operations.
  delete from auth.sessions
  where user_id = p_account_id and id <> p_session_id;

  return query select v_request.id, 'notice_period'::text, v_request.notice_ends_at;
end;
$$;

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
  v_notice jsonb; v_binding jsonb; v_saved jsonb;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  -- Lock current cohort/recipient authority before the account retention rows.
  v_notice:=private.account_affected_notice_envelope_v1(p_account_id);

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
    and r.state = 'scheduled' and r.fixed_deadline=v_request.notice_ends_at
    and exists(select 1 from public.retention_due_phases p where p.retention_row_id=r.id
      and p.phase_id='account-deletion-notice-deadline'
      and p.immutable_envelope->>'deletionRequestId'=v_request.id::text)
  for update;
  perform 1 from public.retention_due_phases where retention_row_id=v_retention.id order by phase_id,phase_revision for update;
  perform 1 from public.purge_manifests where retention_row_id=v_retention.id order by id for update;

  if exists (
    select 1 from public.retention_due_phases p
    where p.retention_row_id = v_retention.id
      and p.status not in ('pending', 'retry')
  ) or exists (
    select 1 from public.purge_manifests m
    where m.retention_row_id = v_retention.id and (m.state = 'executing' or m.physical_purge_started_at is not null or m.batch_cursor>0)
  ) then
    raise exception using errcode = 'P0002', message = 'deletion_request_not_cancellable';
  end if;

  select immutable_envelope->'affectedNotice' into v_saved from public.retention_due_phases
  where retention_row_id=v_retention.id and phase_id='account-deletion-notice-deadline' for update;
  if exists(select 1 from public.embryo_cohorts where owner_account_id=p_account_id)
    and coalesce(v_saved->>'version','')<>'account-affected-notice-v1' then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  if coalesce(v_saved->>'version','')='account-affected-notice-v1' and exists(
    select 1 from jsonb_array_elements(v_notice->'recipients') c where not exists(
      select 1 from jsonb_array_elements(v_saved->'recipients') s where s->>'principalId'=c->>'principalId')) then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;

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

  -- A cancelled request requires a fresh normal sign-in. No consent or
  -- resource state is reactivated here, and every old session is revoked.
  if not exists(select 1 from public.encrypted_contact_references e where e.principal_id=v_principal.id
    and e.status='current' and e.contact_ciphertext is not null and e.authority_revision=v_principal.principal_revision) then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  update public.subject_principals set principal_revision=principal_revision+1
  where id=v_principal.id returning * into v_principal;
  if (select count(*) from public.encrypted_contact_references where principal_id=v_principal.id and status='current')<>1 then
    raise exception using errcode='55000',message='account_notice_binding_unavailable'; end if;
  update public.encrypted_contact_references set authority_revision=v_principal.principal_revision
  where principal_id=v_principal.id and status='current';
  delete from auth.sessions where user_id=p_account_id;

  select ecr.id into strict v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id and ecr.status = 'current'
  order by ecr.created_at desc limit 1;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at,created_at,not_before
  ) values (
    'account-deletion-cancelled', 'account-deletion-cancelled', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object('settingsPath', '/settings/data'),
    v_now + interval '30 days',v_now,v_now
  );

  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='account_deletion_cancelled'
  where target_kind='account' and target_id=v_request.id and template_id='account-deletion-affected'
    and state in('queued','claimed');
  v_notice:=private.account_affected_notice_envelope_v1(p_account_id);
  for v_binding in select value from jsonb_array_elements(v_notice->'recipients') loop
    perform private.enqueue_account_affected_notice_v1(v_request.id,v_binding,true,v_now);
  end loop;
  return query select 'active'::text, v_now;
end;
$$;

create or replace function public.claim_due_account_deletion_v1(
  p_claim_token_hash text,
  p_lease_seconds integer default 300
)
returns table (
  deletion_id uuid,
  account_id uuid,
  storage_objects jsonb,
  database_already_purged boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.account_deletion_requests%rowtype;
  v_retention public.retention_rows%rowtype;
  v_phase public.retention_due_phases%rowtype;
  v_manifest_id uuid;
  v_subject_id uuid;
begin
  perform private.lock_invitation_transitions_v1();
  if p_claim_token_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds not between 30 and 300
  then
    raise exception using errcode = '22023', message = 'invalid_retention_claim';
  end if;

  select d.* into v_request
  from public.account_deletion_requests d
  where (
      d.state = 'notice_period'
      and d.notice_ends_at <= v_now
    ) or (
      d.state = 'delete_started'
      and (d.claim_expires_at is null or d.claim_expires_at <= v_now)
    )
  order by d.notice_ends_at, d.id
  for update skip locked
  limit 1;

  if v_request.id is null then return; end if;
  if v_request.account_id is null then
    raise exception using errcode = '55000', message = 'deletion_account_missing';
  end if;

  select r.* into strict v_retention
  from public.retention_rows r
  where r.retention_id = 'account-deletion.notice-7d'
    and r.target_kind = 'account'
    and r.target_id = v_request.account_id
    and r.state in ('scheduled', 'active')
    and r.fixed_deadline = v_request.notice_ends_at
  order by r.created_at desc limit 1
  for update;

  select p.* into strict v_phase
  from public.retention_due_phases p
  where p.retention_row_id = v_retention.id
    and p.phase_id = 'account-deletion-notice-deadline'
    and p.phase_deadline = v_request.notice_ends_at
    and p.status in ('pending', 'retry', 'claimed')
  for update;

  select m.id into strict v_manifest_id
  from public.purge_manifests m
  where m.retention_row_id = v_retention.id
    and m.phase_id = v_phase.phase_id
    and m.phase_revision = v_phase.phase_revision
    and m.manifest_class = 'complete-retention'
    and m.state in ('frozen', 'executing')
  for update;

  if exists(select 1 from public.embryo_cohorts where owner_account_id=v_request.account_id) then
    perform private.assert_account_affected_notice_receipt_v1(v_request.id,v_phase.immutable_envelope);
  end if;
  if v_request.state = 'notice_period' then
    if v_phase.status not in ('pending', 'retry')
      or v_retention.fixed_deadline > v_now
    then
      raise exception using errcode = '55000', message = 'retention_not_due';
    end if;

    v_subject_id := private.assert_supported_self_deletion_graph_v1(
      v_request.account_id
    );

    if not exists (
      select 1 from public.profiles p
      where p.id = v_request.account_id
        and p.deletion_requested_at is not null
      for update
    ) then
      raise exception using errcode = '55000', message = 'deletion_hold_missing';
    end if;

    update public.account_deletion_requests
    set state = 'delete_started', delete_started_at = v_now,
        claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
        storage_manifest_frozen_at = v_now,
        last_error_code = null
    where id = v_request.id
    returning * into v_request;

    update public.retention_rows
    set state = 'active'
    where id = v_retention.id;
    update public.retention_due_phases
    set status = 'claimed', claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_request.claim_expires_at,
        attempts = attempts + 1
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
    update public.purge_manifests
    set state = 'executing'
    where id = v_manifest_id;

    perform private.prepare_account_owned_cohorts_v1(v_request.id);

    -- No Auth session survives the deadline transition.
    delete from auth.sessions where user_id = v_request.account_id;

    insert into public.account_deletion_storage_entries (
      deletion_id, entry_ordinal, bucket_id, object_name,
      source_kind, source_id
    )
    select v_request.id,
      row_number() over (order by x.bucket_id, x.object_name),
      x.bucket_id, x.object_name, x.source_kind, x.source_id
    from (
      select gso.bucket_id, gso.object_name,
        case when gso.generated_export_id is null
          then 'canonical-source' else 'generated-export' end as source_kind,
        gso.object_id as source_id
      from public.genome_storage_objects gso
      left join public.genome_files gf on gf.id = gso.genome_file_id
      left join public.generated_exports ge on ge.id = gso.generated_export_id
      where gf.user_id = v_request.account_id
         or gf.subject_id = v_subject_id
         or ge.account_id = v_request.account_id

      union

      select 'genomes', gf.bucket_path, 'legacy-source', gf.id
      from public.genome_files gf
      where (gf.user_id = v_request.account_id or gf.subject_id = v_subject_id)
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = 'genomes' and so.name = gf.bucket_path
        )
        and not exists (
          select 1 from public.genome_storage_objects gso
          where gso.genome_file_id = gf.id
            and gso.bucket_id = 'genomes'
            and gso.object_name = gf.bucket_path
        )

      union

      select us.storage_bucket, us.staging_object_name,
        'upload-staging', us.id
      from public.upload_sessions us
      where us.account_id = v_request.account_id
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = us.storage_bucket
            and so.name = us.staging_object_name
        )
    ) x
    on conflict do nothing;

    insert into public.purge_manifest_entries (
      manifest_id, target_id, store_name, row_key, entry_revision, status
    )
    select v_manifest_id, 'storage-objects', 'storage.objects',
      jsonb_build_object('bucketId', e.bucket_id, 'objectName', e.object_name),
      e.entry_ordinal, 'pending'
    from public.account_deletion_storage_entries e
    where e.deletion_id = v_request.id
    on conflict do nothing;
  else
    update public.account_deletion_requests
    set claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
        last_error_code = null
    where id = v_request.id
    returning * into v_request;
    update public.retention_due_phases
    set status = 'claimed', claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_request.claim_expires_at,
        attempts = least(attempts + 1, 20)
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
  end if;

  return query
  select v_request.id, v_request.account_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketId', e.bucket_id,
        'objectName', e.object_name,
        'ordinal', e.entry_ordinal
      ) order by e.entry_ordinal)
      from public.account_deletion_storage_entries e
      where e.deletion_id = v_request.id and e.status = 'pending'
    ), '[]'::jsonb),
    v_request.database_purged_at is not null;
end;
$$;

notify pgrst,'reload schema';
