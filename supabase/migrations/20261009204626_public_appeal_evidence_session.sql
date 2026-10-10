-- Anonymous appeal evidence is a distinct authority: no account, subject or
-- genetic target can be obtained from this credential. Native TEST config
-- remains disabled; this migration does not enable it or any provider.
create table private.new_public_appeal_evidence_state(
 case_id uuid primary key references private.new_public_appeal_intakes(id) on delete restrict,
 revision bigint not null default 1 check(revision>0),
 state text not null default 'collecting' check(state in('collecting','submitted','closed')),
 submitted_at timestamptz,
 check((state='collecting' and submitted_at is null) or (state='submitted' and submitted_at is not null) or state='closed')
);
alter table private.new_public_appeal_evidence_state enable row level security;
revoke all on private.new_public_appeal_evidence_state from public,anon,authenticated,inherit_upload_only,service_role;
insert into private.rights_session_purposes (session_purpose,matrix_purpose,invitation_kind,target_kind)
 values('appeal-evidence','appeal-evidence',null,'appeal-case');

-- The original case clock is30days. The delivered credential has its own7day
-- ceiling, clamped at that original clock. Never manufacture an extension.
-- The intake producer/mail helper are corrected in their own narrow source
-- delta before this draft is integrated; no legacy30day token is adopted.
create function private.new_public_appeal_evidence_current_v1(p_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
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
  where intake.id=p_case and intake.kind in('subject-objection','genetic-parent-objection') and intake.state='committed' and octet_length(intake.wrapped_case_key)=72
   and intake.working_ciphertext is not null and intake.deadline=intake.submitted_at+interval '30 days'
   and intake.deadline>clock_timestamp());
$$;

create function private.guard_new_public_appeal_rights_v1() returns trigger
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
  join public.token_hashes token on token.candidate_id=intake.candidate_id and token.token_revision=1 and token.id=new.token_hash_id
  join public.token_candidates candidate on candidate.id=token.candidate_id and candidate.token_revision=token.token_revision
  where intake.id=new.target_id and new.target_kind='appeal-case' and new.principal_id=intake.author_principal_id
   and ((tg_op='INSERT' and token.status='current' and token.ended_at is null) or (tg_op='UPDATE' and token.status='consumed'))
   and new.created_at>=token.created_at and new.created_at<=clock_timestamp()
   and new.expires_at<=new.created_at+interval '60 minutes' and new.expires_at<=candidate.expires_at
   and new.expires_at>clock_timestamp() and new.last_activity_at is not null and new.last_activity_at>=new.created_at
   and new.last_activity_at<=clock_timestamp() and private.new_public_appeal_evidence_current_v1(intake.id))
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 return new;
end $$;
create trigger new_public_appeal_rights_authority before insert or update on public.rights_sessions
 for each row execute function private.guard_new_public_appeal_rights_v1();

alter function public.activate_rights_session_v1(text,text,text) rename to activate_rights_session_before_public_appeal_v1;
revoke all on function public.activate_rights_session_before_public_appeal_v1(text,text,text)
 from public,anon,authenticated,inherit_upload_only,service_role;
create function public.activate_rights_session_v1(p_token_hash text,p_session_hash text,p_form_nonce text)
returns table(purpose text,target_kind text,target_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare selected_purpose text;token public.token_hashes;intake private.new_public_appeal_intakes;
 evidence private.new_public_appeal_evidence_state;now_at timestamptz;expiry timestamptz;
begin
 select candidate.purpose into selected_purpose from public.token_hashes h join public.token_candidates candidate on candidate.id=h.candidate_id
  where h.token_hash=p_token_hash and h.status='current';
 if selected_purpose is distinct from 'appeal-evidence' then
  return query select * from public.activate_rights_session_before_public_appeal_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;
 if auth.jwt()->>'role' is distinct from 'service_role' or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return;end if;
 perform private.lock_invitation_transitions_v1();
 perform private.consume_embryo_operation_nonce_v1(p_form_nonce,null,null,'rights_activate','form',null);
 select h.* into token from public.token_hashes h where h.token_hash=p_token_hash and h.status='current' for update;
 select source.* into intake from private.new_public_appeal_intakes source where source.candidate_id=token.candidate_id for update;
 if token.id is null or token.ended_at is not null or intake.id is null or token.token_revision<>1
  or not private.new_public_appeal_evidence_current_v1(intake.id) then return;end if;
 perform 1 from public.appeal_intakes where id=intake.id for update;
 perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
 perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
 perform 1 from public.subject_principals where id in(intake.author_principal_id,intake.reviewer_principal_id) order by id for share;
 if not private.new_public_appeal_evidence_current_v1(intake.id) then return;end if;
 insert into private.new_public_appeal_evidence_state(case_id) values(intake.id) on conflict do nothing;
 select state.* into evidence from private.new_public_appeal_evidence_state state where state.case_id=intake.id for update;
 if evidence.state<>'collecting' then return;end if;
 now_at:=clock_timestamp();expiry:=least(now_at+interval '60 minutes',intake.submitted_at+interval '7 days',intake.deadline);
 if expiry<=now_at then return;end if;
 insert into public.rights_sessions (token_hash_id, principal_id, purpose, target_kind, target_id,authority_revision,session_hash,status,expires_at,created_at,last_activity_at) values (
 token.id,intake.author_principal_id,'appeal-evidence','appeal-case',intake.id,evidence.revision,p_session_hash,'active',expiry,now_at,now_at);
 update public.token_hashes set status='consumed',ended_at=now_at where id=token.id;
 perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',jsonb_build_object('purpose','appeal-evidence'));
 return query select 'appeal-evidence'::text,'appeal-case'::text,intake.id,expiry;
end $$;

create function private.new_public_appeal_rights_at_v1(p_hash text,p_lock boolean) returns public.rights_sessions
language plpgsql security definer set search_path='' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null;end if;
 select rs.* into rights from public.rights_sessions rs where rs.session_hash=p_hash;
 if rights.id is null or rights.purpose<>'appeal-evidence' or rights.target_kind<>'appeal-case' then return null;end if;
 if p_lock then
  perform private.lock_invitation_transitions_v1();
  select source.* into intake from private.new_public_appeal_intakes source where source.id=rights.target_id for update;
  perform 1 from public.appeal_intakes where id=rights.target_id for update;
  perform 1 from private.new_public_appeal_reviewers where principal_id=intake.reviewer_principal_id for share;
  perform 1 from public.subject_principals where id in(rights.principal_id,intake.reviewer_principal_id) order by id for share;
  perform 1 from public.encrypted_contact_references where id=intake.case_contact_id for share;
  perform 1 from private.new_public_appeal_evidence_state where case_id=rights.target_id for update;
  select rs.* into rights from public.rights_sessions rs where rs.id=rights.id for update;
 end if;
 if rights.status<>'active' or rights.expires_at<=clock_timestamp() or rights.last_activity_at is null
  or rights.last_activity_at<=clock_timestamp()-interval '15 minutes' or rights.expires_at>rights.created_at+interval '60 minutes'
  or not private.new_public_appeal_evidence_current_v1(rights.target_id)
  or not exists(select 1 from private.new_public_appeal_evidence_state state where state.case_id=rights.target_id
   and state.revision=rights.authority_revision and state.state='collecting')
  or not exists(select 1 from public.token_hashes h join private.new_public_appeal_intakes source on source.candidate_id=h.candidate_id
   where source.id=rights.target_id and source.author_principal_id=rights.principal_id and h.id=rights.token_hash_id
    and h.status='consumed' and h.ended_at is not null and h.token_revision=1)
  then return null;end if;
 return rights;
end $$;
create function public.new_public_appeal_evidence_view_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;kinds jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then return null;end if;
 rights:=private.new_public_appeal_rights_at_v1(p_session_hash,false);if rights.id is null then return null;end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=rights.target_id;
 kinds:=case intake.kind
  when 'subject-objection' then '["appeal-photo-identity","appeal-subject-source-control"]'::jsonb
  when 'genetic-parent-objection' then '["appeal-photo-identity","appeal-genetic-parent-authority"]'::jsonb
  -- The intake does not bind an underlying decision kind. Never guess the
  -- third authority document from the request or the submitted statement.
  when 'access-or-review-appeal' then '["appeal-photo-identity","appeal-decision-notice"]'::jsonb end;
 return jsonb_build_object('caseKind',intake.kind,'deadline',intake.deadline,'documentKinds',kinds,
  'evidenceState','collecting','completionAvailable',intake.kind in('subject-objection','genetic-parent-objection'),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('documentId',doc.id,'documentKind',doc.document_kind) order by doc.document_kind,doc.id)
   from private.appeal_documents doc join private.appeal_document_sessions ds on ds.id=doc.session_id
   where doc.intake_id=intake.id and doc.state='clean' and doc.scanned_sha256=doc.sha256 and doc.scan_verdict='OK'
    and doc.object_deleted_at is null and ds.evidence_revision=rights.authority_revision and ds.wrapped_document_key is not null), '[]'::jsonb));
