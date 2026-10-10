-- A later document decision may arrive after the original evidence link or
-- upload session expired. This distinct one-use credential reads only that
-- decision for the original verified case recipient. It cannot collect files,
-- resolve a contact to an account, renew the case or exercise target rights.
alter table private.rights_purpose_matrix drop constraint rights_purpose_matrix_purpose_check;
alter table private.rights_purpose_matrix add constraint rights_purpose_matrix_purpose_check check (purpose in (
 'adult-withdrawal','adult-subject-control','adult-upload-confirmation','embryo-parent-withdrawal',
 'embryo-record-key-card-delivery','invitation','consent-reaffirm','appeal-evidence',
 'future-person-claim-objection','approved-future-person-release','appeal-decision-notice'));
insert into private.rights_purpose_matrix (purpose, invitation_kind, action, route_id) values
 ('appeal-decision-notice',null,'read-decision-notice','api.appeal-decision-notice');
insert into private.rights_session_purposes (session_purpose, matrix_purpose, invitation_kind, target_kind) values
 ('appeal-decision-notice','appeal-decision-notice',null,'appeal-case');

create table private.public_appeal_decision_notices (
 decision_id uuid primary key references private.public_appeal_document_decisions(id) on delete restrict,
 case_id uuid not null references private.new_public_appeal_intakes(id) on delete restrict,
 outbox_id uuid not null unique references public.mail_outbox(id) on delete restrict,
 candidate_id uuid not null unique references public.token_candidates(id) on delete restrict,
 created_at timestamptz not null,
 expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
alter table private.public_appeal_decision_notices enable row level security;
revoke all on private.public_appeal_decision_notices from public,anon,authenticated,service_role,inherit_upload_only;
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('appeal-and-correction-working-packages','private.public_appeal_decision_notices',18);

-- Expiry of the original credential does not erase the fact that its exact
-- native token was consumed and its verified case submitted. This is not a
-- bearer-token lookup, nor contact/account identity inference.
create function private.public_appeal_recipient_verified_v1(p_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.new_public_appeal_evidence_current_v1(p_case) and exists(
  select 1 from private.new_public_appeal_intakes intake
  join private.new_public_appeal_evidence_state evidence on evidence.case_id=intake.id and evidence.state='submitted'
  join public.token_hashes token on token.candidate_id=intake.candidate_id and token.token_revision=1
   and token.status='consumed' and token.ended_at is not null
  join public.rights_sessions rights on rights.token_hash_id=token.id and rights.principal_id=intake.author_principal_id
   and rights.purpose='appeal-evidence' and rights.target_kind='appeal-case' and rights.target_id=intake.id
   and rights.status='consumed' and rights.ended_at is not null
  where intake.id=p_case and rights.created_at>=token.created_at
   and rights.expires_at<=rights.created_at+interval '60 minutes' and rights.ended_at<=rights.expires_at);
$$;

create function private.public_appeal_decision_notice_current_v1(p_decision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.public_appeal_decision_notices notice
  join private.public_appeal_document_decisions decision on decision.id=notice.decision_id and decision.case_id=notice.case_id
  join private.new_public_appeal_intakes intake on intake.id=notice.case_id
  join public.mail_outbox mail on mail.id=notice.outbox_id
   and mail.purpose='appeal-decision-notice' and mail.template_id='appeal-evidence'
   and mail.target_kind='appeal' and mail.target_id=intake.id and mail.recipient_principal_id=intake.author_principal_id
   and mail.contact_reference_id=intake.case_contact_id and mail.recipient_authority_revision=1
   and mail.semantic_revision=decision.review_revision and mail.token_purpose='appeal-decision-notice'
   and mail.token_target_id=intake.id and mail.template_payload='{}' and mail.expires_at=notice.expires_at
  join public.token_candidates candidate on candidate.id=notice.candidate_id and candidate.outbox_id=mail.id
   and candidate.purpose='appeal-decision-notice' and candidate.target_kind='appeal' and candidate.target_id=intake.id
   and candidate.token_revision=decision.review_revision and candidate.state in('pending','issued')
   and candidate.expires_at=notice.expires_at
  where notice.decision_id=p_decision and notice.expires_at>clock_timestamp()
   and notice.expires_at=least(notice.created_at+interval '7 days',intake.deadline)
   and decision.deadline=intake.deadline and octet_length(decision.reference_ciphertext)=76
   and decision.decided_at<=notice.created_at and private.public_appeal_recipient_verified_v1(intake.id)
   and not exists(select 1 from private.public_appeal_document_decisions newer
    where newer.case_id=decision.case_id and newer.document_kind=decision.document_kind and newer.decided_at>decision.decided_at));
$$;

create function private.queue_public_appeal_decision_notice_v1() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake private.new_public_appeal_intakes;mail_id uuid;v_candidate_id uuid;created timestamptz:=clock_timestamp();expiry timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 select source.* into intake from private.new_public_appeal_intakes source where source.id=new.case_id for update;
 if not private.public_appeal_recipient_verified_v1(intake.id) or new.deadline is distinct from intake.deadline
  or new.reference_ciphertext is null then raise exception using errcode='42501',message='appeal unavailable';end if;
 expiry:=least(created+interval '7 days',intake.deadline);
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at,created_at)
 values('appeal-evidence','appeal-decision-notice','appeal',intake.id,intake.author_principal_id,intake.case_contact_id,
  1,new.review_revision,encode(extensions.digest(convert_to('appeal-decision-notice-v1|'||new.id,'UTF8'),'sha256'),'hex'),
  'appeal-decision-notice',intake.id,'{}',expiry,created) returning id into mail_id;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(mail_id,'appeal-decision-notice','appeal',intake.id,new.review_revision,expiry) returning id into v_candidate_id;
 insert into private.public_appeal_decision_notices(decision_id,case_id,outbox_id,candidate_id,created_at,expires_at)
 values(new.id,intake.id,mail_id,v_candidate_id,created,expiry);
 return new;
end $$;
create trigger queue_public_appeal_decision_notice after insert on private.public_appeal_document_decisions
 for each row execute function private.queue_public_appeal_decision_notice_v1();

alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_appeal_notice_v1;
revoke all on function private.authorize_mail_submission_before_appeal_notice_v1(uuid,smallint)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare notice private.public_appeal_decision_notices;
begin
 if exists(select 1 from public.mail_outbox mail where mail.id=p_outbox and mail.purpose='appeal-decision-notice') then
  perform private.lock_invitation_transitions_v1();
  select n.* into notice from private.public_appeal_decision_notices n where n.outbox_id=p_outbox for share;
  perform 1 from private.new_public_appeal_intakes intake where intake.id=notice.case_id for share;
  perform 1 from public.mail_outbox mail where mail.id=p_outbox for update;
  return private.public_appeal_decision_notice_current_v1(notice.decision_id) and exists(
   select 1 from public.mail_outbox mail where mail.id=p_outbox and mail.state='claimed' and mail.attempt_count=p_attempt);
 end if;
 return private.authorize_mail_submission_before_appeal_notice_v1(p_outbox,p_attempt);
end $$;

alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_appeal_notice_v1;
revoke all on function public.claim_mail_outbox_before_appeal_notice_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create function public.claim_mail_outbox()
returns table(outbox_id uuid,template_id text,template_payload jsonb,idempotency_key text,
 attempt_ordinal smallint,contact_ciphertext bytea,delivery_token text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare mail public.mail_outbox;candidate public.token_candidates;raw_token text;
begin
 perform private.lock_invitation_transitions_v1();
 select queued.* into mail from public.mail_outbox queued where queued.purpose='appeal-decision-notice'
  and queued.state in('queued','claimed') and queued.not_before<=clock_timestamp()
  and (queued.state='queued' or queued.claimed_at<clock_timestamp()-interval '10 minutes')
  order by queued.not_before,queued.created_at,queued.id limit 1 for update skip locked;
 if mail.id is null then return query select * from public.claim_mail_outbox_before_appeal_notice_v1();return;end if;
 if mail.expires_at<=clock_timestamp() or mail.attempt_count>=10 then
  update public.mail_outbox m set state='expired',claimed_at=null where m.id=mail.id;return;end if;
 update public.mail_outbox m set state='claimed',claimed_at=clock_timestamp(),attempt_count=m.attempt_count+1
  where m.id=mail.id returning m.* into mail;
 if not private.authorize_mail_submission_v1(mail.id,mail.attempt_count) then
  update public.mail_outbox m set state='invalidated',claimed_at=null,last_outcome_code='appeal_authority_stale' where m.id=mail.id;return;end if;
 select c.* into strict candidate from public.token_candidates c where c.outbox_id=mail.id for update;
 raw_token:=rtrim(translate(encode(extensions.gen_random_bytes(32),'base64'),'+/','-_'),'=');
 update public.token_hashes h set status='revoked',ended_at=clock_timestamp() where h.candidate_id=candidate.id and h.status='current';
 insert into public.token_hashes(candidate_id,token_hash,token_revision)
 values(candidate.id,encode(extensions.digest(convert_to(raw_token,'UTF8'),'sha256'),'hex'),candidate.token_revision);
 update public.token_candidates c set state='issued' where c.id=candidate.id;
 return query select mail.id,mail.template_id,mail.template_payload,private.mail_provider_attempt_key_v1(mail),mail.attempt_count,
  (select contact.contact_ciphertext from public.encrypted_contact_references contact where contact.id=mail.contact_reference_id),raw_token;
end $$;

-- Same case-specific AAD reader used by the existing neutral email template.
alter function public.read_new_public_appeal_mail_contact_v1(uuid,smallint) rename to read_appeal_mail_contact_before_notice_v1;
revoke all on function public.read_appeal_mail_contact_before_notice_v1(uuid,smallint) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_new_public_appeal_mail_contact_v1(p_outbox_id uuid,p_attempt_ordinal smallint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake private.new_public_appeal_intakes;
begin
 if not exists(select 1 from public.mail_outbox mail where mail.id=p_outbox_id and mail.purpose='appeal-decision-notice') then
  return public.read_appeal_mail_contact_before_notice_v1(p_outbox_id,p_attempt_ordinal);end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or not private.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal)
  then raise exception using errcode='42501',message='not_found';end if;
 select source.* into intake from private.public_appeal_decision_notices notice
  join private.new_public_appeal_intakes source on source.id=notice.case_id where notice.outbox_id=p_outbox_id for share of source;
 return jsonb_build_object('scope',intake.frame->'scope','caseContactId',intake.case_contact_id,
  'wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),
  'contactCiphertextHex',(select encode(contact.contact_ciphertext,'hex') from public.encrypted_contact_references contact where contact.id=intake.case_contact_id));
end $$;

create function private.guard_public_appeal_notice_rights_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.purpose='appeal-decision-notice' and
  (new.token_hash_id,new.principal_id,new.purpose,new.target_kind,new.target_id,new.authority_revision,new.created_at,new.expires_at)
  is distinct from (old.token_hash_id,old.principal_id,old.purpose,old.target_kind,old.target_id,old.authority_revision,old.created_at,old.expires_at)
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 if new.purpose<>'appeal-decision-notice' then return new;end if;
 if tg_op='UPDATE' and old.purpose<>'appeal-decision-notice' then raise exception using errcode='42501',message='appeal unavailable';end if;
 if new.status='active' and not exists(select 1 from private.public_appeal_decision_notices notice
  join private.public_appeal_document_decisions decision on decision.id=notice.decision_id
  join private.new_public_appeal_intakes intake on intake.id=notice.case_id
  join public.token_hashes token on token.candidate_id=notice.candidate_id and token.id=new.token_hash_id
   and token.token_revision=decision.review_revision
  where new.target_kind='appeal-case' and new.target_id=intake.id and new.principal_id=intake.author_principal_id
   and new.authority_revision=decision.review_revision
   and ((tg_op='INSERT' and token.status='current' and token.ended_at is null) or (tg_op='UPDATE' and token.status='consumed'))
   and new.created_at>=token.created_at and new.created_at<=clock_timestamp()
   and new.expires_at<=new.created_at+interval '60 minutes' and new.expires_at<=notice.expires_at
   and new.expires_at>clock_timestamp() and new.last_activity_at>=new.created_at and new.last_activity_at<=clock_timestamp()
   and private.public_appeal_decision_notice_current_v1(notice.decision_id))
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 return new;
end $$;
create trigger public_appeal_notice_rights_authority before insert or update on public.rights_sessions
 for each row execute function private.guard_public_appeal_notice_rights_v1();

alter function public.activate_rights_session_v1(text,text,text) rename to activate_rights_before_appeal_notice_v1;
revoke all on function public.activate_rights_before_appeal_notice_v1(text,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.activate_rights_session_v1(p_token_hash text,p_session_hash text,p_form_nonce text)
returns table(purpose text,target_kind text,target_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare selected_purpose text;token public.token_hashes;notice private.public_appeal_decision_notices;
 intake private.new_public_appeal_intakes;decision private.public_appeal_document_decisions;now_at timestamptz;expiry timestamptz;
begin
 select candidate.purpose into selected_purpose from public.token_hashes h join public.token_candidates candidate on candidate.id=h.candidate_id
  where h.token_hash=p_token_hash and h.status='current';
 if selected_purpose is distinct from 'appeal-decision-notice' then
  return query select * from public.activate_rights_before_appeal_notice_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return;end if;
 perform private.lock_invitation_transitions_v1();
 perform private.consume_embryo_operation_nonce_v1(p_form_nonce,null,null,'rights_activate','form',null);
 select h.* into token from public.token_hashes h where h.token_hash=p_token_hash and h.status='current' for update;
 select n.* into notice from private.public_appeal_decision_notices n where n.candidate_id=token.candidate_id for share;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=notice.case_id for share;
 select outcome.* into decision from private.public_appeal_document_decisions outcome where outcome.id=notice.decision_id for share;
 if token.id is null or token.ended_at is not null or token.token_revision is distinct from decision.review_revision
  or not private.public_appeal_decision_notice_current_v1(notice.decision_id) then return;end if;
 now_at:=clock_timestamp();expiry:=least(now_at+interval '60 minutes',notice.expires_at,intake.deadline);
 insert into public.rights_sessions (token_hash_id, principal_id, purpose, target_kind, target_id,authority_revision,session_hash,status,expires_at,created_at,last_activity_at) values (
  token.id,intake.author_principal_id,'appeal-decision-notice','appeal-case',intake.id,decision.review_revision,p_session_hash,'active',expiry,now_at,now_at);
 update public.token_hashes set status='consumed',ended_at=now_at where id=token.id;
 perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',jsonb_build_object('purpose','appeal-decision-notice'));
 return query select 'appeal-decision-notice'::text,'appeal-case'::text,intake.id,expiry;
end $$;

alter function public.read_public_appeal_decision_notice_v1(text) rename to read_appeal_decision_before_notice_v1;
revoke all on function public.read_appeal_decision_before_notice_v1(text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.read_public_appeal_decision_notice_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;notice private.public_appeal_decision_notices;
 decision private.public_appeal_document_decisions;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return null;end if;
 perform private.lock_invitation_transitions_v1();
 select rs.* into rights from public.rights_sessions rs where rs.session_hash=p_session_hash for share;
 if rights.purpose is distinct from 'appeal-decision-notice' then return public.read_appeal_decision_before_notice_v1(p_session_hash);end if;
 if rights.status<>'active' or rights.expires_at<=clock_timestamp() or rights.expires_at>rights.created_at+interval '60 minutes'
  or rights.last_activity_at is null or rights.last_activity_at<=clock_timestamp()-interval '15 minutes'
  or rights.target_kind<>'appeal-case' or not private.rights_action_permitted_v1(rights.purpose,'read-decision-notice','api.appeal-decision-notice') then return null;end if;
 select n.* into notice from private.public_appeal_decision_notices n join public.token_hashes token on token.candidate_id=n.candidate_id
  where token.id=rights.token_hash_id and token.status='consumed' and token.ended_at is not null for share of n;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=notice.case_id for share;
 select outcome.* into decision from private.public_appeal_document_decisions outcome where outcome.id=notice.decision_id for share;
 if rights.target_id is distinct from intake.id or rights.principal_id is distinct from intake.author_principal_id
  or rights.authority_revision is distinct from decision.review_revision or rights.expires_at>notice.expires_at
  or not private.public_appeal_decision_notice_current_v1(notice.decision_id) then return null;end if;
 perform private.append_legal_audit_event('appeal.decision.notice.read',null,'api.appeal-decision-notice','accepted','{}');
 return jsonb_build_object('scope',intake.frame->'scope','wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),
  'decisions',jsonb_build_array(jsonb_build_object('documentKind',decision.document_kind,'decision',decision.decision,
   'nonceHash',decision.nonce_hash,'documentId',decision.original_document_id,'referenceCiphertextHex',encode(decision.reference_ciphertext,'hex'),
   'referenceHash',decision.decision_reference_hash)));
end $$;

-- Remove the additional mail/token/session rows before the original terminal
-- case shred removes its contact and key. No physical provider ACK is invented.
alter function private.shred_new_public_appeal_v1(uuid) rename to shred_public_appeal_before_notice_v1;
revoke all on function private.shred_public_appeal_before_notice_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.shred_new_public_appeal_v1(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare mail_ids uuid[];candidate_ids uuid[];
begin
 perform private.lock_invitation_transitions_v1();
 select array_agg(n.outbox_id),array_agg(n.candidate_id) into mail_ids,candidate_ids
  from private.public_appeal_decision_notices n where n.case_id=p_id;
 delete from public.rights_nonces nonce where nonce.rights_session_id in(select rs.id from public.rights_sessions rs
  join public.token_hashes token on token.id=rs.token_hash_id where token.candidate_id=any(candidate_ids));
 delete from public.rights_sessions rs using public.token_hashes token where rs.token_hash_id=token.id and token.candidate_id=any(candidate_ids);
 delete from public.token_hashes token where token.candidate_id=any(candidate_ids);
 delete from private.public_appeal_decision_notices where case_id=p_id;
 delete from public.token_candidates candidate where candidate.id=any(candidate_ids);
 delete from public.mail_deliveries delivery where delivery.outbox_id=any(mail_ids);
 delete from public.mail_provider_attempts attempt where attempt.outbox_id=any(mail_ids);
 delete from public.mail_outbox mail where mail.id=any(mail_ids);
 return private.shred_public_appeal_before_notice_v1(p_id);
end $$;

revoke all on function private.public_appeal_recipient_verified_v1(uuid),private.public_appeal_decision_notice_current_v1(uuid),
 private.queue_public_appeal_decision_notice_v1(),private.guard_public_appeal_notice_rights_v1(),private.shred_new_public_appeal_v1(uuid),
 private.authorize_mail_submission_v1(uuid,smallint) from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.activate_rights_session_v1(text,text,text),public.claim_mail_outbox(),
 public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.read_public_appeal_decision_notice_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.activate_rights_session_v1(text,text,text),public.claim_mail_outbox(),
 public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.read_public_appeal_decision_notice_v1(text) to service_role;
