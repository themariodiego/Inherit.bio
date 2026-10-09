-- Final case rejection is separate from documentary approval and from a
-- human target determination. It grants nothing and mutates no target.
create table private.public_appeal_case_decisions (
  case_id uuid primary key references private.new_public_appeal_intakes(id) on delete restrict,
  decision text not null check (decision = 'reject'),
  review_revision bigint not null check (review_revision > 1),
  evidence_revision bigint not null check (evidence_revision > 0),
  reviewer_principal_id uuid not null,
  reviewer_account_id uuid not null,
  auth_session_id uuid not null,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  reason_ciphertext bytea,
  decided_at timestamptz not null,
  original_deadline timestamptz not null,
  check (reason_ciphertext is null or octet_length(reason_ciphertext) between 48 and 8128),
  check (decided_at < original_deadline)
);
alter table private.public_appeal_case_decisions enable row level security;
revoke all on private.public_appeal_case_decisions from public, anon, authenticated, service_role, inherit_upload_only;
insert into public.purge_target_stores(target_id, store_name, store_order)
  values ('appeal-and-correction-working-packages', 'private.public_appeal_case_decisions', 19);

-- Preserve the original full current case/recipient/reviewer predicate.
-- Unlike evidence approval, rejection does not depend on the continued
-- applicability of a target or an underlying decision.
create function private.public_appeal_case_current_v1(p_case uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
 select exists(select 1 from private.new_public_appeal_intakes intake
  join private.new_public_appeal_config config on config.singleton and config.enabled
  join private.new_public_appeal_reviewers reviewer on reviewer.principal_id=intake.reviewer_principal_id
   and reviewer.active and reviewer.principal_revision=intake.reviewer_revision and reviewer.purpose_revision=intake.purpose_revision
  join public.subject_principals review_actor on review_actor.id=reviewer.principal_id and review_actor.principal_kind='reviewer'
   and review_actor.status='active' and review_actor.principal_revision=reviewer.principal_revision
  join private.claim_reviewers assignment on assignment.account_id=review_actor.account_id and assignment.status='active'
  join public.appeal_intakes appeal on appeal.id=intake.id and appeal.target_kind='public_case'
   and appeal.target_id=appeal.id and appeal.appellant_account_id is null and appeal.state in('submitted','reviewing')
  join public.subject_principals actor on actor.id=intake.author_principal_id and actor.id=appeal.appellant_principal_id
   and actor.principal_kind='case_requester' and actor.subject_id is null and actor.account_id is null
   and actor.principal_revision=1 and actor.status='active'
  join public.encrypted_contact_references contact on contact.id=intake.case_contact_id and contact.principal_id=actor.id
   and contact.status='current' and contact.contact_ciphertext is not null and contact.authority_revision=1
  join public.mail_outbox mail on mail.id=intake.outbox_id and mail.contact_reference_id=contact.id
   and mail.recipient_principal_id=actor.id and mail.recipient_authority_revision=1
   and mail.purpose='appeal-evidence' and mail.template_id='appeal-evidence' and mail.target_kind='appeal' and mail.target_id=intake.id
   and mail.semantic_revision=1 and mail.token_purpose='appeal-evidence' and mail.token_target_id=intake.id and mail.template_payload='{}'
  join public.token_candidates candidate on candidate.id=intake.candidate_id and candidate.outbox_id=mail.id
   and candidate.target_kind='appeal' and candidate.target_id=intake.id and candidate.token_revision=1
   and candidate.purpose='appeal-evidence' and candidate.state='issued'
   and candidate.expires_at=least(intake.deadline,intake.submitted_at+interval '7 days') and mail.expires_at=candidate.expires_at
  where intake.id=p_case and intake.kind in('subject-objection','genetic-parent-objection','access-or-review-appeal')
   and intake.state='committed' and octet_length(intake.wrapped_case_key)=72 and intake.working_ciphertext is not null
   and intake.deadline=intake.submitted_at+interval '30 days' and intake.deadline>clock_timestamp()
   and exists(select 1 from public.token_hashes token join public.rights_sessions rights on rights.token_hash_id=token.id
    where token.candidate_id=candidate.id and token.token_revision=1 and token.status='consumed' and token.ended_at is not null
     and rights.principal_id=intake.author_principal_id and rights.purpose='appeal-evidence'
     and rights.target_kind='appeal-case' and rights.target_id=intake.id and rights.created_at>=token.created_at
     and rights.created_at<=candidate.expires_at and rights.expires_at<=rights.created_at+interval '60 minutes'));
$$;

-- The caller cannot supply an account, reviewer, target or contact selector.
-- A missing document/target is a valid rejection state, not a fabricated match.
create function private.public_appeal_case_review_at_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $case_context$
declare
  reviewer record;
  intake private.new_public_appeal_intakes;
  pending private.public_appeal_pending_reviews;
  evidence_revision bigint;
  review_revision bigint;
  documents jsonb;
begin
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null then raise exception using errcode='42501', message='appeal unavailable'; end if;
  perform private.lock_invitation_transitions_v1();
  select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case for update;
  if intake.id is null then raise exception using errcode='42501', message='appeal unavailable'; end if;
  perform 1 from public.appeal_intakes where id=intake.id for update;
  perform 1 from private.new_public_appeal_config where singleton for share;
  perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
  perform 1 from private.claim_reviewers where account_id=reviewer.account_id for share;
  perform 1 from public.subject_principals where id in(intake.author_principal_id,intake.reviewer_principal_id) order by id for share;
  perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
  perform 1 from public.mail_outbox where id=intake.outbox_id for share;
  perform 1 from public.token_candidates where id=intake.candidate_id for share;
  perform 1 from private.new_public_appeal_evidence_state where case_id=intake.id for update;
  select source.* into pending from private.public_appeal_pending_reviews source where source.case_id=intake.id for update;
  if not private.public_appeal_case_current_v1(p_case) or not exists(select 1 from public.subject_principals actor
    where actor.id=intake.reviewer_principal_id and actor.account_id=reviewer.account_id)
    or (pending.case_id is not null and (pending.state<>'pending' or pending.deadline is distinct from intake.deadline
      or pending.reviewer_principal_id is distinct from intake.reviewer_principal_id
      or pending.reviewer_revision is distinct from intake.reviewer_revision
      or pending.purpose_revision is distinct from intake.purpose_revision))
    or exists(select 1 from private.public_appeal_case_decisions outcome where outcome.case_id=p_case) then
    raise exception using errcode='42501', message='appeal unavailable';
  end if;
  review_revision:=coalesce(pending.review_revision,
    (select max(outcome.review_revision)+1 from private.public_appeal_document_decisions outcome where outcome.case_id=p_case),1);
  evidence_revision:=coalesce(pending.evidence_revision,
    (select source.revision from private.new_public_appeal_evidence_state source where source.case_id=p_case),1);
  select coalesce(jsonb_agg(jsonb_build_object('documentId',doc.id,'documentKind',doc.document_kind,'sha256',doc.sha256,
    'decision',(select outcome.decision from private.public_appeal_document_decisions outcome where outcome.document_id=doc.id
      order by outcome.review_revision desc limit 1)) order by doc.document_kind,doc.id),'[]') into documents
    from private.appeal_documents doc where doc.intake_id=p_case and doc.state='clean' and doc.object_deleted_at is null
      and doc.scanned_sha256=doc.sha256 and doc.scan_verdict='OK'
      and (pending.case_id is null or doc.id=any(array_remove(array[pending.photo_document_id,pending.authority_document_id,
        pending.decision_notice_document_id],null)));
  return jsonb_build_object('reviewerAccountId',reviewer.account_id,'authSessionId',reviewer.auth_session_id,
    'context',jsonb_build_object('contextVersion','appeal-case-final-context-v1','caseId',p_case,'caseKind',intake.kind,
      'reviewRevision',review_revision,'evidenceRevision',evidence_revision,'deadline',intake.deadline,
      'scope',intake.frame->'scope','wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),
      'workingCiphertextHex',encode(intake.working_ciphertext,'hex'),
      'statementCiphertextHex',(select encode(appeal.statement_ciphertext,'hex') from public.appeal_intakes appeal where appeal.id=p_case),
      'contactCiphertextHex',(select encode(contact.contact_ciphertext,'hex') from public.encrypted_contact_references contact where contact.id=intake.case_contact_id),
      'documents',documents,'documentDecisionsAvailable',pending.case_id is not null and pending.state='pending'
        and private.new_public_appeal_evidence_current_v1(p_case),'allowedDecisions',jsonb_build_array('reject')));
end $case_context$;

create function public.read_public_appeal_case_context_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare value jsonb;
begin
  value:=private.public_appeal_case_review_at_v1(p_case);
  perform private.append_legal_audit_event('appeal.review.read',null,'api.appeal-review','accepted','{}');
  return value->'context';
end $$;

create function public.decide_public_appeal_case_v1(p_case uuid,p_decision text,p_review_revision bigint,
  p_evidence_revision bigint,p_nonce_hash text,p_reason_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path = '' as $case_decision$
declare value jsonb;intake private.new_public_appeal_intakes;next_revision bigint;now_at timestamptz;
begin
  -- Other matrix branches remain closed until their independent native
  -- target/underlying authority and exact disposition are implemented.
  if p_decision is distinct from 'reject' or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
    or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 48 and 8128 then
    raise exception using errcode='42501',message='appeal unavailable';
  end if;
  value:=private.public_appeal_case_review_at_v1(p_case);
  if p_review_revision is distinct from (value#>>'{context,reviewRevision}')::bigint
    or p_evidence_revision is distinct from (value#>>'{context,evidenceRevision}')::bigint then
    raise exception using errcode='42501',message='appeal unavailable';
  end if;
  select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
  next_revision:=p_review_revision+1;now_at:=clock_timestamp();
  insert into private.public_appeal_case_decisions(case_id,decision,review_revision,evidence_revision,
    reviewer_principal_id,reviewer_account_id,auth_session_id,nonce_hash,reason_ciphertext,decided_at,original_deadline)
    values(p_case,'reject',next_revision,p_evidence_revision,intake.reviewer_principal_id,
      (value->>'reviewerAccountId')::uuid,(value->>'authSessionId')::uuid,p_nonce_hash,p_reason_ciphertext,now_at,intake.deadline);
  -- Existing terminal triggers clear only this case's hold, erase independent
  -- keys and all credentials, and retain due object locators for genuine ACK.
  update public.appeal_intakes set state='rejected',decided_at=now_at where id=p_case;
  update private.public_appeal_case_decisions set reason_ciphertext=null where case_id=p_case;
  if not exists(select 1 from private.new_public_appeal_intakes source where source.id=p_case and source.state='closed'
      and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
    or exists(select 1 from private.appeal_document_sessions source where source.intake_id=p_case and source.wrapped_document_key is not null)
    or exists(select 1 from public.rights_sessions source where source.target_kind='appeal-case' and source.target_id=p_case)
    or exists(select 1 from private.public_appeal_provisional_targets source where source.case_id=p_case) then
    raise exception using errcode='42501',message='appeal unavailable';
  end if;
  perform private.append_legal_audit_event('appeal.review.rejected',null,'api.appeal-review','refused','{}');
  return jsonb_build_object('caseId',p_case,'state','resolved','outcome','rejected','reviewRevision',next_revision);
end $case_decision$;

create function private.guard_public_appeal_case_decision_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new)-'reason_ciphertext') is distinct from (to_jsonb(old)-'reason_ciphertext')
    or not(new.reason_ciphertext is null and old.reason_ciphertext is not null
      and exists(select 1 from private.new_public_appeal_intakes source where source.id=new.case_id and source.state='closed')) then
    raise exception using errcode='42501',message='appeal unavailable';
  end if;
  return new;
end $$;
create trigger guard_public_appeal_case_decision before update on private.public_appeal_case_decisions
  for each row execute function private.guard_public_appeal_case_decision_v1();

revoke all on function private.public_appeal_case_current_v1(uuid),private.public_appeal_case_review_at_v1(uuid),
  private.guard_public_appeal_case_decision_v1() from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.read_public_appeal_case_context_v1(uuid),
  public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_case_context_v1(uuid),
  public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) to authenticated;
notify pgrst,'reload schema';