end $$;
revoke all on function private.new_public_appeal_evidence_current_v1(uuid),private.guard_new_public_appeal_rights_v1(),
 private.new_public_appeal_rights_at_v1(text,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.activate_rights_session_v1(text,text,text),public.new_public_appeal_evidence_view_v1(text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.activate_rights_session_v1(text,text,text),public.new_public_appeal_evidence_view_v1(text) to service_role;

-- Dedicated anonymous case evidence stores and reused byte/scan state machine.
create function private.appeal_document_limits_v1()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'maximumDocumentBytes', 20000000,
    'maximumChunks', 5,
    'chunkBytes', 4000000,
    'maximumActiveSessionsPerPrincipal', 3,
    'maximumDocumentsPerTargetAndKind', 3,
    'signatureFreshnessSeconds', 86400,
    'scanLeaseSeconds', 300,
    'maximumScanAttempts', 5);
$$;
revoke all on function private.appeal_document_limits_v1() from public, anon, authenticated, service_role;

create table private.appeal_document_sessions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references private.new_public_appeal_intakes (id) on delete restrict,
  document_id uuid not null unique default gen_random_uuid(),
  rights_session_id uuid references public.rights_sessions(id) on delete set null,
  evidence_revision bigint not null check(evidence_revision>0),
  wrapped_document_key bytea, document_key_shredded_at timestamptz,
  check((wrapped_document_key is null)=(document_key_shredded_at is not null)),
  check(wrapped_document_key is null or octet_length(wrapped_document_key)=72),
  document_kind text not null check (document_kind in ('appeal-photo-identity','appeal-subject-source-control','appeal-genetic-parent-authority','appeal-decision-notice','appeal-contradiction-counterevidence')),
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  declared_bytes integer not null check (declared_bytes between 1 and 20000000),
  declared_sha256 text not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
  create_nonce_hash text not null unique check (create_nonce_hash ~ '^[0-9a-f]{64}$'),
  complete_nonce_hash text unique check (complete_nonce_hash ~ '^[0-9a-f]{64}$'),
  -- The key the composed object will take, fixed before it is written, so a
  -- write whose completion never commits is still found and deleted.
  planned_object_key text unique check (planned_object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  state text not null default 'open' check (state in ('open', 'composing', 'finalized', 'failed')),
  failure_code text check (failure_code in ('integrity', 'type', 'expired', 'storage')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check ((state = 'failed') = (failure_code is not null)),
  check (state in ('open', 'failed') or complete_nonce_hash is not null)
);
create index appeal_document_sessions_intake_idx on private.appeal_document_sessions (intake_id);
alter table private.appeal_document_sessions enable row level security;
revoke all on private.appeal_document_sessions from public, anon, authenticated, service_role;

create table private.appeal_document_fragments (
  session_id uuid not null references private.appeal_document_sessions (id) on delete restrict,
  sequence integer not null check (sequence between 0 and 4),
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  byte_count integer not null check (byte_count between 1 and 4000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'reserved' check (state in ('reserved', 'written', 'delete_pending')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, sequence)
);
alter table private.appeal_document_fragments enable row level security;
revoke all on private.appeal_document_fragments from public, anon, authenticated, service_role;

create table private.appeal_documents (
  id uuid primary key,
  session_id uuid not null unique references private.appeal_document_sessions (id) on delete restrict,
  intake_id uuid not null references private.new_public_appeal_intakes (id) on delete restrict,
  document_kind text not null check (document_kind in ('appeal-photo-identity','appeal-subject-source-control','appeal-genetic-parent-authority','appeal-decision-notice','appeal-contradiction-counterevidence')),
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_count integer not null check (byte_count between 1 and 20000000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  state text not null default 'quarantined' check (state in ('quarantined', 'clean', 'refused')),
  refusal_code text check (refusal_code in ('infected', 'unscannable', 'oversize')),
  scan_verdict text check (scan_verdict = 'OK'),
  scanned_sha256 text check (scanned_sha256 ~ '^[0-9a-f]{64}$'),
  scan_engine text check (length(scan_engine) between 1 and 80),
  scan_signature_version bigint check (scan_signature_version > 0),
  scan_signature_at timestamptz,
  scanned_at timestamptz,
  scan_attempts integer not null default 0 check (scan_attempts between 0 and 100),
  lease_hash text check (lease_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  object_deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  -- A clean document carries its whole positive verdict, bound to its bytes.
  check ((state = 'clean') = (scan_verdict is not null)),
  check (state <> 'clean' or (scanned_sha256 = sha256 and scan_engine is not null
    and scan_signature_version is not null and scan_signature_at is not null and scanned_at is not null
    and object_deleted_at is null)),
  check ((state = 'refused') = (refusal_code is not null)),
  check (object_deleted_at is null or state = 'refused')
);
create index appeal_documents_intake_idx on private.appeal_documents (intake_id);
create index appeal_documents_queue_idx on private.appeal_documents (created_at) where state = 'quarantined';
alter table private.appeal_documents enable row level security;
revoke all on private.appeal_documents from public, anon, authenticated, service_role;


create unique index appeal_document_independent_wrapped_key on private.appeal_document_sessions(wrapped_document_key) where wrapped_document_key is not null;


create function private.guard_appeal_document_transition_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'quarantined' or new.scan_verdict is not null or new.object_deleted_at is not null then
      raise exception using errcode = '42501', message = 'a claim document starts quarantined';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.session_id <> old.session_id or new.intake_id <> old.intake_id
    or new.sha256 <> old.sha256 or new.object_key <> old.object_key or new.byte_count <> old.byte_count
    or new.media_type <> old.media_type or new.document_kind <> old.document_kind then
    raise exception using errcode = '42501', message = 'a claim document is immutable';
  end if;
  if old.state <> 'quarantined' and new.state <> old.state then
    raise exception using errcode = '42501', message = 'a scanned claim document keeps its verdict';
  end if;
  if new.state = 'clean' and old.state <> 'clean'
    and coalesce(current_setting('inherit.appeal_document_scan', true), '') <> new.id::text then
    raise exception using errcode = '42501', message = 'only a recorded scan marks a document clean';
  end if;
  return new;
end;
$$;

create trigger appeal_document_transition before insert or update on private.appeal_documents for each row execute function private.guard_appeal_document_transition_v1();

create function private.guard_appeal_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if (new.id,new.intake_id,new.document_id,new.document_kind) is distinct from
     (old.id,old.intake_id,old.document_id,old.document_kind)
     or (old.wrapped_document_key is null and
       (new.wrapped_document_key is not null or new.document_key_shredded_at is distinct from old.document_key_shredded_at))
     or (old.wrapped_document_key is not null and new.wrapped_document_key is not null
       and new.wrapped_document_key is distinct from old.wrapped_document_key) then
     raise exception using errcode='42501',message='claim document key immutable';
   end if;
 end if;
 if new.state='failed' then
   new.wrapped_document_key:=null;
   new.document_key_shredded_at:=coalesce(new.document_key_shredded_at,clock_timestamp());
 end if;
 return new;
end $$;

create trigger appeal_document_key_immutable before insert or update on private.appeal_document_sessions for each row execute function private.guard_appeal_document_key_v1();

create function private.shred_refused_appeal_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='refused' then
   update private.appeal_document_sessions set wrapped_document_key=null,
     document_key_shredded_at=coalesce(document_key_shredded_at,clock_timestamp())
   where id=new.session_id and wrapped_document_key is not null;
 end if;
 return new;
end $$;

create trigger appeal_document_refusal_shreds_key after insert or update of state on private.appeal_documents for each row execute function private.shred_refused_appeal_document_key_v1();

create function private.fail_appeal_document_session_row_v1(p_session_id uuid, p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.appeal_document_sessions set state = 'failed', failure_code = p_code
  where id = p_session_id and state in ('open', 'composing');
  update private.appeal_document_fragments set state = 'delete_pending' where session_id = p_session_id;
  perform private.append_legal_audit_event('appeal.document.refused', null, 'api.evidence-complete',
    'refused', jsonb_build_object('reason', p_code));
end;
$$;

create function private.settle_appeal_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_written boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_session private.appeal_document_sessions;
begin
  v_session := private.appeal_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if not p_written then
    perform private.fail_appeal_document_session_row_v1(v_session.id, 'storage');
    return 'failed';
  end if;
  update private.appeal_document_fragments set state = 'written'
  where session_id = v_session.id and sequence = p_sequence and state = 'reserved';
  if not found then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  return 'written';
end;
$$;

create function private.appeal_document_status_v1(p_session private.appeal_document_sessions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p_session.state = 'failed' then jsonb_build_object('status', 'refused', 'reason', p_session.failure_code)
    when d.id is null then jsonb_build_object('status', 'composing')
    when d.state = 'quarantined' then jsonb_build_object('status', 'scanning', 'documentId', d.id,
      'documentKind', d.document_kind)
    when d.state = 'clean' then jsonb_build_object('status', 'review_pending', 'documentId', d.id,
      'documentKind', d.document_kind)
    else jsonb_build_object('status', 'refused', 'reason', d.refusal_code)
  end
  from (select 1) one
  left join private.appeal_documents d on d.session_id = p_session.id;
$$;

create function private.finish_appeal_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_outcome text, p_object_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session private.appeal_document_sessions;
begin
  v_session := private.appeal_document_session_for_v1(p_session_id,p_cookie_hash);
  if v_session.id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
  select s.* into v_session from private.appeal_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash
    and s.complete_nonce_hash = p_complete_nonce_hash for update;
  if v_session.id is null or v_session.state <> 'composing' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_outcome in ('integrity', 'type', 'storage') then
    perform private.fail_appeal_document_session_row_v1(v_session.id, p_outcome);
    return private.appeal_document_status_v1(
      (select s from private.appeal_document_sessions s where s.id = v_session.id));
  end if;
  if p_outcome is distinct from 'composed' or p_object_key is distinct from v_session.planned_object_key then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  insert into private.appeal_documents (id, session_id, intake_id, document_kind, media_type, byte_count,
    sha256, object_key)
  values (v_session.document_id, v_session.id, v_session.intake_id, v_session.document_kind,
    v_session.media_type, v_session.declared_bytes, v_session.declared_sha256, p_object_key);
  update private.appeal_document_sessions set state = 'finalized' where id = v_session.id;
  update private.appeal_document_fragments set state = 'delete_pending' where session_id = v_session.id;
  perform private.append_legal_audit_event('appeal.document.received', null, 'api.evidence-complete',
    'accepted', '{}'::jsonb);
  return private.appeal_document_status_v1(
    (select s from private.appeal_document_sessions s where s.id = v_session.id));
end;
$$;

create function private.record_appeal_document_scan_v1(
  p_document_id uuid, p_lease_hash text, p_outcome text, p_scanned_sha256 text,
  p_scan_engine text, p_signature_version bigint, p_signature_at timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_document private.appeal_documents;
  v_limits jsonb := private.appeal_document_limits_v1();
  v_refusal text;
begin
  perform private.lock_invitation_transitions_v1();
  select d.* into v_document from private.appeal_documents d
  where d.id = p_document_id and d.lease_hash = p_lease_hash and d.state = 'quarantined'
    and d.lease_expires_at > clock_timestamp()
  for update;
  if v_document.id is null then
    raise exception using errcode = '42501', message = 'scan lease unavailable';
  end if;
  if not private.new_public_appeal_evidence_current_v1(v_document.intake_id) then
   raise exception using errcode='42501',message='appeal unavailable';end if;
  if p_outcome = 'OK' then
    if p_scanned_sha256 is distinct from v_document.sha256
      or p_scan_engine is null or length(p_scan_engine) not between 1 and 80
      or p_signature_version is null or p_signature_version < 1
      or p_signature_at is null
      or p_signature_at < clock_timestamp() - make_interval(secs => (v_limits->>'signatureFreshnessSeconds')::integer)
      or p_signature_at > clock_timestamp() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'scan verdict refused';
    end if;
    perform set_config('inherit.appeal_document_scan', v_document.id::text, true);
    update private.appeal_documents set state = 'clean', scan_verdict = 'OK',
      scanned_sha256 = p_scanned_sha256, scan_engine = p_scan_engine,
      scan_signature_version = p_signature_version, scan_signature_at = p_signature_at,
      scanned_at = clock_timestamp(), lease_hash = null, lease_expires_at = null
    where id = v_document.id;
    perform set_config('inherit.appeal_document_scan', '', true);
    perform private.append_legal_audit_event('appeal.document.scanned', null, 'jobs.claim-document-scan',
      'accepted', '{}'::jsonb);
    return 'clean';
  elsif p_outcome = 'UNAVAILABLE' then
    if v_document.scan_attempts < (v_limits->>'maximumScanAttempts')::integer then
      update private.appeal_documents set lease_hash = null, lease_expires_at = null where id = v_document.id;
      return 'retry';
    end if;
    v_refusal := 'unscannable';
  elsif p_outcome = 'FOUND' then
    v_refusal := 'infected';
  elsif p_outcome = 'UNSCANNABLE' then
    v_refusal := 'unscannable';
  elsif p_outcome = 'OVERSIZE' then
    v_refusal := 'oversize';
  else
    raise exception using errcode = '22023', message = 'scan verdict refused';
  end if;
  update private.appeal_documents set state = 'refused', refusal_code = v_refusal,
    lease_hash = null, lease_expires_at = null
  where id = v_document.id;
  perform private.append_legal_audit_event('appeal.document.refused', null, 'jobs.claim-document-scan',
    'refused', jsonb_build_object('reason', v_refusal));
  return 'delete';
end;
$$;

create function private.appeal_document_objects_due_v1(p_limit integer)
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
      or s.expires_at <= clock_timestamp()
    union all
    select s.planned_object_key, s.created_at
    from private.appeal_document_sessions s
    join private.new_public_appeal_intakes i on i.id = s.intake_id
    where s.planned_object_key is not null
      and not exists (select 1 from private.appeal_documents d where d.object_key = s.planned_object_key)
      and (s.state = 'failed' or s.expires_at <= clock_timestamp() or not private.new_public_appeal_evidence_current_v1(i.id))
    union all
    select d.object_key, d.created_at
    from private.appeal_documents d
    join private.new_public_appeal_intakes i on i.id = d.intake_id
    where d.object_deleted_at is null
      and (d.state = 'refused' or not private.new_public_appeal_evidence_current_v1(i.id))
  ) k
  order by k.created_at
  limit greatest(least(coalesce(p_limit, 100), 1000), 1);
end;
$$;

create function private.confirm_appeal_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
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
    and d.state<>'refused' and private.new_public_appeal_evidence_current_v1(d.intake_id))
   or exists(select 1 from private.appeal_document_fragments f join private.appeal_document_sessions ds on ds.id=f.session_id
    where f.object_key=any(p_object_keys) and f.state<>'delete_pending' and ds.expires_at>clock_timestamp()
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
      where review.photo_document_id=v_document.id or review.authority_document_id=v_document.id;
      delete from private.appeal_documents where id = v_document.id;
      perform private.append_legal_audit_event('appeal.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'appeal-ended'));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function private.reserve_appeal_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.appeal_document_sessions;
  v_limits jsonb := private.appeal_document_limits_v1();
  v_written bigint;
  v_key text;
  v_intake private.new_public_appeal_intakes;
begin
  v_session := private.appeal_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_sequence is null or p_sequence < 0 or p_sequence >= (v_limits->>'maximumChunks')::integer
    or exists (select 1 from private.appeal_document_fragments f where f.session_id = v_session.id and f.sequence = p_sequence) then
    raise exception using errcode = '23505', message = 'claim document chunk already written';
  end if;
  select coalesce(sum(f.byte_count), 0) into v_written from private.appeal_document_fragments f
  where f.session_id = v_session.id;
  if p_byte_count is null or p_byte_count < 1 or p_byte_count > (v_limits->>'chunkBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or v_written + p_byte_count > v_session.declared_bytes then
    perform private.fail_appeal_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'invalid');
  end if;
  v_key := v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text;
  insert into private.appeal_document_fragments (session_id, sequence, object_key, byte_count, sha256)
  values (v_session.id, p_sequence, v_key, p_byte_count, p_sha256);
  select i.* into v_intake from private.new_public_appeal_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'reserved', 'objectKey', v_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'));
end;
$$;

create function private.begin_appeal_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_chunk_count integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.appeal_document_sessions;
  v_count integer;
  v_bytes bigint;
  v_max integer;
  v_intake private.new_public_appeal_intakes;
begin
  if p_complete_nonce_hash is null or p_complete_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  select s.* into v_session from private.appeal_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if private.appeal_document_session_for_v1(p_session_id,p_cookie_hash) is null then
   raise exception using errcode='42501',message='appeal unavailable';end if;
  if v_session.state <> 'open' then
    -- The same nonce may ask again for the outcome; nothing else may.
    if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash then
      raise exception using errcode = '23505', message = 'claim document completion already used';
    end if;
    return private.appeal_document_status_v1(v_session);
  end if;
  v_session := private.appeal_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if exists (select 1 from private.appeal_document_sessions where complete_nonce_hash = p_complete_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document completion already used';
  end if;
  select count(*), coalesce(sum(byte_count), 0), coalesce(max(sequence), -1)
  into v_count, v_bytes, v_max
  from private.appeal_document_fragments where session_id = v_session.id and state = 'written';
  if p_chunk_count is null or p_chunk_count < 1 or p_chunk_count <> v_count or v_max <> v_count - 1
    or exists (select 1 from private.appeal_document_fragments where session_id = v_session.id and state <> 'written')
    or v_bytes <> v_session.declared_bytes then
    update private.appeal_document_sessions set complete_nonce_hash = p_complete_nonce_hash
    where id = v_session.id;
    perform private.fail_appeal_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'refused', 'reason', 'integrity');
  end if;
  update private.appeal_document_sessions set state = 'composing', complete_nonce_hash = p_complete_nonce_hash,
    planned_object_key = v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text
  where id = v_session.id
  returning * into v_session;
  select i.* into v_intake from private.new_public_appeal_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'compose',
    'documentId', v_session.document_id, 'documentKind', v_session.document_kind,
    'mediaType', v_session.media_type, 'sizeBytes', v_session.declared_bytes,
    'sha256', v_session.declared_sha256,
    'objectKey', v_session.planned_object_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'),
    'fragments', (select jsonb_agg(jsonb_build_object('sequence', f.sequence, 'objectKey', f.object_key,
        'byteCount', f.byte_count, 'sha256', f.sha256) order by f.sequence)
      from private.appeal_document_fragments f where f.session_id = v_session.id));
end;
$$;

create function private.claim_next_appeal_document_scan_v1(p_lease_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_document private.appeal_documents;
  v_limits jsonb := private.appeal_document_limits_v1();
begin
  if p_lease_hash is null or p_lease_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'scan lease invalid';
  end if;
  select d.* into v_document from private.appeal_documents d
  join private.new_public_appeal_intakes i on i.id = d.intake_id
  join private.appeal_document_sessions ds on ds.id=d.session_id and ds.wrapped_document_key is not null
  where d.state = 'quarantined' and (d.lease_expires_at is null or d.lease_expires_at <= clock_timestamp())
    and private.new_public_appeal_evidence_current_v1(i.id)
  order by d.created_at, d.id
  limit 1
  for update of d skip locked;
  if v_document.id is null then return null; end if;
  update private.appeal_documents set lease_hash = p_lease_hash,
    lease_expires_at = clock_timestamp() + make_interval(secs => (v_limits->>'scanLeaseSeconds')::integer),
    scan_attempts = scan_attempts + 1
  where id = v_document.id;
  return jsonb_build_object('documentId', v_document.id, 'objectKey', v_document.object_key,
    'sha256', v_document.sha256, 'byteCount', v_document.byte_count, 'mediaType', v_document.media_type,
    'wrappedDataKey', (select encode(ds.wrapped_document_key,'hex') from private.appeal_document_sessions ds
      where ds.id=v_document.session_id));
end;
$$;

create function private.appeal_document_session_for_v1(p_session_id uuid,p_cookie_hash text) returns private.appeal_document_sessions
language plpgsql security definer set search_path='' as $$
declare ds private.appeal_document_sessions;rights public.rights_sessions;
begin
 if p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then return null;end if;
 perform private.lock_invitation_transitions_v1();
 select source.* into ds from private.appeal_document_sessions source where source.id=p_session_id and source.cookie_hash=p_cookie_hash;
 if ds.id is null or ds.rights_session_id is null or ds.wrapped_document_key is null or ds.expires_at<=clock_timestamp() then return null;end if;
 select rs.* into rights from public.rights_sessions rs where rs.id=ds.rights_session_id;
 rights:=private.new_public_appeal_rights_at_v1(rights.session_hash,true);
 if rights.id is null or rights.target_id<>ds.intake_id or rights.authority_revision<>ds.evidence_revision then return null;end if;
 select source.* into ds from private.appeal_document_sessions source where source.id=ds.id for update;
 if ds.wrapped_document_key is null or ds.expires_at<=clock_timestamp() then return null;end if;
 update public.rights_sessions set last_activity_at=clock_timestamp() where id=rights.id;
 return ds;
end $$;

create function public.open_public_appeal_document_v1(p_session_hash text,p_nonce text,p_document_kind text,p_media_type text,
 p_size_bytes integer,p_sha256 text,p_cookie_hash text,p_wrapped_document_key bytea) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;ds private.appeal_document_sessions;allowed text[];
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='appeal unavailable';end if;
 rights:=private.new_public_appeal_rights_at_v1(p_session_hash,true);
 if rights.id is null or not private.rights_action_permitted_v1(rights.purpose,'create-kind-bound-document-session','api.appeal-document-session') then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=rights.target_id;
 allowed:=case intake.kind
  when 'subject-objection' then array['appeal-photo-identity','appeal-subject-source-control']
  when 'genetic-parent-objection' then array['appeal-photo-identity','appeal-genetic-parent-authority']
  when 'access-or-review-appeal' then array['appeal-photo-identity','appeal-decision-notice'] end;
 if p_document_kind is null or not(p_document_kind=any(allowed)) or p_media_type is null
  or p_media_type not in('application/pdf','image/jpeg','image/png') or p_size_bytes is null or p_size_bytes not between 1 and 20000000
  or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$'
  or p_wrapped_document_key is null or octet_length(p_wrapped_document_key)<>72 or p_wrapped_document_key=intake.wrapped_case_key
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rights,p_nonce);
 if (select count(*) from private.appeal_document_sessions s where s.intake_id=intake.id and s.state in('open','composing'))>=3
  or (select count(*) from private.appeal_document_sessions s where s.intake_id=intake.id and s.document_kind=p_document_kind and s.state<>'failed')>=3
  then return jsonb_build_object('status','capacity_limited');end if;
 insert into private.appeal_document_sessions(intake_id,rights_session_id,evidence_revision,document_kind,media_type,declared_bytes,
  declared_sha256,cookie_hash,create_nonce_hash,created_at,expires_at,wrapped_document_key)
 values(intake.id,rights.id,rights.authority_revision,p_document_kind,p_media_type,p_size_bytes,p_sha256,p_cookie_hash,
  encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex'),clock_timestamp(),least(rights.expires_at,intake.deadline),p_wrapped_document_key)
 returning * into ds;
 update public.rights_sessions set last_activity_at=clock_timestamp() where id=rights.id;
 return jsonb_build_object('status','open','session',ds.id,'documentKind',ds.document_kind,'expiresAt',ds.expires_at);
end $$;

create function public.reserve_appeal_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_byte_count integer,p_sha256 text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.reserve_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);$$;
create function public.settle_appeal_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_written boolean)
returns text language sql security invoker set search_path='' as $$
 select private.settle_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_written);$$;
create function public.begin_appeal_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_chunk_count integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.begin_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);$$;
create function public.finish_appeal_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_outcome text,p_object_key text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.finish_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);$$;
create function public.claim_next_appeal_document_scan_v1(p_lease_hash text) returns jsonb language sql security invoker set search_path='' as $$
 select private.claim_next_appeal_document_scan_v1(p_lease_hash);$$;
create function public.record_appeal_document_scan_v1(p_document_id uuid,p_lease_hash text,p_outcome text,p_scanned_sha256 text,
 p_scan_engine text,p_signature_version bigint,p_signature_at timestamptz) returns text language sql security invoker set search_path='' as $$
 select private.record_appeal_document_scan_v1(p_document_id,p_lease_hash,p_outcome,p_scanned_sha256,p_scan_engine,p_signature_version,p_signature_at);$$;
create function public.appeal_document_objects_due_v1(p_limit integer) returns table(object_key text)
 language sql security invoker set search_path='' as $$select * from private.appeal_document_objects_due_v1(p_limit);$$;
create function public.confirm_appeal_document_objects_deleted_v1(p_object_keys text[],p_route_id text) returns integer
 language sql security invoker set search_path='' as $$select private.confirm_appeal_document_objects_deleted_v1(p_object_keys,p_route_id);$$;

-- Key erasure is atomic with terminal case closure. Object locators remain
-- recorded until Storage really acknowledges removal; no ACK is fabricated.
create function private.shred_public_appeal_evidence_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='closed' then
  update private.appeal_document_sessions set wrapped_document_key=null,document_key_shredded_at=coalesce(document_key_shredded_at,clock_timestamp())
   where intake_id=new.id and wrapped_document_key is not null;
  update private.appeal_document_fragments f set state='delete_pending' where f.session_id in(
   select s.id from private.appeal_document_sessions s where s.intake_id=new.id);
  update private.new_public_appeal_evidence_state set state='closed' where case_id=new.id;
 end if;
 return new;
end $$;
create trigger shred_public_appeal_evidence after update of state on private.new_public_appeal_intakes
 for each row execute function private.shred_public_appeal_evidence_v1();
insert into public.purge_target_stores(target_id,store_name,store_order) values
 ('legal-evidence-working-and-private-objects','private.appeal_document_sessions',9),
 ('legal-evidence-working-and-private-objects','private.appeal_document_fragments',10),
 ('appeal-and-correction-working-packages','private.appeal_documents',11),
 ('appeal-and-correction-working-packages','private.new_public_appeal_evidence_state',12);

revoke all on function private.new_public_appeal_evidence_current_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.guard_new_public_appeal_rights_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.activate_rights_session_v1(text,text,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.activate_rights_session_v1(text,text,text) to service_role;
revoke all on function private.new_public_appeal_rights_at_v1(text,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.new_public_appeal_evidence_view_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.new_public_appeal_evidence_view_v1(text) to service_role;
revoke all on function private.appeal_document_limits_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.guard_appeal_document_transition_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.guard_appeal_document_key_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.shred_refused_appeal_document_key_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.fail_appeal_document_session_row_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.settle_appeal_document_chunk_v1(uuid,text,integer,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.settle_appeal_document_chunk_v1(uuid,text,integer,boolean) to service_role;
revoke all on function private.appeal_document_status_v1(private.appeal_document_sessions) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.finish_appeal_document_completion_v1(uuid,text,text,text,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.finish_appeal_document_completion_v1(uuid,text,text,text,text) to service_role;
revoke all on function private.record_appeal_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.record_appeal_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz) to service_role;
revoke all on function private.appeal_document_objects_due_v1(integer) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.appeal_document_objects_due_v1(integer) to service_role;
revoke all on function private.confirm_appeal_document_objects_deleted_v1(text[],text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.confirm_appeal_document_objects_deleted_v1(text[],text) to service_role;
revoke all on function private.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text) to service_role;
revoke all on function private.begin_appeal_document_completion_v1(uuid,text,text,integer) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.begin_appeal_document_completion_v1(uuid,text,text,integer) to service_role;
revoke all on function private.claim_next_appeal_document_scan_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.claim_next_appeal_document_scan_v1(text) to service_role;
revoke all on function private.appeal_document_session_for_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.open_public_appeal_document_v1(text,text,text,text,integer,text,text,bytea) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.open_public_appeal_document_v1(text,text,text,text,integer,text,text,bytea) to service_role;
revoke all on function public.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text) to service_role;
revoke all on function public.settle_appeal_document_chunk_v1(uuid,text,integer,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.settle_appeal_document_chunk_v1(uuid,text,integer,boolean) to service_role;
revoke all on function public.begin_appeal_document_completion_v1(uuid,text,text,integer) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.begin_appeal_document_completion_v1(uuid,text,text,integer) to service_role;
revoke all on function public.finish_appeal_document_completion_v1(uuid,text,text,text,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.finish_appeal_document_completion_v1(uuid,text,text,text,text) to service_role;
revoke all on function public.claim_next_appeal_document_scan_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.claim_next_appeal_document_scan_v1(text) to service_role;
revoke all on function public.record_appeal_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.record_appeal_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz) to service_role;
revoke all on function public.appeal_document_objects_due_v1(integer) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.appeal_document_objects_due_v1(integer) to service_role;
revoke all on function public.confirm_appeal_document_objects_deleted_v1(text[],text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.confirm_appeal_document_objects_deleted_v1(text[],text) to service_role;
revoke all on function private.shred_public_appeal_evidence_v1() from public,anon,authenticated,inherit_upload_only,service_role;

-- Existing generic evidence endpoints retain their ABI. The native session
-- and exact cookie choose the domain; request data never chooses a bucket.
alter function public.reserve_claim_document_chunk_v1(uuid,text,integer,integer,text) rename to reserve_claim_document_chunk_before_public_appeal_v1;
revoke all on function public.reserve_claim_document_chunk_before_public_appeal_v1(uuid,text,integer,integer,text) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.reserve_claim_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_byte_count integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  result:=private.reserve_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);
  if result->>'status'='reserved' then return result||jsonb_build_object('storageKind','appeal');end if;return result;
 end if;
 return public.reserve_claim_document_chunk_before_public_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);
end $$;
alter function public.settle_claim_document_chunk_v1(uuid,text,integer,boolean) rename to settle_claim_document_chunk_before_public_appeal_v1;
revoke all on function public.settle_claim_document_chunk_before_public_appeal_v1(uuid,text,integer,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.settle_claim_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_written boolean)
returns text language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.settle_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_written);end if;
 return public.settle_claim_document_chunk_before_public_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_written);
end $$;
alter function public.begin_claim_document_completion_v1(uuid,text,text,integer) rename to begin_claim_document_completion_before_public_appeal_v1;
revoke all on function public.begin_claim_document_completion_before_public_appeal_v1(uuid,text,text,integer) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.begin_claim_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_chunk_count integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  result:=private.begin_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);
  if result->>'status'='compose' then return result||jsonb_build_object('storageKind','appeal');end if;return result;
 end if;
 return public.begin_claim_document_completion_before_public_appeal_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);
end $$;
alter function public.finish_claim_document_completion_v1(uuid,text,text,text,text) rename to finish_claim_document_completion_before_public_appeal_v1;
revoke all on function public.finish_claim_document_completion_before_public_appeal_v1(uuid,text,text,text,text) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.finish_claim_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_outcome text,p_object_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.finish_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);end if;
 return public.finish_claim_document_completion_before_public_appeal_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);
