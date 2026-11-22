-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It patches functions that
-- 20261016196000_subject_export.sql installs or replaces, so it can only
-- follow that migration.
-- =====================================================================
--
-- api.subject-export, step two of the owner decision of 16 October 2026
-- ("Subject export with joint results: built in two steps",
-- docs/protocol/decisions.md): "The next slice adds the live-permission
-- joint-result projection and lifts that refusal." The decision on the
-- subjects endpoints the same day says "Joint results are included only while
-- each other contributor's permission is live", and the register's
-- subject-export-v1 jointArtifactProjection says a Portrait result carries
-- "the bound subject fields only" and only "while every other contributor has
-- a current covering grant".
--
--   1. A family pair no longer refuses the record. Its row was already
--      projected by the unchanged readable graph (id, revision, status,
--      created_at; both contributor subject identities withheld) and is
--      filed under the record's portrait.json.
--   2. A Portrait result naming the record as a parent is projected, not
--      refused. private.export_subject_portrait_rows_v1 returns it only
--      while private.family_portrait_authority_v1 holds for the record's
--      account and the job's own session: the pair is current, both parents'
--      exact family.portrait grants are current, neither is paused, and both
--      have acknowledged Portrait and signed in themselves. Otherwise the
--      row is omitted, as the
--      register's account contract allows ("otherwise omit-the-row"). The
--      projected row carries id, family_pair_id, kind, trait_key, result,
--      coverage, method_version, computation_revision and computed_at.
--      It never carries owner_account_id, either parent's subject id or the
--      source binding fingerprint. A result that is not a JSON object, or
--      whose text holds a UUID, refuses the whole request (0A000
--      export_class_projection_unavailable): an identifier inside a joint
--      result cannot be redacted, so it is not exported. No Portrait writer
--      ships today; the page computes Portrait live.
--   3. The class inventory of one ordinary subject reports portrait_results
--      in the new mode 'joint-results': the live rows, their membership
--      digest (the metadata convention) and the record's partition count.
--      The inventory is hashed into the authority receipt, so a grant that
--      ends, a pause that starts or a result that appears after the request
--      fails the job at its next read.
--   4. The classes door pages those rows under the 'metadata' operation with
--      kind portrait_results, for a subject job only, through
--      private.export_scoped_class_rows_v1, which hands every other kind to
--      the unchanged export_scoped_class_projection_v1.
--   5. The stated refusal (0A000 export_joint_results_pending, the route's
--      "jointResults") remains for the joint results nothing projects yet:
--      a role in an embryo cohort that is not purged (unchanged), and a
--      canonical family Copilot conversation of the record's own account with
--      at least one turn that is anchored on a pair naming the record or
--      retrieved the record's data. Before this, such a conversation was
--      covered by the pair refusal or, for a group conversation, left out of
--      the archive without a word; it now refuses instead. Legacy unverified
--      conversations stay unexported, as the owner decided on 26 September.
--
-- The whole-account export is unchanged: it still refuses while another
-- person's grant to the account is current, and still reports
-- portrait_results as an unsupported class that refuses when nonempty.
--
-- Pattern: md5-guarded in-place patches. Each predecessor is the body
-- 20261016196000_subject_export.sql installed (PR 324, 538dcee6), checked by
-- md5(pg_get_functiondef) together with its exact reviewed ACL; exactly one
-- anchor must match (the classes door has two, patched in turn); the
-- successor md5 and the unchanged ACL are asserted; any difference raises
-- 55000. Production (PR 323 read-back,
-- docs/evidence/pr323-production-apply-20261016/results/run-2026-10-22/
-- fp-4-post.json) has neither private subject function, and holds the
-- pre-subject-export bodies of the other two (export_archive_account_classes_v1
-- 359215e1fdc8d7696b63f29c190a9cf2, pre_requester
-- 173069ff8142c96996fc4d7933abc4ae), so this migration cannot apply there
-- before the PR 324 release has installed 20261016196000.
--
-- Three functions are added, all private and owner-only. No table, column,
-- grant, audit event, route or wording changes.

