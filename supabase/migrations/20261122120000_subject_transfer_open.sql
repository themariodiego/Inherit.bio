-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It opens the record transfer, which reaches only Path B
-- records, and Path B is TEST-LOCAL only: in production no such record can
-- exist, so nothing it opens is reachable there. It follows 20261016221000
-- (the switch it replaces and the transfer behind it) and 20261122100000
-- (the second act, the notices and the bodies it pins); it goes into a
-- release after both.
-- =====================================================================
--
-- Owner decision of 22 November 2026, "The transfer notices are approved,
-- with one added line, and the transfer is switched on"
-- (docs/protocol/decisions.md): the notices and the uploader's hand-over
-- card worded in docs/evidence/uploader-hand-over-20261122/transfer-wording.md
-- are approved, the two emails to the person who now holds the record gain
-- one line (an app string: the queue carries only each notice's kind), and
-- one guarded migration opens the transfer for both acts, with these
-- notices.
--
-- private.subject_transfer_open_v1() is the transfer's one switch
-- (20261016221000) and answered false: the 2026-10-22 rule held the door
-- closed until the contract's three notices had approved wording. Here its
-- body, and nothing else, is replaced by one answering true. That one change
-- opens both acts at once:
--   - the person's own "move this record into my account"
--     (api.subject-transfer, public.transfer_subject_v1);
--   - the uploader's withdrawal of its permission for a record the person
--     holds with their own account (api.subject-delete,
--     public.withdraw_other_adult_upload_v1), which hands the record to the
--     person through the same transfer, and the page's read
--     (public.other_adult_withdrawal_readiness_v1), which answers 'hand-over'.
-- Every body the open transfer runs is pinned below exactly as
-- 20261122100000 (or the migration that last defined it) left it; if any
-- differs, nothing is changed and the migration refuses loudly. The ACL,
-- IMMUTABLE and the empty search_path of the switch are kept.

do $predecessor$
begin
 -- The switch, still closed, exactly as 20261016221000 made it.
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.subject_transfer_open_v1()')
   and md5(pg_get_functiondef(p.oid))='c4b160e966711cf513e267673c4b5e2f' and p.proacl::text='{postgres=X/postgres}'
   and p.provolatile='i' and not p.prosecdef and p.proconfig=array['search_path=""']::text[])
  or private.subject_transfer_open_v1()
  -- The two doors, the read, the transfer and its notice queue, as 20261122100000 left them.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='0fb41099ef95025c011084190ed1555f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='c00c31ee8ba5848c95ea4b2384d07e61'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.other_adult_withdrawal_readiness_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='29f041df82ed5defc7d4cc48fcb12e0f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='e481de5f5eab53b6c596da66bc7b30fa' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])')
   and md5(pg_get_functiondef(p.oid))='341a5dcd5f5d4dd8592efe4d4cc487eb' and p.proacl::text='{postgres=X/postgres}')
  -- The notice kinds as 20261122100000 widened them; the queue's insert
  -- trigger, its account recipient check and the terminal mail worker's two
  -- doors that send them.
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from '13f8b2c8222dfff225325f6b0bb152c5'
  or not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where t.tgrelid='private.invitation_terminal_notices'::regclass and t.tgname='enqueue_invitation_terminal_notice'
    and t.tgenabled='O' and p.pronamespace='private'::regnamespace and p.proname='enqueue_invitation_terminal_notice_v1'
    and md5(pg_get_functiondef(p.oid))='689008df933e852391c20f6e8b3afd4a')
  or not exists(select 1 from pg_proc p where p.pronamespace='private'::regnamespace
   and p.proname='invitation_notice_recipient_current_v1' and md5(pg_get_functiondef(p.oid))='e0728613189f2cbdfa05029c962767a5')
  or not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='claim_invitation_terminal_mail_v1'
   and md5(pg_get_functiondef(p.oid))='3524eba4d0dd916bef2c4dac1e5c25cb'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='authorize_invitation_terminal_mail_v1'
   and md5(pg_get_functiondef(p.oid))='5ba9fd2ef4bfa2c36ec0e2be4b97aeb5'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- What the transfer calls: the export cleanup door, the held-upload ending,
  -- the audit attribution and the shared purge of turns that read the record.
  or not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='export_archive_cleanup_v1'
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.end_other_adult_held_upload_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='0d5e9e5784297e1a1cb77aacfbe54a43' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.legal_audit_actor_principal_v1(text,text)')
   and md5(pg_get_functiondef(p.oid))='7d74f4fc739c03a14c928b5c529ca83a' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.pronamespace='private'::regnamespace and p.proname='delete_pair_derived_rows_v1'
   and md5(pg_get_functiondef(p.oid))='8a094ce1d0a7ff92e00260204008dc07'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The relocation worker's six doors, which move each transferred file to a
  -- key of its own, as 20261016221000 made them.
  or (select count(*) from pg_proc p join (values
    ('subject_transfer_relocation_work_v1','b41281a0b8093cb6b08088d43b024404'),
    ('claim_subject_transfer_relocation_v1','b372f540becd7d760fefcc31b36338d6'),
    ('swap_subject_transfer_relocation_v1','bc2a13cbc7522274795eba64ac24c87d'),
    ('fence_subject_transfer_relocation_v1','df65b2547b006b73029821bed37eaf63'),
    ('claim_subject_transfer_retirement_v1','cfc2104768e444abd345e714a148d3d3'),
    ('finish_subject_transfer_retirement_v1','dba5d0a0e592ff7d34d38dc2ff11c566')) x(name,body)
   on p.pronamespace='public'::regnamespace and p.proname=x.name and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')<>6 then
  raise exception using errcode='55000',message='subject transfer open prerequisite differs'; end if;
end;
$predecessor$;

-- The switch. Same signature, IMMUTABLE, empty search_path; create or
-- replace keeps its ACL ({postgres=X/postgres}: no API role may call it).
create or replace function private.subject_transfer_open_v1()
returns boolean language sql immutable set search_path='' as $$ select true $$;

-- Postflight: the switch answers true with exactly this body and its ACL,
-- and every body it opens is still the one pinned above.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.subject_transfer_open_v1()'::regprocedure
   and md5(pg_get_functiondef(p.oid))='8d2e22d1e0c41c8bce0e43b9e45378d3' and p.proacl::text='{postgres=X/postgres}'
   and p.provolatile='i' and not p.prosecdef and p.proconfig=array['search_path=""']::text[])
  or private.subject_transfer_open_v1() is not true
  or not exists(select 1 from pg_proc p where p.oid='public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='0fb41099ef95025c011084190ed1555f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='c00c31ee8ba5848c95ea4b2384d07e61'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.other_adult_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='29f041df82ed5defc7d4cc48fcb12e0f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='e481de5f5eab53b6c596da66bc7b30fa' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])'::regprocedure
   and md5(pg_get_functiondef(p.oid))='341a5dcd5f5d4dd8592efe4d4cc487eb' and p.proacl::text='{postgres=X/postgres}') then
  raise exception using errcode='55000',message='subject transfer open successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
