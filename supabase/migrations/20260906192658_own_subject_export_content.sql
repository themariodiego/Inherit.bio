-- Own-right content only. No grant, analysis, archive, job or download-session
-- creation. The caller is the server after verified getUser/getClaims binding.
create or replace function private.own_export_source_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; s public.subjects%rowtype; p public.profiles%rowtype;
 b public.subject_account_bindings%rowtype; sp public.subject_principals%rowtype;
 ap public.subject_principals%rowtype; session_revision bigint; normalized boolean;
begin
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
 select exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.account_id=f.user_id
  and n.state='complete' and f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision
  and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
  and n.manifest->'sourceRevision'=to_jsonb(f.upload_revision)
  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path) into normalized;
 return jsonb_build_object('file',jsonb_build_object('id',f.id,'subject_id',s.id,'original_name',f.original_name,
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
end; $$;
revoke all on function private.own_export_source_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_export_source_v1(uuid,uuid,uuid) to service_role;

create or replace function private.own_subject_export_content_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid,p_snapshot jsonb,p_offset integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare snapshot jsonb; result jsonb; f public.genome_files%rowtype;
begin
 if p_operation is null or p_operation not in ('list','check','variants','observed','reports','prs')
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
  return result;
 end if;
 snapshot:=private.own_export_source_v1(p_account_id,p_session_id,p_file_id);
 if snapshot is null or snapshot is distinct from p_snapshot then raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then return snapshot; end if;
 if not (snapshot->>'normalized')::boolean then return '[]'; end if;
 select * into f from public.genome_files where id=p_file_id;
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
 else
  -- The own right can retrieve existing results; it cannot make or refresh any.
  -- Old subject-binding results remain inaccessible after an account claim.
  with completed as (select r.* from private.own_analysis_runs r where r.file_id=f.id and r.subject_id=f.subject_id
   and r.state='complete' and r.completed_at is not null and r.computation_revision='own-reports-v1'
   and r.source_revision=f.upload_revision and r.source_sha256=f.sha256
   and r.normalization_completed_at=f.normalization_completed_at
   and r.authority->'context'->'subjectBindingRevision'=snapshot->'binding'->'subjectBindingRevision')
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
 return result;
end; $$;
revoke all on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) to service_role;
create or replace function public.own_subject_export_content_v1(p_operation text,p_account_id uuid,p_session_id uuid,
 p_file_id uuid default null,p_snapshot jsonb default null,p_offset integer default 0)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.own_subject_export_content_v1(p_operation,p_account_id,p_session_id,p_file_id,p_snapshot,p_offset);
$$;
revoke all on function public.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_subject_export_content_v1(text,uuid,uuid,uuid,jsonb,integer) to service_role;
