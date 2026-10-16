-- Native own-JWT entry to the already rehearsed documentary transaction.
-- A pending notice grants no claimant/custody/release authority. Original
-- independently wrapped minimum/document keys and fixed clocks remain exact.
do $native_keyless_predecessor$
declare predecessor oid:=to_regprocedure('private.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)');
begin
  if predecessor is null or to_regprocedure('public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)') is not null
    or not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
      join pg_roles owner_role on owner_role.oid=p.proowner
      where p.oid=predecessor and owner_role.rolname='postgres' and lang.lanname='plpgsql'
        and p.prosecdef and p.prokind='f' and not p.proretset and p.prorettype='jsonb'::regtype
        and p.pronargs=15 and p.pronargdefaults=0 and p.provariadic=0 and p.proallargtypes is null
        and p.proargnames=array['p_review','p_revision','p_nonce_hash','p_reason','p_attestation','p_verified_birth',
          'p_parent_link_confirmed','p_identity_set','p_profile_set','p_comparison_receipt','p_minimum_ciphertext',
          'p_minimum_wrapped_key','p_contact_id','p_contact_ciphertext','p_contact_set']::text[]
        and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
        and md5(p.prosrc)='ffab04c15fb5ac220e5604d8e3f703b4')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
      where has_function_privilege(role_name,predecessor,'execute'))
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=predecessor and acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner) then
    raise exception using errcode='55000',message='native keyless prepare predecessor differs';end if;
end;
$native_keyless_predecessor$;

create function public.prepare_keyless_owner_notice_v1(
  p_review uuid,p_revision bigint,p_nonce_hash text,p_reason bytea,p_attestation bytea,
  p_verified_birth date,p_parent_link_confirmed boolean,p_identity_set jsonb,p_profile_set jsonb,p_comparison_receipt text,
  p_minimum_ciphertext bytea,p_minimum_wrapped_key bytea,
  p_contact_id uuid,p_contact_ciphertext bytea,p_contact_set jsonb
) returns jsonb language sql security definer set search_path='' set lock_timeout='250ms' as $$
  select private.prepare_keyless_owner_notice_v1(p_review,p_revision,p_nonce_hash,p_reason,p_attestation,
    p_verified_birth,p_parent_link_confirmed,p_identity_set,p_profile_set,p_comparison_receipt,
    p_minimum_ciphertext,p_minimum_wrapped_key,p_contact_id,p_contact_ciphertext,p_contact_set);
$$;
revoke all on function public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.prepare_keyless_owner_notice_v1(uuid,bigint,text,bytea,bytea,date,boolean,jsonb,jsonb,text,bytea,bytea,uuid,bytea,jsonb) to authenticated;

-- The latest complete canonical detach body is a reviewed predecessor. No
-- older body, account-only implementation or unknown source planner is used.
do $keyless_detach_predecessor$
begin
  if not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
    join pg_roles owner_role on owner_role.oid=p.proowner
    where p.oid=to_regprocedure('private.detach_future_person_subject_v1(uuid)')
      and owner_role.rolname='postgres' and lang.lanname='plpgsql' and p.prosecdef
      and p.prokind='f' and not p.proretset and p.pronargs=1 and p.pronargdefaults=0
      and p.provariadic=0 and p.proallargtypes is null and p.prorettype='uuid'::regtype
      and p.proargnames=array['p_claim_id']::text[] and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
      and md5(p.prosrc)='2bcb8951ed6c790d72a4e09a56c7eabf')
    or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
      where has_function_privilege(role_name,'private.detach_future_person_subject_v1(uuid)','execute'))
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=to_regprocedure('private.detach_future_person_subject_v1(uuid)')
        and acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner) then
    raise exception using errcode='55000',message='keyless detach predecessor differs';end if;
end;
$keyless_detach_predecessor$;

-- Compare the complete real constraint with PostgreSQL's own canonical
-- expression of the exact eight reviewed predecessor decisions. This empty
-- transaction-local owner relation is dropped before any durable DDL.
create temporary table keyless_decision_predecessor_owner_v1(decision text constraint keyless_decision_shape check(decision in(
  'approve-record-key','approve-recovery-key','approve-claimed-unbound-no-key-recovery','keyless-document-match',
  'needs-more-information','reject','uphold-objection','overrule-objection')));
do $keyless_decision_predecessor$
begin
 if not exists(select 1 from pg_constraint c join pg_class relation on relation.oid=c.conrelid
  join pg_roles owner_role on owner_role.oid=relation.relowner
  where c.conrelid='private.claim_review_decisions'::regclass and c.conname='claim_review_decisions_decision_check'
   and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred
   and owner_role.rolname='postgres'
   and pg_get_constraintdef(c.oid)=(select pg_get_constraintdef(expected.oid) from pg_constraint expected
    where expected.conrelid='pg_temp.keyless_decision_predecessor_owner_v1'::regclass and expected.conname='keyless_decision_shape')) then
  raise exception using errcode='55000',message='keyless decision predecessor differs';end if;
end;
$keyless_decision_predecessor$;
drop table pg_temp.keyless_decision_predecessor_owner_v1;

alter table private.claim_review_decisions drop constraint claim_review_decisions_decision_check;
alter table private.claim_review_decisions add constraint claim_review_decisions_decision_check check(decision in(
  'approve-record-key','approve-recovery-key','approve-claimed-unbound-no-key-recovery','keyless-document-match',
  'needs-more-information','reject','uphold-objection','overrule-objection','approve-release','refuse-release'));

