-- Operation-specific human decisions. Original delivery and retention clocks
-- are immutable; no objection decision may detach or release a record.
alter table private.claim_review_decisions drop constraint claim_review_decisions_decision_check;
alter table private.claim_review_decisions add constraint claim_review_decisions_decision_check check(decision in(
  'approve-record-key','approve-recovery-key','approve-claimed-unbound-no-key-recovery','keyless-document-match',
  'needs-more-information','reject','uphold-objection','overrule-objection'));

-- A reviewed-invalid objection can change only its current decision revision.
-- The original delivered revision, provider receipt, start and30-day deadline
-- never move. Caller-set flags supply no authority to this guard.
create or replace function private.guard_keyless_owner_notice_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.owner_account_id is null then return new;end if;
  if (new.id,new.claim_id,new.outbox_id,new.notice_kind,new.created_at,new.owner_account_id,new.owner_principal_id,
    new.owner_authority_revision,new.candidate_id,new.delivery_notice_revision)
    is distinct from(old.id,old.claim_id,old.outbox_id,old.notice_kind,old.created_at,old.owner_account_id,old.owner_principal_id,
    old.owner_authority_revision,old.candidate_id,old.delivery_notice_revision)
    or (old.delivered_at is not null and (new.delivered_at,new.notice_deadline,new.provider_attempt_id)
      is distinct from(old.delivered_at,old.notice_deadline,old.provider_attempt_id)) then
    raise exception using errcode='55000',message='immutable owner notice';end if;
  if new.notice_revision is distinct from old.notice_revision and not(
    new.notice_revision=old.notice_revision+1 and exists(select 1 from public.future_person_claim_objections o
      join private.claim_reviews r on r.id=o.claim_id and r.state='approved_pending_owner_notice'
      join private.claim_review_decisions d on d.review_id=r.id and d.review_revision+1=r.review_revision
        and d.decision='overrule-objection' and d.reviewer_account_id=auth.uid()
        and d.auth_session_id=(auth.jwt()->>'session_id')::uuid
      join private.claim_review_assignments a on a.review_id=r.id and a.status='current'
        and a.reviewer_account_id=d.reviewer_account_id and a.review_operation='claim-objection'
      where o.notice_id=old.id and o.claim_id=old.claim_id and o.status='overruled'
        and o.initial_notice_revision=old.delivery_notice_revision and old.notice_revision=old.delivery_notice_revision
        and o.decided_at=d.decided_at and o.release_recheck_deadline=least(o.decided_at+interval '24 hours',o.timely_deadline))) then
    raise exception using errcode='55000',message='immutable owner notice';end if;
  return new;
end $$;

create function private.decide_keyless_objection_v1(p_objection uuid,p_objection_revision bigint,p_review_revision bigint,
  p_notice_revision bigint,p_decision text,p_nonce_hash text,p_reason_ciphertext bytea)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare reviewer record; r private.claim_reviews; k public.future_person_claim_review_packages;
  n public.future_person_claim_notices; o public.future_person_claim_objections;
  photo private.claim_documents; birth private.claim_documents; decision_at timestamptz;
  assignment private.claim_review_assignments; phase_row uuid; deadline timestamptz; state text;
  contact public.encrypted_contact_references; principal public.subject_principals;
