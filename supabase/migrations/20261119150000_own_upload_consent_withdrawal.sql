-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261016181000, whose door and self
-- emptying it calls unchanged, and 20261023120000, whose subject operation
-- nonce recorder that door already calls; it goes into a release after
-- both are hosted.
-- =====================================================================
--
-- Withdrawing a person's consent to store their own DNA file (owner
-- decision of 19 November 2026, "Withdrawing consent for a person's own DNA
-- file deletes the files and all made from them", docs/protocol/decisions.md;
-- design: docs/evidence/consent-withdrawal-design-20261119/design.md, section
-- 1). The withdrawal is the whole-record emptying that the self case of
-- api.subject-delete already registers (private.empty_self_subject_v1): every
-- file on the person's own record, every result, report and Copilot
-- conversation made from them, the sharing permissions and family links
-- built on them and the copies other accounts held go; every consent on the
-- record, the upload consent among them, is marked withdrawn and kept; the
-- account stays. The brief (section 2.7) adds "with a confirmation email",
-- which that operation does not send. This migration adds:
--
--   1. public.empty_self_subject_with_notice_v1, one service-only door for
--      the self case. It refuses any record that is not a self record, and
--      a malformed notice envelope, before anything is read or written. It
--      then calls public.delete_subject_v1 unchanged, which takes the same
--      locks, records the one-time operation nonce and empties the record,
--      and in the same transaction queues the confirmation email through
--      (2). If the email cannot be queued (the account has no confirmed
--      address, or the address changed since the request read it), the
--      whole withdrawal rolls back and nothing is deleted.
--   2. private.enqueue_self_withdrawal_notice_v1, which addresses that email
--      to the account's own principal on the record, at the address the
--      route encrypted from the signed-in account, exactly as the own
--      report-ready email is addressed (20260907060854), and queues one
--      'upload-consent-withdrawn' row per spent operation nonce.
--   3. public.self_subject_withdrawal_readiness_v1, a read for the page
--      that offers the control: 'unsupported', 'processing' or 'ready',
--      from the same predicates, in the same order, with which
--      private.empty_self_subject_v1 and the per-file guard it calls refuse
--      (subject_delete_unsupported_graph, subject_delete_processing,
--      file_delete_processing). It writes nothing. The page uses it to say
--      why the control cannot run yet instead of offering a request the
--      database would refuse; the door remains the authority.
--
-- No table, column, constraint, grant on an existing object, audit event,
-- wording in the database or existing function body changes, and nothing is
-- patched in place. The emptying's own audit event (subject.emptied, a
-- person's event attributed through the nonce since 20261023120000) records
-- the withdrawal. The predecessor block holds the self emptying to its
-- reviewed body and ACL, and the door to its reviewed self branch and ACL
-- (55000 otherwise).

do $predecessor$
declare door text; self_branch text:=$self$ if s.subject_class='self' then
  if s.owner_account_id is distinct from p_account_id or s.subject_account_id is distinct from p_account_id
   or s.lifecycle<>'active' then raise exception using errcode='42501',message='not_found'; end if;
  perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
  return private.empty_self_subject_v1(p_account_id,s.id);
 end if;$self$;
begin
 select pg_get_functiondef(p.oid) into door from pg_proc p
  where p.oid=to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)')
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef
   and p.proconfig=array['search_path=""']::text[];
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='85a9ab8159fa7e5bfb18deada62c1215' and p.proacl::text='{postgres=X/postgres}')
  -- The door's self branch, exactly once: a self record is emptied through the emptying pinned above.
  or door is null or (length(door)-length(replace(door,self_branch,'')))/length(self_branch)<>1
  -- The per-file guard whose processing refusal the page's read mirrors, as 20261016181000 left it.
  or not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.prepare_genome_file_deletion_body_v1(uuid,uuid)')
   and md5(pg_get_functiondef(p.oid))='e9f3f4692f0c6d10f6827410db8a0102' and p.proacl::text='{postgres=X/postgres}')
  or to_regclass('public.mail_outbox') is null or to_regclass('public.encrypted_contact_references') is null
  or to_regclass('public.contact_hmac_indexes') is null
  or not exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass and attname='mail_contact_revision'
   and not attisdropped)
  or to_regprocedure('public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)') is not null
  or to_regprocedure('private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)') is not null
  or to_regprocedure('public.self_subject_withdrawal_readiness_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='own upload consent withdrawal prerequisite differs'; end if;
end;
$predecessor$;

-- 2. The confirmation email ------------------------------------------------------
-- Called only by the door below, after the record is emptied, in the same
-- transaction. The envelope is the one the door has already checked. The
-- order of locks continues the door's: the Auth row and the profile (held
-- by the door already), then the principal, the contact and the outbox.
create function private.enqueue_self_withdrawal_notice_v1(p_account_id uuid,p_subject_id uuid,p_notice jsonb,p_nonce_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare principal public.subject_principals%rowtype; contact uuid; outbox uuid; key text; v_revision bigint;
 v_now timestamptz:=clock_timestamp(); v_expiry timestamptz:=clock_timestamp()+interval '7 days';
begin
 perform 1 from auth.users where id=p_account_id and deleted_at is null and email_confirmed_at is not null for share;
 if not found then raise exception using errcode='55000',message='withdrawal_notice_unavailable'; end if;
 -- The address the route encrypted is still the account's: an Auth email
 -- change moves this counter, and a stale envelope refuses the withdrawal.
 perform 1 from public.profiles where id=p_account_id
  and mail_contact_revision=(p_notice->>'contactRevision')::bigint for share;
 if not found then raise exception using errcode='55000',message='withdrawal_notice_recipient_stale'; end if;
 select sp.* into principal from public.subject_principals sp
  join public.subject_account_bindings b on b.subject_principal_id=sp.id and b.subject_id=sp.subject_id
   and b.account_id=p_account_id and b.status='current'
  where sp.subject_id=p_subject_id and sp.account_id=p_account_id
   and sp.principal_kind='account_subject' and sp.status='active' for share of sp,b;
 if principal.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select lifecycle_revision into v_revision from public.subjects where id=p_subject_id and subject_class='self';
 if v_revision is null then raise exception using errcode='42501',message='not_found'; end if;
 -- One email per withdrawal: the one-time nonce it spent names it.
 key:=encode(extensions.digest(convert_to('upload-consent-withdrawn-v1|'||p_account_id::text||'|'||p_nonce_hash,'UTF8'),'sha256'),'hex');
 select e.id into contact from public.encrypted_contact_references e
  where e.principal_id=principal.id and e.contact_hmac=p_notice->>'contactHmac' and e.status='current'
   and e.authority_revision=principal.principal_revision and e.contact_ciphertext is not null
  order by e.created_at desc limit 1 for update;
 if contact is null then
  update public.encrypted_contact_references set status='rotated',ended_at=v_now
   where principal_id=principal.id and status='current';
  insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
   values(principal.id,decode(p_notice->>'contactCiphertext','hex'),p_notice->>'contactHmac',1,principal.principal_revision,'current')
   returning id into contact;
  insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
   values(contact,p_notice->>'contactHmac',1,'current',v_expiry);
 end if;
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at)
 values('upload-consent-withdrawn','upload-consent-withdrawn','subject',p_subject_id,principal.id,contact,
  principal.principal_revision,v_revision,key,jsonb_build_object('withdrawnAt',v_now),v_expiry)
 returning id into outbox;
 return outbox;
