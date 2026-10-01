-- A closed prerequisite for the registered keyless notice/release phase.
-- No API role may start/complete this phase yet. It supplies real bounded
-- storage/clock transactions for rehearsal, without opening positive native
-- approval before the objection and separate fresh release doors are ready.
-- No new store, root secret, retention ID or phase is introduced.
alter table public.future_person_claim_review_packages
  add column review_id uuid unique references private.claim_reviews(id) on delete restrict,
  add column subject_id uuid references public.subjects(id) on delete restrict,
  add column documentary_at timestamptz,
  add column delivery_deadline timestamptz,
  add column authority_binding jsonb,
  add column comparison_ciphertext bytea,
  add column wrapped_comparison_key bytea,
  add column claimant_delivery_reference_id uuid references public.encrypted_contact_references(id) on delete restrict,
  add column comparison_key_shredded_at timestamptz,
  add column terminal_code text check(terminal_code in('notice_delivery_failed','claim_deadline_expired','record_state_changed','refused','withdrawn'));
alter table public.future_person_claim_notices
  add column owner_account_id uuid references auth.users(id) on delete restrict,
  add column owner_principal_id uuid references public.subject_principals(id) on delete restrict,
  add column owner_authority_revision bigint check(owner_authority_revision>0),
  add column candidate_id uuid references public.token_candidates(id) on delete restrict,
  add column provider_attempt_id uuid references public.mail_provider_attempts(id) on delete restrict,
  add column delivered_at timestamptz,
  add column notice_deadline timestamptz;

alter table private.claim_reviews drop constraint claim_reviews_state_check;
alter table private.claim_reviews add constraint claim_reviews_state_check check(state in(
  'document_review_pending','more_information_required','release_queued','approved_pending_owner_notice','refused','closed'));
alter table private.claim_reviews drop constraint claim_reviews_check3;
alter table private.claim_reviews add constraint claim_reviews_embryo_selector_shape check(
  (case_kind in('record_key','unclaimed_keyless'))=(matched_embryo_id is not null));

alter table public.future_person_claim_review_packages add constraint keyless_minimum_package_shape check((
  review_id is null or (
    review_id=claim_id and subject_id is not null and documentary_at is not null
    and delivery_deadline=documentary_at+interval '24 hours'
    and delivery_deadline<expires_at and jsonb_typeof(authority_binding)='object'
    and claimant_delivery_reference_id is not null
    and ((state in('open','objected') and octet_length(comparison_ciphertext) between 29 and 16384
      and octet_length(wrapped_comparison_key)=72 and comparison_key_shredded_at is null and terminal_code is null)
      or (state in('approved','refused','closed') and comparison_ciphertext is null and wrapped_comparison_key is null
        and comparison_key_shredded_at is not null)))) is true);
alter table public.future_person_claim_notices add constraint keyless_owner_notice_shape check((
  owner_account_id is null or (notice_kind='owner_notice' and owner_principal_id is not null
    and owner_authority_revision is not null and candidate_id is not null
    and ((delivered_at is null and notice_deadline is null and provider_attempt_id is null)
      or (delivered_at is not null and notice_deadline=delivered_at+interval '30 days' and provider_attempt_id is not null)))) is true);

create function private.guard_keyless_notice_package_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.review_id is null then return new; end if;
  if (new.id,new.claim_id,new.review_id,new.subject_id,new.package_revision,new.package_fingerprint,
      new.documentary_at,new.delivery_deadline,new.expires_at,new.created_at,new.authority_binding,new.claimant_delivery_reference_id)
    is distinct from (old.id,old.claim_id,old.review_id,old.subject_id,old.package_revision,old.package_fingerprint,
      old.documentary_at,old.delivery_deadline,old.expires_at,old.created_at,old.authority_binding,old.claimant_delivery_reference_id)
    or (old.state in('approved','refused','closed') and to_jsonb(new) is distinct from to_jsonb(old))
    or (new.state in('open','objected') and (new.comparison_ciphertext,new.wrapped_comparison_key)
      is distinct from (old.comparison_ciphertext,old.wrapped_comparison_key))
    or (old.state='objected' and new.state='open')
  then raise exception using errcode='55000',message='immutable claim review package'; end if;
  return new;
