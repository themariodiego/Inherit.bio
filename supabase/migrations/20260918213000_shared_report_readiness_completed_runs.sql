-- D-129: shared-report readiness announces a completed run, not a covered one.
--
-- The Family hub card asks readiness whether another adult has results to
-- show. Both readers computed `hasReports` as "at least one COVERED report",
-- so a completed run whose file reaches no report — real results, honestly
-- uncovered — was reported to the other adult as "No shared results yet",
-- the line that means a result is still to come. The person page past the
-- Tier-2 gate already says the truth ("… file covers none of the … reports");
-- the card contradicted it.
--
-- `hasReports` now means a completed run with at least one catalogued,
-- non-fixture report, whatever it covers. Nothing else in either body
-- changes: the diff of each definition against its current one is exactly
-- the dropped `covered` conjunct. Content mode, authority, receipts and
-- privileges are untouched; `create or replace` keeps the existing grants.
--
-- `private.health_picture_own_page_v1` carries the same readiness branch and
-- gets the same change so the two bodies stay one definition; its only
-- caller, `public.health_picture_results_v1`, reads it in content mode, so
-- nothing the health picture renders changes.

create or replace function public.family_shared_report_results_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_after_file uuid default null,p_mode text default 'content')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare direction jsonb; a jsonb; f public.genome_files%rowtype; r private.own_analysis_runs%rowtype;
 n private.own_normalization_runs%rowtype; source_view jsonb; snapshot jsonb; rows jsonb:='[]'; v_last uuid; v_count integer:=0; page jsonb;