begin
  if p_decision is null or p_decision not in('uphold-objection','overrule-objection','needs-more-information')
    or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
    or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 29 and 16384 then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null then raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into o from public.future_person_claim_objections where id=p_objection and notice_id is not null;
  r:=private.assigned_claim_review_v1(o.claim_id,reviewer.account_id);
  select * into o from public.future_person_claim_objections where id=p_objection for update;
  select * into k from public.future_person_claim_review_packages where review_id=r.id for update;
  select * into n from public.future_person_claim_notices where id=o.notice_id for update;
  select * into assignment from private.claim_review_assignments where review_id=r.id and status='current'
    and reviewer_account_id=reviewer.account_id and review_operation='claim-objection';
  decision_at:=clock_timestamp();
  if r.id is null or r.state<>'approved_pending_owner_notice' or assignment.review_id is null
    or k.state<>'objected' or o.status<>'submitted' or o.timely_deadline<=decision_at
    or p_objection_revision is distinct from o.objection_revision or p_review_revision is distinct from r.review_revision
    or p_notice_revision is distinct from n.notice_revision or not private.keyless_owner_notice_current_v1(r.id)
    or not exists(select 1 from private.claim_review_reads read where read.review_id=r.id
      and read.reviewer_account_id=reviewer.account_id and read.auth_session_id=reviewer.auth_session_id
      and read.review_revision=r.review_revision and read.document_id is null) then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  photo:=private.claim_review_document_v1(r,r.photo_document_id);
  birth:=private.claim_review_document_v1(r,r.birth_record_document_id);
  if photo.id is null or birth.id is null or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,photo)
    or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,birth) then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  -- Unique nonce plus current review revision is consumed before any outcome.
  insert into private.claim_review_decisions(review_id,review_revision,decision,reviewer_account_id,auth_session_id,
    photo_document_id,photo_sha256,birth_record_document_id,birth_record_sha256,reason_ciphertext,nonce_hash,decided_at)
    values(r.id,r.review_revision,p_decision,reviewer.account_id,reviewer.auth_session_id,photo.id,photo.sha256,
      birth.id,birth.sha256,p_reason_ciphertext,p_nonce_hash,decision_at);
  if p_decision='uphold-objection' then
    update public.future_person_claim_objections set status='upheld',objection_revision=objection_revision+1,
      decided_at=decision_at,statement_ciphertext=null,wrapped_statement_key=null,statement_key_shredded_at=decision_at,
      review_reason_ciphertext=null where id=o.id;
    perform private.close_keyless_notice_v1(r.id,'refused');state:='claim_rejected';
    perform private.append_legal_audit_event('claim.resolved',null,'api.future-person-claim-objection-review','refused',
      jsonb_build_object('outcome','objection-upheld'));
  elsif p_decision='overrule-objection' then
    deadline:=least(decision_at+interval '24 hours',o.timely_deadline);
    select id into phase_row from public.retention_rows where target_kind='claim' and target_id=r.id
      and retention_id='future-person.claim-objection-review-30d' and state in('scheduled','active') for update;
    if phase_row is null or deadline<=decision_at then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    -- Commit the exact replacement before superseding the prior close phase.
    insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
      target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,
      recipient_authority_revision,immutable_envelope)
      values(phase_row,'future-person.claim-objection-review-30d','overrule-release-close','review-close',r.review_revision+1,
        deadline,'claim',r.id,(k.authority_binding->>'subjectLifecycleRevision')::bigint,
        (k.authority_binding->>'embryoDispositionRevision')::bigint,'claim-review-package',r.review_revision+1,
        jsonb_build_object('reviewId',r.id,'objectionId',o.id,'reviewRevision',r.review_revision+1,
          'noticeId',n.id,'noticeRevision',n.notice_revision+1,'objectionRevision',o.objection_revision+1));
    update public.future_person_claim_objections set status='overruled',objection_revision=objection_revision+1,
      decided_at=decision_at,release_recheck_deadline=deadline,review_reason_ciphertext=p_reason_ciphertext where id=o.id;
    update private.claim_reviews set review_revision=review_revision+1 where id=r.id;
    update public.future_person_claim_notices set notice_revision=notice_revision+1 where id=n.id;
    update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
      terminal_outcome_code='separate_release_recheck_required',completed_at=decision_at
      where retention_row_id=phase_row and phase_id='objection-review-decision-close' and status in('pending','retry','claimed');
    perform private.assign_keyless_review_operation_v1(r.id,reviewer.account_id,'claim-release');
    state:='release_recheck_required';
    perform private.append_legal_audit_event('claim.review.approved',null,'api.future-person-claim-objection-review','accepted','{}');
  else
    select * into contact from public.encrypted_contact_references where id=k.claimant_delivery_reference_id for update;
    select * into principal from public.subject_principals where id=contact.principal_id for update;
    if contact.id is null or principal.id is null or contact.status is distinct from 'current'
      or contact.contact_ciphertext is null or principal.status is distinct from 'pending'
      or principal.id is distinct from(select claimant_principal_id from public.future_person_claims where id=r.id)
      or contact.authority_revision is distinct from principal.principal_revision then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    update public.future_person_claim_objections set objection_revision=objection_revision+1,
      review_reason_ciphertext=p_reason_ciphertext where id=o.id;
    update private.claim_reviews set review_revision=review_revision+1 where id=r.id;
    -- No documentary text, reviewer reason, identity, document, contact or
    -- token is copied into the persisted notification payload.
    insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
      recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,created_at)
      values('future-person-more-information','future-person-claim-more-information','claim',r.id,principal.id,contact.id,
        principal.principal_revision,r.review_revision+1,
        encode(extensions.digest(convert_to('future-person-more-information-v1|'||r.id||'|'||(r.review_revision+1),'UTF8'),'sha256'),'hex'),
        '{}',o.timely_deadline,decision_at);
    perform private.assign_keyless_review_operation_v1(r.id,reviewer.account_id,'claim-objection');
    state:='more_information_required';
    perform private.append_legal_audit_event('claim.review.more-information',null,'api.future-person-claim-objection-review','accepted','{}');
  end if;
  -- An old queued information request must not be delivered after a new
  -- revision/terminal decision, and no old release/session can regain access.
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='claim_revision_changed'
    where target_kind='claim' and target_id=r.id and purpose='future-person-claim-more-information'
      and semantic_revision<>r.review_revision+1 and state in('queued','claimed');
  update public.future_person_claim_release_credentials set status='revoked' where claim_id=r.id and status in('current','consumed');
  return jsonb_build_object('objectionId',o.id,'state',state,'objectionRevision',o.objection_revision+1);
