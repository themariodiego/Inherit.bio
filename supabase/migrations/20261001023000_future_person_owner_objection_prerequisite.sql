-- Operation-specific keyless review; every original documentary branch keeps
-- its existing assignment/read/decision contract. No new durable store.
alter table private.claim_review_assignments add column review_operation text not null default 'documentary'
  check(review_operation in('documentary','claim-objection','claim-release'));
alter table public.future_person_claim_objections
  add column notice_id uuid references public.future_person_claim_notices(id) on delete restrict,
  add column initial_notice_revision bigint check(initial_notice_revision>0),
  add column statement_ciphertext bytea,
  add column wrapped_statement_key bytea,
  add column statement_key_shredded_at timestamptz,
  add column timely_deadline timestamptz,
  add column release_recheck_deadline timestamptz,
  add column review_reason_ciphertext bytea;
alter table public.rights_sessions add column last_activity_at timestamptz;
-- A genuine delivery keeps its initial revision even when a reviewed overrule
-- increments the current decision revision. No legacy notice proof is minted.
alter table public.future_person_claim_notices add column delivery_notice_revision bigint;
update public.future_person_claim_notices set delivery_notice_revision=notice_revision
  where owner_account_id is not null;
create function private.stamp_keyless_delivery_revision_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.owner_account_id is not null then
    if new.delivery_notice_revision is not null and new.delivery_notice_revision<>new.notice_revision then
      raise exception using errcode='42501',message='claim notice unavailable';end if;
    new.delivery_notice_revision:=new.notice_revision;
  end if;
  return new;
end $$;
revoke all on function private.stamp_keyless_delivery_revision_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create trigger keyless_delivery_revision before insert on public.future_person_claim_notices
  for each row execute function private.stamp_keyless_delivery_revision_v1();

alter table public.future_person_claim_objections add constraint keyless_objection_working_shape check((
  notice_id is null or (initial_notice_revision is not null and timely_deadline is not null
    and ((status='submitted' and octet_length(statement_ciphertext) between 48 and 16028
      and octet_length(wrapped_statement_key)=72 and statement_key_shredded_at is null)
      or (status in('upheld','withdrawn','expired') and statement_ciphertext is null
        and wrapped_statement_key is null and statement_key_shredded_at is not null)
      or (status='overruled' and octet_length(statement_ciphertext) between 48 and 16028
        and octet_length(wrapped_statement_key)=72 and statement_key_shredded_at is null
        and release_recheck_deadline is not null)))) is true);
revoke all on public.future_person_claim_objections from public,anon,authenticated,inherit_upload_only,service_role;

