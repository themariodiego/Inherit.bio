-- A ceiling of its own for gVCF. One maximum_vcf_bytes has governed VCF,
-- VCF.gz and gVCF alike at issuance, normalization, preparation admission and
-- the limit disclosure; the owner's decision of 18 September 2026 sets the two
-- apart (2 GiB VCF, 8 GiB gVCF). Additive only: the new column is null until
-- an operator sets it, and every reader falls back to maximum_vcf_bytes while
-- it is null, so applying this changes no limit. Each function below is the
-- current body with that one case added; grants, ownership and search_path
-- are unchanged by create or replace.
--
-- Release order: the app must accept the extra disclosure key
-- (maximumGvcfBytes) before this is applied, because its schema is strict.
alter table private.upload_authorization_config
 add column maximum_gvcf_bytes bigint check(maximum_gvcf_bytes>0 and maximum_gvcf_bytes<=9007199254740991);

-- Issuance: a gVCF declaration is measured against the gVCF ceiling, and that
-- ceiling is stored as the session's maximum_decoded_bytes, so finalization
-- measures the decompressed bytes against the same number.
create or replace function private.issue_own_storage_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz; limits private.upload_authorization_config%rowtype; v_reserved numeric;
begin
 if p_declared_format is null or p_declared_format not in
  ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  or p_size_bytes is null or p_size_bytes<=0 or (p_sha256 is not null and p_sha256!~'^[0-9a-f]{64}$') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 if p_subject_id is null then
  select id into p_subject_id from public.subjects where subject_account_id=p_account_id
   and subject_class='self' and lifecycle='active';
 end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then limits.maximum_array_bytes
  when p_declared_format='gVCF' then coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes) else limits.maximum_vcf_bytes end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 -- The live authority helper holds the account lock, so concurrent issuers
 -- cannot each reserve the same remaining account allowance.
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 v_reserved:=v_reserved+(select coalesce(sum(expected_size),0) from public.upload_sessions
  where account_id=p_account_id and status in ('issued','uploaded','validating') and expires_at>clock_timestamp());
 if v_reserved+p_size_bytes>limits.maximum_account_bytes then
  raise exception using errcode='22023',message='file_too_large'; end if;
 if (select count(*) from public.upload_sessions where account_id=p_account_id
  and status in ('issued','uploaded','validating') and expires_at>clock_timestamp())>=limits.maximum_active_uploads then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select not_after into v_not_after from auth.sessions where id=p_session_id and user_id=p_account_id;
 insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id,maximum_decoded_bytes)
 values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256,
  'application/octet-stream',1,'issued',least(clock_timestamp()+interval '30 minutes',v_not_after),
  'genomes',gen_random_uuid(),p_declared_format,(c->>'accountRevision')::bigint,
  (c->>'authSessionRevision')::bigint,(c->>'originatingSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,
  (c->>'accountBindingRevision')::bigint,(c->>'subjectLifecycleRevision')::bigint,(c->>'uploadConsentId')::uuid,v_max)
 returning * into u;
 return jsonb_build_object('accountId',u.account_id,'sessionId',u.auth_session_id,
  'accountAuthSessionRevision',u.account_auth_session_revision,'uploadId',u.id,'jti',u.token_jti,
  'stagingKey',u.staging_object_name,'expiresAt',u.expires_at,'maximumBytes',u.expected_size);
end;
$function$;

-- Normalization admission for a stored gvcf source.
create or replace function private.own_upload_normalization_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_claim uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype; c jsonb; m jsonb; r private.own_normalization_runs%rowtype;
 v_max bigint; v_variant_count bigint; v_observed_count bigint; v_finished timestamptz;
 v_authority_deadline timestamptz;
