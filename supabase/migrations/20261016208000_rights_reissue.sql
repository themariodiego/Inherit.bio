-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. The request door refuses without the test-jurisdiction
-- flag: every principal it can match exists only under TEST-LOCAL today.
-- =====================================================================
--
-- api.rights-reissue (register; G2.1 "Build all 24"; owner decision
-- 2026-10-22, "Routes that need unapproved mail or notice text"):
-- rights-credential-reissue-v1. A person with no account who lost the link
-- to their rights page asks for a new one by email address.
--
-- BUILT WITHOUT MAIL. The lookup and the candidate are built; no outbox row
-- is enqueued, because the recovery mail has no approved template. So no
-- raw token is ever created or delivered, and nothing reaches the activation
-- branch below until a template and its mail issuer exist.
--
--   1. private.rights_reissue_form_nonces spends the page's one-time form
--      nonce once, for its ten-minute lifetime.
--   2. public.request_rights_reissue_v1 counts the owner's limits first, in
--      the existing securityRateLimitContract buckets: 3 an hour per contact,
--      10 an hour per network and 1000 an hour for the whole service
--      (global-capacity). It then spends the form nonce. A limited request
--      stops there. Otherwise it matches the keyed contact digests against
--      current contact HMAC indexes of current contact references whose
--      principal is active and has no account (account_id is null), and for
--      each match whose eventual rights purpose and target are current
--      (private.rights_recovery_target_v1), replaces that principal's live
--      candidate with one new hash-only, non-authorizing candidate bound to
--      the principal, purpose, target, authority revision and existing fixed
--      deadline. It never touches a source credential, rights session or
--      nonce. Match, no match and limited all return to the route, which
--      answers them identically.
--   3. private.rights_recovery_candidates holds at most one live candidate
--      per principal (a partial unique index). Its token_hash_id stays null
--      until a mail issuer exists.
--   4. public.activate_rights_session_v1 is patched in place (md5-guarded,
--      the pattern of 20261016195000) so a token hash that belongs to an
--      issued recovery candidate is exchanged by
--      private.activate_rights_recovery_v1: it locks and rechecks the
--      principal, target, authority revision and deadline, requires the
--      eventual session purpose to be registered, spends the form nonce,
--      consumes the token and candidate, revokes every other candidate and
--      every active session of that principal and purpose, and mints one new
--      purpose-bound session clamped to the deadline. Any mismatch returns
--      nothing and revokes nothing. Every other token hash takes exactly the
--      existing path.
--
-- One eventual purpose has live principals: adult-subject-control, for a
-- person who confirmed a Path B request with no account. The recovery branch
-- is therefore that purpose's credential issuer, built closed (owner decision
-- 2026-10-22): no rights_session_purposes row registers it (20261016202000),
-- so the activation refuses even a delivered candidate and the purpose
-- trigger would refuse its session. The register's other two eventual
-- purposes are not matched: adult-withdrawal has no registered session
-- purpose, and no genetic parent without an account can be active
-- (subject_principals_identity_check). Their candidates are not admitted.