begin
 if p_mode is null or p_mode not in('content','readiness') then raise exception using errcode='22023',message='invalid_request'; end if;
 direction:=private.family_report_recipient_v1(p_account_id,p_session_id,p_subject_id,p_purpose);
 for f in select gf.* from public.genome_files gf where gf.subject_id=p_subject_id
  and gf.user_id=(direction#>>'{endpoints,owner,accountId}')::uuid
  and direction->>'legacyOnly'='false' and gf.single_logical_sample_verified_at is not null and (p_after_file is null or gf.id>p_after_file)
  order by gf.id limit 100 loop
  v_last:=f.id; v_count:=v_count+1;
  begin
   if exists(select 1 from private.genome_file_deletions where file_id=f.id) then continue; end if;
   a:=private.family_source_report_authority_v1(f.user_id,f.id,p_purpose);
   if private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   select * into r from private.own_analysis_runs where file_id=f.id and purpose=p_purpose and state='complete';
   select * into n from private.own_normalization_runs where file_id=f.id and state='complete';
   if r.file_id is null or n.file_id is null or jsonb_typeof(r.result->'reports') is distinct from 'array' then continue; end if;
   -- Only display facts. Missing historical listed-call facts stay unavailable;
   -- no hashes, file names, paths or raw headers cross the view boundary.
   snapshot:=null;
   if n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
    and n.provenance->>'sourceBuild'=f.build and n.provenance->>'targetBuild'='GRCh38'
    and (f.build<>'GRCh37' or coalesce(n.provenance->>'chainSha256','')~'^[0-9a-f]{64}$')
    and (f.build<>'GRCh38' or n.provenance->'chainSha256'='null'::jsonb) then
    snapshot:=jsonb_build_object('sourceBuild',n.provenance->'sourceBuild','buildBasis',n.provenance->'buildBasis',
     'targetBuild',n.provenance->'targetBuild','variantRowsMapped',n.provenance->'variantRowsMapped',
     'variantRowsUnmapped',n.provenance->'variantRowsUnmapped','counts',n.provenance->'counts');
   end if;
   source_view:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',snapshot);
   if private.family_source_report_authority_v1(f.user_id,f.id,p_purpose) is distinct from a
    or private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('fileId',f.id,
    'receipt',encode(extensions.digest(convert_to(jsonb_build_object('authority',a,'result',r.result,
     'completedAt',r.completed_at,'claim',r.claim,'manifest',n.manifest,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'))
    ||case when p_mode='readiness' then jsonb_build_object('hasReports',exists(
     select 1 from jsonb_array_elements(r.result->'reports') item
      where jsonb_typeof(item->'catalogSnapshot')='object' and item->>'slug' not like 'auto-e2e-%'))
     else jsonb_build_object('subjectId',p_subject_id,'purpose',p_purpose,
      'completedAt',r.completed_at,'source',source_view,'reports',r.result->'reports') end);
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if private.family_report_recipient_v1(p_account_id,p_session_id,p_subject_id,p_purpose) is distinct from direction then
  raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('authority',encode(extensions.digest(convert_to(direction::text,'UTF8'),'sha256'),'hex'),
  'ownerAccountId',direction#>>'{endpoints,owner,accountId}','subjectId',p_subject_id,'purpose',p_purpose,
  'legacyOnly',(direction->>'legacyOnly')::boolean,'sources',rows,'nextAfter',case when v_count=100 then v_last else null end);
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(page::text,'UTF8'),'sha256'),'hex'));
end; $$;

create or replace function private.health_picture_own_page_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_purpose text,p_after_file uuid default null,p_mode text default 'content')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare direction jsonb; a jsonb; f public.genome_files%rowtype; r private.own_analysis_runs%rowtype;
 n private.own_normalization_runs%rowtype; source_view jsonb; snapshot jsonb; rows jsonb:='[]'; v_last uuid; v_count integer:=0; page jsonb;
begin
 if p_mode is null or p_mode not in('content','readiness') then raise exception using errcode='22023',message='invalid_request'; end if;
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then raise exception using errcode='42501',message='not_found'; end if;
 direction:=jsonb_build_object('context',public.own_report_context_v1(p_account_id,p_session_id,p_subject_id),
  'endpoints',jsonb_build_object('owner',jsonb_build_object('accountId',p_account_id)),'legacyOnly',false);
 for f in select gf.* from public.genome_files gf where gf.subject_id=p_subject_id
  and gf.user_id=(direction#>>'{endpoints,owner,accountId}')::uuid
  and direction->>'legacyOnly'='false' and gf.single_logical_sample_verified_at is not null and (p_after_file is null or gf.id>p_after_file)
  order by gf.id limit 100 loop
  v_last:=f.id; v_count:=v_count+1;
  begin
   if exists(select 1 from private.genome_file_deletions where file_id=f.id) then continue; end if;
   a:=private.family_source_report_authority_v1(f.user_id,f.id,p_purpose);
   if private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   select * into r from private.own_analysis_runs where file_id=f.id and purpose=p_purpose and state='complete';
   select * into n from private.own_normalization_runs where file_id=f.id and state='complete';
   if r.file_id is null or n.file_id is null or jsonb_typeof(r.result->'reports') is distinct from 'array' then continue; end if;
   -- Only display facts. Missing historical listed-call facts stay unavailable;
   -- no hashes, file names, paths or raw headers cross the view boundary.
   snapshot:=null;
   if n.provenance->>'version'='listed-calls-v1' and n.provenance->>'sourceSha256'=f.sha256
    and n.provenance->>'sourceBuild'=f.build and n.provenance->>'targetBuild'='GRCh38'
    and (f.build<>'GRCh37' or coalesce(n.provenance->>'chainSha256','')~'^[0-9a-f]{64}$')
    and (f.build<>'GRCh38' or n.provenance->'chainSha256'='null'::jsonb) then
    snapshot:=jsonb_build_object('sourceBuild',n.provenance->'sourceBuild','buildBasis',n.provenance->'buildBasis',
     'targetBuild',n.provenance->'targetBuild','variantRowsMapped',n.provenance->'variantRowsMapped',
     'variantRowsUnmapped',n.provenance->'variantRowsUnmapped','counts',n.provenance->'counts');
   end if;
   source_view:=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'processedAt',f.normalization_completed_at,'snapshot',snapshot);
   if private.family_source_report_authority_v1(f.user_id,f.id,p_purpose) is distinct from a
    or private.own_analysis_completion_matches_v1(f.id,p_purpose,a) is not true then continue; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('fileId',f.id,
    'receipt',encode(extensions.digest(convert_to(jsonb_build_object('authority',a,'result',r.result,
     'completedAt',r.completed_at,'claim',r.claim,'manifest',n.manifest,'provenance',n.provenance)::text,'UTF8'),'sha256'),'hex'))
    ||case when p_mode='readiness' then jsonb_build_object('hasReports',exists(
     select 1 from jsonb_array_elements(r.result->'reports') item
      where jsonb_typeof(item->'catalogSnapshot')='object' and item->>'slug' not like 'auto-e2e-%'))
     else jsonb_build_object('subjectId',p_subject_id,'purpose',p_purpose,
      'completedAt',r.completed_at,'source',source_view,'reports',r.result->'reports') end);
  exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then continue;
  end;
 end loop;
 if jsonb_build_object('context',public.own_report_context_v1(p_account_id,p_session_id,p_subject_id),'endpoints',jsonb_build_object('owner',jsonb_build_object('accountId',p_account_id)),'legacyOnly',false) is distinct from direction then
  raise exception using errcode='42501',message='not_found'; end if;
 page:=jsonb_build_object('authority',encode(extensions.digest(convert_to(direction::text,'UTF8'),'sha256'),'hex'),
  'ownerAccountId',direction#>>'{endpoints,owner,accountId}','subjectId',p_subject_id,'purpose',p_purpose,
  'legacyOnly',(direction->>'legacyOnly')::boolean,'sources',rows,'nextAfter',case when v_count=100 then v_last else null end);
 return page||jsonb_build_object('pageReceipt',encode(extensions.digest(convert_to(page::text,'UTF8'),'sha256'),'hex'));
end; $$;
