-- A documentary lookup is not a positive determination or custody authority.
-- It stores no candidate binding, attestation, nonce, or new clock. The final
-- decision must repeat it under its own subject-first transaction and consume
-- the independently issued decision nonce. Existing positive keyless doors
-- remain closed until owner notice, objection and fresh release are complete.
create function private.verify_keyless_claim_documents_v1(
  p_review_id uuid,p_review_revision bigint,p_verified_date_of_birth date,
  p_identity_hmac_set jsonb,p_profile_hmac_set jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  reviewer record; r private.claim_reviews; photo private.claim_documents; birth private.claim_documents;
  body jsonb; identity_set jsonb; profile_set jsonb; candidates uuid[]; selected uuid;
  cp public.future_person_claimant_principals; s public.subjects; e public.embryos;
  fi public.future_person_identity; authority jsonb; kind text:='keyless_none'; assignment bigint;
begin
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null or p_review_revision is null or p_verified_date_of_birth is null
    or p_verified_date_of_birth<date '1900-01-01'
    or (p_verified_date_of_birth+interval '18 years')::date>(clock_timestamp() at time zone 'UTC')::date
  then raise exception using errcode='42501',message='claim review unavailable'; end if;
  r:=private.assigned_claim_review_v1(p_review_id,reviewer.account_id);
  if r.id is null or r.mode<>'keyless' or r.review_revision<>p_review_revision
    or r.state not in('document_review_pending','more_information_required')
    or r.photo_document_id is null or r.birth_record_document_id is null
    or r.photo_document_id=r.birth_record_document_id then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  photo:=private.claim_review_document_v1(r,r.photo_document_id);
  birth:=private.claim_review_document_v1(r,r.birth_record_document_id);
  if photo.id is null or birth.id is null or photo.document_kind<>'future-photo-identity'
    or birth.document_kind<>'future-birth-record'
    or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,photo)
    or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,birth) then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  select a.assignment_revision into assignment from private.claim_review_assignments a
    where a.review_id=r.id and a.reviewer_account_id=reviewer.account_id and a.status='current';
  identity_set:=private.resolve_hmac_set_v1('contact',null,p_identity_hmac_set);
  if identity_set is null then raise exception using errcode='42501',message='claim review unavailable'; end if;

  -- Documentary name/DOB comes from the named human, never the intake. Prior
  -- current claimant identity is searched first; a nonzero result cannot fall
  -- through to a parent-controlled profile, even when it cannot be restored.
  select array_agg(distinct c.id order by c.id) into candidates
    from public.future_person_claimant_identity_hmacs h
    join public.future_person_claimant_principals c on c.id=h.claimant_principal_id and c.status='current'
    join public.subject_principals sp on sp.id=c.principal_id and sp.principal_kind='future_person'
      and sp.status='active' and sp.account_id is null
    join public.subjects subj on subj.id=sp.subject_id and subj.claimant_principal_id=c.id
      and subj.lifecycle='claimed_unbound' and subj.owner_account_id is null and subj.subject_account_id is null
    join public.future_person_claims f on f.id=c.claim_id and f.status='approved'
      and f.claimant_principal_id=sp.id and f.claimant_account_id is null
    join public.embryos em on em.id=f.embryo_id and em.subject_id=subj.id and em.status='claimed_unbound'
    where h.expires_at is null
      and private.claim_hash_matches_v1(h.identity_hmac,identity_set->>h.hmac_key_revision::text);
  if cardinality(candidates)>1 then
    kind:='keyless_ambiguous';
    authority:=jsonb_build_object('branch','prior-claimant','matches',to_jsonb(candidates));
  elsif cardinality(candidates)=1 then
    selected:=candidates[1];
    select * into cp from public.future_person_claimant_principals where id=selected;
    select subj.* into s from public.subjects subj join public.subject_principals sp on sp.subject_id=subj.id
      where sp.id=cp.principal_id;
    perform private.assert_future_person_subject_custody_v1(s.id);
    select jsonb_build_object('claimant',to_jsonb(c),'subject',to_jsonb(subj),'principal',to_jsonb(sp),
      'claim',to_jsonb(f),'embryo',to_jsonb(em),'custody',to_jsonb(x),
      'identity',jsonb_agg(to_jsonb(h) order by h.hmac_key_revision)) into authority
      from public.future_person_claimant_principals c
      join public.subject_principals sp on sp.id=c.principal_id
      join public.subjects subj on subj.id=sp.subject_id
      join public.future_person_claims f on f.id=c.claim_id
      join public.embryos em on em.id=f.embryo_id and em.subject_id=subj.id
      join private.future_person_custody_slices x on x.subject_id=subj.id and x.claimant_principal_id=c.id
      join public.future_person_claimant_identity_hmacs h on h.claimant_principal_id=c.id and h.expires_at is null
      where c.id=selected group by c.id,subj.id,sp.id,f.id,em.id,x.subject_id;
    if authority is not null and not exists(select 1 from private.claim_reviews other
      where other.id<>r.id and other.matched_claimant_principal_id=selected and private.claim_review_open_v1(other))
      and not exists(select 1 from public.retention_rows rr join public.purge_manifests m on m.retention_row_id=rr.id
        where rr.target_kind='subject' and rr.target_id=s.id
          and (m.physical_purge_started_at is not null or m.batch_cursor>0 or m.state in('executing','complete')))
    then kind:='claimed_unbound_no_key_recovery'; end if;
  else
    -- The encrypted intake's place/names are only candidate signals. The
    -- application replaces its unverified DOB with the documentary DOB before
    -- purpose-separated indexing. A unique row never establishes parent link.
    profile_set:=private.resolve_hmac_set_v1('contact',null,p_profile_hmac_set);
    if profile_set is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
    select array_agg(distinct f.id order by f.id) into candidates
      from public.future_person_identity f
      join public.embryos em on em.id=f.embryo_id
      join public.subjects subj on subj.id=em.subject_id
      where f.state='current' and f.profile_format_version=1 and octet_length(f.wrapped_profile_key)=72
        and f.fixed_expires_at>clock_timestamp() and subj.subject_class='embryo'
        and subj.lifecycle in('active','restricted') and subj.claimant_principal_id is null
        and subj.owner_account_id is not null and em.cohort_id=subj.cohort_id
        and exists(select 1 from jsonb_each_text(f.match_indexes) idx
          where private.claim_hash_matches_v1(idx.value,profile_set->>idx.key));
    if cardinality(candidates)>1 then
      kind:='keyless_ambiguous';
      authority:=jsonb_build_object('branch','parent-profile','matches',to_jsonb(candidates));
    elsif cardinality(candidates)=1 then
      select * into fi from public.future_person_identity where id=candidates[1];
      select * into e from public.embryos where id=fi.embryo_id;
      select * into s from public.subjects where id=e.subject_id;
      select jsonb_build_object('profile',to_jsonb(fi),'embryo',to_jsonb(e),'subject',to_jsonb(s),
        'cohort',to_jsonb(c),'ownerRevision',p.account_revision,'ownerAuthRevision',p.auth_session_revision,
        'window',to_jsonb(rr)) into authority
        from public.embryo_cohorts c join public.profiles p on p.id=s.owner_account_id
        join public.retention_rows rr on rr.target_kind='subject' and rr.target_id=s.id
          and rr.retention_id='embryo.transferred-claim-window' and rr.state in('scheduled','active')
          and rr.disposition_revision=e.disposition_revision and rr.retention_revision=e.disposition_revision
        where c.id=e.cohort_id and c.owner_account_id=s.owner_account_id
          and c.status in('active','restricted') and rr.fixed_deadline>clock_timestamp();
      if authority is not null and e.status='transferred' and e.future_person_state='reserved_for_future_person'
        and e.closing_date_state='definitive_transferred_claim_window' and e.transferred_at is not null
        and p_verified_date_of_birth>=(e.transferred_at at time zone 'UTC')::date
        and not exists(select 1 from private.claim_reviews other where other.id<>r.id
          and other.matched_embryo_id=e.id and private.claim_review_open_v1(other))
        and not exists(select 1 from public.future_person_claims f where f.embryo_id=e.id
          and f.status in('submitted','reviewing','owner_notice','objected','approved'))
        and not exists(select 1 from public.retention_rows rr join public.purge_manifests m on m.retention_row_id=rr.id
          where rr.target_kind='subject' and rr.target_id=s.id
            and (m.physical_purge_started_at is not null or m.batch_cursor>0 or m.state in('executing','complete')))
      then kind:='unclaimed_keyless'; end if;
    else authority:=jsonb_build_object('branch','none'); end if;
  end if;

  -- Reuse the exact own-JWT case projection and its existing minimal read
  -- audit. No request nonce or matching authority is stored by this lookup.
  body:=private.read_claim_review_case_v1(r.id);
  body:=body||jsonb_build_object('caseKind',kind,'allowedDecisions',
    to_jsonb(private.claim_review_decisions_allowed_v1(kind)),'parentIdentityCiphertext',null);
  return jsonb_build_object('case',body,'scope',jsonb_build_object(
    'reviewId',r.id,'reviewerAccountId',reviewer.account_id,'authSessionId',reviewer.auth_session_id,
    'reviewRevision',r.review_revision,'assignmentRevision',assignment,
    'accountAuthRevision',reviewer.account_auth_session_revision,'originatingSessionRevision',reviewer.session_revision,
    'photoIdentity',jsonb_build_object('id',photo.id,'sha256',photo.sha256),
    'birthRecord',jsonb_build_object('id',birth.id,'sha256',birth.sha256),
    'comparisonReceiptDigest',encode(extensions.digest(convert_to(jsonb_build_object(
      'kind',kind,'authority',authority,'verifiedDateOfBirth',p_verified_date_of_birth,
      'identitySet',identity_set,'profileSet',profile_set)::text,'UTF8'),'sha256'),'hex')),
    'profile',case when kind='unclaimed_keyless' then jsonb_build_object(
      'profileId',fi.id,'embryoId',fi.embryo_id,'identityRevision',fi.identity_revision,
      'ciphertext',encode(fi.parent_supplied_ciphertext,'hex'),'wrappedKey',encode(fi.wrapped_profile_key,'hex')) else null end);
end $$;
revoke all on function private.verify_keyless_claim_documents_v1(uuid,bigint,date,jsonb,jsonb)
  from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.verify_keyless_claim_documents_v1(uuid,bigint,date,jsonb,jsonb) to authenticated;
create function public.verify_keyless_claim_documents_v1(
  p_review_id uuid,p_review_revision bigint,p_verified_date_of_birth date,p_identity_hmac_set jsonb,p_profile_hmac_set jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.verify_keyless_claim_documents_v1(p_review_id,p_review_revision,p_verified_date_of_birth,p_identity_hmac_set,p_profile_hmac_set);
$$;
revoke all on function public.verify_keyless_claim_documents_v1(uuid,bigint,date,jsonb,jsonb)
  from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.verify_keyless_claim_documents_v1(uuid,bigint,date,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