create or replace function private.detach_future_person_subject_v1(p_claim_id uuid)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  s public.subjects; e public.embryos; c public.future_person_claims;
  cp public.future_person_claimant_principals; sp public.subject_principals;
  r private.claim_reviews; d private.claim_review_decisions; i private.future_person_claim_intakes;
  x private.embryo_canonical_sources; v_reviewer record; v_agreements jsonb; v_now timestamptz;
begin
  select * into c from public.future_person_claims where id=p_claim_id;
  select * into e from public.embryos where id=c.embryo_id;
  if c.id is null or e.id is null then raise exception using errcode='42501',message='claim review unavailable'; end if;
  -- Common retention-purge lock order starts with the target subject.
  select * into s from public.subjects where id=e.subject_id for update;
  perform private.cancel_unstarted_claim_subject_purge_v1(s.id);
  select * into c from public.future_person_claims where id=p_claim_id for update;
  select * into e from public.embryos where id=c.embryo_id for update;
  select * into r from private.claim_reviews where id=c.id for update;
  select * into d from private.claim_review_decisions where review_id=r.id order by review_revision desc limit 1;
  select * into i from private.future_person_claim_intakes where id=r.id for update;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  select * into cp from public.future_person_claimant_principals where claim_id=c.id and status='current' for update;
  select * into sp from public.subject_principals where id=cp.principal_id for update;
  v_now:=clock_timestamp();
  if s.id is null or s.subject_class<>'embryo' or s.lifecycle not in ('active','restricted')
    or s.owner_account_id is null or s.claimant_principal_id is not null
    or e.cohort_id is distinct from s.cohort_id or e.status<>'transferred'
    or e.future_person_state<>'reserved_for_future_person' or e.transferred_at is null
    or c.status<>'approved' or c.claimant_account_id is not null
    or r.id is null or r.state<>'release_queued' or r.matched_embryo_id is distinct from e.id
    or d.id is null or d.review_revision+1<>r.review_revision
    or not ((c.claim_method='record_key' and r.case_kind='record_key' and r.mode='record-key'
        and r.deadline>v_now and d.decision='approve-record-key')
      or (c.claim_method='keyless_documentary' and r.case_kind='unclaimed_keyless' and r.mode='keyless'
        and d.decision='approve-release' and exists(select 1 from public.future_person_claim_review_packages package
          join public.future_person_claim_notices stored_notice on stored_notice.claim_id=package.claim_id
            and stored_notice.owner_account_id is not null
          join private.claim_review_assignments assigned on assigned.review_id=r.id and assigned.status='current'
            and assigned.reviewer_account_id=d.reviewer_account_id and assigned.review_operation='claim-release'
          where package.claim_id=c.id and package.review_id=r.id and package.subject_id=s.id
            and package.state in('open','objected') and package.wrapped_comparison_key is not null
            and stored_notice.delivered_at is not null and stored_notice.notice_deadline<=d.decided_at
            and private.keyless_claim_deadline_v1(c.id)>d.decided_at
            and not exists(select 1 from public.future_person_claim_objections objection
              where objection.claim_id=c.id and objection.status<>'overruled'))))
    or d.documentary_attestation_ciphertext is null or not d.recorded_parent_link_confirmed
    or d.verified_date_of_birth is null or d.verified_date_of_birth<date '1900-01-01'
    or (d.verified_date_of_birth+interval '18 years')::date>(v_now at time zone 'UTC')::date
    or d.verified_date_of_birth<(e.transferred_at at time zone 'UTC')::date
    or v_reviewer.account_id is null or d.reviewer_account_id is distinct from v_reviewer.account_id
    or d.auth_session_id is distinct from v_reviewer.auth_session_id
    or cp.id is null or sp.subject_id is distinct from s.id or sp.principal_kind<>'future_person'
    or sp.status<>'active' or sp.account_id is not null or c.claimant_principal_id is distinct from sp.id
    or not exists(select 1 from private.claim_review_assignments a where a.review_id=r.id
      and a.status='current' and a.reviewer_account_id=v_reviewer.account_id)
    or (c.claim_method='record_key' and not exists(select 1 from public.future_person_record_key_hashes h where h.embryo_id=e.id
      and h.status='current' and private.claim_hash_matches_v1(h.key_hash,i.key_hash))) then
    raise exception using errcode='42501',message='claim review unavailable';
  end if;
  if private.claim_decision_document_received_v1(r,d,private.claim_review_document_v1(r,r.photo_document_id)) is distinct from true
    or private.claim_decision_document_received_v1(r,d,private.claim_review_document_v1(r,r.birth_record_document_id)) is distinct from true then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  select * into x from private.embryo_canonical_sources where subject_id=s.id and embryo_id=e.id for update;
  if x.file_id is null or not exists(select 1 from public.genome_files f where f.id=x.file_id
    and f.subject_id=s.id and f.user_id=s.owner_account_id and f.cohort_id is null and not f.is_cohort_file)
    or (select count(*) from public.genome_files where subject_id=s.id)<>1
    or (select count(*) from private.embryo_canonical_source_parts where file_id=x.file_id)<>x.part_count
    or (select count(*) from public.embryo_variants where source_file_id=x.file_id)<>x.variant_count
    or exists(select 1 from public.embryo_variants where source_file_id=x.file_id
      and (embryo_id<>x.embryo_id or source_binding_fingerprint<>x.source_sha256 or chromosome not between 1 and 22))
    or exists(select 1 from public.user_variants where subject_id=s.id)
    or exists(select 1 from public.user_prs where subject_id=s.id)
    or exists(select 1 from public.chats where subject_id=s.id)
    or exists(select 1 from public.generated_exports where target_kind='subject' and target_id=s.id and status='ready') then
    -- These legacy account-only artifacts need their exact registered purge
    -- executor before this transition can claim completion; never orphan them.
    raise exception using errcode='42501',message='claim review unavailable';
  end if;
  -- Capture genuine immutable signed records before parent cleanup. A missing
  -- historical field remains missing; neither current profiles nor review
  -- identity documents can supply an invented earlier signing name or role.
  select coalesce(jsonb_agg(jsonb_build_object('version','future-person-agreement-v2',
    'artifactKey',a.artifact_key,'artifactVersion',a.artifact_version,
    'bodySha256',a.artifact_body_sha256,'bodyMarkdown',body.body_markdown,
    'recomputedBodySha256',encode(extensions.digest(convert_to(body.body_markdown,'UTF8'),'sha256'),'hex'),
    'statementKeys',a.statement_keys,'signedAt',a.signed_at,'signaturePurpose',a.purpose,
    'recordedRole',case a.purpose when 'embryo-upload-parent-class' then 'parent'
      when 'embryo-upload-uploader-class' then 'uploader' when 'embryo-parentage-attestation' then 'parent'
      when 'embryo-disposition-rights-attestation' then 'parent' when 'embryo-single-parent-basis-attestation' then 'parent'
      when 'future-person-charter-acknowledgement' then 'owner' when 'disclosure-acknowledgement' then 'owner' else null end,
    'signingNameCiphertext',case when a.signing_name_encrypted is null then null else encode(a.signing_name_encrypted,'hex') end,
    'signaturePrincipalPseudonym',encode(extensions.digest(a.signer_principal_id::text,'sha256'),'hex'),
    'jurisdictionCode',a.jurisdiction_code,'jurisdictionRevision',a.jurisdiction_revision,
    'attestations',(select coalesce(jsonb_agg(jsonb_build_object('kind',t.kind,'statementKeys',t.statement_keys,
      'affirmed',t.affirmed,'revision',t.attestation_revision,'affirmedAt',t.affirmed_at) order by t.id),'[]')
      from public.attestations t where t.signature_id=a.id and t.principal_id=a.signer_principal_id
        and t.target_kind=a.target_kind and t.target_id=a.target_id),
    'review',jsonb_build_object('kind',d.decision,'decidedAt',d.decided_at,'outcome','approved',
      'reviewerPrincipalPseudonym',encode(extensions.digest(d.reviewer_account_id::text,'sha256'),'hex')))
    order by a.artifact_key,a.artifact_version,a.id),'[]'::jsonb) into v_agreements
    from public.consent_signatures a join public.consent_artifacts body
      on body.artifact_key=a.artifact_key and body.version=a.artifact_version
    where ((a.target_kind='cohort' and a.target_id=s.cohort_id) or (a.target_kind='cohort_draft'
        and a.target_id=(select draft_id from public.embryo_cohorts where id=s.cohort_id)))
      and a.artifact_key in ('consent.upload-embryo','charter.future-person','attestation.embryo-parentage',
        'attestation.embryo-disposition-rights','attestation.embryo-single-parent-basis','disclosure.insurance-and-discrimination');
  if (select count(distinct a->>'artifactKey') from jsonb_array_elements(v_agreements) a
    where a->>'artifactKey' in ('consent.upload-embryo','charter.future-person'))<>2 then
    raise exception using errcode='42501',message='claim review unavailable'; end if;
  insert into private.future_person_custody_slices(subject_id,claimant_principal_id,source_file_id,
    historical_cohort_id,source_sha256,source_membership_sha256,publication_revision,agreement_slice,approved_at)
  values(s.id,cp.id,x.file_id,x.cohort_id,x.source_sha256,x.membership_sha256,x.publication_revision,v_agreements,v_now);
  insert into public.future_person_claimant_identity_hmacs(claimant_principal_id,identity_hmac,hmac_key_revision,expires_at)
    values(cp.id,d.verified_identity_hmac,d.identity_hmac_revision,null);
  update public.subject_relationships set status='revoked',ended_at=v_now,relationship_revision=relationship_revision+1
    where subject_id=s.id and status in ('pending','current');
  update public.subject_account_bindings set status='revoked',ended_at=v_now,binding_revision=binding_revision+1
    where subject_id=s.id and status in ('pending','current');
  update public.purpose_grants set revoked_at=v_now,revocation_reason='claim-detached'
    where target_kind='subject' and target_id=s.id and revoked_at is null;
  update public.subject_consents set revoked_at=v_now,revocation_reason='superseded'
    where subject_id=s.id and revoked_at is null;
  update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
    where target_kind='subject' and target_id=s.id and status='active';
  -- A parent cohort job's immutable source set contained this member. Its
  -- entire old capability is stale; only a freshly resolved remaining set
  -- can authorize a later job. This deletes no sibling source or result.
  update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,
    claim_expires_at=null,claimed_by=null where status in('queued','running')
    and (file_id=x.file_id or (source_binding_kind='cohort-source-set' and source_binding_id=s.cohort_id));
  update public.subject_principals set status='detached',principal_revision=principal_revision+1
    where subject_id=s.id and id<>sp.id and status in ('pending','active');
  update public.subjects set lifecycle='claimed_unbound',claimant_principal_id=cp.id,
    owner_account_id=null,subject_account_id=null,cohort_id=null,
    earliest_claim_at=(d.verified_date_of_birth+interval '18 years') at time zone 'UTC',
    subject_binding_revision=subject_binding_revision+1,lifecycle_revision=lifecycle_revision+1,updated_at=v_now
    where id=s.id;
  update public.embryos set cohort_id=null,status='claimed_unbound',disposition_revision=disposition_revision+1 where id=e.id;
  update public.genome_files set user_id=null where id=x.file_id;
  update public.future_person_record_key_hashes set status='revoked',ended_at=v_now where embryo_id=e.id and status='current';
  update public.future_person_record_key_print_rights set status='revoked' where embryo_id=e.id and status='unconsumed';
  update public.future_person_identity set state='shredded',parent_supplied_ciphertext='\\x00',
    identity_hmac=encode(extensions.gen_random_bytes(32),'hex'),ended_at=v_now
    where embryo_id=e.id and state='current';
  update public.future_person_claim_sessions set state='cancelled',ended_at=v_now
    where embryo_id=e.id and id<>c.intake_session_id and state in ('draft','submitted');
  return cp.id;
