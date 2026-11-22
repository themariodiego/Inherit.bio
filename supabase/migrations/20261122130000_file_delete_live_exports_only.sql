-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261120100000 (D-144), whose successors of
-- the per-file guard and the self emptying it patches, and the migrations
-- that last defined the export doors it pins: 20260831224124 (the legacy
-- download authorizer), 20260909001117 (the own export source),
-- 20260923123240 (the export currentness check, request door and cleanup
-- door), 20261016196000 (the READY delivery context) and 20261016211000
-- (the claimant's open). It goes into a release after all of them. No other
-- 22 November migration patches either body or any door it pins.
-- =====================================================================
--
-- D-152 (docs/protocol/defects.md), both halves, under two owner decisions
-- of 22 November 2026 (docs/protocol/decisions.md). Two bodies change, in
-- two patches in place, each md5-guarded with its reviewed ACL, one anchor
-- per patch, successor md5 and unchanged ACL asserted (55000 otherwise).
--
-- 1. "Only a live download copy blocks deleting a single file".
-- private.prepare_genome_file_deletion_body_v1, the per-file guard
-- api.file-delete prepares and finishes every file through, refused
-- file_delete_shared_graph for good on any export of the record that the
-- self emptying had not retired (D-144), expired, failed and ended ones
-- included. Now an expired, failed or ended copy no longer blocks; a copy
-- still being made or that can still be downloaded does. Only the export
-- clause changes. The copies it reads are the ones it read before:
-- public.generated_exports rows whose target is the record (target_kind
-- 'subject'), whichever door made them (the record's own export,
-- api.subject-export, or an approved claimant's, api.future-person-export).
-- A whole-account export (target_kind 'account') was never read by the
-- guard and still is not.
--
-- 2. "Withdrawing consent for one's own file ends a finished download copy
-- too". private.empty_self_subject_v1, the self emptying the own-file
-- withdrawal runs, revoked the account's whole-account copies only while
-- queued or building, by status alone, so a finished (ready) one that
-- includes the withdrawn file stayed ready, with its download rows and its
-- stored objects, until the sweep after its deadline (its doors refused it
-- only because its capture no longer matched the record). Now every
-- whole-account copy of the account whose parts (subject_partitions)
-- include the record, queued, building or ready, ends before the files, as
-- the record's own copies end (D-144) and as D-151 ends a transferred
-- record's: each attempt still holding or writing objects is stopped
-- through public.export_archive_cleanup_v1('stop') (objects queued for
-- disposal behind the attempt's write fence, its download rows revoked, a
-- READY completion cleared, a worker refused at its next step), then the
-- copy is revoked, with any download session of the public table bound to
-- it. A copy whose parts do not include the record, and a failed or already
-- revoked one, is not touched by the new step; the queued or building
-- copies the old statement revoked by status alone still are, as before.
-- Every door that opens, polls or serves a copy then refuses it: the
-- currentness check refuses a revoked copy, the READY delivery context a
-- copy no longer ready, and the download context a revoked download row,
-- so an open download serves no further chunk. Nothing is deleted: the
-- export design keeps every row, segment and reservation, and the objects
-- go with the disposal runner, as before.
--
-- What "live" means for the guard, and the race:
--
-- Live is what the export doors still make or serve, read from their code
-- (each pinned below):
--   - private.export_archive_current_v1 runs at every worker step, poll,
--     open and chunk read. It refuses a copy with no job, in any status but
--     queued, building or ready, or once its job's deadline has passed. So
--     no copy without its job, in another status or past its deadline can
--     be made further, published, opened or served.
--   - Being made: queued or building, before the deadline.
--   - Downloadable: ready, before the deadline and before expires_at. Every
--     open refuses a copy at or past expires_at (export_archive_request_v1
--     'open-ready', private.future_person_ready_export_v1), and so does
--     every READY chunk issue and acknowledgement
--     (private.account_archive_r2_completed_context_v1, through the
--     delivery context). Completion sets expires_at no later than the
--     deadline. The legacy public.download_sessions authorizer
--     (private.download_target_authorized_v1, which no function or route
--     calls) also needs ready and expires_at ahead. A download session's
--     own expiry is never later than its copy's.
--   - Nothing makes a copy live again: failed, revoked, expired and purged
--     are left by no door (begin needs queued or building, completion needs
--     building), a job's deadline and a ready copy's expires_at are never
--     moved later, and every new copy is a new row.
--
-- The race. Every door of an account's own copies, of a record or of the
-- whole account, reaches private.own_export_source_v1 through the
-- currentness check, and it locks the account's profile row FOR UPDATE, the
-- row the guard locks FOR UPDATE first; so a copy's creation, each of its
-- steps and each of its reads are serialised with the preparation and the
-- finish of a file deletion on the same account. A copy committed before
-- the guard reads is seen by it and, while live, refuses the deletion. Once
-- a deletion is prepared, the file's stored object is queued for purge,
-- own_export_source_v1 answers null for it and every capture that meets it
-- refuses: no copy of the record or of the account can be created, built,
-- completed, opened or read while the file awaits its finish, and after the
-- finish the file is gone from every later capture. The finish runs this
-- guard again. So a copy started after the check can never include a file
-- being deleted, and the guard's reading of a copy as not live cannot be
-- overtaken: nothing turns it live again. No lock is added or reordered.
-- (An approved claimant's copy is of a record whose one file no account
-- holds, so no file of it can reach this guard.)
--
-- No table, column, constraint, trigger, grant, audit event or wording
-- changes; no function is created. The pinned doors are not changed. The
-- emptying's audit event and its payload are unchanged.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepare_genome_file_deletion_body_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='c78d66691786e656a063b2dfe7b78a28' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='5c35b1a9eafbfe7fd3e16f54b648dee7' and p.proacl::text='{postgres=X/postgres}')
  -- The cleanup door the emptying calls, as 20260923123240 left it: 'stop'
  -- moves an attempt to cleanup_pending, revokes its downloads and fails its
  -- export if active.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)')
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- What live is read from: the currentness check, the two opens, the READY
  -- delivery context and the legacy download authorizer, as their last
  -- migrations left them.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.export_archive_current_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='707ebdae8b497640dafeb37e666d01f6' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)')
   and md5(pg_get_functiondef(p.oid))='f22a82e34511040aab5f8b8f68f671d0'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- These two headers print table types, which the search path qualifies or
  -- not, so their bodies are pinned instead.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.future_person_ready_export_v1(text,uuid,text)')
   and md5(p.prosrc)='b46d1c068bf5d0121187fc76d00fee27' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.account_archive_r2_completed_context_v1(uuid,text,boolean)')
   and md5(p.prosrc)='34ecde85fc7566b3f775ce953834a092' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.download_target_authorized_v1(uuid,text,uuid,text,bigint,bigint)')
   and md5(pg_get_functiondef(p.oid))='23296f5b259f177732c47a43bf4ef20f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- What the race rests on: the source every capture reads.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.own_export_source_v1(uuid,uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='27abc582be0eb4a227a7cdeb57c29d6f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or to_regclass('private.export_archive_jobs') is null then
  raise exception using errcode='55000',message='file delete live exports prerequisite differs'; end if;
