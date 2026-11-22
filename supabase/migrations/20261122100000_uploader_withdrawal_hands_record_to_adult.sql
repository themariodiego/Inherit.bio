-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Nothing here opens: the branch it builds runs only
-- behind private.subject_transfer_open_v1(), which still answers false, and
-- Path B, the only way such a record exists, is TEST-LOCAL only. It follows
-- 20261016221000 (the transfer it patches and the switch it reads),
-- 20260906053451 (the terminal-notice queue the transfer's notices use),
-- 20260923123240 (the export cleanup door the transfer now calls, D-151),
-- 20261119160000 (the withdrawal door and the read it patches) and
-- 20261120120000 (the notice kinds it widens); it goes into a release after
-- all of them.
-- =====================================================================
--
-- Owner decision of 22 November 2026, "An uploader's withdrawal hands a
-- record its adult holds to that adult" (docs/protocol/decisions.md): when
-- an uploader withdraws its permission for another adult's file and that
-- adult holds the record with their own account, the withdrawal moves the
-- record and the files the adult confirmed to the adult through the existing
-- transfer rules (lifecycleDispositionContracts.subject-ownership-transfer-v1),
-- on the uploader's act; the uploader's consent ends, unconfirmed files are
-- deleted and the uploader keeps no access. The transfer is closed until its
-- three notices are worded and approved, so this branch stays refused until
-- the owner approves that wording.
--
-- BUILT CLOSED. private.subject_transfer_open_v1() is the one switch, for
-- both acts: the person's own transfer (api.subject-transfer) and now the
-- uploader's withdrawal (api.subject-delete). While it answers false the
-- withdrawal door refuses this branch exactly as before
-- (other_adult_withdrawal_account_held), the page's read still answers
-- 'account-held', and nothing changes for anyone. Everything behind it is
-- built here and tested with the switch opened inside a rolled-back
-- transaction. Nothing is mailed while it is closed: only the transfer
-- queues the notices.
--
--   1. invitation_terminal_notices_notice_kind_check gains the transfer's
--      notices, one kind per recipient and act (register notices:
--      new-subject-owner, former-owning-account,
--      every-principal-whose-access-was-revoked):
--        subject-transfer-new-owner, subject-transfer-former-owner
--          (the person's own act);
--        withdrawal-transfer-new-owner, withdrawal-transfer-former-owner
--          (the uploader's withdrawal);
--        subject-transfer-access-revoked (any other account whose access
--          ended, either act).
--      Each goes to an account recipient through the existing queue and its
--      worker, which reads the account's verified address only in its own
--      memory and rechecks the account at claim and at send, as it does for
--      every account recipient. No new queue, table or column.
--   2. private.queue_subject_transfer_notices_v1 queues them, each once per
--      transfer and recipient, bound to the request the person accepted. A
--      transfer whose new or former owner cannot be addressed is refused
--      whole.
--   3. private.transfer_subject_v1, patched in place (md5-guarded, seven
--      anchors), keeps every rule of the transfer and gains the second actor
--      case and two fixes:
--        - the uploader's withdrawal, only from the withdrawal door, which
--          names the record in the transaction-local marker
--          inherit.subject_transfer_withdrawal around its call: the caller is
--          the owning uploader, not the person; its account need not be
--          current for analysis (a withdrawal is a right, as the delete door
--          that runs the other branch requires only a live session); it
--          spends the api.subject-delete code the page rendered; every file
--          the person has not confirmed ends as 'withdrawn', exactly as the
--          uploader's withdrawal of a record no person holds ends it, and is
--          no longer a refusal; then the record and the confirmed files move
--          to the person by the transfer's unchanged steps;
--        - D-147: the uploader's upload_class consent on the record is
--          marked ended and kept, 'withdrawn' on its withdrawal and
--          'superseded' on the person's own act (one function serves both);
--        - D-151: before the record's exports are revoked, each attempt that
--          still holds or is writing objects is stopped through the export
--          cleanup door, as 20261120100000 (D-144) does, so a ready export no
--          longer makes the transfer fail;
--        - every other account's unredeemed one-record Copilot context for
--          the record ends with its conversations;
--        - the three notices are queued, and the audit event names the act
--          (on the withdrawal: api.subject-delete, outcome withdrawn,
--          attributed to the uploader as the transfer's event is).
--   4. public.withdraw_other_adult_upload_v1, patched in place: the
--      account-held branch is refused while the switch is closed, and
--      otherwise runs the transfer under the marker.
--   5. public.other_adult_withdrawal_readiness_v1, patched in place: the
--      account-held branch reads 'hand-over' only while the switch is open.
--
-- The switch itself, public.transfer_subject_v1, the relocation worker and
-- every other body are unchanged.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='3707a210e8fab9361b15a1ab6adbe8e0' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='caa3a80ce5b8c21aaafa83138575de39'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.other_adult_withdrawal_readiness_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='de43608630ccda660633c0f36626254c'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The one switch, still closed, and the person's own door that reads it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.subject_transfer_open_v1()')
   and md5(pg_get_functiondef(p.oid))='c4b160e966711cf513e267673c4b5e2f' and p.proacl::text='{postgres=X/postgres}')
  or private.subject_transfer_open_v1()
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='0fb41099ef95025c011084190ed1555f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- What the patched transfer calls: the export cleanup door as 20260923123240
  -- left it, the held-upload ending the uploader's other withdrawal uses, and
  -- the audit attribution of the transfer's event.
  or not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='export_archive_cleanup_v1'
   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.end_other_adult_held_upload_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='0d5e9e5784297e1a1cb77aacfbe54a43' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.legal_audit_actor_principal_v1(text,text)')
   and md5(pg_get_functiondef(p.oid))='7d74f4fc739c03a14c928b5c529ca83a' and p.proacl::text='{postgres=X/postgres}')
  -- The notice kinds as 20261120120000 left them, the queue's insert trigger
  -- and its account recipient check as 20261119160000 left it.
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from '1d03e86f7fe7caed9c52b9df695bb46d'
  or not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where t.tgrelid='private.invitation_terminal_notices'::regclass and t.tgname='enqueue_invitation_terminal_notice'
    and t.tgenabled='O' and p.pronamespace='private'::regnamespace and p.proname='enqueue_invitation_terminal_notice_v1'
    and md5(pg_get_functiondef(p.oid))='689008df933e852391c20f6e8b3afd4a')
  or not exists(select 1 from pg_proc p where p.pronamespace='private'::regnamespace
   and p.proname='invitation_notice_recipient_current_v1' and md5(pg_get_functiondef(p.oid))='e0728613189f2cbdfa05029c962767a5')
  or to_regprocedure('private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])') is not null then
  raise exception using errcode='55000',message='uploader withdrawal hand-over prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The transfer's notice kinds ------------------------------------------------------
alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;
alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check
 check (notice_kind in ('invitation-refused','draft-cancelled','donor-attribution-ended','upload-permission-withdrawn',
  'adult-acceptance-second-notice','adult-revocation-renotice',
  'subject-transfer-new-owner','subject-transfer-former-owner','subject-transfer-access-revoked',
  'withdrawal-transfer-new-owner','withdrawal-transfer-former-owner'));

-- 2. Queueing them ---------------------------------------------------------------------
-- Called only by the transfer, in its own transaction, after the transfer row
-- is written and every access has ended. Each notice is an account recipient
-- of the terminal-notice queue, bound to the request the person accepted (the
-- queue binds every notice to one invitation), at the authority revision of
-- the principal it names: the person's account principal on the record, the
-- uploader's own principal that sent the request, and for every other account
-- whose grant or relationship on the record ended here, its own active
-- account principal. One notice per transfer, kind and account: the key
-- names all three, and a record is transferred once.
create function private.queue_subject_transfer_notices_v1(p_transfer_id uuid,p_withdrawal boolean,p_grants uuid[],
 p_relationships uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare t private.subject_ownership_transfers%rowtype; i public.subject_invitations%rowtype; r record;
 v_new_revision bigint; v_former_revision bigint; v_now timestamptz:=clock_timestamp(); n integer:=0; m integer;
begin
 select * into t from private.subject_ownership_transfers where id=p_transfer_id and transaction_id=txid_current();
 if t.id is null or p_withdrawal is null then
  raise exception using errcode='55000',message='subject_transfer_notice_unavailable'; end if;
 select x.* into i from public.subject_invitations x where x.target_kind='subject' and x.target_id=t.subject_id
  and x.invitation_kind='adult_subject' and x.status='accepted' order by x.accepted_at desc,x.id limit 1;
 select sp.principal_revision into v_new_revision from public.subject_principals sp where sp.subject_id=t.subject_id
  and sp.account_id=t.to_account_id and sp.principal_kind='account_subject' and sp.status='active';
 select sp.principal_revision into v_former_revision from public.subject_principals sp where sp.id=i.inviter_principal_id
  and sp.account_id=t.from_account_id and sp.principal_kind='account_subject' and sp.status='active';
 if i.id is null or v_new_revision is null or v_former_revision is null then
  raise exception using errcode='55000',message='subject_transfer_notice_unavailable'; end if;
 insert into private.invitation_terminal_notices(invitation_id,notice_kind,recipient_kind,recipient_account_id,
  recipient_authority_revision,idempotency_key,created_at,expires_at)
 select i.id,x.kind,'account',x.account,x.revision,
  encode(extensions.digest(convert_to('subject-transfer-notice-v1|'||x.kind||'|'||t.id::text||'|'||x.account::text,'UTF8'),
   'sha256'),'hex'),v_now,v_now+interval '7 days'
 from (values
  (case when p_withdrawal then 'withdrawal-transfer-new-owner' else 'subject-transfer-new-owner' end,t.to_account_id,v_new_revision),
  (case when p_withdrawal then 'withdrawal-transfer-former-owner' else 'subject-transfer-former-owner' end,t.from_account_id,
   v_former_revision)) x(kind,account,revision)
 on conflict(idempotency_key) do nothing;
 get diagnostics n=row_count;
 -- Every other account whose access ended in this transfer, once.
 for r in select distinct on (a.account_id) a.account_id,sp.principal_revision from (
   select dg.recipient_account_id account_id,dg.recipient_principal_id principal_id from public.directional_grants dg
    where dg.grant_id=any(p_grants)
   union all
   select rel.recipient_account_id,rel.recipient_principal_id from public.subject_relationships rel
    where rel.id=any(p_relationships)) a
  join public.subject_principals sp on sp.account_id=a.account_id and sp.principal_kind='account_subject' and sp.status='active'
  where a.account_id is not null and a.account_id<>t.to_account_id and a.account_id<>t.from_account_id
  order by a.account_id,(sp.id=a.principal_id) desc,sp.id loop
  insert into private.invitation_terminal_notices(invitation_id,notice_kind,recipient_kind,recipient_account_id,
   recipient_authority_revision,idempotency_key,created_at,expires_at)
  values(i.id,'subject-transfer-access-revoked','account',r.account_id,r.principal_revision,
   encode(extensions.digest(convert_to('subject-transfer-notice-v1|subject-transfer-access-revoked|'||t.id::text||'|'
    ||r.account_id::text,'UTF8'),'sha256'),'hex'),v_now,v_now+interval '7 days')
  on conflict(idempotency_key) do nothing;
  get diagnostics m=row_count;
  n:=n+m;
 end loop;
 return n;
end $$;
revoke all on function private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 3-5. Three bodies patched in place --------------------------------------------------
-- Pattern of 20261119160000 and 20261120100000: each body md5-guarded with
-- its exact reviewed ACL, one anchor per patch, the successor md5 and
-- unchanged ACL asserted (55000 otherwise).
do $patch_handover$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The transfer's declarations.
  (1,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','3707a210e8fab9361b15a1ab6adbe8e0',
   '1665d7433184480e23d8758c6b4fb51c','{postgres=X/postgres}',
   $old$ v_exports uuid[]; n_grants integer; n_results integer;
begin$old$,
   $new$ v_exports uuid[]; n_grants integer; n_results integer;
 v_withdrawal boolean; v_new uuid; v_pending uuid[]; v_relationships uuid[]; v_attempt record;
 n_unconfirmed integer:=0; n_notices integer;
begin$new$,
   'transfer declarations'),
  -- The uploader's withdrawal is a right: its account need not be current for analysis.
  (2,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','1665d7433184480e23d8758c6b4fb51c',
   'ee4256e68d029c6d7f47050d7f00e20c','{postgres=X/postgres}',
   $old$ perform 1 from public.profiles where id=p_account_id for update;
 if not found or not private.path_b_account_current_v1(p_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;$old$,
   $new$ -- 20261122100000: the second actor case, the uploader's withdrawal (owner
 -- decision of 22 November 2026), only from its own door, which names this
 -- record in the transaction-local marker around its call. A withdrawal is a
 -- right: like the delete door that runs the uploader's other withdrawal, it
 -- needs a live session, not an account that is current for analysis.
 v_withdrawal:=coalesce(pg_catalog.current_setting('inherit.subject_transfer_withdrawal',true),'')=p_subject_id::text;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found or not (v_withdrawal or private.path_b_account_current_v1(p_account_id)) then
  raise exception using errcode='42501',message='not_found'; end if;$new$,
   'transfer actor account'),
  -- Who may act: the person, or on its withdrawal the owning uploader.
  (3,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','ee4256e68d029c6d7f47050d7f00e20c',
   '557ad60ac3de9b1bc760988e55d8895e','{postgres=X/postgres}',
   $old$  or s.subject_account_id is distinct from p_account_id
  or s.owner_account_id is null or s.owner_account_id=p_account_id
$old$,
   $new$  -- 20261122100000: the person's own act, or the owning uploader's withdrawal.
  or s.subject_account_id is null or s.owner_account_id is null or s.owner_account_id=s.subject_account_id
  or (not v_withdrawal and s.subject_account_id is distinct from p_account_id)
  or (v_withdrawal and s.owner_account_id is distinct from p_account_id)
$new$,
   'transfer actor'),
  -- The person the record goes to, whichever of the two acts.
  (4,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','557ad60ac3de9b1bc760988e55d8895e',
   '028840fa820c9d6cf0c9295d58e813e1','{postgres=X/postgres}',
   $old$  and sp.principal_kind='account_subject' and sp.account_id=p_account_id and sp.status='active' for share;
 if v_principal is null then raise exception using errcode='42501',message='not_found'; end if;
 v_uploader:=s.owner_account_id;
$old$,
   $new$  and sp.principal_kind='account_subject' and sp.account_id=s.subject_account_id and sp.status='active' for share;
 if v_principal is null then raise exception using errcode='42501',message='not_found'; end if;
 v_uploader:=s.owner_account_id;
 -- 20261122100000: the new owner is always the person (the caller on its own
 -- act), and on the withdrawal must still be a live account.
 v_new:=s.subject_account_id;
 if not exists(select 1 from auth.users u where u.id=v_new and u.deleted_at is null) then
  raise exception using errcode='42501',message='not_found'; end if;
$new$,
   'transfer new owner'),
  -- On the withdrawal a file the person has not confirmed is deleted, not refused.
  (5,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','028840fa820c9d6cf0c9295d58e813e1',
   'd56f796b528fae60555e87475bb1c04e','{postgres=X/postgres}',
   $old$ if exists(select 1 from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='pending')
  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then$old$,
   $new$ -- 20261122100000: on the uploader's withdrawal a pending file is ended below.
 if (not v_withdrawal and exists(select 1 from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='pending'))
  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then$new$,
   'transfer pending files'),
  -- The code each act spends; the unconfirmed files end; the person becomes the subject of every later step.
  (6,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','d56f796b528fae60555e87475bb1c04e',
   'f5df8c941a06b4d61fe20b35bb3002c0','{postgres=X/postgres}',
   $old$ perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_transfer',s.id,
  p_nonce_hash,p_nonce_expires_at);
$old$,
   $new$ -- 20261122100000: the withdrawal spends the code its page rendered for
 -- api.subject-delete; the person's own act the api.subject-transfer code.
 perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,
  case when v_withdrawal then 'subject_delete' else 'subject_transfer' end,s.id,p_nonce_hash,p_nonce_expires_at);
 -- 20261122100000: on the withdrawal every file the person has not confirmed
 -- ends as 'withdrawn', as the uploader's withdrawal of a record no person
 -- holds ends it (its object goes with its upload session's cleanup); only
 -- the confirmed files move.
 if v_withdrawal then
  v_pending:=array(select x.id from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='pending'
   order by x.id);
  foreach h.id in array v_pending loop
   if private.end_other_adult_held_upload_v1(h.id,'withdrawn') then n_unconfirmed:=n_unconfirmed+1; end if;
  end loop;
  v_revisions:=array(select x.id from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='confirmed'
   order by x.id);
 end if;
 -- 20261122100000: from here p_account_id names the person, the new owner:
 -- the caller on its own act, and on the withdrawal the person the record is
 -- handed to. Every step below is the transfer's own, unchanged.
 p_account_id:=v_new;
$new$,
   'transfer code and unconfirmed files'),
  -- D-151 and who loses access through a relationship.
  (7,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','f5df8c941a06b4d61fe20b35bb3002c0',
   '1a0e62e031e42d6ead83fab5f3ffb358','{postgres=X/postgres}',
   $old$ update public.subject_relationships set status='revoked',ended_at=v_now
  where subject_id=s.id and status in ('pending','current') and recipient_account_id is distinct from p_account_id;
 v_exports:=array(select e.id from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
  and e.status in ('queued','building','ready') order by e.id);
$old$,
   $new$ -- 20261122100000: who had access through a relationship, for the notices.
 v_relationships:=array(select r.id from public.subject_relationships r where r.subject_id=s.id and r.status='current'
  and r.recipient_account_id is distinct from p_account_id order by r.id);
 update public.subject_relationships set status='revoked',ended_at=v_now
  where subject_id=s.id and status in ('pending','current') and recipient_account_id is distinct from p_account_id;
 v_exports:=array(select e.id from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
  and e.status in ('queued','building','ready') order by e.id);
 -- 20261122100000 (D-151): a ready export could not be revoked by its status
 -- alone (generated_exports_ready_representation), so the transfer failed.
 -- Each attempt that still holds or is writing objects is stopped first
 -- through the export cleanup door, as 20261120100000 (D-144) does: its
 -- objects are queued for disposal behind its write fence, its downloads
 -- revoked, a building worker refused at its next step, and the stop clears
 -- a ready export's completion, so the revocation below is representable.
 perform 1 from public.generated_exports where id=any(v_exports) order by id for update;
 for v_attempt in select a.export_id,a.id from private.export_archive_attempts a
  where a.export_id=any(v_exports) and a.state in ('writing','bytes_complete') order by a.export_id,a.id loop
  perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);
 end loop;
