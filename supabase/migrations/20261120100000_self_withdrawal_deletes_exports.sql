-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261016181000, whose self emptying and
-- per-file guard it patches, 20260923123240, whose export cleanup door the
-- emptying now calls, and 20261119150000, which pinned both bodies at its
-- time and added the readiness read patched here. It goes into a release
-- after all three, and never ahead of 20261119150000: that migration's
-- predecessor block would then refuse, and this one refuses without the
-- read it patches.
-- =====================================================================
--
-- D-144 (docs/protocol/defects.md): a saved export of a person's own record
-- blocked the withdrawal of their upload consent for good. The self
-- emptying of api.subject-delete (private.empty_self_subject_v1) refused
-- with subject_delete_unsupported_graph whenever any public.generated_exports
-- row targeted the record, whatever its status, so a person who had ever
-- made a one-record export could never withdraw or empty their record. The
-- brief (section 2.7) says revoking the class artifact deletes every export
-- artifact for that record; export.generated-artifact-24h (docs/retention.md)
-- says an export never outlives an earlier subject deletion.
--
-- An export cannot simply be deleted: once an archive attempt has reserved
-- an object, its segments and reservations are kept by design and
-- private.guard_export_archive_delete_v1 refuses the row's deletion
-- (export_cleanup_incomplete) even after disposal. So the emptying now ends
-- every export of the record the way the export system itself retires one,
-- through public.export_archive_cleanup_v1('stop'), the transition the
-- cleanup sweep makes before the disposal runner removes an attempt's
-- objects, and revokes it as the subject transfer revokes a record's
-- exports. Three bodies change in five patches in place, each md5-guarded
-- with its reviewed ACL, one anchor per patch, successor md5 and unchanged
-- ACL asserted (55000 otherwise):
--
--   1-3. private.empty_self_subject_v1. The export clause leaves the
--      subject_delete_unsupported_graph refusal; the two other causes (a
--      file another account holds on the record, a file tied to embryo
--      records) stay. Before the files are prepared, every export of the
--      record is locked; each of its attempts that still holds or is
--      writing objects is stopped through the cleanup door (its objects are
--      queued for disposal behind the attempt's own late-write fence, its
--      download sessions are revoked, a worker building it is refused at
--      its next step); then every export of the record is revoked, whatever
--      its status was. Any download session of the public table bound to
--      one of the record's exports is revoked too, as the subject transfer
--      does. The audit event and its payload are unchanged.
--   4. private.prepare_genome_file_deletion_body_v1, the per-file guard the
--      emptying calls for each file and that every finish of a file
--      deletion calls again. It refused file_delete_shared_graph on any
--      export of the record, so with the emptying fixed the files it
--      prepared could never be finished. An export the emptying has retired
--      (revoked, with no attempt still holding or writing objects) no
--      longer holds the file; every other export still does. Nothing but
--      the emptying revokes an export of a self record, so api.file-delete,
--      which shares the guard, refuses exactly as before on every record
--      that has not been emptied.
--   5. public.self_subject_withdrawal_readiness_v1. The page's read drops
--      the same export clause from 'unsupported', so a record whose only
--      obstacle was an export reads 'ready'.
--
-- No table, column, constraint, trigger, grant, audit event or wording
-- changes; no function is created. public.export_archive_cleanup_v1 is
-- pinned, not changed.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='85a9ab8159fa7e5bfb18deada62c1215' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepare_genome_file_deletion_body_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='e9f3f4692f0c6d10f6827410db8a0102' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.self_subject_withdrawal_readiness_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='81917a7dcc51887ab4cb06735cfca1a1'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The cleanup door as 20260923123240 left it: 'stop' moves an attempt to
  -- cleanup_pending, revokes its downloads and fails its export if active.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)')
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or to_regclass('private.export_archive_attempts') is null or to_regclass('private.export_archive_jobs') is null then
  raise exception using errcode='55000',message='self withdrawal export prerequisite differs'; end if;
end;
$predecessor$;

