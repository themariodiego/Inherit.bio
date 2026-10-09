-- Public contact matching selects a provisional hold only. It never adopts
-- the random case principal, approves a document, or grants a genetic right.
-- Deployment and private provider configuration remain disabled.
create table private.public_appeal_provisional_targets (
 case_id uuid primary key references private.new_public_appeal_intakes(id) on delete restrict,
 target_kind text not null check(target_kind in('subject','cohort')),target_id uuid not null,
 binding jsonb not null check(jsonb_typeof(binding)='object'),
 created_at timestamptz not null,expires_at timestamptz not null,check(expires_at>created_at)
);
alter table private.public_appeal_provisional_targets enable row level security;
revoke all on private.public_appeal_provisional_targets from public,anon,authenticated,service_role,inherit_upload_only;

-- Lock all matching contacts before considering their typed relationships.
-- Distinct key revisions of one contact are one candidate; two relationships
-- or a stale matching contact cannot silently become a unique current target.
create function private.public_appeal_provisional_binding_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intake private.new_public_appeal_intakes;candidate record;signature_id uuid;
 subject_row public.subjects;principal_row public.subject_principals;contact_row public.encrypted_contact_references;
 cohort_row public.embryo_cohorts;draft_row public.embryo_cohort_drafts;basis public.embryo_basis_bindings;
 typed jsonb;confirmed_binding jsonb;matches jsonb:='[]';matched_contacts uuid[]:='{}';current_contacts uuid[]:='{}';parent_set uuid[];contact_id uuid;
begin
 perform private.lock_invitation_transitions_v1();
 select i.* into intake from private.new_public_appeal_intakes i where i.id=p_case for update;
 if intake.kind not in('subject-objection','genetic-parent-objection') or not private.new_public_appeal_evidence_current_v1(p_case) then return null;end if;
 perform 1 from public.encrypted_contact_references c where c.id=intake.case_contact_id for share;
 -- The activated case token verifies this exact original recipient. Public
 -- references, names and statement contents never enter this resolver.
 for candidate in select distinct c.id from public.encrypted_contact_references c
  join public.contact_hmac_indexes h on h.contact_reference_id=c.id
  join jsonb_each_text(intake.frame->'contactDigests') submitted on h.hmac_key_revision=submitted.key::bigint
  where c.principal_id<>intake.author_principal_id
   and private.appeal_contact_digest_equal_v1(submitted.value,h.contact_hmac)
  order by c.id loop
  matched_contacts:=array_append(matched_contacts,candidate.id);
 end loop;
 foreach contact_id in array matched_contacts loop
  select c.* into contact_row from public.encrypted_contact_references c where c.id=contact_id for share;
  select actor.* into principal_row from public.subject_principals actor where actor.id=contact_row.principal_id for share;
  if contact_row.status<>'current' or contact_row.contact_ciphertext is null or principal_row.status<>'active'
   or principal_row.principal_revision<>contact_row.authority_revision
   or not exists(select 1 from public.contact_hmac_indexes h join jsonb_each_text(intake.frame->'contactDigests') submitted
     on submitted.key::bigint=h.hmac_key_revision where h.contact_reference_id=contact_row.id and h.status='current'
      and h.expires_at>clock_timestamp() and private.appeal_contact_digest_equal_v1(submitted.value,h.contact_hmac)) then return null;end if;
  typed:=null;
  if intake.kind='subject-objection' and principal_row.principal_kind in('non_account_subject','account_subject') then
   select s.* into subject_row from public.subjects s where s.id=principal_row.subject_id for share;
   if subject_row.subject_class='other_adult' and subject_row.lifecycle='active'
    and ((principal_row.principal_kind='non_account_subject' and principal_row.account_id is null and subject_row.subject_account_id is null)
      or (principal_row.principal_kind='account_subject' and principal_row.account_id=subject_row.subject_account_id)) then
    signature_id:=null;
    -- A current native accepted invitation and its exact signed artifact are
    -- the adult confirmation, not address/account ownership alone.
    select cs.id into signature_id from public.subject_invitations invitation
     join public.adult_subject_drafts d on d.subject_id=subject_row.id and d.state='confirmed'
     join public.consent_signatures cs on cs.signer_principal_id=principal_row.id and cs.target_kind='subject'
      and cs.target_id=subject_row.id and cs.subject_binding_revision=subject_row.subject_binding_revision
     join public.consent_artifacts artifact on artifact.artifact_key=cs.artifact_key and artifact.version=cs.artifact_version
      and artifact.body_sha256=cs.artifact_body_sha256
     where invitation.target_kind='subject' and invitation.target_id=subject_row.id
      and invitation.invitee_principal_id=principal_row.id and invitation.invitation_kind='adult_subject'
      and invitation.status='accepted' and invitation.accepted_at is not null
      and ((d.adult_flow='path-b-subject-esignature' and artifact.artifact_key='consent.subject-adult-esignature'
        and cs.purpose='adult-subject-path-b-confirmation')
       or (d.adult_flow='path-a-own-account' and artifact.artifact_key='consent.subject-adult'))
      and artifact.body_sha256=encode(extensions.digest(convert_to(artifact.body_markdown,'UTF8'),'sha256'),'hex')
     order by cs.signed_at desc,cs.id limit 1;
    if signature_id is not null and exists(select 1 from public.adult_subject_drafts d where d.subject_id=subject_row.id and d.adult_flow='path-b-subject-esignature') then
     begin
      confirmed_binding:=private.path_b_subject_v1(subject_row.owner_account_id,subject_row.id);
     exception when insufficient_privilege or object_not_in_prerequisite_state then return null;end;
     if confirmed_binding->>'principalId' is distinct from principal_row.id::text
      or confirmed_binding->>'contactReferenceId' is distinct from contact_row.id::text
      or confirmed_binding->>'confirmationSignatureId' is distinct from signature_id::text then return null;end if;
    end if;
    if signature_id is not null then typed:=jsonb_build_object('targetKind','subject','targetId',subject_row.id,
     'principalId',principal_row.id,'principalRevision',principal_row.principal_revision,'contactId',contact_row.id,
     'contactRevision',contact_row.authority_revision,'subjectBindingRevision',subject_row.subject_binding_revision,
     'lifecycleRevision',subject_row.lifecycle_revision,'confirmationSignatureId',signature_id);end if;
   end if;
  elsif intake.kind='genetic-parent-objection' and principal_row.principal_kind='genetic_parent' then
   -- The persisted parent set, original current parent slots and their exact
   -- signatures must all agree. Donors, uploaders and notice recipients alone
   -- never establish the evidenced parent relation.
   for cohort_row in select c.* from public.embryo_cohorts c
    join public.embryo_participant_sets member on member.cohort_id=c.id and member.principal_id=principal_row.id
     and member.set_kind='required_upload_principals' and member.set_revision=c.participant_set_revision and member.revoked_at is null
    where c.status='active' order by c.id for share of c,member loop
    select d.* into draft_row from public.embryo_cohort_drafts d where d.id=cohort_row.draft_id and d.state='finalized' for share;
    select b.* into basis from public.embryo_basis_bindings b where b.cohort_id=cohort_row.id for share;
    if draft_row.id is null or basis.cohort_id is null or basis.basis_revision<>cohort_row.basis_revision
      or basis.participant_set_revision<>cohort_row.participant_set_revision or basis.basis_case<>cohort_row.basis_case then continue;end if;
    select array_agg(parent_id order by parent_id) into parent_set from private.resolve_embryo_basis_authority_v1(draft_row.id) authority,unnest(authority.required_upload_principals) parent_id;
    if not(principal_row.id=any(parent_set)) or parent_set is distinct from
     (select coalesce(array_agg(m.principal_id order by m.principal_id),'{}'::uuid[]) from public.embryo_participant_sets m
      where m.cohort_id=cohort_row.id and m.set_kind='required_upload_principals' and m.set_revision=cohort_row.participant_set_revision and m.revoked_at is null) then continue;end if;
    -- Reuse the complete native finalized artifact/parent/lifecycle checker.
    -- A stale or unsupported basis is an unresolved match, never a no-match.
    begin
     perform private.embryo_ingest_authority_fingerprint_v1(cohort_row.id);
    exception when insufficient_privilege or object_not_in_prerequisite_state then return null;end;
    matches:=matches||jsonb_build_array(jsonb_build_object('targetKind','cohort','targetId',cohort_row.id,
     'principalId',principal_row.id,'principalRevision',principal_row.principal_revision,'contactId',contact_row.id,
     'contactRevision',contact_row.authority_revision,'basisRevision',cohort_row.basis_revision,
     'participantSetRevision',cohort_row.participant_set_revision,'lifecycleRevision',cohort_row.lifecycle_revision,
     'artifactMatrixFingerprint',basis.artifact_matrix_fingerprint));
    current_contacts:=array_append(current_contacts,contact_row.id);
   end loop;
  end if;
  if typed is not null then matches:=matches||jsonb_build_array(typed);current_contacts:=array_append(current_contacts,contact_row.id);end if;
 end loop;
 if cardinality(matched_contacts)<>1 or jsonb_array_length(matches)<>1
  or matched_contacts is distinct from current_contacts then return null;end if;
 return matches->0;