end $$;

-- This operation-specific reader knows the already assigned claim, never a
-- candidate supplied by the browser. Its raw envelope is opened only by the
-- own-session server route, which returns the existing closed case contract.
create function private.read_keyless_current_review_v1(p_review uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare reviewer record; r private.claim_reviews; k public.future_person_claim_review_packages;
  n public.future_person_claim_notices; assignment private.claim_review_assignments;
  initial_decision private.claim_review_decisions; claim public.future_person_claims;
  profile public.future_person_identity; contact public.encrypted_contact_references; objection uuid;
begin
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null then raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into k from public.future_person_claim_review_packages where review_id=p_review;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=p_review order by id for update;
  select * into r from private.claim_reviews where id=p_review for update;
  select * into k from public.future_person_claim_review_packages where review_id=r.id for update;
  select * into assignment from private.claim_review_assignments where review_id=r.id and status='current'
    and reviewer_account_id=reviewer.account_id;
  select * into claim from public.future_person_claims where id=r.id;
  select * into n from public.future_person_claim_notices where claim_id=r.id and owner_account_id is not null;
  select * into initial_decision from private.claim_review_decisions where review_id=r.id and decision='keyless-document-match'
    order by review_revision limit 1;
  if r.id is null or r.mode<>'keyless' or r.case_kind<>'unclaimed_keyless' or r.state<>'approved_pending_owner_notice'
    or k.id is null or k.claim_id is distinct from r.id or k.state not in('open','objected')
    or k.comparison_ciphertext is null or k.wrapped_comparison_key is null
    or assignment.review_id is null or assignment.review_operation not in('documentary','claim-objection','claim-release')
    or claim.id is null or claim.claim_method<>'keyless_documentary' or claim.status not in('owner_notice','objected')
    or claim.embryo_id is distinct from r.matched_embryo_id or initial_decision.id is null or n.id is null
    or not exists(select 1 from public.embryos embryo where embryo.id=claim.embryo_id and embryo.subject_id=k.subject_id)
    or private.keyless_claim_deadline_v1(r.id) is null then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  select stored.id into objection from public.future_person_claim_objections stored
    where stored.claim_id=r.id and stored.notice_id=n.id and stored.status='submitted';
  if assignment.review_operation='claim-objection' and objection is null then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into profile from public.future_person_identity where id=claim.identity_id
    and id=(k.authority_binding->>'profileId')::uuid and embryo_id=claim.embryo_id;
  select stored_contact.* into contact from public.encrypted_contact_references stored_contact
    join public.subject_principals principal on principal.id=stored_contact.principal_id
      and principal.id=claim.claimant_principal_id and principal.subject_id=k.subject_id
      and principal.status='pending' and principal.principal_kind='future_person'
    where stored_contact.id=k.claimant_delivery_reference_id and stored_contact.status='current'
      and stored_contact.authority_revision=principal.principal_revision and stored_contact.contact_ciphertext is not null;
  insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision)
    values(r.id,reviewer.account_id,reviewer.auth_session_id,r.review_revision);
  perform private.append_legal_audit_event('claim.review.read',null,'api.future-person-claim-review','accepted','{}');
  return jsonb_build_object('operation',assignment.review_operation,'claimId',r.id,'reviewRevision',r.review_revision,
    'assignmentRevision',assignment.assignment_revision,'accountAuthRevision',reviewer.account_auth_session_revision,
    'originatingSessionRevision',reviewer.session_revision,'noticeId',n.id,'noticeRevision',n.notice_revision,
    'noticeDeadline',n.notice_deadline,'deadline',private.keyless_claim_deadline_v1(r.id),
    'documentaryRevision',initial_decision.review_revision,'photoDocumentId',r.photo_document_id,'photoSha256',r.photo_sha256,
    'birthDocumentId',r.birth_record_document_id,'birthSha256',r.birth_record_sha256,
    'comparisonCiphertext',encode(k.comparison_ciphertext,'hex'),'wrappedComparisonKey',encode(k.wrapped_comparison_key,'hex'),
    'objectionId',objection,'current',private.keyless_owner_notice_current_v1(r.id),
    'profile',case when profile.state='current' and profile.profile_format_version=1 and octet_length(profile.wrapped_profile_key)=72
      then jsonb_build_object('profileId',profile.id,'embryoId',profile.embryo_id,'identityRevision',profile.identity_revision,
        'ciphertext',encode(profile.parent_supplied_ciphertext,'hex'),'wrappedKey',encode(profile.wrapped_profile_key,'hex')) else null end,
    'contact',case when contact.id is not null then jsonb_build_object('id',contact.id,
      'ciphertext',encode(contact.contact_ciphertext,'hex')) else null end);
