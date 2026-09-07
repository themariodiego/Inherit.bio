-- Exact own saved-result read. No shared recipient, raw calls or generation.
create function public.own_captured_report_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_file_id uuid,p_slug text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb; f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
 r private.own_analysis_runs%rowtype; a jsonb; source_view jsonb; provenance jsonb; selected jsonb; output jsonb;
 v_purpose text; result jsonb; match_count integer:=0; deadline timestamptz;
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
 select * into n from private.own_normalization_runs where file_id=p_file_id and state='complete' for share nowait;
 perform 1 from private.own_analysis_runs where file_id=p_file_id order by id for share nowait;
 if n.file_id is null or public.own_report_context_v1(p_account_id,p_session_id,p_subject_id) is distinct from context then return null; end if;
 select min(expires_at) into deadline from (
  select expires_at from public.purpose_grants where target_kind='subject' and target_id=p_subject_id
   and purpose in('reports.monogenic','reports.polygenic') and revoked_at is null and expires_at>clock_timestamp()
  union all select expires_at from public.subject_consents where subject_id=p_subject_id and revoked_at is null and expires_at>clock_timestamp()
 ) deadlines;
 provenance:=null;
 if n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
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
   a:=private.family_source_report_authority_v1(p_account_id,p_file_id,v_purpose);
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
      'completedAt',r.completed_at,'claim',r.claim,'manifest',n.manifest,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'));
   end loop;
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if match_count<>1 then return null; end if;
 output:=jsonb_build_object('source',result,'receipt',encode(extensions.digest(convert_to(
  jsonb_build_object('context',context,'source',result)::text,'UTF8'),'sha256'),'hex'));
 if p_expected is not null and output->>'receipt' is distinct from p_expected then return null; end if;
 if public.own_report_context_v1(p_account_id,p_session_id,p_subject_id) is distinct from context then return null; end if;
 if deadline is not null and deadline<=clock_timestamp() then return null; end if;
 return output;
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;
revoke all on function public.own_captured_report_v1(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_captured_report_v1(uuid,uuid,uuid,uuid,text,text) to service_role;
