-- Prepared export uses the actual current published source. No upload, grant,
-- analysis, provider write or backend activation is introduced. Existing DB
-- snapshots keep their exact shape and genuine completed normalization rules.
create or replace function private.own_export_source_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; s public.subjects%rowtype; p public.profiles%rowtype;
 b public.subject_account_bindings%rowtype; sp public.subject_principals%rowtype;
 ap public.subject_principals%rowtype; session_revision bigint; normalized boolean;
 published jsonb; manifest_id uuid; result jsonb;
begin
 -- Serialize backend selection against enqueue/publication/deletion in the
 -- same Auth -> session -> profile -> subject -> file order as preparation.
 -- Existing own-right eligibility below (including pending deletion) is kept.
 perform 1 from auth.users where id=p_account_id for share;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share;
 perform 1 from public.profiles where id=p_account_id for update;
 select * into f from public.genome_files where id=p_file_id;
 perform 1 from public.subjects where id=f.subject_id for share;
 perform 1 from public.genome_files where id=p_file_id for share;
 -- Decide the backend before reading snapshot fields. The full published read
 -- obtains the existing Auth/session/profile/subject/file/job/member locks.
 -- A frozen unmanifested attempt remains eligible for genuine DB recovery.
 if p_file_id is not null and (exists(select 1 from private.own_prepared_manifests where file_id=p_file_id)
  or exists(select 1 from private.own_preparation_jobs where file_id=p_file_id and state<>'frozen')) then
  select id into manifest_id from private.own_prepared_manifests where file_id=p_file_id;
  if manifest_id is null then raise exception using errcode='55000',message='prepared_source_not_ready'; end if;
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,manifest_id);
 end if;
 perform 1 from auth.users where id=p_account_id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(refresh_token_counter,0)+1 into session_revision from auth.sessions
  where id=p_session_id and user_id=p_account_id and (not_after is null or not_after>clock_timestamp());
 select * into p from public.profiles where id=p_account_id;
 -- A pending account-deletion notice does not remove the subject's data right.
 if session_revision is null or p.id is null or exists(select 1 from public.account_deletion_requests d
  where d.account_id=p_account_id and (d.state in ('delete_started','complete') or d.delete_started_at is not null
   or d.storage_manifest_frozen_at is not null or d.storage_completed_at is not null or d.database_purged_at is not null)) then raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id;
 select * into s from public.subjects where id=f.subject_id;
 if s.id is null or s.subject_account_id is distinct from p_account_id
  or s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','restricted')
  or f.tier is distinct from 1 or f.status='uploading'
  or f.single_logical_sample_verified_at is null or f.source_sha256 is null
  or f.structural_validator_version is distinct from 'single-logical-sample-v1' then return null; end if;
 select * into b from public.subject_account_bindings where subject_id=s.id and account_id=p_account_id and status='current';
 select * into sp from public.subject_principals where id=b.subject_principal_id and subject_id=s.id
  and account_id=p_account_id and principal_kind='account_subject' and status='active';
 select * into ap from public.subject_principals where id=b.account_principal_id
  and account_id=p_account_id and principal_kind='account_subject' and status='active';
 if b.id is null or sp.id is null or ap.id is null then return null; end if;
 perform 1 from public.genome_storage_objects o join storage.objects obj on obj.id=o.object_id
  where o.genome_file_id=f.id and o.object_id=f.storage_object_id and o.object_name=f.bucket_path
   and o.bucket_id='genomes' and o.sha256=f.sha256 and o.byte_count=f.size_bytes
   and o.object_revision=f.upload_revision and o.state='current' and o.revoked_at is null
   and obj.bucket_id=o.bucket_id and obj.name=o.object_name and (obj.metadata->>'size')::numeric=f.size_bytes;
 if not found then return null; end if;
 if published is not null then normalized:=true;
 else
 select exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.account_id=f.user_id
  and n.state='complete' and f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision
  and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
  and n.manifest->'sourceRevision'=to_jsonb(f.upload_revision)
  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path) into normalized;
 end if;
 result:=jsonb_build_object('file',jsonb_build_object('id',f.id,'subject_id',s.id,'original_name',f.original_name,
  'file_type',f.file_type,'tier',f.tier,'size_bytes',f.size_bytes,'sha256',f.sha256,'source_sha256',f.source_sha256,
  'status',f.status,'build',f.build,'created_at',f.created_at,'variant_count',case when normalized then f.variant_count else null end,
  'bucket_path',f.bucket_path,'storage_object_id',f.storage_object_id,'upload_revision',f.upload_revision),
  'binding',jsonb_build_object('accountId',p_account_id,'sessionId',p_session_id,
   'accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,'sessionRevision',session_revision,
   'subjectBindingRevision',s.subject_binding_revision,'lifecycleRevision',s.lifecycle_revision,
   'accountBindingId',b.id,'accountBindingRevision',b.binding_revision,
   'subjectPrincipalId',sp.id,'subjectPrincipalRevision',sp.principal_revision,
   'accountPrincipalId',ap.id,'accountPrincipalRevision',ap.principal_revision,
   'normalizedAt',case when normalized then f.normalization_completed_at else null end), 'normalized',normalized);
 if published is not null then
  result:=result||jsonb_build_object('preparedSource',jsonb_build_object(
   'version','own-prepared-report-source-v1','backend','prepared-object-v1','manifestId',published->'manifestId',
   'membershipSha256',published->'membershipSha256','rootArtifactId',published#>'{root,receipt,artifactId}',
   'rootSha256',published#>'{root,receipt,sha256}'));
  -- Final full membership and source clock fence after JSON construction.
  if private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,manifest_id) is distinct from published then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 return result;
end; $$;
revoke all on function private.own_export_source_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_export_source_v1(uuid,uuid,uuid) to service_role;

create or replace function private.own_subject_export_content_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_snapshot jsonb,p_offset integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare snapshot jsonb; result jsonb; f public.genome_files%rowtype; ancestry_authority jsonb;
 prepared boolean; authorities jsonb:='{}'; authority jsonb; purpose text; item jsonb;
 store_authority jsonb; expiry timestamptz; limit_at timestamptz;
begin
 if p_operation is null or p_operation not in ('list','check','variants','observed','reports','prs','ancestry')
  or p_offset is null or p_offset<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_operation='list' then
  if p_file_id is not null or p_snapshot is not null then raise exception using errcode='22023',message='invalid_request'; end if;
  -- Validate the account even when it has no files. Null source returns null.
  perform private.own_export_source_v1(p_account_id,p_session_id,null);
  -- Apply pagination before aggregating snapshots, not to an all-account JSON value.
  select coalesce(jsonb_agg(page.snapshot order by page.id),'[]') into result from (
   select x.id,x.snapshot from (
    select gf.id,private.own_export_source_v1(p_account_id,p_session_id,gf.id) snapshot
    from public.genome_files gf join public.subjects s on s.id=gf.subject_id
    where s.subject_account_id=p_account_id and gf.single_logical_sample_verified_at is not null
   ) x where x.snapshot is not null order by x.id offset p_offset limit 100
  ) page;
  -- A later source read must not let an earlier prepared source expire before
  -- this whole list response is returned. Locks remain held for all members.
  for item in select value from jsonb_array_elements(result) loop
   if item ? 'preparedSource' then
    if private.own_export_source_v1(p_account_id,p_session_id,(item#>>'{file,id}')::uuid) is distinct from item then
     raise exception using errcode='42501',message='not_found'; end if;
    store_authority:=private.own_upload_store_authority_v1(p_account_id,p_session_id,(item#>>'{file,subject_id}')::uuid);
    select least(s.not_after,c.expires_at) into expiry from auth.sessions s join public.subject_consents c
     on c.id=(store_authority->>'uploadConsentId')::uuid where s.id=p_session_id and s.user_id=p_account_id;
    if not found then raise exception using errcode='42501',message='not_found'; end if;
    limit_at:=least(limit_at,expiry);
   end if;
  end loop;
  if limit_at is not null and limit_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
  return result;
 end if;
 snapshot:=private.own_export_source_v1(p_account_id,p_session_id,p_file_id);
 if snapshot is null or snapshot is distinct from p_snapshot then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then return snapshot; end if;
 prepared:=snapshot ? 'preparedSource';
 if prepared and p_operation in('variants','observed') then
  raise exception using errcode='55000',message='prepared_object_reader_required'; end if;
 if not (snapshot->>'normalized')::boolean then return '[]'; end if;
 select * into f from public.genome_files where id=p_file_id;
 if prepared and p_operation in('reports','prs') then
  foreach purpose in array array['reports.monogenic','reports.polygenic'] loop
   if p_operation='prs' and purpose<>'reports.polygenic' then continue; end if;
   authority:=null;
   begin
    authority:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,purpose);
    if private.own_analysis_completion_matches_v1(f.id,purpose,authority) is not true then authority:=null; end if;
   exception when insufficient_privilege or object_not_in_prerequisite_state then authority:=null;
   end;
   if authority is not null then
    authorities:=authorities||jsonb_build_object(purpose,authority);
    select expires_at into expiry from public.purpose_grants where grant_id=(authority->>'grantId')::uuid;
    limit_at:=least(limit_at,expiry);
   end if;
  end loop;
 end if;
 if p_operation='variants' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype
   from public.user_variants v where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
   order by v.id offset p_offset limit 1000) x;
 elsif p_operation='observed' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (select v.source_line,v.source_sha256,v.source_build,
   v.source_chrom,v.source_pos,v.source_ref,v.source_alt,v.source_gt,v.rsid,v.chrom,v.pos,
   v.ref,v.alt,v.genotype,v.quality_state,v.usable
   from public.report_observed_calls v where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
    and v.source_sha256=f.sha256 and v.source_build=f.build and v.extraction_version='vcf-literal-diploid-snp-v1'
   order by v.source_line offset p_offset limit 1000) x;
 elsif p_operation='ancestry' then
  -- Raw export authority alone never reveals a canonical ancestry result.
  -- Missing/revoked analysis permission leaves raw source export usable.
  begin
   ancestry_authority:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,'ancestry');
  exception when insufficient_privilege or object_not_in_prerequisite_state then return '[]'::jsonb;
  end;
  if private.own_analysis_completion_matches_v1(f.id,'ancestry',ancestry_authority) is not true then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select r.purpose,r.completed_at,ancestry_authority->>'grantId' as grant_id,
    (ancestry_authority->>'grantRevision')::bigint as grant_revision,r.result->'ancestry' as result
   from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id and r.account_id=p_account_id
    and r.purpose='ancestry' and r.state='complete' and r.completed_at is not null
    and r.computation_revision='own-ancestry-v1' and r.source_revision=f.upload_revision
    and r.source_sha256=f.sha256 and r.normalization_completed_at=f.normalization_completed_at
   order by r.id offset p_offset limit 1000) x;
  if private.own_export_source_v1(p_account_id,p_session_id,p_file_id) is distinct from snapshot
   or private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,'ancestry') is distinct from ancestry_authority
   or private.own_analysis_completion_matches_v1(f.id,'ancestry',ancestry_authority) is not true then
   raise exception using errcode='42501',message='not_found'; end if;
 else
  -- The own right can retrieve existing results; it cannot make or refresh any.
  -- Old subject-binding results remain inaccessible after an account claim.
  with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
   and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
   and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
   and r.normalization_completed_at=f.normalization_completed_at
   and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision'
   and (not prepared or (authorities ? r.purpose
    and private.own_analysis_completion_matches_v1(f.id,r.purpose,authorities->r.purpose) is true)))
  select case when p_operation='reports' then
   (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.purpose,r.completed_at,report.value as report
    from completed r cross join lateral jsonb_array_elements(r.result->'reports') with ordinality report(value,ordinality)
    where r.purpose in ('reports.monogenic','reports.polygenic') order by r.purpose,report.ordinality offset p_offset limit 1000) x)
   else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select v.pgs_id,v.matched,v.computed_at,
    m.name,m.trait,m.ancestry_note,m.n_variants from public.user_prs v left join public.prs_scores m using(pgs_id)
    where v.file_id=f.id and v.subject_id=f.subject_id and v.user_id=f.user_id
     and exists(select 1 from completed r where r.purpose='reports.polygenic')
    order by v.id offset p_offset limit 1000) x) end into result;
 end if;
 if prepared then
  for purpose,authority in select key,value from jsonb_each(authorities) loop
   if private.current_own_report_grant_read_v1(p_account_id,p_session_id,f.id,purpose) is distinct from authority
    or private.own_analysis_completion_matches_v1(f.id,purpose,authority) is not true then
    raise exception using errcode='42501',message='not_found'; end if;
  end loop;
  if private.own_export_source_v1(p_account_id,p_session_id,p_file_id) is distinct from snapshot then
   raise exception using errcode='42501',message='not_found'; end if;
  store_authority:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
  select least(s.not_after,c.expires_at) into expiry from auth.sessions s join public.subject_consents c
   on c.id=(store_authority->>'uploadConsentId')::uuid where s.id=p_session_id and s.user_id=p_account_id;
  if not found then raise exception using errcode='42501',message='not_found'; end if;
  limit_at:=least(limit_at,expiry);
  if p_operation='ancestry' and ancestry_authority is not null then
   select expires_at into expiry from public.purpose_grants where grant_id=(ancestry_authority->>'grantId')::uuid;
   limit_at:=least(limit_at,expiry);
  end if;
  if limit_at is not null and limit_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 end if;
 return result;
end; $$;
revoke all on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) to service_role;
