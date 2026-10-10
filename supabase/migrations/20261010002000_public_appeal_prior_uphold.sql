-- Keep a genuine prior documentary rejection only after the independent
-- named reviewer approved this appeal's complete current evidence set.
-- This is not reversal, access approval or a target/lifecycle disposition.
alter table private.public_appeal_case_decisions drop constraint public_appeal_case_decisions_decision_check;
alter table private.public_appeal_case_decisions add column prior_decision_id uuid;
alter table private.public_appeal_case_decisions add column prior_decision_revision bigint;
alter table private.public_appeal_case_decisions add column prior_evidence_revision bigint;
alter table private.public_appeal_case_decisions add constraint public_appeal_case_decisions_decision_check check (
 (decision='reject' and prior_decision_id is null and prior_decision_revision is null and prior_evidence_revision is null)
 or (decision='uphold' and prior_decision_id is not null and prior_decision_revision is not null and prior_decision_revision>0
  and prior_evidence_revision is not null and prior_evidence_revision>0));

create function private.public_appeal_uphold_binding_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $uphold_binding$
declare value jsonb;intake private.new_public_appeal_intakes;binding jsonb;required_kind text;expected_kinds text[];actual_kinds text[];source_account uuid;
begin
 -- The own current MFA assignment and original verified case are mandatory
 -- even when this optional branch is not available.
 value:=private.public_appeal_case_review_at_v1(p_case);
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
 if intake.kind<>'access-or-review-appeal' or not private.public_appeal_underlying_current_v1(p_case)
   or not coalesce((value#>>'{context,documentDecisionsAvailable}')::boolean,false) then return null;end if;
 binding:=intake.frame->'underlyingDecision';required_kind:=binding->>'requiredAuthorityKind';
 if required_kind is null or required_kind not in('appeal-subject-source-control','appeal-genetic-parent-authority') then return null;end if;
 expected_kinds:=array['appeal-decision-notice','appeal-photo-identity',required_kind];
 select array_agg(kind order by kind) into expected_kinds from unnest(expected_kinds) kind;
 select array_agg(doc->>'documentKind' order by doc->>'documentKind') into actual_kinds
   from jsonb_array_elements(value#>'{context,documents}') doc;
 if actual_kinds is distinct from expected_kinds or exists(select 1 from jsonb_array_elements(value#>'{context,documents}') doc
   where doc->>'decision' is distinct from 'approved') then return null;end if;
 -- Lock the exact real rejected record; the binding helper has already
 -- compared every saved original revision and same-recipient HMAC natively.
 select outcome.reviewer_account_id into source_account from private.public_appeal_document_decisions outcome
   where outcome.id=(binding->>'decisionId')::uuid for share;
 -- Two reviewer principals must not disguise the same human Auth account.
 if source_account is null or source_account=(value->>'reviewerAccountId')::uuid
   or not private.public_appeal_underlying_current_v1(p_case) then return null;end if;
 return binding;
end $uphold_binding$;
revoke all on function private.public_appeal_uphold_binding_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- Preserve the entire original rejection/context implementations and grants
-- behind private dispatchers; no API role can call those aliases directly.
alter function public.read_public_appeal_case_context_v1(uuid) rename to read_public_appeal_case_context_before_uphold_v1;
revoke all on function public.read_public_appeal_case_context_before_uphold_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_public_appeal_case_context_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;binding jsonb;
begin
 value:=public.read_public_appeal_case_context_before_uphold_v1(p_case);
 binding:=private.public_appeal_uphold_binding_v1(p_case);
 return value||jsonb_build_object('priorDecision',binding,'allowedDecisions',
   case when binding is null then jsonb_build_array('reject') else jsonb_build_array('reject','uphold') end);
end $$;

alter function public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) rename to decide_public_appeal_case_before_uphold_v1;
revoke all on function public.decide_public_appeal_case_before_uphold_v1(uuid,text,bigint,bigint,text,bytea) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.decide_public_appeal_case_v1(p_case uuid,p_decision text,p_review_revision bigint,
 p_evidence_revision bigint,p_nonce_hash text,p_reason_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $uphold_decision$
declare value jsonb;binding jsonb;intake private.new_public_appeal_intakes;now_at timestamptz;next_revision bigint;
begin
 if p_decision is distinct from 'uphold' then
  return public.decide_public_appeal_case_before_uphold_v1(p_case,p_decision,p_review_revision,p_evidence_revision,p_nonce_hash,p_reason_ciphertext);
 end if;
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_reason_ciphertext is null
   or octet_length(p_reason_ciphertext) not between 48 and 8128 then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 value:=private.public_appeal_case_review_at_v1(p_case);
 binding:=private.public_appeal_uphold_binding_v1(p_case);
 if binding is null or p_review_revision is distinct from (value#>>'{context,reviewRevision}')::bigint
   or p_evidence_revision is distinct from (value#>>'{context,evidenceRevision}')::bigint then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
 now_at:=clock_timestamp();next_revision:=p_review_revision+1;
 insert into private.public_appeal_case_decisions(case_id,decision,review_revision,evidence_revision,
  reviewer_principal_id,reviewer_account_id,auth_session_id,nonce_hash,reason_ciphertext,decided_at,original_deadline,
  prior_decision_id,prior_decision_revision,prior_evidence_revision)
 values(p_case,'uphold',next_revision,p_evidence_revision,intake.reviewer_principal_id,
  (value->>'reviewerAccountId')::uuid,(value->>'authSessionId')::uuid,p_nonce_hash,p_reason_ciphertext,now_at,intake.deadline,
  (binding->>'decisionId')::uuid,(binding->>'decisionRevision')::bigint,(binding->>'evidenceRevision')::bigint);
 -- The appeal is rejected while the exact earlier documentary result stays
 -- unchanged. The existing terminal transition shreds only this case.
 update public.appeal_intakes set state='rejected',decided_at=now_at where id=p_case;
 update private.public_appeal_case_decisions set reason_ciphertext=null where case_id=p_case;
 if not exists(select 1 from private.new_public_appeal_intakes source where source.id=p_case and source.state='closed'
   and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
  or exists(select 1 from private.appeal_document_sessions source where source.intake_id=p_case and source.wrapped_document_key is not null)
  or exists(select 1 from public.rights_sessions source where source.target_kind='appeal-case' and source.target_id=p_case)
  or exists(select 1 from private.public_appeal_provisional_targets source where source.case_id=p_case) then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.append_legal_audit_event('appeal.review.upheld',null,'api.appeal-review','refused','{}');
 return jsonb_build_object('caseId',p_case,'state','resolved','outcome','upheld','reviewRevision',next_revision);
end $uphold_decision$;
revoke all on function public.read_public_appeal_case_context_v1(uuid),public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_case_context_v1(uuid),public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) to authenticated;
notify pgrst,'reload schema';