end $$;
create trigger keyless_notice_package_immutable before update on public.future_person_claim_review_packages
  for each row execute function private.guard_keyless_notice_package_v1();
create function private.guard_keyless_owner_notice_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.owner_account_id is null then return new; end if;
  if (new.id,new.claim_id,new.outbox_id,new.notice_kind,new.notice_revision,new.created_at,
      new.owner_account_id,new.owner_principal_id,new.owner_authority_revision,new.candidate_id)
    is distinct from (old.id,old.claim_id,old.outbox_id,old.notice_kind,old.notice_revision,old.created_at,
      old.owner_account_id,old.owner_principal_id,old.owner_authority_revision,old.candidate_id)
    or (old.delivered_at is not null and (new.delivered_at,new.notice_deadline,new.provider_attempt_id)
      is distinct from (old.delivered_at,old.notice_deadline,old.provider_attempt_id))
  then raise exception using errcode='55000',message='immutable owner notice'; end if;
  return new;
end $$;
create trigger keyless_owner_notice_immutable before update on public.future_person_claim_notices
  for each row execute function private.guard_keyless_owner_notice_v1();

-- Both stores are reached only through exact definer transactions. Their
-- inherited generic service-table grants must not expose a new wrapped key.
revoke all on public.future_person_claim_review_packages,public.future_person_claim_notices
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Documentary time is unchanged for every old branch. Only a genuinely
-- transferred, still-bounded package keeps its two exact documents retained
-- after day30; it grants no generic review, claimant or download access.
create or replace function private.claim_review_open_v1(r private.claim_reviews)
returns boolean language sql stable security definer set search_path='' as $$
  select ((r).state in('document_review_pending','more_information_required','release_queued')
    and (r).deadline>clock_timestamp()) or ((r).state='approved_pending_owner_notice'
    and exists(select 1 from public.future_person_claim_review_packages k
      where k.review_id=(r).id and k.claim_id=(r).id and k.state in('open','objected')
        and k.expires_at=(r).created_at+interval '62 days' and k.expires_at>clock_timestamp()
        and k.documentary_at<(r).deadline and k.wrapped_comparison_key is not null));
