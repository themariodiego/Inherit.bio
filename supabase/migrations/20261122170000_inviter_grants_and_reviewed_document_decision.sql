-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path A's own-account acceptance and both Path B flows
-- are reached only under the test jurisdiction: every real jurisdiction is
-- unreviewed for the capabilities that create an adult-subject invitation, so
-- in production no acceptance clock exists, no inviter is held and no Path B
-- record reaches the decision patched here. It follows 20261001029000 (the
-- class projection it patches), 20261016190000 (the reviewed-document flow and
-- Path B's account core), 20261120120000 (the decision it patches and the
-- clocks it reads), 20261122110000 (the question it asks) and 20261122140000
-- (the archive it completes).
-- =====================================================================
--
-- Two changes of 22 November 2026, each patched in place:
--
--   1. D-156, owner decision of 22 November 2026, "The 72-hour hold covers an
--      inviter's reads of the invited adult's own record"
--      (docs/protocol/decisions.md): during either window the inviter sees
--      nothing the adult shares with them. 20261122140000 held the account
--      archive's recipient branch, but the inviter's own class of grants
--      received (directional_grants) still listed the adult's grants to them,
--      with their ids, revisions, status and times, while the Family
--      permissions page shows them as Off.
--      private.export_account_class_projection_v1's directional_grants branch
--      now leaves out a grant whose record the reading account is held from,
--      asking private.adult_acceptance_inviter_held_v1 (unchanged), so that
--      class reads for the held inviter exactly as with no grant. Every other
--      class, and that class for every account the question does not hold,
--      is byte for byte what it was. Its callers (the account class
--      inventory, the legacy classes, the complete archive's source and class
--      rows, the subject class projection and the scoped class projection)
--      are unchanged and inherit it. The preserved account export (the native
--      archive off) reads nothing another account shares and still refuses
--      any account that holds a live recipient grant, as before.
--   2. D-154: private.other_adult_mitigation_before_public_appeal_v1 found a
--      Path B acceptance only through a confirmed path-b-subject-esignature
--      draft, so a record made from a reviewed permission document
--      (path-b-reviewed-document, 20261016190000) answered not-found to its
--      uploader and to its person at every checkpoint, although the original
--      download authority and the account export gate treat it as Path B.
--      Its account acceptances already record their origin and start both
--      clocks (private.confirm_path_b_subject_account_core_v1 starts them for
--      both flows, pinned below). The lookup now takes a confirmed draft of
--      either Path B flow, so a reviewed-document record gets the same
--      decision as an e-signature record: the hold, the re-notice, the
--      release and the no-account rules, and the person's own rights.
--
-- Every body is patched in place under the md5-guarded convention: the exact
-- predecessor md5 and ACL, one anchor each, the successor md5 and unchanged
-- ACL, volatility and owner asserted (55000 otherwise).

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_account_class_projection_v1(uuid,uuid[],text)')
   and md5(pg_get_functiondef(p.oid))='d729235af961ceaf364b7127a00a89cb' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)')
   and md5(pg_get_functiondef(p.oid))='91dfb6e4abf766e3da6e5827d4381daf' and p.proacl::text='{postgres=X/postgres}')
  -- The question as 20261122110000 left it, and the clocks as 20261120120000 left them.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='bd8cde3a947a35f7ae07d24175418515' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.adult_acceptance_clock_state_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='6f566115c807f64e1c2a9413f2669fe1' and p.proacl::text='{postgres=X/postgres}')
  -- Path B's account branch, which starts both clocks for both flows.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)')
   and md5(pg_get_functiondef(p.oid))='63c6c510a724cbe747af5db354cb344b' and p.proacl::text='{postgres=X/postgres}')
  -- The draft table allows exactly Path A and the two Path B flows (20261016190000).
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
   where c.conrelid='public.adult_subject_drafts'::regclass and c.conname='adult_subject_drafts_adult_flow_check'
    and c.contype='c' and c.convalidated) is distinct from '5c8b24f18ac62ac45cd1c1647bdd2466' then
  raise exception using errcode='55000',message='inviter grants and reviewed document decision prerequisite differs'; end if;
end;
$predecessor$;

do $patch_grants_and_decision$
declare item record;definition text;before_acl aclitem[];before_volatile "char";before_owner oid;
begin
 for item in select * from (values
  -- The class of grants an account received: not the held adult's.
  (1,'private.export_account_class_projection_v1(uuid,uuid[],text)','d729235af961ceaf364b7127a00a89cb',
   'f90fe19ebd711a84f020556cbb46373b','{postgres=X/postgres}',
   $old$   where d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account)
   order by d.grant_id;
$old$,
   $new$   where (d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account))
    -- 20261122170000 (D-156): a grant from an adult whose inviter is this
    -- account, while its acceptance hold or a due reminder stands, is not
    -- listed, exactly as with no grant.
    and not(g.target_kind='subject' and private.adult_acceptance_inviter_held_v1(p_account,g.target_id))
   order by d.grant_id;
$new$,
   'class of grants received'),
  -- The decision's Path B lookup: both flows.
  (2,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','91dfb6e4abf766e3da6e5827d4381daf',
   '85be478145319e0c69dad7575e262941','{postgres=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122170000 (D-154): a confirmed draft of either Path B flow, as the
  -- original download authority and the account export gate read them.
  join public.adult_subject_drafts d on d.subject_id=i.target_id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'mitigation decision')
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
$patch_grants_and_decision$;
