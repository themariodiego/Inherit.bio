-- Basic canonical browsing is covered by current store consent. No analytic grant is required.
create function private.own_prepared_source_readable_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_subject_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare f public.genome_files%rowtype;
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.subject_id is distinct from p_subject_id then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.own_report_context_read_v1(p_account_id,p_session_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id
  and subject_id=f.subject_id;
 if f.id is null or f.single_logical_sample_verified_at is null or f.tier is distinct from 1
  or f.status is null or f.status not in ('stored','annotated')
  or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.normalization_completed_at is null or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is null or f.build not in ('GRCh37','GRCh38') then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from private.own_normalization_runs n
  join public.genome_storage_objects o on o.genome_file_id=f.id
  join storage.objects s on s.id=o.object_id
 where n.file_id=f.id and n.account_id=p_account_id and n.state='complete'
  and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
  and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
  and o.object_id=f.storage_object_id and o.object_name=f.bucket_path and o.bucket_id='genomes'
  and o.sha256=f.sha256 and o.byte_count=f.size_bytes and o.object_revision=f.upload_revision
  and o.state='current' and o.revoked_at is null and s.bucket_id=o.bucket_id and s.name=o.object_name
  and (s.metadata->>'size')::numeric=f.size_bytes;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return true;
exception when insufficient_privilege or object_not_in_prerequisite_state then return false;
end;
$function$;
revoke all on function private.own_prepared_source_readable_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_prepared_source_readable_v1(uuid,uuid,uuid,uuid) to service_role;

create function public.filter_own_prepared_sources_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_file_ids uuid[])
returns uuid[] language plpgsql security invoker set search_path=pg_catalog as $function$
declare v_file uuid; allowed uuid[]:='{}';
begin
 if p_file_ids is null or cardinality(p_file_ids)>1000 then raise exception using errcode='22023',message='invalid_request'; end if;
 for v_file in select distinct unnest(p_file_ids) loop
  if private.own_prepared_source_readable_v1(p_account_id,p_session_id,v_file,p_subject_id) then
   allowed:=array_append(allowed,v_file); end if;
 end loop;
 return allowed;
end;
$function$;
revoke all on function public.filter_own_prepared_sources_v1(uuid,uuid,uuid,uuid[]) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.filter_own_prepared_sources_v1(uuid,uuid,uuid,uuid[]) to service_role;
