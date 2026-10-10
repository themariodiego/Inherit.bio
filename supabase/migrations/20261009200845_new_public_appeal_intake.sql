-- The three account-free public appeal branches. A case principal is neither
-- an account nor a subject. No contact/reference match or target hold occurs.
-- Native activation is disabled; deployment must qualify mail and review too.
alter table public.subject_principals
 drop constraint if exists subject_principals_principal_kind_check,
 drop constraint if exists subject_principals_check,
 drop constraint if exists subject_principals_identity_check;
alter table public.subject_principals
 add constraint subject_principals_principal_kind_check check(principal_kind in(
  'account_subject','non_account_subject','future_person','genetic_parent',
  'identified_donor','reviewer','service','case_requester')),
 add constraint subject_principals_identity_check check(
  (principal_kind='case_requester' and subject_id is null and account_id is null)
  or (principal_kind<>'case_requester' and (subject_id is not null or account_id is not null
   or principal_kind in('reviewer','service')
   or (principal_kind in('genetic_parent','identified_donor') and status in('pending','deleted')))));
create function private.guard_public_case_principal_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.principal_kind='case_requester' or (tg_op='UPDATE' and old.principal_kind='case_requester'))
  and current_user<>'postgres' then raise exception using errcode='42501',message='not_found';end if;
 if tg_op='INSERT' then return new;end if;
 if old.principal_kind='case_requester' and
  (new.id,new.principal_kind,new.subject_id,new.account_id,new.created_at)
  is distinct from (old.id,old.principal_kind,old.subject_id,old.account_id,old.created_at) then
  raise exception using errcode='42501',message='not_found';end if;
 return new;
end $$;
create trigger guard_public_case_principal before insert or update on public.subject_principals
 for each row execute function private.guard_public_case_principal_v1();
alter table public.appeal_intakes drop constraint appeal_intakes_target_kind_check;
alter table public.appeal_intakes add constraint appeal_intakes_target_kind_check
 check(target_kind in('claim','correction','contradiction','access_decision','public_case'));
alter table public.appeal_intakes add constraint anonymous_appeal_case_shape
 check(target_kind<>'public_case' or (target_id=id and appellant_account_id is null));
create function private.guard_new_public_appeal_case_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.target_kind='public_case' or (tg_op='UPDATE' and old.target_kind='public_case') then
  if current_user<>'postgres' then raise exception using errcode='42501',message='not_found';end if;
  if tg_op='INSERT' then return new;end if;
  if (to_jsonb(new)-array['state','decided_at','statement_ciphertext'])
   is distinct from (to_jsonb(old)-array['state','decided_at','statement_ciphertext'])
   or (old.state not in('submitted','reviewing') and (new.state,new.decided_at) is distinct from (old.state,old.decided_at))
   or (new.statement_ciphertext is distinct from old.statement_ciphertext
    and not(new.state not in('submitted','reviewing') and new.statement_ciphertext=''::bytea)) then
   raise exception using errcode='42501',message='not_found';end if;
 end if;
 return new;
end $$;
create trigger guard_new_public_appeal_case before insert or update on public.appeal_intakes
 for each row execute function private.guard_new_public_appeal_case_v1();

