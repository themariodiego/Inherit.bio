-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only: every Path B door this calls
-- refuses a record that test mode did not make, and no jurisdiction is
-- opened. It follows 20261016181000 and the two patches of its door
-- (20261016220000, 20261016221000), whose door and Path B delete it calls,
-- 20260906053451, whose notice queue it uses, and 20261119150000.
-- =====================================================================
--
-- Withdrawing an uploader's consent for another adult's file (owner decision
-- of 19 November 2026, "An uploader's withdrawal for another adult's file
-- deletes it, unless that adult holds the record themselves",
-- docs/protocol/decisions.md; design:
-- docs/evidence/consent-withdrawal-design-20261119/design.md, section 2).
--
-- Where the other adult has no account of their own on the record, the
-- withdrawal is the uploader's whole-record delete that the adult case of
-- api.subject-delete already registers (private.delete_path_b_subject_for_route_v1
-- with state 'withdrawn': every file the uploader added ends, confirmed or
-- not, the record is purged, its contact shredded, every upload_class
-- consent on it marked withdrawn and kept, no refusal bar), and the other
-- adult is sent a short notice. Where they hold the record with their own
-- account (subjects.subject_account_id names their account, through Path B's
-- account branch, 20260930210000), their record and the files they confirmed
-- stay theirs. What owns that record once the uploader keeps no access is
-- not decided (see the release notes), so that branch is refused here and by
-- the door below, and nothing on such a record changes. This migration adds:
--
--   1. invitation_terminal_notices_notice_kind_check gains
--      'upload-permission-withdrawn'. The notice is a terminal notice to a
--      contact, bound to the Path B request the person accepted, because it
--      must reach a person whose principal and contact the delete ends: the
--      queue copies the ciphertext into its own row, the mail worker opens it
--      only in memory, and the row's copy is cleared once sent or deleted
--      when it expires (20260906053451). No new queue, table or column.
--   2. private.invitation_notice_recipient_current_v1 rechecks, for that kind
--      only, the global contact refusal bar on the accepted request's contact
--      HMAC each time the worker claims or authorizes it, so a contact barred
--      after the withdrawal is never written to.
--   3. public.delete_subject_v1's Path B branch refuses the owning uploader
--      on a record its person holds with their own account. The person's own
--      delete, and the uploader's delete of a record with no person account,
--      are unchanged. Patched in place, md5-guarded, one anchor; its self
--      branch (pinned by 20261119150000) is not touched.
--   4. public.withdraw_other_adult_upload_v1, one service-only door for the
--      uploader's withdrawal. Under the invitation-transition lock every Path
--      B writer takes first, it refuses anything but a confirmed, active Path
--      B record the caller owns, and refuses the own-account branch, before
--      anything is written. It reads the person's current contact and the
--      request they accepted, runs public.delete_subject_v1 unchanged (its
--      locks, the one-time subject_delete nonce, the delete as 'withdrawn'),
--      and in the same transaction queues one notice per spent nonce, unless
--      the person's contact is barred. A record whose notice cannot be
--      addressed is refused whole.
--   5. public.other_adult_withdrawal_readiness_v1, the page's read: 'ready',
--      'account-held' or 'unsupported', from the door's own predicates in its
--      order. It writes nothing; the door remains the authority.
--
-- No table, column or grant on an existing object changes. The delete's own
-- audit event (subject.deleted, outcome withdrawn, a person's event on
-- api.subject-delete attributed through the nonce since 20261023120000)
-- records the withdrawal.

