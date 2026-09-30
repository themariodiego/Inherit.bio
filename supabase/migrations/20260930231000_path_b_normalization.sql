-- Path B normalization uses the registered generic worker identity, with its
-- own confirmation/mitigation authority. It never borrows an own-upload grant,
-- account binding, login session or synchronous-report exception.
-- Existing private normalization working stores are reused by exact file/claim;
-- their file cascades, bounds and terminal cleanup remain authoritative.
alter table public.other_adult_held_uploads drop constraint other_adult_held_uploads_analysis_state_check;
alter table public.other_adult_held_uploads add constraint other_adult_held_uploads_analysis_state_check
 check(analysis_state in('quarantined','confirmed_blocked_current_gate','confirmed_awaiting_purpose','queued'));

-- Legacy ownership is not permission to read another adult's source.
create function private.is_path_b_file_v1(p_file_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.genome_files f join public.subjects s on s.id=f.subject_id
 where f.id=p_file_id and f.user_id=(select auth.uid()) and s.subject_class='other_adult'); $$;
revoke all on function private.is_path_b_file_v1(uuid) from public,anon,inherit_upload_only;
grant execute on function private.is_path_b_file_v1(uuid) to authenticated;
alter policy genome_files_select_own on public.genome_files
 using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(id));
alter policy user_variants_select_own on public.user_variants
 using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(file_id));
alter policy report_observed_calls_select_owner on public.report_observed_calls
 using(user_id=(select auth.uid()) and not private.is_path_b_file_v1(file_id)
  and private.report_observed_call_readable_v1(file_id,source_sha256,extraction_version));