$$;
revoke all on function private.claim_review_open_v1(private.claim_reviews)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- This is current authority, not merely an ownership lookup or old receipt.
-- No candidate search, comparison ciphertext, document, or contact is returned.
create function private.keyless_owner_notice_current_v1(p_claim uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.future_person_claim_review_packages k
    join public.future_person_claims f on f.id=k.claim_id and f.claim_method='keyless_documentary'
      and f.status in('owner_notice','objected')
    join private.claim_reviews r on r.id=k.review_id and r.case_kind='unclaimed_keyless'
      and r.state='approved_pending_owner_notice' and r.matched_embryo_id=f.embryo_id
    join public.embryos e on e.id=f.embryo_id and e.subject_id=k.subject_id and e.status='transferred'
      and e.future_person_state='reserved_for_future_person' and e.closing_date_state='definitive_transferred_claim_window'
    join public.subjects s on s.id=e.subject_id and s.subject_class='embryo' and s.lifecycle in('active','restricted')
      and s.claimant_principal_id is null and s.subject_account_id is null
    join public.embryo_cohorts c on c.id=e.cohort_id and c.id=s.cohort_id and c.owner_account_id=s.owner_account_id
      and c.status in('active','restricted')
    join public.future_person_identity fi on fi.id=f.identity_id and fi.embryo_id=e.id and fi.state='current'
      and fi.profile_format_version=1 and fi.fixed_expires_at>clock_timestamp() and octet_length(fi.wrapped_profile_key)=72
    join public.future_person_claim_notices n on n.claim_id=f.id and n.notice_kind='owner_notice'
      and n.owner_account_id=s.owner_account_id
    join public.subject_principals sp on sp.id=n.owner_principal_id and sp.account_id=n.owner_account_id
      and sp.status='active' and sp.principal_revision=n.owner_authority_revision
    join public.profiles p on p.id=n.owner_account_id and p.deletion_requested_at is null
    join auth.users u on u.id=p.id and u.deleted_at is null
    join public.mail_outbox m on m.id=n.outbox_id and m.target_kind='claim' and m.target_id=f.id
      and m.purpose='future-person-claim-owner-notice' and m.recipient_principal_id=sp.id
      and m.recipient_authority_revision=sp.principal_revision and m.semantic_revision=n.notice_revision
    join public.encrypted_contact_references contact on contact.id=m.contact_reference_id and contact.principal_id=sp.id
      and contact.status='current' and contact.contact_ciphertext is not null
      and contact.authority_revision=n.owner_authority_revision
    where f.id=p_claim and k.state in('open','objected') and k.expires_at>clock_timestamp()
      and k.expires_at=r.created_at+interval '62 days' and k.documentary_at<r.deadline
      and k.authority_binding=jsonb_build_object('subjectLifecycleRevision',s.lifecycle_revision,
        'subjectBindingRevision',s.subject_binding_revision,'embryoDispositionRevision',e.disposition_revision,
        'cohortLifecycleRevision',c.lifecycle_revision,'ownerAccountId',p.id,'ownerAccountRevision',p.account_revision,
        'ownerPrincipalId',sp.id,'ownerPrincipalRevision',sp.principal_revision,'profileId',fi.id,
        'profileRevision',fi.identity_revision,'photoDocumentId',r.photo_document_id,'photoSha256',r.photo_sha256,
        'birthDocumentId',r.birth_record_document_id,'birthSha256',r.birth_record_sha256)
      and not exists(select 1 from public.future_person_claims other where other.embryo_id=e.id and other.id<>f.id
        and other.status in('submitted','reviewing','owner_notice','objected','approved'))
      and not exists(select 1 from public.retention_rows rr join public.purge_manifests pm on pm.retention_row_id=rr.id
        where rr.target_kind='subject' and rr.target_id=s.id
          and (pm.physical_purge_started_at is not null or pm.batch_cursor>0 or pm.state in('executing','complete'))));
$$;