end $$;
revoke all on function private.read_keyless_current_review_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;
create function public.read_keyless_current_review_v1(p_review uuid) returns jsonb
language sql security definer set search_path='' set lock_timeout='250ms' as $$
  select private.read_keyless_current_review_v1(p_review);
$$;
revoke all on function public.read_keyless_current_review_v1(uuid) from public,anon,inherit_upload_only,service_role;
grant execute on function public.read_keyless_current_review_v1(uuid) to authenticated;

-- One finite owner-only clock seam proves this exact execution core at the
-- synthetic boundary. Every native/public path captures clock_timestamp()
-- itself. No JWT, service role, flag, request field or alternate clock can
-- invoke this seam; it is not elapsed provider or human evidence.
create function private.decide_keyless_release_at_v1(
  p_review uuid,p_review_revision bigint,p_notice_revision bigint,p_decision text,p_refusal_code text,
  p_nonce_hash text,p_reason bytea,p_attestation bytea,p_verified_birth date,p_identity_set jsonb,p_profile_set jsonb,
  p_contact uuid,p_contact_ciphertext bytea,p_contact_set jsonb,p_now timestamptz
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare reviewer record; r private.claim_reviews; k public.future_person_claim_review_packages;
  n public.future_person_claim_notices; claim public.future_person_claims; assignment private.claim_review_assignments;
  fi public.future_person_identity; photo private.claim_documents; birth private.claim_documents;
  principal public.subject_principals; contact public.encrypted_contact_references;
  identity_set jsonb; profile_set jsonb; contact_set jsonb; key_revision bigint; candidates uuid[];
  deadline timestamptz; current_notice boolean; cp uuid; outcome text; subject_audit uuid;
begin
  if p_now is null or not isfinite(p_now) or p_decision is null or p_decision not in('approve-release','refuse-release')
    or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_reason is null or octet_length(p_reason) not between 29 and 16384 then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into reviewer from private.claim_reviewer_step_up_v1();
  if reviewer.account_id is null then raise exception using errcode='42501',message='claim review unavailable';end if;
  select * into k from public.future_person_claim_review_packages where review_id=p_review;
  perform 1 from public.subjects where id=k.subject_id for update;
  perform 1 from public.retention_rows where target_kind='claim' and target_id=p_review order by id for update;
  select * into r from private.claim_reviews where id=p_review for update;
  select * into k from public.future_person_claim_review_packages where review_id=r.id for update;
  select * into n from public.future_person_claim_notices where claim_id=r.id and owner_account_id is not null for update;
  select * into claim from public.future_person_claims where id=r.id for update;
  select * into assignment from private.claim_review_assignments where review_id=r.id and status='current'
    and reviewer_account_id=reviewer.account_id and review_operation='claim-release';
  if r.id is null or r.mode<>'keyless' or r.case_kind<>'unclaimed_keyless' or r.state<>'approved_pending_owner_notice'
    or assignment.review_id is null or k.id is null or k.claim_id is distinct from r.id or k.state not in('open','objected')
    or k.wrapped_comparison_key is null or n.id is null or claim.id is null or claim.claim_method<>'keyless_documentary'
    or claim.status not in('owner_notice','objected') or claim.embryo_id is distinct from r.matched_embryo_id
    or p_review_revision is distinct from r.review_revision or p_notice_revision is distinct from n.notice_revision
    or p_now<r.created_at or not exists(select 1 from private.claim_review_reads receipt
      where receipt.review_id=r.id and receipt.reviewer_account_id=reviewer.account_id
        and receipt.auth_session_id=reviewer.auth_session_id and receipt.review_revision=r.review_revision
        and receipt.document_id is null) then
    raise exception using errcode='42501',message='claim review unavailable';end if;
  photo:=private.claim_review_document_v1(r,r.photo_document_id);birth:=private.claim_review_document_v1(r,r.birth_record_document_id);
  deadline:=private.keyless_claim_deadline_v1(r.id);current_notice:=private.keyless_owner_notice_current_v1(r.id);
  if p_decision='approve-release' then
    if p_refusal_code is not null or p_attestation is null or octet_length(p_attestation) not between 29 and 16384
      or p_verified_birth is null or p_verified_birth<date '1900-01-01'
      or (p_verified_birth+interval '18 years')::date>(p_now at time zone 'UTC')::date
      or not current_notice or deadline is null or deadline<=p_now or n.delivered_at is null or n.notice_deadline>p_now
      or photo.id is null or birth.id is null
      or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,photo)
      or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,birth)
      or exists(select 1 from public.future_person_claim_objections stored where stored.claim_id=r.id and stored.status<>'overruled') then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    lock table public.future_person_identity in share row exclusive mode;
    lock table public.future_person_claimant_identity_hmacs in share row exclusive mode;
    identity_set:=private.resolve_hmac_set_v1('contact',null,p_identity_set);
    profile_set:=private.resolve_hmac_set_v1('contact',null,p_profile_set);
    contact_set:=private.resolve_hmac_set_v1('contact',null,p_contact_set);
    key_revision:=private.hmac_active_revision_v1('contact');
    select * into fi from public.future_person_identity where id=claim.identity_id for update;
    select * into principal from public.subject_principals where id=claim.claimant_principal_id for update;
    select * into contact from public.encrypted_contact_references where id=k.claimant_delivery_reference_id for update;
    if identity_set is null or profile_set is null or contact_set is null or fi.id is null or fi.state<>'current'
      or fi.fixed_expires_at<=p_now or principal.id is null or principal.status<>'pending'
      or principal.subject_id is distinct from k.subject_id or principal.principal_kind<>'future_person' or principal.account_id is not null
      or contact.id is null or contact.status<>'current' or contact.principal_id is distinct from principal.id
      or contact.authority_revision is distinct from principal.principal_revision or contact.contact_ciphertext is null
      or not private.claim_hash_matches_v1(contact.contact_hmac,contact_set->>contact.key_revision::text)
      or p_contact is null or p_contact=contact.id or p_contact_ciphertext is null or octet_length(p_contact_ciphertext) not between 29 and 16384
      or exists(select 1 from public.future_person_claimant_identity_hmacs stored
        join public.future_person_claimant_principals claimant on claimant.id=stored.claimant_principal_id and claimant.status='current'
        join public.subject_principals subject_principal on subject_principal.id=claimant.principal_id and subject_principal.status='active'
        where stored.expires_at is null and private.claim_hash_matches_v1(stored.identity_hmac,identity_set->>stored.hmac_key_revision::text)) then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    -- Re-run the original exact parent-profile candidate cardinality under
    -- the same two identity-table locks as the initial determination.
    select array_agg(distinct stored_profile.id order by stored_profile.id) into candidates
      from public.future_person_identity stored_profile join public.embryos embryo on embryo.id=stored_profile.embryo_id
      join public.subjects subject on subject.id=embryo.subject_id
      where stored_profile.state='current' and stored_profile.profile_format_version=1
        and octet_length(stored_profile.wrapped_profile_key)=72 and stored_profile.fixed_expires_at>p_now
        and subject.subject_class='embryo' and subject.lifecycle in('active','restricted')
        and subject.claimant_principal_id is null and subject.owner_account_id is not null and embryo.cohort_id=subject.cohort_id
        and exists(select 1 from jsonb_each_text(stored_profile.match_indexes) index_value
          where private.claim_hash_matches_v1(index_value.value,profile_set->>index_value.key));
    if cardinality(candidates) is distinct from 1 or candidates[1] is distinct from fi.id then
      raise exception using errcode='42501',message='claim review unavailable';end if;
  else
    if p_refusal_code is null or p_refusal_code not in('documentary_evidence_insufficient','identity_profile_conflict',
      'notice_delivery_failed','claim_deadline_expired','record_state_changed')
      or num_nonnulls(p_attestation,p_verified_birth,p_identity_set,p_contact,p_contact_ciphertext,p_contact_set)<>0
      or ((p_refusal_code='identity_profile_conflict') is distinct from (p_profile_set is not null)) then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    if p_refusal_code in('documentary_evidence_insufficient','identity_profile_conflict') and (photo.id is null or birth.id is null
      or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,photo)
      or not private.claim_document_fully_read_v1(r.id,reviewer.account_id,birth)) then
      raise exception using errcode='42501',message='claim review unavailable';end if;
    if p_refusal_code='identity_profile_conflict' then
      profile_set:=private.resolve_hmac_set_v1('contact',null,p_profile_set);
      select * into fi from public.future_person_identity where id=claim.identity_id for update;
      if profile_set is null or fi.id is null or fi.state<>'current' or fi.profile_format_version is distinct from 1
        or fi.wrapped_profile_key is null or exists(select 1 from jsonb_each_text(fi.match_indexes) index_value
          where private.claim_hash_matches_v1(index_value.value,profile_set->>index_value.key)) then
        raise exception using errcode='42501',message='claim review unavailable';end if;
    end if;
    if (p_refusal_code='notice_delivery_failed' and not exists(select 1 from public.mail_outbox mail
        left join public.mail_deliveries delivery on delivery.outbox_id=mail.id where mail.id=n.outbox_id
          and (mail.state='failed' or delivery.status in('bounced','complained','reviewed_undeliverable')
            or (n.delivered_at is null and k.delivery_deadline<=p_now))))
      or (p_refusal_code='claim_deadline_expired' and (deadline is null or deadline>p_now))
      or (p_refusal_code='record_state_changed' and exists(select 1 from public.subjects subject
        join public.embryos embryo on embryo.id=claim.embryo_id and embryo.subject_id=subject.id
        join public.embryo_cohorts cohort on cohort.id=embryo.cohort_id and cohort.id=subject.cohort_id
        join public.profiles owner_profile on owner_profile.id=subject.owner_account_id
        where subject.id=k.subject_id and subject.lifecycle in('active','restricted') and subject.claimant_principal_id is null
          and subject.subject_account_id is null and subject.owner_account_id=(k.authority_binding->>'ownerAccountId')::uuid
          and subject.lifecycle_revision=(k.authority_binding->>'subjectLifecycleRevision')::bigint
          and subject.subject_binding_revision=(k.authority_binding->>'subjectBindingRevision')::bigint
          and embryo.disposition_revision=(k.authority_binding->>'embryoDispositionRevision')::bigint
          and embryo.status='transferred' and embryo.future_person_state='reserved_for_future_person'
          and cohort.status in('active','restricted') and cohort.owner_account_id=subject.owner_account_id
          and cohort.lifecycle_revision=(k.authority_binding->>'cohortLifecycleRevision')::bigint
          and owner_profile.deletion_requested_at is null
          and not exists(select 1 from public.retention_rows retention join public.purge_manifests manifest
            on manifest.retention_row_id=retention.id where retention.target_kind='subject' and retention.target_id=subject.id
              and (manifest.physical_purge_started_at is not null or manifest.batch_cursor>0 or manifest.state in('executing','complete'))))) then
      raise exception using errcode='42501',message='claim review unavailable';end if;
  end if;
  insert into private.claim_review_decisions(review_id,review_revision,decision,reviewer_account_id,auth_session_id,
    photo_document_id,photo_sha256,birth_record_document_id,birth_record_sha256,reason_ciphertext,nonce_hash,decided_at,
    documentary_attestation_ciphertext,verified_identity_hmac,identity_hmac_revision,verified_date_of_birth,recorded_parent_link_confirmed)
    values(r.id,r.review_revision,p_decision,reviewer.account_id,reviewer.auth_session_id,r.photo_document_id,r.photo_sha256,
      r.birth_record_document_id,r.birth_record_sha256,p_reason,p_nonce_hash,p_now,p_attestation,
      case when p_decision='approve-release' then identity_set->>key_revision::text end,
      case when p_decision='approve-release' then key_revision end,p_verified_birth,p_decision='approve-release');
  if p_decision='refuse-release' then
    perform private.close_keyless_notice_v1(r.id,case p_refusal_code when 'notice_delivery_failed' then 'notice_delivery_failed'
      when 'claim_deadline_expired' then 'claim_deadline_expired' when 'record_state_changed' then 'record_state_changed' else 'refused' end);
    perform private.append_legal_audit_event('claim.resolved',null,'api.future-person-claim-release','refused',jsonb_build_object('outcome',p_refusal_code));
    return jsonb_build_object('claimId',r.id,'state','refused','reviewRevision',r.review_revision+1);
  end if;
  update public.subject_principals set status='active' where id=principal.id;
  update public.future_person_claims set status='approved',decided_at=p_now,claim_revision=claim_revision+1 where id=claim.id;
  insert into public.future_person_claimant_principals(claim_id,principal_id,claimant_revision,status)
    values(claim.id,principal.id,claim.claimant_revision,'current') returning id into cp;
  update private.claim_reviews set state='release_queued',review_revision=review_revision+1 where id=r.id;
  perform private.detach_future_person_subject_v1(r.id);
  perform private.queue_future_person_release_v1(r.id,p_contact,p_contact_ciphertext,contact_set);
  subject_audit:=private.future_person_audit_selector_v1(k.subject_id);
  if subject_audit is null then raise exception using errcode='42501',message='claim review unavailable';end if;
  -- Final resolution erases the minimum, both document keys, statement and
  -- old temporary contact. Only the new approved handoff contact survives.
  update public.future_person_claim_review_packages set state='approved',comparison_ciphertext=null,
    wrapped_comparison_key=null,comparison_key_shredded_at=p_now where id=k.id;
  update public.future_person_claim_objections set status='expired',statement_ciphertext=null,wrapped_statement_key=null,
    statement_key_shredded_at=p_now,review_reason_ciphertext=null where claim_id=r.id and notice_id=n.id and status='overruled';
  update public.encrypted_contact_references set status='shredded',contact_ciphertext=null,
    contact_hmac=encode(extensions.gen_random_bytes(32),'hex'),ended_at=p_now where id=k.claimant_delivery_reference_id;
  delete from public.contact_hmac_indexes where contact_reference_id=k.claimant_delivery_reference_id;
  update public.rights_sessions set status='revoked',ended_at=p_now where purpose='future-person-claim-objection' and target_id=n.id and status='active';
  delete from public.rights_nonces where rights_session_id in(select id from public.rights_sessions
    where purpose='future-person-claim-objection' and target_id=n.id);
  update public.token_hashes set status='revoked',ended_at=p_now where candidate_id=n.candidate_id and status in('current','consumed');
  update public.token_candidates set state='invalidated' where id=n.candidate_id and state in('pending','issued');
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='claim_resolved'
    where target_kind='claim' and target_id=r.id and state in('queued','claimed');
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    terminal_outcome_code='claim_approved',completed_at=p_now where target_kind='claim' and target_id=r.id
      and retention_id in('future-person.keyless-notice-release-62d','future-person.owner-notice-30d','future-person.claim-objection-review-30d')
      and status in('pending','retry','claimed');
  update public.retention_rows set state='complete',ended_at=p_now where target_kind='claim' and target_id=r.id
    and retention_id in('future-person.keyless-notice-release-62d','future-person.owner-notice-30d','future-person.claim-objection-review-30d')
    and state in('scheduled','active');
  update private.claim_reviews set state='closed',resolved_at=p_now where id=r.id;
  perform private.shred_resolved_future_person_review_v1(r.id);
  perform private.append_legal_audit_event('claim.resolved',subject_audit,'api.future-person-claim-release','accepted',jsonb_build_object('outcome','approved'));
  return jsonb_build_object('claimId',r.id,'state','release_queued','reviewRevision',r.review_revision+1);