do $predecessor$
begin
 if to_regprocedure('public.activate_rights_session_v1(text,text,text)') is null
  or to_regprocedure('private.consume_rate_limit_buckets_v1(text,jsonb,jsonb)') is null
  or to_regprocedure('private.resolve_hmac_set_v1(text,text,jsonb)') is null
  or to_regprocedure('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or to_regclass('public.contact_hmac_indexes') is null then
  raise exception using errcode='55000',message='rights reissue prerequisite missing'; end if;
 if to_regclass('private.rights_recovery_candidates') is not null
  or to_regclass('private.rights_reissue_form_nonces') is not null
  or to_regprocedure('public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean)') is not null
  or to_regprocedure('private.activate_rights_recovery_v1(text,text,text)') is not null then
  raise exception using errcode='55000',message='rights reissue successor already exists'; end if;
end;
$predecessor$;

create table private.rights_reissue_form_nonces (
 nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null
);
create index rights_reissue_form_nonces_expiry_idx on private.rights_reissue_form_nonces (expires_at);

create table private.rights_recovery_candidates (
 id uuid primary key default gen_random_uuid(),
 principal_id uuid not null references public.subject_principals(id) on delete cascade,
 eventual_purpose text not null check (eventual_purpose='adult-subject-control'),
 target_kind text not null check (target_kind='subject'),
 target_id uuid not null,
 authority_revision bigint not null check (authority_revision > 0),
 fixed_deadline timestamptz not null,
 status text not null default 'pending' check (status in ('pending','issued','consumed','replaced','revoked','expired')),
 token_hash_id uuid references public.token_hashes(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 ended_at timestamptz,
 check (expires_at > created_at and expires_at <= fixed_deadline and expires_at <= created_at + interval '24 hours'),
 check ((status in ('pending','issued')) = (ended_at is null)),
 check (status <> 'issued' or token_hash_id is not null)
);
create unique index rights_recovery_candidates_one_live on private.rights_recovery_candidates (principal_id)
 where status in ('pending','issued');
create unique index rights_recovery_candidates_token on private.rights_recovery_candidates (token_hash_id)
 where token_hash_id is not null;

do $private$
declare table_name text;
begin
 foreach table_name in array array['rights_reissue_form_nonces','rights_recovery_candidates'] loop
  execute format('alter table private.%I enable row level security', table_name);
  execute format('revoke all on private.%I from public, anon, authenticated, service_role, inherit_upload_only', table_name);
 end loop;
end
$private$;

-- The eventual purpose, target, authority revision and existing fixed
-- deadline of one principal, or null when nothing current can be reissued.
create function private.rights_recovery_target_v1(p_principal_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.subject_principals%rowtype; s public.subjects%rowtype; v_deadline timestamptz;
 v_now timestamptz:=clock_timestamp();
begin
 select * into p from public.subject_principals where id=p_principal_id and status='active' and account_id is null;
 if p.id is null or p.principal_kind<>'non_account_subject' then return null; end if;
 select * into s from public.subjects where id=p.subject_id;
 if s.id is null or s.subject_class<>'other_adult' or s.lifecycle<>'active' or s.subject_account_id is not null
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id and d.state='confirmed'
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document')) then return null; end if;
 -- The record is kept only while one of its confirmed files has a live
 -- 730-day clock; the latest of those clocks is the fixed deadline.
 select max(rr.fixed_deadline) into v_deadline from public.upload_sessions us
 join public.retention_rows rr on rr.retention_id='adult.non-account-holder-24mo' and rr.target_kind='upload_session'
  and rr.target_id=us.id and rr.state in ('scheduled','active')
 where us.subject_id=s.id and us.upload_authority_kind='other-adult-held';
 if v_deadline is null or v_deadline<=v_now then return null; end if;
 return jsonb_build_object('purpose','adult-subject-control','targetKind','subject','targetId',s.id,
  'authorityRevision',p.principal_revision,'deadline',v_deadline);
end $$;
revoke all on function private.rights_recovery_target_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function public.request_rights_reissue_v1(p_form_nonce_hash text,p_contact_digests jsonb,
 p_identifier_digests jsonb,p_network_digests jsonb,p_global_digests jsonb,p_test_jurisdiction boolean)
returns text language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare v_now timestamptz:=clock_timestamp(); v_identifiers jsonb; v_networks jsonb; v_globals jsonb; v_contacts jsonb;
 v_keys jsonb:='{}'::jsonb; v_pair record; v_allowed boolean; v_spent integer; m record; t jsonb; v_created integer:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_form_nonce_hash is null or p_form_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='rights reissue request invalid'; end if;
 -- Buckets first (securityRateLimitContract.decisionOrder).
 v_identifiers:=private.resolve_hmac_set_v1('rate-limit',null,p_identifier_digests);
 v_networks:=private.resolve_hmac_set_v1('rate-limit',null,p_network_digests);
 v_globals:=private.resolve_hmac_set_v1('rate-limit',null,p_global_digests);
 for v_pair in select e.key,e.value from jsonb_each_text(coalesce(v_identifiers,'{}'::jsonb)) e loop
  v_keys:=v_keys||jsonb_build_object(v_pair.key,jsonb_build_object('normalized-identifier',v_pair.value,
   'source-network',v_networks->>v_pair.key,'global-capacity',v_globals->>v_pair.key));
 end loop;
 v_allowed:=private.consume_rate_limit_buckets_v1('api.rights-reissue',jsonb_build_array(
  jsonb_build_object('dimension','normalized-identifier','windowSeconds',3600,'limit',3),
  jsonb_build_object('dimension','source-network','windowSeconds',3600,'limit',10),
  jsonb_build_object('dimension','global-capacity','windowSeconds',3600,'limit',1000)),v_keys);
 -- The form nonce is spent whether or not the request is within its limits.
 delete from private.rights_reissue_form_nonces n where n.expires_at<=v_now;
 insert into private.rights_reissue_form_nonces(nonce_hash,expires_at) values(p_form_nonce_hash,v_now+interval '10 minutes')
 on conflict(nonce_hash) do nothing;
 get diagnostics v_spent=row_count;
 if v_spent=0 then return 'replayed'; end if;
 if not v_allowed then return 'received'; end if;

 v_contacts:=private.resolve_hmac_set_v1('contact',null,p_contact_digests);
 perform private.lock_invitation_transitions_v1();
 for m in
  select distinct p.id as principal_id
  from jsonb_each_text(v_contacts) d
  join public.contact_hmac_indexes ci on ci.hmac_key_revision=d.key::bigint and ci.contact_hmac=d.value
   and ci.status='current' and ci.expires_at>v_now
  join public.encrypted_contact_references ecr on ecr.id=ci.contact_reference_id and ecr.status='current'
  join public.subject_principals p on p.id=ecr.principal_id and p.status='active' and p.account_id is null
  order by p.id
 loop
  t:=private.rights_recovery_target_v1(m.principal_id);
  if t is null then continue; end if;
  perform 1 from public.subject_principals where id=m.principal_id for share;
  update private.rights_recovery_candidates set status='replaced',ended_at=v_now
   where principal_id=m.principal_id and status in ('pending','issued');
  insert into private.rights_recovery_candidates(principal_id,eventual_purpose,target_kind,target_id,authority_revision,
   fixed_deadline,expires_at)
  values(m.principal_id,t->>'purpose',t->>'targetKind',(t->>'targetId')::uuid,(t->>'authorityRevision')::bigint,
   (t->>'deadline')::timestamptz,least(v_now+interval '24 hours',(t->>'deadline')::timestamptz));
  v_created:=v_created+1;
 end loop;
 -- No outbox row: the recovery mail has no approved template. Nothing about
 -- the match is recorded outside the candidate itself.
 return 'received';
end $$;
revoke all on function public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.request_rights_reissue_v1(text,jsonb,jsonb,jsonb,jsonb,boolean) to service_role;

create function private.activate_rights_recovery_v1(p_token_hash text,p_session_hash text,p_form_nonce text)
returns table(purpose text,target_kind text,target_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
#variable_conflict use_column
declare v_now timestamptz; v_token public.token_hashes%rowtype; v_candidate private.rights_recovery_candidates%rowtype;
 t jsonb; v_expiry timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'
  or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return; end if;
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 select th.* into v_token from public.token_hashes th where th.token_hash=p_token_hash for update;
 select rc.* into v_candidate from private.rights_recovery_candidates rc where rc.token_hash_id=v_token.id for update;
 if v_token.id is null or v_candidate.id is null or v_token.status<>'current' or v_token.ended_at is not null
  or v_candidate.status<>'issued' or v_candidate.expires_at<=v_now or v_candidate.fixed_deadline<=v_now then return; end if;
 perform 1 from public.subject_principals sp where sp.id=v_candidate.principal_id for update;
 t:=private.rights_recovery_target_v1(v_candidate.principal_id);
 if t is null or (t->>'purpose',t->>'targetKind',t->>'targetId',t->>'authorityRevision')
   is distinct from (v_candidate.eventual_purpose,v_candidate.target_kind,v_candidate.target_id::text,
    v_candidate.authority_revision::text)
  or (t->>'deadline')::timestamptz<v_candidate.fixed_deadline then return; end if;
 -- The eventual session must be one this deployment can issue; until its
 -- issuer exists, nothing is spent or revoked.
 if v_candidate.eventual_purpose<>'adult-subject-control' or v_candidate.target_kind<>'subject' then return; end if;
 if not exists(select 1 from private.rights_session_purposes rsp where rsp.session_purpose=v_candidate.eventual_purpose
   and rsp.target_kind=v_candidate.target_kind) then return; end if;
 perform private.consume_embryo_operation_nonce_v1(p_form_nonce,null,null,'rights_activate','form',null);
 v_expiry:=least(v_now+interval '60 minutes',v_candidate.expires_at,v_candidate.fixed_deadline);
 update public.rights_sessions rs set status='revoked',ended_at=v_now
  where rs.principal_id=v_candidate.principal_id and rs.purpose='adult-subject-control' and rs.status='active';
 update private.rights_recovery_candidates rc set status='revoked',ended_at=v_now
  where rc.principal_id=v_candidate.principal_id and rc.id<>v_candidate.id and rc.status in ('pending','issued');
 update private.rights_recovery_candidates rc set status='consumed',ended_at=v_now where rc.id=v_candidate.id;
 update public.token_hashes th set status='consumed',ended_at=v_now where th.id=v_token.id;
 insert into public.rights_sessions(token_hash_id,principal_id,purpose,target_kind,target_id,authority_revision,
  session_hash,status,expires_at,created_at,last_activity_at)
 values(v_token.id,v_candidate.principal_id,'adult-subject-control','subject',v_candidate.target_id,
  v_candidate.authority_revision,p_session_hash,'active',v_expiry,v_now,v_now);
 perform private.append_legal_audit_event('rights.session.activated',null,'api.rights-activate','accepted',
  jsonb_build_object('purpose',v_candidate.eventual_purpose,'source','rights-recovery'));
 return query select v_candidate.eventual_purpose,v_candidate.target_kind,v_candidate.target_id,v_expiry;
end $$;
revoke all on function private.activate_rights_recovery_v1(text,text,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The activation door: a recovery token takes the branch above, every other
-- token exactly the existing path.
do $patch_activation$
declare target regprocedure:='public.activate_rights_session_v1(text,text,text)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$begin
 select information.* into request from private.public_appeal_information_requests information$old$;
 new_fragment text:=$new$begin
 if exists(select 1 from public.token_hashes recovery_token join private.rights_recovery_candidates recovery_candidate
   on recovery_candidate.token_hash_id=recovery_token.id where recovery_token.token_hash=p_token_hash) then
  return query select * from private.activate_rights_recovery_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;
 select information.* into request from private.public_appeal_information_requests information$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='b9dcb56fbe06146e7b55e98f5f68a25b';
 if definition is null then raise exception using errcode='55000',message='rights activation predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='rights activation anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='f4c47723ec1c65454514a5b8d08ec0e0'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='rights activation successor differs'; end if;
end;
$patch_activation$;

notify pgrst, 'reload schema';