create function private.prepare_keyless_owner_notice_v1(
  p_review uuid,p_revision bigint,p_nonce_hash text,p_reason bytea,p_attestation bytea,
  p_verified_birth date,p_parent_link_confirmed boolean,p_identity_set jsonb,p_profile_set jsonb,p_comparison_receipt text,
  p_minimum_ciphertext bytea,p_minimum_wrapped_key bytea,
  p_contact_id uuid,p_contact_ciphertext bytea,p_contact_set jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r private.claim_reviews; reviewer record; fresh jsonb; initial jsonb; e public.embryos; s public.subjects;
  fi public.future_person_identity; c public.embryo_cohorts; owner public.profiles; owner_principal public.subject_principals;
  owner_contact public.encrypted_contact_references; binding jsonb; now_at timestamptz; expiry timestamptz;
  principal uuid; session_id uuid; outbox uuid; candidate uuid; notice uuid; row_id uuid; rev bigint; contacts jsonb;
begin
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null or p_parent_link_confirmed is distinct from true or p_attestation is null or octet_length(p_attestation) not between 29 and 16384
    or p_minimum_ciphertext is null or octet_length(p_minimum_ciphertext) not between 29 and 16384
    or p_minimum_wrapped_key is null or octet_length(p_minimum_wrapped_key)<>72
    or p_contact_id is null or p_contact_ciphertext is null or octet_length(p_contact_ciphertext) not between 29 and 16384
    or p_comparison_receipt is null or p_comparison_receipt!~'^[0-9a-f]{64}$'
  then raise exception using errcode='42501',message='claim review unavailable'; end if;
  initial:=private.verify_keyless_claim_documents_v1(p_review,p_revision,p_verified_birth,p_identity_set,p_profile_set);
  if initial#>>'{case,caseKind}' is distinct from 'unclaimed_keyless' then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  select subject.* into s from public.subjects subject join public.embryos embryo on embryo.subject_id=subject.id
    where embryo.id=(initial#>>'{profile,embryoId}')::uuid for update of subject;
  perform 1 from public.retention_rows where target_kind='subject' and target_id=s.id order by id for update;
  -- A twin cannot appear between the final comparison and the binding write.
  -- This fence is owner-only and follows the target subject's common lock.
  lock table public.future_person_identity in share row exclusive mode;
  lock table public.future_person_claimant_identity_hmacs in share row exclusive mode;
  r:=private.assigned_claim_review_v1(p_review,reviewer.account_id);
  fresh:=private.verify_keyless_claim_documents_v1(p_review,p_revision,p_verified_birth,p_identity_set,p_profile_set);
  if fresh#>>'{case,caseKind}' is distinct from 'unclaimed_keyless'
    or fresh#>>'{scope,comparisonReceiptDigest}' is distinct from p_comparison_receipt then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  select * into e from public.embryos where id=(fresh#>>'{profile,embryoId}')::uuid for update;
  select * into fi from public.future_person_identity where id=(fresh#>>'{profile,profileId}')::uuid for update;
  select * into c from public.embryo_cohorts where id=e.cohort_id for update;
  select * into owner from public.profiles where id=s.owner_account_id for update;
  select sp.* into owner_principal from public.subject_principals sp where sp.account_id=owner.id
    and sp.principal_kind='account_subject' and sp.status='active' order by sp.created_at,sp.id limit 1 for update;
  select ecr.* into owner_contact from public.encrypted_contact_references ecr
    where ecr.principal_id=owner_principal.id and ecr.status='current' and ecr.contact_ciphertext is not null
      and ecr.authority_revision=owner_principal.principal_revision order by ecr.created_at desc,ecr.id limit 1 for update;
  now_at:=clock_timestamp();expiry:=r.created_at+interval '62 days';
  if s.id is null or s.id is distinct from e.subject_id or owner.id is null or owner.deletion_requested_at is not null
    or owner_principal.id is null or owner_contact.id is null or c.owner_account_id is distinct from owner.id
    or r.id is null or r.deadline<=now_at or expiry<=now_at+interval '31 days'
    or exists(select 1 from public.future_person_claims where id=r.id) then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  contacts:=private.resolve_hmac_set_v1('contact',null,p_contact_set);rev:=private.hmac_active_revision_v1('contact');
  if contacts is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  binding:=jsonb_build_object('subjectLifecycleRevision',s.lifecycle_revision,'subjectBindingRevision',s.subject_binding_revision,
    'embryoDispositionRevision',e.disposition_revision,'cohortLifecycleRevision',c.lifecycle_revision,
    'ownerAccountId',owner.id,'ownerAccountRevision',owner.account_revision,'ownerPrincipalId',owner_principal.id,
    'ownerPrincipalRevision',owner_principal.principal_revision,'profileId',fi.id,'profileRevision',fi.identity_revision,
    'photoDocumentId',r.photo_document_id,'photoSha256',r.photo_sha256,'birthDocumentId',r.birth_record_document_id,
    'birthSha256',r.birth_record_sha256);
  update private.claim_reviews set case_kind='unclaimed_keyless',matched_embryo_id=e.id where id=r.id;
  perform private.decide_claim_review_v1(r.id,r.review_revision,'keyless-document-match',p_nonce_hash,p_reason);
  update private.claim_reviews set state='approved_pending_owner_notice' where id=r.id;
  insert into public.subject_principals(subject_id,principal_kind,status) values(s.id,'future_person','pending') returning id into principal;
  insert into public.future_person_claim_sessions(embryo_id,candidate_principal_id,intake_revision,state,expires_at,created_at)
    values(e.id,principal,1,'submitted',expiry,r.created_at) returning id into session_id;
  insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,identity_id,
    claim_method,claim_revision,claimant_revision,status,submitted_at)
    values(r.id,session_id,e.id,principal,fi.id,'keyless_documentary',1,1,'owner_notice',r.created_at);
  insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
    values(p_contact_id,principal,p_contact_ciphertext,contacts->>rev::text,rev,1,'current');
  insert into public.contact_hmac_indexes(contact_reference_id,hmac_key_revision,contact_hmac,expires_at)
    select p_contact_id,x.key::bigint,x.value,expiry from jsonb_each_text(contacts) x;
  insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
    recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at,created_at)
    values('future-person-owner-notice','future-person-claim-owner-notice','claim',r.id,owner_principal.id,owner_contact.id,
      owner_principal.principal_revision,r.review_revision+1,
      encode(extensions.digest(convert_to('future-person-owner-notice-v1|'||r.id||'|'||(r.review_revision+1),'UTF8'),'sha256'),'hex'),
      'future-person-claim-objection',r.id,'{}',now_at+interval '24 hours',now_at) returning id into outbox;
  insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,expires_at)
    values(outbox,'future-person-claim-objection','claim',r.id,r.review_revision+1,now_at+interval '31 days') returning id into candidate;
  insert into public.future_person_claim_notices(claim_id,outbox_id,notice_kind,notice_revision,
    owner_account_id,owner_principal_id,owner_authority_revision,candidate_id)
    values(r.id,outbox,'owner_notice',r.review_revision+1,owner.id,owner_principal.id,owner_principal.principal_revision,candidate)
    returning id into notice;
  insert into public.future_person_claim_review_packages(claim_id,package_revision,package_fingerprint,state,expires_at,
    review_id,subject_id,documentary_at,delivery_deadline,authority_binding,comparison_ciphertext,wrapped_comparison_key,
    claimant_delivery_reference_id,created_at)
    values(r.id,r.review_revision+1,encode(extensions.digest(convert_to(binding::text,'UTF8')||p_minimum_ciphertext,'sha256'),'hex'),
      'open',expiry,r.id,s.id,now_at,now_at+interval '24 hours',binding,p_minimum_ciphertext,p_minimum_wrapped_key,p_contact_id,now_at);
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline,created_at)
    values('future-person.keyless-notice-release-62d','claim',r.id,r.review_revision+1,s.lifecycle_revision,e.disposition_revision,
      expiry,now_at) returning id into row_id;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
    target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
    select row_id,'future-person.keyless-notice-release-62d',x.id,'review-close',r.review_revision+1,x.deadline,
      'claim',r.id,s.lifecycle_revision,e.disposition_revision,'claim-review-package',r.review_revision+1,
      jsonb_build_object('reviewId',r.id,'reviewRevision',r.review_revision+1,'noticeId',notice,'noticeRevision',r.review_revision+1)
    from (values('keyless-owner-notice-delivery-close',now_at+interval '24 hours'),('keyless-day62-close',expiry)) x(id,deadline);
  -- Intake and candidate-search material does not transfer. The minimum has
  -- its own random wrapped key; the two immutable documents keep their own
  -- independent keys. Old decision basis/attestation cannot keep the erased
  -- intake key alive through a duplicate working copy.
  update private.future_person_claim_intakes set identity_ciphertext=extensions.gen_random_bytes(29),
    wrapped_data_key=extensions.gen_random_bytes(29),identity_key_shredded_at=now_at,
    identifier_hmac=encode(extensions.gen_random_bytes(32),'hex'),network_hmac=encode(extensions.gen_random_bytes(32),'hex')
    where id=r.id;
  update private.claim_review_decisions set reason_ciphertext=extensions.gen_random_bytes(29),documentary_attestation_ciphertext=null,
    verified_identity_hmac=null,identity_hmac_revision=null,verified_date_of_birth=null,recorded_parent_link_confirmed=false
    where review_id=r.id;
  return jsonb_build_object('claimId',r.id,'state','approved_pending_owner_notice','reviewRevision',r.review_revision+1);
