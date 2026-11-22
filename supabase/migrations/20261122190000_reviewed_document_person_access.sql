-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Both Path B flows are reached only under the test
-- jurisdiction: every real jurisdiction is unreviewed for the capabilities
-- that create an adult-subject invitation, so in production no Path B record
-- exists and nothing patched here is reachable. It follows 20260930231000
-- (the normalization authority and the read decision), 20260930234000 (the
-- report authority), 20261001039000 and 20261122160000 (the account capture),
-- 20261016190000 (the reviewed-document flow, its retention and the
-- uploader's confirmation read), 20261120120000 (the normalization authority
-- as patched there) and 20261122180000 (the capture as patched there); it
-- goes into release 4 after 20261122180000.
-- =====================================================================
--
-- D-166 (docs/protocol/defects.md), owner decision of 22 November 2026, "A
-- person keeps their own access after the approved document's retention
-- ends (D-166)" (docs/protocol/decisions.md): only the uploader's access to
-- a path-b-reviewed-document record depends on the approved permission
-- document still being retained; the person's own saved results and their
-- downloads of the record and of their account continue after its retention
-- ends, as after an e-signature.
--
-- private.path_b_subject_v1 (20261016190000) is the uploader's confirmation
-- read. For a reviewed-document record it requires the approved document
-- still retained (private.path_b_reviewed_document_retained_v1: clean,
-- approved, and live, i.e. retain_until after now, 730 days after
-- acceptance), as the register's upload rule for this flow says. It has five
-- callers, and through them every path that reads it:
--   - the uploader's held upload (private.other_adult_upload_store_authority_v1,
--     behind every upload-session, storage and finalization check) and the
--     uploader's finalization of a held file
--     (private.complete_own_upload_finalization_v1): the uploader's.
--     Unchanged.
--   - the public appeal's resolution of a subject objection
--     (private.public_appeal_provisional_binding_v1): an unauthenticated
--     intake matched by contact digests, neither the person's own read or
--     export nor the uploader's. Unchanged.
--   - the account capture of a Path B record
--     (private.export_account_ordinary_readable_authority_v1): reached only
--     for records whose subject_account_id is the exporting account, so only
--     by the person (their export of the record and of their whole account,
--     and every copy's currency check). It asks the confirmation as the
--     uploader's account made it.
--   - the Path B source authority (private.path_b_normalization_authority_v1):
--     a held file's confirmed source, with no reader in it. Every saved
--     result, of either side, reaches it through two readers that know whose
--     it is: the read decision (private.path_b_result_read_v1: the reader's
--     mitigation decision is 'subject-own-right-only' exactly when the reader
--     is the person, 'allow' only for the uploader) and the report authority
--     (private.path_b_report_authority_v1: the grant's direction is 'self'
--     for the person's own layer, 'subject_to_recipient' for a layer shared
--     with the uploader). The normalization worker and its enqueue reach it
--     with no reader.
--
-- Here:
--   1. private.path_b_confirmation_v1 is the record's confirmation: what
--      private.path_b_subject_v1 answers, line for line, without the
--      retention clause (a confirmed draft of either flow, each with its own
--      evidence, as 20261122180000 reads it everywhere else).
--   2. The capture and the source authority ask it instead of the uploader's
--      read, so the person's export and their own saved results (and the
--      source those need) no longer end with the document's retention.
--   3. The read decision and the report authority ask the uploader's read
--      itself for any reader other than the person and any layer other than
--      the person's own, at the point where the source authority used to ask
--      it, so every uploader path requires exactly what it required before:
--      its saved results, its shares' read gates, its one-record Copilot (it
--      asks the read decision) and every report of a layer shared with it
--      stop when the document's retention ends, with the answers they gave
--      before; its uploads and its upload list are unchanged.
-- An e-signature record answers exactly as before: for it the two reads are
-- the same. Before the document's retention ends nothing changes for either
-- side. After a transfer the record is read through the transferred helpers
-- (20261122160000), which never asked either read.
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise); the helper is new and
-- callable by no API role; a postflight asserts the four successors, the
-- helper and every pinned body.

