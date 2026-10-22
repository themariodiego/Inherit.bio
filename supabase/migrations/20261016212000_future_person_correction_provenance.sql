-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Future Person claims are TEST-LOCAL only: the native
-- switch private.new_correction_intake_config stays disabled and nothing
-- here enables it.
-- =====================================================================
--
-- currentProvenance of the named correction review (register
-- api.future-person-correction-review, responseContracts
-- .future-person-correction-review-case-v1), as the owner decided on
-- 2026-10-22 ("Consent, rights and claim endpoints (G2.1)"):
--
--   - fieldVersion and provenanceRevision start at 1 and rise by 1 per
--     approved correction (unchanged; approval is still refused);
--   - sourceKind is fixed per field (unchanged);
--   - sourceReference is a keyed HMAC. The database holds no HMAC key, so it
--     now hands the server an unkeyed `sourceDigest` of the subject, the
--     field and its current source row, and the server publishes only
--     hmacSecret(sourceDigest) as sourceReference
--     (src/lib/future-person/correction-review.ts). The digest itself never
--     leaves the route;
--   - affectedResultCount counts only the report_artifacts and
--     embryo_scores rows bound to the canonical source, that is whose
--     source_binding_fingerprint is the custody slice's source_sha256, and
--     only for variant-call-source and report-provenance. It is 0 for the
--     other three fields (unchanged);
--   - analysisStopped is analysis_stopped_at is not null (unchanged).
--
-- The one function changed is private.correction_review_provenance_v1
-- (20261016210000_future_person_correction_review.sql). Two anchored
-- fragments are replaced, and its predecessor and successor bodies are
-- pinned by md5. Its grants are unchanged. No table, column, row, grant or
-- other function changes.

do $predecessor$
begin
 if to_regprocedure('private.correction_review_provenance_v1(uuid,text)') is null
   or to_regprocedure('private.correction_review_context_v1(uuid)') is null
   or to_regclass('private.future_person_custody_slices') is null then
  raise exception using errcode='55000',message='correction provenance prerequisite missing'; end if;
end;
$predecessor$;

do $patch_provenance$
declare target regprocedure:='private.correction_review_provenance_v1(uuid,text)'::regprocedure;
 definition text; before_acl aclitem[];
 old_count text:=$old$  affected:=(select count(*) from public.report_artifacts where subject_id=p_subject)
   +(select count(*) from public.embryo_scores where embryo_id=e.id);$old$;
 new_count text:=$new$  affected:=(select count(*) from public.report_artifacts where subject_id=p_subject
     and source_binding_fingerprint=x.source_sha256)
   +(select count(*) from public.embryo_scores where embryo_id=e.id and source_binding_fingerprint=x.source_sha256);$new$;
 old_reference text:=$old$'sourceReference',encode($old$;
 new_reference text:=$new$'sourceDigest',encode($new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='f1e03b8db0a2966c0969d461fcfb5f10';
 if definition is null then raise exception using errcode='55000',message='correction provenance predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_count,'')))/length(old_count)<>1
   or (length(definition)-length(replace(definition,old_reference,'')))/length(old_reference)<>1 then
  raise exception using errcode='55000',message='correction provenance anchor differs'; end if;
 execute replace(replace(definition,old_count,new_count),old_reference,new_reference);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='c971b5e0d2baf6404045a4cca2fec331'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='correction provenance successor differs'; end if;
end;
$patch_provenance$;
