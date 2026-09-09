-- Disabled prepared-source report integration. No dispatch, admission, jobs,
-- synthetic normalization journal, new grant, or Family authority is introduced.
-- The helper below returns SOURCE METADATA ONLY. All direct execution is revoked;
-- grant/read/mail callers retain their distinct current principal/store gates.
create function private.own_report_source_metadata_v1(p_account_id uuid,p_file_id uuid,p_lock boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
 j private.own_preparation_jobs%rowtype; m private.own_prepared_manifests%rowtype;
 root private.own_preparation_artifacts%rowtype;
begin
 if p_lock is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_lock then
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for share;
 else select * into f from public.genome_files where id=p_file_id and user_id=p_account_id; end if;
 if f.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_lock then
  select * into j from private.own_preparation_jobs where file_id=f.id for share;
  select * into m from private.own_prepared_manifests where file_id=f.id for share;
 else
  select * into j from private.own_preparation_jobs where file_id=f.id;
  select * into m from private.own_prepared_manifests where file_id=f.id;
 end if;
 -- A frozen attempt with no publication may recover through the existing
 -- genuine DB normalizer. Active/published attempts never fall back.
 if m.id is not null or (j.id is not null and j.state<>'frozen') then
  if m.id is null or j.state is distinct from 'published' or m.job_id is distinct from j.id
   or j.account_id is distinct from p_account_id or m.attempt_id is distinct from j.attempt_id
   or m.source is distinct from j.source or f.subject_id is distinct from j.subject_id
   or f.status is null or f.status not in('stored','annotated') or f.tier is distinct from 1
   or f.normalization_completed_at is distinct from m.published_at
   or f.normalization_source_revision is distinct from f.upload_revision
   or f.build is distinct from m.payload->'summary'->>'sourceBuild'
   or f.variant_count::bigint is distinct from (m.payload->'summary'->>'variantCount')::bigint
   or f.sha256 is distinct from m.source->>'rawSha256' or f.source_sha256 is distinct from m.source->>'decodedSha256'
   or f.upload_revision is distinct from (m.source->>'sourceRevision')::bigint
   or f.storage_object_id is distinct from (m.source->>'objectId')::uuid
   or f.bucket_path is distinct from m.source->>'objectKey' or f.size_bytes is distinct from (m.source->>'sizeBytes')::bigint
   or f.file_type::text is distinct from m.source->>'fileType'
   or f.file_type::text not in('vcf','gvcf')
   or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
   or exists(select 1 from private.genome_file_deletions where file_id=f.id)
   or exists(select 1 from private.own_normalization_runs where file_id=f.id and state in('running','complete','rejecting','rejected'))
   or exists(select 1 from public.worker_jobs where file_id=f.id and status in('queued','running'))
   or not exists(select 1 from public.subjects s join public.subject_account_bindings b on b.subject_id=s.id
    where s.id=f.subject_id and s.subject_class='self' and s.lifecycle='active'
     and s.owner_account_id=p_account_id and s.subject_account_id=p_account_id
     and b.account_id=p_account_id and b.status='current'
     and to_jsonb(s.subject_binding_revision)=j.authority->'subjectBindingRevision'
     and to_jsonb(b.binding_revision)=j.authority->'accountBindingRevision'
     and to_jsonb(s.lifecycle_revision)=j.authority->'subjectLifecycleRevision') then
   raise exception using errcode='42501',message='not_found'; end if;
  if p_lock then
   select a.* into root from private.own_prepared_manifest_members mm
    join private.own_preparation_artifacts a on a.id=mm.artifact_id
    where mm.manifest_id=m.id and mm.artifact_id=m.root_artifact_id for share of mm,a;
  else
   select a.* into root from private.own_prepared_manifest_members mm
    join private.own_preparation_artifacts a on a.id=mm.artifact_id
    where mm.manifest_id=m.id and mm.artifact_id=m.root_artifact_id;
  end if;
  if root.id is null or root.job_id is distinct from m.job_id or root.attempt_id is distinct from m.attempt_id
   or root.state is distinct from 'acknowledged' or root.observed_sha256 is distinct from root.sha256 then
   raise exception using errcode='42501',message='not_found'; end if;
  if p_lock then
   perform 1 from storage.objects o where o.id=root.storage_object_id and o.bucket_id='genomes'
    and o.name=root.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=root.byte_count for share;
  else
   perform 1 from storage.objects o where o.id=root.storage_object_id and o.bucket_id='genomes'
    and o.name=root.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=root.byte_count;
  end if;
  if not found then raise exception using errcode='42501',message='not_found'; end if;
 else
  if p_lock then
   select * into n from private.own_normalization_runs where file_id=f.id and account_id=p_account_id and state='complete' for share;
  else select * into n from private.own_normalization_runs where file_id=f.id and account_id=p_account_id and state='complete'; end if;
  if n.file_id is null or (n.manifest->>'rawSha256'=f.sha256
   and n.manifest->>'decodedSha256'=f.source_sha256
   and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
   and n.manifest->>'objectId'=f.storage_object_id::text
   and n.manifest->>'objectKey'=f.bucket_path) is not true then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 if p_lock then
  perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
   where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
    and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
    and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
    and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes for share of g,o;
 else
  perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
   where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
    and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
    and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
    and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes;
 end if;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('fileType',f.file_type,'verifiedFileType',case when m.id is not null then m.source->'fileType' else n.manifest->'fileType' end)
  ||case when m.id is null then '{}'::jsonb else jsonb_build_object('preparedSource',jsonb_build_object(
   'version','own-prepared-report-source-v1','backend','prepared-object-v1','manifestId',m.id,
   'membershipSha256',m.membership_sha256,'rootArtifactId',root.id,'rootSha256',root.sha256)) end;
end; $$;
revoke all on function private.own_report_source_metadata_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;


create or replace function private.current_own_report_grant_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text; source_metadata jsonb;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=public.own_report_context_v1(p_account_id,p_session_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id for share;
 if f.id is null or f.single_logical_sample_verified_at is null or f.tier is distinct from 1
  or f.status is null or f.status not in ('stored','annotated')
  or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is null or f.build not in ('GRCh37','GRCh38') then raise exception using errcode='42501',message='not_found'; end if;
 source_metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,true);
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=pg.signer_principal_id
  and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
  and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
  and dg.self_principal_revision=(c->>'principalRevision')::bigint
  and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 for share of pg,dg,ca,cs;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id)||(source_metadata-array['fileType','verifiedFileType']);