create table private.new_public_appeal_config(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 network_quarter_hour_limit integer not null default 10 check(network_quarter_hour_limit between 1 and 10),
 network_day_limit integer not null default 40 check(network_day_limit between 1 and 40),
 identifier_day_limit integer not null default 3 check(identifier_day_limit between 1 and 3),
 global_open_limit integer not null default 500 check(global_open_limit between 1 and 500)
);
insert into private.new_public_appeal_config(singleton) values(true);
-- A form nonce remains spent until the signed form's maximum ten-minute
-- lifetime ends, even if its case closes immediately. No clock is renewed.
create table private.new_public_appeal_nonces(
 nonce_hash text primary key check(nonce_hash~'^[0-9a-f]{64}$'),expires_at timestamptz not null
);
-- Owner-selected purpose assignment, never a request-supplied reviewer.
create table private.new_public_appeal_reviewers(
 principal_id uuid primary key references public.subject_principals(id) on delete restrict,
 principal_revision bigint not null check(principal_revision>0),
 purpose_revision bigint not null check(purpose_revision>0),active boolean not null default true
);
create table private.new_public_appeal_intakes(
 id uuid primary key,kind text not null check(kind in(
  'subject-objection','genetic-parent-objection','access-or-review-appeal')),
 author_principal_id uuid not null unique,
 form_nonce_hash text unique check(form_nonce_hash~'^[0-9a-f]{64}$'),
 frame jsonb,signature text check(signature~'^[0-9a-f]{64}$'),
 reviewer_principal_id uuid not null references private.new_public_appeal_reviewers(principal_id),
 reviewer_revision bigint not null check(reviewer_revision>0),purpose_revision bigint not null check(purpose_revision>0),
 submitted_at timestamptz not null,prepare_expires_at timestamptz not null,deadline timestamptz not null,
 state text not null check(state in('prepared','committed','closed')),
 wrapped_case_key bytea,working_ciphertext bytea,case_contact_id uuid,outbox_id uuid,candidate_id uuid,
 check(deadline=submitted_at+interval '30 days'),
 check(prepare_expires_at>submitted_at and prepare_expires_at<=submitted_at+interval '10 minutes'),
 check((state='closed')=(frame is null and signature is null and form_nonce_hash is null)),
 check((state='committed')=(wrapped_case_key is not null and working_ciphertext is not null
  and case_contact_id is not null and outbox_id is not null and candidate_id is not null)),
 check(wrapped_case_key is null or octet_length(wrapped_case_key)=72),
 check(working_ciphertext is null or octet_length(working_ciphertext) between 48 and 20528)
);
do $private$ declare table_name text;begin
 foreach table_name in array array['new_public_appeal_config','new_public_appeal_nonces','new_public_appeal_reviewers','new_public_appeal_intakes'] loop
  execute format('alter table private.%I enable row level security',table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,inherit_upload_only',table_name);
 end loop;
end $private$;
create function private.guard_new_public_appeal_intake_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (to_jsonb(new)-array['state','frame','signature','form_nonce_hash','wrapped_case_key','working_ciphertext',
  'case_contact_id','outbox_id','candidate_id']) is distinct from
  (to_jsonb(old)-array['state','frame','signature','form_nonce_hash','wrapped_case_key','working_ciphertext',
   'case_contact_id','outbox_id','candidate_id']) then raise exception using errcode='42501',message='not_found';end if;
 if old.state='prepared' and new.state='committed' and new.frame=old.frame and new.signature=old.signature
  and new.form_nonce_hash=old.form_nonce_hash and new.case_contact_id=(old.frame->>'caseContactId')::uuid then return new;end if;
 if old.state in('prepared','committed') and new.state='closed' and new.frame is null and new.signature is null
  and new.form_nonce_hash is null and new.wrapped_case_key is null and new.working_ciphertext is null
  and new.case_contact_id is null and new.outbox_id is null and new.candidate_id is null then return new;end if;
 if to_jsonb(new)=to_jsonb(old) then return new;end if;
 raise exception using errcode='42501',message='not_found';
end $$;
create trigger guard_new_public_appeal_intake before update on private.new_public_appeal_intakes
 for each row execute function private.guard_new_public_appeal_intake_v1();

create function public.prepare_new_public_appeal_v1(p_kind text,p_payload_digest text,p_form_nonce_hash text,
 p_contact_digests jsonb,p_identifier_digests jsonb,p_network_digests jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare config private.new_public_appeal_config;reviewer record;contacts jsonb;identifiers jsonb;networks jsonb;
 keys jsonb:='{}';pair record;allowed boolean;frame jsonb;signature text;
 case_id uuid:=gen_random_uuid();author_id uuid:=gen_random_uuid();submitted timestamptz:=date_trunc('milliseconds',clock_timestamp());
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 select * into config from private.new_public_appeal_config where singleton and enabled for share;
 if config.singleton is null then return null;end if;
 if p_kind is null or p_kind not in('subject-objection','genetic-parent-objection','access-or-review-appeal')
  or p_payload_digest is null or p_payload_digest!~'^[0-9a-f]{64}$'
  or p_form_nonce_hash is null or p_form_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request';end if;
 perform private.lock_invitation_transitions_v1();
 contacts:=private.resolve_hmac_set_v1('contact',null,p_contact_digests);
 identifiers:=private.resolve_hmac_set_v1('rate-limit',null,p_identifier_digests);
 networks:=private.resolve_hmac_set_v1('rate-limit',null,p_network_digests);
 for pair in select d.key,d.value from jsonb_each_text(identifiers)d loop
  keys:=keys||jsonb_build_object(pair.key,jsonb_build_object('normalized-identifier',pair.value,
   'source-network',networks->>pair.key,'global-capacity',
   encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex')));
 end loop;
 -- Persist counters before reviewer/nonce/capacity checks. A refused opaque
 -- request returns NULL rather than rolling its counters back by exception.
 allowed:=private.consume_rate_limit_buckets_v1('api.subject-access-request',jsonb_build_array(
  jsonb_build_object('dimension','source-network','windowSeconds',900,'limit',config.network_quarter_hour_limit),
  jsonb_build_object('dimension','source-network','windowSeconds',86400,'limit',config.network_day_limit),
  jsonb_build_object('dimension','normalized-identifier','windowSeconds',86400,'limit',config.identifier_day_limit),
  jsonb_build_object('dimension','global-capacity','windowSeconds',900,'limit',config.global_open_limit)),keys);
 perform pg_advisory_xact_lock(1869509217,41);
 if not allowed or exists(select 1 from private.new_public_appeal_nonces x where x.nonce_hash=p_form_nonce_hash)
  or (select count(*) from private.new_public_appeal_intakes x where x.state<>'closed'
   and x.deadline>clock_timestamp() and (x.state='committed' or x.prepare_expires_at>clock_timestamp()))>=config.global_open_limit
  then return null;end if;
 select r.* into reviewer from private.new_public_appeal_reviewers r
  join public.subject_principals actor on actor.id=r.principal_id and actor.principal_revision=r.principal_revision
   and actor.principal_kind='reviewer' and actor.status='active'
  join private.claim_reviewers assignment on assignment.account_id=actor.account_id and assignment.status='active'
  where r.active order by r.principal_id limit 1 for share of r,actor,assignment;
 if reviewer.principal_id is null then return null;end if;
 frame:=jsonb_build_object('version','new-appeal-public-intake-native-v1','scope',jsonb_build_object(
  'version',1,'caseKind','appeal','caseId',case_id,'originalAuthorPrincipalId',author_id,'initialStatementRevision',1,
  'originalSubmittedAt',to_char(submitted at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'originalDeadline',to_char((submitted+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'intakeKind',p_kind),
  'reviewer',jsonb_build_object('principalId',reviewer.principal_id,'principalRevision',reviewer.principal_revision,
   'purposeRevision',reviewer.purpose_revision),'assignmentRevision',1,
  'prepareExpiresAt',to_char((submitted+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'caseContactId',gen_random_uuid(),'payloadDigest',p_payload_digest,'formNonceHash',p_form_nonce_hash,
  'contactDigests',contacts,'identifierDigests',identifiers,'networkDigests',networks);
 -- This opaque random capability is compared to the exact stored preparation;
 -- it is not an account credential, content signature or target authority.
 signature:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.new_public_appeal_nonces(nonce_hash,expires_at) values(p_form_nonce_hash,submitted+interval '10 minutes');
 insert into private.new_public_appeal_intakes(id,kind,author_principal_id,form_nonce_hash,frame,signature,
  reviewer_principal_id,reviewer_revision,purpose_revision,submitted_at,prepare_expires_at,deadline,state)
 values(case_id,p_kind,author_id,p_form_nonce_hash,frame,signature,reviewer.principal_id,reviewer.principal_revision,
  reviewer.purpose_revision,submitted,submitted+interval '10 minutes',submitted+interval '30 days','prepared');
 return jsonb_build_object('frame',frame,'signature',signature);
end $$;

create function public.commit_new_public_appeal_v1(p_expected jsonb,p_payload_digest text,p_nonce_hash text,
 p_wrapped_key bytea,p_statement bytea,p_working bytea,p_contact bytea,p_quota_keys jsonb)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake private.new_public_appeal_intakes;expected_keys jsonb:='{}';pair record;contacts jsonb;
 active_revision bigint;outbox uuid;candidate uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 perform 1 from private.new_public_appeal_config where singleton and enabled for share;
 if not found then raise exception using errcode='42501',message='not_found';end if;
 perform private.lock_invitation_transitions_v1();
 select * into intake from private.new_public_appeal_intakes x
  where x.form_nonce_hash=p_nonce_hash for update;
 if intake.id is null or intake.state<>'prepared' or intake.prepare_expires_at<=clock_timestamp()
  or intake.deadline<=clock_timestamp() or p_expected is distinct from jsonb_build_object('frame',intake.frame,'signature',intake.signature)
  or p_payload_digest is distinct from intake.frame->>'payloadDigest' or p_nonce_hash is distinct from intake.frame->>'formNonceHash'
  then raise exception using errcode='42501',message='not_found';end if;
 perform 1 from private.new_public_appeal_reviewers r join public.subject_principals actor on actor.id=r.principal_id
  join private.claim_reviewers assignment on assignment.account_id=actor.account_id
  where r.principal_id=intake.reviewer_principal_id and r.active and r.principal_revision=intake.reviewer_revision
   and r.purpose_revision=intake.purpose_revision and actor.principal_revision=r.principal_revision
   and actor.principal_kind='reviewer' and actor.status='active' and assignment.status='active' for share of r,actor,assignment;
 if not found then raise exception using errcode='42501',message='not_found';end if;
 if p_wrapped_key is null or octet_length(p_wrapped_key)<>72 or p_statement is null
  or octet_length(p_statement) not between 48 and 16028 or p_working is null
  or octet_length(p_working) not between 48 and 20528 or p_contact is null
  or octet_length(p_contact) not between 29 and 282 then raise exception using errcode='22023',message='invalid_request';end if;
 contacts:=private.resolve_hmac_set_v1('contact',null,intake.frame->'contactDigests');
 if contacts is distinct from intake.frame->'contactDigests'
  or private.resolve_hmac_set_v1('rate-limit',null,intake.frame->'identifierDigests') is distinct from intake.frame->'identifierDigests'
  or private.resolve_hmac_set_v1('rate-limit',null,intake.frame->'networkDigests') is distinct from intake.frame->'networkDigests'
  then raise exception using errcode='42501',message='not_found';end if;
 for pair in select d.key,d.value from jsonb_each_text(intake.frame->'identifierDigests')d loop
  expected_keys:=expected_keys||jsonb_build_object(pair.key,jsonb_build_object('normalized-identifier',pair.value,
   'source-network',intake.frame#>>array['networkDigests',pair.key],'global-capacity',
   encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex')));
 end loop;
 if p_quota_keys is distinct from expected_keys then raise exception using errcode='42501',message='not_found';end if;
 active_revision:=private.hmac_active_revision_v1('contact');
 insert into public.subject_principals(id,principal_kind,status) values(intake.author_principal_id,'case_requester','active');
 insert into public.appeal_intakes(id,appellant_principal_id,appellant_account_id,target_kind,target_id,
  appeal_revision,statement_ciphertext,state,submitted_at)
 values(intake.id,intake.author_principal_id,null,'public_case',intake.id,1,p_statement,'submitted',intake.submitted_at);
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision)
 values((intake.frame->>'caseContactId')::uuid,intake.author_principal_id,p_contact,contacts->>active_revision::text,active_revision,1);
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,expires_at)
 select (intake.frame->>'caseContactId')::uuid,d.value,d.key::bigint,intake.deadline from jsonb_each_text(contacts)d;
 -- The required non-authorizing evidence candidate and outbox commit with
 -- the original case; no intake can succeed with a missing delivery row.
 -- The case stays30days; its non-authorizing evidence credential is7days,
 -- clamped at that immutable case deadline (appealEvidenceCredential).
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at,created_at)
 values('appeal-evidence','appeal-evidence','appeal',intake.id,intake.author_principal_id,(intake.frame->>'caseContactId')::uuid,
  1,1,encode(extensions.digest(convert_to('new-public-appeal-evidence-v1|'||intake.id,'UTF8'),'sha256'),'hex'),
  'appeal-evidence',intake.id,'{}',least(intake.deadline,intake.submitted_at+interval '7 days'),intake.submitted_at) returning id into outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
 values(outbox,'appeal-evidence','appeal',intake.id,1,least(intake.deadline,intake.submitted_at+interval '7 days')) returning id into candidate;
 update private.new_public_appeal_intakes set state='committed',wrapped_case_key=p_wrapped_key,working_ciphertext=p_working,
  case_contact_id=(intake.frame->>'caseContactId')::uuid,outbox_id=outbox,candidate_id=candidate where id=intake.id;
 return true;
end $$;

create function private.new_public_appeal_mail_current_v1(p_outbox uuid,p_attempt smallint) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.new_public_appeal_intakes intake
  join private.new_public_appeal_config config on config.singleton and config.enabled
  join private.new_public_appeal_reviewers reviewer on reviewer.principal_id=intake.reviewer_principal_id
   and reviewer.active and reviewer.principal_revision=intake.reviewer_revision and reviewer.purpose_revision=intake.purpose_revision
  join public.subject_principals reviewer_actor on reviewer_actor.id=reviewer.principal_id and reviewer_actor.principal_kind='reviewer'
   and reviewer_actor.status='active' and reviewer_actor.principal_revision=reviewer.principal_revision
  join private.claim_reviewers assignment on assignment.account_id=reviewer_actor.account_id and assignment.status='active'
  join public.appeal_intakes appeal on appeal.id=intake.id and appeal.target_kind='public_case'
   and appeal.target_id=appeal.id and appeal.appellant_account_id is null and appeal.state in('submitted','reviewing')
  join public.subject_principals actor on actor.id=intake.author_principal_id and actor.id=appeal.appellant_principal_id
   and actor.principal_kind='case_requester' and actor.subject_id is null and actor.account_id is null
   and actor.principal_revision=1 and actor.status='active'
  join public.encrypted_contact_references contact on contact.id=intake.case_contact_id and contact.principal_id=actor.id
   and contact.status='current' and contact.contact_ciphertext is not null and contact.authority_revision=1
  join public.mail_outbox mail on mail.id=intake.outbox_id and mail.contact_reference_id=contact.id
   and mail.recipient_principal_id=actor.id and mail.recipient_authority_revision=1
  join public.token_candidates candidate on candidate.id=intake.candidate_id and candidate.outbox_id=mail.id
   and candidate.target_kind='appeal' and candidate.target_id=intake.id and candidate.token_revision=1
   and candidate.purpose='appeal-evidence' and candidate.state in('pending','issued')
   and candidate.expires_at=least(intake.deadline,intake.submitted_at+interval '7 days')
  where intake.state='committed' and intake.wrapped_case_key is not null and intake.working_ciphertext is not null
   and intake.deadline>clock_timestamp() and mail.id=p_outbox and mail.state='claimed' and mail.attempt_count=p_attempt
   and mail.template_id='appeal-evidence' and mail.purpose='appeal-evidence' and mail.target_kind='appeal' and mail.target_id=intake.id
   and mail.semantic_revision=1 and mail.token_purpose='appeal-evidence' and mail.token_target_id=intake.id
   and mail.template_payload='{}' and mail.expires_at=candidate.expires_at and mail.expires_at>clock_timestamp());
$$;
-- Delegate every old mail branch without changing its authority predicates.
alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_public_appeal_v1;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 if exists(select 1 from public.mail_outbox mail where mail.id=p_outbox and mail.purpose='appeal-evidence') then
  perform private.lock_invitation_transitions_v1();
  perform 1 from private.new_public_appeal_intakes intake where intake.outbox_id=p_outbox for share;
  perform 1 from public.mail_outbox mail where mail.id=p_outbox for update;
  return private.new_public_appeal_mail_current_v1(p_outbox,p_attempt);
 end if;
 return private.authorize_mail_submission_before_public_appeal_v1(p_outbox,p_attempt);
end $$;
alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_public_appeal_v1;
create function public.claim_mail_outbox()
returns table(outbox_id uuid,template_id text,template_payload jsonb,idempotency_key text,
 attempt_ordinal smallint,contact_ciphertext bytea,delivery_token text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare mail public.mail_outbox;candidate public.token_candidates;raw_token text;
begin
 perform private.lock_invitation_transitions_v1();
 select candidate_mail.* into mail from public.mail_outbox candidate_mail
  where candidate_mail.purpose='appeal-evidence' and candidate_mail.state in('queued','claimed')
   and candidate_mail.not_before<=clock_timestamp()
   and (candidate_mail.state='queued' or candidate_mail.claimed_at<clock_timestamp()-interval '10 minutes')
  order by candidate_mail.not_before,candidate_mail.created_at,candidate_mail.id limit 1 for update skip locked;
 if mail.id is null then return query select * from public.claim_mail_outbox_before_public_appeal_v1();return;end if;
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
create function public.read_new_public_appeal_mail_contact_v1(p_outbox_id uuid,p_attempt_ordinal smallint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake private.new_public_appeal_intakes;contact bytea;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if not private.authorize_mail_submission_v1(p_outbox_id,p_attempt_ordinal) then
  raise exception using errcode='42501',message='not_found';end if;
 select * into intake from private.new_public_appeal_intakes x where x.outbox_id=p_outbox_id for share;
 if intake.id is null then raise exception using errcode='42501',message='not_found';end if;
 select contact_ciphertext into contact from public.encrypted_contact_references where id=intake.case_contact_id for share;
 return jsonb_build_object('scope',intake.frame->'scope','caseContactId',intake.case_contact_id,
  'wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),'contactCiphertextHex',encode(contact,'hex'));
end $$;

-- Terminal disposal removes every local delivery/statement/contact copy and
-- invalidates all issued sessions. Provider removal needs its own genuine ACK.
create function private.shred_new_public_appeal_v1(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare intake private.new_public_appeal_intakes;now_at timestamptz:=clock_timestamp();
begin
 perform private.lock_invitation_transitions_v1();
 select * into intake from private.new_public_appeal_intakes x where x.id=p_id for update;
 if intake.id is null or intake.state='closed' then return false;end if;
 delete from public.rights_nonces nonce where nonce.rights_session_id in(
  select session.id from public.rights_sessions session join public.token_hashes h on h.id=session.token_hash_id
  where h.candidate_id=intake.candidate_id);
 delete from public.rights_sessions session using public.token_hashes h
  where session.token_hash_id=h.id and h.candidate_id=intake.candidate_id;
 delete from public.token_hashes h where h.candidate_id=intake.candidate_id;
 delete from public.token_candidates candidate where candidate.id=intake.candidate_id;
 delete from public.mail_deliveries delivery where delivery.outbox_id=intake.outbox_id;
 delete from public.mail_provider_attempts attempt where attempt.outbox_id=intake.outbox_id;
 delete from public.mail_outbox mail where mail.id=intake.outbox_id;
 delete from public.contact_hmac_indexes contact where contact.contact_reference_id=intake.case_contact_id;
 delete from public.encrypted_contact_references contact where contact.id=intake.case_contact_id
  and contact.principal_id=intake.author_principal_id;
 update public.appeal_intakes appeal set statement_ciphertext=''::bytea where appeal.id=intake.id;
 update public.subject_principals actor set status='deleted',principal_revision=actor.principal_revision+1
  where actor.id=intake.author_principal_id and actor.principal_kind='case_requester';
 update private.new_public_appeal_intakes set state='closed',frame=null,signature=null,form_nonce_hash=null,
  wrapped_case_key=null,working_ciphertext=null,case_contact_id=null,outbox_id=null,candidate_id=null where id=intake.id;
 return true;
end $$;
create function private.close_new_public_appeal_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.target_kind='public_case' and new.state not in('submitted','reviewing') then
  perform private.shred_new_public_appeal_v1(new.id);end if;
 return new;
end $$;
create trigger close_new_public_appeal after update of state on public.appeal_intakes
 for each row execute function private.close_new_public_appeal_v1();
create function public.drain_due_new_public_appeals_v1() returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare intake record;closed_count integer:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 perform private.lock_invitation_transitions_v1();
 delete from private.new_public_appeal_nonces x where x.expires_at<=clock_timestamp();
 for intake in select x.id from private.new_public_appeal_intakes x where x.state<>'closed'
  and (x.deadline<=clock_timestamp() or (x.state='prepared' and x.prepare_expires_at<=clock_timestamp()))
  order by x.id for update of x loop
  -- Terminal state must precede ciphertext erasure. Its close trigger shreds
  -- committed cases; the explicit call also closes prepared-only intakes.
  update public.appeal_intakes appeal set state='expired',decided_at=clock_timestamp()
   where appeal.id=intake.id and appeal.state in('submitted','reviewing');
  perform private.shred_new_public_appeal_v1(intake.id);
  closed_count:=closed_count+1;
 end loop;
 return jsonb_build_object('completed',closed_count,'shredded',closed_count,'held',0);
end $$;
revoke all on function private.guard_public_case_principal_v1(),private.guard_new_public_appeal_case_v1(),private.guard_new_public_appeal_intake_v1(),
 private.new_public_appeal_mail_current_v1(uuid,smallint),private.authorize_mail_submission_v1(uuid,smallint),
 private.authorize_mail_submission_before_public_appeal_v1(uuid,smallint),public.claim_mail_outbox_before_public_appeal_v1(),
 private.shred_new_public_appeal_v1(uuid),private.close_new_public_appeal_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb),
 public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb),
 public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.drain_due_new_public_appeals_v1(),public.claim_mail_outbox()
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb),
 public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb),
 public.read_new_public_appeal_mail_contact_v1(uuid,smallint),public.drain_due_new_public_appeals_v1(),public.claim_mail_outbox() to service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'appeal-and-correction-working-packages','private.new_public_appeal_intakes',max(store_order)+1
 from public.purge_target_stores where target_id='appeal-and-correction-working-packages';
