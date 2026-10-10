-- Existing-principal recovery never creates new custody or a parent notice.
-- The documentary lookup remains read-only. A final own-JWT reviewer POST
-- repeats current authority under a subject-first lock and consumes its
-- separate decision nonce before rotating release/working authentication.
alter table private.claim_reviews drop constraint claim_reviews_check4;
alter table private.claim_reviews add constraint claim_reviews_claimant_selector_shape check (
  (case_kind in ('claimant_recovery_key','claimed_unbound_no_key_recovery'))
    = (matched_claimant_principal_id is not null)
);

create function public.restore_future_person_claim_review_v1(
  p_review_id uuid,p_review_revision bigint,p_decision text,p_nonce_hash text,
  p_reason_ciphertext bytea,p_attestation_ciphertext bytea,p_identity_hmac_set jsonb,
  p_verified_date_of_birth date,p_profile_hmac_set jsonb,p_comparison_receipt_digest text,
  p_contact_reference_id uuid,p_contact_ciphertext bytea,p_contact_hmac_set jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  r private.claim_reviews; reviewer record; cp public.future_person_claimant_principals;
  s public.subjects; sp public.subject_principals; f public.future_person_claims;
  identity_set jsonb; profile_set jsonb; candidates uuid[]; selected uuid;
  fresh jsonb; result jsonb; now_at timestamptz; revision bigint;
begin
  if p_decision is null or p_decision not in ('approve-recovery-key','approve-claimed-unbound-no-key-recovery')
    or p_attestation_ciphertext is null or octet_length(p_attestation_ciphertext) not between 29 and 16384
    or p_verified_date_of_birth is null or p_verified_date_of_birth<date '1900-01-01'
    or (p_verified_date_of_birth+interval '18 years')::date>(clock_timestamp() at time zone 'UTC')::date
  then raise exception using errcode='42501',message='claim review unavailable'; end if;
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  select * into r from private.claim_reviews where id=p_review_id;
  identity_set:=private.resolve_hmac_set_v1('contact',null,p_identity_hmac_set);
  if identity_set is null or r.id is null or r.review_revision is distinct from p_review_revision
    or not private.claim_review_open_v1(r) then
    raise exception using errcode='42501',message='claim review unavailable'; end if;

  if p_decision='approve-recovery-key' then
    if r.mode<>'claimant-recovery-key' or r.case_kind<>'claimant_recovery_key'
      or p_profile_hmac_set is not null or p_comparison_receipt_digest is not null then
      raise exception using errcode='42501',message='claim review unavailable'; end if;
    selected:=r.matched_claimant_principal_id;
  else
    if r.mode<>'keyless' or r.case_kind not in ('keyless_none','claimed_unbound_no_key_recovery')
      or p_comparison_receipt_digest is null or p_comparison_receipt_digest!~'^[0-9a-f]{64}$' then
      raise exception using errcode='42501',message='claim review unavailable'; end if;
    profile_set:=private.resolve_hmac_set_v1('contact',null,p_profile_hmac_set);
    if profile_set is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
    select array_agg(distinct c.id order by c.id) into candidates
      from public.future_person_claimant_identity_hmacs h
      join public.future_person_claimant_principals c on c.id=h.claimant_principal_id and c.status='current'
      join public.subject_principals principal on principal.id=c.principal_id
        and principal.principal_kind='future_person' and principal.status='active' and principal.account_id is null
      join public.subjects subject on subject.id=principal.subject_id and subject.claimant_principal_id=c.id
        and subject.lifecycle='claimed_unbound' and subject.owner_account_id is null and subject.subject_account_id is null
      where h.expires_at is null
        and private.claim_hash_matches_v1(h.identity_hmac,identity_set->>h.hmac_key_revision::text);
    if cardinality(candidates) is distinct from 1 then
      raise exception using errcode='42501',message='claim review unavailable'; end if;
    selected:=candidates[1];
  end if;

  -- Discovery above supplies no authority. Lock the exact subject before all
  -- claim, identity and delivery rows. This serializes binding and deletion.
  select subject.* into s from public.subjects subject
    join public.subject_principals principal on principal.subject_id=subject.id
    join public.future_person_claimant_principals claimant on claimant.principal_id=principal.id
    where claimant.id=selected for update of subject;
  if s.id is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  perform 1 from public.retention_rows where (target_kind='subject' and target_id=s.id)
    or (target_kind='claim' and target_id=selected) order by id for update;
  -- Prevent a newly written durable identity from turning a unique lookup
  -- into a twin between fresh comparison and the final write. No caller/API
  -- role obtains a lock door; failures/timeouts roll back every effect.
  lock table public.future_person_claimant_identity_hmacs in share row exclusive mode;
  r:=private.assigned_claim_review_v1(p_review_id,reviewer.account_id);
  select * into cp from public.future_person_claimant_principals where id=selected for update;
  select * into sp from public.subject_principals where id=cp.principal_id for update;
  select * into f from public.future_person_claims where id=cp.claim_id for update;
  if r.id is null or r.review_revision is distinct from p_review_revision
    or r.state not in ('document_review_pending','more_information_required')
    or cp.id is null or cp.status<>'current' or sp.id is null or sp.status<>'active'
    or sp.principal_kind<>'future_person' or sp.account_id is not null or sp.subject_id<>s.id
    or s.lifecycle<>'claimed_unbound' or s.claimant_principal_id is distinct from cp.id
    or s.owner_account_id is not null or s.subject_account_id is not null or s.cohort_id is not null
    or f.id is null or f.status<>'approved' or f.claimant_principal_id<>sp.id or f.claimant_account_id is not null
    or not exists(select 1 from public.future_person_claimant_identity_hmacs h
      where h.claimant_principal_id=cp.id and h.expires_at is null
        and private.claim_hash_matches_v1(h.identity_hmac,identity_set->>h.hmac_key_revision::text))
    or exists(select 1 from public.retention_rows t join public.purge_manifests m on m.retention_row_id=t.id
      where t.target_kind='subject' and t.target_id=s.id
        and (m.physical_purge_started_at is not null
          or m.batch_cursor>0 or m.state in ('executing','complete')))
  then raise exception using errcode='42501',message='claim review unavailable'; end if;
  perform private.assert_future_person_subject_custody_v1(s.id);
  if p_decision='approve-recovery-key' then
    if not exists(select 1 from public.future_person_recovery_key_hashes k
      join private.future_person_claim_intakes i on i.id=r.id
      where k.claimant_principal_id=cp.id and k.status='current'
        and private.claim_hash_matches_v1(k.recovery_key_hash,i.key_hash)) then
      raise exception using errcode='42501',message='claim review unavailable'; end if;
  else
    fresh:=private.verify_keyless_claim_documents_v1(r.id,r.review_revision,p_verified_date_of_birth,identity_set,profile_set);
    if fresh->'case'->>'caseKind' is distinct from 'claimed_unbound_no_key_recovery'
      or fresh->'scope'->>'comparisonReceiptDigest' is distinct from p_comparison_receipt_digest then
      raise exception using errcode='42501',message='claim review unavailable'; end if;
    update private.claim_reviews set case_kind='claimed_unbound_no_key_recovery',matched_claimant_principal_id=cp.id
      where id=r.id;
  end if;
  -- Existing decision door requires both exact clean documents' complete
  -- current delivery receipts and records the nonce once atomically.
  result:=private.decide_claim_review_v1(r.id,r.review_revision,p_decision,p_nonce_hash,p_reason_ciphertext);
  revision:=private.hmac_active_revision_v1('contact');
  update private.claim_review_decisions set documentary_attestation_ciphertext=p_attestation_ciphertext,
    verified_identity_hmac=identity_set->>revision::text,identity_hmac_revision=revision,
    verified_date_of_birth=p_verified_date_of_birth,recorded_parent_link_confirmed=false
    where review_id=r.id and review_revision=r.review_revision;
  now_at:=clock_timestamp();
  -- Rotation replaces the optional hash; it does not retain a historical
  -- collection of superseded credentials under the durable identity purpose.
  delete from public.future_person_recovery_key_hashes where claimant_principal_id=cp.id;
  update public.rights_sessions set status='revoked',ended_at=now_at
    where principal_id=sp.id and purpose='approved-future-person-release' and status='active';
  update public.download_sessions set status='revoked',ended_at=now_at,session_revision=session_revision+1
    where principal_id=sp.id and status='active' and target_id=s.id and target_kind in ('subject','claimed-subject');
  update public.generated_exports set status='revoked' where requester_principal_id=sp.id
    and target_kind='subject' and target_id=s.id and status in ('queued','building');
  update public.token_hashes set status='revoked',ended_at=now_at where status in ('current','consumed')
    and candidate_id in (select candidate_id from public.future_person_claim_release_credentials where claimant_principal_id=cp.id);
  update public.token_candidates set state='invalidated' where state in ('pending','issued')
    and id in (select candidate_id from public.future_person_claim_release_credentials where claimant_principal_id=cp.id);
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='claimant_reverified'
    where state in ('queued','claimed') and id in (select t.outbox_id from public.token_candidates t
      join public.future_person_claim_release_credentials c on c.candidate_id=t.id where c.claimant_principal_id=cp.id);
  update public.future_person_claim_release_credentials set status='revoked'
    where claimant_principal_id=cp.id and status in ('current','consumed');
  update public.future_person_claimant_principals set release_revision=release_revision+1 where id=cp.id;
  perform private.queue_future_person_release_v1(cp.claim_id,p_contact_reference_id,p_contact_ciphertext,p_contact_hmac_set);
  update private.claim_reviews set state='closed',resolved_at=now_at where id=r.id;
  perform private.shred_resolved_future_person_review_v1(r.id);
  perform private.append_legal_audit_event('claim.resolved',null,'api.future-person-claim-review','accepted',
    jsonb_build_object('outcome','approved'));
  return result;
end $$;
revoke all on function public.restore_future_person_claim_review_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,jsonb,text,uuid,bytea,jsonb)
  from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.restore_future_person_claim_review_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,jsonb,text,uuid,bytea,jsonb) to authenticated;