end;
$function$;

create or replace function private.current_own_report_grant_read_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text; source_metadata jsonb;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_report_context_read_v1(p_account_id,p_session_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.tier is distinct from 1
  or f.status is null or f.status not in ('stored','annotated')
  or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is null or f.build not in ('GRCh37','GRCh38') then raise exception using errcode='42501',message='not_found'; end if;
 source_metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,false);
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=pg.signer_principal_id
  and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
  and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
  and dg.self_principal_revision=(c->>'principalRevision')::bigint
  and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id)||(source_metadata-array['fileType','verifiedFileType']);
end;
$function$;

create or replace function private.current_own_report_grant_mail_v1(p_account_id uuid,p_file_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; g public.purpose_grants%rowtype; v_key text; source_metadata jsonb;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_report_context_mail_v1(p_account_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.tier is distinct from 1
  or f.status is null or f.status not in ('stored','annotated')
  or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is null or f.build not in ('GRCh37','GRCh38') then raise exception using errcode='42501',message='not_found'; end if;
 source_metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,false);
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=f.subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=pg.signer_principal_id
  and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
  and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
  and dg.self_principal_revision=(c->>'principalRevision')::bigint
  and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'sourceRevision',f.upload_revision,'sourceSha256',f.sha256,'normalizedAt',f.normalization_completed_at,'subjectId',f.subject_id)||(source_metadata-array['fileType','verifiedFileType']);
end;
$function$;