begin
 if p_operation is null or p_operation not in ('begin','check','stage','complete','fail','reject-build','check-rejected','finish-rejected') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into f from public.genome_files where id=p_file_id;
 if f.id is null or f.user_id is distinct from p_account_id or f.tier<>1
  or f.subject_id is null or f.single_logical_sample_verified_at is null
  or f.structural_validator_version<>'single-logical-sample-v1' then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A rejected-build object is an exact frozen cleanup target, not a new data
 -- read. Its original worker can finish cleanup even after consent revocation.
 if p_operation in ('check-rejected','finish-rejected') or (p_operation='begin' and exists(
  select 1 from private.own_normalization_runs where file_id=f.id and state in ('rejecting','rejected'))) then
  perform 1 from public.genome_files where id=f.id for update;
  select * into r from private.own_normalization_runs where file_id=f.id for update;
  if r.account_id is distinct from p_account_id or r.state not in ('rejecting','rejected')
   or (p_operation<>'begin' and (p_claim is null or r.claim is distinct from p_claim))
   or not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_account_id
    and (not_after is null or not_after>clock_timestamp())) then
   raise exception using errcode='42501',message='not_found'; end if;
  if p_operation='finish-rejected' then
   if exists(select 1 from storage.objects where id=f.storage_object_id or (bucket_id='genomes' and name=f.bucket_path)) then
    raise exception using errcode='55000',message='cleanup_incomplete'; end if;
   update public.genome_storage_objects set state='purged' where genome_file_id=f.id and object_id=f.storage_object_id;
   update private.own_normalization_runs set state='rejected' where file_id=f.id;
   return 'true'::jsonb;
  end if;
  return jsonb_build_object('status','build_cleanup_required','fileId',f.id,'claim',r.claim,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id);
 end if;
 -- Cleanup cannot publish anything and is deliberately allowed after revocation.
 if p_operation='fail' then
  perform 1 from public.genome_files where id=f.id for update;
  select * into r from private.own_normalization_runs where file_id=f.id for update;
  if p_claim is null or r.claim is distinct from p_claim or r.account_id is distinct from p_account_id
   or r.session_id is distinct from p_session_id or r.state<>'running' then
   raise exception using errcode='42501',message='not_found'; end if;
  delete from private.own_normalization_batches where file_id=f.id;
  update private.own_normalization_runs set state='failed' where file_id=f.id;
  update public.genome_files set status='failed',error='File preparation did not complete. Please try again.'
   where id=f.id and processing_run_id=p_claim and normalization_completed_at is null;
  return 'true'::jsonb;
 end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
 -- Lock order follows the store-authority account/subject locks, then the file.
 perform 1 from public.genome_files where id=f.id and user_id=f.user_id and subject_id=f.subject_id
  and upload_revision=f.upload_revision and bucket_path=f.bucket_path and storage_object_id=f.storage_object_id
  and sha256=f.sha256 and source_sha256=f.source_sha256 for update;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=f.id;
 if not exists(select 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
  where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
   and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
   and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
   and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes)
  or f.bucket_path!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into r from private.own_normalization_runs where file_id=f.id for update;
 if p_operation='begin' then
  if p_payload is not null or p_claim is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  if f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision and r.state='complete' then
   return jsonb_build_object('fileId',f.id,'status','normalization_complete','analysisState','not_generated'); end if;
  if f.status not in ('uploaded','stored','failed','parsing') or (r.state='running' and r.expires_at>clock_timestamp()) then
   raise exception using errcode='55000',message='normalization_in_progress'; end if;
  select case when f.file_type::text like 'array_%' then maximum_array_bytes
   when f.file_type::text='gvcf' then coalesce(maximum_gvcf_bytes,maximum_vcf_bytes) else maximum_vcf_bytes end
   into v_max from private.upload_authorization_config where singleton for share;
  if v_max is null or f.size_bytes>v_max then raise exception using errcode='55000',message='unavailable'; end if;
  p_claim:=gen_random_uuid();
  m:=jsonb_build_object('status','authorized','fileId',f.id,'claim',p_claim,'subjectId',f.subject_id,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id,'sizeBytes',f.size_bytes,
   'rawSha256',f.sha256,'decodedSha256',f.source_sha256,'fileType',f.file_type,
   'sourceRevision',f.upload_revision,'maximumDecodedBytes',v_max);
  delete from private.own_normalization_batches where file_id=f.id;
  insert into private.own_normalization_runs(file_id,claim,account_id,session_id,authority,manifest,expires_at,state)
   values(f.id,p_claim,p_account_id,p_session_id,c,m,clock_timestamp()+interval '5 minutes','running')
   on conflict(file_id) do update set claim=excluded.claim,account_id=excluded.account_id,session_id=excluded.session_id,
    authority=excluded.authority,manifest=excluded.manifest,expires_at=excluded.expires_at,state='running',provenance=null;
  update public.genome_files set status='parsing',processing_run_id=p_claim,processing_started_at=clock_timestamp(),
   processing_finished_at=null,error=null where id=f.id;
  return m;
 end if;
 if p_claim is null or r.claim is distinct from p_claim or r.account_id is distinct from p_account_id
  or r.session_id is distinct from p_session_id or r.state<>'running' or r.expires_at<=clock_timestamp()
  or r.authority is distinct from c or f.processing_run_id is distinct from p_claim or f.status<>'parsing'
  or r.manifest->>'rawSha256' is distinct from f.sha256 or r.manifest->>'decodedSha256' is distinct from f.source_sha256
  or (r.manifest->>'sourceRevision')::bigint is distinct from f.upload_revision then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  return r.manifest;
 elsif p_operation='reject-build' then
  if p_payload is not null or exists(select 1 from private.own_normalization_batches where file_id=f.id)
   or exists(select 1 from public.user_variants where file_id=f.id)
   or exists(select 1 from public.report_observed_calls where file_id=f.id)
   or f.normalization_completed_at is not null then
   raise exception using errcode='42501',message='not_found'; end if;
  update public.genome_files set status='failed',build='unknown',error='build_unknown' where id=f.id;
  update public.genome_storage_objects set state='purge_queued',revoked_at=clock_timestamp()
   where genome_file_id=f.id and object_id=f.storage_object_id;
  update private.own_normalization_runs set state='rejecting' where file_id=f.id;
  return jsonb_build_object('status','build_cleanup_required','fileId',f.id,'claim',r.claim,
   'bucket','genomes','objectKey',f.bucket_path,'objectId',f.storage_object_id);
 elsif p_operation='stage' then
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
 m:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
 if m is distinct from c or m is distinct from r.authority then
  raise exception using errcode='42501',message='not_found'; end if;
 select least(r.expires_at,a.not_after,sc.expires_at) into v_authority_deadline
 from auth.sessions a join public.subject_consents sc
  on sc.id=(r.authority->>'uploadConsentId')::uuid
 where a.id=p_session_id and a.user_id=p_account_id
  and sc.subject_id=f.subject_id and sc.account_id=p_account_id;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 -- Take the publication clock only after the final authority/deadline reads.
 v_finished:=clock_timestamp();
 if v_authority_deadline is null or v_finished>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.genome_files set status='stored',build=p_payload->>'sourceBuild',variant_count=v_variant_count,
  processing_finished_at=v_finished,normalization_completed_at=v_finished,normalization_source_revision=upload_revision
  where id=f.id;
 update private.own_normalization_runs set state='complete',provenance=p_payload->'provenance' where file_id=f.id;
 delete from private.own_normalization_batches where file_id=f.id;
 -- Include terminal metadata/batch cleanup in the same finite publication.
 if clock_timestamp()>=v_authority_deadline then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('fileId',f.id,'status','normalization_complete','analysisState','not_generated');
