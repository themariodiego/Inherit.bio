-- Actual claimant archive prerequisites, TEST-LOCAL. Existing whole-archive
-- READY/account and late-write holds remain; no public delivery is activated.
-- Existing canonical sources keep a NULL proof. No legacy calls are read,
-- copied, inferred or backfilled. Only an exact current producer can stamp the
-- additive new-source proof; immutable source guards then freeze it.
alter table private.embryo_canonical_sources add column call_immutability_proof text
 check(call_immutability_proof is null or call_immutability_proof='exact-staged-calls-v1');
create function private.stamp_canonical_call_proof_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.worker_jobs w join public.embryo_ingest_sessions sess on sess.id=new.session_id
  where w.id=new.worker_job_id and w.kind='split_cohort_vcf' and w.status='running'
   and w.attempts=new.attempt and w.claim_expires_at>clock_timestamp() and sess.status='processing'
   and sess.cohort_id=new.cohort_id) then
  raise exception using errcode='42501',message='embryo_source_unavailable';end if;
 new.call_immutability_proof:='exact-staged-calls-v1';return new;
end $$;
create trigger zz_canonical_call_proof before insert on private.embryo_canonical_sources
 for each row execute function private.stamp_canonical_call_proof_v1();
revoke all on function private.stamp_canonical_call_proof_v1() from public,anon,authenticated,service_role,inherit_upload_only;

create function private.embryo_call_value_hash_v1(p_chr integer,p_position bigint,p_ref text,p_alt text,p_genotype text)
returns text language sql immutable strict security definer set search_path='' as $$
 select encode(extensions.digest(private.length_prefix_utf8(p_chr::text)||private.length_prefix_utf8(p_position::text)
  ||private.length_prefix_utf8(p_ref)||private.length_prefix_utf8(p_alt)||private.length_prefix_utf8(p_genotype),'sha256'),'hex');