-- A canonical family Copilot conversation of the record's own account that
-- draws on the record: anchored on a pair naming it, or with a turn that
-- retrieved its data. No export projection carries these conversations yet.
create function private.export_subject_family_conversation_v1(p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
begin
 return p_subject is not null and exists(select 1 from public.subjects s join public.chats ch on ch.user_id=s.subject_account_id
  where s.id=p_subject and ch.scope_kind='family' and ch.legacy_unverified is false
   and exists(select 1 from public.chat_messages m where m.chat_id=ch.id)
   and (exists(select 1 from public.family_pairs fp where fp.id=ch.family_pair_id and p_subject in(fp.subject_a_id,fp.subject_b_id))
    or exists(select 1 from public.chat_messages m where m.chat_id=ch.id and p_subject=any(m.retrieved_subject_ids))));
end $function$;
revoke all on function private.export_subject_family_conversation_v1(uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- The Portrait results one ordinary subject's export may carry: those naming
-- the record as a parent while the other parent currently lets this account
-- see Portrait, projected to the record's own fields.
create function private.export_subject_portrait_rows_v1(p_origin jsonb, p_subject uuid)
returns table(projected_id uuid, projected_subject uuid, projected_row jsonb) language plpgsql security definer
set search_path = '' set lock_timeout = '250ms' set extra_float_digits = 3
as $function$
declare a uuid;sess uuid;r public.portrait_results;other uuid;counterpart uuid;authority jsonb;
begin
 if jsonb_typeof(p_origin) is distinct from 'object' or p_origin->>'kind' is distinct from 'account'
  or coalesce(p_origin->>'accountId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(p_origin->>'sessionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(p_origin->>'accountId')::uuid;sess:=(p_origin->>'sessionId')::uuid;
 if not private.export_subject_ordinary_target_v1(a,p_subject) then raise exception using errcode='42501',message='not_found';end if;
 for r in select pr.* from public.portrait_results pr where p_subject in(pr.parent_a_subject_id,pr.parent_b_subject_id)
  order by pr.id for share loop
  other:=case when r.parent_a_subject_id=p_subject then r.parent_b_subject_id else r.parent_a_subject_id end;
  counterpart:=(select s.subject_account_id from public.subjects s where s.id=other);
  if counterpart is null or counterpart=a then continue;end if;
  authority:=private.family_portrait_authority_v1(a,sess,r.family_pair_id,counterpart);
  if authority is null then continue;end if;
  -- The live pair must be exactly the result's two parents.
  if not(array[(authority#>>'{subjectA,id}')::uuid,(authority#>>'{subjectB,id}')::uuid]@>array[r.parent_a_subject_id,r.parent_b_subject_id])
   or jsonb_typeof(r.result) is distinct from 'object'
   or r.result::text~*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
   raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  projected_id:=r.id;projected_subject:=p_subject;
  projected_row:=jsonb_build_object('id',r.id,'family_pair_id',r.family_pair_id,'kind',r.kind,'trait_key',r.trait_key,
   'result',r.result,'coverage',r.coverage,'method_version',r.method_version,'computation_revision',r.computation_revision,
   'computed_at',r.computed_at);
  return next;
 end loop;
end $function$;
revoke all on function private.export_subject_portrait_rows_v1(jsonb, uuid)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- The classes door's rows: Portrait results for a subject job only, every
-- other kind exactly as before.
create function private.export_scoped_class_rows_v1(p_permit jsonb, p_subjects uuid[], p_kind text)
returns table(projected_id uuid, projected_subject uuid, projected_row jsonb) language plpgsql security definer
set search_path = '' set lock_timeout = '250ms'
as $function$
begin
 if p_kind='portrait_results' then
  if private.export_account_door_scope_v1(p_permit) is distinct from 'subject' or cardinality(p_subjects) is distinct from 1
   or p_subjects[1]::text is distinct from p_permit->>'targetId' then
   raise exception using errcode='22023',message='invalid_request';end if;
  return query select x.projected_id,x.projected_subject,x.projected_row
   from private.export_subject_portrait_rows_v1(p_permit->'origin',p_subjects[1])x;
 else
  return query select x.projected_id,x.projected_subject,x.projected_row
   from private.export_scoped_class_projection_v1(p_permit->>'targetKind',(p_permit#>>'{origin,accountId}')::uuid,p_subjects,p_kind)x;
 end if;
end $function$;
revoke all on function private.export_scoped_class_rows_v1(jsonb, uuid[], text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Guarded in-place patches, in order. Each needs its exact predecessor
-- md5(pg_get_functiondef) with exactly its reviewed ACL and exactly one
-- anchor, and must produce its exact successor with that ACL unchanged. The classes door is patched twice; the
-- second patch's predecessor is the first's successor.
do $patch_subject_export_joint$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- 5. The stated refusal covers only what nothing projects yet.
  (1,'private.export_subject_joint_results_v1(uuid)','767354cddd9908bebbf8e244a0dedb76','387df71020e0de94355ae38cc2139d91','{postgres=X/postgres}',
   $old$ return exists(select 1 from public.family_pairs p where p.status<>'purged' and p_subject in(p.subject_a_id,p.subject_b_id))
  or exists(select 1 from public.portrait_results r where p_subject in(r.parent_a_subject_id,r.parent_b_subject_id))
  or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and ($old$,
   $new$ -- 20261023100000: a family pair and a Portrait result are projected under
 -- live permission (private.export_subject_portrait_rows_v1); a live cohort
 -- role and a family conversation on the record still refuse.
 return private.export_subject_family_conversation_v1(p_subject)
  or exists(select 1 from public.embryo_cohorts c where c.status<>'purged' and ($new$,
   'subject joint results'),
  -- 3. The one-record class inventory projects Portrait results.
  (2,'private.export_subject_class_inventory_v1(uuid,jsonb)','ee769c5811458dfb4031f2c464c5256f','8eda83e8821d527d0f1985e38b893a80','{postgres=X/postgres}',
   $old$  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',$old$,
   $new$  if kind='portrait_results' then
   -- 20261023100000: live-permission joint results, with the metadata digest
   -- convention, under the job's own origin (never a caller's).
   handling:='joint-results';
   if p_capture#>>'{origin,accountId}' is distinct from p_account::text then
    raise exception using errcode='42501',message='not_found';end if;
   for item in select * from private.export_subject_portrait_rows_v1(p_capture->'origin',subjects[1]) x order by x.projected_id loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   if n>0 then counts:=jsonb_build_array(jsonb_build_object('subjectId',subjects[1],'rows',n));end if;
  elsif kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',$new$,
   'one-record class inventory'),
  -- The inventory reads the job's origin; the capture it hashes is unchanged.
  (3,'private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)','ca9b6bcefc719018f196f0d4f8e4e73f','be85c35c4d6996088bb0498856da1ff6','{postgres=X/postgres}',
   $old$else private.export_subject_class_inventory_v1((p_origin->>'accountId')::uuid,captured) end;$old$,
   $new$else private.export_subject_class_inventory_v1((p_origin->>'accountId')::uuid,captured||jsonb_build_object('origin',p_origin)) end;$new$,
   'class inventory capture'),
  -- 4. The classes door pages Portrait results for a subject job.
  (4,'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','42f4a34ba7a127e89130617a4a005a35','b4f96665cdfcecca503ad676a0c1498b','{postgres=X/postgres,service_role=X/postgres}',
   $old$'subject_control_refusal_authorities','subject_relationships','suppressions'))) then raise exception using errcode='22023',message='invalid_request';end if;$old$,
   $new$'subject_control_refusal_authorities','subject_relationships','suppressions','portrait_results'))) then raise exception using errcode='22023',message='invalid_request';end if;$new$,
   'classes door kinds'),
  (5,'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','b4f96665cdfcecca503ad676a0c1498b','577efc1f1c985d799c9e0f7391ccd0a1','{postgres=X/postgres,service_role=X/postgres}',
   $old$from private.export_scoped_class_projection_v1(permit->>'targetKind',(permit#>>'{origin,accountId}')::uuid,subjects,p_kind)$old$,
   $new$from private.export_scoped_class_rows_v1(permit,subjects,p_kind)$new$,
   'classes door rows')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_subject_export_joint$;