end $$;
revoke all on function private.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.decide_keyless_objection_v1(p_objection uuid,p_objection_revision bigint,p_review_revision bigint,
  p_notice_revision bigint,p_decision text,p_nonce_hash text,p_reason_ciphertext bytea) returns jsonb
language sql security invoker set search_path='' as $$
 select private.decide_keyless_objection_v1(p_objection,p_objection_revision,p_review_revision,
   p_notice_revision,p_decision,p_nonce_hash,p_reason_ciphertext);$$;
grant execute on function private.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea) to authenticated;
revoke all on function public.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea) to authenticated;

-- Keep every current022/025 canonical provider branch by exact delegation.
-- Only the reviewed complete wrapper may become the private predecessor.
do $information_mail_predecessor$
declare predecessor oid:=to_regprocedure('private.authorize_mail_submission_v1(uuid,smallint)');
begin
  if predecessor is null or to_regprocedure('private.authorize_mail_submission_before_keyless_information_v1(uuid,smallint)') is not null
    or not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      join pg_language language on language.oid=p.prolang join pg_roles owner_role on owner_role.oid=p.proowner
      where p.oid=predecessor and ns.nspname='private' and p.proname='authorize_mail_submission_v1'
        and owner_role.rolname='postgres' and language.lanname='plpgsql' and p.prosecdef
        and p.prokind='f' and not p.proretset and p.prorettype='boolean'::regtype
        and p.pronargs=2 and p.pronargdefaults=0 and p.provariadic=0 and p.proallargtypes is null
        and p.proargtypes[0]='uuid'::regtype and p.proargtypes[1]='smallint'::regtype
        and p.proargnames=array['p_outbox','p_attempt']::text[]
        and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
        and md5(p.prosrc)='448f258385a4c6f4392a1ca1781f0f2a')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
      where has_function_privilege(role_name,predecessor,'execute'))
    or exists(select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=predecessor and acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner) then
    raise exception using errcode='55000',message='information mail predecessor differs';end if;
end;
$information_mail_predecessor$;
alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_keyless_information_v1;
revoke all on function private.authorize_mail_submission_before_keyless_information_v1(uuid,smallint)
 from public,anon,authenticated,inherit_upload_only,service_role;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare m public.mail_outbox; k public.future_person_claim_review_packages;
begin
  select * into m from public.mail_outbox where id=p_outbox;
  if m.purpose is distinct from 'future-person-claim-more-information' then
    return private.authorize_mail_submission_before_keyless_information_v1(p_outbox,p_attempt);end if;
  select * into k from public.future_person_claim_review_packages where claim_id=m.target_id;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=k.claim_id order by id for update;
  select * into m from public.mail_outbox where id=p_outbox for update;
  return exists(select 1 from private.claim_reviews r
    join public.future_person_claim_review_packages package on package.review_id=r.id and package.claim_id=r.id and package.state='objected'
    join public.future_person_claim_objections o on o.claim_id=r.id and o.status='submitted' and o.timely_deadline>clock_timestamp()
    join public.encrypted_contact_references contact on contact.id=package.claimant_delivery_reference_id and contact.id=m.contact_reference_id
      and contact.status='current' and contact.contact_ciphertext is not null and contact.authority_revision=m.recipient_authority_revision
    join public.subject_principals sp on sp.id=contact.principal_id and sp.id=m.recipient_principal_id
      and sp.status='pending' and sp.principal_kind='future_person' and sp.principal_revision=m.recipient_authority_revision
    join public.future_person_claims f on f.id=r.id and f.claimant_principal_id=sp.id and f.status='objected'
    join private.claim_review_decisions d on d.review_id=r.id and d.review_revision+1=r.review_revision and d.decision='needs-more-information'
    where r.id=m.target_id and r.state='approved_pending_owner_notice' and m.target_kind='claim'
      and m.template_id='future-person-more-information' and m.template_payload='{}' and m.token_purpose is null and m.token_target_id is null
      and m.state='claimed' and m.attempt_count=p_attempt and m.expires_at=o.timely_deadline and m.expires_at>clock_timestamp()
      and m.semantic_revision=r.review_revision and private.keyless_owner_notice_current_v1(r.id));
end $$;
revoke all on function private.authorize_mail_submission_v1(uuid,smallint) from public,anon,authenticated,inherit_upload_only,service_role;

-- Terminal claim resolution cancels this data-free request too. This wrapper
-- delegates every existing document/contact/objection/retention cleanup.
alter function private.close_keyless_notice_v1(uuid,text) rename to close_keyless_notice_before_human_information_v1;
revoke all on function private.close_keyless_notice_before_human_information_v1(uuid,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.close_keyless_notice_v1(p_claim uuid,p_code text) returns void
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
  perform private.close_keyless_notice_before_human_information_v1(p_claim,p_code);
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='claim_resolved'
    where target_kind='claim' and target_id=p_claim and purpose='future-person-claim-more-information'
      and state in('queued','claimed');
end $$;
revoke all on function private.close_keyless_notice_v1(uuid,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
