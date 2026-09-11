-- Lineages, computed on the canonical path (G4.4).
--
-- Until now no file the product creates could reach a populated lineage card.
-- The mechanism was all there -- the curated trees, the classifier, the card,
-- its copy -- and the one missing link was the read: the canonical ancestry
-- run asked for the autosomal AIMs panel and nothing else, so the content it
-- captured counted zero mitochondrial and zero Y positions for every file and
-- reported "no supplied positions" whatever the source actually held.
--
-- Two changes, and the first is the smaller one.
--
-- 1. A new read operation, 'read-lineage'. It is a separate operation rather
--    than a relaxation of the existing pair, because the pair encodes a real
--    rule that must survive: on a VCF source the admixture half is computed
--    from OBSERVED calls, so that a position the file records as matching the
--    reference is told apart from a position the file does not mention. Simply
--    permitting 'read-variants' for a vcf-literal ancestry run would have let
--    the admixture half be computed from variants alone and silently lose that
--    distinction. 'read-lineage' instead reads the variant rows and is refused
--    outside ancestry and outside chromosomes 24 and 25, so it can read the two
--    haploid chromosomes and nothing else.
--
--    Variant rows are the correct source for this question twice over. The
--    observed-call extraction is 'vcf-literal-diploid-snp-v1' and decodes a
--    diploid GT only, so the haploid genotypes these chromosomes carry reach it
--    as "--" and unusable; reading lineages there would report every correctly
--    encoded file as unreadable. And at a defining marker an absent row means
--    the position was not called -- never that the ancestral allele was seen --
--    which is exactly what the classifier's walk requires.
--
-- 2. The captured-content validator accepts revision 2, which carries the call.
--    It KEEPS accepting revision 1, and that is not politeness toward old rows:
--    this function is also called to re-validate content already stored, so
--    rejecting revision 1 would invalidate results that are still exactly as
--    true as the day they were computed.
--
-- Revision 2 pins each tree by id, version AND a digest over its topology and
-- both alleles of every marker -- the same protection the AIMs panel gets from
-- markerSha256 above, and needed more here, because a stored haplogroup NAME
-- carries no number that could look wrong if the tree beneath it moved.
--
-- Both function bodies below were derived from the definitions installed in the
-- database rather than retyped, so the only differences from the previous
-- behaviour are the ones described here.