create function private.assert_own_report_run_current_v1(p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid,p_authority jsonb,p_complete boolean) returns void
language plpgsql security definer set search_path=pg_catalog,private as $$
declare current_authority jsonb; published jsonb; deadline timestamptz;
begin
 if p_complete is null then raise exception using errcode='42501',message='not_found'; end if;
 current_authority:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 if current_authority is distinct from p_authority then raise exception using errcode='42501',message='not_found'; end if;
 -- The per-object claim gate stays indexed. Publication of an analysis
 -- additionally proves ALL final source members once, under current authority,
 -- after result/catalog work. A lost non-root member cannot slip through.
 if p_complete and current_authority ? 'preparedSource' then
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,
   (current_authority#>>'{preparedSource,manifestId}')::uuid);
  if current_authority->'preparedSource' is distinct from jsonb_build_object(
    'version','own-prepared-report-source-v1','backend','prepared-object-v1',
    'manifestId',published->'manifestId','membershipSha256',published->'membershipSha256',
    'rootArtifactId',published#>'{root,receipt,artifactId}','rootSha256',published#>'{root,receipt,sha256}')
   or published->>'fileId' is distinct from p_file_id::text
   or published->'subjectId' is distinct from current_authority->'subjectId'
   or published->'sourceRevision' is distinct from current_authority->'sourceRevision'
   or published->'rawSha256' is distinct from current_authority->'sourceSha256'
   or published->'preparedAt' is distinct from current_authority->'normalizedAt' then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 select least(r.expires_at,s.not_after,g.expires_at,c.expires_at) into deadline
 from private.own_analysis_runs r join auth.sessions s on s.id=p_session_id and s.user_id=p_account_id
 join public.purpose_grants g on g.grant_id=r.grant_id and g.grant_revision=r.grant_revision
 join public.subject_consents c on c.id=(current_authority#>>'{context,uploadConsentId}')::uuid
 where r.file_id=p_file_id and r.account_id=p_account_id and r.purpose=p_purpose and r.claim=p_claim
  and r.state=case when p_complete then 'complete' else 'running' end and r.authority=current_authority and g.revoked_at is null and c.revoked_at is null;
 if not found or deadline is null or deadline<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
end; $$;
revoke all on function private.assert_own_report_run_current_v1(uuid,uuid,uuid,text,uuid,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.own_report_generation_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_purpose text,p_claim uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare a jsonb; r private.own_analysis_runs%rowtype; result jsonb; v_subject uuid; f public.genome_files%rowtype; source jsonb; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')
  or p_operation is null or p_operation not in ('begin','check','read-variants','read-observed','complete','fail') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if p_operation='fail' then
  update private.own_analysis_runs set state='failed',result=null,completed_at=null
   where file_id=p_file_id and account_id=p_account_id and purpose=p_purpose and claim=p_claim and state='running';
  return 'true'::jsonb;
 end if;
 begin
  a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 exception when insufficient_privilege or object_not_in_prerequisite_state then
  if p_operation='begin' then return jsonb_build_object('status','not_selected'); end if;
  raise exception using errcode='42501',message='not_found';
 end;
 v_subject:=(a->>'subjectId')::uuid;
 if p_purpose='ancestry' then
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id and subject_id=v_subject for share;
  if f.file_type is null or f.file_type::text not in ('vcf','gvcf','array_23andme','array_ancestry','array_myheritage','array_ftdna')
   or (private.own_report_source_metadata_v1(p_account_id,p_file_id,true)->>'verifiedFileType') is distinct from f.file_type::text then
   raise exception using errcode='42501',message='not_found'; end if;
  source:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'normalizedBuild','GRCh38',
   'callEncoding',case when f.file_type::text in('vcf','gvcf') then 'vcf-literal' else 'array-genotype' end);
  -- Source metadata is a separate claim binding; authority remains exactly
  -- comparable to the existing locked/read/mail grant resolvers.
 end if;
 select * into r from private.own_analysis_runs where file_id=p_file_id and purpose=p_purpose for update;
 if p_operation='begin' then
  if p_payload is not null or p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  if private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
   return jsonb_build_object('status','complete','purpose',p_purpose); end if;
  if r.state='running' and r.expires_at>v_now and r.authority=a and r.ancestry_source is not distinct from source then
   raise exception using errcode='55000',message='analysis_in_progress'; end if;
  p_claim:=gen_random_uuid();
  insert into private.own_analysis_runs(file_id,subject_id,account_id,purpose,grant_id,grant_revision,authority,
   source_revision,source_sha256,normalization_completed_at,computation_revision,state,claim,expires_at,ancestry_source)
  values(p_file_id,v_subject,p_account_id,p_purpose,(a->>'grantId')::uuid,(a->>'grantRevision')::bigint,a,
   (a->>'sourceRevision')::bigint,a->>'sourceSha256',(a->>'normalizedAt')::timestamptz,case p_purpose when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end,'running',p_claim,v_now+interval '5 minutes',source)
  on conflict(file_id,purpose) do update set grant_id=excluded.grant_id,grant_revision=excluded.grant_revision,
   ancestry_source=excluded.ancestry_source,authority=excluded.authority,source_revision=excluded.source_revision,source_sha256=excluded.source_sha256,
   normalization_completed_at=excluded.normalization_completed_at,computation_revision=excluded.computation_revision,
   state='running',claim=excluded.claim,expires_at=excluded.expires_at,completed_at=null,result=null
  where private.own_analysis_runs.state<>'running' or private.own_analysis_runs.expires_at<=v_now
   or private.own_analysis_runs.authority is distinct from excluded.authority
   or private.own_analysis_runs.ancestry_source is distinct from excluded.ancestry_source
  returning * into r;
  if not found then raise exception using errcode='55000',message='analysis_in_progress'; end if;
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,r.claim,a,false);
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end;
 end if;
 if p_operation='check' and p_claim is null and private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  return jsonb_build_object('status','complete','purpose',p_purpose); end if;
 if r.id is null or r.state<>'running' or r.account_id<>p_account_id or r.claim is distinct from p_claim
  or r.authority is distinct from a or r.ancestry_source is distinct from source or r.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,false);
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end; end if;
 if p_operation in ('read-variants','read-observed') then
  if a ? 'preparedSource' then raise exception using errcode='55000',message='prepared_object_reader_required'; end if;
  if p_purpose='ancestry' and ((source->>'callEncoding'='vcf-literal' and p_operation<>'read-observed')
   or (source->>'callEncoding'='array-genotype' and p_operation<>'read-variants')) then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['loci','offset'])
   or p_payload-array['loci','offset']<>'{}'::jsonb or jsonb_typeof(p_payload->'loci') is distinct from 'array'
   or jsonb_array_length(p_payload->'loci') not between 1 and 200
   or p_payload->>'offset'!~'^(0|[1-9][0-9]*)$' then raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation='read-variants' then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    with requested as materialized (
     select distinct p.chrom,p.pos from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer))
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype
    from requested p cross join lateral (
     select v.id,v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype from public.user_variants v
     where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
      and v.chrom=p.chrom and v.pos=p.pos offset 0
    ) v order by v.id offset (p_payload->>'offset')::integer limit 1000) x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    with requested as materialized (
     select distinct p.chrom,p.pos from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer))
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable
    from requested p cross join lateral (
     select v.source_line,v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable from public.report_observed_calls v
     where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
      and v.source_sha256=a->>'sourceSha256' and v.extraction_version='vcf-literal-diploid-snp-v1'
      and v.source_build=(select build from public.genome_files where id=p_file_id)
      and v.chrom=p.chrom and v.pos=p.pos offset 0
    ) v order by v.source_line offset (p_payload->>'offset')::integer limit 1000) x;
  end if;
  return result;
 end if;
 if p_purpose='ancestry' then
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ? 'ancestry')
   or p_payload-'ancestry'<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_request'; end if;
  perform private.validate_own_ancestry_content_v1(p_payload->'ancestry',p_file_id,v_subject,a,source->>'callEncoding');
  update private.own_analysis_runs set state='complete',completed_at=clock_timestamp(),result=p_payload where id=r.id;
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,true);
  return jsonb_build_object('status','complete','purpose',p_purpose);
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['reports','prs'])
  or p_payload-array['reports','prs']<>'{}'::jsonb or jsonb_typeof(p_payload->'reports') is distinct from 'array'
  or jsonb_typeof(p_payload->'prs') is distinct from 'array' or octet_length(p_payload::text)>4000000
  or jsonb_array_length(p_payload->'reports') not between 1 and 1000 or jsonb_array_length(p_payload->'prs')>100
  or (p_purpose='reports.monogenic' and p_payload->'prs'<>'[]'::jsonb) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'reports') x where not exists(
  select 1 from public.report_templates t where t.slug=x->>'slug' and t.status='published'
   and t.layer::text=case when p_purpose='reports.monogenic' then 'variant_call' else 'estimate' end)) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if p_purpose='reports.polygenic' then
  delete from public.user_prs where file_id=p_file_id;
  insert into public.user_prs(user_id,subject_id,file_id,pgs_id,raw_score,zscore,percentile,coverage,matched)
  select p_account_id,v_subject,p_file_id,x.pgs_id,x.raw_score,null,null,x.coverage,x.matched
  from jsonb_to_recordset(p_payload->'prs') as x(pgs_id text,raw_score real,coverage real,matched integer);
 end if;
 -- No global annotated flag. Existing coverage-only numeric output boundaries
 -- remain unchanged; the stored summary contains no raw score or percentile.
 update private.own_analysis_runs set state='complete',completed_at=clock_timestamp(),
  result=jsonb_build_object('reports',p_payload->'reports','prsCount',jsonb_array_length(p_payload->'prs')) where id=r.id;
 perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,true);
 return jsonb_build_object('status','complete','purpose',p_purpose);