end $$;
revoke all on function private.decide_keyless_release_at_v1(uuid,bigint,bigint,text,text,text,bytea,bytea,date,jsonb,jsonb,uuid,bytea,jsonb,timestamptz)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.decide_keyless_release_v1(
  p_review uuid,p_review_revision bigint,p_notice_revision bigint,p_decision text,p_refusal_code text,
  p_nonce_hash text,p_reason bytea,p_attestation bytea,p_verified_birth date,p_identity_set jsonb,p_profile_set jsonb,
  p_contact uuid,p_contact_ciphertext bytea,p_contact_set jsonb
) returns jsonb language sql security definer set search_path='' set lock_timeout='250ms' as $$
  select private.decide_keyless_release_at_v1(p_review,p_review_revision,p_notice_revision,p_decision,p_refusal_code,
    p_nonce_hash,p_reason,p_attestation,p_verified_birth,p_identity_set,p_profile_set,p_contact,p_contact_ciphertext,p_contact_set,clock_timestamp());
$$;
revoke all on function public.decide_keyless_release_v1(uuid,bigint,bigint,text,text,text,bytea,bytea,date,jsonb,jsonb,uuid,bytea,jsonb)
  from public,anon,inherit_upload_only,service_role;
grant execute on function public.decide_keyless_release_v1(uuid,bigint,bigint,text,text,text,bytea,bytea,date,jsonb,jsonb,uuid,bytea,jsonb) to authenticated;