-- A machine checkpoint snapshots actual current evidence, not an uploader
-- session selected arbitrarily after the person signs in to confirm.
create function private.path_b_normalization_authority_v1(p_revision_id uuid,p_checkpoint text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare h public.other_adult_held_uploads%rowtype; u public.upload_sessions%rowtype;
 s public.subjects%rowtype; pr public.profiles%rowtype; pp public.profiles%rowtype;
 up public.subject_principals%rowtype; t jsonb; m jsonb; v_consent uuid;
 v_self public.subjects%rowtype; v_insurance uuid; v_subject_signature uuid;
 v_authority_deadline timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 select * into h from public.other_adult_held_uploads where id=p_revision_id for share;
 if h.id is null or h.state<>'confirmed' or h.confirmed_at is null then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into pr from public.profiles where id=h.uploader_account_id for share;
 select * into s from public.subjects where id=h.subject_id for share;
 if pr.id is null or pr.deletion_requested_at is not null or pr.date_of_birth is null
  or pr.date_of_birth>(timezone('UTC',clock_timestamp())::date-interval '18 years')::date
  or not private.path_b_account_current_v1(pr.id) or s.subject_account_id is null
  or not private.path_b_account_current_v1(s.subject_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into pp from public.profiles where id=s.subject_account_id for share;
 if (select count(*) from auth.users where id in(pr.id,pp.id) and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()))<>2 then
  raise exception using errcode='42501',message='not_found'; end if;
 t:=private.path_b_subject_v1(h.uploader_account_id,h.subject_id);
 if (t->>'subjectBindingRevision')::bigint<>h.subject_binding_revision
  or (t->>'principalId')::uuid<>h.confirmation_principal_id then
  raise exception using errcode='42501',message='not_found'; end if;
 m:=private.other_adult_mitigation_v1(s.id,h.uploader_account_id,p_checkpoint);
 if m->>'decision'<>'allow' then raise exception using errcode='42501',message='not_found'; end if;
 select * into v_self from public.subjects where subject_class='self'
  and subject_account_id=pr.id and lifecycle='active' for share;
 select * into up from public.subject_principals where subject_id=v_self.id
  and account_id=pr.id and principal_kind='account_subject' and status='active' for share;
 if up.id is null then raise exception using errcode='42501',message='not_found'; end if;
 v_consent:=private.path_b_uploader_consent_v1(pr.id,s.id,up.id,pr.jurisdiction_revision);
 if v_consent is distinct from h.uploader_consent_id then
  raise exception using errcode='42501',message='not_found'; end if;
 select least(i.accepted_at+interval '30 days',sc.expires_at) into v_authority_deadline
 from public.subject_invitations i join public.subject_consents sc on sc.id=v_consent
 where i.target_kind='subject' and i.target_id=s.id and i.invitation_kind='adult_subject' and i.status='accepted'
 order by i.accepted_at desc limit 1;
 if v_authority_deadline is null or v_authority_deadline<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Current insurance acknowledgement is independent of the upload artifact.
 select cs.id into v_insurance from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256 and ca.superseded_at is null
 where cs.target_kind='subject' and cs.target_id=v_self.id and cs.signer_account_id=pr.id
  and cs.signer_principal_id=up.id and cs.subject_binding_revision=v_self.subject_binding_revision
  and cs.jurisdiction_revision=pr.jurisdiction_revision
  and ca.artifact_key='disclosure.insurance-and-discrimination' and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1 for share of cs,ca;
 v_subject_signature:=(t->>'confirmationSignatureId')::uuid;
 perform 1 from public.consent_signatures cs join public.consent_artifacts ca
  on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
   and ca.body_sha256=cs.artifact_body_sha256 and ca.superseded_at is null
 where cs.id=v_subject_signature and cs.jurisdiction_revision=pp.jurisdiction_revision
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date;
 if not found or v_insurance is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into u from public.upload_sessions where id=h.upload_session_id for share;
 if u.id is null or u.status<>'held' or u.upload_authority_kind<>'other-adult-held'
  or u.subject_id<>h.subject_id or u.account_id<>h.uploader_account_id or u.finalized_file_id is not null
  or u.upload_revision<>h.upload_revision or u.storage_bucket<>'genomes'
  or u.final_object_name::text<>h.object_name or u.expected_size<>h.size_bytes
  or not exists(select 1 from storage.objects o where o.id=h.storage_object_id and o.bucket_id='genomes'
   and o.name=h.object_name and (o.metadata->>'size')::numeric=h.size_bytes)
  or not exists(select 1 from public.upload_staging_objects w where w.upload_session_id=u.id
   and w.object_name=h.object_name and w.object_kind='uncommitted-final' and w.state in('issued','uploaded')) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('revisionId',h.id,'uploadSessionId',u.id,'subjectId',s.id,
  'subjectBindingRevision',s.subject_binding_revision,'subjectLifecycleRevision',s.lifecycle_revision,
  'principalId',t->'principalId','principalRevision',t->'principalRevision',
  'confirmationSignatureId',v_subject_signature,'confirmedAt',h.confirmed_at,
  'uploaderAccountId',pr.id,'uploaderAuthRevision',pr.auth_session_revision,
  'uploaderJurisdictionRevision',pr.jurisdiction_revision,'subjectAuthRevision',pp.auth_session_revision,
  'subjectJurisdictionRevision',pp.jurisdiction_revision,'uploaderPrincipalId',up.id,
  'uploaderPrincipalRevision',up.principal_revision,'uploadConsentId',v_consent,'insuranceSignatureId',v_insurance,
  'sourceRevision',h.upload_revision,'rawSha256',h.raw_sha256,'decodedSha256',h.decoded_sha256,
  'objectId',h.storage_object_id,'objectKey',h.object_name,'sizeBytes',h.size_bytes,'fileType',h.file_type,
  'maximumDecodedBytes',u.maximum_decoded_bytes,'authorityExpiresAt',v_authority_deadline);
end;
$$;
revoke all on function private.path_b_normalization_authority_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Descriptor identity is exactly the confirmed held revision. The original
-- remains owned by the existing upload-working manifest; it is never relabelled
-- as an own upload, promoted through the own finalizer, or exposed via RLS.
create function private.enqueue_path_b_normalization_v1(p_revision_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare h public.other_adult_held_uploads%rowtype; a jsonb; j public.worker_jobs%rowtype;
begin
 a:=private.path_b_normalization_authority_v1(p_revision_id,'analysis-enqueue');
 select * into h from public.other_adult_held_uploads where id=p_revision_id for update;
 if h.file_type not in('vcf','gvcf') then return null; end if;
 insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
  upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values(h.id,h.uploader_account_id,h.subject_id,h.object_name,'Genome file',h.file_type,1,h.size_bytes,h.raw_sha256,
  'uploaded',h.upload_revision,'single-logical-sample-v1',h.held_at,h.decoded_sha256,h.storage_object_id)
 on conflict(id) do nothing;
 if not exists(select 1 from public.genome_files f where f.id=h.id and f.user_id=h.uploader_account_id
  and f.subject_id=h.subject_id and f.storage_object_id=h.storage_object_id and f.bucket_path=h.object_name
  and f.sha256=h.raw_sha256 and f.source_sha256=h.decoded_sha256 and f.upload_revision=h.upload_revision
  and f.file_type=h.file_type and f.size_bytes=h.size_bytes and f.tier=1) then
  raise exception using errcode='42501',message='not_found'; end if;
 j:=private.enqueue_worker_job_v2(h.uploader_account_id,'annotate_vcf','ingest.normalize',h.subject_id,null,
  'genome-file',h.id,h.upload_revision,h.raw_sha256,'path-b-normalization-v1',h.id,
  jsonb_build_object('authority',a));
 update public.other_adult_held_uploads set analysis_state=case when exists(select 1 from public.purpose_grants pg
  where pg.target_kind='subject' and pg.target_id=h.subject_id and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())) then 'queued' else 'confirmed_awaiting_purpose' end
 where id=h.id;
 return j.id;
end;
$$;
revoke all on function private.enqueue_path_b_normalization_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Other worker entry points cannot bypass the Path B checkpoints.
create or replace function private.claim_worker_job_v2(p_worker_id text,p_claim_token_hash text,p_lease_seconds integer default 60)
returns public.worker_jobs language plpgsql security definer set search_path=''
as $$
declare j public.worker_jobs%rowtype;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' or p_lease_seconds not between 10 and 300 then
  raise exception using errcode='22023',message='invalid worker claim parameters'; end if;
 select w.* into j from public.worker_jobs w where w.status='queued' and w.kind<>'split_cohort_vcf'
  and not exists(select 1 from public.subjects s where s.id=w.subject_id and s.subject_class='other_adult')
  and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 order by w.created_at,w.id for update of w skip locked limit 1;
 if j.id is null then return null; end if;
 update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_token_hash,
  claim_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),claimed_by=p_worker_id,
  started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
 return j;