end;
$predecessor$;

do $patch_d152$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'private.prepare_genome_file_deletion_body_v1(uuid,uuid)','c78d66691786e656a063b2dfe7b78a28',
   '9753a5d9d38d09f6b17664826247f070','{postgres=X/postgres}',
   $old$    -- 20261120100000 (D-144): an export the emptying has retired (revoked,
    -- no attempt still holding or writing objects) no longer holds the
    -- file; every other export of the record still does.
    or exists (select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
      and (e.status<>'revoked' or exists (select 1 from private.export_archive_attempts a
        where a.export_id=e.id and a.state in ('writing','bytes_complete'))))
$old$,
   $new$    -- 20261122130000 (D-152, owner decision of 22 November 2026): only a
    -- live download copy of the record holds the file. Live is what the
    -- export doors still make or serve: a copy being made (queued or
    -- building) or one that can be downloaded (ready, before its expiry),
    -- each with its job and before the job's deadline, past which every step
    -- that makes, polls, opens or serves a copy refuses it. An expired,
    -- failed, revoked or purged copy, or one past its deadline, no longer
    -- holds the file.
    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id
      where e.target_kind='subject' and e.target_id=s.id and j.deadline>clock_timestamp()
      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))
$new$,
   'per-file guard'),
  (2,'private.empty_self_subject_v1(uuid,uuid)','5c35b1a9eafbfe7fd3e16f54b648dee7',
   '768b5433d639f9c8578fbd59a5a0d703','{postgres=X/postgres}',
   $old$ update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;
$old$,
   $new$ -- 20261122130000 (D-152, owner decision of 22 November 2026): every copy
 -- of the whole account whose parts include the record ends with it, a
 -- finished (ready) one as well as one queued or being built, the way the
 -- record's own copies end below: each attempt still holding or writing
 -- objects is stopped through the export cleanup door, then the copy is
 -- revoked, with any download session of the public table bound to it. A
 -- copy whose parts do not include the record is not touched by this step.
 -- v_exports holds these copies here and the record's own copies below.
 v_exports:=array(select e.id from public.generated_exports e where e.target_kind='account' and e.target_id=p_account_id
  and e.status in ('queued','building','ready') and e.subject_partitions @> jsonb_build_array(s.id) order by e.id);
 perform 1 from public.generated_exports where id=any(v_exports) order by id for update;
 for v_attempt in select a.export_id,a.id from private.export_archive_attempts a
  where a.export_id=any(v_exports) and a.state in ('writing','bytes_complete') order by a.export_id,a.id loop
  perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);
 end loop;
 update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and target_kind='export' and target_id=any(v_exports);
 update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;
$new$,
   'self emptying whole-account copies')
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
$patch_d152$;

-- Postflight: the patched guard and emptying as written, and every pinned
-- door unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='9753a5d9d38d09f6b17664826247f070' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.empty_self_subject_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='768b5433d639f9c8578fbd59a5a0d703' and p.prosecdef and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.export_archive_current_v1(uuid,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='707ebdae8b497640dafeb37e666d01f6' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='f22a82e34511040aab5f8b8f68f671d0'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.future_person_ready_export_v1(text,uuid,text)'::regprocedure
   and md5(p.prosrc)='b46d1c068bf5d0121187fc76d00fee27' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.account_archive_r2_completed_context_v1(uuid,text,boolean)'::regprocedure
   and md5(p.prosrc)='34ecde85fc7566b3f775ce953834a092' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.download_target_authorized_v1(uuid,text,uuid,text,bigint,bigint)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='23296f5b259f177732c47a43bf4ef20f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='27abc582be0eb4a227a7cdeb57c29d6f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}') then
  raise exception using errcode='55000',message='file delete live exports successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