-- One Recovery Key may be shown per genuinely issued release revision.
-- Superseded hashes were erased by the real restoration transaction. The
-- original blanket repeat refusal remains: the replacement may be shown once
-- through the existing native rights door; no raw key is
-- written to a database, notice, log, review response or retained package.
create or replace function public.issue_future_person_recovery_key_v1(p_session_hash text,p_nonce text,p_key_hash text)
returns date language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;cp public.future_person_claimant_principals;
begin
  rs:=private.future_person_rights_session_v1(p_session_hash,true);
  if rs.id is null or p_key_hash is null or p_key_hash!~'^[0-9a-f]{64}$'
    or not private.rights_action_permitted_v1(rs.purpose,'create-recovery-key','api.future-person-recovery-key') then
    raise exception using errcode='42501',message='claimant rights unavailable'; end if;
  select * into cp from public.future_person_claimant_principals where principal_id=rs.principal_id and status='current' for update;
  if exists(select 1 from public.future_person_recovery_key_hashes where claimant_principal_id=cp.id)
    or not exists(select 1 from public.future_person_claimant_identity_hmacs where claimant_principal_id=cp.id and expires_at is null) then
    raise exception using errcode='42501',message='claimant rights unavailable'; end if;
  perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
  insert into public.future_person_recovery_key_hashes(claimant_principal_id,recovery_key_hash,key_revision,status)
    values(cp.id,p_key_hash,cp.release_revision,'current');
  return (cp.contact_expires_at at time zone 'UTC')::date;
end $$;
revoke all on function public.issue_future_person_recovery_key_v1(text,text,text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.issue_future_person_recovery_key_v1(text,text,text) to service_role;
notify pgrst,'reload schema';