end;
$function$;

-- Preparation admission for a stored gvcf source.
create or replace function private.own_preparation_source_v1(p_account uuid,p_session uuid,p_file uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; a jsonb; deadline timestamptz; maximum bigint;
begin
 select * into f from public.genome_files where id=p_file and user_id=p_account;
 if f.id is null or f.subject_id is null then raise exception using errcode='42501',message='not_found'; end if;
 a:=private.own_upload_store_authority_v1(p_account,p_session,f.subject_id);
 -- The existing helper locks account/subject before this exact source lock.
 select * into f from public.genome_files where id=p_file and user_id=p_account for update;
 if f.id is null or f.tier is distinct from 1 or f.file_type::text not in('vcf','gvcf')
  or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.status not in('uploaded','stored','failed') or f.normalization_completed_at is not null
  or f.sha256 is null or f.source_sha256 is null or f.storage_object_id is null
  or not exists(select 1 from public.subjects s where s.id=f.subject_id and s.subject_class='self'
   and s.lifecycle='active' and s.owner_account_id=p_account and s.subject_account_id=p_account)
  or exists(select 1 from private.genome_file_deletions d where d.file_id=f.id)
  or exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.state in('running','complete','rejecting','rejected'))
  or exists(select 1 from public.worker_jobs w where w.file_id=f.id and w.status in('queued','running')) then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
 where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
  and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
  and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
  and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes
 for share of g,o;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select case when f.file_type::text='gvcf' then coalesce(maximum_gvcf_bytes,maximum_vcf_bytes) else maximum_vcf_bytes end
  into maximum from private.upload_authorization_config where singleton for share;
 if maximum is null or f.size_bytes>maximum then raise exception using errcode='42501',message='not_found'; end if;
 select least(s.not_after,c.expires_at) into deadline from auth.sessions s join public.subject_consents c
  on c.id=(a->>'uploadConsentId')::uuid where s.id=p_session and s.user_id=p_account;
 if not found or (deadline is not null and deadline<=clock_timestamp()) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('authority',a,'authorityDeadline',deadline,'source',jsonb_build_object(
  'fileId',f.id,'subjectId',f.subject_id,'sourceRevision',f.upload_revision,'rawSha256',f.sha256,
  'decodedSha256',f.source_sha256,'bucket','genomes','objectId',f.storage_object_id,'objectKey',f.bucket_path,
  'sizeBytes',f.size_bytes,'fileType',f.file_type,'maximumDecodedBytes',maximum));
end; $$;

-- Disclosure: the gVCF ceiling as it applies, never null.
create or replace function private.own_upload_limits_v1(p_account_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare limits private.upload_authorization_config%rowtype; v_reserved numeric; v_active bigint;
begin
 if p_account_id is null or p_session_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A live session of this exact account only. This discloses deployment
 -- capacity and one account's own byte total, never another account's.
 if not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>clock_timestamp())) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 select v_reserved+coalesce(sum(expected_size),0),count(*) into v_reserved,v_active
  from public.upload_sessions where account_id=p_account_id
  and status in('issued','uploaded','validating') and expires_at>clock_timestamp();
 return jsonb_build_object('maximumArrayBytes',limits.maximum_array_bytes,
  'maximumVcfBytes',limits.maximum_vcf_bytes,'maximumGvcfBytes',coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes),
  'maximumAccountBytes',limits.maximum_account_bytes,
  'maximumActiveUploads',limits.maximum_active_uploads,'reservedBytes',v_reserved::bigint,
  'activeUploads',v_active);
end;
$function$;