-- One additive attributed resolution code, issued only after this transaction
-- persists the exact new custody selector and own-current reviewer decision.
-- No legacy event is reattributed and every original empty context stays closed.
do $keyless_audit_predecessor$
begin
 if not exists(select 1 from pg_proc p join pg_language lang on lang.oid=p.prolang
  join pg_roles owner_role on owner_role.oid=p.proowner
  where p.oid=to_regprocedure('private.future_person_export_audit_v1(uuid)')
   and owner_role.rolname='postgres' and lang.lanname='plpgsql' and p.prosecdef
   and p.prokind='f' and not p.proretset and p.pronargs=1 and p.pronargdefaults=0
   and p.provariadic=0 and p.proallargtypes is null and p.prorettype='jsonb'::regtype
   and p.proargnames=array['p_subject']::text[] and p.proconfig=array['search_path=""']::text[]
   and md5(p.prosrc)='f8ea0f86c430daa3ea13b5f4320e21da')
  or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   where p.oid=to_regprocedure('private.future_person_export_audit_v1(uuid)')
    and acl.privilege_type='EXECUTE' and acl.grantee<>p.proowner)
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
   where has_function_privilege(role_name,'private.future_person_export_audit_v1(uuid)','execute')) then
  raise exception using errcode='55000',message='keyless audit predecessor differs';end if;