$$;
revoke all on function private.embryo_call_value_hash_v1(integer,bigint,text,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
create index embryo_split_exact_call_lookup on private.embryo_split_variants(session_id,sample_ordinal,worker_job_id,attempt,
 private.embryo_call_value_hash_v1(chromosome,position,reference_allele,alternate_allele,genotype));

create function private.guard_immutable_embryo_calls_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare x private.embryo_canonical_sources; s public.subjects;
begin
 if tg_op='UPDATE' then
  select * into x from private.embryo_canonical_sources where file_id=old.source_file_id;
  if x.call_immutability_proof is null then return new;end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception using errcode='55000',message='canonical_calls_immutable';end if;return new;
 end if;
 if tg_op='DELETE' then
  select subj.* into s from public.genome_files f join public.subjects subj on subj.id=f.subject_id where f.id=old.source_file_id for update of subj;
  if s.lifecycle in ('claimed_unbound','claimed_bound') or s.claimant_principal_id is not null then
   raise exception using errcode='42501',message='embryo_source_unavailable';end if;return old;
 end if;
 select * into x from private.embryo_canonical_sources where file_id=new.source_file_id and embryo_id=new.embryo_id;
 if x.call_immutability_proof is null then return new;end if;
 if x.file_id is null or new.source_binding_fingerprint<>x.source_sha256 or not exists(
  select 1 from public.worker_jobs w join public.embryo_ingest_sessions sess on sess.id=x.session_id
   where w.id=x.worker_job_id and w.kind='split_cohort_vcf' and w.status='running' and w.attempts=x.attempt
    and w.claim_expires_at>clock_timestamp() and sess.status='processing'
    and exists(select 1 from private.embryo_split_variants v where v.session_id=x.session_id and v.sample_ordinal=x.sample_ordinal
      and v.worker_job_id=x.worker_job_id and v.attempt=x.attempt
      and private.embryo_call_value_hash_v1(v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype)
        =private.embryo_call_value_hash_v1(new.chromosome,new.position,new.reference_allele,new.alternate_allele,new.genotype)
      and (v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype) is not distinct from
        (new.chromosome,new.position,new.reference_allele,new.alternate_allele,new.genotype))) then
  raise exception using errcode='42501',message='embryo_source_unavailable';end if;
 return new;
end $$;
revoke all on function private.guard_immutable_embryo_calls_v1() from public,anon,authenticated,service_role,inherit_upload_only;
-- The existing analysis-stop refusal runs first and retains its exact code.
create trigger zz_embryo_canonical_calls_fence before insert or update or delete on public.embryo_variants
 for each row execute function private.guard_immutable_embryo_calls_v1();

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

create or replace function private.future_person_export_capture_v1(p_session_hash text)
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
 if x.call_immutability_proof is distinct from 'exact-staged-calls-v1' then
  raise exception using errcode='55000',message='export_source_immutability_unproven';end if;
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
   'lifecycleRevision',s.lifecycle_revision,'bindingRevision',s.subject_binding_revision)::text,'sha256'),'hex');
 state_hash:=extensions.digest(jsonb_build_object('origin',origin_hash,'custody',to_jsonb(custody),
   'source',to_jsonb(x),'file',to_jsonb(f))::text,'sha256');
 -- Canonical publication inserted every exact staged call under the immutable
 -- copy guard, and the approval transaction checked complete cardinality.
 -- Claimed rows cannot be inserted, updated or partially deleted thereafter.
 -- This permits constant source checking without rescanning ten million calls
 -- for each bounded page. Canonical parts/source remain independently frozen.
 count_variants:=x.variant_count;
 state_hash:=extensions.digest(state_hash||convert_to('immutable-canonical-calls-v1:'||x.source_sha256||':'||count_variants,'UTF8'),'sha256');
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
   'bindingRevision',s.subject_binding_revision,'credentialRevision',rs.authority_revision,'expiresAt',rs.expires_at),
  'source',jsonb_build_object('fileId',x.file_id,'subjectId',s.id,'referenceBuild',x.reference_build,
    'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
    'variantCount',count_variants,'publishedAt',x.published_at),
  'membership',jsonb_build_object('variants',count_variants,'qualityReports',count_qc,'scores',count_scores,
    'figures',count_figures,'reports',count_reports,'agreements',jsonb_array_length(agreements)));
end $$;

