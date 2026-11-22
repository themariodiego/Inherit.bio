-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. The Neanderthal estimate is TEST-LOCAL only: under
-- the test jurisdiction the generation worker writes revision-5 ancestry
-- content, and in production the capability is OFF, so no revision-5
-- content is ever written and this validator branch is never reached by a
-- production write. It goes in a later guarded release, not PR 324's.
-- =====================================================================
--
-- Owner decision 2026-10-16 ("BAM/CRAM read calling and the Neanderthal
-- estimate (G7.4)", docs/protocol/decisions.md): build the estimate from a
-- licence-checked marker list and test it on synthetic data. The estimate is
-- captured in own-ancestry content revision 5, which is revision 4 (the
-- seven-region admixture, lineage and figure-basis) with one added
-- `neanderthal` block.
--
-- This migration adds exactly one thing to
-- private.validate_own_ancestry_content_v1: a schemaVersion=5 branch that
-- strictly checks the `neanderthal` block and then hands the rest to the
-- unchanged v4 branch (which hands its remainder to v3). The panel id, version
-- and SHA-256 are pinned as literals, the same way the v1/v2 branch pins the
-- AIMs panel; the counts are integers within [0, panelSites] with archaic <=
-- covered; the estimate equals archaic/covered when anything is covered and is
-- null otherwise; the interval, when present, is ordered, in [0,1] and brackets
-- the estimate. Every earlier revision validates exactly as before: the v5
-- branch is reached only for schemaVersion=5.
--
-- Patched in place with the guard pattern of 20261016204000: the exact
-- predecessor body md5, one anchor, the pinned successor md5 and unchanged
-- privileges, volatility, owner, security definer and search_path.

do $predecessor$
begin
 if to_regprocedure('private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)') is null
  or to_regprocedure('private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text)') is null then
  raise exception using errcode='55000',message='neanderthal ancestry content prerequisite missing'; end if;
end;
$predecessor$;

do $patch$
declare target regprocedure:='private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)'::regprocedure;
 definition text; before_acl aclitem[]; before_volatile "char"; before_owner oid; before_secdef boolean; before_config text[];
 old_fragment text:=$old$ if c->'schemaVersion'='4'::jsonb then$old$;
 new_fragment text:=$new$ if c->'schemaVersion'='5'::jsonb then
  if c->>'computationRevision' is distinct from 'own-ancestry-content-v5'
   or octet_length(c::text)>65536
   or jsonb_typeof(c->'neanderthal') is distinct from 'object'
   or not(c->'neanderthal' ?& array['panelId','panelVersion','markerSha256','panelSites','coveredSites','archaicSites','estimate','interval','resamples','basis'])
   or (c->'neanderthal')-array['panelId','panelVersion','markerSha256','panelSites','coveredSites','archaicSites','estimate','interval','resamples','basis']<>'{}'
   or c#>>'{neanderthal,panelId}' is distinct from 'neanderthal-sprime-1kg-v1'
   or c#>>'{neanderthal,panelVersion}' is distinct from 'browning2018-sprime-ceu-chb-gih-grch38-2026-10-22'
   or c#>>'{neanderthal,markerSha256}' is distinct from '21f0862ed04f21ddd3fc338b599088e8f5d24b1f928547b4b79030a1b4709e93'
   or c#>'{neanderthal,panelSites}' is distinct from '3110'::jsonb
   or c#>'{neanderthal,resamples}' is distinct from '200'::jsonb
   or c#>>'{neanderthal,basis}' is distinct from 'modelled'
   or (c#>>'{neanderthal,coveredSites}') !~ '^(0|[1-9][0-9]*)$'
   or (c#>>'{neanderthal,archaicSites}') !~ '^(0|[1-9][0-9]*)$'
   or (c#>>'{neanderthal,coveredSites}')::numeric>3110
   or (c#>>'{neanderthal,archaicSites}')::numeric>(c#>>'{neanderthal,coveredSites}')::numeric then
   raise exception using errcode='22023',message='invalid_ancestry_content';
  end if;
  if (c#>>'{neanderthal,coveredSites}')::numeric>0 then
   if jsonb_typeof(c#>'{neanderthal,estimate}') is distinct from 'number'
    or abs((c#>>'{neanderthal,estimate}')::numeric*(c#>>'{neanderthal,coveredSites}')::numeric-(c#>>'{neanderthal,archaicSites}')::numeric)>1e-6 then
    raise exception using errcode='22023',message='invalid_ancestry_content';
   end if;
  else
   if c#>'{neanderthal,estimate}' is distinct from 'null'::jsonb then
    raise exception using errcode='22023',message='invalid_ancestry_content';
   end if;
  end if;
  if c#>'{neanderthal,interval}' is distinct from 'null'::jsonb then
   if jsonb_typeof(c#>'{neanderthal,interval}') is distinct from 'object'
    or not(c#>'{neanderthal,interval}' ?& array['low','high'])
    or (c#>'{neanderthal,interval}')-array['low','high']<>'{}'
    or jsonb_typeof(c#>'{neanderthal,interval,low}') is distinct from 'number'
    or jsonb_typeof(c#>'{neanderthal,interval,high}') is distinct from 'number'
    or (c#>>'{neanderthal,coveredSites}')::numeric=0
    or (c#>>'{neanderthal,interval,low}')::numeric<0
    or (c#>>'{neanderthal,interval,high}')::numeric>1
    or (c#>>'{neanderthal,interval,low}')::numeric>=(c#>>'{neanderthal,interval,high}')::numeric
    or (c#>>'{neanderthal,interval,low}')::numeric>(c#>>'{neanderthal,estimate}')::numeric
    or (c#>>'{neanderthal,interval,high}')::numeric<(c#>>'{neanderthal,estimate}')::numeric then
    raise exception using errcode='22023',message='invalid_ancestry_content';
   end if;
  end if;
  perform private.validate_own_ancestry_content_v1((c-'neanderthal')||'{"schemaVersion":4,"computationRevision":"own-ancestry-content-v4"}'::jsonb,f,s,a,encoding);
  return;
 end if;
 if c->'schemaVersion'='4'::jsonb then$new$;
begin
 select pg_get_functiondef(target),proacl,provolatile,proowner,prosecdef,proconfig
  into definition,before_acl,before_volatile,before_owner,before_secdef,before_config
  from pg_proc where oid=target and md5(prosrc)='901478e0f2a5123e13d72b1cbbb47e08';
 if definition is null then raise exception using errcode='55000',message='neanderthal validator predecessor differs'; end if;
 if before_secdef is not true or before_volatile<>'v' or before_config is distinct from array['search_path=pg_catalog'] then
  raise exception using errcode='55000',message='neanderthal validator attributes differ'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='neanderthal validator anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='1ea5779beeec9ecb22802ee89fba3a85'
   and proacl is not distinct from before_acl and provolatile=before_volatile and proowner=before_owner
   and prosecdef=before_secdef and proconfig is not distinct from before_config) then
  raise exception using errcode='55000',message='neanderthal validator successor differs'; end if;
end;
$patch$;
