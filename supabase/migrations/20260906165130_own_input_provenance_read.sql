-- Display-only projection of already recorded canonical preparation facts.
-- No source reads, reprocessing, grants, or legacy provenance backfill.
create function private.read_own_input_sources_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_file_ids uuid[],p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_id uuid; f public.genome_files%rowtype; r private.own_normalization_runs%rowtype;
 p jsonb; a jsonb; result jsonb:='[]'; v_counts jsonb;
begin
 if p_file_ids is null or cardinality(p_file_ids)>100 or array_position(p_file_ids,null) is not null
  or (p_purpose is not null and p_purpose not in ('reports.monogenic','reports.polygenic')) then
  raise exception using errcode='22023',message='invalid_request'; end if;
 for v_id in select distinct unnest(p_file_ids) order by 1 loop
  begin
   if not private.own_prepared_source_readable_v1(p_account_id,p_session_id,v_id,p_subject_id) then continue; end if;
   if p_purpose is not null then
    a:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,v_id,p_purpose);
    if not private.own_analysis_completion_matches_v1(v_id,p_purpose,a) then continue; end if;
   end if;
   select * into f from public.genome_files where id=v_id and user_id=p_account_id and subject_id=p_subject_id;
   select * into r from private.own_normalization_runs where file_id=v_id and account_id=p_account_id and state='complete';
   p:=r.provenance;
   -- The prepared-source resolver checks live store consent and the exact
   -- current object/raw+decoded hashes/revision against the private manifest.
   -- Bind the recorded facts to that same source, never a historical snapshot.
   if f.id is null or r.file_id is null or jsonb_typeof(p) is distinct from 'object'
    or p->>'version' is distinct from 'listed-calls-v1'
    or p->>'sourceSha256' is distinct from f.sha256
    or p->>'sourceBuild' is distinct from f.build
    or p->>'targetBuild' is distinct from 'GRCh38'
    or coalesce(p->>'buildBasis','') not in ('source-declared','format-assumption')
    or (f.build='GRCh37' and coalesce(p->>'chainSha256','')!~'^[0-9a-f]{64}$')
    or (f.build='GRCh38' and p->'chainSha256' is distinct from 'null'::jsonb)
    or jsonb_typeof(p->'counts') is distinct from 'object' then continue; end if;
   v_counts:=p->'counts';
   if exists(select 1 from unnest(array['called','noCall','unsupported','failedFilter','blocks']) k
    where jsonb_typeof(v_counts->k) is distinct from 'number' or coalesce(v_counts->>k,'')!~'^(0|[1-9][0-9]*)$')
    or exists(select 1 from unnest(array['variantRowsMapped','variantRowsUnmapped']) k
    where jsonb_typeof(p->k) is distinct from 'number' or coalesce(p->>k,'')!~'^(0|[1-9][0-9]*)$')
    or jsonb_typeof(v_counts->'singleSample') is distinct from 'boolean'
    or jsonb_typeof(v_counts->'buildClaim') is distinct from 'boolean' then continue; end if;
   if exists(select 1 from unnest(array['called','noCall','unsupported','failedFilter','blocks']) k
    where (v_counts->>k)::numeric>9007199254740991)
    or (p->>'variantRowsMapped')::numeric>9007199254740991
    or (p->>'variantRowsUnmapped')::numeric>9007199254740991
    or (v_counts->>'called')::numeric+(v_counts->>'noCall')::numeric>9007199254740991 then continue; end if;
   -- Recheck immediately before projecting; a withdrawal or source transition
   -- during validation must not return previously read facts. No row locks or
   -- writes are introduced into this read-only operation.
   if not private.own_prepared_source_readable_v1(p_account_id,p_session_id,v_id,p_subject_id) then continue; end if;
   if p_purpose is not null then
    if private.current_own_report_grant_read_v1(p_account_id,p_session_id,v_id,p_purpose) is distinct from a
     or not private.own_analysis_completion_matches_v1(v_id,p_purpose,a) then continue; end if;
   end if;
   perform 1 from public.genome_files current_file join private.own_normalization_runs current_run on current_run.file_id=current_file.id
    where current_file.id=v_id and current_file.user_id=p_account_id and current_file.subject_id=p_subject_id
     and current_file.upload_revision=f.upload_revision and current_file.sha256=f.sha256
     and current_file.source_sha256=f.source_sha256 and current_file.storage_object_id=f.storage_object_id
     and current_file.bucket_path=f.bucket_path and current_file.size_bytes=f.size_bytes and current_file.build=f.build
     and current_file.normalization_completed_at=f.normalization_completed_at
     and current_file.normalization_source_revision=current_file.upload_revision
     and current_run.state='complete' and current_run.account_id=p_account_id
     and current_run.claim=r.claim and current_run.manifest=r.manifest and current_run.provenance=p;
   if not found then continue; end if;
   result:=result||jsonb_build_array(jsonb_build_object('fileId',f.id,'fileType',f.file_type,
    'processedAt',f.normalization_completed_at,'snapshot',jsonb_build_object(
     'sourceBuild',p->'sourceBuild','buildBasis',p->'buildBasis','targetBuild',p->'targetBuild',
     'variantRowsMapped',p->'variantRowsMapped','variantRowsUnmapped',p->'variantRowsUnmapped',
     'counts',jsonb_build_object('called',v_counts->'called','noCall',v_counts->'noCall',
      'unsupported',v_counts->'unsupported','failedFilter',v_counts->'failedFilter','blocks',v_counts->'blocks',
      'singleSample',v_counts->'singleSample','buildClaim',v_counts->'buildClaim'))));
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or numeric_value_out_of_range then
   -- One denied/stale source never supplies facts or hides completed siblings.
   continue;
  end;
 end loop;
 return result;
end;
$function$;
revoke all on function private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text) to service_role;
create function public.read_own_input_sources_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_file_ids uuid[],p_purpose text)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.read_own_input_sources_v1(p_account_id,p_session_id,p_subject_id,p_file_ids,p_purpose);
$function$;
revoke all on function public.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text) to service_role;
