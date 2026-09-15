-- Versioned seven-region capture. No stored content, permissions, run identity,
-- source journal or ready notice is rewritten. Historical validation below is
-- unchanged except for dispatch to the separately closed revision-3 contract.

create function private.validate_own_ancestry_content_v3(c jsonb, f uuid, s uuid, a jsonb, encoding text)
returns void language plpgsql security invoker set search_path=pg_catalog as $v3$
declare
 x jsonb; k text; i integer; total integer:=0; used integer;
 shares numeric:=0; confusable integer:=0; iterations integer; converged boolean;
begin
 if encoding is null or encoding not in ('vcf-literal','array-genotype')
  or jsonb_typeof(c) is distinct from 'object'
  or not(c ?& array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages'])
  or c-array['schemaVersion','computationRevision','source','panel','admixture','panelPositions','lineages']<>'{}'
  or c->'schemaVersion' is distinct from '3'::jsonb
  or c->>'computationRevision' is distinct from 'own-ancestry-content-v3'
  or octet_length(c::text)>65536 then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 if c->'source' is distinct from jsonb_build_object('fileId',f,'subjectId',s,'normalizedBuild','GRCh38',
   'sourceRevision',(a->>'sourceRevision')::bigint,'sourceSha256',a->>'sourceSha256',
   'callEncoding',encoding,'normalizedAt',c#>'{source,normalizedAt}')
  or jsonb_typeof(c#>'{source,normalizedAt}') is distinct from 'string'
  or (c#>>'{source,normalizedAt}')::timestamptz is distinct from (a->>'normalizedAt')::timestamptz then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 if c->'panel' is distinct from '{"id":"aims-hgdp-tgp-168","version":"hgdp-1kg-v3.1.2-cap30-168-v1","provenance":"data/ref/AIMS_SEVEN_REGION_PROVENANCE.md","markerSha256":"54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163","markerCount":168,"minimumMarkers":168}'::jsonb
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
  or c#>>'{admixture,kind}' is distinct from 'admixture'
  or c#>>'{admixture,model_id}' is distinct from 'aims-hgdp-tgp-168'
  or c#>>'{admixture,model_version}' is distinct from 'hgdp-1kg-v3.1.2-cap30-168-v1'
  or c#>>'{admixture,basis}' is distinct from 'modelled'
  or c#>'{admixture,range}' is distinct from '{"unavailable":true}'::jsonb
  or c#>>'{admixture,resolution}' is distinct from 'seven-regions-adaptive-v1'
  or c#>>'{admixture,result_state}' is distinct from (case when used=0 then 'not_covered' when used<168 then 'partial' else 'available' end)
  or jsonb_typeof(c#>'{admixture,coverage}') is distinct from 'number'
  or (c#>>'{admixture,coverage}')::numeric not between 0 and 1
  -- Match the saved JavaScript quotient after JSON's decimal round trip.
  or (c#>>'{admixture,coverage}')::double precision<>used::double precision/168
  or jsonb_typeof(c#>'{admixture,result}') is distinct from 'object'
  or not(c#>'{admixture,result}' ?& array['proportions','markersUsed','note','reporting','fit'])
  or (c#>'{admixture,result}')-array['proportions','markersUsed','note','reporting','fit']<>'{}'
  or c#>'{admixture,result,markersUsed}' is distinct from to_jsonb(used)
  or jsonb_typeof(c#>'{admixture,result,note}') is distinct from 'string'
  or length(c#>>'{admixture,result,note}') not between 1 and 4096
  or c#>'{admixture,support_note}' is distinct from c#>'{admixture,result,note}' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;

 -- Diagnostics describe the completed fit, including reaching the iteration cap.
 x:=c#>'{admixture,result,fit}';
 if jsonb_typeof(x) is distinct from 'object' or not(x ?& array['iterations','converged'])
  or x-array['iterations','converged']<>'{}'
  or jsonb_typeof(x->'iterations') is distinct from 'number'
  or (x->>'iterations') !~ '^(0|[1-9][0-9]*)$'
  or (x->>'iterations')::numeric>50000
  or jsonb_typeof(x->'converged') is distinct from 'boolean' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 iterations:=(x->>'iterations')::integer; converged:=(x->>'converged')::boolean;
 if (used=0 and (iterations<>0 or converged))
  or (used>0 and (iterations=0 or (not converged and iterations<>50000))) then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;

 if c#>>'{admixture,result,note}' is distinct from (case when used=0 then 'No usable ancestry markers were read. No region shares were computed.'
  when converged then 'These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places.'
  else 'These shares describe broad matches to reference groups. This seven-region model has no tested range yet. The groups do not cover all people or places. The fit reached its calculation limit, so these shares may still change with more fitting steps.' end) then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;

 -- Zero usable markers carries no fitted proportions, never a uniform prior.
 -- Positive fits retain unrounded doubles. Only arithmetic noise is tolerated
 -- in their sum; each share remains individually bounded and typed.
 if used=0 then
  if c#>'{admixture,result,proportions}' is distinct from 'null'::jsonb then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 else
  x:=c#>'{admixture,result,proportions}';
  if jsonb_typeof(x) is distinct from 'object'
   or not(x ?& array['AFR','AMR','CSA','EAS','EUR','MID','OCE'])
   or x-array['AFR','AMR','CSA','EAS','EUR','MID','OCE']<>'{}' then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  for k,x in select key,value from jsonb_each(x) loop
   if jsonb_typeof(x)<>'number' or (x::text)::numeric<0 or (x::text)::numeric>1 then
    raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
   shares:=shares+(x::text)::numeric;
   -- Reproduce JSON.parse's IEEE754 comparison, including excess decimal digits.
   if k in ('EUR','MID','CSA') and (x::text)::double precision>0.10::double precision then confusable:=confusable+1; end if;
  end loop;
  if abs(shares-1)>0.000000000001 then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 end if;
 if c#>'{admixture,result,reporting}' is distinct from jsonb_build_object(
  'policy','merge-eur-mid-csa-v1','threshold',0.1,'merged',confusable>=2,
  'caveat','This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often.') then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;

 -- The lineage method and its reference trees are unchanged from revision 2.
 if jsonb_typeof(c->'lineages') is distinct from 'array' or jsonb_array_length(c->'lineages')<>2 then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
 for i,x in select (ordinality-1)::integer,value from jsonb_array_elements(c->'lineages') with ordinality loop
   -- Revision 2 carries a real call. The tree is pinned by id, version AND a
   -- digest over its topology and both alleles of every marker, for the same
   -- reason the AIMs panel is pinned above: a stored haplogroup carries no
   -- number to look wrong, so content must not outlive the tree it was read
   -- against.
   if jsonb_typeof(x) is distinct from 'object'
    or not(x ?& array['kind','state','tree','markerPositions','observedPositions','readablePositions','call','reason'])
    or x-array['kind','state','tree','markerPositions','observedPositions','readablePositions','call','reason']<>'{}'
    or x->>'state' is null or x->>'state' not in ('available','unavailable')
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
     or x#>>'{call,support}' is null or x#>>'{call,support}' not in ('strong','partial','insufficient')
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
 end loop;
 if c#>>'{lineages,0,kind}' is distinct from 'mtdna' or c#>>'{lineages,1,kind}' is distinct from 'ydna' then
  raise exception using errcode='22023',message='invalid_ancestry_content'; end if;

exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 raise exception using errcode='22023',message='invalid_ancestry_content';
end;
$v3$;
revoke all on function private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION private.validate_own_ancestry_content_v1(c jsonb, f uuid, s uuid, a jsonb, encoding text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare x jsonb; k text; i integer; total integer:=0; used integer; proportions numeric:=0;
begin
 if c->'schemaVersion'='3'::jsonb then
  perform private.validate_own_ancestry_content_v3(c,f,s,a,encoding);
  return;
 end if;
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
  -- `ranges` joined the closed set on 2026-09-14. It is OPTIONAL and stays so:
  -- every result captured before that date has none, and this function also
  -- re-checks rows that were already stored. `?&` above still requires the
  -- other three, so the field can be absent but nothing else can appear.
  or (c#>'{admixture,result}')-array['proportions','markersUsed','note','ranges']<>'{}'
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
 -- The interval on each share. A population may be absent (every resample
 -- agreed, so there is no spread to state) but one that is present must be a
 -- real interval AROUND ITS OWN SHARE: an interval that does not contain the
 -- number printed beside it is a corrupted capture, not a rare draw. The
 -- tolerance is the estimator's 3-dp rounding plus the sum repair it applies
 -- to its largest component, which moves that one share off the fit the
 -- interval was measured around.
 if c#>'{admixture,result}' ? 'ranges' then
  if jsonb_typeof(c#>'{admixture,result,ranges}') is distinct from 'object'
   or (c#>'{admixture,result,ranges}')-array['AFR','AMR','EAS','EUR','SAS']<>'{}' then
   raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  for k,x in select key,value from jsonb_each(c#>'{admixture,result,ranges}') loop
   if jsonb_typeof(x) is distinct from 'object'
    or not(x ?& array['low','high']) or x-array['low','high']<>'{}'
    or jsonb_typeof(x->'low') is distinct from 'number'
    or jsonb_typeof(x->'high') is distinct from 'number'
    or (x->>'low')::numeric<0 or (x->>'high')::numeric>1
    or (x->>'low')::numeric>=(x->>'high')::numeric
    or (c#>>array['admixture','result','proportions',k])::numeric<(x->>'low')::numeric-0.005
    or (c#>>array['admixture','result','proportions',k])::numeric>(x->>'high')::numeric+0.005 then
    raise exception using errcode='22023',message='invalid_ancestry_content'; end if;
  end loop;
 end if;
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
$function$

;