$new$,
   'transfer exports'),
  -- D-147, the Copilot contexts, the notices, and the audit event of each act.
  (8,'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','1a0e62e031e42d6ead83fab5f3ffb358',
   'e481de5f5eab53b6c596da66bc7b30fa','{postgres=X/postgres}',
   $old$ -- 5. Audit, with no raw contact or token.
 perform private.append_legal_audit_event('subject.ownership_transferred',null,'api.subject-transfer','accepted',
  jsonb_build_object('upload_class','other_adult','files',cardinality(v_files),'grants',n_grants,
   'results_removed',n_results,'chats',cardinality(v_chats),'revision',v_transfer.transfer_revision));$old$,
   $new$ -- 20261122100000: an unredeemed one-record Copilot context of any other
 -- account for this record ends with its conversations.
 delete from public.copilot_context_tokens where scope_kind='subject' and target_id=s.id and account_id<>p_account_id;
 -- 20261122100000 (D-147): the uploader's permission to store the file ends
 -- and is kept, as every ended consent is: 'withdrawn' on its own withdrawal,
 -- 'superseded' by the person's ownership on the person's own act.
 update public.subject_consents set revoked_at=v_now,
  revocation_reason=case when v_withdrawal then 'withdrawn' else 'superseded' end
  where subject_id=s.id and consent_type='upload_class' and account_id=v_uploader and revoked_at is null;
 -- 20261122100000: the contract's three notices (new-subject-owner,
 -- former-owning-account, every-principal-whose-access-was-revoked), each
 -- once, to accounts, through the terminal-notice queue.
 n_notices:=private.queue_subject_transfer_notices_v1(v_transfer.id,v_withdrawal,v_grants,v_relationships);

 -- 5. Audit, with no raw contact or token. 20261122100000: the withdrawal's
 -- event is on the route the uploader used, attributed as the transfer's
 -- event is, to the account that spent the code.
 perform private.append_legal_audit_event('subject.ownership_transferred',
  case when v_withdrawal then private.legal_audit_actor_principal_v1('subject.ownership_transferred','api.subject-transfer') end,
  case when v_withdrawal then 'api.subject-delete' else 'api.subject-transfer' end,
  case when v_withdrawal then 'withdrawn' else 'accepted' end,
  jsonb_build_object('upload_class','other_adult','files',cardinality(v_files),'grants',n_grants,
   'results_removed',n_results,'chats',cardinality(v_chats),'revision',v_transfer.transfer_revision,
   'act',case when v_withdrawal then 'uploader-withdrawal' else 'subject-account' end,
   'unconfirmed_withdrawn',n_unconfirmed,'notices',n_notices));$new$,
   'transfer consent, notices and audit'),
  -- The withdrawal door: the account-held branch runs the transfer, behind the switch.
  (9,'public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)','caa3a80ce5b8c21aaafa83138575de39',
   'c00c31ee8ba5848c95ea4b2384d07e61','{postgres=X/postgres,service_role=X/postgres}',
   $old$ -- The person holds the record with their own account: not decided, refused.
 if s.subject_account_id is not null then
  raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;$old$,
   $new$ -- The person holds the record with their own account. 20261122100000
 -- (owner decision of 22 November 2026, "An uploader's withdrawal hands a
 -- record its adult holds to that adult"): the record and the files they
 -- confirmed are handed to them through the transfer, on this act. The
 -- transfer is closed until its three notices are approved: while
 -- private.subject_transfer_open_v1() is false this branch is refused as
 -- before and nothing changes.
 if s.subject_account_id is not null then
  if not private.subject_transfer_open_v1() then
   raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;
  perform pg_catalog.set_config('inherit.subject_transfer_withdrawal',s.id::text,true);
  v_result:=private.transfer_subject_v1(p_account_id,p_session_id,s.id,p_nonce_hash,p_nonce_expires_at);
  perform pg_catalog.set_config('inherit.subject_transfer_withdrawal','',true);
  if v_result->>'status' is distinct from 'transferred' then
   raise exception using errcode='55000',message='other_adult_withdrawal_case_differs'; end if;
  return jsonb_build_object('case','adult');
 end if;$new$,
   'withdrawal door'),
  -- The page's read: 'hand-over' only while the switch is open.
  (10,'public.other_adult_withdrawal_readiness_v1(uuid,uuid)','de43608630ccda660633c0f36626254c',
   '29f041df82ed5defc7d4cc48fcb12e0f','{postgres=X/postgres,service_role=X/postgres}',
   $old$ if s.subject_account_id is not null then return 'account-held'; end if;$old$,
   $new$ -- 20261122100000: the door hands such a record to its person only while
 -- the transfer's switch is open; until then the read is unchanged.
 if s.subject_account_id is not null then
  return case when private.subject_transfer_open_v1() then 'hand-over' else 'account-held' end; end if;$new$,
   'withdrawal read')
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
$patch_handover$;

-- Postflight: the patched bodies as written, the new function private, the
-- switch still closed and unchanged, the person's own door unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='e481de5f5eab53b6c596da66bc7b30fa' and p.prosecdef
   and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='c00c31ee8ba5848c95ea4b2384d07e61' and p.prosecdef
   and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.other_adult_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='29f041df82ed5defc7d4cc48fcb12e0f' and p.prosecdef and p.provolatile='s'
   and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.subject_transfer_open_v1()'::regprocedure
   and md5(pg_get_functiondef(p.oid))='c4b160e966711cf513e267673c4b5e2f' and p.proacl::text='{postgres=X/postgres}')
  or private.subject_transfer_open_v1()
  or not exists(select 1 from pg_proc p where p.oid='public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='0fb41099ef95025c011084190ed1555f'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from
   'CHECK ((notice_kind = ANY (ARRAY[''invitation-refused''::text, ''draft-cancelled''::text, ''donor-attribution-ended''::text, '
   ||'''upload-permission-withdrawn''::text, ''adult-acceptance-second-notice''::text, ''adult-revocation-renotice''::text, '
   ||'''subject-transfer-new-owner''::text, ''subject-transfer-former-owner''::text, ''subject-transfer-access-revoked''::text, '
   ||'''withdrawal-transfer-new-owner''::text, ''withdrawal-transfer-former-owner''::text])))' then
  raise exception using errcode='55000',message='uploader withdrawal hand-over successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