end;
$$;

-- The dedicated worker consumes only this queue, under a finite claim. Every
-- operation rechecks the immutable job tuple and the same current authority.
create function private.path_b_normalization_v1(p_operation text,p_job_id uuid,p_claim_hash text,
 p_claim uuid,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare j public.worker_jobs%rowtype; f public.genome_files%rowtype; r private.own_normalization_runs%rowtype;
 c jsonb; m jsonb; v_variant_count bigint; v_observed_count bigint; v_finished timestamptz;
 v_authority_deadline timestamptz;
begin
 if p_test_jurisdiction is distinct from true or p_claim_hash is null or p_claim_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation is null or p_operation not in('claim','check','stage','complete','fail') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.lock_invitation_transitions_v1();
 if p_operation='claim' then
  if p_job_id is not null or p_claim is not null or p_payload is not null then
   raise exception using errcode='22023',message='invalid_request'; end if;
  select w.* into j from public.worker_jobs w
  where w.status='queued' and w.kind='annotate_vcf' and w.output_kind='ingest.normalize'
   and w.computation_revision='path-b-normalization-v1' and w.not_before<=clock_timestamp()
   and w.attempts<w.max_attempts order by w.created_at,w.id for update of w skip locked limit 1;
  if j.id is null then return null; end if;
 else
  select * into j from public.worker_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'running' or j.claim_token_hash is distinct from p_claim_hash
   or j.kind<>'annotate_vcf' or j.output_kind<>'ingest.normalize'
   or j.computation_revision<>'path-b-normalization-v1' then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 select * into f from public.genome_files where id=j.file_id for update;
 if f.id is null or j.source_binding_kind<>'genome-file' or j.source_binding_id<>f.id
  or j.source_binding_revision<>f.upload_revision or j.subject_id<>f.subject_id
  or j.cohort_id is not null or j.user_id<>f.user_id or j.file_sha256<>f.sha256 then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into r from private.own_normalization_runs where file_id=f.id for update;
 -- Cleanup may run after permission expires; it cannot publish or read source.
 if p_operation='fail' then
  if p_claim is null or r.claim is distinct from p_claim or r.state<>'running'
   or r.session_id is distinct from j.id or p_payload is not null then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from private.own_normalization_batches where file_id=f.id;
  update private.own_normalization_runs set state='failed' where file_id=f.id;
  update public.worker_jobs set status='failed',finished_at=clock_timestamp(),error='path_b_normalization_failed',
   claim_token_hash=null,claim_expires_at=null where id=j.id;
  update public.genome_files set status='failed' where id=f.id and normalization_completed_at is null;
  return 'true'::jsonb;
 end if;
 c:=private.path_b_normalization_authority_v1(f.id,case when p_operation='claim' then 'worker-claim'
  when p_operation='check' then 'source-read-and-every-bounded-range' else 'derived-write-and-read' end);
 if j.payload is distinct from jsonb_build_object('authority',c) then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='claim' then
  if f.normalization_completed_at is not null or (r.state='running' and r.expires_at>clock_timestamp()) then
   raise exception using errcode='42501',message='not_found'; end if;
  p_claim:=gen_random_uuid();
  update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_hash,
   claim_expires_at=least(clock_timestamp()+interval '5 minutes',(c->>'authorityExpiresAt')::timestamptz),claimed_by='path-b-normalization-v1',
   started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
  m:=jsonb_build_object('jobId',j.id,'claim',p_claim,'claimExpiresAt',j.claim_expires_at,
   'fileId',f.id,'subjectId',f.subject_id,'bucket','genomes','objectId',f.storage_object_id,
   'objectKey',f.bucket_path,'sourceRevision',f.upload_revision,'rawSha256',f.sha256,
   'decodedSha256',f.source_sha256,'sizeBytes',f.size_bytes,'fileType',f.file_type,
   'maximumDecodedBytes',c->'maximumDecodedBytes');
  delete from private.own_normalization_batches where file_id=f.id;
  insert into private.own_normalization_runs(file_id,claim,account_id,session_id,authority,manifest,expires_at,state)
   values(f.id,p_claim,f.user_id,j.id,c,m,j.claim_expires_at,'running')
   on conflict(file_id) do update set claim=excluded.claim,account_id=excluded.account_id,session_id=excluded.session_id,
    authority=excluded.authority,manifest=excluded.manifest,expires_at=excluded.expires_at,state='running',provenance=null;
  update public.genome_files set status='parsing',processing_run_id=p_claim,processing_started_at=clock_timestamp(),
   processing_finished_at=null,error=null where id=f.id;
  return m;
 end if;
 if p_claim is null or r.claim is distinct from p_claim or r.session_id is distinct from j.id
  or r.state<>'running' or r.authority is distinct from c or r.expires_at<=clock_timestamp()
  or j.claim_expires_at is null or j.claim_expires_at<=clock_timestamp()
  or f.processing_run_id is distinct from p_claim or f.status<>'parsing' then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  return r.manifest;
 end if;
if p_operation='stage' then
  if jsonb_typeof(p_payload) is distinct from 'object' or not (p_payload ?& array['kind','sequence','rows'])
   or p_payload-array['kind','sequence','rows']<>'{}'::jsonb
   or p_payload->>'kind' not in ('variants','observed') or jsonb_typeof(p_payload->'rows') is distinct from 'array'
   or jsonb_array_length(p_payload->'rows') not between 1 and 1000
   or p_payload->>'sequence'!~'^(0|[1-9][0-9]*)$' or octet_length(p_payload::text)>4000000 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  -- Strictly ordered batches prevent a dropped/duplicated request from being
  -- interpreted as a complete source. No caller can supply ownership columns.
  if (p_payload->>'sequence')::integer<>(select count(*) from private.own_normalization_batches
   where file_id=f.id and kind=p_payload->>'kind') then
   raise exception using errcode='22023',message='invalid_request'; end if;
  insert into private.own_normalization_batches(file_id,kind,sequence,rows)
   values(f.id,p_payload->>'kind',(p_payload->>'sequence')::integer,p_payload->'rows');
  -- The inserted JSON may outlast a time-bound permission. Recheck after the
  -- write so the entire statement rolls back when the live fence has expired.
  m:=private.path_b_normalization_v1('check',j.id,p_claim_hash,p_claim,null,p_test_jurisdiction);
  if m is distinct from r.manifest or clock_timestamp()>=least(r.expires_at,j.claim_expires_at,
   (c->>'authorityExpiresAt')::timestamptz) then
   raise exception using errcode='42501',message='not_found'; end if;
  return 'true'::jsonb;
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or not (p_payload ?& array['sourceBuild','rawSha256','decodedSha256','variantCount','observedCallCount','provenance'])
  or p_payload-array['sourceBuild','rawSha256','decodedSha256','variantCount','observedCallCount','provenance']<>'{}'::jsonb
  or p_payload->>'sourceBuild' not in ('GRCh37','GRCh38')
  or p_payload->>'rawSha256' is distinct from f.sha256 or p_payload->>'decodedSha256' is distinct from f.source_sha256
  or jsonb_typeof(p_payload->'provenance') is distinct from 'object' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select coalesce(sum(jsonb_array_length(rows)) filter(where kind='variants'),0),
  coalesce(sum(jsonb_array_length(rows)) filter(where kind='observed'),0)
  into v_variant_count,v_observed_count from private.own_normalization_batches where file_id=f.id;
 if v_variant_count+v_observed_count=0 or (p_payload->>'variantCount')::bigint is distinct from v_variant_count
  or (p_payload->>'observedCallCount')::bigint is distinct from v_observed_count then
  raise exception using errcode='22023',message='invalid_request'; end if;
 delete from public.user_variants where file_id=f.id;
 delete from public.report_observed_calls where file_id=f.id;
 insert into public.user_variants(file_id,user_id,subject_id,rsid,chrom,pos,ref,alt,genotype)
 select f.id,f.user_id,f.subject_id,x.rsid,x.chrom,x.pos,x.ref,x.alt,x.genotype
 from private.own_normalization_batches b cross join lateral jsonb_to_recordset(b.rows)
  as x(rsid bigint,chrom smallint,pos integer,ref text,alt text,genotype text)
 where b.file_id=f.id and b.kind='variants';
 insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,extraction_version,
  source_build,source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,genotype,
  site_filter,sample_filter,genotype_quality,read_depth,quality_state,usable)
 select f.id,f.user_id,f.subject_id,x.source_line,f.sha256,'vcf-literal-diploid-snp-v1',
  p_payload->>'sourceBuild',x.source_chrom,x.source_pos,x.source_ref,x.source_alt,x.source_gt,x.rsid,x.chrom,x.pos,
  x.ref,x.alt,x.genotype,x.site_filter,x.sample_filter,x.genotype_quality,x.read_depth,x.quality_state,x.usable
 from private.own_normalization_batches b cross join lateral jsonb_to_recordset(b.rows)
  as x(source_line bigint,source_chrom smallint,source_pos bigint,source_ref text,source_alt text,source_gt text,
   rsid bigint,chrom smallint,pos bigint,ref text,alt text,genotype text,site_filter text,sample_filter text,
   genotype_quality numeric,read_depth numeric,quality_state text,usable boolean)
 where b.file_id=f.id and b.kind='observed';
 -- Bulk writes can outlast time-bound permission even while rows are locked.
 -- Reauthorize the same actor/session/source/store grant after all inserts.
 m:=private.path_b_normalization_authority_v1(f.id,'derived-write-and-read');
 if m is distinct from c or m is distinct from r.authority then
  raise exception using errcode='42501',message='not_found'; end if;
 v_authority_deadline:=least(r.expires_at,j.claim_expires_at,(c->>'authorityExpiresAt')::timestamptz);
 -- Take the publication clock only after the final authority/deadline reads.
 v_finished:=clock_timestamp();
 if v_authority_deadline is null or v_finished>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.genome_files set status='stored',build=p_payload->>'sourceBuild',variant_count=v_variant_count,
  processing_finished_at=v_finished,normalization_completed_at=v_finished,normalization_source_revision=upload_revision
  where id=f.id;
 update private.own_normalization_runs set state='complete',provenance=p_payload->'provenance' where file_id=f.id;
 update public.worker_jobs set status='done',finished_at=v_finished,result=jsonb_build_object('normalization','complete'),claim_token_hash=null,claim_expires_at=null where id=j.id;
 -- The separate analytic worker contract remains closed. A current purpose
 -- never changes this normalization job into an analytic execution permission.
 update public.other_adult_held_uploads set analysis_state=case when exists(select 1 from public.purpose_grants pg
  where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())) then 'confirmed_blocked_current_gate'
  else 'confirmed_awaiting_purpose' end where id=f.id;
 delete from private.own_normalization_batches where file_id=f.id;
 -- Include terminal metadata/batch cleanup in the same finite publication.
 if clock_timestamp()>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('fileId',f.id,'status','normalization_complete','analysisState','not_generated');