end;
$function$;


create or replace function private.own_analysis_completion_matches_v1(p_file_id uuid,p_purpose text,p_authorization jsonb)
returns boolean language sql security definer set search_path=pg_catalog,private as $function$
 select exists(select 1 from private.own_analysis_runs r where r.file_id=p_file_id and r.purpose=p_purpose
  and r.state='complete' and r.completed_at is not null and r.computation_revision=case p_purpose when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end
  and r.authority-'context'=p_authorization-'context'
  and (p_purpose<>'ancestry' or exists(select 1 from public.genome_files f
   where f.id=r.file_id and (private.own_report_source_metadata_v1(f.user_id,f.id,false)->>'verifiedFileType')=f.file_type::text
   and r.ancestry_source=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'normalizedBuild','GRCh38',
    'callEncoding',case when f.file_type::text in('vcf','gvcf') then 'vcf-literal'
     when f.file_type::text in('array_23andme','array_ancestry','array_myheritage','array_ftdna') then 'array-genotype' else null end)))
  -- Session refresh is not a new source or grant; live session is independently
  -- checked by the caller. Durable consent/binding context must remain exact.
  and (r.authority->'context')-array['authSessionRevision','originatingSessionRevision']
   =(p_authorization->'context')-array['authSessionRevision','originatingSessionRevision']);