end $$;
revoke all on function private.public_appeal_provisional_binding_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

create function private.public_appeal_target_held_v1(p_kind text,p_target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.public_appeal_provisional_targets hold
  join private.new_public_appeal_intakes intake on intake.id=hold.case_id and intake.state='committed'
  where hold.expires_at>clock_timestamp() and intake.deadline=hold.expires_at
   and ((hold.target_kind=p_kind and hold.target_id=p_target)
    or (p_kind='subject' and hold.target_kind='cohort' and exists(select 1 from public.subjects s where s.id=p_target and s.cohort_id=hold.target_id))
    or (p_kind='family_pair' and exists(select 1 from public.family_pairs pair where pair.id=p_target
     and hold.target_kind='subject' and hold.target_id in(pair.subject_a_id,pair.subject_b_id)))));
$$;
revoke all on function private.public_appeal_target_held_v1(text,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.resource_authorized_v1(uuid,text,uuid,text,bigint,bigint) rename to resource_authorized_before_public_appeal_v1;
revoke all on function private.resource_authorized_before_public_appeal_v1(uuid,text,uuid,text,bigint,bigint) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.resource_authorized_v1(p_account_id uuid,p_target_kind text,p_target_id uuid,p_purpose text,p_lifecycle_revision bigint,p_grant_revision bigint default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_invitation_transitions_v1();
 if private.public_appeal_target_held_v1(p_target_kind,p_target_id) then return false;end if;
 return private.resource_authorized_before_public_appeal_v1(p_account_id,p_target_kind,p_target_id,p_purpose,p_lifecycle_revision,p_grant_revision);
end $$;
revoke all on function private.resource_authorized_v1(uuid,text,uuid,text,bigint,bigint) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.resource_authorized_v1(uuid,text,uuid,text,bigint,bigint) to service_role;

-- Path B's own reads and jobs use this independent checkpoint. Deletion and
-- refusal doors are untouched: a temporary hold must never prevent them.
alter function private.other_adult_mitigation_v1(uuid,uuid,text) rename to other_adult_mitigation_before_public_appeal_v1;
revoke all on function private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.other_adult_mitigation_v1(p_subject_id uuid,p_account_id uuid,p_checkpoint text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_invitation_transitions_v1();
 if private.public_appeal_target_held_v1('subject',p_subject_id) then return jsonb_build_object('decision','deny','gate','appeal-review-pending');end if;
 return private.other_adult_mitigation_before_public_appeal_v1(p_subject_id,p_account_id,p_checkpoint);
end $$;
revoke all on function private.other_adult_mitigation_v1(uuid,uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.export_archive_authority_v1(jsonb,text,uuid) rename to export_archive_authority_before_public_appeal_v1;
revoke all on function private.export_archive_authority_before_public_appeal_v1(jsonb,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.export_archive_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_invitation_transitions_v1();
 if private.public_appeal_target_held_v1(p_target_kind,p_target_id)
  or (p_origin->>'kind'='account' and exists(select 1 from public.subjects subject
   where subject.id=any(private.account_data_subject_ids_v1((p_origin->>'accountId')::uuid))
    and private.public_appeal_target_held_v1('subject',subject.id))) then raise exception using errcode='42501',message='not_found';end if;
 return private.export_archive_authority_before_public_appeal_v1(p_origin,p_target_kind,p_target_id);
end $$;
revoke all on function private.export_archive_authority_v1(jsonb,text,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- Clearing this case's hold cannot lift a restriction created elsewhere.
create function private.clear_closed_public_appeal_hold_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin if new.state='closed' then delete from private.public_appeal_provisional_targets where case_id=new.id;end if;return new;end $$;
create trigger clear_closed_public_appeal_hold after update of state on private.new_public_appeal_intakes
 for each row execute function private.clear_closed_public_appeal_hold_v1();
revoke all on function private.clear_closed_public_appeal_hold_v1() from public,anon,authenticated,service_role,inherit_upload_only;
insert into public.purge_target_stores(target_id,store_name,store_order)
 values('appeal-and-correction-working-packages','private.public_appeal_provisional_targets',14);

alter table private.public_appeal_pending_reviews add column match_state text not null default 'no-contact-match'
 check(match_state in('no-contact-match','unique-current','unresolved-potential')),add column decision_notice_document_id uuid references private.appeal_documents(id) on delete restrict,add column review_revision bigint not null default 1 check(review_revision>0);

create or replace function public.complete_new_public_appeal_evidence_v1(p_session_hash text,p_nonce text,p_documents jsonb,p_affirmed boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;evidence private.new_public_appeal_evidence_state;
 photo_id uuid;authority_id uuid;notice_id uuid;required_ids uuid[];required_keys text[];authority_key text;authority_kind text;document_row private.appeal_documents;
 source_session private.appeal_document_sessions;now_at timestamptz;digest_pair record;potential_match boolean:=false;target_binding jsonb;
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
 elsif intake.kind='access-or-review-appeal' and private.public_appeal_underlying_current_v1(intake.id) then
  authority_kind:=intake.frame#>>'{underlyingDecision,requiredAuthorityKind}';
  authority_key:=case authority_kind when 'appeal-subject-source-control' then 'subjectSourceControlDocumentId'
   when 'appeal-genetic-parent-authority' then 'geneticParentAuthorityDocumentId' end;
 else raise exception using errcode='42501',message='appeal unavailable';end if;
 required_keys:=array['photoIdentityDocumentId',authority_key];
 if intake.kind='access-or-review-appeal' then required_keys:=required_keys||'decisionNoticeDocumentId'::text;end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'object'
  or (select array_agg(key order by key) from jsonb_object_keys(p_documents)key)
    is distinct from (select array_agg(key order by key) from unnest(required_keys)key)
  or p_documents->>'photoIdentityDocumentId' is null or p_documents->>'photoIdentityDocumentId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_documents->>authority_key is null or p_documents->>authority_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 photo_id:=(p_documents->>'photoIdentityDocumentId')::uuid;authority_id:=(p_documents->>authority_key)::uuid;
 if intake.kind='access-or-review-appeal' then
  if p_documents->>'decisionNoticeDocumentId' is null or p_documents->>'decisionNoticeDocumentId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='42501',message='appeal unavailable';end if;
  notice_id:=(p_documents->>'decisionNoticeDocumentId')::uuid;
 end if;
 required_ids:=array[photo_id,authority_id];if notice_id is not null then required_ids:=required_ids||notice_id;end if;
 if (select count(distinct id) from unnest(required_ids)id)<>cardinality(required_ids) then raise exception using errcode='42501',message='appeal unavailable';end if;
 -- IDs are only handles to already finalized bytes in this case, not targets.
 perform 1 from private.appeal_document_sessions ds where ds.id in(select doc.session_id
  from private.appeal_documents doc where doc.id=any(required_ids)) order by ds.id for update;
 perform 1 from private.appeal_documents doc where doc.id=any(required_ids) order by doc.id for update;
 if (select count(*) from private.appeal_documents doc where doc.id=any(required_ids))<>cardinality(required_ids) then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 for document_row in select doc.* from private.appeal_documents doc where doc.id=any(required_ids) order by doc.id loop
  select ds.* into source_session from private.appeal_document_sessions ds where ds.id=document_row.session_id;
  if document_row.intake_id<>intake.id or document_row.document_kind is distinct from
    (case when document_row.id=photo_id then 'appeal-photo-identity' when document_row.id=notice_id then 'appeal-decision-notice' else authority_kind end)
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
 -- lookup. Stale/ambiguous matches remain explicitly unresolved in the private review;
 -- they never become a no-match authority or a target hold.
 for digest_pair in
  select submitted.value as requested_digest,idx.contact_hmac as stored_digest
  from jsonb_each_text(intake.frame->'contactDigests')submitted
  join public.contact_hmac_indexes idx on idx.hmac_key_revision=submitted.key::bigint
  join public.encrypted_contact_references contact on contact.id=idx.contact_reference_id
  where contact.principal_id<>intake.author_principal_id
 loop
  potential_match:=private.appeal_contact_digest_equal_v1(digest_pair.requested_digest,digest_pair.stored_digest) or potential_match;
 end loop;
 target_binding:=private.public_appeal_provisional_binding_v1(intake.id);
 if not private.new_public_appeal_evidence_current_v1(intake.id) or exists(select 1 from private.public_appeal_pending_reviews where case_id=intake.id)
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rights,p_nonce);
 now_at:=clock_timestamp();
 insert into private.public_appeal_pending_reviews(case_id,evidence_revision,reviewer_principal_id,reviewer_revision,purpose_revision,
  photo_document_id,authority_document_id,decision_notice_document_id,created_at,deadline,match_state)
 values(intake.id,evidence.revision,intake.reviewer_principal_id,intake.reviewer_revision,intake.purpose_revision,
  photo_id,authority_id,notice_id,now_at,intake.deadline,case when target_binding is not null then 'unique-current'
   when potential_match then 'unresolved-potential' else 'no-contact-match' end);
 if target_binding is not null then
  insert into private.public_appeal_provisional_targets(case_id,target_kind,target_id,binding,created_at,expires_at)
  values(intake.id,target_binding->>'targetKind',(target_binding->>'targetId')::uuid,target_binding,now_at,intake.deadline);
 end if;
 update private.new_public_appeal_evidence_state set revision=revision+1,state='submitted',submitted_at=now_at where case_id=intake.id;
 update public.rights_sessions set status='consumed',ended_at=now_at,last_activity_at=now_at
  where purpose='appeal-evidence' and target_kind='appeal-case' and target_id=intake.id and status='active';
 perform private.append_legal_audit_event('appeal.evidence.submitted',null,'api.appeal-complete','accepted','{}');
 return jsonb_build_object('status','review_pending','deadline',intake.deadline);
end $$;

-- An appeal document decision is made only by the assigned human under their
-- own live MFA JWT, after every challenged chunk is acknowledged. Browser
-- contact/target fields and owner-created legacy review rows cannot mint it.
create table private.public_appeal_review_downloads(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references private.new_public_appeal_intakes(id) on delete restrict,
 document_id uuid not null references private.appeal_documents(id) on delete cascade,
 reviewer_account_id uuid not null,auth_session_id uuid not null,review_revision bigint not null,evidence_revision bigint not null,
 cookie_hash text not null unique check(cookie_hash~'^[0-9a-f]{64}$'),sha256 text not null,byte_count integer not null,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,last_activity_at timestamptz not null,
 challenge bytea,open_nonce_hash text unique,check(challenge is null or octet_length(challenge)=32)
);
create table private.public_appeal_review_chunks(
 download_id uuid not null references private.public_appeal_review_downloads(id) on delete cascade,
 sequence integer not null check(sequence between 0 and 4),expected_proof text check(expected_proof~'^[0-9a-f]{64}$'),
 acknowledged_at timestamptz,nonce_hash text unique,primary key(download_id,sequence)
);
create table private.public_appeal_document_decisions(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references private.new_public_appeal_intakes(id) on delete restrict,
 document_id uuid references private.appeal_documents(id) on delete set null,original_document_id uuid not null,document_sha256 text not null,
 document_kind text not null,review_revision bigint not null,evidence_revision bigint not null,
 reviewer_principal_id uuid not null,reviewer_account_id uuid not null,auth_session_id uuid not null,
 decision text not null check(decision in('approved','rejected')),reason_ciphertext bytea,nonce_hash text not null unique,
 decided_at timestamptz not null default clock_timestamp(),deadline timestamptz not null,
 decision_reference_hash text not null unique,reference_ciphertext bytea,
 check(reference_ciphertext is null or octet_length(reference_ciphertext)=76),
 unique(case_id,document_id,review_revision),check(octet_length(reason_ciphertext) between 48 and 8128)
);
-- The bound record selects the third required document. Only source-control
-- and genetic-parent rejection producers exist here. No adult permission,
-- embryo-parent legacy rejection or general access decision is adopted.

do $tables$ declare table_name text;begin
 foreach table_name in array array['public_appeal_review_downloads','public_appeal_review_chunks','public_appeal_document_decisions'] loop
  execute format('alter table private.%I enable row level security',table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,inherit_upload_only',table_name);
 end loop;
end $tables$;

create function private.assigned_public_appeal_review_v1(p_case uuid,p_account uuid) returns private.public_appeal_pending_reviews
language plpgsql security definer set search_path='' as $$
declare review private.public_appeal_pending_reviews;intake private.new_public_appeal_intakes;
begin
 perform private.lock_invitation_transitions_v1();
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case for update;
 select pending.* into review from private.public_appeal_pending_reviews pending
  join public.subject_principals actor on actor.id=pending.reviewer_principal_id and actor.account_id=p_account
   and actor.status='active' and actor.principal_kind='reviewer' and actor.principal_revision=pending.reviewer_revision
  where pending.case_id=p_case and pending.state='pending' and pending.deadline>clock_timestamp() for update of pending;
 if review.case_id is null or not private.new_public_appeal_evidence_current_v1(p_case) then return null;end if;
 return review;
end $$;

create function public.read_public_appeal_review_v1(p_case uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewer record;review private.public_appeal_pending_reviews;intake private.new_public_appeal_intakes;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
 review:=private.assigned_public_appeal_review_v1(p_case,reviewer.account_id);
 if review.case_id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=p_case;
 return jsonb_build_object('caseId',p_case,'caseKind',intake.kind,'reviewRevision',review.review_revision,
  'evidenceRevision',review.evidence_revision,'deadline',intake.deadline,'scope',intake.frame->'scope',
  'wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),'workingCiphertextHex',encode(intake.working_ciphertext,'hex'),
  'statementCiphertextHex',(select encode(appeal.statement_ciphertext,'hex') from public.appeal_intakes appeal where appeal.id=p_case),
  'contactCiphertextHex',(select encode(contact.contact_ciphertext,'hex') from public.encrypted_contact_references contact where contact.id=intake.case_contact_id),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('documentId',doc.id,'documentKind',doc.document_kind,
    'sha256',doc.sha256,'decision',(select outcome.decision from private.public_appeal_document_decisions outcome
     where outcome.document_id=doc.id order by outcome.review_revision desc limit 1)) order by doc.document_kind,doc.id)
   from private.appeal_documents doc where doc.intake_id=p_case and doc.id in(review.photo_document_id,review.authority_document_id,review.decision_notice_document_id)),'[]'));
end $$;

create function private.public_appeal_review_download_at_v1(p_session uuid,p_cookie text,p_sequence integer)
returns private.public_appeal_review_downloads language plpgsql security definer set search_path='' as $$
declare download private.public_appeal_review_downloads;reviewer record;review private.public_appeal_pending_reviews;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_cookie is null or p_cookie!~'^[0-9a-f]{64}$' then return null;end if;
 select d.* into download from private.public_appeal_review_downloads d where d.id=p_session and d.cookie_hash=p_cookie
  and d.reviewer_account_id=reviewer.account_id and d.auth_session_id=reviewer.auth_session_id;
 if download.id is null then return null;end if;
 review:=private.assigned_public_appeal_review_v1(download.case_id,reviewer.account_id);
 if review.case_id is null or review.review_revision<>download.review_revision or review.evidence_revision<>download.evidence_revision
  or download.expires_at<=clock_timestamp() or download.last_activity_at<=clock_timestamp()-interval '5 minutes'
  or p_sequence not between 0 and (download.byte_count+3999999)/4000000-1
  or not exists(select 1 from private.appeal_documents doc join private.appeal_document_sessions ds on ds.id=doc.session_id
   where doc.id=download.document_id and doc.intake_id=download.case_id and doc.state='clean' and doc.sha256=download.sha256
    and doc.byte_count=download.byte_count and doc.scan_verdict='OK' and doc.scanned_sha256=doc.sha256
    and doc.object_deleted_at is null and ds.wrapped_document_key is not null
    and not exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=doc.id)) then return null;end if;
 select d.* into download from private.public_appeal_review_downloads d where d.id=download.id for update;
 return download;
end $$;

create function public.open_public_appeal_review_download_v1(p_document_id uuid,p_cookie_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewer record;review private.public_appeal_pending_reviews;doc private.appeal_documents;download private.public_appeal_review_downloads;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select document.* into doc from private.appeal_documents document where document.id=p_document_id;
 review:=private.assigned_public_appeal_review_v1(doc.intake_id,reviewer.account_id);
 select document.* into doc from private.appeal_documents document where document.id=p_document_id for update;
 if review.case_id is null or not(doc.id=any(array_remove(array[review.photo_document_id,review.authority_document_id,review.decision_notice_document_id],null)))
  or doc.state<>'clean' or doc.object_deleted_at is not null or doc.scanned_sha256<>doc.sha256
  or exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=doc.id)
  or not exists(select 1 from private.appeal_document_sessions ds where ds.id=doc.session_id and ds.wrapped_document_key is not null) then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 insert into private.public_appeal_review_downloads(case_id,document_id,reviewer_account_id,auth_session_id,review_revision,
  evidence_revision,cookie_hash,sha256,byte_count,expires_at,last_activity_at)
 values(doc.intake_id,doc.id,reviewer.account_id,reviewer.auth_session_id,review.review_revision,review.evidence_revision,
  p_cookie_hash,doc.sha256,doc.byte_count,least(clock_timestamp()+interval '1 hour',review.deadline),clock_timestamp()) returning * into download;
 return jsonb_build_object('session',download.id,'sizeBytes',doc.byte_count,'sha256',doc.sha256,
  'chunkCount',(doc.byte_count+3999999)/4000000,'mediaType',doc.media_type,'documentKind',doc.document_kind);
end $$;

create function public.authorize_public_appeal_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare download private.public_appeal_review_downloads;doc private.appeal_documents;
begin
 download:=private.public_appeal_review_download_at_v1(p_session_id,p_cookie_hash,p_sequence);
 if download.id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
 select document.* into doc from private.appeal_documents document where document.id=download.document_id;
 update private.public_appeal_review_downloads set last_activity_at=clock_timestamp() where id=download.id;
 return jsonb_build_object('documentId',doc.id,'reviewId',doc.intake_id,'objectKey',doc.object_key,'sha256',doc.sha256,
  'byteCount',doc.byte_count,'wrappedDataKey',(select encode(ds.wrapped_document_key,'hex') from private.appeal_document_sessions ds where ds.id=doc.session_id),
  'receiptChallenge',case when download.challenge is null then null else encode(extensions.digest(download.challenge||convert_to(p_sequence::text,'UTF8'),'sha256'),'hex') end);
end $$;
create function public.open_public_appeal_review_receipt_v1(p_session_id uuid,p_cookie_hash text,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare download private.public_appeal_review_downloads;sequence_no integer;
begin
 download:=private.public_appeal_review_download_at_v1(p_session_id,p_cookie_hash,0);
 if download.id is null or download.challenge is not null or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 update private.public_appeal_review_downloads set challenge=extensions.gen_random_bytes(32),open_nonce_hash=p_nonce_hash
  where id=download.id returning * into download;
 for sequence_no in 0..(download.byte_count+3999999)/4000000-1 loop
  insert into private.public_appeal_review_chunks(download_id,sequence) values(download.id,sequence_no);
 end loop;
 return jsonb_build_object('session',download.id,'chunks',(select jsonb_agg(jsonb_build_object('sequence',c.sequence,'challenge',
  encode(extensions.digest(download.challenge||convert_to(c.sequence::text,'UTF8'),'sha256'),'hex')) order by c.sequence)
  from private.public_appeal_review_chunks c where c.download_id=download.id));
end $$;
-- This server callback cannot replace the reviewer's own current authorization
-- or client ACK. It records a proof only after the service decrypts/validates
-- the whole real object, then hashes the random challenge plus actual chunk.
create function public.prepare_public_appeal_review_chunk_receipt_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_expected_proof text)
returns void language plpgsql security definer set search_path='' as $$
declare download private.public_appeal_review_downloads;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_expected_proof is null or p_expected_proof!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 perform private.lock_invitation_transitions_v1();
 select d.* into download from private.public_appeal_review_downloads d where d.id=p_session_id and d.cookie_hash=p_cookie_hash for update;
 if download.id is null or download.challenge is null or download.expires_at<=clock_timestamp() or download.last_activity_at<=clock_timestamp()-interval '5 minutes'
  or not private.new_public_appeal_evidence_current_v1(download.case_id)
  or not exists(select 1 from private.public_appeal_pending_reviews review where review.case_id=download.case_id
    and review.review_revision=download.review_revision and review.evidence_revision=download.evidence_revision
    and review.state='pending' and review.deadline>clock_timestamp()
    and exists(select 1 from public.subject_principals actor where actor.id=review.reviewer_principal_id
      and actor.account_id=download.reviewer_account_id and actor.principal_revision=review.reviewer_revision and actor.status='active' and actor.principal_kind='reviewer'))
  or not exists(select 1 from private.appeal_documents doc join private.appeal_document_sessions ds on ds.id=doc.session_id
    where doc.id=download.document_id and doc.intake_id=download.case_id and doc.sha256=download.sha256
     and doc.byte_count=download.byte_count and doc.state='clean' and doc.object_deleted_at is null and ds.wrapped_document_key is not null)
  or not exists(select 1 from auth.sessions session join auth.users account on account.id=session.user_id
    join private.claim_reviewers reviewer on reviewer.account_id=account.id and reviewer.status='active'
    where session.id=download.auth_session_id and session.user_id=download.reviewer_account_id
     and account.deleted_at is null and (account.banned_until is null or account.banned_until<=clock_timestamp())
     and (session.not_after is null or session.not_after>clock_timestamp())) then raise exception using errcode='42501',message='appeal unavailable';end if;
 update private.public_appeal_review_chunks set expected_proof=p_expected_proof
  where download_id=download.id and sequence=p_sequence and acknowledged_at is null
   and (expected_proof is null or expected_proof=p_expected_proof);
 if not found then raise exception using errcode='42501',message='appeal unavailable';end if;
end $$;
create function public.acknowledge_public_appeal_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_proof text,p_nonce_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare download private.public_appeal_review_downloads;
begin
 download:=private.public_appeal_review_download_at_v1(p_session_id,p_cookie_hash,p_sequence);
 if download.id is null or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='appeal unavailable';end if;
 update private.public_appeal_review_chunks set acknowledged_at=clock_timestamp(),nonce_hash=p_nonce_hash
  where download_id=download.id and sequence=p_sequence and acknowledged_at is null and expected_proof=p_proof and expected_proof is not null;
 if not found then raise exception using errcode='42501',message='appeal unavailable';end if;
end $$;

create function public.decide_public_appeal_document_v1(p_document uuid,p_sha256 text,p_review_revision bigint,p_decision text,p_nonce_hash text,p_reason_ciphertext bytea,p_reference_hash text,p_reference_ciphertext bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reviewer record;review private.public_appeal_pending_reviews;doc private.appeal_documents;intake private.new_public_appeal_intakes;
 decision_id uuid;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_decision is null or p_decision not in('approved','rejected')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 48 and 8128
  or p_reference_hash is null or p_reference_hash!~'^[0-9a-f]{64}$' or p_reference_ciphertext is null or octet_length(p_reference_ciphertext)<>76 then
  raise exception using errcode='42501',message='appeal unavailable';end if;
 select document.* into doc from private.appeal_documents document where document.id=p_document;
 review:=private.assigned_public_appeal_review_v1(doc.intake_id,reviewer.account_id);
 select document.* into doc from private.appeal_documents document where document.id=p_document for update;
 if review.case_id is null or p_review_revision is distinct from review.review_revision or p_sha256 is distinct from doc.sha256
  or not(doc.id=any(array_remove(array[review.photo_document_id,review.authority_document_id,review.decision_notice_document_id],null))) or doc.state<>'clean' or doc.object_deleted_at is not null
  or exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=doc.id)
  or not exists(select 1 from private.public_appeal_review_downloads d where d.document_id=doc.id
    and d.reviewer_account_id=reviewer.account_id and d.auth_session_id=reviewer.auth_session_id
    and d.review_revision=review.review_revision and d.evidence_revision=review.evidence_revision and d.sha256=doc.sha256
    and d.expires_at>clock_timestamp() and d.last_activity_at>clock_timestamp()-interval '5 minutes'
    and (select count(*) from private.public_appeal_review_chunks chunk where chunk.download_id=d.id and chunk.acknowledged_at is not null)
     =(doc.byte_count+3999999)/4000000) then raise exception using errcode='42501',message='appeal unavailable';end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=doc.intake_id;
 insert into private.public_appeal_document_decisions(case_id,document_id,original_document_id,document_sha256,document_kind,review_revision,evidence_revision,
  reviewer_principal_id,reviewer_account_id,auth_session_id,decision,reason_ciphertext,nonce_hash,deadline,decision_reference_hash,reference_ciphertext)
 values(doc.intake_id,doc.id,doc.id,doc.sha256,doc.document_kind,review.review_revision,review.evidence_revision,
  review.reviewer_principal_id,reviewer.account_id,reviewer.auth_session_id,p_decision,p_reason_ciphertext,p_nonce_hash,intake.deadline,
  p_reference_hash,p_reference_ciphertext) returning id into decision_id;
 update private.public_appeal_pending_reviews set review_revision=review_revision+1,evidence_revision=evidence_revision+1 where case_id=review.case_id;
 update private.new_public_appeal_evidence_state set revision=revision+1 where case_id=review.case_id;
 -- This rejection has no target disposition. Its source/hash/revisions may
 -- later be appealed; neither it nor its review approval grants any right.
 if p_decision='rejected' then
  update private.appeal_document_sessions set wrapped_document_key=null,document_key_shredded_at=clock_timestamp() where id=doc.session_id;
  delete from private.public_appeal_provisional_targets where case_id=doc.intake_id;
 end if;
 perform private.append_legal_audit_event('appeal.document.reviewed',null,'api.legal-evidence-review',
  case when p_decision='approved' then 'accepted' else 'refused' end,jsonb_build_object('decision',p_decision));
 return jsonb_build_object('documentId',doc.id,'decision',p_decision,'reviewRevision',review.review_revision+1);
end $$;

-- Typed transport dispatch is authorized by the reviewer JWT. It returns no
-- object metadata and cannot turn a denied claim download into another case.
create function public.review_document_transport_v1(p_session uuid,p_cookie text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session and d.cookie_hash=p_cookie) then
  if (private.public_appeal_review_download_at_v1(p_session,p_cookie,0)).id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
  return 'appeal';
 end if;
 perform public.authorize_claim_review_chunk_v1(p_session,p_cookie,0);return 'claim';
end $$;

do $grants$ declare signature text;begin
 foreach signature in array array['assigned_public_appeal_review_v1(uuid,uuid)','public_appeal_review_download_at_v1(uuid,text,integer)'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated,service_role,inherit_upload_only';
 end loop;
 foreach signature in array array['read_public_appeal_review_v1(uuid)','open_public_appeal_review_download_v1(uuid,text)',
  'authorize_public_appeal_review_chunk_v1(uuid,text,integer)','open_public_appeal_review_receipt_v1(uuid,text,text)',
  'acknowledge_public_appeal_review_chunk_v1(uuid,text,integer,text,text)','decide_public_appeal_document_v1(uuid,text,bigint,text,text,bytea,text,bytea)',
  'review_document_transport_v1(uuid,text)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated,service_role,inherit_upload_only';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $grants$;
revoke all on function public.prepare_public_appeal_review_chunk_receipt_v1(uuid,text,integer,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_public_appeal_review_chunk_receipt_v1(uuid,text,integer,text) to service_role;
insert into public.purge_target_stores(target_id,store_name,store_order) values
 ('appeal-and-correction-working-packages','private.public_appeal_review_downloads',15),
 ('appeal-and-correction-working-packages','private.public_appeal_review_chunks',16),
 ('appeal-and-correction-working-packages','private.public_appeal_document_decisions',17);

-- Existing ingest/worker consumers consult this native checkpoint. A hold
-- cancels new data processing; it does not modify the source or its authority.
alter function private.embryo_ingest_binding_failure_v1(uuid) rename to embryo_ingest_binding_failure_before_appeal_v1;
revoke all on function private.embryo_ingest_binding_failure_before_appeal_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.embryo_ingest_binding_failure_v1(p_session_id uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform private.lock_invitation_transitions_v1();
 if exists(select 1 from public.embryo_ingest_sessions session where session.id=p_session_id
  and private.public_appeal_target_held_v1('cohort',session.cohort_id)) then return 'stale-binding';end if;
 return private.embryo_ingest_binding_failure_before_appeal_v1(p_session_id);
end $$;
revoke all on function private.embryo_ingest_binding_failure_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- Dispatch by an exact native document/session identity, never by a failed
-- authorization. Retain the established claim ABI and all its checks.
-- The app's two default-off domains are checked before creating a native
-- session. Classification itself requires the actual own-MFA assignment and
-- current complete document, and cannot disclose a foreign document's domain.
create function public.review_document_domain_v1(p_document uuid) returns text
language plpgsql security definer set search_path='' as $$
declare reviewer record;appeal_review private.public_appeal_pending_reviews;
 claim_review private.claim_reviews;claim_document private.claim_documents;case_id uuid;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null then raise exception using errcode='42501',message='review unavailable';end if;
 if exists(select 1 from private.appeal_documents document where document.id=p_document) then
  if exists(select 1 from private.claim_documents document where document.id=p_document) then
   raise exception using errcode='42501',message='review unavailable';end if;
  select document.intake_id into case_id from private.appeal_documents document where document.id=p_document;
  appeal_review:=private.assigned_public_appeal_review_v1(case_id,reviewer.account_id);
  if appeal_review.case_id is null or not exists(select 1 from private.appeal_documents document
   join private.appeal_document_sessions session on session.id=document.session_id where document.id=p_document
    and document.id=any(array_remove(array[appeal_review.photo_document_id,appeal_review.authority_document_id,appeal_review.decision_notice_document_id],null))
    and document.state='clean' and document.object_deleted_at is null and document.scan_verdict='OK'
    and document.scanned_sha256=document.sha256 and session.wrapped_document_key is not null
    and not exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=document.id)) then
   raise exception using errcode='42501',message='review unavailable';end if;
  return 'appeal';
 end if;
 select review.id into case_id from private.claim_reviews review where review.photo_document_id=p_document or review.birth_record_document_id=p_document;
 claim_review:=private.assigned_claim_review_v1(case_id,reviewer.account_id);
 if claim_review.id is null or claim_review.state not in('document_review_pending','more_information_required','approved_pending_owner_notice') then
  raise exception using errcode='42501',message='review unavailable';end if;
 claim_document:=private.claim_review_document_v1(claim_review,p_document);
 if claim_document.id is null then raise exception using errcode='42501',message='review unavailable';end if;
 return 'claim';
end $$;
revoke all on function public.review_document_domain_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.review_document_domain_v1(uuid) to authenticated;

alter function public.open_claim_review_download_v1(uuid,text) rename to open_claim_review_download_before_appeal_v1;
revoke all on function public.open_claim_review_download_before_appeal_v1(uuid,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.open_claim_review_download_v1(p_document_id uuid,p_cookie_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.appeal_documents doc where doc.id=p_document_id) then
  return public.open_public_appeal_review_download_v1(p_document_id,p_cookie_hash);end if;
 return public.open_claim_review_download_before_appeal_v1(p_document_id,p_cookie_hash);
end $$;
alter function public.authorize_claim_review_chunk_v1(uuid,text,integer) rename to authorize_claim_review_chunk_before_appeal_v1;
revoke all on function public.authorize_claim_review_chunk_before_appeal_v1(uuid,text,integer) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.authorize_claim_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session_id) then
  return public.authorize_public_appeal_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence)||jsonb_build_object('transport','appeal');end if;
 return public.authorize_claim_review_chunk_before_appeal_v1(p_session_id,p_cookie_hash,p_sequence);
end $$;
alter function public.open_claim_review_receipt_v1(uuid,text,text) rename to open_claim_review_receipt_before_appeal_v1;
revoke all on function public.open_claim_review_receipt_before_appeal_v1(uuid,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.open_claim_review_receipt_v1(p_session_id uuid,p_cookie_hash text,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session_id) then
  return public.open_public_appeal_review_receipt_v1(p_session_id,p_cookie_hash,p_nonce_hash);end if;
 return public.open_claim_review_receipt_before_appeal_v1(p_session_id,p_cookie_hash,p_nonce_hash);
end $$;
alter function public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text) rename to prepare_claim_review_chunk_receipt_before_appeal_v1;
revoke all on function public.prepare_claim_review_chunk_receipt_before_appeal_v1(uuid,text,integer,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.prepare_claim_review_chunk_receipt_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_expected_proof text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session_id) then
  perform public.prepare_public_appeal_review_chunk_receipt_v1(p_session_id,p_cookie_hash,p_sequence,p_expected_proof);return;end if;
 perform public.prepare_claim_review_chunk_receipt_before_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_expected_proof);
end $$;
alter function public.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text) rename to acknowledge_claim_review_chunk_before_appeal_v1;
revoke all on function public.acknowledge_claim_review_chunk_before_appeal_v1(uuid,text,integer,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.acknowledge_claim_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_proof text,p_nonce_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session_id) then
  perform public.acknowledge_public_appeal_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_proof,p_nonce_hash);return;end if;
 perform public.acknowledge_claim_review_chunk_before_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_proof,p_nonce_hash);
end $$;
revoke all on function public.open_claim_review_download_v1(uuid,text),public.authorize_claim_review_chunk_v1(uuid,text,integer),
 public.open_claim_review_receipt_v1(uuid,text,text),public.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.open_claim_review_download_v1(uuid,text),public.authorize_claim_review_chunk_v1(uuid,text,integer),
 public.open_claim_review_receipt_v1(uuid,text,text),public.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text) to authenticated;
revoke all on function public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text) to service_role;