end;
$function$;
revoke all on function private.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean) to service_role;
create function public.path_b_normalization_v1(p_operation text,p_job_id uuid,p_claim_hash text,
 p_claim uuid,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=''
as $$ select private.path_b_normalization_v1(p_operation,p_job_id,p_claim_hash,p_claim,p_payload,p_test_jurisdiction); $$;
revoke all on function public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean) to service_role;

-- Position equality, deduplication, bounds and source-build checks are the
-- existing incremental VCF contract; only authorization is Path B-specific.
create function private.register_path_b_normalization_positions_v1(p_job_id uuid,p_claim_hash text,
 p_file_id uuid,p_claim uuid,p_sequence integer,p_source_build text,p_entries jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_normalization_runs%rowtype; v_entry jsonb; v jsonb; c jsonb;
 v_ordinals jsonb; v_attempted bigint; v_unmapped bigint; v_deadline timestamptz;
begin
 if p_sequence is null or p_sequence<0 or p_sequence=2147483647
  or p_source_build is null or p_source_build not in('GRCh37','GRCh38')
  or jsonb_typeof(p_entries) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Preserve an old-valid near-4MB singleton variant despite this new source
 -- registration envelope. Only 1024 metadata bytes are added; the existing
 -- stage payload remains <=4000000 and upload/decoded ceilings do not change.
 if jsonb_array_length(p_entries) not between 1 and 1000 or octet_length(p_entries::text)>4001024 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 for v_entry in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(v_entry) is distinct from 'object' or not(v_entry ?& array['source_chrom','source_pos','variant','mapped'])
   or v_entry-array['source_chrom','source_pos','variant','mapped']<>'{}'::jsonb
   or jsonb_typeof(v_entry->'source_chrom') is distinct from 'number' or v_entry->>'source_chrom'!~'^[1-9][0-9]*$'
   or jsonb_typeof(v_entry->'source_pos') is distinct from 'number' or v_entry->>'source_pos'!~'^[1-9][0-9]*$' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if (v_entry->>'source_chrom')::numeric not between 1 and 25 or (v_entry->>'source_pos')::numeric>9007199254740991 then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if p_source_build='GRCh37' and (v_entry->>'source_chrom')::integer between 1 and 22 then
   if jsonb_typeof(v_entry->'mapped') is distinct from 'boolean' then
    raise exception using errcode='22023',message='invalid_request'; end if;
  elsif v_entry->'mapped' is distinct from 'null'::jsonb then
   raise exception using errcode='22023',message='invalid_request'; end if;
  v:=v_entry->'variant';
  if v is distinct from 'null'::jsonb then
   if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['rsid','chrom','pos','ref','alt','genotype'])
    or v-array['rsid','chrom','pos','ref','alt','genotype']<>'{}'::jsonb
    or v->'chrom' is distinct from v_entry->'source_chrom' or v->'pos' is distinct from v_entry->'source_pos'
    or jsonb_typeof(v->'genotype') is distinct from 'string' or length(v->>'genotype')=0
    or jsonb_typeof(v->'ref') not in('string','null') or jsonb_typeof(v->'alt') not in('string','null')
    or jsonb_typeof(v->'rsid') not in('number','null') then
    raise exception using errcode='22023',message='invalid_request'; end if;
   if v->'rsid'<>'null'::jsonb and ((v->>'rsid')!~'^[0-9]+$' or (v->>'rsid')::numeric>9007199254740991) then
    raise exception using errcode='22023',message='invalid_request'; end if;
  end if;
 end loop;
 -- Existing check locks authority account/subject, file and exact live run.
 c:=private.path_b_normalization_v1('check',p_job_id,p_claim_hash,p_claim,null,p_test_jurisdiction);
 if c->>'fileId' is distinct from p_file_id::text then raise exception using errcode='42501',message='not_found'; end if;
 select * into strict r from private.own_normalization_runs where file_id=p_file_id;
 if r.position_sequence<>p_sequence or (r.position_source_build is not null and r.position_source_build<>p_source_build) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Check conflicting duplicates BEFORE choosing a representative. JSONB exact
 -- value equality preserves the closed parser record, never hash-only equality.
 if exists(select 1 from jsonb_array_elements(p_entries) x
  group by x->'source_chrom',x->'source_pos'
  having count(distinct x->'variant') filter(where x->'variant'<>'null'::jsonb)>1
   or count(distinct x->'mapped')>1) then
  raise exception using errcode='22023',message='normalization_position_conflict'; end if;
 if exists(select 1 from jsonb_array_elements(p_entries) e
  join private.own_normalization_positions d on d.file_id=p_file_id
   and d.source_chrom=(e->>'source_chrom')::smallint and d.source_pos=(e->>'source_pos')::bigint
  where d.claim is distinct from p_claim or d.mapped is distinct from (e->>'mapped')::boolean
   or (d.variant is not null and e->'variant'<>'null'::jsonb and d.variant is distinct from e->'variant')) then
  raise exception using errcode='22023',message='normalization_position_conflict'; end if;
 with candidates as (
  select distinct on(e->'source_chrom',e->'source_pos') e,ordinality-1 ordinal
  from jsonb_array_elements(p_entries) with ordinality a(e,ordinality)
  where e->'variant'<>'null'::jsonb order by e->'source_chrom',e->'source_pos',ordinality
 ) select coalesce(jsonb_agg(ordinal order by ordinal),'[]'::jsonb) into v_ordinals
 from candidates x left join private.own_normalization_positions d on d.file_id=p_file_id
  and d.source_chrom=(x.e->>'source_chrom')::smallint and d.source_pos=(x.e->>'source_pos')::bigint
 where d.variant is null;
 -- Insert only unseen positions; counters derive from RETURNING rather than a
 -- growing full-index scan. One position may first arrive as an observation.
 with input as (
  select distinct on(e->'source_chrom',e->'source_pos') e from jsonb_array_elements(p_entries) e
  order by e->'source_chrom',e->'source_pos',(e->'variant'='null'::jsonb)
 ), inserted as (
  insert into private.own_normalization_positions(file_id,claim,source_chrom,source_pos,variant,mapped)
  select p_file_id,p_claim,(e->>'source_chrom')::smallint,(e->>'source_pos')::bigint,
   nullif(e->'variant','null'::jsonb),(e->>'mapped')::boolean from input
  on conflict(file_id,source_chrom,source_pos) do nothing returning source_chrom,mapped
 ) select count(*) filter(where p_source_build='GRCh37' and source_chrom between 1 and 22),
  count(*) filter(where p_source_build='GRCh37' and source_chrom between 1 and 22 and not mapped)
  into v_attempted,v_unmapped from inserted;
 with input as (
  select distinct on(e->'source_chrom',e->'source_pos') e from jsonb_array_elements(p_entries) e
  where e->'variant'<>'null'::jsonb order by e->'source_chrom',e->'source_pos'
 ) update private.own_normalization_positions d set variant=e->'variant'
 from input where d.file_id=p_file_id and d.source_chrom=(e->>'source_chrom')::smallint
  and d.source_pos=(e->>'source_pos')::bigint and d.variant is null;
 update private.own_normalization_runs set position_sequence=p_sequence+1,position_source_build=p_source_build,
  position_attempted=position_attempted+v_attempted,position_unmapped=position_unmapped+v_unmapped
 where file_id=p_file_id returning * into r;
 -- Include bookkeeping in the live claim/session/store deadline. All mutations
 -- roll back if authorization or time expires while the batch is processed.
 perform private.path_b_normalization_v1('check',p_job_id,p_claim_hash,p_claim,null,p_test_jurisdiction);
 if clock_timestamp()>=r.expires_at then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('acceptedVariantOrdinals',v_ordinals,'attempted',r.position_attempted,'unmapped',r.position_unmapped);