do $predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and md5(pg_get_functiondef(p.oid))='2f2c32f48e4a223617ba6d31f493a92c'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  -- The uploader's Path B delete as 20261016181000 left it: 'withdrawn' ends
  -- every held file, purges the record, shreds its contact and writes no bar.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.delete_path_b_subject_for_route_v1(uuid,text)')
   and md5(pg_get_functiondef(p.oid))='f30283fb54afaf87da2462c9a469c85f' and p.proacl::text='{postgres=X/postgres}')
  -- The notice queue as 20260906053451 left it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.invitation_notice_recipient_current_v1(uuid)')
   and md5(pg_get_functiondef(p.oid))='261f743d84e3615d4ae56ab2e4e26b9a' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.enqueue_invitation_terminal_notice_v1()')
   and md5(pg_get_functiondef(p.oid))='689008df933e852391c20f6e8b3afd4a' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_trigger t where t.tgrelid='private.invitation_terminal_notices'::regclass
   and t.tgname='enqueue_invitation_terminal_notice' and t.tgenabled='O'
   and t.tgfoid='private.enqueue_invitation_terminal_notice_v1()'::regprocedure)
  or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from '9a5c55221b44fc6b6b80079b9460b790'
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.invitation_contact_barred_v1(text)')
   and md5(pg_get_functiondef(p.oid))='78c6413be21d2c662e515764a39748b3')
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('public.other_adult_withdrawal_readiness_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='other adult upload withdrawal prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The notice kind ----------------------------------------------------------------
alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;
alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check
 check (notice_kind in ('invitation-refused','draft-cancelled','donor-attribution-ended','upload-permission-withdrawn'));

-- 2 and 3. Two bodies patched in place ------------------------------------------------
-- Pattern of 20261023120000: each body md5-guarded with its exact reviewed ACL,
-- one anchor each, the successor md5 and unchanged ACL asserted (55000
-- otherwise).
do $patch_withdrawal$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The uploader never deletes a record its person holds with their own account.
  (1,'public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)','2f2c32f48e4a223617ba6d31f493a92c',
   'e994afb4410ad008aa959efc65726895','{postgres=X/postgres,service_role=X/postgres}',
   $old$  if v_path_b then
   perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);$old$,
   $new$  if v_path_b then
   -- 20261119160000: the owning uploader never deletes a record whose person
   -- holds it with their own account (owner decision of 19 November 2026).
   if s.subject_account_id is not null and s.subject_account_id is distinct from p_account_id then
    raise exception using errcode='42501',message='not_found'; end if;
   perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);$new$,
   'subject delete door'),
  -- A withdrawal notice is never written to a contact barred since it was queued.
  (2,'private.invitation_notice_recipient_current_v1(uuid)','261f743d84e3615d4ae56ab2e4e26b9a',
   'e0728613189f2cbdfa05029c962767a5','{postgres=X/postgres}',
   $old$  where n.id=p_notice_id and n.state='pending' and n.expires_at>statement_timestamp()
$old$,
   $new$  where n.id=p_notice_id and n.state='pending' and n.expires_at>statement_timestamp()
   -- 20261119160000: an uploader's withdrawal notice only while the accepted
   -- request's contact is not barred.
   and (n.notice_kind<>'upload-permission-withdrawn' or exists(select 1 from public.subject_invitations i
    where i.id=n.invitation_id and i.invitation_kind='adult_subject' and i.target_kind='subject'
     and not private.invitation_contact_barred_v1(i.email_hmac)))
$new$,
   'terminal notice recipient')
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
$patch_withdrawal$;