-- Only this producer's actual rejected documentary decision can bind a new
-- access appeal. Legacy legal-review IDs, free target references and contact
-- ownership never satisfy it. The recipient comparison stays inside PG.
create function private.public_appeal_underlying_binding_v1(p_reference_hash text,p_contact_digests jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare outcome private.public_appeal_document_decisions;source private.new_public_appeal_intakes;
 contact public.encrypted_contact_references;matching boolean:=false;pair record;
begin
 if p_reference_hash is null or p_reference_hash!~'^[0-9a-f]{64}$' or jsonb_typeof(p_contact_digests) is distinct from 'object' then return null;end if;
 perform private.lock_invitation_transitions_v1();
 select d.* into outcome from private.public_appeal_document_decisions d where d.decision_reference_hash=p_reference_hash
  and d.decision='rejected' and d.document_kind in('appeal-subject-source-control','appeal-genetic-parent-authority') for share;
 if outcome.id is null then return null;end if;
 select i.* into source from private.new_public_appeal_intakes i where i.id=outcome.case_id and i.state='committed'
  and i.deadline>clock_timestamp() and i.wrapped_case_key is not null for share;
 if source.id is null or outcome.deadline<>source.deadline
  or not exists(select 1 from private.public_appeal_document_decisions photo where photo.case_id=source.id
    and photo.document_kind='appeal-photo-identity' and photo.decision='approved')
  or exists(select 1 from private.public_appeal_document_decisions newer where newer.case_id=source.id
    and newer.document_kind=outcome.document_kind and newer.decided_at>outcome.decided_at) then return null;end if;
 select c.* into contact from public.encrypted_contact_references c where c.id=source.case_contact_id and c.status='current'
  and c.principal_id=source.author_principal_id and c.authority_revision=1 and c.contact_ciphertext is not null for share;
 if contact.id is null then return null;end if;
 for pair in select submitted.value,idx.contact_hmac from jsonb_each_text(p_contact_digests) submitted
  join public.contact_hmac_indexes idx on idx.hmac_key_revision=submitted.key::bigint
   and idx.contact_reference_id=contact.id and idx.status='current' and idx.expires_at>clock_timestamp() loop
  matching:=private.appeal_contact_digest_equal_v1(pair.value,pair.contact_hmac) or matching;
 end loop;
 if not matching then return null;end if;
 return jsonb_build_object('decisionId',outcome.id,'sourceCaseId',outcome.case_id,'decisionRevision',outcome.review_revision,
  'evidenceRevision',outcome.evidence_revision,'sourceReviewerPrincipalId',outcome.reviewer_principal_id,
  'decisionReferenceHash',p_reference_hash,'requiredAuthorityKind',outcome.document_kind,
  'decisionKind',case outcome.document_kind when 'appeal-subject-source-control' then 'subject-source-control-review-rejection'
   else 'genetic-parent-authority-review-rejection' end,'sourceDeadline',source.deadline);
end $$;
revoke all on function private.public_appeal_underlying_binding_v1(text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
create function private.public_appeal_underlying_current_v1(p_case uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare intake private.new_public_appeal_intakes;binding jsonb;
begin
 select i.* into intake from private.new_public_appeal_intakes i where i.id=p_case;
 if intake.id is null or intake.kind<>'access-or-review-appeal' or intake.frame->'underlyingDecision' is null then return false;end if;
 binding:=private.public_appeal_underlying_binding_v1(intake.frame#>>'{underlyingDecision,decisionReferenceHash}',intake.frame->'contactDigests');
 return binding is not null and binding=intake.frame->'underlyingDecision'
  and intake.reviewer_principal_id<>(binding->>'sourceReviewerPrincipalId')::uuid;
end $$;
revoke all on function private.public_appeal_underlying_current_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

create function public.prepare_new_public_appeal_v1(p_kind text,p_payload_digest text,p_form_nonce_hash text,
 p_contact_digests jsonb,p_identifier_digests jsonb,p_network_digests jsonb,p_decision_reference_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare config private.new_public_appeal_config;reviewer record;contacts jsonb;identifiers jsonb;networks jsonb;
 keys jsonb:='{}';pair record;allowed boolean;frame jsonb;signature text;underlying jsonb;
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
 if p_kind='access-or-review-appeal' then
  underlying:=private.public_appeal_underlying_binding_v1(p_decision_reference_hash,contacts);
  if underlying is null then return null;end if;
 elsif p_decision_reference_hash is not null then return null;end if;
 select r.* into reviewer from private.new_public_appeal_reviewers r
  join public.subject_principals actor on actor.id=r.principal_id and actor.principal_revision=r.principal_revision
   and actor.principal_kind='reviewer' and actor.status='active'
  join private.claim_reviewers assignment on assignment.account_id=actor.account_id and assignment.status='active'
  where r.active and (underlying is null or r.principal_id<>(underlying->>'sourceReviewerPrincipalId')::uuid) order by r.principal_id limit 1 for share of r,actor,assignment;
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
 if underlying is not null then frame:=frame||jsonb_build_object('underlyingDecision',underlying);end if;
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

revoke all on function public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb,text) to service_role;
create or replace function public.prepare_new_public_appeal_v1(p_kind text,p_payload_digest text,p_form_nonce_hash text,
 p_contact_digests jsonb,p_identifier_digests jsonb,p_network_digests jsonb) returns jsonb
language sql security definer set search_path='' set lock_timeout='250ms' as $$
 select public.prepare_new_public_appeal_v1(p_kind,p_payload_digest,p_form_nonce_hash,p_contact_digests,p_identifier_digests,p_network_digests,null);
$$;
alter function public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb) rename to commit_new_public_appeal_before_review_v1;
revoke all on function public.commit_new_public_appeal_before_review_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
create function public.commit_new_public_appeal_v1(p_expected jsonb,p_payload_digest text,p_nonce_hash text,
 p_wrapped_key bytea,p_statement bytea,p_working bytea,p_contact bytea,p_quota_keys jsonb) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 perform private.lock_invitation_transitions_v1();
 if p_expected#>>'{frame,scope,intakeKind}'='access-or-review-appeal' and not private.public_appeal_underlying_current_v1((p_expected#>>'{frame,scope,caseId}')::uuid)
  then raise exception using errcode='42501',message='not_found';end if;
 return public.commit_new_public_appeal_before_review_v1(p_expected,p_payload_digest,p_nonce_hash,p_wrapped_key,p_statement,p_working,p_contact,p_quota_keys);
end $$;
revoke all on function public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb) to service_role;

create or replace function private.new_public_appeal_evidence_current_v1(p_case uuid) returns boolean
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
  where intake.id=p_case and (intake.kind in('subject-objection','genetic-parent-objection') or (intake.kind='access-or-review-appeal' and private.public_appeal_underlying_current_v1(intake.id))) and intake.state='committed' and octet_length(intake.wrapped_case_key)=72
   and intake.working_ciphertext is not null and intake.deadline=intake.submitted_at+interval '30 days'
   and intake.deadline>clock_timestamp());
$$;


create or replace function public.new_public_appeal_evidence_view_v1(p_session_hash text) returns jsonb
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
  when 'access-or-review-appeal' then jsonb_build_array('appeal-photo-identity','appeal-decision-notice',intake.frame#>>'{underlyingDecision,requiredAuthorityKind}') end;
 return jsonb_build_object('caseKind',intake.kind,'deadline',intake.deadline,'documentKinds',kinds,
  'evidenceState','collecting','completionAvailable',(intake.kind in('subject-objection','genetic-parent-objection') or (intake.kind='access-or-review-appeal' and private.public_appeal_underlying_current_v1(intake.id))),
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

create or replace function public.open_public_appeal_document_v1(p_session_hash text,p_nonce text,p_document_kind text,p_media_type text,
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
  when 'access-or-review-appeal' then array['appeal-photo-identity','appeal-decision-notice',intake.frame#>>'{underlyingDecision,requiredAuthorityKind}'] end;
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


create function private.guard_public_appeal_document_decision_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (to_jsonb(new)-array['document_id','reason_ciphertext','reference_ciphertext']) is distinct from (to_jsonb(old)-array['document_id','reason_ciphertext','reference_ciphertext'])
  or (new.document_id is distinct from old.document_id and new.document_id is not null)
  or (new.reason_ciphertext is distinct from old.reason_ciphertext and not(new.reason_ciphertext is null
   and exists(select 1 from private.new_public_appeal_intakes intake where intake.id=new.case_id and intake.state='closed')))
  or (new.reference_ciphertext is distinct from old.reference_ciphertext and not(new.reference_ciphertext is null
   and exists(select 1 from private.new_public_appeal_intakes intake where intake.id=new.case_id and intake.state='closed')))
  then raise exception using errcode='42501',message='appeal unavailable';end if;
 return new;
end $$;
create trigger guard_public_appeal_document_decision before update on private.public_appeal_document_decisions
 for each row execute function private.guard_public_appeal_document_decision_v1();
create function private.shred_closed_public_appeal_review_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='closed' then
  update private.public_appeal_document_decisions set reason_ciphertext=null,reference_ciphertext=null where case_id=new.id;
  delete from private.public_appeal_review_downloads where case_id=new.id;
 end if;return new;
end $$;
create trigger shred_closed_public_appeal_review after update of state on private.new_public_appeal_intakes
 for each row execute function private.shred_closed_public_appeal_review_v1();
revoke all on function private.guard_public_appeal_document_decision_v1(),private.shred_closed_public_appeal_review_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

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
      and (d.state = 'refused' or not private.new_public_appeal_evidence_current_v1(i.id)
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
    and not exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=d.id and outcome.decision='rejected'))
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

create function public.read_public_appeal_document_context_v1(p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare case_id uuid;
begin
 select doc.intake_id into case_id from private.appeal_documents doc where doc.id=p_document;
 if case_id is null then raise exception using errcode='42501',message='appeal unavailable';end if;
 return public.read_public_appeal_review_v1(case_id);
end $$;
revoke all on function public.read_public_appeal_document_context_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_document_context_v1(uuid) to authenticated;

-- This read-only notice uses only the already verified case's original session.
-- Consumed upload authority stays consumed. No clock, token, target or account
-- authority is renewed; late/asynchronous notification remains closed.
create function public.read_public_appeal_decision_notice_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rights public.rights_sessions;intake private.new_public_appeal_intakes;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return null;end if;
 perform private.lock_invitation_transitions_v1();
 select rs.* into rights from public.rights_sessions rs where rs.session_hash=p_session_hash and rs.purpose='appeal-evidence'
  and rs.target_kind='appeal-case' and rs.status='consumed' and rs.ended_at is not null
  and rs.expires_at>clock_timestamp() and rs.expires_at<=rs.created_at+interval '60 minutes'
  and rs.last_activity_at>clock_timestamp()-interval '15 minutes' for share;
 if rights.id is null or not private.new_public_appeal_evidence_current_v1(rights.target_id) then return null;end if;
 select source.* into intake from private.new_public_appeal_intakes source where source.id=rights.target_id and source.author_principal_id=rights.principal_id for share;
 if intake.id is null or not exists(select 1 from public.token_hashes h where h.id=rights.token_hash_id
  and h.candidate_id=intake.candidate_id and h.status='consumed' and h.ended_at is not null and h.token_revision=1) then return null;end if;
 return jsonb_build_object('scope',intake.frame->'scope','wrappedCaseKeyHex',encode(intake.wrapped_case_key,'hex'),
  'decisions',coalesce((select jsonb_agg(jsonb_build_object('documentKind',decision.document_kind,'decision',decision.decision,
    'nonceHash',decision.nonce_hash,'documentId',decision.original_document_id,'referenceCiphertextHex',encode(decision.reference_ciphertext,'hex'),
    'referenceHash',decision.decision_reference_hash) order by decision.review_revision)
   from private.public_appeal_document_decisions decision where decision.case_id=intake.id
    and decision.reference_ciphertext is not null),'[]')));
end $$;
revoke all on function public.read_public_appeal_decision_notice_v1(text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_public_appeal_decision_notice_v1(text) to service_role;
