-- An append-only correction of the two actual documentary rejection producers.
-- Original decisions, discarded keys and target authority are never rewritten.
alter table private.public_appeal_case_decisions add column corrected_prior_decision_revision bigint;
alter table private.public_appeal_case_decisions add column corrected_prior_evidence_revision bigint;
alter table private.public_appeal_case_decisions drop constraint public_appeal_case_decisions_decision_check;
alter table private.public_appeal_case_decisions add constraint public_appeal_case_decisions_decision_check check (
 (decision='reject' and prior_decision_id is null and prior_decision_revision is null and prior_evidence_revision is null
  and corrected_prior_decision_revision is null and corrected_prior_evidence_revision is null)
 or (decision='uphold' and prior_decision_id is not null and prior_decision_revision is not null and prior_decision_revision>0
  and prior_evidence_revision is not null and prior_evidence_revision>0
  and corrected_prior_decision_revision is null and corrected_prior_evidence_revision is null)
 or (decision='reverse-prior-decision' and prior_decision_id is not null and prior_decision_revision is not null and prior_decision_revision>0
  and prior_evidence_revision is not null and prior_evidence_revision>0
  and corrected_prior_decision_revision is not null and corrected_prior_evidence_revision is not null
  and corrected_prior_decision_revision=prior_decision_revision+1
  and corrected_prior_evidence_revision=prior_evidence_revision+1));
create unique index public_appeal_prior_reversal_once on private.public_appeal_case_decisions(prior_decision_id)
 where decision='reverse-prior-decision';