end $$;
revoke all on function private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 1. The door ---------------------------------------------------------------------
create function public.empty_self_subject_with_notice_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz,p_notice jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_class text; v_result jsonb;
begin
 -- The envelope's shape, as the own report-ready email checks its own:
 -- nothing is read or written for a malformed one.
 if jsonb_typeof(p_notice) is distinct from 'object'
  or not(p_notice ?& array['contactCiphertext','contactHmac','contactRevision'])
  or p_notice-array['contactCiphertext','contactHmac','contactRevision']<>'{}'::jsonb
  or coalesce(p_notice->>'contactRevision','')!~'^[1-9][0-9]{0,15}$'
  or length(p_notice->>'contactCiphertext') not between 60 and 4096
  or coalesce(p_notice->>'contactCiphertext','')!~'^[0-9a-f]+$'
  or length(p_notice->>'contactCiphertext')%2<>0
  or coalesce(p_notice->>'contactHmac','')!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- This door is the self case only. The class never changes; any other
 -- record, or none, is not this door's, and nothing is written.
 select subject_class into v_class from public.subjects where id=p_subject_id;
 if v_class is distinct from 'self' then raise exception using errcode='42501',message='not_found'; end if;
 -- The registered operation, unchanged: its authority checks, its locks,
 -- the nonce's hash and the emptying, in this transaction.
 v_result:=public.delete_subject_v1(p_account_id,p_session_id,p_subject_id,p_nonce_hash,p_nonce_expires_at);
 if v_result->>'case' is distinct from 'self' then
  raise exception using errcode='55000',message='self_withdrawal_case_differs'; end if;
 perform private.enqueue_self_withdrawal_notice_v1(p_account_id,p_subject_id,p_notice,p_nonce_hash);
 return v_result;
end $$;
revoke all on function public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb) to service_role;

-- 3. The page's read ------------------------------------------------------------
-- The refusals of private.empty_self_subject_v1 that the person can wait out
-- or cannot fix here, in its order, and the per-file guard's processing
-- refusal for the two job kinds the emptying leaves running. Anything else
-- the emptying can refuse is not predicted here; the door answers it.
create function public.self_subject_withdrawal_readiness_v1(p_account_id uuid,p_subject_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare s public.subjects%rowtype; v_files uuid[];
begin
 select * into s from public.subjects where id=p_subject_id;
 if s.id is null or s.subject_class<>'self' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' then
  raise exception using errcode='42501',message='not_found'; end if;
 v_files:=array(select f.id from public.genome_files f where f.subject_id=s.id order by f.id);
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id)
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then
  return 'unsupported'; end if;
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and f.status in ('uploading','parsing','parsed'))
  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating')
  or exists(select 1 from public.worker_jobs j where j.file_id=any(v_files) and j.status in ('queued','running')
   and j.kind in ('revoke_purge','retention_purge')) then
  return 'processing'; end if;
 return 'ready';
end $$;
revoke all on function public.self_subject_withdrawal_readiness_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.self_subject_withdrawal_readiness_v1(uuid,uuid) to service_role;

-- Postflight: the three new functions as written, the wrapped ones unchanged.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.self_subject_withdrawal_readiness_v1(uuid,uuid)'::regprocedure
   and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.empty_self_subject_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='85a9ab8159fa7e5bfb18deada62c1215' and p.proacl::text='{postgres=X/postgres}') then
  raise exception using errcode='55000',message='own upload consent withdrawal successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
