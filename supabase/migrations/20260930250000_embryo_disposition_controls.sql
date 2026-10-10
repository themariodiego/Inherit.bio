-- A parent's disposition right is independent of analytical grants and QC.
-- The page reads authority without a write; the unchanged disposition writer
-- is reached only after this same current matrix is rechecked under locks.
create function private.embryo_disposition_authority_v1(p_account uuid,p_session uuid,p_embryo uuid,p_mutation boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.embryos%rowtype; s public.subjects%rowtype; c public.embryo_cohorts%rowtype;
  d public.embryo_cohort_drafts%rowtype; b public.embryo_basis_bindings%rowtype; a record;
  ss auth.sessions%rowtype; actor uuid; parents uuid[]; actual uuid[]; expected uuid[];
  kind text; parent_id uuid; v_artifact_key text; signature public.consent_signatures%rowtype;
  proof jsonb; signatures uuid[];
begin
  perform private.validate_sensitive_account_session_v1(p_account,p_session);
  select subject_id into e.subject_id from public.embryos where id=p_embryo;
  if p_mutation then
    select * into s from public.subjects where id=e.subject_id for update nowait;
    select * into c from public.embryo_cohorts where id=s.cohort_id for update nowait;
    select * into e from public.embryos where id=p_embryo for update nowait;
  else
    select * into s from public.subjects where id=e.subject_id for share nowait;
    select * into c from public.embryo_cohorts where id=s.cohort_id for share nowait;
    select * into e from public.embryos where id=p_embryo for share nowait;
  end if;
  if e.id is null or s.id is null or c.id is null or e.subject_id<>s.id or e.cohort_id<>c.id
    or s.cohort_id<>c.id or s.owner_account_id is distinct from c.owner_account_id
    or s.subject_class<>'embryo' or s.subject_account_id is not null
    or s.lifecycle not in ('quarantined','active','restricted')
    or c.status not in ('upload_pending','ingesting','active')
    or exists(select 1 from public.future_person_claims f where f.embryo_id=e.id and f.status='approved')
  then raise exception using errcode='42501',message='embryo unavailable';end if;
  select * into ss from auth.sessions where id=p_session and user_id=p_account for share nowait;
  perform 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_account and p.deletion_requested_at is null and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of p,u nowait;
  if not found or ss.id is null or (ss.not_after is not null and ss.not_after<=clock_timestamp())
  then raise exception using errcode='42501',message='embryo unavailable';end if;
  select * into d from public.embryo_cohort_drafts where id=c.draft_id for share nowait;
  select * into b from public.embryo_basis_bindings where cohort_id=c.id for share nowait;
  if d.state is distinct from 'finalized' or b.cohort_id is null
    or (d.basis_case,d.basis_revision,b.basis_case,b.basis_revision,b.participant_set_revision)
      is distinct from (c.basis_case,c.basis_revision,c.basis_case,c.basis_revision,c.participant_set_revision)
  then raise exception using errcode='42501',message='embryo unavailable';end if;
  perform 1 from public.attestation_contradictions where cohort_id=c.id and resolved_at is null for share nowait;
  if found then raise exception using errcode='42501',message='embryo unavailable';end if;
  perform 1 from public.draft_participant_slots where embryo_draft_id=d.id order by id for share nowait;
  select * into a from private.resolve_embryo_basis_authority_v1(d.id);
  perform 1 from public.embryo_participant_sets where cohort_id=c.id order by set_kind,principal_id for share nowait;
  foreach kind in array array['required_upload_principals','disposition_authorities','notice_recipients',
    'record_key_recipients','attribution_principals'] loop
    expected:=case kind when 'required_upload_principals' then a.required_upload_principals
      when 'disposition_authorities' then a.disposition_authorities when 'notice_recipients' then a.notice_recipients
      when 'record_key_recipients' then a.record_key_recipients else a.attribution_principals end;
    select coalesce(array_agg(x order by x),'{}'::uuid[]) into expected from unnest(expected) x;
    select coalesce(array_agg(ps.principal_id order by ps.principal_id),'{}'::uuid[]) into actual
      from public.embryo_participant_sets ps where ps.cohort_id=c.id and ps.set_kind=kind
        and ps.revoked_at is null and ps.set_revision=c.participant_set_revision;
    if actual is distinct from expected or exists(select 1 from public.embryo_participant_sets ps
      where ps.cohort_id=c.id and ps.set_kind=kind and ps.revoked_at is null and ps.set_revision<>c.participant_set_revision)
    then raise exception using errcode='42501',message='embryo unavailable';end if;
  end loop;
  select array_agg(sp.id order by sp.id) into parents from public.subject_principals sp
    where sp.id=any(a.disposition_authorities) and sp.account_id=p_account and sp.status='active'
      and sp.principal_kind='genetic_parent';
  if cardinality(parents) is distinct from 1 then
    raise exception using errcode='42501',message='not a disposition authority';end if;
  actor:=parents[1];
  -- Freeze the genuine finalized signature identity matrix and recheck only
  -- the parent right evidence. No embryo_analysis grant or nonparent uploader
  -- consent is needed to exercise the legal disposition right.
  perform 1 from public.consent_signatures where target_kind='cohort_draft' and target_id=d.id order by id for share nowait;
  perform 1 from public.consent_artifacts ca where ca.artifact_key in ('attestation.embryo-parentage',
    'attestation.embryo-disposition-rights','attestation.embryo-single-parent-basis') order by ca.artifact_key,ca.version for share nowait;
  select coalesce(array_agg(cs.id order by cs.id),'{}'::uuid[]) into signatures
    from public.consent_signatures cs where cs.target_kind='cohort_draft' and cs.target_id=d.id;
  if b.artifact_matrix_fingerprint is distinct from encode(extensions.digest(convert_to(
    concat_ws(':',c.basis_case,c.basis_revision::text,array_to_string(signatures,',')),'UTF8'),'sha256'),'hex')
  then raise exception using errcode='42501',message='embryo unavailable';end if;
  foreach parent_id in array a.disposition_authorities loop
    foreach v_artifact_key in array array['attestation.embryo-parentage','attestation.embryo-disposition-rights',
      'attestation.embryo-single-parent-basis'] loop
      if v_artifact_key='attestation.embryo-single-parent-basis' and c.basis_case='true_two_parent' then continue;end if;
      select cs.* into signature from public.consent_signatures cs
        join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
          and ca.body_sha256=cs.artifact_body_sha256
        join public.subject_principals sp on sp.id=cs.signer_principal_id
        join public.profiles p on p.id=sp.account_id
        join auth.users parent_user on parent_user.id=p.id
        where cs.target_kind='cohort_draft' and cs.target_id=d.id and cs.signer_principal_id=parent_id
          and cs.artifact_key=v_artifact_key and sp.status='active' and sp.principal_kind='genetic_parent'
          and cs.signer_account_id=sp.account_id and cs.jurisdiction_code=p.jurisdiction_code
          and cs.jurisdiction_revision=p.jurisdiction_revision
          and p.deletion_requested_at is null and parent_user.deleted_at is null
          and (parent_user.banned_until is null or parent_user.banned_until<=clock_timestamp())
          and cs.purpose=case v_artifact_key when 'attestation.embryo-parentage' then 'embryo-parentage-attestation'
            when 'attestation.embryo-disposition-rights' then 'embryo-disposition-rights-attestation'
            else 'embryo-single-parent-basis-attestation' end
          and cs.statement_keys=private.embryo_statement_keys_v1(v_artifact_key,'parent')
          and ca.superseded_at is null and ca.published_at<=clock_timestamp()
          and ca.effective_on<=timezone('UTC',clock_timestamp())::date
          and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
        for share of cs,ca,sp,p,parent_user nowait;
      if not found then raise exception using errcode='42501',message='embryo unavailable';end if;
      perform 1 from public.attestations at where at.signature_id=signature.id and at.principal_id=parent_id
        and at.target_kind='cohort_draft' and at.target_id=d.id and at.affirmed
        and at.statement_keys=signature.statement_keys and at.kind=case v_artifact_key
          when 'attestation.embryo-parentage' then 'genetic_parent'
          when 'attestation.embryo-disposition-rights' then 'disposition_rights' else 'single_parent_authority' end for share nowait;
      if not found then raise exception using errcode='42501',message='embryo unavailable';end if;
      if v_artifact_key='attestation.embryo-single-parent-basis' and b.case_artifact_signature_id is distinct from signature.id
      then raise exception using errcode='42501',message='embryo unavailable';end if;
    end loop;
  end loop;
  if c.basis_case in ('parent_deceased','sole_legal_authority') then
    perform 1 from public.legal_reviews lr join public.reviewed_evidence re on re.review_id=lr.id
      where lr.id=b.legal_review_id and re.id=b.reviewed_evidence_id and lr.decision='approved'
        and lr.target_kind='single_parent_basis' and lr.target_id=d.id and re.purged_at is null
        and re.evidence_kind=case c.basis_case when 'parent_deceased' then 'parent-death-certificate' else 'sole-disposition-authority' end
        and not exists(select 1 from public.legal_reviews newer where newer.target_kind=lr.target_kind
          and newer.target_id=lr.target_id and newer.review_revision>lr.review_revision) for share of lr,re nowait;
    if not found then raise exception using errcode='42501',message='embryo unavailable';end if;
  end if;
  if c.basis_case='identified_donor_consented' then
    raise exception using errcode='42501',message='embryo unavailable';end if;
  if c.basis_case='anonymous_donor' then
    perform 1 from public.embryo_donor_attributions where cohort_id=c.id and revoked_at is null for share nowait;
    if (select count(*) from public.embryo_donor_attributions where cohort_id=c.id and revoked_at is null
      and classification='anonymous' and donor_principal_id is null and signature_id is null
      and attribution_revision=c.donor_attribution_revision)<>1 then
      raise exception using errcode='42501',message='embryo unavailable';end if;
  end if;
  proof:=jsonb_build_array('embryo-disposition-current-v1',c.id,e.id,s.id,actor,c.basis_case,c.basis_revision,
    c.participant_set_revision,c.recipient_set_revision,c.lifecycle_revision,s.lifecycle_revision,
    e.disposition_revision,b.case_artifact_signature_id,b.reviewed_evidence_id,b.legal_review_id,signatures);
  return jsonb_build_object('embryoId',e.id,'label',e.display_label,'actorPrincipal',actor,
    'mode',a.disposition_mode,'currentDisposition',case when e.status='stored' then 'stored' else 'unknown' end,
    'basisFingerprint',encode(extensions.digest(convert_to(proof::text,'UTF8'),'sha256'),'hex'));
exception when lock_not_available then raise exception using errcode='42501',message='embryo unavailable';
end $$;
revoke all on function private.embryo_disposition_authority_v1(uuid,uuid,uuid,boolean)
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Preserve all registered request/state/refusal/clock/card/notice behavior in
-- the existing writer; current authority is the only additional prerequisite.
alter function public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)
  set schema private;