end $$;

-- Pending notice does not issue claimant authority, detach a source, reset a
-- subject deadline, cancel parent deletion, or retain the original intake key.
-- Its transferred minimum remains closed to every API role.
create function private.close_keyless_notice_v1(p_claim uuid,p_code text)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare k public.future_person_claim_review_packages; now_at timestamptz:=clock_timestamp();
begin
  if p_code is null or p_code not in('notice_delivery_failed','claim_deadline_expired','record_state_changed','refused','withdrawn') then
    raise exception using errcode='22023',message='invalid claim close'; end if;
  perform 1 from public.subjects s join public.future_person_claim_review_packages p on p.subject_id=s.id
    where p.claim_id=p_claim for update of s;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=p_claim order by id for update;
  select * into k from public.future_person_claim_review_packages where claim_id=p_claim for update;
  if k.review_id is null or k.state not in('open','objected') then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  update public.future_person_claim_review_packages set state='closed',comparison_ciphertext=null,wrapped_comparison_key=null,
    comparison_key_shredded_at=now_at,terminal_code=p_code where id=k.id;
  update public.future_person_claims set status=case when p_code='withdrawn' then 'withdrawn' else 'refused' end,
    decided_at=now_at,claim_revision=claim_revision+1 where id=p_claim;
  update private.claim_reviews set state='closed',resolved_at=now_at,review_revision=review_revision+1 where id=k.review_id;
  perform private.shred_resolved_future_person_review_v1(k.review_id);
  update public.encrypted_contact_references set status='shredded',contact_ciphertext=null,
    contact_hmac=encode(extensions.gen_random_bytes(32),'hex'),ended_at=now_at where id=k.claimant_delivery_reference_id and status<>'shredded';
  delete from public.contact_hmac_indexes where contact_reference_id=k.claimant_delivery_reference_id;
  update public.subject_principals set status='deleted',principal_revision=principal_revision+1
    where id=(select claimant_principal_id from public.future_person_claims where id=p_claim) and status='pending';
  update public.future_person_claim_sessions set state='cancelled',ended_at=now_at
    where id=(select intake_session_id from public.future_person_claims where id=p_claim) and state='submitted';
  update public.token_hashes set status='revoked',ended_at=now_at where status in('current','consumed') and candidate_id in
    (select candidate_id from public.future_person_claim_notices where claim_id=p_claim and owner_account_id is not null);
  update public.token_candidates set state='invalidated' where id in
    (select candidate_id from public.future_person_claim_notices where claim_id=p_claim and owner_account_id is not null)
    and state in('pending','issued');
  update public.mail_outbox set state='invalidated',claimed_at=null,template_payload='{}',last_outcome_code=p_code
    where id in(select outbox_id from public.future_person_claim_notices where claim_id=p_claim)
      and state in('queued','claimed');
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    terminal_outcome_code=p_code,completed_at=now_at where target_kind='claim' and target_id=p_claim
    and retention_id in('future-person.keyless-notice-release-62d','future-person.owner-notice-30d')
    and status in('pending','retry','claimed');
  update public.retention_rows set state='complete',ended_at=now_at where target_kind='claim' and target_id=p_claim
    and retention_id in('future-person.keyless-notice-release-62d','future-person.owner-notice-30d') and state in('scheduled','active');
  perform private.append_legal_audit_event('claim.resolved',null,'jobs.retention','closed',jsonb_build_object('outcome','closed'));
