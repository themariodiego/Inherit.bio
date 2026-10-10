-- A named own-MFA reviewer can ask the same verified random case recipient
-- for a new evidence set. This never resets the original case clock or gives
-- target access. The original intake/frame/contact/candidate are immutable.
create table private.public_appeal_information_requests (
 case_id uuid not null references private.new_public_appeal_intakes(id) on delete restrict,
 evidence_revision bigint not null check(evidence_revision>1),
 review_revision bigint not null check(review_revision>1),
 reviewer_principal_id uuid not null,reviewer_account_id uuid not null,auth_session_id uuid not null,
 nonce_hash text not null unique check(nonce_hash~'^[0-9a-f]{64}$'),
 reason_ciphertext bytea not null check(octet_length(reason_ciphertext) between 48 and 8128),
 outbox_id uuid not null unique references public.mail_outbox(id) on delete restrict,
 candidate_id uuid not null unique references public.token_candidates(id) on delete restrict,
 created_at timestamptz not null,expires_at timestamptz not null,original_deadline timestamptz not null,
 primary key(case_id,evidence_revision),unique(case_id,review_revision),
 check(expires_at>created_at and expires_at=least(created_at+interval '7 days',original_deadline))
);
alter table private.public_appeal_information_requests enable row level security;
revoke all on private.public_appeal_information_requests from public,anon,authenticated,service_role,inherit_upload_only;
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('appeal-and-correction-working-packages','private.public_appeal_information_requests',20);
create function private.guard_public_appeal_information_request_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then raise exception using errcode='42501',message='appeal unavailable';end if;
 return new;
end $$;
create trigger public_appeal_information_request_immutable before update on private.public_appeal_information_requests
 for each row execute function private.guard_public_appeal_information_request_v1();

-- Full original recipient verification stays authoritative even when the old
-- credential is expired. Currentness never means contact-to-account adoption.
create function private.public_appeal_information_current_v1(p_candidate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.public_appeal_information_requests request
  join private.new_public_appeal_intakes intake on intake.id=request.case_id
  join public.mail_outbox mail on mail.id=request.outbox_id
   and mail.purpose='appeal-evidence' and mail.template_id='appeal-evidence'
   and mail.target_kind='appeal' and mail.target_id=intake.id
   and mail.recipient_principal_id=intake.author_principal_id and mail.contact_reference_id=intake.case_contact_id
   and mail.recipient_authority_revision=1 and mail.semantic_revision=request.evidence_revision
   and mail.token_purpose='appeal-evidence' and mail.token_target_id=intake.id and mail.template_payload='{}'
   and mail.expires_at=request.expires_at
  join public.token_candidates candidate on candidate.id=request.candidate_id and candidate.outbox_id=mail.id
   and candidate.purpose='appeal-evidence' and candidate.target_kind='appeal' and candidate.target_id=intake.id
   and candidate.token_revision=request.evidence_revision and candidate.state in('pending','issued')
   and candidate.expires_at=request.expires_at
  where request.candidate_id=p_candidate and request.original_deadline=intake.deadline
   and request.expires_at>clock_timestamp() and private.public_appeal_case_current_v1(intake.id)
   and not exists(select 1 from private.public_appeal_information_requests newer
    where newer.case_id=request.case_id and newer.evidence_revision>request.evidence_revision));
$$;

