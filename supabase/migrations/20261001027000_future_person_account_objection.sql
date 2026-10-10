-- Independently authenticated current-owner objection prerequisite.
-- No credential alone can supply Auth, MFA, named assignment or documentary
-- evidence. No new store, root secret or retention clock is introduced.
create function private.record_keyless_owner_objection_v1(p_notice_id uuid,p_notice_revision bigint,
  p_statement_ciphertext bytea,p_wrapped_statement_key bytea)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare n public.future_person_claim_notices; k public.future_person_claim_review_packages;
  r private.claim_reviews; assigned private.claim_review_assignments; now_at timestamptz; deadline timestamptz;
  retention uuid; objection uuid;
begin
  select stored_package.* into k from public.future_person_claim_review_packages stored_package
    join public.future_person_claim_notices notice on notice.claim_id=stored_package.claim_id where notice.id=p_notice_id;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=k.claim_id order by id for update;
  select * into n from public.future_person_claim_notices where id=p_notice_id for update;
  if n.id is null or n.notice_revision is distinct from p_notice_revision
    or not private.rights_action_permitted_v1('future-person-claim-objection','object','api.future-person-claim-objection')
    or p_statement_ciphertext is null or octet_length(p_statement_ciphertext) not between 48 and 16028
    or p_wrapped_statement_key is null or octet_length(p_wrapped_statement_key)<>72 then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  select * into k from public.future_person_claim_review_packages where claim_id=n.claim_id for update;
  select * into r from private.claim_reviews where id=k.review_id for update;
  select a.* into assigned from private.claim_review_assignments a join private.claim_reviewers cr on cr.account_id=a.reviewer_account_id
    and cr.status='active' where a.review_id=r.id and a.status='current' for update of a;
  now_at:=clock_timestamp();deadline:=least(now_at+interval '30 days',r.created_at+interval '92 days');
  if assigned.review_id is null or not private.keyless_objection_notice_current_v1(n.id)
    or n.notice_deadline<now_at or deadline<=now_at then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
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

revoke all on function private.record_keyless_owner_objection_v1(uuid,bigint,bytea,bytea)
  from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function public.submit_future_person_owner_objection_v1(p_session_hash text,p_nonce text,
  p_notice_id uuid,p_notice_revision bigint,p_statement_ciphertext bytea,p_wrapped_statement_key bytea)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;
begin
  rs:=private.keyless_owner_rights_session_v1(p_session_hash,true);
  if rs.id is null or p_notice_id is distinct from rs.target_id or p_notice_revision is distinct from rs.authority_revision then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
  return private.record_keyless_owner_objection_v1(p_notice_id,p_notice_revision,p_statement_ciphertext,p_wrapped_statement_key);
end $$;

create function public.future_person_owner_account_objection_scope_v1(p_notice uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare authority jsonb; n public.future_person_claim_notices;
begin
  authority:=private.keyless_owner_account_v1(p_notice);
  if authority is null then raise exception using errcode='42501',message='claim notice unavailable';end if;
  select * into n from public.future_person_claim_notices where id=p_notice;
  return jsonb_build_object('claimId',n.claim_id,'noticeId',n.id,'noticeRevision',n.notice_revision);
end $$;
revoke all on function public.future_person_owner_account_objection_scope_v1(uuid)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.future_person_owner_account_objection_scope_v1(uuid) to authenticated;

create function public.submit_future_person_account_objection_v1(p_notice uuid,p_revision bigint,p_nonce text,
  p_statement_ciphertext bytea,p_wrapped_statement_key bytea) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare authority jsonb;
begin
  authority:=private.keyless_owner_account_v1(p_notice);
  if authority is null or (authority->>'noticeRevision')::bigint is distinct from p_revision then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce,auth.uid(),(auth.jwt()->>'session_id')::uuid,
    'future_person_objection','form',null);
  return private.record_keyless_owner_objection_v1(p_notice,p_revision,p_statement_ciphertext,p_wrapped_statement_key);
end $$;
revoke all on function public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.submit_future_person_account_objection_v1(uuid,bigint,text,bytea,bytea) to authenticated;

-- Settings GET remains stateless and paginated. It selects only the caller's
-- current-owner notices; it creates no candidate, case, nonce or session.
create function public.future_person_owner_objection_controls_v1(p_after uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare live jsonb; items jsonb; next_cursor uuid;
begin
  live:=private.assert_live_authenticated_session();
  if live->>'authorized' is distinct from 'true' then
    raise exception using errcode='42501',message='claim notice unavailable';end if;
  perform private.validate_sensitive_account_session_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid);
  with selected as materialized(select n.id,n.notice_revision,n.notice_deadline
    from public.future_person_claim_notices n where n.owner_account_id=auth.uid()
      and (p_after is null or n.id>p_after) and private.keyless_objection_notice_current_v1(n.id)
    order by n.id limit 65)
  select coalesce(jsonb_agg(jsonb_build_object('noticeId',id,'noticeRevision',notice_revision,
    'safeNoticeSummary','A claim to a record you hold is pending.','noticeDeadline',notice_deadline,
    'objectionArtifactBody','Your objection pauses only this claim while a named person reviews it. Your record stays as it is.',
    'allowedActionIds',jsonb_build_array('object')) order by id) filter(where row_number<=64),'[]'::jsonb),
    case when count(*)>64 then (array_agg(id order by id))[64] else null end
    into items,next_cursor from(select *,row_number() over(order by id) from selected) numbered;
  return jsonb_build_object('items',items,'nextCursor',next_cursor);
end $$;
revoke all on function public.future_person_owner_objection_controls_v1(uuid) from public,anon,inherit_upload_only,service_role;
grant execute on function public.future_person_owner_objection_controls_v1(uuid) to authenticated;