CREATE OR REPLACE FUNCTION private.own_report_generation_v1(p_operation text, p_account_id uuid, p_session_id uuid, p_file_id uuid, p_purpose text, p_claim uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare a jsonb; r private.own_analysis_runs%rowtype; result jsonb; v_subject uuid; f public.genome_files%rowtype; source jsonb; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')
  or p_operation is null or p_operation not in ('begin','check','read-variants','read-observed','read-lineage','complete','fail') then
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
   or (private.own_report_source_metadata_v1(p_account_id,p_file_id,true)->>'verifiedFileType') is distinct from f.file_type::text then
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
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,r.claim,a,false);
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end;
 end if;
 if p_operation='check' and p_claim is null and private.own_analysis_completion_matches_v1(p_file_id,p_purpose,a) then
  return jsonb_build_object('status','complete','purpose',p_purpose); end if;
 if r.id is null or r.state<>'running' or r.account_id<>p_account_id or r.claim is distinct from p_claim
  or r.authority is distinct from a or r.ancestry_source is distinct from source or r.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_operation='check' then
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,false);
  return jsonb_build_object('status','authorized','claim',r.claim,'purpose',r.purpose,'authorization',a)||case when p_purpose='ancestry' then jsonb_build_object('source',source) else '{}'::jsonb end; end if;
 if p_operation in ('read-variants','read-observed','read-lineage') then
  if a ? 'preparedSource' then raise exception using errcode='55000',message='prepared_object_reader_required'; end if;
  if p_operation='read-lineage' and p_purpose<>'ancestry' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if p_purpose='ancestry' and p_operation<>'read-lineage'
   and ((source->>'callEncoding'='vcf-literal' and p_operation<>'read-observed')
   or (source->>'callEncoding'='array-genotype' and p_operation<>'read-variants')) then
   raise exception using errcode='22023',message='invalid_request'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or not(p_payload ?& array['loci','offset'])
   or p_payload-array['loci','offset']<>'{}'::jsonb or jsonb_typeof(p_payload->'loci') is distinct from 'array'
   or jsonb_array_length(p_payload->'loci') not between 1 and 200
   or p_payload->>'offset'!~'^(0|[1-9][0-9]*)$' then raise exception using errcode='22023',message='invalid_request'; end if;
  if p_operation in ('read-variants','read-lineage') then
   select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
    with requested as materialized (
     select distinct p.chrom,p.pos from jsonb_to_recordset(p_payload->'loci') as p(chrom integer,pos integer))
    select v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype
    from requested p cross join lateral (
     select v.id,v.file_id,v.rsid,v.chrom,v.pos,v.ref,v.alt,v.genotype from public.user_variants v
     where v.file_id=p_file_id and v.user_id=p_account_id and v.subject_id=v_subject
      and (p_operation='read-variants' or v.chrom in (24,25))
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
  update private.own_analysis_runs set state='complete',completed_at=clock_timestamp(),result=p_payload where id=r.id;
  perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,true);
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
 update private.own_analysis_runs set state='complete',completed_at=clock_timestamp(),
  result=jsonb_build_object('reports',p_payload->'reports','prsCount',jsonb_array_length(p_payload->'prs')) where id=r.id;
 perform private.assert_own_report_run_current_v1(p_account_id,p_session_id,p_file_id,p_purpose,p_claim,a,true);
 return jsonb_build_object('status','complete','purpose',p_purpose);
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_own_ancestry_content_v1(c jsonb, f uuid, s uuid, a jsonb, encoding text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare x jsonb; k text; i integer; total integer:=0; used integer; proportions numeric:=0;
begin
 if encoding is null or encoding not in('vcf-literal','array-genotype')
  or jsonb_typeof(c) is distinct from 'object'
  or not(c ?& array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages'])
  or c-array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages']<>'{}'
  or not((c->'schemaVersion'='1'::jsonb and c->>'computationRevision'='own-ancestry-content-v1')
   or (c->'schemaVersion'='2'::jsonb and c->>'computationRevision'='own-ancestry-content-v2'))
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
  or c#>>'{admixture,result_state}' is distinct from (case when used=0 then 'not_covered' when used<42 then 'partial' else 'available' end)
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
 for i,x in select (ordinality-1)::integer,value from jsonb_array_elements(c->'lineages') with ordinality loop
  if c->'schemaVersion'='1'::jsonb then
   -- Revision 1 never computed a lineage; it only counted positions, and the
   -- count was always zero because the read asked for autosomal markers only.
   -- Kept validating because this function also re-checks ALREADY STORED rows.
   if jsonb_typeof(x) is distinct from 'object' or not(x ?& array['kind','state','reason','observedPositions'])
    or x-array['kind','state','reason','observedPositions']<>'{}' or x->>'state' is distinct from 'unavailable'
    or jsonb_typeof(x->'observedPositions') is distinct from 'number' or (x->>'observedPositions') !~ '^(0|[1-9][0-9]*)$'
    or (x->>'observedPositions')::numeric>9007199254740991
    or x->>'reason' is distinct from (case when (x->>'observedPositions')::bigint=0 then 'no_supplied_positions' else 'lineage_interpretation_not_supported' end) then
    raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  else
   -- Revision 2 carries a real call. The tree is pinned by id, version AND a
   -- digest over its topology and both alleles of every marker, for the same
   -- reason the AIMs panel is pinned above: a stored haplogroup carries no
   -- number to look wrong, so content must not outlive the tree it was read
   -- against.
   if jsonb_typeof(x) is distinct from 'object'
    or not(x ?& array['kind','state','tree','markerPositions','observedPositions','readablePositions','call','reason'])
    or x-array['kind','state','tree','markerPositions','observedPositions','readablePositions','call','reason']<>'{}'
    or x->>'state' not in ('available','unavailable')
    or x->'tree' is distinct from (case when i=0
      then '{"id":"inherit-mtdna-curated-subset","version":"Build 17, Forensic Update 1a","sha256":"fb34d38ac78a900172a398e168b54b786711dbe662c12659db5fd09c6666efd1"}'::jsonb
      else '{"id":"inherit-ydna-curated-subset","version":"2016 index (4 January 2016)","sha256":"b5e956ec511dc3c4c3c40e38862c2e5af513be675cacead0b31469b174a168e3"}'::jsonb end)
    or x->'markerPositions' is distinct from (case when i=0 then to_jsonb(106) else to_jsonb(31) end) then
    raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   foreach k in array array['observedPositions','readablePositions'] loop
    if jsonb_typeof(x->k) is distinct from 'number' or (x->>k) !~ '^(0|[1-9][0-9]*)$' then
     raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   end loop;
   if (x->>'readablePositions')::bigint>(x->>'observedPositions')::bigint
    or (x->>'observedPositions')::bigint>(x->>'markerPositions')::bigint then
    raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   if x->>'state'='available' then
    -- Available means a branch was entered on read bases. Nothing may claim it
    -- with nothing readable, and no reason may sit beside a call.
    if jsonb_typeof(x->'call') is distinct from 'object' or x->'reason'<>'null'::jsonb
     or (x->>'readablePositions')::bigint=0
     or not(x->'call' ?& array['haplogroup','path','matched','tested','support','note'])
     or (x->'call')-array['haplogroup','path','matched','tested','support','note']<>'{}'
     or jsonb_typeof(x#>'{call,haplogroup}') is distinct from 'string'
     or length(x#>>'{call,haplogroup}') not between 1 and 64
     or jsonb_typeof(x#>'{call,path}') is distinct from 'array'
     or jsonb_array_length(x#>'{call,path}') not between 1 and 32
     or exists(select 1 from jsonb_array_elements(x#>'{call,path}') e
        where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}') not between 1 and 64)
     or x#>>'{call,path,-1}' is distinct from x#>>'{call,haplogroup}'
     or jsonb_typeof(x#>'{call,matched}') is distinct from 'number'
     or jsonb_typeof(x#>'{call,tested}') is distinct from 'number'
     or (x#>>'{call,matched}') !~ '^(0|[1-9][0-9]*)$' or (x#>>'{call,tested}') !~ '^[1-9][0-9]*$'
     or (x#>>'{call,matched}')::bigint>(x#>>'{call,tested}')::bigint
     or (x#>>'{call,tested}')::bigint>(x->>'readablePositions')::bigint
     or x#>>'{call,support}' not in ('strong','partial','insufficient')
     or jsonb_typeof(x#>'{call,note}') is distinct from 'string'
     or length(x#>>'{call,note}') not between 1 and 4096 then
     raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   else
    -- Unavailable states exactly why, and the three reasons are not
    -- interchangeable: they are three different facts about the file.
    if x->'call'<>'null'::jsonb
     or x->>'reason' is distinct from (case when (x->>'observedPositions')::bigint=0 then 'no_supplied_positions'
      when (x->>'readablePositions')::bigint=0 then 'no_readable_genotypes' else 'no_branch_matched' end) then
     raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   end if;
  end if;
 end loop;
 if c#>>'{lineages,0,kind}' is distinct from 'mtdna' or c#>>'{lineages,1,kind}' is distinct from 'ydna' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 raise exception using errcode='22023',message='invalid_ancestry_content';
end;
$function$;

-- The two behaviours this migration exists to change, asserted rather than
-- assumed: a lineage read is refused outside ancestry, and content naming
-- revision 2 is accepted where it was not before.
do $$
declare ok boolean;
begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='own_report_generation_v1'
    and pg_get_functiondef(p.oid) like '%read-lineage%') then
  raise exception 'the generation function did not take the lineage read'; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='validate_own_ancestry_content_v1'
    and pg_get_functiondef(p.oid) like '%own-ancestry-content-v2%'
    and pg_get_functiondef(p.oid) like '%own-ancestry-content-v1%') then
  raise exception 'the content validator does not accept both revisions'; end if;
 select has_function_privilege('service_role','private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)','execute')
  into ok;
 if not ok then raise exception 'replacing the validator dropped its grant'; end if;
end $$;