end $$;
revoke all on function public.reserve_claim_document_chunk_v1(uuid,text,integer,integer,text),public.settle_claim_document_chunk_v1(uuid,text,integer,boolean),
 public.begin_claim_document_completion_v1(uuid,text,text,integer),public.finish_claim_document_completion_v1(uuid,text,text,text,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.reserve_claim_document_chunk_v1(uuid,text,integer,integer,text),public.settle_claim_document_chunk_v1(uuid,text,integer,boolean),
 public.begin_claim_document_completion_v1(uuid,text,text,integer),public.finish_claim_document_completion_v1(uuid,text,text,text,text) to service_role;

-- This first TEST completion has a deliberately narrow no-match disposition.
-- A potential contact match is refused, never adopted as an account or treated
-- as authoritative target evidence. Positive subject/cohort holds remain closed
-- until their separate typed confirmation/parentage resolver is implemented.
create function private.appeal_contact_digest_equal_v1(p_left text,p_right text) returns boolean
language plpgsql immutable strict security invoker set search_path='' as $$
declare left_bytes bytea;right_bytes bytea;difference integer:=0;byte_position integer;
begin
 if p_left!~'^[0-9a-f]{64}$' or p_right!~'^[0-9a-f]{64}$' then return false;end if;
 left_bytes:=decode(p_left,'hex');right_bytes:=decode(p_right,'hex');
 for byte_position in 0..31 loop difference:=difference | (get_byte(left_bytes,byte_position) # get_byte(right_bytes,byte_position));end loop;
 return difference=0;
end $$;
create table private.public_appeal_pending_reviews(
 case_id uuid primary key references private.new_public_appeal_intakes(id) on delete restrict,
 evidence_revision bigint not null check(evidence_revision>0),
 reviewer_principal_id uuid not null references private.new_public_appeal_reviewers(principal_id) on delete restrict,
 reviewer_revision bigint not null check(reviewer_revision>0),purpose_revision bigint not null check(purpose_revision>0),
 photo_document_id uuid not null references private.appeal_documents(id) on delete restrict,
 authority_document_id uuid not null references private.appeal_documents(id) on delete restrict,
 state text not null default 'pending' check(state in('pending','closed')),
 created_at timestamptz not null,deadline timestamptz not null,closed_at timestamptz,
 check(photo_document_id<>authority_document_id),check(deadline>created_at),
 check((state='closed')=(closed_at is not null))
);
alter table private.public_appeal_pending_reviews enable row level security;
revoke all on private.public_appeal_pending_reviews from public,anon,authenticated,inherit_upload_only,service_role;
create function public.complete_new_public_appeal_evidence_v1(p_session_hash text,p_nonce text,p_documents jsonb,p_affirmed boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;evidence private.new_public_appeal_evidence_state;
 photo_id uuid;authority_id uuid;authority_key text;authority_kind text;document_row private.appeal_documents;
 source_session private.appeal_document_sessions;now_at timestamptz;digest_pair record;potential_match boolean:=false;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_affirmed is distinct from true then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 rights:=private.new_public_appeal_rights_at_v1(p_session_hash,true);
 if rights.id is null or not private.rights_action_permitted_v1(rights.purpose,'complete-evidence-set','api.appeal-complete') then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=rights.target_id;
 select source.* into evidence from private.new_public_appeal_evidence_state source where source.case_id=intake.id;
 if intake.kind='subject-objection' then
  authority_key:='subjectSourceControlDocumentId';authority_kind:='appeal-subject-source-control';
 elsif intake.kind='genetic-parent-objection' then
  authority_key:='geneticParentAuthorityDocumentId';authority_kind:='appeal-genetic-parent-authority';
 else raise exception using errcode='42501',message='appeal unavailable';end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_documents)key)
    is distinct from (select array_agg(key order by key) from unnest(array['photoIdentityDocumentId',authority_key])key)
  or p_documents->>'photoIdentityDocumentId' is null or p_documents->>'photoIdentityDocumentId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_documents->>authority_key is null or p_documents->>authority_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 photo_id:=(p_documents->>'photoIdentityDocumentId')::uuid;authority_id:=(p_documents->>authority_key)::uuid;
 if photo_id=authority_id then raise exception using errcode='42501',message='appeal unavailable';end if;
 -- IDs are only handles to already finalized bytes in this case, not targets.
 perform 1 from private.appeal_document_sessions ds where ds.id in(select doc.session_id
  from private.appeal_documents doc where doc.id in(photo_id,authority_id)) order by ds.id for update;
 perform 1 from private.appeal_documents doc where doc.id in(photo_id,authority_id) order by doc.id for update;
 if (select count(*) from private.appeal_documents doc where doc.id in(photo_id,authority_id))<>2 then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 for document_row in select doc.* from private.appeal_documents doc where doc.id in(photo_id,authority_id) order by doc.id loop
  select ds.* into source_session from private.appeal_document_sessions ds where ds.id=document_row.session_id;
  if document_row.intake_id<>intake.id or document_row.document_kind is distinct from
    (case when document_row.id=photo_id then 'appeal-photo-identity' else authority_kind end)
   or document_row.state<>'clean' or document_row.scan_verdict is distinct from 'OK'
   or document_row.scanned_sha256 is distinct from document_row.sha256 or document_row.scan_engine is null
   or document_row.scan_signature_version is null or document_row.scan_signature_at is null or document_row.scanned_at is null
   or document_row.object_deleted_at is not null or source_session.state<>'finalized'
   or source_session.intake_id<>intake.id or source_session.evidence_revision<>evidence.revision
   or source_session.wrapped_document_key is null or source_session.document_key_shredded_at is not null
   or source_session.declared_sha256<>document_row.sha256 or source_session.declared_bytes<>document_row.byte_count
   or source_session.document_id<>document_row.id or source_session.planned_object_key<>document_row.object_key then
   raise exception using errcode='42501',message='appeal unavailable';end if;
 end loop;
 -- Compare only native same-key-revision HMACs, never plaintext or an account
 -- lookup. Even stale/ambiguous potential matches keep this TEST path closed.
 for digest_pair in
  select submitted.value as requested_digest,idx.contact_hmac as stored_digest
  from jsonb_each_text(intake.frame->'contactDigests')submitted
  join public.contact_hmac_indexes idx on idx.hmac_key_revision=submitted.key::bigint
  join public.encrypted_contact_references contact on contact.id=idx.contact_reference_id
  where contact.principal_id<>intake.author_principal_id
 loop
  potential_match:=private.appeal_contact_digest_equal_v1(digest_pair.requested_digest,digest_pair.stored_digest) or potential_match;
 end loop;
 if potential_match then raise exception using errcode='42501',message='appeal unavailable';end if;
 if not private.new_public_appeal_evidence_current_v1(intake.id) or exists(select 1 from private.public_appeal_pending_reviews where case_id=intake.id)
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rights,p_nonce);
 now_at:=clock_timestamp();
 insert into private.public_appeal_pending_reviews(case_id,evidence_revision,reviewer_principal_id,reviewer_revision,purpose_revision,
  photo_document_id,authority_document_id,created_at,deadline)
 values(intake.id,evidence.revision,intake.reviewer_principal_id,intake.reviewer_revision,intake.purpose_revision,
  photo_id,authority_id,now_at,intake.deadline);
 update private.new_public_appeal_evidence_state set revision=revision+1,state='submitted',submitted_at=now_at where case_id=intake.id;
 update public.rights_sessions set status='consumed',ended_at=now_at,last_activity_at=now_at
  where purpose='appeal-evidence' and target_kind='appeal-case' and target_id=intake.id and status='active';
 perform private.append_legal_audit_event('appeal.evidence.submitted',null,'api.appeal-complete','accepted','{}');
 return jsonb_build_object('status','review_pending','deadline',intake.deadline);
end $$;
create function private.close_public_appeal_pending_review_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='closed' and old.state<>'closed' then
  delete from private.public_appeal_pending_reviews where case_id=new.id; -- case/doc links expire with the original30day package
 end if;return new;
end $$;
create trigger public_appeal_pending_review_terminal after update of state on private.new_public_appeal_intakes
 for each row execute function private.close_public_appeal_pending_review_v1();
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('appeal-and-correction-working-packages','private.public_appeal_pending_reviews',13);
revoke all on function private.appeal_contact_digest_equal_v1(text,text),private.close_public_appeal_pending_review_v1(),
 public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean) to service_role;