alter function private.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)
  rename to record_embryo_disposition_before_current_authority_v1;
revoke all on function private.record_embryo_disposition_before_current_authority_v1(uuid,uuid,uuid,text,text,uuid,text)
  from public,anon,authenticated,inherit_upload_only,service_role;
create function public.record_embryo_disposition_v1(p_account_id uuid,p_session_id uuid,p_embryo_id uuid,
  p_action text,p_disposition text,p_proposal_id uuid,p_token_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action is null or p_disposition is null or p_action not in ('propose','confirm','commit-single-authority')
    or p_disposition not in ('stored','transferred','donated','discarded')
    or (p_action='confirm')<>(p_proposal_id is not null)
  then raise exception using errcode='22023',message='invalid disposition request';end if;
  perform private.embryo_disposition_authority_v1(p_account_id,p_session_id,p_embryo_id,true);
  return private.record_embryo_disposition_before_current_authority_v1(p_account_id,p_session_id,p_embryo_id,
    p_action,p_disposition,p_proposal_id,p_token_nonce);
end $$;
revoke all on function public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text) to service_role;

create function public.embryo_disposition_controls_v1(p_account uuid,p_session uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x record; authority jsonb; proposal public.embryo_disposition_proposals%rowtype;
  items jsonb:='[]'; scanned integer:=0; cursor_id uuid; next_id uuid;
begin
  for x in select e.id from public.embryos e join public.embryo_cohorts c on c.id=e.cohort_id
    where c.status in ('upload_pending','ingesting','active')
      and e.status in ('pending','qc_pass','qc_marginal','qc_fail','excluded','stored')
      and (p_after is null or e.id>p_after) and exists(select 1 from public.subject_principals sp
        where sp.id=any(private.embryo_cohort_set_v1(c.id,'disposition_authorities'))
          and sp.account_id=p_account and sp.status='active' and sp.principal_kind='genetic_parent')
    order by e.id limit 65 loop
    scanned:=scanned+1;if scanned>64 then next_id:=cursor_id;exit;end if;cursor_id:=x.id;
    begin authority:=private.embryo_disposition_authority_v1(p_account,p_session,x.id,false);
    exception when insufficient_privilege or object_not_in_prerequisite_state then continue;end;
    if exists(select 1 from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id
      join public.embryo_cohorts c on c.id=e.cohort_id where p.embryo_id=x.id
        and p.status='pending' and p.expires_at>clock_timestamp()
        and (p.basis_revision,p.authority_set_revision) is distinct from (c.basis_revision,c.participant_set_revision))
    then continue;end if;
    select * into proposal from public.embryo_disposition_proposals p where p.embryo_id=x.id
      and p.status='pending' and p.expires_at>clock_timestamp()
      and p.basis_revision=(select basis_revision from public.embryo_cohorts where id=(select cohort_id from public.embryos where id=x.id))
      and p.authority_set_revision=(select participant_set_revision from public.embryo_cohorts where id=(select cohort_id from public.embryos where id=x.id))
      for share nowait;
    items:=items||jsonb_build_array(jsonb_build_object('embryoId',x.id,'label',authority->'label',
      'mode',authority->'mode','currentDisposition',authority->'currentDisposition',
      'proposal',case when proposal.id is null then 'null'::jsonb else jsonb_build_object('id',proposal.id,
        'disposition',proposal.disposition,'expiresAt',proposal.expires_at,
        'callerIsProposer',proposal.proposer_principal_id=(authority->>'actorPrincipal')::uuid) end));
  end loop;
  return jsonb_build_object('items',items,'nextCursor',next_id);
end $$;
revoke all on function public.embryo_disposition_controls_v1(uuid,uuid,uuid)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.embryo_disposition_controls_v1(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