-- Preserve the whole current account reader by delegation, including every
-- existing graph/unsupported-partition/history/chat refusal. Only the closed
-- independent Future origin is added. No parent/uploader origin is relabeled.
alter function private.export_archive_authority_v1(jsonb,text,uuid) rename to export_archive_account_authority_v1;
create function private.export_archive_authority_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;rs public.rights_sessions;v_principal_revision bigint;
begin
 if p_origin->>'kind'='account' then return private.export_archive_account_authority_v1(p_origin,p_target_kind,p_target_id);end if;
 if p_origin is null or jsonb_typeof(p_origin)<>'object' or (select count(*) from jsonb_object_keys(p_origin))<>2
  or not(p_origin ?& array['kind','sessionHash']) or p_origin->>'kind' is distinct from 'independent-rights'
  or p_target_kind is distinct from 'subject' or p_target_id is null then
  raise exception using errcode='0A000',message='export_origin_projection_unavailable';end if;
 rs:=private.future_person_rights_session_v1(p_origin->>'sessionHash',true);
 if rs.id is null then raise exception using errcode='42501',message='not_found';end if;
 c:=private.future_person_export_capture_v1(p_origin->>'sessionHash');
 if (c#>>'{authority,subjectId}')::uuid<>p_target_id then raise exception using errcode='42501',message='not_found';end if;
 select p.principal_revision into v_principal_revision from public.subject_principals p where id=(c#>>'{authority,principalId}')::uuid;
 return jsonb_build_object('principalId',c#>>'{authority,principalId}',
  'principalHash',encode(extensions.digest(c#>>'{authority,principalId}','sha256'),'hex'),
  'originBinding',c#>>'{authority,originBinding}','authorityReceipt',c#>>'{authority,authorityReceipt}',
  'lifecycleRevision',c#>'{authority,lifecycleRevision}','principalGraphRevision',v_principal_revision,
  'subjectPartitions',jsonb_build_array(p_target_id),'fileCount',1);
end $$;
revoke all on function private.export_archive_authority_v1(jsonb,text,uuid),private.export_archive_account_authority_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Accountless means this one registered rights-origin shape; it is never an
-- owner-null account export or an invented auth.users row.
alter table public.generated_exports add column origin_kind text not null default 'account';
alter table public.generated_exports alter column account_id drop not null;
alter table public.generated_exports add constraint generated_exports_origin_owner_shape check(
 (origin_kind='account' and account_id is not null)
 or (origin_kind='independent-rights' and account_id is null and target_kind='subject' and export_kind='subject_raw'
  and purpose='raw.export' and archive_version='archive-segments-v1' and subject_partitions=jsonb_build_array(target_id)));
create function private.guard_export_origin_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.origin_kind is distinct from old.origin_kind then raise exception using errcode='23514',message='export origin immutable';end if;return new;
end $$;
create trigger generated_export_origin_immutable before update on public.generated_exports for each row execute function private.guard_export_origin_v1();
create function private.assert_independent_export_origin_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare j private.export_archive_jobs;c jsonb;
begin
 if new.origin_kind='account' then return null;end if;
 select * into j from private.export_archive_jobs where export_id=new.id;
 if j.export_id is null or j.route_id<>'api.future-person-export' or j.export_contract<>'approved-future-person-export-v1'
  or j.origin->>'kind' is distinct from 'independent-rights' then raise exception using errcode='23514',message='invalid independent export';end if;
 c:=private.export_archive_authority_v1(j.origin,new.target_kind,new.target_id);
 if c->>'principalId' is distinct from new.requester_principal_id::text or c->>'authorityReceipt' is distinct from j.authority_receipt
  or c->'subjectPartitions' is distinct from new.subject_partitions or not exists(select 1 from private.export_archive_nonce_uses n
    where n.export_id=new.id and n.operation='create') then raise exception using errcode='23514',message='invalid independent export';end if;
 return null;
end $$;
create constraint trigger independent_export_origin_complete after insert on public.generated_exports
 deferrable initially deferred for each row execute function private.assert_independent_export_origin_v1();
revoke all on function private.guard_export_origin_v1(),private.assert_independent_export_origin_v1() from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.export_archive_nonce_v1(p_export uuid,p_operation text,p_envelope jsonb,p_csrf_binding text)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
declare e public.generated_exports%rowtype; j private.export_archive_jobs%rowtype; n bigint;
begin
 select * into e from public.generated_exports where id=p_export;
 select * into j from private.export_archive_jobs where export_id=p_export;
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_envelope is null or jsonb_typeof(p_envelope)<>'object' or p_csrf_binding is null or p_csrf_binding!~'^[0-9a-f]{64}$'
  or (select count(*) from jsonb_object_keys(p_envelope))<>(case when p_operation='create' then 13 else 15 end)
  or not(p_envelope ?& array['routeId','origin','principalId','targetKind','targetId','exportContract','originBinding',
    'authorityReceipt','csrfBinding','operation','nonceHash','issuedAt','expiresAt'])
  or p_envelope->>'routeId' is distinct from j.route_id or p_envelope->>'origin' is distinct from (case when j.route_id='api.future-person-export' and j.export_contract='approved-future-person-export-v1' then 'independent-rights' else 'authenticated' end)
  or p_envelope->>'principalId' is distinct from e.requester_principal_id::text
  or p_envelope->>'targetKind' is distinct from e.target_kind or p_envelope->>'targetId' is distinct from e.target_id::text
  or p_envelope->>'exportContract' is distinct from j.export_contract
  or p_envelope->>'originBinding' is distinct from j.origin_binding
  or p_envelope->>'authorityReceipt' is distinct from j.authority_receipt
  or p_envelope->>'csrfBinding' is distinct from p_csrf_binding or p_envelope->>'operation' is distinct from p_operation
  or coalesce(p_envelope->>'nonceHash','')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_envelope->'issuedAt') is distinct from 'number'
  or jsonb_typeof(p_envelope->'expiresAt') is distinct from 'number'
  or (p_envelope->>'issuedAt')::bigint<0
  or (p_envelope->>'issuedAt')::bigint>n or (p_envelope->>'expiresAt')::bigint<=n
  or (p_envelope->>'expiresAt')::bigint-(p_envelope->>'issuedAt')::bigint<>300000
  or (p_operation='open-ready' and (p_envelope->>'exportId' is distinct from e.id::text
    or (p_envelope->>'exportRevision')::bigint is distinct from e.export_revision)) then
  raise exception using errcode='42501',message='not_found'; end if;
 insert into private.export_archive_nonce_uses(nonce_hash,export_id,operation,envelope,expires_at)
 values(p_envelope->>'nonceHash',p_export,p_operation,p_envelope,to_timestamp((p_envelope->>'expiresAt')::numeric/1000));
end $$;

create function public.future_person_export_request_v1(p_operation text,p_session_hash text,
 p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;c jsonb;origin jsonb;e public.generated_exports;j private.export_archive_jobs;
 v_export_id uuid;now_at timestamptz:=clock_timestamp();
begin
 if p_operation is null or p_operation not in ('capture','create','check') then raise exception using errcode='22023',message='invalid_request';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,p_operation='create');
 if rs.id is null then raise exception using errcode='42501',message='not_found';end if;
 origin:=jsonb_build_object('kind','independent-rights','sessionHash',p_session_hash);
 c:=private.export_archive_authority_v1(origin,'subject',rs.target_id);
 if p_operation='capture' then
  if p_payload is not null or p_csrf_binding is not null then raise exception using errcode='22023',message='invalid_request';end if;return c;
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='invalid_request';end if;
 if p_operation='create' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ?& array['envelope','exportCookieHash'])
   or coalesce(p_payload->>'exportCookieHash','')!~'^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_request';end if;
  if exists(select 1 from public.generated_exports prior join private.export_archive_jobs job on job.export_id=prior.id
   where prior.requester_principal_id=rs.principal_id and prior.target_kind='subject' and prior.target_id=rs.target_id
    and job.route_id='api.future-person-export' and job.export_contract='approved-future-person-export-v1'
    and prior.status in ('queued','building','ready') and job.deadline>clock_timestamp()) then
    raise exception using errcode='55000',message='export_already_pending';end if;
  insert into public.generated_exports(account_id,origin_kind,requester_principal_id,export_kind,target_kind,target_id,purpose,
   lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,archive_version)
  values(null,'independent-rights',rs.principal_id,'subject_raw','subject',rs.target_id,'raw.export',
   (c->>'lifecycleRevision')::bigint,(c->>'principalGraphRevision')::bigint,c->>'authorityReceipt',1,c->'subjectPartitions','archive-segments-v1') returning id into v_export_id;
  insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,export_cookie_hash,principal_hash,created_at,deadline)
  values(v_export_id,origin,'api.future-person-export','approved-future-person-export-v1',c->>'originBinding',c->>'authorityReceipt',
   p_payload->>'exportCookieHash',c->>'principalHash',now_at,now_at+interval '24 hours');
  perform private.export_archive_nonce_v1(v_export_id,'create',p_payload->'envelope',p_csrf_binding);
  perform private.export_archive_current_v1(v_export_id,c->>'authorityReceipt');
  return jsonb_build_object('exportId',v_export_id,'exportRevision',1,'status','queued','authorityReceipt',c->>'authorityReceipt');
 end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload ?& array['exportId','exportCookieHash'])
  or p_csrf_binding is not null then raise exception using errcode='22023',message='invalid_request';end if;
 select * into e from public.generated_exports where id=(p_payload->>'exportId')::uuid;
 select * into j from private.export_archive_jobs where export_id=e.id;
 if e.id is null or e.origin_kind<>'independent-rights' or e.account_id is not null or e.requester_principal_id<>rs.principal_id
  or e.target_id<>rs.target_id or j.origin is distinct from origin or j.export_cookie_hash is distinct from p_payload->>'exportCookieHash'
  or j.route_id<>'api.future-person-export' then raise exception using errcode='42501',message='not_found';end if;
 perform private.export_archive_current_v1(e.id,c->>'authorityReceipt');
 return jsonb_build_object('exportId',e.id,'exportRevision',e.export_revision,'status',e.status,'expiresAt',e.expires_at);