do $predecessor$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   -- The four bodies patched below, as 20261120120000, 20261016221000,
   -- 20260930234000 and 20261122180000 left them.
   ('private.path_b_normalization_authority_v1(uuid,text)','591fc9f913fb7177ed86144a7ce654f4','{postgres=X/postgres}'),
   ('private.path_b_result_read_v1(uuid,uuid,text)','d39c35dab17636d453a18f41bde4ede4','{postgres=X/postgres}'),
   ('private.path_b_report_authority_v1(uuid,uuid,text)','a77b3f10be091726b10930ba06b82680','{postgres=X/postgres}'),
   ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','5c9fee7018806a025ad537664cd23b69','{postgres=X/postgres}'),
   -- The uploader's confirmation read, which the helper restates without its
   -- retention clause, and what that clause asks (20261016190000, unchanged).
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_reviewed_document_retained_v1(uuid)','a8e15740ad618a999aa73a1c9f909817','{postgres=X/postgres}'),
   ('private.permission_document_live_v1(private.permission_documents)','39de6ef674864bbcd2283003f72c0625','{postgres=X/postgres}'),
   -- Its three other callers, which keep asking it (unchanged): the
   -- uploader's held upload and finalization, and the public appeal.
   ('private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)','b8e13301350522ce9933d646c273d421','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)','50b661f2167a28ba458a5153bb71ace3','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>10
  -- No other body asks the uploader's confirmation read.
  or array(select p.oid from pg_proc p where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\('
    and p.oid<>'private.path_b_subject_v1(uuid,uuid)'::regprocedure order by p.oid)
   is distinct from array(select x::regprocedure::oid from unnest(array[
    'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)',
    'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)',
    'private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)',
    'private.path_b_normalization_authority_v1(uuid,text)',
    'private.public_appeal_provisional_binding_v1(uuid)']) x order by 1)
  or to_regprocedure('private.path_b_confirmation_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='reviewed document person access prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The record's confirmation ---------------------------------------------------------------
-- What private.path_b_subject_v1 answers, line for line, without its
-- retention clause: the uploader-owned, active record; its confirmed draft
-- of either Path B flow, each with its own evidence; the one current
-- confirmation principal, its current contact and its confirmation signature.
create function private.path_b_confirmation_v1(p_account_id uuid, p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','private' as $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_signature uuid;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'active' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;
 -- path-b-only: a Path A subject never has a confirmed Path B draft.
 select * into d from public.adult_subject_drafts where subject_id=s.id and owner_account_id=p_account_id
  -- 20261122190000 (D-166): either Path B flow, each with its own evidence; the
  -- approved document's retention is the uploader's (private.path_b_subject_v1).
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'))
  and state='confirmed' for share;
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- 20260930210000: the one confirmation principal is either the person with no
 -- account (subject_account_id null) or the person's own account.
 select * into p from public.subject_principals where subject_id=s.id and status='active'
  and ((principal_kind='non_account_subject' and account_id is null and s.subject_account_id is null)
   or (principal_kind='account_subject' and account_id=s.subject_account_id)) for share;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for share;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select cs.id into v_signature from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=p.id and cs.signer_account_id is not distinct from p.account_id
  and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision
  and ca.artifact_key='consent.subject-adult-esignature'
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1;
 if v_signature is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,
  'subjectLifecycleRevision',s.lifecycle_revision,'principalId',p.id,'principalRevision',p.principal_revision,
  'contactReferenceId',e.id,'confirmationSignatureId',v_signature);
end;
$function$;
revoke all on function private.path_b_confirmation_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2 and 3. Bodies patched in place -------------------------------------------------------------
do $patch_access$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- The Path B source authority: the record's confirmation, with no reader in it.
  (1,'private.path_b_normalization_authority_v1(uuid,text)','591fc9f913fb7177ed86144a7ce654f4',
   'b08c6d4602197f532a3d578eebff4c6b','{postgres=X/postgres}',
   $old$ t:=private.path_b_subject_v1(h.uploader_account_id,h.subject_id);
$old$,
   $new$ -- 20261122190000 (D-166): the record's confirmation, which a reviewed-document record keeps after
 -- its approved document's retention ends; the read decision and the report authority still ask the
 -- uploader's own for the uploader.
 t:=private.path_b_confirmation_v1(h.uploader_account_id,h.subject_id);
$new$,
   'source authority'),
  -- The read decision: a reader other than the person is the uploader.
  (2,'private.path_b_result_read_v1(uuid,uuid,text)','d39c35dab17636d453a18f41bde4ede4',
   'e165f72a2ea253503f0f433284b8a3dd','{postgres=X/postgres}',
   $old$   if private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')=c->'authority' then
$old$,
   $new$   if private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')=c->'authority' then
    -- 20261122190000 (D-166): any reader but the person (the uploader) still needs the uploader's
    -- confirmation read, which for a reviewed-document record needs its approved document retained.
    if m->>'decision' is distinct from 'subject-own-right-only' then
     perform private.path_b_subject_v1(p_account_id,p_subject_id); end if;
$new$,
   'read decision'),
  -- The report authority: a layer other than the person's own is the uploader's.
  (3,'private.path_b_report_authority_v1(uuid,uuid,text)','a77b3f10be091726b10930ba06b82680',
   '689beb777fa9a4d1356e3689f9576eff','{postgres=X/postgres}',
   $old$ c:=private.path_b_person_v1(s.subject_account_id,g.path_b_originating_session_id,s.id);
$old$,
   $new$ -- 20261122190000 (D-166): any layer but the person's own (one shared with the uploader) still needs the
 -- uploader's confirmation read, which for a reviewed-document record needs its approved document retained.
 if d.direction is distinct from 'self' then perform private.path_b_subject_v1(s.owner_account_id,s.id); end if;
 c:=private.path_b_person_v1(s.subject_account_id,g.path_b_originating_session_id,s.id);
$new$,
   'report authority'),
  -- The person's capture of the record, alone or in their whole account.
  (4,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','5c9fee7018806a025ad537664cd23b69',
   '2fb0181f5c393cf7283cb9e33704789a','{postgres=X/postgres}',
   $old$    confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);
$old$,
   $new$    -- 20261122190000 (D-166): the record's confirmation, which the person keeps after a
    -- reviewed-document record's approved document is no longer retained.
    confirmation:=private.path_b_confirmation_v1(s.owner_account_id,s.id);
$new$,
   'person capture')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl,p.provolatile,p.proowner into definition,before_acl,before_volatile,before_owner
   from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_access$;

-- Postflight: the four patched bodies and the helper as written, each with
-- its ACL; every pinned body unchanged; the uploader's confirmation read
-- asked only by its three unchanged callers and the two uploader gates.
do $postflight$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   ('private.path_b_normalization_authority_v1(uuid,text)','b08c6d4602197f532a3d578eebff4c6b','{postgres=X/postgres}'),
   ('private.path_b_result_read_v1(uuid,uuid,text)','e165f72a2ea253503f0f433284b8a3dd','{postgres=X/postgres}'),
   ('private.path_b_report_authority_v1(uuid,uuid,text)','689beb777fa9a4d1356e3689f9576eff','{postgres=X/postgres}'),
   ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','2fb0181f5c393cf7283cb9e33704789a','{postgres=X/postgres}'),
   ('private.path_b_confirmation_v1(uuid,uuid)','87d1170f0ed36bd81845c4cbfd1ac622','{postgres=X/postgres}'),
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.path_b_reviewed_document_retained_v1(uuid)','a8e15740ad618a999aa73a1c9f909817','{postgres=X/postgres}'),
   ('private.permission_document_live_v1(private.permission_documents)','39de6ef674864bbcd2283003f72c0625','{postgres=X/postgres}'),
   ('private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)','b8e13301350522ce9933d646c273d421','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)','50b661f2167a28ba458a5153bb71ace3','{postgres=X/postgres,service_role=X/postgres}'),
   ('private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>11
  or not exists(select 1 from pg_proc p where p.oid='private.path_b_confirmation_v1(uuid,uuid)'::regprocedure
   and p.prosecdef and p.provolatile='v' and p.proowner='postgres'::regrole
   and p.proconfig=array['search_path=pg_catalog, private']::text[])
  or array(select p.oid from pg_proc p where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\('
    and p.oid<>'private.path_b_subject_v1(uuid,uuid)'::regprocedure order by p.oid)
   is distinct from array(select x::regprocedure::oid from unnest(array[
    'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)',
    'private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)',
    'private.path_b_report_authority_v1(uuid,uuid,text)',
    'private.path_b_result_read_v1(uuid,uuid,text)',
    'private.public_appeal_provisional_binding_v1(uuid)']) x order by 1) then
  raise exception using errcode='55000',message='reviewed document person access successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
