-- Narrow claimant export source prerequisite. This adds no store, public
-- export route, job, nonce, Storage write or READY exception. Existing account
-- archive publication/late-write holds remain in force. Client roles cannot
-- read the source RPC; every service read proves the current exact claimant.
-- Historical fields are copied from real signed records, not reconstructed.

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
    or c.status<>'approved' or c.claim_method<>'record_key' or c.claimant_account_id is not null
    or r.id is null or r.state<>'release_queued' or r.deadline<=v_now
    or r.case_kind<>'record_key' or r.mode<>'record-key' or r.matched_embryo_id is distinct from e.id
    or d.id is null or d.decision<>'approve-record-key' or d.review_revision+1<>r.review_revision
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
    or not exists(select 1 from public.future_person_record_key_hashes h where h.embryo_id=e.id
      and h.status='current' and private.claim_hash_matches_v1(h.key_hash,i.key_hash)) then
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

-- Digest the complete current source/member set with constant working memory.
-- This is an authority receipt, not the ZIP/member SHA and not a substitute
-- for verifying the real provider bytes in the eventual archive producer.
create function private.future_person_export_capture_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 rs public.rights_sessions; s public.subjects; x private.embryo_canonical_sources;
 custody private.future_person_custody_slices; f public.genome_files; item record;
 state_hash bytea; count_variants bigint:=0; count_scores bigint:=0; count_figures bigint:=0;
 count_reports bigint:=0; count_qc bigint:=0; parts uuid[]; origin_hash text; receipt text; agreements jsonb;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,false);
 if rs.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=rs.target_id;
 select * into custody from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=custody.source_file_id and subject_id=s.id;
 select * into f from public.genome_files where id=x.file_id;
 select array_agg(m.part_id order by m.sequence) into parts from private.embryo_canonical_source_parts m where m.file_id=x.file_id;
 if x.file_id is null or f.id is null or f.user_id is not null or f.subject_id<>s.id
  or f.cohort_id is not null or f.is_cohort_file or f.status<>'stored' or f.source_publication_state<>'published' or f.source_publication_revision<>x.publication_revision or f.source_sha256<>x.source_sha256
  or (select count(*) from public.genome_files where subject_id=s.id)<>1
  or cardinality(parts) is distinct from x.part_count
  or private.embryo_canonical_source_sha256_v1(x.file_id) is distinct from x.source_sha256
  or private.embryo_canonical_membership_sha256_v1(parts) is distinct from x.membership_sha256
  or exists(select 1 from private.embryo_canonical_parts p where p.id=any(parts)
    and (p.state<>'landed' or p.provider_version is null or p.provider_etag is null or p.observed_sha256<>p.sha256)) then
   raise exception using errcode='42501',message='not_found'; end if;
 agreements:=custody.agreement_slice;
 -- Old abbreviated custody snapshots are not silently relabeled complete.
 -- The original signed body must hash to the recorded signed body, and a
 -- genuine signing-name ciphertext plus individually affirmed statements
 -- must exist. Original identity-document bytes are never a fallback.
 if jsonb_array_length(agreements)=0 or exists(select 1 from jsonb_array_elements(agreements) a where
   a->>'version' is distinct from 'future-person-agreement-v2'
   or a->>'bodySha256' is distinct from a->>'recomputedBodySha256'
   or encode(extensions.digest(convert_to(a->>'bodyMarkdown','UTF8'),'sha256'),'hex') is distinct from a->>'bodySha256'
   or a->>'signingNameCiphertext' is null or length(a->>'signingNameCiphertext')<58
   or (a->>'signingNameCiphertext')!~'^[0-9a-f]+$' or length(a->>'signingNameCiphertext')%2<>0
   or jsonb_typeof(a->'statementKeys') is distinct from 'array' or jsonb_array_length(a->'statementKeys')=0
   or a->>'recordedRole' is null or a->>'signaturePurpose' is null
   or not(case a->>'artifactKey' when 'consent.upload-embryo' then a->>'signaturePurpose' in ('embryo-upload-parent-class','embryo-upload-uploader-class')
     when 'attestation.embryo-parentage' then a->>'signaturePurpose'='embryo-parentage-attestation'
     when 'attestation.embryo-disposition-rights' then a->>'signaturePurpose'='embryo-disposition-rights-attestation'
     when 'attestation.embryo-single-parent-basis' then a->>'signaturePurpose'='embryo-single-parent-basis-attestation'
     when 'charter.future-person' then a->>'signaturePurpose'='future-person-charter-acknowledgement'
     when 'disclosure.insurance-and-discrimination' then a->>'signaturePurpose'='disclosure-acknowledgement' else false end)
   or jsonb_typeof(a->'attestations') is distinct from 'array'
   or ((a->>'artifactKey' like 'attestation.%' or a->>'artifactKey'='charter.future-person') and jsonb_array_length(a->'attestations')=0)
   or exists(select 1 from jsonb_array_elements(a->'attestations') t where t->>'affirmed' is distinct from 'true'
      or jsonb_typeof(t->'statementKeys') is distinct from 'array' or jsonb_array_length(t->'statementKeys')=0)) then
  raise exception using errcode='55000',message='export_historical_agreement_unavailable'; end if;
 origin_hash:=encode(extensions.digest(jsonb_build_object('version','future-person-export-origin-v1',
   'session',rs.id,'principal',rs.principal_id,'purpose',rs.purpose,'target',rs.target_id,
   'authorityRevision',rs.authority_revision,'expiresAt',rs.expires_at,'tokenHashId',rs.token_hash_id,
   'lifecycleRevision',s.lifecycle_revision,'bindingRevision',s.binding_revision)::text,'sha256'),'hex');
 state_hash:=extensions.digest(jsonb_build_object('origin',origin_hash,'custody',to_jsonb(custody),
   'source',to_jsonb(x),'file',to_jsonb(f))::text,'sha256');
 for item in select * from public.embryo_variants where embryo_id=x.embryo_id or source_file_id=x.file_id order by id loop
  if item.embryo_id<>x.embryo_id or item.source_file_id<>x.file_id or item.chromosome not between 1 and 22
   or item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('variants:'||to_jsonb(item)::text,'UTF8'),'sha256');
  count_variants:=count_variants+1;
 end loop;
 if count_variants<>x.variant_count then raise exception using errcode='55000',message='export_source_unavailable'; end if;
 for item in select * from public.embryo_qc where embryo_id=x.embryo_id order by embryo_id loop
  state_hash:=extensions.digest(state_hash||convert_to('qc:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_qc:=count_qc+1;
 end loop;
 for item in select * from public.embryo_scores where embryo_id=x.embryo_id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('scores:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_scores:=count_scores+1;
 end loop;
 for item in select fig.* from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
   where score.embryo_id=x.embryo_id order by fig.id loop
  state_hash:=extensions.digest(state_hash||convert_to('figures:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_figures:=count_figures+1;
 end loop;
 for item in select * from public.report_artifacts where subject_id=s.id order by id loop
  if item.source_binding_fingerprint<>x.source_sha256 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
  state_hash:=extensions.digest(state_hash||convert_to('reports:'||to_jsonb(item)::text,'UTF8'),'sha256'); count_reports:=count_reports+1;
 end loop;
 receipt:=encode(state_hash,'hex');
 return jsonb_build_object('authority',jsonb_build_object('principalId',rs.principal_id,'subjectId',s.id,
   'originBinding',origin_hash,'authorityReceipt',receipt,'lifecycleRevision',s.lifecycle_revision,
   'bindingRevision',s.binding_revision,'credentialRevision',rs.authority_revision,'expiresAt',rs.expires_at),
  'source',jsonb_build_object('fileId',x.file_id,'subjectId',s.id,'referenceBuild',x.reference_build,
    'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
    'variantCount',count_variants,'publishedAt',x.published_at),
  'membership',jsonb_build_object('variants',count_variants,'qualityReports',count_qc,'scores',count_scores,
    'figures',count_figures,'reports',count_reports,'agreements',jsonb_array_length(agreements)));
end $$;

-- Bounded service-only keyset source reader. It accepts no subject/file/account
-- selectors and creates no operation nonce, job, capability, cookie or row.
-- A stale receipt refuses before any byte. Recapture is repeated after reading
-- a page, so a future adapter cannot release buffered bytes after revocation.
create function public.future_person_export_source_v1(p_operation text,p_session_hash text,
 p_authority_receipt text default null,p_after_variant_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; page jsonb; last_id bigint; n integer; result jsonb;
begin
 if p_operation is null or p_operation not in ('capture','variants','agreements') or p_session_hash is null
  or p_session_hash!~'^[0-9a-f]{64}$' or (p_operation='capture' and (p_authority_receipt is not null or p_after_variant_id is not null))
  or (p_operation<>'capture' and (p_authority_receipt is null or p_authority_receipt!~'^[0-9a-f]{64}$'))
  or (p_operation<>'variants' and p_after_variant_id is not null) or p_after_variant_id<0 then
   raise exception using errcode='22023',message='invalid_request'; end if;
 snapshot:=private.future_person_export_capture_v1(p_session_hash);
 if p_operation='capture' then return snapshot; end if;
 if snapshot#>>'{authority,authorityReceipt}' is distinct from p_authority_receipt then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='agreements' then
  select c.agreement_slice into result from private.future_person_custody_slices c
   where c.subject_id=(snapshot#>>'{authority,subjectId}')::uuid;
 else
  select coalesce(jsonb_agg(v.row order by v.id),'[]'),count(*),max(v.id) into page,n,last_id from (
   select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,'referenceAllele',reference_allele,
    'alternateAllele',alternate_allele,'genotype',genotype) row from public.embryo_variants
   where source_file_id=(snapshot#>>'{source,fileId}')::uuid and (p_after_variant_id is null or id>p_after_variant_id)
   order by id limit 500) v;
  result:=jsonb_build_object('rows',page,'nextAfterId',last_id::text,'count',n);
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable'; end if;
 if private.future_person_export_capture_v1(p_session_hash)#>>'{authority,authorityReceipt}' is distinct from p_authority_receipt then
  raise exception using errcode='42501',message='not_found'; end if;
 return result;
end $$;
revoke all on function private.future_person_export_capture_v1(text),
 public.future_person_export_source_v1(text,text,text,bigint) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.future_person_export_source_v1(text,text,text,bigint) to service_role;
