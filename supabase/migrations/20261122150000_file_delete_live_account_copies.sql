-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261122130000 (D-152), whose successors of
-- the per-file guard (patched here) and the self emptying (pinned here) it
-- starts from, and the migrations that last defined the export doors it
-- pins: 20260909001117 (the own export source), 20260923123240 (the export
-- currentness check and request door) and 20261016196000 (the READY
-- delivery context). It goes into a release after all of them. It neither
-- reads nor pins what 20261122120000 or 20261122140000 change.
-- =====================================================================
--
-- D-152, follow-up (docs/protocol/defects.md), under the owner decision of
-- 22 November 2026, "Only a live download copy blocks deleting a single
-- file" (docs/protocol/decisions.md): the owner chose "A copy that is still
-- being made or can still be downloaded keeps blocking, so nothing in a live
-- download goes missing". A copy of the whole account whose parts
-- (subject_partitions) include the record is a download copy of that
-- record, but private.prepare_genome_file_deletion_body_v1 read only the
-- record's own copies (target_kind 'subject'); deleting one file then left
-- such a live copy unusable (its capture no longer matched: 55000
-- export_source_unavailable while the file awaited its finish, 42501
-- not_found after), which is what the decision forbids.
--
-- One body changes, in one patch in place, md5-guarded with its reviewed
-- ACL, one anchor, successor md5 and unchanged ACL asserted (55000
-- otherwise). The guard's export clause for the record's own copies is kept
-- word for word; a second clause follows it: a copy of the whole account
-- (target_kind 'account', target_id the account deleting the file) whose
-- parts include the record holds the file while live, by the same rule
-- 20261122130000 set for the record's own copies: with its job, before the
-- job's deadline, and queued or building (being made) or ready before its
-- expires_at (downloadable). The same doors make and serve a whole-account
-- copy as a record's (export_archive_current_v1 at every step, poll, open
-- and chunk read; export_archive_request_v1 'open-ready'; the READY delivery
-- context, whose job scope admits account-export-v1), each pinned here. A
-- copy whose parts do not include the record, one of another account, and
-- an expired, failed, revoked or purged one, does not block. The refusal is
-- the existing file_delete_shared_graph (the route's 409
-- file_delete_subject_unavailable); no wording changes.
--
-- The race is unchanged and covers these copies: creating, building,
-- completing, opening or reading a whole-account copy reaches
-- private.own_export_source_v1 for every file of every ordinary part through
-- the currentness check, and it locks the account's profile row FOR UPDATE,
-- the row the guard locks first. A copy committed first is seen by the guard
-- and, while live, refuses the deletion; once a deletion is prepared every
-- capture of the account refuses, so no whole-account copy can start while
-- the file awaits its finish, and the finish runs the guard again. No lock is
-- added or reordered.
--
-- The own-file withdrawal is not blocked by the new clause: the self
-- emptying (pinned at 20261122130000's successor) ends every whole-account
-- copy that includes the record, queued, building or ready, before it
-- prepares the files through this guard.
--
-- No table, column, constraint, trigger, grant, audit event or wording
-- changes; no function is created. The pinned bodies are not changed.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepare_genome_file_deletion_body_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='9753a5d9d38d09f6b17664826247f070' and p.proacl::text='{postgres=X/postgres}')
  -- The emptying, which ends the account's whole-account copies that
  -- include the record before it prepares the files through the guard.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='768b5433d639f9c8578fbd59a5a0d703' and p.proacl::text='{postgres=X/postgres}')
  -- What live is read from for a whole-account copy: the currentness check,
  -- the open, the READY delivery context (its header prints a table type,
  -- so its body is pinned), as their last migrations left them.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_archive_current_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='707ebdae8b497640dafeb37e666d01f6' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)')
   and md5(pg_get_functiondef(p.oid))='f22a82e34511040aab5f8b8f68f671d0'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_r2_completed_context_v1(uuid,text,boolean)')
   and md5(p.prosrc)='34ecde85fc7566b3f775ce953834a092' and p.proacl::text='{postgres=X/postgres}')
  -- What the race rests on: the source every capture reads.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.own_export_source_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='27abc582be0eb4a227a7cdeb57c29d6f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or to_regclass('private.export_archive_jobs') is null then
  raise exception using errcode='55000',message='file delete live account copies prerequisite differs'; end if;
end;
$predecessor$;

do $patch_d152b$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'private.prepare_genome_file_deletion_body_v1(uuid,uuid)','9753a5d9d38d09f6b17664826247f070',
   'da3c101a8a28000656359a91254a6643','{postgres=X/postgres}',
   $old$    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
      where e.target_kind='subject' and e.target_id=s.id and j.deadline>clock_timestamp()
      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))
$old$,
   $new$    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
      where e.target_kind='subject' and e.target_id=s.id and j.deadline>clock_timestamp()
      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))
    -- 20261122150000 (D-152, follow-up): a copy of the whole account whose
    -- parts include the record is a live download copy of the record too,
    -- by the same rule; one of another account, or whose parts do not
    -- include the record, does not hold the file.
    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
      where e.target_kind='account' and e.target_id=p_account_id and e.subject_partitions @> jsonb_build_array(s.id)
      and j.deadline>clock_timestamp()
      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))
$new$,
   'per-file guard')
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
$patch_d152b$;

-- Postflight: the patched guard as written, and every pinned body unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='da3c101a8a28000656359a91254a6643' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.empty_self_subject_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='768b5433d639f9c8578fbd59a5a0d703' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.export_archive_current_v1(uuid,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='707ebdae8b497640dafeb37e666d01f6' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='f22a82e34511040aab5f8b8f68f671d0'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.account_archive_r2_completed_context_v1(uuid,text,boolean)'::regprocedure
   and md5(p.prosrc)='34ecde85fc7566b3f775ce953834a092' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='27abc582be0eb4a227a7cdeb57c29d6f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') then
  raise exception using errcode='55000',message='file delete live account copies successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
