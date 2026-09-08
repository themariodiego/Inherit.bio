-- A one-million-row own-array source reached terminal publication but inherited
-- PostgREST's 8s statement budget and rolled back. Keep the five-minute exact
-- normalization claim and every authority/source check unchanged.
--
-- Autosomal rows cannot violate this embryo-only restriction. Avoid querying
-- the same subject once per autosomal row; non-autosomal rows still use the
-- identical subject-class predicate and rejection code/message.
create or replace function private.enforce_subject_variant_chromosome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.chrom not between 1 and 22 then
    if exists (
      select 1 from public.subjects s
      where s.id = new.subject_id and s.subject_class = 'embryo'
    ) then
      raise exception using errcode = '23514', message = 'non-autosomal embryo variant forbidden';
    end if;
  end if;
  return new;
end;
$$;

-- Preserve the dispatcher verbatim except for its terminal authority/clock
-- fence. CREATE OR REPLACE preserves existing ownership and grants.
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
  select case when f.file_type::text like 'array_%' then maximum_array_bytes else maximum_vcf_bytes end
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

-- PostgREST hoists the exposed function's statement_timeout before the RPC.
-- Scope the budget to this existing service-only wrapper: do not change a
-- role/database timeout, unrelated dispatcher behavior, claim deadline or ACL.
-- 45s remains below the documented 60s Database REST API cap.
-- https://supabase.com/docs/guides/database/postgres/timeouts#function-level
alter function public.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)
  set statement_timeout = '45s';

-- The RPC body and all ownership/grant properties are preserved by ALTER.
notify pgrst, 'reload schema';
