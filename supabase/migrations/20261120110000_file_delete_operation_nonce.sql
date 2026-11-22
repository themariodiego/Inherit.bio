-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20260908234525, whose owner-path file
-- cleanup door it wraps unchanged, 20260918113000, whose per-file door that
-- door calls, and 20261024110000, the last migration that widened the
-- account operation check. It does not pin the per-file guard body
-- (private.prepare_genome_file_deletion_body_v1), which it neither calls
-- nor reads: what that body refuses is the wrapped door's business, and
-- 20261120100000 (D-144), which comes before this one, patches it.
-- =====================================================================
--
-- G8.5, api.file-delete (owner decision of 19 November 2026, "G8.5: where
-- the register is stricter, engineering codes to it"; one of the examples
-- the owner was given was deleting one file without the one-time
-- confirmation the register requires for deletions).
-- authenticated-mutation-v1.destructiveNonce says a delete also requires "a
-- distinct recent one-time operation nonce in the exact route-declared body
-- or X-Inherit-Operation-Nonce header", and
-- mutationSecurityBindings.operationNonceIssuance says it is "consumed-once-
-- by-the-state-changing-request-which-records-its-hash-in-the-operation-
-- transaction". Until now nothing read or recorded one for a file delete.
--
--   1. The operation check of public.account_operation_nonces gains
--      file_delete and keeps every value it holds, read the way
--      20261024110000 reads it.
--   2. private.record_file_delete_nonce_v1 records the hash of the value the
--      Files page rendered for this account, session and file (the route
--      has verified its MAC, which binds the file) once, consumed, in
--      public.account_operation_nonces. It is the account operation
--      consumer's rule for this one operation: the same shape, expiry and
--      live auth-session checks, the same one-insert spend and the same
--      refusal (22023 invalid_operation_nonce). A session that is not live
--      is refused with the per-file door's own message,
--      file_delete_unauthorized. Inserting it consumed names the account as
--      the transaction's actor (legal_audit_actor_on_consumed_insert); no
--      event of the file deletion is on the person-event list, so no audit
--      event changes. The consumer itself is not patched: 20261119170000
--      pins it and is its last word.
--   3. public.prepare_own_prepared_file_cleanup_with_nonce_v1, one
--      service-only door: it records the value first, then runs the
--      unchanged public.prepare_own_prepared_file_cleanup_v1 in the same
--      transaction. Its first write is the deletion's first write (the file
--      made unreadable and its deletion record), so the value is spent
--      exactly when the deletion starts, or not at all: a refusal of the
--      deletion (not found, processing, shared graph) rolls the spend back,
--      and a replayed, expired or malformed value writes nothing.
--
-- No column, table, trigger, audit event, existing body or wording changes,
-- and nothing is patched in place. The unchanged door keeps its grant: the
-- subject-delete drain and this route's own recheck call it within a
-- request a spent value already authorised.

do $predecessor$
begin
 if (select count(distinct x.signature) from pg_proc p join (values
    ('public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)','8b6c62634d64e9058e2c503def867c4d',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)','8f2f2fd4b5d9dd017c5330907b42e137',
     '{postgres=X/postgres,service_role=X/postgres}')
   ) as x(signature,body_md5,acl) on p.oid=to_regprocedure(x.signature)
   where md5(pg_get_functiondef(p.oid))=x.body_md5 and p.proacl::text=x.acl)<>2
  -- The trigger that names the actor when a nonce is inserted already consumed.
  or not exists(select 1 from pg_trigger t where t.tgrelid='public.account_operation_nonces'::regclass
   and t.tgname='legal_audit_actor_on_consumed_insert' and not t.tgisinternal)
  or to_regprocedure('private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)') is not null then
  raise exception using errcode='55000',message='file delete operation nonce prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The operation check gains the new operation and keeps every value it
-- holds now. An IN list renders as ARRAY['a'::text, ...]; an array literal as
-- '{a,...}'::text[]. Both are read.
do $widen$
declare v_def text; v_now text[]; v_values text[];
begin
 select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
 where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';
 select array_agg(v) into v_now from (
  select m[1] v from regexp_matches(v_def,'''([a-z_]+)''::text','g') m
  union all
  select unnest(string_to_array((regexp_match(v_def,'''\{([a-z_,]+)\}''::text\[\]'))[1],','))) s;
 if v_now is null or not ('provider_setting_delete'=any(v_now)) or 'file_delete'=any(v_now) then
  raise exception using errcode='55000',message='account operation check unreadable'; end if;
 select array_agg(distinct v order by v) into v_values from unnest(v_now||array['file_delete']) v;
 alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
 execute format('alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check'
  ' check (operation in (%s))',(select string_agg(quote_literal(v),',' order by v) from unnest(v_values) v));
end;
$widen$;

-- 2. The recorder. The page rendered the value for this account, session,
-- operation and file; the route has verified its MAC; this records its hash
-- once, consumed. A second presentation of the same value, for this file or
-- any other, finds the hash and is refused.
create function private.record_file_delete_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_nonce_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();
begin
 if p_account_id is null or p_session_id is null
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>v_now);
 if not found then raise exception using errcode='42501',message='file_delete_unauthorized'; end if;
 delete from public.account_operation_nonces where operation='file_delete' and expires_at<=v_now;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at,consumed_at)
 values(p_nonce_hash,p_account_id,p_session_id,'file_delete',p_expires_at,v_now)
 on conflict(nonce_hash) do nothing;
 if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
end $$;
revoke all on function private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 3. The door. The value first, then the unchanged owner-path cleanup door,
-- whose first write starts the deletion, in the same transaction.
create function public.prepare_own_prepared_file_cleanup_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.record_file_delete_nonce_v1(p_account_id,p_session_id,p_nonce_hash,p_nonce_expires_at);
 return public.prepare_own_prepared_file_cleanup_v1(p_account_id,p_session_id,p_file_id);
end $$;
revoke all on function public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

-- Postflight: both functions as written, the wrapped doors unchanged, and the
-- check holding the new operation and the earlier ones.
do $postflight$
begin
 if not exists(select 1 from pg_proc p where p.oid='public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)'::regprocedure
   and p.prosecdef and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres}')
  or (select count(distinct x.signature) from pg_proc p join (values
    ('public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)','8b6c62634d64e9058e2c503def867c4d',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)','8f2f2fd4b5d9dd017c5330907b42e137',
     '{postgres=X/postgres,service_role=X/postgres}')
   ) as x(signature,body_md5,acl) on p.oid=to_regprocedure(x.signature)
   where md5(pg_get_functiondef(p.oid))=x.body_md5 and p.proacl::text=x.acl)<>2
  or not exists(select 1 from pg_constraint c where c.conrelid='public.account_operation_nonces'::regclass
   and c.conname='account_operation_nonces_operation_check' and c.convalidated
   and pg_get_constraintdef(c.oid) like '%''file_delete''%' and pg_get_constraintdef(c.oid) like '%''provider_setting_delete''%'
   and pg_get_constraintdef(c.oid) like '%''subject_transfer''%' and pg_get_constraintdef(c.oid) like '%''account_delete''%') then
  raise exception using errcode='55000',message='file delete operation nonce successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