$function$;

create or replace function public.read_own_report_calls_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_purpose text,
 p_rsids bigint[],p_offset integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $function$
declare a jsonb; rows jsonb; f public.genome_files%rowtype;
begin
 if p_purpose not in ('reports.monogenic','reports.polygenic') or p_purpose is null
  or p_rsids is null or cardinality(p_rsids) not between 1 and 200 or p_offset is null or p_offset<0
  or exists(select 1 from unnest(p_rsids) x where x is null or x<=0) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,p_purpose);
 if a ? 'preparedSource' then raise exception using errcode='55000',message='prepared_object_reader_required'; end if;
 if not private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id;
 select coalesce(jsonb_agg(jsonb_build_object('file_id',p_file_id,'rsid',q.rsid,'chrom',q.chrom,'pos',q.pos,
  'ref',q.ref,'alt',q.alt,'genotype',q.genotype,'usable',q.usable)),'[]'::jsonb) into rows from (
   select u.rsid,u.chrom,u.pos,u.ref,u.alt,u.genotype,true as usable,0 as kind,u.id as row_key
   from public.user_variants u where u.file_id=p_file_id and u.user_id=p_account_id
    and u.subject_id=(a->>'subjectId')::uuid and u.rsid=any(p_rsids)
   union all
   select o.rsid,o.chrom,o.pos,o.ref,o.alt,o.genotype,o.usable,1 as kind,o.source_line as row_key
   from public.report_observed_calls o where o.file_id=p_file_id and o.user_id=p_account_id
    and o.subject_id=(a->>'subjectId')::uuid and o.rsid=any(p_rsids)
    and o.extraction_version='vcf-literal-diploid-snp-v1'
    and o.source_build=f.build and o.source_sha256=f.sha256
   order by kind,row_key offset p_offset limit 1000
  ) q;
 return rows;
end;
$function$;

-- Exact own saved-result read. No shared recipient, raw calls or generation.
create or replace function public.own_captured_report_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_file_id uuid,p_slug text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb; f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
 r private.own_analysis_runs%rowtype; a jsonb; source_view jsonb; provenance jsonb; selected jsonb; output jsonb;
 v_purpose text; result jsonb; match_count integer:=0; deadline timestamptz; prepared boolean; source_metadata jsonb; source_receipt jsonb; published jsonb;