do $patch_d144$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'private.empty_self_subject_v1(uuid,uuid)','85a9ab8159fa7e5bfb18deada62c1215',
   'f524d4d33597e3938d9922f40ed3a115','{postgres=X/postgres}',
   $old$ v_file uuid; v_target jsonb; v_job uuid; v_prepared uuid[]:='{}'::uuid[]; n_grants integer; n_chats integer;
begin$old$,
   $new$ v_file uuid; v_target jsonb; v_job uuid; v_prepared uuid[]:='{}'::uuid[]; n_grants integer; n_chats integer;
 v_exports uuid[]; v_attempt record;
begin$new$,
   'self emptying declarations'),
  (2,'private.empty_self_subject_v1(uuid,uuid)','f524d4d33597e3938d9922f40ed3a115',
   '022d38406f5ff240d32cdd460ebc4e96','{postgres=X/postgres}',
   $old$ perform 1 from public.genome_files where id=any(v_files) order by id for update;
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id)
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then$old$,
   $new$ perform 1 from public.genome_files where id=any(v_files) order by id for update;
 -- 20261120100000 (D-144): an export of the record no longer refuses; every
 -- export of it ends below, before the files, with its stored objects.
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then$new$,
   'self emptying refusal'),
  (3,'private.empty_self_subject_v1(uuid,uuid)','022d38406f5ff240d32cdd460ebc4e96',
   '5c35b1a9eafbfe7fd3e16f54b648dee7','{postgres=X/postgres}',
   $old$ update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;
$old$,
   $new$ update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;
 -- 20261120100000 (D-144): every export of the record ends with it. Each
 -- attempt that still holds or is writing objects is stopped through the
 -- export cleanup door, the transition the cleanup sweep makes (objects
 -- queued for disposal behind the attempt's write fence, its downloads
 -- revoked, a building worker refused at its next step); then every export
 -- of the record is revoked, as the subject transfer revokes a record's
 -- exports. The stop has cleared a ready export's completion, so the
 -- revoked row stays representable. Nothing is deleted: the export design
 -- keeps every row, segment and reservation.
 v_exports:=array(select e.id from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id order by e.id);
 perform 1 from public.generated_exports where id=any(v_exports) order by id for update;
 for v_attempt in select a.export_id,a.id from private.export_archive_attempts a
  where a.export_id=any(v_exports) and a.state in ('writing','bytes_complete') order by a.export_id,a.id loop
  perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);
 end loop;
 update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and target_kind='export' and target_id=any(v_exports);
$new$,
   'self emptying exports'),
  (4,'private.prepare_genome_file_deletion_body_v1(uuid,uuid)','e9f3f4692f0c6d10f6827410db8a0102',
   'c78d66691786e656a063b2dfe7b78a28','{postgres=X/postgres}',
   $old$    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)
$old$,
   $new$    -- 20261120100000 (D-144): an export the emptying has retired (revoked,
    -- no attempt still holding or writing objects) no longer holds the
    -- file; every other export of the record still does.
    or exists (select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
      and (e.status<>'revoked' or exists (select 1 from private.export_archive_attempts a
        where a.export_id=e.id and a.state in ('writing','bytes_complete'))))
$new$,
   'per-file guard'),
  (5,'public.self_subject_withdrawal_readiness_v1(uuid,uuid)','81917a7dcc51887ab4cb06735cfca1a1',
   '963586dade86d48a3f61d03b2403d41a','{postgres=X/postgres,service_role=X/postgres}',
   $old$ if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id)
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then
  return 'unsupported'; end if;$old$,
   $new$ -- 20261120100000 (D-144): an export of the record no longer refuses the
 -- emptying, so it no longer reads unsupported.
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then
  return 'unsupported'; end if;$new$,
   'withdrawal readiness')
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
$patch_d144$;

-- Postflight: the three patched bodies as written, the readiness read still
-- stable, the cleanup door unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.empty_self_subject_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='5c35b1a9eafbfe7fd3e16f54b648dee7' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='c78d66691786e656a063b2dfe7b78a28' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.self_subject_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='963586dade86d48a3f61d03b2403d41a' and p.prosecdef and p.provolatile='s'
   and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') then
  raise exception using errcode='55000',message='self withdrawal export successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