end;
$$;
revoke all on function private.register_path_b_normalization_positions_v1(uuid,text,uuid,uuid,integer,text,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.register_path_b_normalization_positions_v1(uuid,text,uuid,uuid,integer,text,jsonb,boolean) to service_role;
create function public.register_path_b_normalization_positions_v1(p_job_id uuid,p_claim_hash text,
 p_file_id uuid,p_claim uuid,p_sequence integer,p_source_build text,p_entries jsonb,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=''
as $$ select private.register_path_b_normalization_positions_v1(p_job_id,p_claim_hash,p_file_id,p_claim,p_sequence,p_source_build,p_entries,p_test_jurisdiction); $$;
revoke all on function public.register_path_b_normalization_positions_v1(uuid,text,uuid,uuid,integer,text,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.register_path_b_normalization_positions_v1(uuid,text,uuid,uuid,integer,text,jsonb,boolean) to service_role;

create function private.queue_confirmed_path_b_revision_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.state='confirmed' and old.state='pending' then
  begin
   perform private.enqueue_path_b_normalization_v1(new.id);
  exception when insufficient_privilege then
   -- Missing live evidence is the existing named blocked confirmation result.
   null;
  end;
 end if;
 return null;
end;
$$;
revoke all on function private.queue_confirmed_path_b_revision_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger queue_confirmed_path_b_revision after update of state on public.other_adult_held_uploads
 for each row execute function private.queue_confirmed_path_b_revision_v1();

-- Preserve any later legal-audit attribution edits in this existing function.
-- Only its obsolete hardcoded outcome is replaced, exactly once; drift stops
-- the migration instead of overwriting the function with an earlier body.
do $patch$
declare body text:=pg_get_functiondef('public.respond_adult_upload_revision_v1(text,text,text,uuid)'::regprocedure);
 old_fragment text:=$old$'outcome','confirmed_blocked_current_gate'$old$;
 new_fragment text:=$new$'outcome',(select analysis_state from public.other_adult_held_uploads where id=h.id)$new$;
begin
 if (length(body)-length(replace(body,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='path_b_confirmation_body_changed'; end if;
 execute replace(body,old_fragment,new_fragment);
end;
$patch$;

-- Source refusal/deletion/expiry ends its canonical rows and queued/running job
-- in the same transaction. The existing upload-working executor retains the
-- random original handle until it has proven deletion, then removes its row.
create function private.end_path_b_normalized_revision_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if tg_op='DELETE' or new.state not in('pending','confirmed') then
  delete from public.genome_files where id=old.id and subject_id=old.subject_id;
 end if;
 return null;
end;
$$;
revoke all on function private.end_path_b_normalized_revision_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger end_path_b_normalized_revision after update of state or delete on public.other_adult_held_uploads
 for each row execute function private.end_path_b_normalized_revision_v1();

-- Reading continuation names the remaining analytic-execution gate honestly.
create or replace function private.path_b_result_read_v1(p_account_id uuid,p_subject_id uuid,p_purpose text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog
as $function$
declare m jsonb; c jsonb; s public.subjects%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  return jsonb_build_object('allowed',false,'gate','purpose'); end if;
 m:=private.other_adult_mitigation_v1(p_subject_id,p_account_id,'route-read-before-fetch');
 if m->>'decision'='deny' then return jsonb_build_object('allowed',false,'gate',m->>'gate'); end if;
 select * into s from public.subjects where id=p_subject_id;
 -- The exact current grant of this layer to this reader, by the person.
 if not exists(select 1 from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.subject_principals sp on sp.id=pg.data_subject_principal_id
   and sp.account_id=s.subject_account_id and sp.subject_id=s.id and sp.status='active'
  join public.profiles pp on pp.id=sp.account_id and pp.deletion_requested_at is null
   and pp.jurisdiction_revision=pg.jurisdiction_revision
  join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
   and ca.body_sha256=pg.artifact_body_sha256 and ca.superseded_at is null
   and ca.published_at<=v_now and ca.effective_on<=timezone('UTC',v_now)::date
   and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
  join public.subject_principals rp on rp.id=dg.recipient_principal_id and rp.account_id=p_account_id
   and rp.status='active'
  left join public.subject_relationships r on r.id=dg.relationship_id
  where pg.target_kind='subject' and pg.target_id=s.id and pg.purpose=p_purpose
   and pg.signer_principal_id=sp.id and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
   and pg.subject_binding_revision=s.subject_binding_revision
   and dg.status='current' and dg.recipient_account_id=p_account_id
   and ((m->>'decision'='subject-own-right-only' and dg.direction='self' and dg.relationship_id is null
      and dg.self_principal_revision=sp.principal_revision and rp.id=sp.id
      and dg.relationship_or_pair_revision=s.subject_binding_revision)
    or (m->>'decision'='allow' and dg.direction='subject_to_recipient' and r.relationship_kind='uploader'
     and r.status='current' and r.recipient_account_id=p_account_id
     and dg.relationship_or_pair_revision=r.relationship_revision))) then
  return jsonb_build_object('allowed',false,'gate','directional-purpose-grant-v1'); end if;
 -- A completed exact normalization advances only the source gate. It creates
 -- no purpose, analytic result, report-ready message or synchronous exception.
 for c in select jsonb_build_object('fileId',f.id,'authority',n.authority) from public.genome_files f
  join public.other_adult_held_uploads h on h.id=f.id and h.subject_id=f.subject_id and h.state='confirmed'
  join private.own_normalization_runs n on n.file_id=f.id and n.state='complete'
  join public.worker_jobs j on j.id=n.session_id and j.file_id=f.id and j.status='done'
   and j.computation_revision='path-b-normalization-v1' and j.output_kind='ingest.normalize'
  where f.subject_id=s.id and f.normalization_completed_at is not null
   and f.normalization_source_revision=f.upload_revision and h.upload_revision=f.upload_revision
   and n.provenance->>'version'='path-b-normalization-v1'
  order by h.confirmed_at desc,h.id
 loop
  begin
   if private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')=c->'authority' then
    return jsonb_build_object('allowed',false,'gate','analysis-not-generated');
   end if;
  exception when insufficient_privilege then null;
  end;
 end loop;
 return jsonb_build_object('allowed',false,'gate','subject-bound-source');
end;
$function$;
