-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Both Path B flows are reached only under the test
-- jurisdiction: every real jurisdiction is unreviewed for the capabilities
-- that create an adult-subject invitation, so in production no Path B record
-- exists and nothing patched here is reachable. It follows 20261009224500
-- (the public appeal's resolution it patches), 20261016190000 (the
-- reviewed-document flow and the uploader's confirmation read),
-- 20261122180000 (the resolution as patched there) and 20261122190000 (the
-- record's confirmation it asks); it goes into release 4 after
-- 20261122190000.
-- =====================================================================
--
-- D-166 (docs/protocol/defects.md), owner decision of 22 November 2026, "A
-- person keeps their own access after the approved document's retention
-- ends (D-166)" (docs/protocol/decisions.md): only the uploader's access to
-- a path-b-reviewed-document record depends on the approved document still
-- being retained. 20261122190000 split the uploader's confirmation read
-- (private.path_b_subject_v1, which requires that document still retained)
-- from the record's confirmation (private.path_b_confirmation_v1, the same
-- read without that clause) for the person's own saved results and exports,
-- and left the public appeal's resolution of a subject objection
-- (private.public_appeal_provisional_binding_v1) asking the uploader's read.
--
-- That resolution matches a subject objection, by the case's verified
-- contact, to the one record whose current confirmation contact it is, and
-- holds that record provisionally while a named reviewer reviews the case.
-- It is the person's protective right over a record made about them, not the
-- uploader's access. Asking the uploader's read made it refuse a
-- reviewed-document record once the approved document was no longer
-- retained, so an objection from the person's own contact went to the
-- reviewer as an unresolved match and held nothing, while an e-signature
-- record's objection still resolved and held it.
--
-- Here, one line: the resolution's recheck of a Path B record's confirmed
-- binding asks the record's confirmation instead. It compares the same three
-- answers (the confirmation principal, its contact and its signature), which
-- the two reads give alike for every record either one answers; nothing else
-- in the body changes. An e-signature record, and a reviewed-document record
-- whose document is still retained, resolve exactly as before. The uploader's
-- confirmation read keeps its four other callers (the uploader's held upload
-- and finalization, and the two gates 20261122190000 added), unchanged.
--
-- The body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor, the successor md5 and unchanged ACL,
-- volatility and owner asserted (55000 otherwise); a postflight asserts the
-- successor, the two reads unchanged, and who asks each of them.

do $predecessor$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   -- The resolution, as 20261122180000 left it.
   ('private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}'),
   -- The record's confirmation it will ask, as 20261122190000 created it, and
   -- the uploader's confirmation read it stops asking (20261016190000).
   ('private.path_b_confirmation_v1(uuid,uuid)','87d1170f0ed36bd81845c4cbfd1ac622','{postgres=X/postgres}'),
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>3
  -- The uploader's confirmation read: asked by the uploader's two doors, the
  -- two gates and the resolution, as 20261122190000 left it (each name has one
  -- function).
  or (select string_agg(n.nspname||'.'||p.proname,',' order by n.nspname,p.proname) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\(' and p.oid<>'private.path_b_subject_v1(uuid,uuid)'::regprocedure)
   is distinct from 'private.complete_own_upload_finalization_v1,private.other_adult_upload_store_authority_v1,'
    ||'private.path_b_report_authority_v1,private.path_b_result_read_v1,private.public_appeal_provisional_binding_v1' then
  raise exception using errcode='55000',message='reviewed document person appeal prerequisite differs'; end if;
end;
$predecessor$;

do $patch_appeal$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- The resolution's recheck of a Path B record's confirmed binding.
  (1,'private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4',
   '48f544b2fbec8084fc24913ef173dd01','{postgres=X/postgres}',
   $old$      confirmed_binding:=private.path_b_subject_v1(subject_row.owner_account_id,subject_row.id);
$old$,
   $new$      -- 20261122200000 (D-166): the record's confirmation, which the person's objection keeps after a
      -- reviewed-document record's approved document is no longer retained.
      confirmed_binding:=private.path_b_confirmation_v1(subject_row.owner_account_id,subject_row.id);
$new$,
   'appeal binding confirmation')
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
$patch_appeal$;

-- Postflight: the patched body as written, the two reads unchanged, the
-- uploader's read asked only by the uploader's doors and the two gates, and
-- the record's confirmation by the source authority, the capture and the
-- resolution.
do $postflight$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
   ('private.public_appeal_provisional_binding_v1(uuid)','48f544b2fbec8084fc24913ef173dd01','{postgres=X/postgres}'),
   ('private.path_b_confirmation_v1(uuid,uuid)','87d1170f0ed36bd81845c4cbfd1ac622','{postgres=X/postgres}'),
   ('private.path_b_subject_v1(uuid,uuid)','d174a83682e35479797ac7e738a65d79','{postgres=X/postgres,service_role=X/postgres}')
  ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
   and p.proacl::text=x.acl)<>3
  or (select string_agg(n.nspname||'.'||p.proname,',' order by n.nspname,p.proname) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\(' and p.oid<>'private.path_b_subject_v1(uuid,uuid)'::regprocedure)
   is distinct from 'private.complete_own_upload_finalization_v1,private.other_adult_upload_store_authority_v1,'
    ||'private.path_b_report_authority_v1,private.path_b_result_read_v1'
  or (select string_agg(n.nspname||'.'||p.proname,',' order by n.nspname,p.proname) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prosrc ~ '[^a-z_]path_b_confirmation_v1\s*\(' and p.oid<>'private.path_b_confirmation_v1(uuid,uuid)'::regprocedure)
   is distinct from 'private.export_account_ordinary_readable_authority_v1,private.path_b_normalization_authority_v1,'
    ||'private.public_appeal_provisional_binding_v1' then
  raise exception using errcode='55000',message='reviewed document person appeal successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