end $$;
revoke all on function public.future_person_export_request_v1(text,text,jsonb,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_request_v1(text,text,jsonb,text) to service_role;

-- Metadata/content pages for a real claimed archive attempt, never an export
-- capability from a receipt alone. The live rights origin is derived from the
-- durable job. Every read rechecks its exact writing lease before and after.
create function public.future_person_export_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.generated_exports;j private.export_archive_jobs;a private.export_archive_attempts;
 c jsonb;source uuid;embryo uuid;subject uuid;result jsonb;page jsonb;n integer;after_id uuid;last_id uuid;
begin
 if p_operation is null or p_operation not in ('context','agreements','quality','scores','figures','reports','variants')
  or (p_operation not in('scores','figures','reports','variants') and p_after_id is not null) then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_id is not null and p_operation<>'variants' then after_id:=p_after_id::uuid;end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id;
 select * into j from private.export_archive_jobs where export_id=e.id;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=e.id;
 if e.id is null or e.origin_kind<>'independent-rights' or e.status<>'building' or j.route_id<>'api.future-person-export'
  or a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt then
   raise exception using errcode='42501',message='not_found';end if;
 c:=private.future_person_export_capture_v1(j.origin->>'sessionHash');
 subject:=(c#>>'{authority,subjectId}')::uuid;source:=(c#>>'{source,fileId}')::uuid;
 select embryo_id into embryo from private.embryo_canonical_sources where file_id=source;
 if p_operation='context' then result:=c;
 elsif p_operation='agreements' then select agreement_slice into result from private.future_person_custody_slices where subject_id=subject;
 elsif p_operation='variants' then
  if p_after_id is not null and (p_after_id!~'^[0-9]+$' or p_after_id::bigint<0) then raise exception using errcode='22023',message='invalid_request';end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(v.row order by v.id),'[]'),'count',count(*),'nextAfterId',max(v.id)::text) into result from (
   select id,jsonb_build_object('id',id::text,'chromosome',chromosome,'position',position,'referenceAllele',reference_allele,
    'alternateAllele',alternate_allele,'genotype',genotype) row from public.embryo_variants where source_file_id=source
    and (p_after_id is null or id>p_after_id::bigint) order by id limit 500)v;
 elsif p_operation='quality' then select coalesce(jsonb_agg(to_jsonb(q)-'embryo_id'),'[]') into result from public.embryo_qc q where q.embryo_id=embryo;
 else
  if p_operation='scores' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select score.id,to_jsonb(score)-'embryo_id' row from public.embryo_scores score where score.embryo_id=embryo
      and (after_id is null or score.id>after_id) order by score.id limit 500)x;
  elsif p_operation='figures' then
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select fig.id,to_jsonb(fig) row from public.embryo_figures fig join public.embryo_scores score on score.id=fig.finding_id
     where score.embryo_id=embryo and (after_id is null or fig.id>after_id) order by fig.id limit 500)x;
  else
   select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into page,n,last_id from (
    select report.id,to_jsonb(report)-'subject_id'-'cohort_id' row from public.report_artifacts report where report.subject_id=subject
     and (after_id is null or report.id>after_id) order by report.id limit 500)x;
  end if;
  result:=jsonb_build_object('rows',page,'nextAfterId',last_id,'count',n);
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_source_unavailable';end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 if not exists(select 1 from private.export_archive_attempts att where att.id=p_attempt_id and att.state='writing'
  and att.lease_expires_at>clock_timestamp()) then raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.future_person_export_members_v1(text,uuid,uuid,text,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_members_v1(text,uuid,uuid,text,text) to service_role;
