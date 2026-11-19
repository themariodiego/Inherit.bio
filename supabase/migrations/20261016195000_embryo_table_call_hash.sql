-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Embryo ingest is TEST-LOCAL only and
-- EMBRYO_INGEST_AVAILABLE stays false.
-- =====================================================================
--
-- ADR 0037: a laboratory-table genotype is stored with no reference allele
-- (20261016120000_embryo_table_mapping_route.sql, section 7). Publication
-- copies each staged row into public.embryo_variants, and the call fence
-- private.guard_immutable_embryo_calls_v1 (20260930245000) admits a copied
-- row only when private.embryo_call_value_hash_v1 of the staged row equals
-- that of the new row. The hash length-prefixes the reference allele with
-- private.length_prefix_utf8, which is STRICT, so a NULL reference made the
-- whole hash NULL. NULL never equals NULL, so the fence refused every table
-- row with 42501 embryo_source_unavailable and no table source could ever
-- publish.
--
-- The one change: a NULL reference allele is encoded as the four bytes
-- ff ff ff ff, which is int4send(-1). A length prefix is int4send of a
-- byte count, never negative, so its first byte is at most 7f; the encoding
-- stays unambiguous. Every non-NULL reference is encoded exactly as before,
-- so every existing hash, every VCF row and the fence's other comparisons
-- are unchanged. The expression index that serves the fence is rebuilt
-- because its function's answer for NULL changed. No table, column, grant,
-- row or other function changes.

do $predecessor$
begin
 if to_regprocedure('private.embryo_call_value_hash_v1(integer,bigint,text,text,text)') is null
   or to_regclass('private.embryo_split_exact_call_lookup') is null then
  raise exception using errcode='55000',message='embryo call hash prerequisite missing'; end if;
end;
$predecessor$;

do $patch_hash$
declare target regprocedure:='private.embryo_call_value_hash_v1(integer,bigint,text,text,text)'::regprocedure;
 definition text; before_acl aclitem[]; before_value text;
 old_fragment text:=$old$private.length_prefix_utf8(p_ref)$old$;
 new_fragment text:=$new$coalesce(private.length_prefix_utf8(p_ref),decode('ffffffff','hex'))$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='4d2c2b593507c9770df523fca19a93e6';
 if definition is null then raise exception using errcode='55000',message='embryo call hash predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='embryo call hash anchor differs'; end if;
 before_value:=private.embryo_call_value_hash_v1(1,1000,'A','G','A/G');
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='2286a0c4efaaf66e19c60e4fcfdcd7a1'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='embryo call hash successor differs'; end if;
 -- A reference allele hashes exactly as before; a missing one now hashes,
 -- and never as an empty one.
 if private.embryo_call_value_hash_v1(1,1000,'A','G','A/G') is distinct from before_value
   or private.embryo_call_value_hash_v1(1,1000,null,null,'A/G') is null
   or private.embryo_call_value_hash_v1(1,1000,null,null,'A/G')
     =private.embryo_call_value_hash_v1(1,1000,'',null,'A/G') then
  raise exception using errcode='55000',message='embryo call hash successor differs'; end if;
end;
$patch_hash$;

reindex index private.embryo_split_exact_call_lookup;