-- 4. The door ---------------------------------------------------------------------
-- Lock order: the invitation-transition lock, as delete_subject_v1 and every
-- Path B writer take it first; the reads below take no row lock, so the door
-- then runs delete_subject_v1 in its own order (account, sessions, profile,
-- subject). Under that lock no Path B writer can change the record, its
-- person or their contact between the read and the delete.
create function public.withdraw_other_adult_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; v_principal uuid; v_contact bytea; i public.subject_invitations%rowtype;
 v_result jsonb; v_now timestamptz;
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 -- Only a confirmed, active Path B record the caller owns and has not given away.
 select * into s from public.subjects where id=p_subject_id;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult' or s.lifecycle<>'active'
  or s.ownership_transferred_at is not null or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not distinct from p_account_id
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id and d.owner_account_id=p_account_id
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 -- The person holds the record with their own account: not decided, refused.
 if s.subject_account_id is not null then
  raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;
 -- The person, their current contact and the request they accepted.
 select sp.id into v_principal from public.subject_principals sp where sp.subject_id=s.id
  and sp.principal_kind='non_account_subject' and sp.account_id is null and sp.status='active';
 select e.contact_ciphertext into v_contact from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id
  where e.principal_id=v_principal and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=sp.principal_revision
  order by e.created_at desc limit 1;
 select x.* into i from public.subject_invitations x where x.target_kind='subject' and x.target_id=s.id
  and x.invitation_kind='adult_subject' and x.status='accepted' and x.invitee_principal_id=v_principal
  order by x.accepted_at desc limit 1;
 if v_principal is null or v_contact is null or i.id is null then
  raise exception using errcode='55000',message='withdrawal_notice_unavailable'; end if;
 -- The registered operation, unchanged: its authority checks, its locks, the
 -- nonce's hash and the uploader's delete as 'withdrawn', in this transaction.
 v_result:=public.delete_subject_v1(p_account_id,p_session_id,s.id,p_nonce_hash,p_nonce_expires_at);
 if v_result is distinct from '{"case":"adult"}'::jsonb then
  raise exception using errcode='55000',message='other_adult_withdrawal_case_differs'; end if;
 -- One notice per withdrawal, unless the person's contact is barred. The
 -- ciphertext is copied before the delete shredded it; no plaintext exists.
 if not private.invitation_contact_barred_v1(i.email_hmac) then
  insert into private.invitation_terminal_notices(invitation_id,notice_kind,recipient_kind,contact_ciphertext,
   recipient_authority_revision,idempotency_key,created_at,expires_at)
  values(i.id,'upload-permission-withdrawn','contact',v_contact,i.invitation_revision,
   encode(extensions.digest(convert_to('upload-permission-withdrawn-v1|'||s.id::text||'|'||p_nonce_hash,'UTF8'),'sha256'),'hex'),
   v_now,v_now+interval '7 days')
  on conflict(idempotency_key) do nothing;
 end if;
 return v_result;
end $$;
revoke all on function public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

-- 5. The page's read ------------------------------------------------------------
-- The door's refusals, in its order, without its lock: another account's or
-- an unconfirmed record is not found; then the own-account branch; then a
-- notice that cannot be addressed. The door remains the authority.
create function public.other_adult_withdrawal_readiness_v1(p_account_id uuid,p_subject_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare s public.subjects%rowtype; v_principal uuid;
begin
 select * into s from public.subjects where id=p_subject_id;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult' or s.lifecycle<>'active'
  or s.ownership_transferred_at is not null or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not distinct from p_account_id
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id and d.owner_account_id=p_account_id
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 if s.subject_account_id is not null then return 'account-held'; end if;
 select sp.id into v_principal from public.subject_principals sp where sp.subject_id=s.id
  and sp.principal_kind='non_account_subject' and sp.account_id is null and sp.status='active';
 if v_principal is null
  or not exists(select 1 from public.encrypted_contact_references e
   join public.subject_principals sp on sp.id=e.principal_id
   where e.principal_id=v_principal and e.status='current' and e.contact_ciphertext is not null
    and e.authority_revision=sp.principal_revision)
  or not exists(select 1 from public.subject_invitations x where x.target_kind='subject' and x.target_id=s.id
   and x.invitation_kind='adult_subject' and x.status='accepted' and x.invitee_principal_id=v_principal) then
  return 'unsupported'; end if;
 return 'ready';
end $$;
revoke all on function public.other_adult_withdrawal_readiness_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.other_adult_withdrawal_readiness_v1(uuid,uuid) to service_role;

-- Postflight: the two new functions as written, the patched ones as reviewed,
-- the wrapped delete unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.other_adult_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='e994afb4410ad008aa959efc65726895'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.invitation_notice_recipient_current_v1(uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='e0728613189f2cbdfa05029c962767a5' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.delete_path_b_subject_for_route_v1(uuid,text)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='f30283fb54afaf87da2462c9a469c85f' and p.proacl::text='{postgres=X/postgres}')
  or (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid='private.invitation_terminal_notices'::regclass and c.conname='invitation_terminal_notices_notice_kind_check'
    and c.contype='c' and c.convalidated) is distinct from
   'CHECK ((notice_kind = ANY (ARRAY[''invitation-refused''::text, ''draft-cancelled''::text, ''donor-attribution-ended''::text, ''upload-permission-withdrawn''::text])))' then
  raise exception using errcode='55000',message='other adult upload withdrawal successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
