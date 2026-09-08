-- Read requested loci first instead of allowing a freshly prepared source's
-- stale cardinality estimate to drive a file-wide scan/semi-join. DISTINCT
-- preserves EXISTS semantics for duplicate requests; OFFSET 0 preserves the
-- lateral point-lookup boundary. Existing subject-position indexes serve raw
-- variants; observed rows retain their exact file/hash/build/version guards.
-- No new index/write overhead, timeouts, permissions, grants, snapshots,
-- computation, ordering or 1000-row page contract changes. CREATE OR REPLACE
-- preserves existing owner/ACL; only the two already-authorized read queries differ.
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
   or not exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.account_id=p_account_id
    and n.state='complete' and n.manifest->>'fileType'=f.file_type::text) then
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
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end;
 end if;
 if p_operation='check' and p_claim is null and private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  return jsonb_build_object('status','complete','purpose',p_purpose); end if;
 if r.id is null or r.state<>'running' or r.account_id<>p_account_id or r.claim is distinct from p_claim
  or r.authority is distinct from a or r.ancestry_source is distinct from source or r.expires_at<=v_now then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end; end if;
 if p_operation in ('read-variants','read-observed') then
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
  update private.own_analysis_runs set state='complete',completed_at=v_now,result=p_payload where id=r.id;
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
 update private.own_analysis_runs set state='complete',completed_at=v_now,
  result=jsonb_build_object('reports',p_payload->'reports','prsCount',jsonb_array_length(p_payload->'prs')) where id=r.id;
 return jsonb_build_object('status','complete','purpose',p_purpose);
end;
$function$;
