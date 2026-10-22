-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: no jurisdiction,
-- capability or rate limit is opened here.
-- =====================================================================
--
-- api.subject-delete, adult case, for the reviewed-document branch of Path B
-- (owner decisions 2026-10-16, "The subjects endpoints (G2.1)": all five
-- delete cases; docs/protocol/decisions.md).
--
-- 20261016181000 chose the adult Path B case by a confirmed draft of the
-- e-signature flow only. 20261016190000 then added the second Path B flow,
-- path-b-reviewed-document, whose confirmed record is the same uploader-owned
-- other_adult record with the same held uploads, principals and contact
-- references. Such a record answered resource-not-found, so neither its
-- uploader nor the person could delete it through this route.
--
-- The one change: the door's Path B test accepts a confirmed draft of either
-- flow. Everything after it is the existing case: the person's delete writes
-- the subject-controlled refusal bar first and ends each held file as
-- deleted, the uploader's ends them as withdrawn, the record is purged and
-- its contact shredded. The reviewed-document flow's own constraint trigger
-- (permission_documents_subject_lifecycle) disposes of its permission
-- document stores when the record leaves active, as it already does for
-- every other ending. No table, column, grant or other function changes.

do $patch_door$
declare target regprocedure:='public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$and d.adult_flow='path-b-subject-esignature' and d.state='confirmed');$old$;
 new_fragment text:=$new$and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed');$new$;
begin
 if to_regprocedure('private.path_b_reviewed_document_retained_v1(uuid)') is null
  or not exists(select 1 from pg_constraint where conname='adult_subject_drafts_adult_flow_check'
   and pg_get_constraintdef(oid) like '%path-b-reviewed-document%') then
  raise exception using errcode='55000',message='subject delete reviewed-document prerequisite missing'; end if;
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='39abbfe9f403ac173f1b56b38494b66f';
 if definition is null then raise exception using errcode='55000',message='subject delete door predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='subject delete door anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='09f00c92c9b1016ef554a297d02b632d'
   and proacl is not distinct from before_acl and prosecdef and proconfig=array['search_path=""']::text[]) then
  raise exception using errcode='55000',message='subject delete door successor differs'; end if;
end;
$patch_door$;

notify pgrst, 'reload schema';
