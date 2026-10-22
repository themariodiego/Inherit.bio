-- PRODUCTION RELEASE: GUARDED
--
-- G7.4, ADR 0038: read-calling provenance on the own-source display read.
--
-- Under TEST-LOCAL only, the own-DNA picker can call genotypes from a BAM or
-- CRAM on the person's device and upload the resulting single-sample VCF
-- through the unchanged VCF path. The TypeScript normalization then adds a
-- `readCalls` object to the provenance it already sends to `complete`, and
-- only when the deployment is TEST-LOCAL and the file carries the caller's
-- exact header (src/lib/genome/reads/provenance.ts). Production never writes
-- it. `complete` already stores the provenance object as given, so no write
-- path changes here.
--
-- What changes: `private.read_own_input_sources_v1` builds a fixed display
-- object and so dropped that key. This patch projects it into `snapshot`,
-- after `counts`, only when it has the exact closed shape:
--   version = 'inherit-read-calls-v1'; input in ('BAM','CRAM');
--   minimumDepth, minimumBaseQuality, minimumMappingQuality: non-negative
--   integers; heterozygousLow, heterozygousHigh, homozygousMinimum: numbers
--   in [0,1]; reviewed = false; and no other key.
-- Anything else is dropped, never the source: every test is inside a CASE,
-- so a malformed value cannot raise and skip the file. An ordinary VCF or
-- array source gets a byte-identical object. No table, constraint, grant,
-- write path or other function changes, and the public wrapper is untouched.
--
-- The thresholds it carries are engineering defaults pending scientific
-- review; `reviewed` can only be false.
--
-- Pattern: md5-guarded in-place patch. The predecessor body is the one
-- 20260907111757_canonical_own_ancestry_generation.sql installed; exactly one
-- anchor must match; the successor md5 and an unchanged ACL are asserted.

do $patch_read_called_input$
declare target regprocedure:='private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$'singleSample',v_counts->'singleSample','buildClaim',v_counts->'buildClaim'))));$old$;
 new_fragment text:=$new$'singleSample',v_counts->'singleSample','buildClaim',v_counts->'buildClaim'))
     -- 20261022110000: TEST-LOCAL read-calling provenance, only in its closed shape.
     ||case when jsonb_typeof(p->'readCalls')='object'
      and (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(p->'readCalls') k)
       =array['heterozygousHigh','heterozygousLow','homozygousMinimum','input','minimumBaseQuality',
        'minimumDepth','minimumMappingQuality','reviewed','version']::text[]
      and p->'readCalls'->'version'='"inherit-read-calls-v1"'::jsonb
      and p->'readCalls'->'input' in ('"BAM"'::jsonb,'"CRAM"'::jsonb)
      and p->'readCalls'->'reviewed'='false'::jsonb
      and not exists(select 1 from unnest(array['minimumDepth','minimumBaseQuality','minimumMappingQuality']) k
       where case when jsonb_typeof(p->'readCalls'->k)='number'
        then (p->'readCalls'->>k)!~'^(0|[1-9][0-9]{0,8})$' else true end)
      and not exists(select 1 from unnest(array['heterozygousLow','heterozygousHigh','homozygousMinimum']) k
       where case when jsonb_typeof(p->'readCalls'->k)='number'
        then (p->'readCalls'->>k)::numeric<0 or (p->'readCalls'->>k)::numeric>1 else true end)
     then jsonb_build_object('readCalls',p->'readCalls') else '{}'::jsonb end));$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='5f6d4777cf080f59ffa0d7d5e888fc8b';
 if definition is null then
  raise exception using errcode='55000',message='own input sources reader predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='own input sources reader anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='13d4287ed62bbb15069d56ca3c935d6f'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='own input sources reader successor differs'; end if;
end;
$patch_read_called_input$;