end $$;

create function private.commit_keyless_notice_delivery_v1(p_claim uuid)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare k public.future_person_claim_review_packages; n public.future_person_claim_notices;
  m public.mail_outbox; d public.mail_deliveries; a public.mail_provider_attempts; now_at timestamptz; row_id uuid;
begin
  perform 1 from public.subjects s join public.future_person_claim_review_packages p on p.subject_id=s.id
    where p.claim_id=p_claim for update of s;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=p_claim order by id for update;
  select * into k from public.future_person_claim_review_packages where claim_id=p_claim for update;
  select * into n from public.future_person_claim_notices where claim_id=p_claim and owner_account_id is not null for update;
  select * into m from public.mail_outbox where id=n.outbox_id for update;
  select * into d from public.mail_deliveries where outbox_id=m.id for update;
  select * into a from public.mail_provider_attempts where id=d.provider_attempt_id and outbox_id=m.id for update;
  now_at:=clock_timestamp();
  if k.review_id is null or n.id is null or not private.keyless_owner_notice_current_v1(p_claim) then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  if m.state='failed' or d.status in('bounced','complained','reviewed_undeliverable') then
    perform private.close_keyless_notice_v1(p_claim,'notice_delivery_failed');return false;
  end if;
  if n.delivered_at is not null then
    return n.provider_attempt_id=a.id and d.status='delivered' and m.state='delivered';
  end if;
  if now_at>=k.delivery_deadline then
    perform private.close_keyless_notice_v1(p_claim,'notice_delivery_failed');return false;
  end if;
  -- Acceptance has its own provider payload retention clock. Only the actual
  -- exact delivered event may begin this full, unshortened owner period.
  if a.id is null or d.status<>'delivered' or d.provider_event_hmac is null or m.state<>'delivered'
    or a.provider<>'resend' or a.provider_message_id_hmac is null or a.submitted_at is null or a.completed_at is null
    or a.attempt_ordinal<>m.attempt_count or a.completed_at>=k.delivery_deadline then return false; end if;
  update public.future_person_claim_notices set delivered_at=now_at,notice_deadline=now_at+interval '30 days',
    provider_attempt_id=a.id where id=n.id;
  update public.token_candidates set expires_at=now_at+interval '30 days' where id=n.candidate_id;
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline,created_at)
    values('future-person.owner-notice-30d','claim',p_claim,n.notice_revision,
      (k.authority_binding->>'subjectLifecycleRevision')::bigint,(k.authority_binding->>'embryoDispositionRevision')::bigint,
      now_at+interval '30 days',now_at) returning id into row_id;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
    target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
    values(row_id,'future-person.owner-notice-30d','owner-objection-window-complete','lifecycle-transition',n.notice_revision,
      now_at+interval '30 days','claim',p_claim,(k.authority_binding->>'subjectLifecycleRevision')::bigint,
      (k.authority_binding->>'embryoDispositionRevision')::bigint,'claim-review-package',n.notice_revision,
      jsonb_build_object('reviewId',p_claim,'reviewRevision',k.package_revision,'noticeId',n.id,'noticeRevision',n.notice_revision));
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    terminal_outcome_code='notice_delivered',completed_at=now_at where target_kind='claim' and target_id=p_claim
    and retention_id='future-person.keyless-notice-release-62d' and phase_id='keyless-owner-notice-delivery-close'
    and status in('pending','retry','claimed');
  return true;