-- Preserve every original recipient/reviewer/source predicate. A correction
-- makes the old reference noncurrent; a second case cannot reverse it again.
alter function private.public_appeal_underlying_binding_v1(text,jsonb) rename to public_appeal_underlying_before_reversal_v1;
revoke all on function private.public_appeal_underlying_before_reversal_v1(text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.public_appeal_underlying_binding_v1(p_reference_hash text,p_contact_digests jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare binding jsonb;
begin
 binding:=private.public_appeal_underlying_before_reversal_v1(p_reference_hash,p_contact_digests);
 if binding is null or exists(select 1 from private.public_appeal_case_decisions correction
   where correction.prior_decision_id=(binding->>'decisionId')::uuid and correction.decision='reverse-prior-decision') then return null;end if;
 return binding;
end $$;
revoke all on function private.public_appeal_underlying_binding_v1(text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;

create function private.public_appeal_reversal_binding_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare binding jsonb;outcome private.public_appeal_document_decisions;doc private.appeal_documents;
begin
 -- Includes the complete approved three-document set, actual whole-byte ACKs,
 -- original verified recipient and independent principal AND MFA account.
 binding:=private.public_appeal_uphold_binding_v1(p_case);
 if binding is null then return null;end if;
 select source.* into outcome from private.public_appeal_document_decisions source
  where source.id=(binding->>'decisionId')::uuid for update;
 if outcome.id is null or outcome.decision<>'rejected'
  or outcome.document_kind not in('appeal-subject-source-control','appeal-genetic-parent-authority')
  or outcome.review_revision is distinct from (binding->>'decisionRevision')::bigint
  or outcome.evidence_revision is distinct from (binding->>'evidenceRevision')::bigint
  or exists(select 1 from private.public_appeal_case_decisions correction
    where correction.prior_decision_id=outcome.id and correction.decision='reverse-prior-decision') then return null;end if;
 if outcome.document_id is not null then
  select source.* into doc from private.appeal_documents source where source.id=outcome.document_id for share;
  if doc.id is null or doc.id<>outcome.original_document_id or doc.intake_id<>outcome.case_id
   or doc.document_kind<>outcome.document_kind or doc.sha256<>outcome.document_sha256
   or not exists(select 1 from private.appeal_document_sessions session where session.id=doc.session_id
    and session.wrapped_document_key is null and session.document_key_shredded_at is not null) then return null;end if;
 end if;
 -- Both actual supported producers irrevocably discarded the rejected key.
 -- Lawfully removed objects need only the unchanged immutable decision row.
 -- There is no intact source document to reassign or approve. A new original
 -- evidence flow is required; no key, source, right or old assignment revives.
 if not private.public_appeal_underlying_current_v1(p_case) then return null;end if;
 return binding;
end $$;
revoke all on function private.public_appeal_reversal_binding_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

alter function public.read_public_appeal_case_context_v1(uuid) rename to read_public_appeal_case_before_reversal_v1;
revoke all on function public.read_public_appeal_case_before_reversal_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_public_appeal_case_context_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;binding jsonb;
begin
 value:=public.read_public_appeal_case_before_reversal_v1(p_case);
 binding:=private.public_appeal_reversal_binding_v1(p_case);
 if binding is null then return value;end if;
 return value||jsonb_build_object('allowedDecisions',jsonb_build_array('reject','uphold','reverse-prior-decision','needs-more-information'));
end $$;

create function public.reverse_public_appeal_prior_decision_v1(p_case uuid,p_prior_decision_revision bigint,
 p_review_revision bigint,p_evidence_revision bigint,p_nonce_hash text,p_reason_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $reverse_decision$
declare value jsonb;binding jsonb;intake private.new_public_appeal_intakes;now_at timestamptz;next_revision bigint;
begin
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_reason_ciphertext is null
   or octet_length(p_reason_ciphertext) not between 48 and 8128 then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 value:=private.public_appeal_case_review_at_v1(p_case);
 binding:=private.public_appeal_reversal_binding_v1(p_case);
 if binding is null or p_prior_decision_revision is distinct from (binding->>'decisionRevision')::bigint
  or p_review_revision is distinct from (value#>>'{context,reviewRevision}')::bigint
  or p_evidence_revision is distinct from (value#>>'{context,evidenceRevision}')::bigint then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
 now_at:=clock_timestamp();next_revision:=p_review_revision+1;
 -- This immutable successor marks the locked original rejection reversed at
 -- its next decision/evidence revisions while keeping the whole original row.
 insert into private.public_appeal_case_decisions(case_id,decision,review_revision,evidence_revision,
  reviewer_principal_id,reviewer_account_id,auth_session_id,nonce_hash,reason_ciphertext,decided_at,original_deadline,
  prior_decision_id,prior_decision_revision,prior_evidence_revision,corrected_prior_decision_revision,corrected_prior_evidence_revision)
 values(p_case,'reverse-prior-decision',next_revision,p_evidence_revision,intake.reviewer_principal_id,
  (value->>'reviewerAccountId')::uuid,(value->>'authSessionId')::uuid,p_nonce_hash,p_reason_ciphertext,now_at,intake.deadline,
  (binding->>'decisionId')::uuid,(binding->>'decisionRevision')::bigint,(binding->>'evidenceRevision')::bigint,
  (binding->>'decisionRevision')::bigint+1,(binding->>'evidenceRevision')::bigint+1);
 update public.appeal_intakes set state='approved',decided_at=now_at where id=p_case;
 update private.public_appeal_case_decisions set reason_ciphertext=null where case_id=p_case;
 if not exists(select 1 from private.new_public_appeal_intakes source where source.id=p_case and source.state='closed'
  and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
  or exists(select 1 from private.appeal_document_sessions source where source.intake_id=p_case and source.wrapped_document_key is not null)
  or exists(select 1 from public.rights_sessions source where source.target_kind='appeal-case' and source.target_id=p_case)
  or exists(select 1 from private.public_appeal_provisional_targets source where source.case_id=p_case) then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.append_legal_audit_event('appeal.review.prior_reversed',null,'api.appeal-review','accepted','{}');
 return jsonb_build_object('caseId',p_case,'state','resolved','outcome','prior_decision_reversed','reviewRevision',next_revision);
end $reverse_decision$;
revoke all on function public.read_public_appeal_case_context_v1(uuid),
 public.reverse_public_appeal_prior_decision_v1(uuid,bigint,bigint,bigint,text,bytea) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_case_context_v1(uuid),
 public.reverse_public_appeal_prior_decision_v1(uuid,bigint,bigint,bigint,text,bytea) to authenticated;
notify pgrst,'reload schema';