-- The original62-day package clock is immutable. A timely objection moves
-- only this claim to its independently persisted review clock, capped by92
-- days from original submission. No unrelated record clock is extended.
create function private.keyless_claim_deadline_v1(p_claim uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select case when k.state='open' and not exists(select 1 from public.future_person_claim_objections o where o.claim_id=k.claim_id)
    then k.expires_at else (select case when o.status='submitted' then o.timely_deadline
      when o.status='overruled' then least(o.timely_deadline,o.release_recheck_deadline) end
      from public.future_person_claim_objections o where o.claim_id=k.claim_id and o.notice_id is not null
        and o.timely_deadline=least(o.submitted_at+interval '30 days',r.created_at+interval '92 days')
        and o.submitted_at>=n.delivered_at and o.submitted_at<=n.notice_deadline
        and o.initial_notice_revision=n.delivery_notice_revision
        and (o.release_recheck_deadline is null or (o.status='overruled'
          and o.release_recheck_deadline=least(o.decided_at+interval '24 hours',o.timely_deadline)))
      order by o.submitted_at,o.id limit 1) end
  from public.future_person_claim_review_packages k join private.claim_reviews r on r.id=k.review_id
  join public.future_person_claim_notices n on n.claim_id=k.claim_id and n.owner_account_id is not null
  where k.claim_id=p_claim and k.state in('open','objected') and k.expires_at=r.created_at+interval '62 days';
$$;
revoke all on function private.keyless_claim_deadline_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.keyless_owner_notice_current_v1(p_claim uuid)
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
      and m.recipient_authority_revision=sp.principal_revision and m.semantic_revision=n.delivery_notice_revision
    join public.encrypted_contact_references contact on contact.id=m.contact_reference_id and contact.principal_id=sp.id
      and contact.status='current' and contact.contact_ciphertext is not null
      and contact.authority_revision=n.owner_authority_revision
    where f.id=p_claim and k.state in('open','objected') and private.keyless_claim_deadline_v1(k.claim_id)>clock_timestamp()
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

create or replace function private.claim_review_open_v1(r private.claim_reviews)
returns boolean language sql stable security definer set search_path='' as $$
  select ((r).state in('document_review_pending','more_information_required','release_queued')
    and (r).deadline>clock_timestamp()) or ((r).state='approved_pending_owner_notice'
    and exists(select 1 from public.future_person_claim_review_packages k
      where k.review_id=(r).id and k.claim_id=(r).id and k.state in('open','objected')
        and k.expires_at=(r).created_at+interval '62 days' and private.keyless_claim_deadline_v1(k.claim_id)>clock_timestamp()
        and k.documentary_at<(r).deadline and k.wrapped_comparison_key is not null));
$$;
revoke all on function private.claim_review_open_v1(private.claim_reviews)
  from public,anon,authenticated,inherit_upload_only,service_role;

create function private.keyless_objection_notice_current_v1(p_notice uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from public.future_person_claim_notices n
    join public.future_person_claim_review_packages k on k.claim_id=n.claim_id and k.review_id=n.claim_id and k.state='open'
    join public.token_candidates tc on tc.id=n.candidate_id and tc.purpose='future-person-claim-objection'
      and tc.state='issued' and tc.target_kind='claim' and tc.target_id=n.claim_id and tc.token_revision=n.notice_revision and tc.expires_at=n.notice_deadline
    join public.mail_outbox m on m.id=n.outbox_id and m.state='delivered' and m.semantic_revision=n.notice_revision
    join public.mail_provider_attempts a on a.id=n.provider_attempt_id and a.outbox_id=m.id
      and a.attempt_ordinal=m.attempt_count and a.provider='resend' and a.submitted_at is not null and a.completed_at is not null
    join public.mail_deliveries d on d.outbox_id=m.id and d.provider_attempt_id=a.id and d.status='delivered'
      and d.provider_event_hmac is not null
    where n.id=p_notice and n.owner_account_id is not null and n.delivered_at is not null
      and n.notice_deadline=n.delivered_at+interval '30 days' and n.notice_deadline>=clock_timestamp()
      and n.delivery_notice_revision=n.notice_revision and k.expires_at>clock_timestamp()
      and private.keyless_owner_notice_current_v1(n.claim_id)
      and not exists(select 1 from public.future_person_claim_objections o where o.claim_id=n.claim_id));
$$;
revoke all on function private.keyless_objection_notice_current_v1(uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;

insert into private.rights_session_purposes (session_purpose,matrix_purpose,invitation_kind,target_kind)
values('future-person-claim-objection','future-person-claim-objection',null,'claim-notice');
create function private.guard_keyless_objection_session_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.purpose='future-person-claim-objection' and
    (new.token_hash_id,new.principal_id,new.purpose,new.target_kind,new.target_id,new.authority_revision,new.created_at,new.expires_at)
    is distinct from
    (old.token_hash_id,old.principal_id,old.purpose,old.target_kind,old.target_id,old.authority_revision,old.created_at,old.expires_at) then
    raise exception using errcode='42501',message='rights purpose unavailable';end if;
  if new.purpose<>'future-person-claim-objection' then return new;end if;
  if tg_op='UPDATE' and old.purpose<>'future-person-claim-objection' then
    raise exception using errcode='42501',message='rights purpose unavailable';end if;
  if new.status='active' and not exists(select 1 from public.future_person_claim_notices n
    join public.token_candidates tc on tc.id=n.candidate_id and tc.purpose='future-person-claim-objection'
      and tc.target_kind='claim' and tc.target_id=n.claim_id and tc.token_revision=new.authority_revision
    join public.token_hashes h on h.candidate_id=tc.id and h.token_revision=tc.token_revision
    where n.id=new.target_id and new.target_kind='claim-notice' and new.principal_id=n.owner_principal_id
      and n.notice_revision=new.authority_revision and h.id=new.token_hash_id
      and ((tg_op='INSERT' and h.status='current' and h.ended_at is null) or (tg_op='UPDATE' and h.status='consumed'))
      and new.expires_at<=n.notice_deadline and new.expires_at>clock_timestamp()
      and new.created_at>=greatest(h.created_at,n.delivered_at) and new.created_at<=clock_timestamp() and new.expires_at<=new.created_at+interval '60 minutes'
      and new.last_activity_at=new.created_at and private.keyless_objection_notice_current_v1(n.id)) then
    raise exception using errcode='42501',message='rights purpose unavailable';end if;
  return new;
end $$;
revoke all on function private.guard_keyless_objection_session_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;
create trigger keyless_objection_session_authority before insert or update on public.rights_sessions
  for each row execute function private.guard_keyless_objection_session_v1();

alter function public.activate_rights_session_v1(text,text,text) rename to activate_rights_session_before_keyless_objection_v1;
revoke all on function public.activate_rights_session_before_keyless_objection_v1(text,text,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.activate_rights_session_v1(p_token_hash text,p_session_hash text,p_form_nonce text)
returns table(purpose text,target_kind text,target_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare token public.token_hashes; notice public.future_person_claim_notices; package public.future_person_claim_review_packages;
  selected_purpose text; now_at timestamptz; expiry timestamptz;
begin
  select tc.purpose into selected_purpose from public.token_hashes h join public.token_candidates tc on tc.id=h.candidate_id
    where h.token_hash=p_token_hash and h.status='current';
  if selected_purpose is distinct from 'future-person-claim-objection' then
    return query select * from public.activate_rights_session_before_keyless_objection_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;
  select n.* into notice from public.future_person_claim_notices n join public.token_hashes h on h.candidate_id=n.candidate_id
    where h.token_hash=p_token_hash and h.status='current' and n.owner_account_id is not null;
  select * into package from public.future_person_claim_review_packages where claim_id=notice.claim_id;
  perform 1 from public.subjects where id=package.subject_id for update;
  perform 1 from public.retention_rows rr where rr.target_kind='claim' and rr.target_id=notice.claim_id order by rr.id for update;
  perform private.lock_invitation_transitions_v1();
  if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return;end if;
  perform private.consume_embryo_operation_nonce_v1(p_form_nonce,null,null,'rights_activate','form',null);
  select * into token from public.token_hashes where token_hash=p_token_hash and status='current' for update;
  select * into notice from public.future_person_claim_notices where id=notice.id for update;
  if token.id is null or notice.id is null or token.candidate_id<>notice.candidate_id
    or not private.keyless_objection_notice_current_v1(notice.id) then return;end if;
  now_at:=clock_timestamp();expiry:=least(now_at+interval '60 minutes',notice.notice_deadline);
  insert into public.rights_sessions (
    token_hash_id, principal_id, purpose, target_kind, target_id, authority_revision, session_hash,status,expires_at,created_at,last_activity_at
  ) values (
    token.id, notice.owner_principal_id, 'future-person-claim-objection', 'claim-notice', notice.id, notice.notice_revision,
    p_session_hash,'active',expiry,now_at,now_at
  );
  update public.token_hashes set status='consumed',ended_at=now_at where id=token.id;
  perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',
    jsonb_build_object('purpose','future-person-claim-objection'));
  return query select 'future-person-claim-objection'::text,'claim-notice'::text,notice.id,expiry;
end $$;
revoke all on function public.activate_rights_session_v1(text,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.activate_rights_session_v1(text,text,text) to service_role;

create function private.keyless_owner_rights_session_at_v1(p_hash text,p_lock boolean,p_now timestamptz)
returns public.rights_sessions language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions; package public.future_person_claim_review_packages;
begin
  if p_now is null or p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null;end if;
  select * into rs from public.rights_sessions where session_hash=p_hash;
  if rs.id is null or rs.purpose<>'future-person-claim-objection' or rs.target_kind<>'claim-notice' then return null;end if;
  if p_lock then
    select k.* into package from public.future_person_claim_review_packages k join public.future_person_claim_notices n on n.claim_id=k.claim_id
      where n.id=rs.target_id;
    perform 1 from public.subjects where id=package.subject_id for update;
    perform 1 from public.retention_rows where target_kind='claim' and target_id=package.claim_id order by id for update;
    select * into rs from public.rights_sessions where id=rs.id for update;
  end if;
  if rs.status<>'active' or rs.expires_at<=p_now or rs.last_activity_at is null or rs.last_activity_at<=p_now-interval '15 minutes'
    or rs.expires_at>rs.created_at+interval '60 minutes' or not private.keyless_objection_notice_current_v1(rs.target_id)
    or not exists(select 1 from public.future_person_claim_notices n join public.token_hashes h on h.candidate_id=n.candidate_id
      where n.id=rs.target_id and n.owner_principal_id=rs.principal_id and n.notice_revision=rs.authority_revision
        and n.notice_deadline>=p_now and h.id=rs.token_hash_id and h.status='consumed' and h.token_revision=n.notice_revision) then return null;end if;
  return rs;
end $$;
revoke all on function private.keyless_owner_rights_session_at_v1(text,boolean,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- The production selector always supplies the real database clock. The private
-- clock seam is owner-only, like existing retention-phase clock rehearsals;
-- no HTTP/API caller can manufacture current session authority with it.
create function private.keyless_owner_rights_session_v1(p_hash text,p_lock boolean)
returns public.rights_sessions language sql security definer set search_path='' as $$
  select private.keyless_owner_rights_session_at_v1(p_hash,p_lock,clock_timestamp());
$$;
revoke all on function private.keyless_owner_rights_session_v1(text,boolean) from public,anon,authenticated,inherit_upload_only,service_role;

create function public.future_person_objection_view_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions; n public.future_person_claim_notices;
begin
  rs:=private.keyless_owner_rights_session_v1(p_session_hash,false);if rs.id is null then return null;end if;
  select * into n from public.future_person_claim_notices where id=rs.target_id;
  return jsonb_build_object('safeNoticeSummary','A claim to a record you hold is pending.',
    'noticeDeadline',n.notice_deadline,'objectionArtifactBody',
    'Your objection pauses only this claim while a named person reviews it. Your record stays as it is.',
    'allowedActionIds',jsonb_build_array('object'));
end $$;
revoke all on function public.future_person_objection_view_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.future_person_objection_view_v1(text) to service_role;

-- The statement scope stays inside the server; the public view above never
-- serializes its IDs, encryption context, claimant, document or profile.
create function public.future_person_objection_statement_scope_v1(p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions; n public.future_person_claim_notices;
begin
  rs:=private.keyless_owner_rights_session_v1(p_session_hash,false);if rs.id is null then return null;end if;
  select * into n from public.future_person_claim_notices where id=rs.target_id;
  return jsonb_build_object('claimId',n.claim_id,'noticeId',n.id,'noticeRevision',n.notice_revision);
end $$;
revoke all on function public.future_person_objection_statement_scope_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.future_person_objection_statement_scope_v1(text) to service_role;

create function private.assign_keyless_review_operation_v1(p_review uuid,p_reviewer uuid,p_operation text)
returns bigint language plpgsql security definer set search_path='' as $$
declare r private.claim_reviews; next_revision bigint;
begin
  select * into r from private.claim_reviews where id=p_review for update;
  if r.id is null or r.case_kind<>'unclaimed_keyless' or r.state<>'approved_pending_owner_notice'
    or p_operation is null or p_operation not in('claim-objection','claim-release')
    or not exists(select 1 from private.claim_reviewers where account_id=p_reviewer and status='active') then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  update private.claim_review_assignments set status='ended',ended_at=clock_timestamp()
    where review_id=r.id and status='current';
  select coalesce(max(assignment_revision),0)+1 into next_revision from private.claim_review_assignments where review_id=r.id;
  insert into private.claim_review_assignments(review_id,reviewer_account_id,assignment_revision,review_operation)
    values(r.id,p_reviewer,next_revision,p_operation);
  update private.claim_review_downloads set revoked_at=clock_timestamp() where review_id=r.id and revoked_at is null;
  perform private.append_legal_audit_event('claim.review.assigned',null,'operations','accepted','{}');
  return next_revision;
end $$;
revoke all on function private.assign_keyless_review_operation_v1(uuid,uuid,text)
  from public,anon,authenticated,inherit_upload_only,service_role;

create function public.submit_future_person_owner_objection_v1(p_session_hash text,p_nonce text,
  p_notice_id uuid,p_notice_revision bigint,p_statement_ciphertext bytea,p_wrapped_statement_key bytea)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions; n public.future_person_claim_notices; k public.future_person_claim_review_packages;
  r private.claim_reviews; assigned private.claim_review_assignments; now_at timestamptz; deadline timestamptz;
  retention uuid; objection uuid;
begin
  rs:=private.keyless_owner_rights_session_v1(p_session_hash,true);
  if rs.id is null or p_notice_id is distinct from rs.target_id
    or p_notice_revision is distinct from rs.authority_revision
    or not private.rights_action_permitted_v1(rs.purpose,'object','api.future-person-claim-objection')
    or p_statement_ciphertext is null or octet_length(p_statement_ciphertext) not between 48 and 16028
    or p_wrapped_statement_key is null or octet_length(p_wrapped_statement_key)<>72 then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  select * into n from public.future_person_claim_notices where id=rs.target_id for update;
  select * into k from public.future_person_claim_review_packages where claim_id=n.claim_id for update;
  select * into r from private.claim_reviews where id=k.review_id for update;
  select a.* into assigned from private.claim_review_assignments a join private.claim_reviewers cr on cr.account_id=a.reviewer_account_id
    and cr.status='active' where a.review_id=r.id and a.status='current' for update of a;
  now_at:=clock_timestamp();deadline:=least(now_at+interval '30 days',r.created_at+interval '92 days');
  if assigned.review_id is null or not private.keyless_objection_notice_current_v1(n.id)
    or n.notice_deadline<now_at or deadline<=now_at then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
  insert into public.future_person_claim_objections(claim_id,objector_principal_id,objection_revision,reason_code,
    submitted_at,notice_id,initial_notice_revision,statement_ciphertext,wrapped_statement_key,timely_deadline)
    values(n.claim_id,n.owner_principal_id,1,'identity_or_fraud_objection',now_at,n.id,n.notice_revision,
      p_statement_ciphertext,p_wrapped_statement_key,deadline) returning id into objection;
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
    disposition_revision,fixed_deadline,created_at)
    values('future-person.claim-objection-review-30d','claim',n.claim_id,r.review_revision+1,
      (k.authority_binding->>'subjectLifecycleRevision')::bigint,(k.authority_binding->>'embryoDispositionRevision')::bigint,
      deadline,now_at) returning id into retention;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
    target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
    values(retention,'future-person.claim-objection-review-30d','objection-review-decision-close','review-close',r.review_revision+1,deadline,
      'claim',n.claim_id,(k.authority_binding->>'subjectLifecycleRevision')::bigint,
      (k.authority_binding->>'embryoDispositionRevision')::bigint,'claim-review-package',r.review_revision+1,
      jsonb_build_object('reviewId',r.id,'objectionId',objection,'reviewRevision',r.review_revision+1,'noticeId',n.id,
        'noticeRevision',n.notice_revision,'objectionRevision',1));
  -- The replacement's exact persisted clock is present before superseding
  -- the original62-day no-objection transition. Neither clock is rewritten.
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    terminal_outcome_code='timely_objection_transferred',completed_at=now_at
    where target_kind='claim' and target_id=n.claim_id and retention_id='future-person.keyless-notice-release-62d'
      and phase_id='keyless-day62-close' and status in('pending','retry','claimed');
  update public.future_person_claim_review_packages set state='objected' where id=k.id;
  update public.future_person_claims set status='objected',claim_revision=claim_revision+1 where id=n.claim_id;
  update private.claim_reviews set review_revision=review_revision+1 where id=r.id;
  perform private.assign_keyless_review_operation_v1(r.id,assigned.reviewer_account_id,'claim-objection');
  update public.rights_sessions set status='revoked',ended_at=now_at where purpose='future-person-claim-objection'
    and target_kind='claim-notice' and target_id=n.id and status='active';
  update public.token_hashes set status='revoked',ended_at=now_at where candidate_id=n.candidate_id and status in('current','consumed');
  update public.token_candidates set state='invalidated' where id=n.candidate_id and state in('pending','issued');
  -- This codebase queues release through exact credentials, not a generic
  -- worker_jobs claim target. Never cancel the record's analytical jobs.
  update public.future_person_claim_release_credentials set status='revoked'
    where claim_id=n.claim_id and status in('current','consumed');
  perform private.append_legal_audit_event('claim.objection',null,'api.future-person-claim-objection','accepted','{}');
  return jsonb_build_object('status','suspended_for_review');
end $$;
revoke all on function public.submit_future_person_owner_objection_v1(text,text,uuid,bigint,bytea,bytea)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.submit_future_person_owner_objection_v1(text,text,uuid,bigint,bytea,bytea) to service_role;

create function private.guard_keyless_objection_working_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.notice_id is null then return new;end if;
  if (new.id,new.claim_id,new.objector_principal_id,new.reason_code,new.reviewed_evidence_id,new.submitted_at,
      new.notice_id,new.initial_notice_revision,new.timely_deadline)
    is distinct from (old.id,old.claim_id,old.objector_principal_id,old.reason_code,old.reviewed_evidence_id,old.submitted_at,
      old.notice_id,old.initial_notice_revision,old.timely_deadline)
    or (old.status in('upheld','withdrawn','expired') and to_jsonb(new) is distinct from to_jsonb(old))
    or (new.statement_ciphertext is not null and (new.statement_ciphertext,new.wrapped_statement_key)
      is distinct from (old.statement_ciphertext,old.wrapped_statement_key))
    or (old.release_recheck_deadline is not null and new.release_recheck_deadline is distinct from old.release_recheck_deadline)
    or (old.statement_key_shredded_at is not null and new.statement_key_shredded_at is distinct from old.statement_key_shredded_at)
    or new.objection_revision<old.objection_revision or new.objection_revision>old.objection_revision+1
  then raise exception using errcode='55000',message='immutable claim objection';end if;
  return new;
end $$;
revoke all on function private.guard_keyless_objection_working_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger keyless_objection_working_immutable before update on public.future_person_claim_objections
  for each row execute function private.guard_keyless_objection_working_v1();

-- A matching account does not borrow link authority: own live Auth, recent
-- reauthentication, configured MFA and the exact current owner/revision are
-- checked independently. This selector grants no document or claimant read.
create function private.keyless_owner_account_v1(p_notice uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare live jsonb; n public.future_person_claim_notices; k public.future_person_claim_review_packages;
begin
  live:=private.assert_live_authenticated_session();
  if live->>'authorized' is distinct from 'true' then return null;end if;
  select * into n from public.future_person_claim_notices where id=p_notice;
  select * into k from public.future_person_claim_review_packages where claim_id=n.claim_id;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=n.claim_id order by id for update;
  select * into n from public.future_person_claim_notices where id=p_notice for update;
  if n.id is null or n.owner_account_id is distinct from auth.uid()
    or not private.keyless_objection_notice_current_v1(n.id) then return null;end if;
  perform private.validate_sensitive_account_session_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid);
  return jsonb_build_object('accountId',auth.uid(),'authSessionId',(auth.jwt()->>'session_id')::uuid,
    'noticeId',n.id,'noticeRevision',n.notice_revision);
end $$;
revoke all on function private.keyless_owner_account_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

-- The shared human reader accepts only the current operation assignment;
-- generic documentary decision doors still refuse the pending-notice state.
alter function private.assigned_claim_review_v1(uuid,uuid) rename to assigned_claim_review_before_keyless_operations_v1;
revoke all on function private.assigned_claim_review_before_keyless_operations_v1(uuid,uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function private.assigned_claim_review_v1(p_review_id uuid,p_account uuid) returns private.claim_reviews
language plpgsql security definer set search_path='' as $$
declare r private.claim_reviews; k public.future_person_claim_review_packages; a private.claim_review_assignments;
  n public.future_person_claim_notices;
begin
  select * into r from private.claim_reviews where id=p_review_id;
  if r.state is distinct from 'approved_pending_owner_notice' then
    return private.assigned_claim_review_before_keyless_operations_v1(p_review_id,p_account);end if;
  select * into k from public.future_person_claim_review_packages where review_id=r.id;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=r.id order by id for update;
  select * into r from private.claim_reviews where id=p_review_id for update;
  select * into a from private.claim_review_assignments where review_id=r.id and reviewer_account_id=p_account and status='current';
  select * into n from public.future_person_claim_notices where claim_id=r.id and owner_account_id is not null;
  if r.state<>'approved_pending_owner_notice' or a.review_id is null
    or a.review_operation not in('claim-objection','claim-release') or not private.keyless_owner_notice_current_v1(r.id)
    or not private.claim_review_open_v1(r) then return null;end if;
  if a.review_operation='claim-objection' and not exists(select 1 from public.future_person_claim_objections o
    where o.claim_id=r.id and o.notice_id=n.id and o.status='submitted' and o.timely_deadline>clock_timestamp()) then return null;end if;
  if a.review_operation='claim-release' and (n.delivered_at is null or n.notice_deadline>clock_timestamp()
    or exists(select 1 from public.future_person_claim_objections o where o.claim_id=r.id and o.status<>'overruled')) then return null;end if;
  return r;
end $$;
revoke all on function private.assigned_claim_review_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.open_claim_review_download_v1(p_document_id uuid, p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_review private.claim_reviews;
  v_document private.claim_documents;
  v_download private.claim_review_downloads;
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim review download invalid';
  end if;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select r.id into v_review.id from private.claim_reviews r
  where r.photo_document_id = p_document_id or r.birth_record_document_id = p_document_id;
  v_review := private.assigned_claim_review_v1(v_review.id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required','approved_pending_owner_notice') then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, p_document_id);
  if v_document.id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  update private.claim_review_downloads set revoked_at=clock_timestamp()
  where reviewer_account_id=v_reviewer.account_id and auth_session_id=v_reviewer.auth_session_id and revoked_at is null;
  insert into private.claim_review_downloads (cookie_hash, review_id, document_id, reviewer_account_id,
    auth_session_id, account_auth_session_revision, originating_session_revision,
    sha256, byte_count, chunk_count, created_at, last_used_at, expires_at)
  select p_cookie_hash, v_review.id, v_document.id, v_reviewer.account_id, v_reviewer.auth_session_id,
    v_reviewer.account_auth_session_revision, v_reviewer.session_revision,
    v_document.sha256, v_document.byte_count, ceil(v_document.byte_count / 4000000.0)::integer,
    t.now_at, t.now_at, t.now_at + interval '1 hour'
  from (select clock_timestamp() as now_at) t
  returning * into v_download;
  update private.claim_review_downloads set review_revision=v_review.review_revision,
    assignment_revision=(select a.assignment_revision from private.claim_review_assignments a
      where a.review_id=v_review.id and a.reviewer_account_id=v_reviewer.account_id and a.status='current')
  where id=v_download.id;
  return jsonb_build_object('session', v_download.id, 'sizeBytes', v_download.byte_count,
    'sha256', v_download.sha256, 'chunkCount', v_download.chunk_count, 'mediaType', v_document.media_type,
    'documentKind', v_document.document_kind);
end;
$$;

create or replace function private.authorize_claim_review_chunk_v1(p_session_id uuid, p_cookie_hash text, p_sequence integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_download private.claim_review_downloads;
  v_review private.claim_reviews;
  v_document private.claim_documents;
begin
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select d.* into v_download from private.claim_review_downloads d
  where d.id = p_session_id and d.cookie_hash = p_cookie_hash for update;
  if v_download.id is null or v_download.revoked_at is not null or v_download.reviewer_account_id <> v_reviewer.account_id
    or v_download.auth_session_id <> v_reviewer.auth_session_id
    or v_download.account_auth_session_revision <> v_reviewer.account_auth_session_revision
    or v_download.originating_session_revision <> v_reviewer.session_revision
    or v_download.expires_at <= clock_timestamp()
    or v_download.last_used_at <= clock_timestamp() - interval '300 seconds'
    or p_sequence is null or p_sequence < 0 or p_sequence >= v_download.chunk_count then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_review := private.assigned_claim_review_v1(v_download.review_id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required','approved_pending_owner_notice')
    or v_download.review_revision is distinct from v_review.review_revision
    or not exists(select 1 from private.claim_review_assignments a where a.review_id=v_review.id
      and a.reviewer_account_id=v_reviewer.account_id and a.status='current'
      and a.assignment_revision=v_download.assignment_revision) then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, v_download.document_id);
  if v_document.id is null or v_document.sha256 <> v_download.sha256 then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  update private.claim_review_downloads set last_used_at = clock_timestamp() where id = v_download.id;
  return jsonb_build_object('objectKey', v_document.object_key, 'sha256', v_document.sha256,
    'byteCount', v_document.byte_count, 'chunkCount', v_download.chunk_count,
    'receiptChallenge', private.claim_review_receipt_challenge_v1(v_download.id,p_sequence),
    'documentId', v_document.id, 'reviewId',v_review.id,
    'wrappedDataKey', (select encode(ds.wrapped_document_key,'hex') from private.claim_document_sessions ds
      where ds.id=v_document.session_id));
end;
$$;


create unique index keyless_objection_one_attempt on public.future_person_claim_objections(claim_id) where notice_id is not null;
create function private.guard_claim_review_operation_binding_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.review_id,new.reviewer_account_id,new.assignment_revision,new.review_operation,new.created_at)
    is distinct from (old.review_id,old.reviewer_account_id,old.assignment_revision,old.review_operation,old.created_at)
    or (old.status='ended' and to_jsonb(new) is distinct from to_jsonb(old)) then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  return new;
end $$;
revoke all on function private.guard_claim_review_operation_binding_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger claim_review_operation_binding before update on private.claim_review_assignments
  for each row execute function private.guard_claim_review_operation_binding_v1();

-- Resolution removes the independently wrapped statement together with the
-- whole comparison/document/contact package; only the coded outcome remains.
alter function private.close_keyless_notice_v1(uuid,text) rename to close_keyless_notice_before_objection_v1;
revoke all on function private.close_keyless_notice_before_objection_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
create function private.close_keyless_notice_v1(p_claim uuid,p_code text) returns void
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare now_at timestamptz;
begin
  perform private.close_keyless_notice_before_objection_v1(p_claim,p_code);
  now_at:=clock_timestamp();
  update public.future_person_claim_objections set status=case when p_code='withdrawn' then 'withdrawn' else 'expired' end,
    decided_at=coalesce(decided_at,now_at),statement_ciphertext=null,wrapped_statement_key=null,
    statement_key_shredded_at=now_at,review_reason_ciphertext=null
    where claim_id=p_claim and notice_id is not null and status in('submitted','overruled');
  update public.rights_sessions set status='revoked',ended_at=now_at where purpose='future-person-claim-objection'
    and target_id in(select id from public.future_person_claim_notices where claim_id=p_claim) and status='active';
  delete from public.rights_nonces where rights_session_id in(select id from public.rights_sessions
    where purpose='future-person-claim-objection' and target_id in(select id from public.future_person_claim_notices where claim_id=p_claim));
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    terminal_outcome_code=p_code,completed_at=now_at where target_kind='claim' and target_id=p_claim
    and retention_id='future-person.claim-objection-review-30d' and status in('pending','retry','claimed');
  update public.retention_rows set state='complete',ended_at=now_at where target_kind='claim' and target_id=p_claim
    and retention_id='future-person.claim-objection-review-30d' and state in('scheduled','active');
end $$;
revoke all on function private.close_keyless_notice_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.read_keyless_review_operation_v1(p_id uuid,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewer record; r private.claim_reviews; k public.future_person_claim_review_packages;
  n public.future_person_claim_notices; o public.future_person_claim_objections;
  d private.claim_review_decisions; assignment private.claim_review_assignments;
begin
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null or p_operation is null or p_operation not in('claim-objection','claim-release') then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  if p_operation='claim-objection' then
    select * into o from public.future_person_claim_objections where id=p_id and notice_id is not null;
    r:=private.assigned_claim_review_v1(o.claim_id,reviewer.account_id);
  else r:=private.assigned_claim_review_v1(p_id,reviewer.account_id);end if;
  select * into assignment from private.claim_review_assignments where review_id=r.id and status='current'
    and reviewer_account_id=reviewer.account_id and review_operation=p_operation;
  if r.id is null or assignment.review_id is null or r.state<>'approved_pending_owner_notice'
    or private.claim_review_document_v1(r,r.photo_document_id) is null
    or private.claim_review_document_v1(r,r.birth_record_document_id) is null then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into k from public.future_person_claim_review_packages where review_id=r.id;
  select * into n from public.future_person_claim_notices where claim_id=r.id and owner_account_id is not null;
  select * into d from private.claim_review_decisions where review_id=r.id and decision='keyless-document-match'
    order by review_revision limit 1;
  if d.id is null or k.wrapped_comparison_key is null then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision)
    values(r.id,reviewer.account_id,reviewer.auth_session_id,r.review_revision);
  perform private.append_legal_audit_event('claim.review.read',null,
    case p_operation when 'claim-objection' then 'api.future-person-claim-objection-review' else 'api.future-person-claim-review' end,
    'accepted','{}');
  return jsonb_build_object('operation',p_operation,'claimId',r.id,'reviewRevision',r.review_revision,
    'noticeId',n.id,'noticeRevision',n.notice_revision,'noticeDeadline',n.notice_deadline,
    'deadline',private.keyless_claim_deadline_v1(r.id),'documentaryRevision',d.review_revision,
    'photoDocumentId',r.photo_document_id,'photoSha256',r.photo_sha256,
    'birthDocumentId',r.birth_record_document_id,'birthSha256',r.birth_record_sha256,
    'comparisonCiphertext',encode(k.comparison_ciphertext,'hex'),'wrappedComparisonKey',encode(k.wrapped_comparison_key,'hex'),
    'objection',case p_operation when 'claim-objection' then jsonb_build_object('id',o.id,
      'objectionRevision',o.objection_revision,'initialNoticeRevision',o.initial_notice_revision,
      'statementCiphertext',encode(o.statement_ciphertext,'hex'),'wrappedStatementKey',encode(o.wrapped_statement_key,'hex')) else null end);
end $$;
revoke all on function private.read_keyless_review_operation_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.read_keyless_review_operation_v1(p_id uuid,p_operation text) returns jsonb
language sql security invoker set search_path='' as $$ select private.read_keyless_review_operation_v1(p_id,p_operation); $$;
grant execute on function private.read_keyless_review_operation_v1(uuid,text) to authenticated;
revoke all on function public.read_keyless_review_operation_v1(uuid,text) from public,anon,inherit_upload_only,service_role;
grant execute on function public.read_keyless_review_operation_v1(uuid,text) to authenticated;

-- At the end of a delivered owner period the scheduler may assign the separate
-- release operation and invalidate old receipts. Time never approves/detaches.
create or replace function private.close_due_keyless_notices_v1() returns integer
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare item record; k public.future_person_claim_review_packages; n public.future_person_claim_notices;
  r private.claim_reviews; assignment private.claim_review_assignments; now_at timestamptz; changed integer:=0;
begin
  for item in select p.claim_id,p.subject_id from public.future_person_claim_review_packages p
    where p.review_id is not null and p.state in('open','objected') order by p.subject_id,p.claim_id
  loop
    perform 1 from public.subjects where id=item.subject_id for update;
    perform 1 from public.retention_rows where target_kind='claim' and target_id=item.claim_id order by id for update;
    select * into k from public.future_person_claim_review_packages where claim_id=item.claim_id for update;
    select * into n from public.future_person_claim_notices where claim_id=item.claim_id and owner_account_id is not null for update;
    select * into r from private.claim_reviews where id=item.claim_id for update;
    now_at:=clock_timestamp();
    if k.id is null or k.state not in('open','objected') then continue;end if;
    if private.keyless_claim_deadline_v1(item.claim_id) is null or private.keyless_claim_deadline_v1(item.claim_id)<=now_at then
      perform private.close_keyless_notice_v1(item.claim_id,'claim_deadline_expired');changed:=changed+1;
    elsif n.delivered_at is null and k.delivery_deadline<=now_at then
      perform private.close_keyless_notice_v1(item.claim_id,'notice_delivery_failed');changed:=changed+1;
    elsif not private.keyless_owner_notice_current_v1(item.claim_id) then
      perform private.close_keyless_notice_v1(item.claim_id,'record_state_changed');changed:=changed+1;
    elsif k.state='open' and n.notice_deadline<=now_at and not exists(select 1 from public.future_person_claim_objections where claim_id=item.claim_id) then
      select * into assignment from private.claim_review_assignments where review_id=r.id and status='current';
      if assignment.review_id is not null and assignment.review_operation='documentary'
        and exists(select 1 from private.claim_reviewers where account_id=assignment.reviewer_account_id and status='active') then
        update private.claim_reviews set review_revision=review_revision+1 where id=r.id;
        perform private.assign_keyless_review_operation_v1(r.id,assignment.reviewer_account_id,'claim-release');
        update public.rights_sessions set status='revoked',ended_at=now_at where purpose='future-person-claim-objection'
          and target_id=n.id and status='active';
        update public.token_hashes set status='revoked',ended_at=now_at where candidate_id=n.candidate_id and status in('current','consumed');
        update public.token_candidates set state='invalidated' where id=n.candidate_id and state in('pending','issued');
        update public.retention_due_phases set status='complete',completed_at=now_at,claim_token_hash=null,claim_expires_at=null,
          terminal_outcome_code='fresh_release_review_required' where target_kind='claim' and target_id=item.claim_id
          and retention_id='future-person.owner-notice-30d' and phase_id='owner-objection-window-complete'
          and status in('pending','retry','claimed');
        changed:=changed+1;
      end if;
    end if;
  end loop;
  return changed;
end $$;