end $$;

-- No scheduler or provider callback is wired to these owner-only foundations
-- yet. A stale/expired package closes only this attempt; a completed owner
-- period never approves, creates custody, or releases data.
create function private.close_due_keyless_notices_v1()
returns integer language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare row_value record; count_closed integer:=0;
begin
  for row_value in select k.claim_id,k.delivery_deadline,k.expires_at,n.delivered_at
    from public.future_person_claim_review_packages k join public.future_person_claim_notices n on n.claim_id=k.claim_id
    where k.review_id is not null and k.state='open' and n.owner_account_id is not null order by k.subject_id,k.claim_id
  loop
    if row_value.expires_at<=clock_timestamp() then
      perform private.close_keyless_notice_v1(row_value.claim_id,'claim_deadline_expired');count_closed:=count_closed+1;
    elsif row_value.delivered_at is null and row_value.delivery_deadline<=clock_timestamp() then
      perform private.close_keyless_notice_v1(row_value.claim_id,'notice_delivery_failed');count_closed:=count_closed+1;
    elsif not private.keyless_owner_notice_current_v1(row_value.claim_id) then
      perform private.close_keyless_notice_v1(row_value.claim_id,'record_state_changed');count_closed:=count_closed+1;
    end if;
  end loop;
  return count_closed;
end $$;

revoke all on function private.guard_keyless_notice_package_v1(),private.guard_keyless_owner_notice_v1(),
  private.keyless_owner_notice_current_v1(uuid),
  private.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb),
  private.close_keyless_notice_v1(uuid,text),private.commit_keyless_notice_delivery_v1(uuid),private.close_due_keyless_notices_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
notify pgrst,'reload schema';