begin
 if p_slug is null or p_slug='' or length(p_slug)>200 or p_slug like 'auto-e2e-%'
 or p_file_id is null or (p_expected is not null and p_expected!~'^[0-9a-f]{64}$') then return null; end if;
 context:=public.own_report_context_v1(p_account_id,p_session_id,p_subject_id);
 -- One exact own source. Stable NOWAIT locks refuse competing transitions;
 -- no browser-supplied owner or fabricated counterpart/session can authorize it.
 perform 1 from auth.users where id=p_account_id for share nowait;
 perform 1 from public.profiles where id=p_account_id for share nowait;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share nowait;
 perform 1 from public.subjects where id=p_subject_id for share nowait;
 perform 1 from public.subject_account_bindings where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.subject_principals where account_id=p_account_id order by id for share nowait;
 select * into f from public.genome_files where id=p_file_id and subject_id=p_subject_id and user_id=p_account_id
  and single_logical_sample_verified_at is not null for share nowait;
 if f.id is null or exists(select 1 from private.genome_file_deletions where file_id=p_file_id) then return null; end if;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id=p_subject_id order by grant_id for share nowait;
 perform 1 from public.directional_grants where grant_id in(select grant_id from public.purpose_grants where target_kind='subject' and target_id=p_subject_id) order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id=p_subject_id order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('disclosure.insurance-and-discrimination','consent.upload-self','consent.own-monogenic','consent.own-polygenic') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id=p_subject_id order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id=p_file_id order by object_id for share nowait;
 perform 1 from storage.objects where id=f.storage_object_id for share nowait;
 prepared:=exists(select 1 from private.own_preparation_jobs where file_id=p_file_id and state<>'frozen')
  or exists(select 1 from private.own_prepared_manifests where file_id=p_file_id);
 if prepared then
  source_metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,true);
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,
   (source_metadata#>>'{preparedSource,manifestId}')::uuid);
 else
 select * into n from private.own_normalization_runs where file_id=p_file_id and state='complete' for share nowait;
 end if;
 perform 1 from private.own_analysis_runs where file_id=p_file_id order by id for share nowait;
 if (not prepared and n.file_id is null) or public.own_report_context_v1(p_account_id,p_session_id,p_subject_id) is distinct from context then return null; end if;
 select min(expires_at) into deadline from (
  select expires_at from public.purpose_grants where target_kind='subject' and target_id=p_subject_id
   and purpose in('reports.monogenic','reports.polygenic') and revoked_at is null and expires_at>clock_timestamp()
  union all select expires_at from public.subject_consents where subject_id=p_subject_id and revoked_at is null and expires_at>clock_timestamp()
  union all select not_after from auth.sessions where id=p_session_id and user_id=p_account_id
 ) deadlines;
 provenance:=null;
 if not prepared and n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
  and n.provenance->>'sourceBuild'=f.build and n.provenance->>'targetBuild'='GRCh38'
  and (f.build<>'GRCh37' or coalesce(n.provenance->>'chainSha256','')~'^[0-9a-f]{64}$')
  and (f.build<>'GRCh38' or n.provenance->'chainSha256'='null'::jsonb) then
  provenance:=jsonb_build_object('sourceBuild',n.provenance->'sourceBuild','buildBasis',n.provenance->'buildBasis',
   'targetBuild',n.provenance->'targetBuild','variantRowsMapped',n.provenance->'variantRowsMapped',
   'variantRowsUnmapped',n.provenance->'variantRowsUnmapped','counts',n.provenance->'counts');
 end if;
 source_view:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',provenance);
 foreach v_purpose in array array['reports.monogenic','reports.polygenic'] loop
  begin
   if prepared then
    a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,v_purpose);
    source_receipt:=a->'preparedSource';
   else
    a:=private.family_source_report_authority_v1(p_account_id,p_file_id,v_purpose);
    source_receipt:=n.manifest;
   end if;
   if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,a) is not true then continue; end if;
   select * into r from private.own_analysis_runs where file_id=p_file_id and purpose=v_purpose and state='complete';
   if r.id is null or jsonb_typeof(r.result->'reports') is distinct from 'array' then continue; end if;
   for selected in select value from jsonb_array_elements(r.result->'reports') where value->>'slug'=p_slug loop
    -- Missing historical catalog proof cannot be replaced with today's catalog.
    if jsonb_typeof(selected->'catalogSnapshot') is distinct from 'object' then return null; end if;
    match_count:=match_count+1;
    result:=jsonb_build_object('fileId',p_file_id,'subjectId',p_subject_id,'purpose',v_purpose,
     'completedAt',r.completed_at,'source',source_view,'reports',jsonb_build_array(selected),
     'receipt',encode(extensions.digest(convert_to(jsonb_build_object('authority',a,'result',r.result,
      'completedAt',r.completed_at,'claim',r.claim,'manifest',source_receipt,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'));
   end loop;
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if match_count<>1 then return null; end if;
 output:=jsonb_build_object('source',result,'receipt',encode(extensions.digest(convert_to(
  jsonb_build_object('context',context,'source',result)::text,'UTF8'),'sha256'),'hex'));
 if p_expected is not null and output->>'receipt' is distinct from p_expected then return null; end if;
 if public.own_report_context_v1(p_account_id,p_session_id,p_subject_id) is distinct from context then return null; end if;
 if prepared and private.own_report_source_metadata_v1(p_account_id,p_file_id,true) is distinct from source_metadata then return null; end if;
 if prepared and private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,
  (source_metadata#>>'{preparedSource,manifestId}')::uuid) is distinct from published then return null; end if;
 if deadline is not null and deadline<=clock_timestamp() then return null; end if;
 return output;
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;




-- Ready-mail metadata validation, not a session/job/genetic-read authority.
-- Hold exact source/member/Storage rows through the whole scan. The caller
-- still rechecks its real mail context, selected grants and finite clocks.
create function private.own_report_members_metadata_current_v1(p_account_id uuid,p_file_id uuid,p_source jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare metadata jsonb; m private.own_prepared_manifests%rowtype; member record; seen integer:=0;
begin
 metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,true);
 if p_source is null or metadata->'preparedSource' is distinct from p_source then return false; end if;
 select * into m from private.own_prepared_manifests where file_id=p_file_id and id=(p_source->>'manifestId')::uuid for share;
 if m.id is null then return false; end if;
 for member in select a.* from private.own_prepared_manifest_members mm
  join private.own_preparation_artifacts a on a.id=mm.artifact_id where mm.manifest_id=m.id order by a.id for share of mm,a loop
  if member.job_id is distinct from m.job_id or member.attempt_id is distinct from m.attempt_id
   or member.state is distinct from 'acknowledged' or member.observed_sha256 is distinct from member.sha256 then return false; end if;
  perform 1 from storage.objects o where o.id=member.storage_object_id and o.bucket_id='genomes'
   and o.name=member.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=member.byte_count for share;
  if not found then return false; end if;
  seen:=seen+1;
 end loop;
 if seen<>m.member_count or private.own_prepared_membership_v1(m.id) is distinct from m.membership_sha256 then return false; end if;
 return private.own_report_source_metadata_v1(p_account_id,p_file_id,false)->'preparedSource'=p_source;
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end; $$;
revoke all on function private.own_report_members_metadata_current_v1(uuid,uuid,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

create or replace function private.own_report_ready_state_v1(p_account_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; v_purpose text; a jsonb; selections jsonb:='{}'; prepared_source jsonb; checked jsonb; output jsonb; deadline timestamptz;
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or exists(
  select 1 from private.genome_file_deletions where file_id=f.id) then return null; end if;
 for v_purpose in select pg.purpose from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_kind='subject' and pg.target_id=f.subject_id
   and pg.purpose in ('reports.monogenic','reports.polygenic') and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id
  order by pg.purpose loop
  a:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
  if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,a) is not true or not exists(
   select 1 from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose=v_purpose and r.state='complete' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at) then return null; end if;
  a:=jsonb_set(a,'{context}',(a->'context')-array['authSessionRevision','originatingSessionRevision']);
  selections:=selections||jsonb_build_object(v_purpose,a);
 end loop;
 if selections='{}'::jsonb then return null; end if;
 perform 1 from auth.users where id=p_account_id and email_confirmed_at is not null and nullif(trim(email),'') is not null;
 if not found then return null; end if;
 -- Only prepared ready-state performs this full metadata scan; the fast
 -- grant resolver remains suitable for every per-object operation check.
 select value->'preparedSource' into prepared_source from jsonb_each(selections)
  where value ? 'preparedSource' limit 1;
 if prepared_source is not null then
  if not private.own_report_members_metadata_current_v1(p_account_id,p_file_id,prepared_source) then return null; end if;
  for v_purpose,a in select key,value from jsonb_each(selections) loop
   checked:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
   if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,checked) is not true then return null; end if;
   checked:=jsonb_set(checked,'{context}',(checked->'context')-array['authSessionRevision','originatingSessionRevision']);
   if checked is distinct from a then return null; end if;
  end loop;
  select min(expires_at) into deadline from (
   select g.expires_at from jsonb_each(selections) x join public.purpose_grants g on g.grant_id=(x.value->>'grantId')::uuid
   union all select c.expires_at from jsonb_each(selections) x join public.subject_consents c on c.id=(x.value#>>'{context,uploadConsentId}')::uuid
  ) deadlines;
 end if;
 output:=jsonb_build_object('version','own-report-ready-v1','accountId',p_account_id,'fileId',f.id,
  'subjectId',f.subject_id,'computationRevision','own-reports-v1','purposes',selections,
  'recipientContactRevision',(select mail_contact_revision from public.profiles where id=p_account_id));
 if prepared_source is not null and deadline is not null and deadline<=clock_timestamp() then return null; end if;
 return output;
exception when insufficient_privilege or object_not_in_prerequisite_state then return null;
end; $$;

create or replace function private.own_report_ready_state_v2(p_account_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; v_purpose text; a jsonb; selections jsonb:='{}'; prepared_source jsonb; checked jsonb; output jsonb; deadline timestamptz;
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or exists(
  select 1 from private.genome_file_deletions where file_id=f.id) then return null; end if;
 for v_purpose in select pg.purpose from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_kind='subject' and pg.target_id=f.subject_id
   and pg.purpose in ('reports.monogenic','reports.polygenic','ancestry') and pg.revoked_at is null
   and (pg.expires_at is null or pg.expires_at>clock_timestamp())
   and dg.status='current' and dg.direction='self' and dg.recipient_account_id=p_account_id
  order by pg.purpose loop
  a:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
  if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,a) is not true or not exists(
   select 1 from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose=v_purpose and r.state='complete' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at) then return null; end if;
  a:=jsonb_set(a,'{context}',(a->'context')-array['authSessionRevision','originatingSessionRevision']);
  selections:=selections||jsonb_build_object(v_purpose,a);
 end loop;
 if not(selections ? 'ancestry') then return null; end if;
 perform 1 from auth.users where id=p_account_id and email_confirmed_at is not null and nullif(trim(email),'') is not null;
 if not found then return null; end if;
 -- Only prepared ready-state performs this full metadata scan; the fast
 -- grant resolver remains suitable for every per-object operation check.
 select value->'preparedSource' into prepared_source from jsonb_each(selections)
  where value ? 'preparedSource' limit 1;
 if prepared_source is not null then
  if not private.own_report_members_metadata_current_v1(p_account_id,p_file_id,prepared_source) then return null; end if;
  for v_purpose,a in select key,value from jsonb_each(selections) loop
   checked:=private.current_own_report_grant_mail_v1(p_account_id,p_file_id,v_purpose);
   if private.own_analysis_completion_matches_v1(p_file_id,v_purpose,checked) is not true then return null; end if;
   checked:=jsonb_set(checked,'{context}',(checked->'context')-array['authSessionRevision','originatingSessionRevision']);
   if checked is distinct from a then return null; end if;
  end loop;
  select min(expires_at) into deadline from (
   select g.expires_at from jsonb_each(selections) x join public.purpose_grants g on g.grant_id=(x.value->>'grantId')::uuid
   union all select c.expires_at from jsonb_each(selections) x join public.subject_consents c on c.id=(x.value#>>'{context,uploadConsentId}')::uuid
  ) deadlines;
 end if;
 output:=jsonb_build_object('version','own-report-ready-v2','accountId',p_account_id,'fileId',f.id,
  'subjectId',f.subject_id,'computationRevisions',(select jsonb_object_agg(k,case k when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end) from jsonb_object_keys(selections) k),'purposes',selections,
  'recipientContactRevision',(select mail_contact_revision from public.profiles where id=p_account_id));
 if prepared_source is not null and deadline is not null and deadline<=clock_timestamp() then return null; end if;
 return output;
exception when insufficient_privilege or object_not_in_prerequisite_state then return null;
end; $$;

-- Prepared ancestry retains the real current session and complete source at both saved-read boundaries.
create or replace function private.own_ancestry_content_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $fn$
declare a jsonb; checked jsonb; r private.own_analysis_runs%rowtype; published jsonb; output jsonb; deadline timestamptz;
begin
 a:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,p_file_id,'ancestry');
 if a ? 'preparedSource' then
  a:=private.current_own_report_grant_v1(p_account_id,p_session_id,p_file_id,'ancestry');
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,(a#>>'{preparedSource,manifestId}')::uuid);
  perform 1 from private.own_analysis_runs where file_id=p_file_id and purpose='ancestry' for share;
 end if;
 if private.own_analysis_completion_matches_v1(p_file_id,'ancestry',a) is not true then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into r from private.own_analysis_runs where file_id=p_file_id and purpose='ancestry'
  and account_id=p_account_id and subject_id=(a->>'subjectId')::uuid and state='complete';
 if r.id is null or r.result-'ancestry'<>'{}'::jsonb then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.validate_own_ancestry_content_v1(r.result->'ancestry',r.file_id,r.subject_id,a,r.ancestry_source->>'callEncoding');
 checked:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,p_file_id,'ancestry');
 if checked is distinct from a or private.own_analysis_completion_matches_v1(p_file_id,'ancestry',checked) is not true then
  raise exception using errcode='42501',message='not_found'; end if;
 output:=jsonb_build_object('content',r.result->'ancestry','completedAt',r.completed_at);
 if a ? 'preparedSource' then
  if private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,
   (a#>>'{preparedSource,manifestId}')::uuid) is distinct from published then
   raise exception using errcode='42501',message='not_found'; end if;
  select least(s.not_after,g.expires_at,c.expires_at) into deadline from auth.sessions s
   join public.purpose_grants g on g.grant_id=(a->>'grantId')::uuid and g.grant_revision=(a->>'grantRevision')::bigint
   join public.subject_consents c on c.id=(a#>>'{context,uploadConsentId}')::uuid
   where s.id=p_session_id and s.user_id=p_account_id;
  if not found or (deadline is not null and deadline<=clock_timestamp()) then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 return output;
exception when invalid_parameter_value or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$fn$;