end;
$keyless_audit_predecessor$;
create or replace function private.future_person_export_audit_v1(p_subject uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;started timestamptz;item public.legal_audit_log;total bigint:=0;
 state_hash bytea:=extensions.digest(convert_to('claimant-ledger-v1','UTF8'),'sha256');
begin
 perform private.assert_future_person_subject_custody_v1(p_subject);
 select audit_principal_id into actor from private.future_person_custody_slices where subject_id=p_subject;
 if actor is null then
  return jsonb_build_object('metadata',jsonb_build_object('attribution','unrecorded','attributionStartedAt',null),
   'count',0,'membershipSha256',encode(state_hash,'hex'));
 end if;
 actor:=private.future_person_audit_selector_v1(p_subject);
 -- The same non-personal reference clock used by the canonical account
 -- ledger member, never a column from the excluded actor-pseudonym store.
 select started_at into strict started from private.legal_audit_attribution_config where singleton;
 for item in select * from public.legal_audit_log where audit_principal_id=actor order by seq loop
  if item.seq>9007199254740991 or (
   (item.coded_context='{}'::jsonb and (
    (item.event_code='claimant.analysis_stopped' and item.route_id='api.future-person-analysis-stop' and item.outcome_code='accepted')
    or (item.event_code='claimant.deletion_requested' and item.route_id='api.future-person-delete' and item.outcome_code='accepted')
    or (item.event_code='claimant.deleted' and item.route_id='api.future-person-delete' and item.outcome_code='purged')))
   or (item.event_code='claim.resolved' and item.route_id='api.future-person-claim-release' and item.outcome_code='accepted'
    and item.coded_context='{"outcome":"approved"}'::jsonb)) is not true then
    raise exception using errcode='55000',message='export_audit_unavailable';end if;
  -- Complete actual ledger identity/order/content binds internally. Neither
  -- the actor nor chain hashes become a member field or a caller selector.
  state_hash:=extensions.digest(state_hash||convert_to(to_jsonb(item)::text,'UTF8'),'sha256');total:=total+1;
 end loop;
 return jsonb_build_object('metadata',jsonb_build_object('attribution','assigned','attributionStartedAt',started),
  'count',total,'membershipSha256',encode(state_hash,'hex'));
end $$;
revoke all on function private.future_person_export_audit_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

notify pgrst,'reload schema';
