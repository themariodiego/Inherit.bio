-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It goes into release 4 with 20261119110000, after
-- 20261024220000, whose table it writes and whose door it holds unchanged.
-- It adds one function; nothing existing is altered. The app code that
-- calls it falls back to 20261024220000's door while it is absent
-- (src/lib/security/session-csrf.ts, `consume`), so it can be applied
-- before or after that code deploys.
-- =====================================================================
--
-- The one-time X-Inherit-CSRF token for five more kinds of session (G8.5,
-- the migration stage; owner decisions of 19 November 2026, "G8.5:
-- principles for the CSRF register amendments" and "G8.5: the claim-objection
-- address accepts either kind of session").
--
-- public.consume_session_csrf_v1 spends a token of an authenticated, rights
-- (token) or activation-candidate (token-candidate) session and refuses
-- every other kind with 22023. The routes that used a session-bound value of
-- their own design (docs/register-contract-divergence.json#csrfOwnDesign)
-- now use the token too, under five more kinds, and this door spends them:
--
--   reviewer          the reviewer's account and auth session, under its own
--                     kind (a reviewer token never verifies on an account
--                     route, or the reverse; src/lib/security/session-csrf-core.ts);
--   upload-session    the embryo ingest cookie's hash and its session id;
--   evidence-session  the evidence cookie's hash and its session id;
--   claim-session     the claim cookie's hash;
--   reset-session     the reset cookie's hash.
--
-- It accepts the three earlier kinds with exactly v1's rules, so it can be
-- the one door once v1's callers move; the app keeps calling v1 for them in
-- this release.
--
-- The spend is v1's: the token's SHA-256 is recorded once in
-- private.session_csrf_token_uses, which both doors write, so a hash spent
-- through one is refused by the other; expired hashes are swept on every
-- call; an expiry past or beyond twelve hours is refused. Before it spends,
-- the session must still be live, so that a token outlives neither its
-- session nor a revocation, as an authenticated token already does:
--
--   reviewer          v1's authenticated check: the auth.sessions row is
--                     live and its user not deleted.
--   upload-session    the public.embryo_ingest_sessions row of that id and
--                     cookie hash is open, mapping_required or
--                     failure_pending. A failure_pending session is still
--                     admitted, because the route's own authorizer answers
--                     it by dispatching the attempt's unwind before its 404;
--                     the expiry is the authorizer's to decide for the same
--                     reason (an expired open session is marked failed
--                     there, not refused here).
--   evidence-session  a claim, appeal or permission document session row of
--                     that id and cookie hash exists. Not "open": a
--                     completion repeats its nonce to ask for the outcome of
--                     a finalized, failed or expired session, and the route
--                     answers that with the scan state or the refusal reason.
--                     An open-only check would change what a person sees, so
--                     the check is the strictest that changes no answer.
--   claim-session     a private.future_person_claim_intakes row with that
--                     session hash is live (private.claim_intake_live_v1:
--                     not completed, not expired, not idle 30 minutes). A
--                     rotated cookie's old hash names no row.
--   reset-session     a private.auth_recovery_sessions row with that hash is
--                     unexpired and its account not deleted. A reset spends
--                     the row in the same transaction as the password.
--
-- The chunk stream of api.evidence-chunk (principle 3) is verified by the
-- route and never spent; it does not reach this door.
--
-- Service-role only, as v1. The definer body repeats the service-role check.
-- Re-runnable: a second apply finds the successor exactly as reviewed and
-- replaces it with itself; anything else refuses (55000) and writes nothing.

do $predecessor$
begin
 -- v1 and its table exactly as 20261024220000 left them.
 if (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
    where p.oid=to_regprocedure('public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)'))
   is distinct from 'ae9a75327090d06a46456efce17625a3 {postgres=X/postgres,service_role=X/postgres}'
  or (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema='private' and table_name='session_csrf_token_uses')
   is distinct from array['expires_at','route_id','token_hash']
  -- The live rows the five checks read, and the one liveness rule they call.
  or (select count(*) from information_schema.columns c join (values
    ('public','embryo_ingest_sessions','id'),('public','embryo_ingest_sessions','cookie_hash'),
    ('public','embryo_ingest_sessions','status'),
    ('private','claim_document_sessions','id'),('private','claim_document_sessions','cookie_hash'),
    ('private','appeal_document_sessions','id'),('private','appeal_document_sessions','cookie_hash'),
    ('private','permission_document_sessions','id'),('private','permission_document_sessions','cookie_hash'),
    ('private','future_person_claim_intakes','session_hash'),
    ('private','auth_recovery_sessions','session_hash'),('private','auth_recovery_sessions','account_id'),
    ('private','auth_recovery_sessions','expires_at')
   ) as x(schema_name,table_name,column_name) on c.table_schema=x.schema_name and c.table_name=x.table_name
    and c.column_name=x.column_name)<>13
  or not exists(select 1 from pg_constraint c where c.conrelid='public.embryo_ingest_sessions'::regclass
    and c.conname='embryo_ingest_sessions_status_check' and c.convalidated
    and pg_get_constraintdef(c.oid)='CHECK ((status = ANY (ARRAY[''open''::text, ''mapping_required''::text, ''complete''::text, ''processing''::text, ''published''::text, ''failed''::text, ''abandoned''::text, ''cancelled''::text, ''sanitization_pending''::text, ''failure_pending''::text])))')
  or (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
    where p.oid=to_regprocedure('private.claim_intake_live_v1(private.future_person_claim_intakes)'))
   is distinct from 'f76e353669c3f7ff70c66e78e34317a1 {postgres=X/postgres}'
  or to_regclass('auth.sessions') is null or to_regclass('auth.users') is null
  -- Absent, or already exactly the reviewed successor (a second apply).
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='consume_session_csrf_v2'
     and (p.oid is distinct from to_regprocedure('public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)')
      or md5(pg_get_functiondef(p.oid))||' '||p.proacl::text
       is distinct from '13570c4a4b77de1fbc6e3fcfe2d40636 {postgres=X/postgres,service_role=X/postgres}')) then
  raise exception using errcode='55000',message='session csrf purpose kinds prerequisite differs'; end if;
end;
$predecessor$;

create or replace function public.consume_session_csrf_v2(
 p_route_id text,
 p_session_kind text,
 p_token_hash text,
 p_expires_at timestamptz,
 p_account_id uuid default null,
 p_session_id uuid default null,
 p_cookie_hash text default null,
 p_purpose_session_id uuid default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
 v_now timestamptz:=clock_timestamp(); v_spent integer;
 v_account boolean:=p_session_kind in ('authenticated','reviewer');
 v_cookie boolean:=p_session_kind in ('upload-session','evidence-session','claim-session','reset-session');
 v_identified boolean:=p_session_kind in ('upload-session','evidence-session');
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_route_id is null or p_route_id!~'^(api|auth)\.[a-z0-9-]{2,80}$'
  or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_kind is null or p_session_kind not in ('authenticated','token','token-candidate','reviewer',
   'upload-session','evidence-session','claim-session','reset-session')
  or v_account is distinct from (p_account_id is not null and p_session_id is not null)
  or (not v_account and (p_account_id is not null or p_session_id is not null))
  or v_cookie is distinct from (p_cookie_hash is not null)
  or (p_cookie_hash is not null and p_cookie_hash!~'^[0-9a-f]{64}$')
  or v_identified is distinct from (p_purpose_session_id is not null) then
  raise exception using errcode='22023',message='session csrf request invalid'; end if;
 if p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '12 hours' then return false; end if;
 if v_account and not exists(
  select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session_id and s.user_id=p_account_id and u.deleted_at is null
   and (s.not_after is null or s.not_after>v_now)) then
  return false;
 end if;
 if p_session_kind='upload-session' and not exists(
  select 1 from public.embryo_ingest_sessions s
  where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash
   and s.status in ('open','mapping_required','failure_pending')) then
  return false;
 end if;
 if p_session_kind='evidence-session'
  and not exists(select 1 from private.claim_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash)
  and not exists(select 1 from private.appeal_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash)
  and not exists(select 1 from private.permission_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash) then
  return false;
 end if;
 if p_session_kind='claim-session' and not exists(
  select 1 from private.future_person_claim_intakes i
  where i.session_hash=p_cookie_hash and private.claim_intake_live_v1(i)) then
  return false;
 end if;
 if p_session_kind='reset-session' and not exists(
  select 1 from private.auth_recovery_sessions r join auth.users u on u.id=r.account_id
  where r.session_hash=p_cookie_hash and r.expires_at>v_now and u.deleted_at is null) then
  return false;
 end if;
 delete from private.session_csrf_token_uses where expires_at<=v_now;
 insert into private.session_csrf_token_uses(token_hash,route_id,expires_at)
 values(p_token_hash,p_route_id,p_expires_at)
 on conflict(token_hash) do nothing;
 get diagnostics v_spent=row_count;
 return v_spent=1;
end $$;
revoke all on function public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid) to service_role;

-- Postflight: the successor exactly as reviewed, v1 unchanged, one overload.
do $postflight$
begin
 if (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
    where p.oid='public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)'::regprocedure)
   is distinct from '13570c4a4b77de1fbc6e3fcfe2d40636 {postgres=X/postgres,service_role=X/postgres}'
  or (select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
    where p.oid='public.consume_session_csrf_v1(text,text,text,timestamptz,uuid,uuid)'::regprocedure)
   is distinct from 'ae9a75327090d06a46456efce17625a3 {postgres=X/postgres,service_role=X/postgres}'
  or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('consume_session_csrf_v1','consume_session_csrf_v2'))<>2 then
  raise exception using errcode='55000',message='session csrf purpose kinds successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