-- Keep every old case/assignment lock and authority predicate, but isolate the
-- new set from old shredded documents and make the operation revision monotone.
alter function private.public_appeal_case_review_at_v1(uuid) rename to public_appeal_case_review_before_information_v1;
revoke all on function private.public_appeal_case_review_before_information_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.public_appeal_case_review_at_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;request private.public_appeal_information_requests;documents jsonb;
begin
 value:=private.public_appeal_case_review_before_information_v1(p_case);
 select source.* into request from private.public_appeal_information_requests source
  where source.case_id=p_case order by source.evidence_revision desc limit 1 for share;
 if request.case_id is null then return value;end if;
 select coalesce(jsonb_agg(doc),'[]') into documents from jsonb_array_elements(value#>'{context,documents}') doc
  where exists(select 1 from private.appeal_documents source join private.appeal_document_sessions session on session.id=source.session_id
   where source.id=(doc->>'documentId')::uuid and session.evidence_revision=request.evidence_revision
    and session.wrapped_document_key is not null and session.document_key_shredded_at is null);
 value:=jsonb_set(value,'{context,documents}',documents);
 value:=jsonb_set(value,'{context,reviewRevision}',to_jsonb(greatest((value#>>'{context,reviewRevision}')::bigint,request.review_revision)));
 -- The preserved context uses pending.evidence_revision after submission;
 -- the collecting state's next revision is not documentary review authority.
 return value;
end $$;

alter function public.read_public_appeal_case_context_v1(uuid) rename to read_public_appeal_case_context_before_information_v1;
revoke all on function public.read_public_appeal_case_context_before_information_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_public_appeal_case_context_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;
begin
 value:=public.read_public_appeal_case_context_before_information_v1(p_case);
 return value||jsonb_build_object('allowedDecisions',value->'allowedDecisions'||jsonb_build_array('needs-more-information'));
end $$;

alter function public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) rename to decide_public_appeal_case_before_information_v1;
revoke all on function public.decide_public_appeal_case_before_information_v1(uuid,text,bigint,bigint,text,bytea)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.decide_public_appeal_case_v1(p_case uuid,p_decision text,p_review_revision bigint,
 p_evidence_revision bigint,p_nonce_hash text,p_reason_ciphertext bytea) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;intake private.new_public_appeal_intakes;now_at timestamptz;expiry timestamptz;
 next_review bigint;next_evidence bigint;mail_id uuid;new_candidate uuid;prior_candidates uuid[];
begin
 if p_decision is distinct from 'needs-more-information' then
  return public.decide_public_appeal_case_before_information_v1(p_case,p_decision,p_review_revision,p_evidence_revision,p_nonce_hash,p_reason_ciphertext);
 end if;
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_reason_ciphertext is null
  or octet_length(p_reason_ciphertext) not between 48 and 8128 then raise exception using errcode='42501',message='appeal unavailable';end if;
 value:=private.public_appeal_case_review_at_v1(p_case);
 if (value#>>'{context,reviewRevision}')::bigint is distinct from p_review_revision
  or (value#>>'{context,evidenceRevision}')::bigint is distinct from p_evidence_revision then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
 now_at:=clock_timestamp();expiry:=least(now_at+interval '7 days',intake.deadline);
 if expiry<=now_at then raise exception using errcode='42501',message='appeal unavailable';end if;
 next_review:=p_review_revision+1;next_evidence:=p_evidence_revision+1;
 -- Prior verified origin rows stay intact. Only unconsumed bearer authority,
 -- old download/upload sessions and keys are revoked; no target hold changes.
 select array_agg(candidate.id) into prior_candidates from public.token_candidates candidate
  where candidate.purpose='appeal-evidence' and candidate.target_kind='appeal' and candidate.target_id=p_case;
 update public.token_hashes token set status='revoked',ended_at=now_at
  where token.candidate_id=any(prior_candidates) and token.status='current';
 update public.rights_sessions rights set status='revoked',ended_at=now_at
  where rights.target_kind='appeal-case' and rights.target_id=p_case and rights.purpose='appeal-evidence' and rights.status='active';
 update public.mail_outbox mail set state='invalidated',claimed_at=null,last_outcome_code='appeal_evidence_rotated'
  where mail.target_kind='appeal' and mail.target_id=p_case and mail.purpose='appeal-evidence' and mail.state in('queued','claimed');
 delete from private.public_appeal_review_downloads where case_id=p_case;
 delete from private.public_appeal_pending_reviews where case_id=p_case;
 update private.appeal_document_sessions session set wrapped_document_key=null,document_key_shredded_at=coalesce(session.document_key_shredded_at,now_at),
  state='failed',failure_code='expired'
  where session.intake_id=p_case;
 update private.appeal_document_fragments fragment set state='delete_pending'
  where fragment.session_id in(select session.id from private.appeal_document_sessions session where session.intake_id=p_case);
 update private.new_public_appeal_evidence_state set state='collecting',revision=next_evidence,submitted_at=null where case_id=p_case;
 if not found then insert into private.new_public_appeal_evidence_state(case_id,revision) values(p_case,next_evidence);end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at,created_at)
 values('appeal-evidence','appeal-evidence','appeal',p_case,intake.author_principal_id,intake.case_contact_id,
  1,next_evidence,encode(extensions.digest(convert_to('appeal-information-v1|'||p_case||'|'||next_evidence,'UTF8'),'sha256'),'hex'),
  'appeal-evidence',p_case,'{}',expiry,now_at) returning id into mail_id;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(mail_id,'appeal-evidence','appeal',p_case,next_evidence,expiry) returning id into new_candidate;
 insert into private.public_appeal_information_requests(case_id,evidence_revision,review_revision,reviewer_principal_id,reviewer_account_id,
  auth_session_id,nonce_hash,reason_ciphertext,outbox_id,candidate_id,created_at,expires_at,original_deadline)
 values(p_case,next_evidence,next_review,intake.reviewer_principal_id,(value->>'reviewerAccountId')::uuid,(value->>'authSessionId')::uuid,
  p_nonce_hash,p_reason_ciphertext,mail_id,new_candidate,now_at,expiry,intake.deadline);
 if not private.public_appeal_information_current_v1(new_candidate) then raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.append_legal_audit_event('appeal.review.more_information',null,'api.appeal-review','accepted','{}');
 return jsonb_build_object('caseId',p_case,'state','more_information_required','outcome','more_information_required','reviewRevision',next_review);
end $$;

-- A new evidence round remains a case-only authority even if a target or
-- prior decision has gone stale. Existing mutating approval/complete-source
-- checks still independently refuse any stale target. No old branch changes.
alter function private.new_public_appeal_evidence_current_v1(uuid) rename to public_appeal_evidence_before_information_v1;
revoke all on function private.public_appeal_evidence_before_information_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.new_public_appeal_evidence_current_v1(p_case uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_information_requests request where request.case_id=p_case) then
  return private.public_appeal_case_current_v1(p_case);end if;
 return private.public_appeal_evidence_before_information_v1(p_case);
end $$;

-- The existing mail claim/attempt/EOF/provider semantics still run unchanged.
-- Its currentness and case-specific AAD reader select only the new native row.
alter function private.new_public_appeal_mail_current_v1(uuid,smallint) rename to new_public_appeal_mail_before_information_v1;
revoke all on function private.new_public_appeal_mail_before_information_v1(uuid,smallint) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.new_public_appeal_mail_current_v1(p_outbox uuid,p_attempt smallint) returns boolean
language plpgsql security definer set search_path='' as $$
declare request private.public_appeal_information_requests;intake private.new_public_appeal_intakes;
begin
 perform private.lock_invitation_transitions_v1();
 select source.* into request from private.public_appeal_information_requests source where source.outbox_id=p_outbox for share;
 if request.case_id is null then
  return private.new_public_appeal_mail_before_information_v1(p_outbox,p_attempt) and not exists(
   select 1 from private.new_public_appeal_intakes intake join private.public_appeal_information_requests information on information.case_id=intake.id
    where intake.outbox_id=p_outbox);end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=request.case_id for share;
 perform 1 from public.appeal_intakes where id=intake.id for share;
 perform 1 from private.new_public_appeal_config where singleton for share;
 perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
 perform 1 from private.claim_reviewers assignment join public.subject_principals actor on actor.account_id=assignment.account_id
  where actor.id=intake.reviewer_principal_id for share of assignment;
 perform 1 from public.subject_principals where id in(intake.author_principal_id,intake.reviewer_principal_id) order by id for share;
 perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
 perform 1 from public.token_candidates where id=request.candidate_id for share;
 return private.public_appeal_information_current_v1(request.candidate_id) and exists(
  select 1 from public.mail_outbox mail where mail.id=p_outbox and mail.state='claimed' and mail.attempt_count=p_attempt);
end $$;

alter function public.read_new_public_appeal_mail_contact_v1(uuid,smallint) rename to read_appeal_mail_contact_before_information_v1;
revoke all on function public.read_appeal_mail_contact_before_information_v1(uuid,smallint) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_new_public_appeal_mail_contact_v1(p_outbox_id uuid,p_attempt_ordinal smallint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake private.new_public_appeal_intakes;
begin
 if not exists(select 1 from private.public_appeal_information_requests request where request.outbox_id=p_outbox_id) then
  return public.read_appeal_mail_contact_before_information_v1(p_outbox_id,p_attempt_ordinal);end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or not private.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal)
  then raise exception using errcode='42501',message='not_found';end if;
 select source.* into intake from private.public_appeal_information_requests request
  join private.new_public_appeal_intakes source on source.id=request.case_id where request.outbox_id=p_outbox_id for share of source;
 return jsonb_build_object('scope',intake.frame->'scope','caseContactId',intake.case_contact_id,
  'wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),
  'contactCiphertextHex',(select encode(contact.contact_ciphertext,'hex') from public.encrypted_contact_references contact where contact.id=intake.case_contact_id));
end $$;

create or replace function private.guard_new_public_appeal_rights_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.purpose='appeal-evidence' and
  (new.token_hash_id,new.principal_id,new.purpose,new.target_kind,new.target_id,new.authority_revision,new.created_at,new.expires_at)
  is distinct from (old.token_hash_id,old.principal_id,old.purpose,old.target_kind,old.target_id,old.authority_revision,old.created_at,old.expires_at)
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 if new.purpose<>'appeal-evidence' then return new;end if;
 if tg_op='UPDATE' and old.purpose<>'appeal-evidence' then raise exception using errcode='42501',message='appeal unavailable';end if;
 if new.status='active' and not exists(select 1 from private.new_public_appeal_intakes intake
  join private.new_public_appeal_evidence_state evidence on evidence.case_id=intake.id and evidence.state='collecting'
   and evidence.revision=new.authority_revision
  join public.token_hashes token on token.id=new.token_hash_id
  join public.token_candidates candidate on candidate.id=token.candidate_id and candidate.token_revision=token.token_revision
  where ((token.candidate_id=intake.candidate_id and token.token_revision=1
    and not exists(select 1 from private.public_appeal_information_requests source where source.case_id=intake.id))
   or exists(select 1 from private.public_appeal_information_requests request
    where request.case_id=intake.id and request.candidate_id=token.candidate_id
     and request.evidence_revision=new.authority_revision and token.token_revision=request.evidence_revision
     and private.public_appeal_information_current_v1(request.candidate_id)))
   and intake.id=new.target_id and new.target_kind='appeal-case' and new.principal_id=intake.author_principal_id
   and ((tg_op='INSERT' and token.status='current' and token.ended_at is null) or (tg_op='UPDATE' and token.status='consumed'))
   and new.created_at>=token.created_at and new.created_at<=clock_timestamp()
   and new.expires_at<=new.created_at+interval '60 minutes' and new.expires_at<=candidate.expires_at
   and new.expires_at>clock_timestamp() and new.last_activity_at is not null and new.last_activity_at>=new.created_at
   and new.last_activity_at<=clock_timestamp() and private.new_public_appeal_evidence_current_v1(intake.id))
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 return new;
end $$;

alter function public.activate_rights_session_v1(text,text,text) rename to activate_rights_before_appeal_information_v1;
revoke all on function public.activate_rights_before_appeal_information_v1(text,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.activate_rights_session_v1(p_token_hash text,p_session_hash text,p_form_nonce text)
returns table(purpose text,target_kind text,target_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare token public.token_hashes;request private.public_appeal_information_requests;intake private.new_public_appeal_intakes;
 evidence private.new_public_appeal_evidence_state;now_at timestamptz;expiry timestamptz;
begin
 select information.* into request from private.public_appeal_information_requests information
  join public.token_hashes source on source.candidate_id=information.candidate_id where source.token_hash=p_token_hash;
 if request.case_id is null then
  return query select * from public.activate_rights_before_appeal_information_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return;end if;
 perform private.lock_invitation_transitions_v1();
 select source.* into intake from private.new_public_appeal_intakes source where source.id=request.case_id for update;
 select source.* into evidence from private.new_public_appeal_evidence_state source where source.case_id=request.case_id for update;
 select source.* into token from public.token_hashes source where source.token_hash=p_token_hash for update;
 perform 1 from public.appeal_intakes where id=intake.id for update;
 perform 1 from private.new_public_appeal_config where singleton for share;
 perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
 perform 1 from private.claim_reviewers assignment join public.subject_principals actor on actor.account_id=assignment.account_id
  where actor.id=intake.reviewer_principal_id for share of assignment;
 perform 1 from public.subject_principals where id in(intake.author_principal_id,intake.reviewer_principal_id) order by id for share;
 perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
 perform 1 from public.token_candidates where id=request.candidate_id for share;
 if token.id is null or intake.id is null or evidence.case_id is null or token.status<>'current'
  or token.ended_at is not null or token.token_revision<>request.evidence_revision
  or evidence.state<>'collecting' or evidence.revision<>request.evidence_revision
  or not private.public_appeal_information_current_v1(request.candidate_id) then return;end if;
 perform private.consume_embryo_operation_nonce_v1(p_form_nonce,null,null,'rights_activate','form',null);
 now_at:=clock_timestamp();expiry:=least(now_at+interval '60 minutes',request.expires_at,intake.deadline);
 if expiry<=now_at then return;end if;
 insert into public.rights_sessions(token_hash_id,principal_id,purpose,target_kind,target_id,authority_revision,session_hash,status,expires_at,created_at,last_activity_at)
 values(token.id,intake.author_principal_id,'appeal-evidence','appeal-case',intake.id,evidence.revision,p_session_hash,'active',expiry,now_at,now_at);
 update public.token_hashes source set status='consumed',ended_at=now_at where source.id=token.id;
 perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',jsonb_build_object('purpose','appeal-evidence'));
 return query select 'appeal-evidence'::text,'appeal-case'::text,intake.id,expiry;
end $$;

alter function private.new_public_appeal_rights_at_v1(text,boolean) rename to new_public_appeal_rights_before_information_v1;
revoke all on function private.new_public_appeal_rights_before_information_v1(text,boolean) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.new_public_appeal_rights_at_v1(p_hash text,p_lock boolean) returns public.rights_sessions
language plpgsql security definer set search_path='' as $$
declare rights public.rights_sessions;request private.public_appeal_information_requests;intake private.new_public_appeal_intakes;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null;end if;
 select source.* into rights from public.rights_sessions source where source.session_hash=p_hash;
 select information.* into request from private.public_appeal_information_requests information
  join public.token_hashes token on token.candidate_id=information.candidate_id where token.id=rights.token_hash_id;
 if request.case_id is null then return private.new_public_appeal_rights_before_information_v1(p_hash,p_lock);end if;
 if p_lock then
  perform private.lock_invitation_transitions_v1();
  select source.* into intake from private.new_public_appeal_intakes source where source.id=request.case_id for update;
  perform 1 from public.appeal_intakes where id=request.case_id for update;
  perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
  perform 1 from public.subject_principals where id in(intake.author_principal_id,intake.reviewer_principal_id) order by id for share;
  perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
  perform 1 from private.new_public_appeal_evidence_state where case_id=request.case_id for update;
  select source.* into rights from public.rights_sessions source where source.id=rights.id for update;
 end if;
 if rights.purpose<>'appeal-evidence' or rights.target_kind<>'appeal-case' or rights.target_id<>request.case_id
  or rights.authority_revision<>request.evidence_revision or rights.status<>'active' or rights.expires_at<=clock_timestamp()
  or rights.last_activity_at is null or rights.last_activity_at<=clock_timestamp()-interval '15 minutes'
  or rights.created_at>clock_timestamp() or rights.expires_at>rights.created_at+interval '60 minutes' or rights.expires_at>request.expires_at
  or not private.public_appeal_information_current_v1(request.candidate_id)
  or not exists(select 1 from private.new_public_appeal_evidence_state state where state.case_id=request.case_id
   and state.state='collecting' and state.revision=rights.authority_revision)
  or not exists(select 1 from public.token_hashes token join private.new_public_appeal_intakes source on source.id=request.case_id
   where token.id=rights.token_hash_id and token.candidate_id=request.candidate_id and token.token_revision=request.evidence_revision
    and token.status='consumed' and token.ended_at is not null and rights.principal_id=source.author_principal_id
    and rights.created_at>=token.created_at) then return null;end if;
 return rights;
end $$;

-- The complete existing upload/scan/submit assertions run first. Only the
-- subsequent review sequence number must carry the previous request forward.
alter function public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean) rename to complete_public_appeal_before_information_v1;
revoke all on function public.complete_public_appeal_before_information_v1(text,text,jsonb,boolean) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.complete_new_public_appeal_evidence_v1(p_session_hash text,p_nonce text,p_documents jsonb,p_affirmed boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rights public.rights_sessions;value jsonb;request private.public_appeal_information_requests;
begin
 rights:=private.new_public_appeal_rights_at_v1(p_session_hash,true);
 value:=public.complete_public_appeal_before_information_v1(p_session_hash,p_nonce,p_documents,p_affirmed);
 select source.* into request from private.public_appeal_information_requests source
  where source.case_id=rights.target_id order by source.evidence_revision desc limit 1;
 if request.case_id is not null then
  update private.public_appeal_pending_reviews set review_revision=request.review_revision where case_id=request.case_id;
 end if;return value;
end $$;

alter function public.new_public_appeal_evidence_view_v1(text) rename to public_appeal_evidence_view_before_information_v1;
revoke all on function public.public_appeal_evidence_view_before_information_v1(text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.new_public_appeal_evidence_view_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;rights public.rights_sessions;
begin
 value:=public.public_appeal_evidence_view_before_information_v1(p_session_hash);
 if value is null then return null;end if;
 rights:=private.new_public_appeal_rights_at_v1(p_session_hash,false);
 return value||jsonb_build_object('informationRequested',exists(select 1 from private.public_appeal_information_requests request
  where request.case_id=rights.target_id and request.evidence_revision=rights.authority_revision));
end $$;

-- Delete child delivery/credential rows before the original contact/key shred.
-- The provider's physical deletion evidence is not manufactured here.
alter function private.shred_new_public_appeal_v1(uuid) rename to shred_public_appeal_before_information_v1;
revoke all on function private.shred_public_appeal_before_information_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.shred_new_public_appeal_v1(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare mail_ids uuid[];candidate_ids uuid[];
begin
 perform private.lock_invitation_transitions_v1();
 select array_agg(request.outbox_id),array_agg(request.candidate_id) into mail_ids,candidate_ids
  from private.public_appeal_information_requests request where request.case_id=p_id;
 delete from public.rights_nonces nonce where nonce.rights_session_id in(select rights.id from public.rights_sessions rights
  join public.token_hashes token on token.id=rights.token_hash_id where token.candidate_id=any(candidate_ids));
 delete from public.rights_sessions rights using public.token_hashes token where rights.token_hash_id=token.id and token.candidate_id=any(candidate_ids);
 delete from public.token_hashes token where token.candidate_id=any(candidate_ids);
 delete from private.public_appeal_information_requests where case_id=p_id;
 delete from public.token_candidates candidate where candidate.id=any(candidate_ids);
 delete from public.mail_deliveries delivery where delivery.outbox_id=any(mail_ids);
 delete from public.mail_provider_attempts attempt where attempt.outbox_id=any(mail_ids);
 delete from public.mail_outbox mail where mail.id=any(mail_ids);
 return private.shred_public_appeal_before_information_v1(p_id);
end $$;

create or replace function private.appeal_document_objects_due_v1(p_limit integer)
returns table (object_key text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.lock_invitation_transitions_v1();
  -- Revoke decryption authority before a physical deletion attempt. A
  -- Storage failure leaves only immutable cleanup locators, not usable keys.
  update private.appeal_document_sessions ds set wrapped_document_key=null,
   document_key_shredded_at=coalesce(ds.document_key_shredded_at,clock_timestamp())
  where ds.wrapped_document_key is not null and not private.new_public_appeal_evidence_current_v1(ds.intake_id);
  update private.appeal_document_sessions ds set state='failed',failure_code='expired',wrapped_document_key=null,
   document_key_shredded_at=coalesce(ds.document_key_shredded_at,clock_timestamp())
  where ds.state in('open','composing') and ds.expires_at<=clock_timestamp();
  return query select k.object_key from (
    select f.object_key, f.created_at
    from private.appeal_document_fragments f
    join private.appeal_document_sessions s on s.id = f.session_id
    join private.new_public_appeal_intakes i on i.id = s.intake_id
    where f.state = 'delete_pending' or not private.new_public_appeal_evidence_current_v1(i.id)
      or s.expires_at <= clock_timestamp() or s.wrapped_document_key is null
    union all
    select s.planned_object_key, s.created_at
    from private.appeal_document_sessions s
    join private.new_public_appeal_intakes i on i.id = s.intake_id
    where s.planned_object_key is not null
      and not exists (select 1 from private.appeal_documents d where d.object_key = s.planned_object_key)
      and (s.state = 'failed' or s.expires_at <= clock_timestamp() or s.wrapped_document_key is null or not private.new_public_appeal_evidence_current_v1(i.id))
    union all
    select d.object_key, d.created_at
    from private.appeal_documents d
    join private.new_public_appeal_intakes i on i.id = d.intake_id
    where d.object_deleted_at is null
      and (d.state = 'refused' or not private.new_public_appeal_evidence_current_v1(i.id)
        or exists(select 1 from private.appeal_document_sessions ds where ds.id=d.session_id and ds.wrapped_document_key is null)
        or exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=d.id and outcome.decision='rejected'))
  ) k
  order by k.created_at
  limit greatest(least(coalesce(p_limit, 100), 1000), 1);
end;
$$;


create or replace function private.confirm_appeal_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_rows integer;
  v_document record;
begin
  if p_route_id is null or p_route_id not in ('jobs.retention', 'jobs.claim-document-scan', 'api.evidence-complete') then
    raise exception using errcode = '22023', message = 'claim document deletion invalid';
  end if;
  perform private.lock_invitation_transitions_v1();
  if p_object_keys is null or cardinality(p_object_keys) not between 1 and 1000 then
   raise exception using errcode='22023',message='appeal document deletion invalid';end if;
  if exists(select 1 from private.appeal_documents d where d.object_key=any(p_object_keys)
    and d.state<>'refused' and private.new_public_appeal_evidence_current_v1(d.intake_id)
    and exists(select 1 from private.appeal_document_sessions ds where ds.id=d.session_id and ds.wrapped_document_key is not null)
    and not exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=d.id and outcome.decision='rejected'))
   or exists(select 1 from private.appeal_document_fragments f join private.appeal_document_sessions ds on ds.id=f.session_id
    where f.object_key=any(p_object_keys) and f.state<>'delete_pending' and ds.expires_at>clock_timestamp() and ds.wrapped_document_key is not null
     and private.new_public_appeal_evidence_current_v1(ds.intake_id)) then
   raise exception using errcode='42501',message='appeal document deletion unavailable';end if;
  delete from private.appeal_document_fragments where object_key = any (p_object_keys);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  update private.appeal_document_sessions s set planned_object_key = null
  where s.planned_object_key = any (p_object_keys)
    and not exists (select 1 from private.appeal_documents d where d.object_key = s.planned_object_key);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  for v_document in
    select d.id, d.state, d.refusal_code, d.object_key from private.appeal_documents d
    where d.object_key = any (p_object_keys) and d.object_deleted_at is null for update
  loop
    if v_document.state = 'refused' then
      update private.appeal_documents set object_deleted_at = clock_timestamp(), lease_hash = null,
        lease_expires_at = null where id = v_document.id;
      perform private.append_legal_audit_event('appeal.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', v_document.refusal_code));
    else
      -- A quarantined or clean document's object is deleted only because its
      -- claim ended; the row goes with the claim.
      update private.appeal_document_sessions set planned_object_key = null
      where planned_object_key = v_document.object_key;
      delete from private.public_appeal_pending_reviews review
      where review.photo_document_id=v_document.id or review.authority_document_id=v_document.id or review.decision_notice_document_id=v_document.id;
      delete from private.appeal_documents where id = v_document.id;
      perform private.append_legal_audit_event('appeal.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'appeal-ended'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


revoke all on function private.guard_public_appeal_information_request_v1(),private.public_appeal_information_current_v1(uuid),
 private.public_appeal_case_review_at_v1(uuid),private.new_public_appeal_mail_current_v1(uuid,smallint),private.new_public_appeal_evidence_current_v1(uuid),
 private.guard_new_public_appeal_rights_v1(),private.new_public_appeal_rights_at_v1(text,boolean),private.shred_new_public_appeal_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.read_public_appeal_case_context_v1(uuid),public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea),
 public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.activate_rights_session_v1(text,text,text),
 public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean),public.new_public_appeal_evidence_view_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_case_context_v1(uuid),public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea) to authenticated;
grant execute on function public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.activate_rights_session_v1(text,text,text),
 public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean),public.new_public_appeal_evidence_view_v1(text) to service_role;
notify pgrst,'reload schema';
