-- Canonical own ancestry: selected exact prepared source, immutable panel-bound
-- content in the existing private journal. No legacy ancestry rows, worker
-- generation, mail/export changes, cross-file inference, or lineage claims.
alter table private.own_analysis_runs add column ancestry_source jsonb;
alter table private.own_analysis_runs add constraint own_analysis_runs_ancestry_source_check
 check((purpose='ancestry')=(ancestry_source is not null));
alter table private.own_analysis_runs drop constraint own_analysis_runs_computation_revision_check;
alter table private.own_analysis_runs add constraint own_analysis_runs_computation_revision_check
 check(computation_revision=case purpose when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end);

-- Closed content contract; the modelled proportions are computed by the pure
-- reviewed adapter, not a database population model. Source and panel identity,
-- all declared counts/states, and absence of lineage findings are checked here.
create function private.validate_own_ancestry_content_v1(c jsonb,f uuid,s uuid,a jsonb,encoding text)
returns void language plpgsql security definer set search_path=pg_catalog as $fn$
declare x jsonb; k text; total integer:=0; used integer; proportions numeric:=0;
begin
 if encoding is null or encoding not in('vcf-literal','array-genotype')
  or jsonb_typeof(c) is distinct from 'object'
  or not(c ?& array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages'])
  or c-array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages']<>'{}'
  or c->'schemaVersion' is distinct from '1'::jsonb or c->>'computationRevision' is distinct from 'own-ancestry-content-v1'
  or octet_length(c::text)>65536 then raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 if c->'source' is distinct from jsonb_build_object('fileId',f,'subjectId',s,'normalizedBuild','GRCh38',
   'sourceRevision',(a->>'sourceRevision')::bigint,'sourceSha256',a->>'sourceSha256',
   'callEncoding',encoding,'normalizedAt',c#>'{source,normalizedAt}')
  or jsonb_typeof(c#>'{source,normalizedAt}') is distinct from 'string'
  or (c#>>'{source,normalizedAt}')::timestamptz is distinct from (a->>'normalizedAt')::timestamptz then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 if c->'panel' is distinct from '{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb
  or jsonb_typeof(c->'panelPositions') is distinct from 'object'
  or not(c->'panelPositions' ?& array['called','missing','noCall','filtered','conflicting','unsupported'])
  or (c->'panelPositions')-array['called','missing','noCall','filtered','conflicting','unsupported']<>'{}' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 for k,x in select key,value from jsonb_each(c->'panelPositions') loop
  if jsonb_typeof(x)<>'number' or x::text !~ '^(0|[1-9][0-9]*)$' or (x::text)::numeric>168 then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  total:=total+(x::text)::integer;
 end loop;
 used:=(c#>>'{panelPositions,called}')::integer;
 if total<>168 or jsonb_typeof(c->'admixture') is distinct from 'object'
  or not(c->'admixture' ?& array['kind','result','support_note','model_id','model_version','coverage','result_state','basis','range','resolution'])
  or (c->'admixture')-array['kind','result','support_note','model_id','model_version','coverage','result_state','basis','range','resolution']<>'{}'
  or c#>>'{admixture,kind}' is distinct from 'admixture' or c#>>'{admixture,model_id}' is distinct from 'aims-kidd-seldin-168'
  or c#>>'{admixture,model_version}' is distinct from '2026-08-28'
  or c#>>'{admixture,basis}' is distinct from 'modelled' or c#>'{admixture,range}' is distinct from '{"unavailable":true}'::jsonb
  or c#>>'{admixture,resolution}' is distinct from 'five-broad-regions'
  or c#>>'{admixture,result_state}' is distinct from case when used=0 then 'not_covered' when used<42 then 'partial' else 'available' end
  or jsonb_typeof(c#>'{admixture,coverage}') is distinct from 'number'
  or abs((c#>>'{admixture,coverage}')::numeric-used::numeric/168)>0.000000000001
  or jsonb_typeof(c#>'{admixture,result}') is distinct from 'object'
  or not(c#>'{admixture,result}' ?& array['proportions','markersUsed','note'])
  or (c#>'{admixture,result}')-array['proportions','markersUsed','note']<>'{}'
  or c#>'{admixture,result,markersUsed}' is distinct from to_jsonb(used)
  or jsonb_typeof(c#>'{admixture,result,note}') is distinct from 'string'
  or length(c#>>'{admixture,result,note}') not between 1 and 4096
  or c#>'{admixture,support_note}' is distinct from c#>'{admixture,result,note}'
  or jsonb_typeof(c#>'{admixture,result,proportions}') is distinct from 'object'
  or not(c#>'{admixture,result,proportions}' ?& array['AFR','AMR','EAS','EUR','SAS'])
  or (c#>'{admixture,result,proportions}')-array['AFR','AMR','EAS','EUR','SAS']<>'{}' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 for x in select value from jsonb_each(c#>'{admixture,result,proportions}') loop
  if jsonb_typeof(x)<>'number' or (x::text)::numeric<0 or (x::text)::numeric>1 then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  proportions:=proportions+(x::text)::numeric;
 end loop;
 if proportions<>1 or jsonb_typeof(c->'lineages') is distinct from 'array' or jsonb_array_length(c->'lineages')<>2 then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 for x in select value from jsonb_array_elements(c->'lineages') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x ?& array['kind','state','reason','observedPositions'])
   or x-array['kind','state','reason','observedPositions']<>'{}' or x->>'state' is distinct from 'unavailable'
   or jsonb_typeof(x->'observedPositions') is distinct from 'number' or (x->>'observedPositions') !~ '^(0|[1-9][0-9]*)$'
   or (x->>'observedPositions')::numeric>9007199254740991
   or x->>'reason' is distinct from case when (x->>'observedPositions')::bigint=0 then 'no_supplied_positions' else 'lineage_interpretation_not_supported' end then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 end loop;
 if c#>>'{lineages,0,kind}' is distinct from 'mtdna' or c#>>'{lineages,1,kind}' is distinct from 'ydna' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 raise exception using errcode='22023',message='invalid_ancestry_content';
end;
$fn$;
revoke all on function private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text) to service_role;

create or replace function private.own_analysis_completion_matches_v1(p_file_id uuid,p_purpose text,p_authorization jsonb)
returns boolean language sql security definer set search_path=pg_catalog,private as $function$
 select exists(select 1 from private.own_analysis_runs r where r.file_id=p_file_id and r.purpose=p_purpose
  and r.state='complete' and r.completed_at is not null and r.computation_revision=case p_purpose when 'ancestry' then 'own-ancestry-v1' else 'own-reports-v1' end
  and r.authority-'context'=p_authorization-'context'
  and (p_purpose<>'ancestry' or exists(select 1 from public.genome_files f
   join private.own_normalization_runs n on n.file_id=f.id and n.account_id=f.user_id and n.state='complete'
   where f.id=r.file_id and n.manifest->>'fileType'=f.file_type::text
   and r.ancestry_source=jsonb_build_object('fileId',f.id,'fileType',f.file_type,'normalizedBuild','GRCh38',
    'callEncoding',case when f.file_type::text in('vcf','gvcf') then 'vcf-literal'
     when f.file_type::text in('array_23andme','array_ancestry','array_myheritage','array_ftdna') then 'array-genotype' else null end)))
  -- Session refresh is not a new source or grant; live session is independently
  -- checked by the caller. Durable consent/binding context must remain exact.
  and (r.authority->'context')-array['authSessionRevision','originatingSessionRevision']
   =(p_authorization->'context')-array['authSessionRevision','originatingSessionRevision']);
$function$;
revoke all on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_analysis_completion_matches_v1(uuid,text,jsonb) to service_role;

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
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype from public.user_variants v
    where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.id offset (p_payload->>'offset')::integer limit 1000) x;
  else
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype,v.usable from public.report_observed_calls v
    where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
     and v.source_sha256=a->>'sourceSha256' and v.extraction_version='vcf-literal-diploid-snp-v1'
     and v.source_build=(select build from public.genome_files where id=p_file_id)
     and exists(select 1 from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer) where p.chrom=v.chrom and p.pos=v.pos)
    order by v.source_line offset (p_payload->>'offset')::integer limit 1000) x;
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
revoke all on function private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_report_generation_v1(text,uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- The page/export adapters consume this exact journal; they never infer a
-- current result from legacy ancestry rows or resolve new scientific metadata.
create function private.own_ancestry_content_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $fn$
declare a jsonb; checked jsonb; r private.own_analysis_runs%rowtype;
begin
 a:=private.current_own_report_grant_read_v1(p_account_id,p_session_id,p_file_id,'ancestry');
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
 return jsonb_build_object('content',r.result->'ancestry','completedAt',r.completed_at);
exception when invalid_parameter_value or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$fn$;
revoke all on function private.own_ancestry_content_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_ancestry_content_v1(uuid,uuid,uuid) to service_role;
create function public.own_ancestry_content_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $fn$
 select private.own_ancestry_content_v1(p_account_id,p_session_id,p_file_id);
$fn$;
revoke all on function public.own_ancestry_content_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_ancestry_content_v1(uuid,uuid,uuid) to service_role;

-- Capture the public reference actually used by new own-report generation.
-- Additive: old application completions without a snapshot remain readable;
-- no historical result is decorated from today's catalog or backfilled.
create or replace function private.capture_own_report_catalog_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $function$
declare item jsonb; captured jsonb; expected jsonb; reports jsonb:='[]'::jsonb;
begin
 if new.state<>'complete' then return new; end if;
 if tg_op='UPDATE' and old.state='complete' then
  if new.result is distinct from old.result then
   raise exception using errcode='55000',message='completed_report_is_immutable';
  end if;
  return new;
 end if;
 if new.purpose='ancestry' then
  if new.computation_revision<>'own-ancestry-v1' or jsonb_typeof(new.result) is distinct from 'object'
   or not(new.result ? 'ancestry') or new.result-'ancestry'<>'{}'::jsonb then
   raise exception using errcode='22023',message='invalid_request'; end if;
  perform private.validate_own_ancestry_content_v1(new.result->'ancestry',new.file_id,new.subject_id,
   new.authority,new.ancestry_source->>'callEncoding');
  return new;
 end if;
 if jsonb_typeof(new.result->'reports') is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_report_catalog';
 end if;
 -- Match completion against stable references. A catalog edit between the
 -- application's read and this lock causes failure, never a false revision.
 perform t.slug from public.report_templates t
  where exists(select 1 from jsonb_array_elements(new.result->'reports') x
   where x ? 'catalogSnapshot' and t.slug=x->>'slug')
  order by t.slug for share;
 for item in select value from jsonb_array_elements(new.result->'reports') loop
  if item ? 'catalogSnapshot' then
   captured:=item->'catalogSnapshot';
   if jsonb_typeof(captured) is distinct from 'object'
    or captured->'schemaVersion' is distinct from '1'::jsonb
    or not(captured ?& array['schemaVersion','template'])
    or captured-array['schemaVersion','template']<>'{}'::jsonb then
    raise exception using errcode='22023',message='invalid_report_catalog';
   end if;
   select jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,'summary',t.summary,
    'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,
    'layer',t.layer,'estimate_kind',t.estimate_kind) into expected
    from public.report_templates t where t.slug=item->>'slug' and t.status='published'
     and t.layer::text=case new.purpose when 'reports.monogenic' then 'variant_call'
      when 'reports.polygenic' then 'estimate' else null end;
   if expected is null or captured->'template' is distinct from expected then
    raise exception using errcode='22023',message='invalid_report_catalog';
   end if;
   item:=jsonb_set(item,'{catalogSnapshot,templateSha256}',
    to_jsonb(encode(extensions.digest(convert_to(expected::text,'UTF8'),'sha256'),'hex')));
  end if;
  reports:=reports||jsonb_build_array(item);
 end loop;
 new.result:=jsonb_set(new.result,'{reports}',reports);
 if octet_length(new.result::text)>4000000 then
  raise exception using errcode='22023',message='invalid_report_catalog';
 end if;
 return new;
end;
$function$;
revoke all on function private.capture_own_report_catalog_v1() from public,anon,authenticated,inherit_upload_only;

create or replace function private.own_report_purge_scope_v1(p_grant uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $fn$
 select jsonb_build_object('accountId',d.recipient_account_id,'subjectId',g.target_id,
  'principalId',g.data_subject_principal_id,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'purpose',g.purpose,'revokedAt',g.revoked_at,'directionStatus',d.status,'lifecycleRevision',s.lifecycle_revision)
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
 join public.subjects s on s.id=g.target_id
 join public.subject_principals sp on sp.id=g.data_subject_principal_id
 join public.consent_signatures cs on cs.id=g.signature_id
 where g.grant_id=p_grant and g.target_kind='subject' and s.subject_class='self'
 and s.subject_account_id=d.recipient_account_id and sp.account_id=d.recipient_account_id and sp.subject_id=s.id
 and g.signer_principal_id=g.data_subject_principal_id and d.recipient_principal_id=g.data_subject_principal_id
 and d.direction='self' and d.relationship_id is null and d.pair_id is null
 and g.purpose in('reports.monogenic','reports.polygenic','ancestry','copilot.local','copilot.cloud')
 and (g.purpose in('reports.monogenic','reports.polygenic','ancestry') or g.copilot_recipient_revision is not null)
 and g.artifact_key=case g.purpose when 'reports.monogenic' then 'consent.own-monogenic'
 when 'reports.polygenic' then 'consent.own-polygenic' when 'ancestry' then 'consent.own-ancestry' when 'copilot.local' then 'consent.own-copilot-local'
 when 'copilot.cloud' then 'consent.own-copilot-cloud' end
 and cs.signer_account_id=d.recipient_account_id and cs.signer_principal_id=g.signer_principal_id
 and cs.target_kind='subject' and cs.target_id=g.target_id and cs.purpose=g.purpose
 and cs.artifact_key=g.artifact_key and cs.artifact_version=g.artifact_version and cs.artifact_body_sha256=g.artifact_body_sha256
 and d.status in('current','revoked','superseded');
$fn$;
create or replace function private.execute_own_report_purge_v1(p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='2s' as $fn$
declare j public.worker_jobs%rowtype; d public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 c jsonb; e public.purge_manifest_entries%rowtype; fp text; mh text; token text; replacement uuid;
 deleted integer:=0; changed integer; cursor_value integer:=0;
begin
 -- No generic claim and no caller-selected account/job/source. Arbitrary jobs
 -- remain untouched. Validated historical jobs receive a replacement, never
 -- a fabricated cleanup success or a rewritten immutable dispatch binding.
 select w.* into j from public.worker_jobs w
 where w.id=p_job and w.kind='revoke_purge' and w.output_kind='lifecycle.revoke-purge'
 and w.source_binding_kind='revocation-disposition' and w.target_kind='subject' and w.cohort_id is null
 and w.status='queued' and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 and (w.computation_revision='own-report-revocation-v1'
  or (w.computation_revision='family-revoke-purge-v1'
   and private.own_report_purge_scope_v1(w.source_binding_id)->>'accountId'=w.user_id::text))
 order by w.created_at,w.id limit 1;
 if j.id is null then return null; end if;
 perform 1 from public.profiles where id=j.user_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 select * into j from public.worker_jobs where id=j.id and status='queued' for update skip locked;
 if j.id is null then return null; end if;
 if j.computation_revision='family-revoke-purge-v1' then
  c:=private.own_report_purge_scope_v1(j.source_binding_id);
  fp:=encode(extensions.digest(convert_to(concat_ws(':','family-revoke-purge-v1',j.source_binding_id::text,
   j.subject_id::text,(j.payload-array['retention_id','manifest_class'])::text),'UTF8'),'sha256'),'hex');
  if c is null or c->>'revokedAt' is null or c->>'accountId' is distinct from j.user_id::text or c->>'subjectId' is distinct from j.subject_id::text
   or j.source_binding_revision<>1 or j.file_id is not null or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp)
   or j.payload is distinct from jsonb_build_object('disposition','purpose-revocation','purpose',c->>'purpose',
    'grant_id',j.source_binding_id,'pair_ids','[]'::jsonb,'retention_id','purpose.derived-60s','manifest_class','purpose-derived-only') then
   raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
  replacement:=private.prepare_own_report_purge_v1(j.source_binding_id);
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),
   result=jsonb_build_object('outcome','superseded','replacementJobId',replacement,'cleanupComplete',false)
   where id=j.id;
  perform private.append_legal_audit_event('purpose.purge-superseded',null,'api.jobs.retention','accepted',
   jsonb_build_object('purpose',c->>'purpose','cleanupComplete',false));
  return jsonb_build_object('outcome','superseded','deletedRows',0);
 end if;
 select * into d from public.retention_due_phases where retention_row_id=j.source_binding_id
  and phase_id='own-report-purpose-purge' and phase_revision=1 for update;
 select * into m from public.purge_manifests where retention_row_id=d.retention_row_id
  and phase_id=d.phase_id and phase_revision=d.phase_revision and manifest_revision=1 for update;
 c:=private.own_report_purge_scope_v1((d.immutable_envelope->>'grantId')::uuid);
 fp:=encode(extensions.digest(convert_to(d.immutable_envelope::text,'UTF8'),'sha256'),'hex');
 if d.retention_row_id is null or m.id is null or c is null
  or c->>'revokedAt' is null or c->>'directionStatus' not in('revoked','superseded')
  or d.retention_id<>'purpose.derived-60s' or d.phase_kind<>'purge' or d.status<>'pending'
  or d.immutable_envelope->>'accountId' is distinct from j.user_id::text
  or d.target_id is distinct from j.subject_id or d.target_kind<>'subject'
  or d.immutable_envelope->>'grantId' is distinct from c->>'grantId'
  or d.immutable_envelope->>'grantRevision' is distinct from c->>'grantRevision'
  or d.immutable_envelope->>'principalId' is distinct from c->>'principalId'
  or d.immutable_envelope->>'purpose' is distinct from c->>'purpose'
  or d.immutable_envelope->>'lifecycleRevision' is distinct from d.target_lifecycle_revision::text
  -- Preserve the existing report-output disposition contract. Copilot-only
  -- jobs remove immutable message IDs/hashes, not reusable report/PRS rows.
  or (c->>'purpose' in('reports.monogenic','reports.polygenic','ancestry')
   and d.immutable_envelope->>'lifecycleRevision' is distinct from c->>'lifecycleRevision')
  or d.phase_deadline is distinct from (c->>'revokedAt')::timestamptz+interval '60 seconds'
  or d.immutable_envelope->>'manifestId' is distinct from m.id::text
  or m.state<>'frozen' or m.manifest_class<>'purpose-derived-only' or not private.own_report_purge_hash_matches_v1(m.source_binding_fingerprint,fp)
  or not private.own_report_purge_hash_matches_v1(j.file_sha256,fp) or j.source_binding_revision<>1 or j.file_id is not null
  or j.payload is distinct from jsonb_build_object('dispositionId',d.retention_row_id) then
  raise exception using errcode='55000',message='own_report_purge_binding_invalid'; end if;
 -- This synchronous executor has no genetic/Storage transport and supports
 -- the two stores written by canonical own reports. Fail closed if attribution
 -- requires another workflow, rather than infer grant ownership from account.
 if exists(select 1 from public.chats where user_id=j.user_id and subject_id=j.subject_id
   and (canonical_authority is null or legacy_unverified is not false))
  or exists(select 1 from public.copilot_context_tokens where account_id=j.user_id and target_id=j.subject_id)
  or exists(select 1 from public.chat_messages where user_id=j.user_id and retrieved_subject_ids @> array[j.subject_id]
   and (canonical_projection is null or legacy_unverified is not false)) then
  raise exception using errcode='55000',message='own_report_purge_unsupported_outputs'; end if;
 if exists(select 1 from public.purge_manifest_entries x where x.manifest_id=m.id and
  (x.object_id is not null or x.row_key->>'grantId' is distinct from c->>'grantId'
   or not((x.target_id='polygenic-results' and x.store_name='public.user_prs' and c->>'purpose'='reports.polygenic')
     or (x.target_id='generated-artifacts' and x.store_name='private.own_analysis_runs')
     or (x.target_id='chat-derived-contexts' and x.store_name='public.chat_messages')))) then
  raise exception using errcode='55000',message='own_report_purge_membership_invalid'; end if;
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object('target',x.target_id,
  'store',x.store_name,'key',x.row_key,'revision',x.entry_revision) order by t.delete_order,x.store_name,x.entry_revision),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 into mh from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id where x.manifest_id=m.id;
 token:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 update public.worker_jobs set status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
  claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',claimed_by='own-report-revocation-v1',progress_note='purging' where id=j.id;
 update public.retention_due_phases set status='claimed',claim_token_hash=token,claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='active' where id=d.retention_row_id;
 update public.purge_manifests set state='executing',physical_purge_started_at=clock_timestamp(),frozen_manifest_hash=mh where id=m.id;
 -- One database transaction holds the common locks from start through residual
 -- receipt. A crash rolls back all progress; regrant/generation cannot interleave.
 for e in select x.* from public.purge_manifest_entries x join public.purge_targets t on t.target_id=x.target_id
  where x.manifest_id=m.id order by t.delete_order,x.store_name,x.entry_revision
 loop
  if e.store_name='public.user_prs' then
   delete from public.user_prs p using private.own_analysis_runs a
   where p.id=(e.row_key->>'id')::uuid and p.file_id=(e.row_key->>'fileId')::uuid
    and p.user_id=j.user_id and p.subject_id=j.subject_id and a.file_id=p.file_id
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose='reports.polygenic';
  elsif e.store_name='public.chat_messages' then
   delete from public.chat_messages cm using public.chats cc
   where cm.id=(e.row_key->>'id')::uuid and cm.chat_id=(e.row_key->>'chatId')::uuid
    and cm.turn_id=(e.row_key->>'turnId')::uuid and cm.user_id=j.user_id
    and cc.id=cm.chat_id and cc.user_id=j.user_id and cc.subject_id=j.subject_id and cc.scope_kind='self'
    and cc.legacy_unverified is false and cc.canonical_authority is not null
    and cm.legacy_unverified is false and cm.canonical_projection is not null
    and encode(extensions.digest(convert_to(cm.canonical_projection::text,'UTF8'),'sha256'),'hex')=e.row_key->>'projectionHash';
  else
   delete from private.own_analysis_runs a where a.id=(e.row_key->>'id')::uuid and a.file_id=(e.row_key->>'fileId')::uuid
    and a.grant_id=(c->>'grantId')::uuid and a.grant_revision=(c->>'grantRevision')::bigint
    and a.account_id=j.user_id and a.subject_id=j.subject_id and a.purpose=c->>'purpose';
  end if;
  get diagnostics changed=row_count; deleted:=deleted+changed; cursor_value:=cursor_value+1;
  update public.purge_manifest_entries set status=case when changed=0 then 'missing' else 'deleted' end
   where manifest_id=e.manifest_id and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
 end loop;
 if exists(select 1 from private.own_copilot_purge_messages_v1(j.user_id,j.subject_id,(c->>'grantId')::uuid,(c->>'grantRevision')::bigint))
  or exists(select 1 from private.own_analysis_runs where grant_id=(c->>'grantId')::uuid)
  or (c->>'purpose'='reports.polygenic' and exists(select 1 from public.user_prs p where p.user_id=j.user_id and p.subject_id=j.subject_id
    and not exists(select 1 from private.own_analysis_runs a join public.purpose_grants g on g.grant_id=a.grant_id and g.grant_revision=a.grant_revision
     where a.file_id=p.file_id and a.purpose='reports.polygenic' and a.account_id=p.user_id and a.subject_id=p.subject_id
      and exists(select 1 from public.subjects ns where ns.id=a.subject_id
       and (a.authority->'context'->>'subjectBindingRevision')::bigint=ns.subject_binding_revision
       and g.subject_binding_revision=ns.subject_binding_revision)
      and a.grant_id<>(c->>'grantId')::uuid and g.revoked_at is null and (g.expires_at is null or g.expires_at>clock_timestamp()) and a.state='complete'
      and exists(select 1 from public.genome_files f join private.own_normalization_runs n on n.file_id=f.id
       join public.genome_storage_objects o on o.genome_file_id=f.id and o.object_id=f.storage_object_id
       join storage.objects so on so.id=o.object_id join public.directional_grants dg on dg.grant_id=g.grant_id and dg.grant_revision=g.grant_revision
       where f.id=a.file_id and f.user_id=a.account_id and f.subject_id=a.subject_id and f.single_logical_sample_verified_at is not null
       and a.source_sha256=f.sha256 and a.source_revision=f.upload_revision and a.normalization_completed_at=f.normalization_completed_at
       and f.normalization_source_revision=f.upload_revision and n.state='complete' and n.account_id=f.user_id
       and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path
       and n.manifest->>'rawSha256'=f.sha256
       and n.manifest->>'decodedSha256'=f.source_sha256 and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
       and o.bucket_id='genomes' and o.state='current' and o.revoked_at is null and o.sha256=f.sha256 and o.byte_count=f.size_bytes
       and o.object_revision=f.upload_revision and o.object_name=f.bucket_path and so.bucket_id=o.bucket_id and so.name=o.object_name
       and (so.metadata->>'size')::bigint=f.size_bytes and dg.status='current' and dg.direction='self' and dg.recipient_account_id=a.account_id)))) then
  raise exception using errcode='55000',message='own_report_purge_residuals'; end if;
 update public.purge_manifests set state='complete',batch_cursor=cursor_value where id=m.id;
 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='exact_grant_residuals_zero',completed_at=clock_timestamp()
  where retention_row_id=d.retention_row_id and phase_id=d.phase_id and phase_revision=d.phase_revision;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=d.retention_row_id;
 update public.worker_jobs set status='done',claim_token_hash=null,claim_expires_at=null,claimed_by=null,
  finished_at=clock_timestamp(),progress=100,progress_note='complete',
  result=jsonb_build_object('outcome','exact_grant_residuals_zero','deletedRows',deleted,'manifestId',m.id,
   'completedWithinDeadline',clock_timestamp()<=d.phase_deadline) where id=j.id;
 perform private.append_legal_audit_event('purpose.purge-complete',null,'api.jobs.retention','accepted',
  jsonb_build_object('purpose',c->>'purpose','deletedRows',deleted,'completedWithinDeadline',clock_timestamp()<=d.phase_deadline));
 return jsonb_build_object('outcome','complete','deletedRows',deleted);
end;
$fn$;


-- prepare_own_report_purge_v1 already freezes exact journal IDs and old grants;
-- clear_revoked_own_report_outputs_v1 preserves frozen manifests before removal.
-- Their generic journal predicates now include ancestry via the scope above.
-- Selected-file deletion still requires Storage ACK before genome_files DELETE;
-- its existing journal FK cascades only that file, retaining all chat safeguards.

-- Display-only projection of already recorded canonical preparation facts.
-- No source reads, reprocessing, grants, or legacy provenance backfill.
create or replace function private.read_own_input_sources_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_file_ids uuid[],p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare v_id uuid; f public.genome_files%rowtype; r private.own_normalization_runs%rowtype;
 p jsonb; a jsonb; result jsonb:='[]'; v_counts jsonb;
begin
 if p_file_ids is null or cardinality(p_file_ids)>100 or array_position(p_file_ids,null) is not null
  or (p_purpose is not null and p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')) then
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
