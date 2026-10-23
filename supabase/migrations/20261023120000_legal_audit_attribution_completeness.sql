-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows PR 324's migrations (20261016180000 to
-- 20261016221000), whose bodies it checks, and 20261023110000.
-- =====================================================================
--
-- G5.6, legal-audit attribution (owner decision of 23 October 2026, item 4 of
-- "Export completeness"; the attribution design of 28 September 2026, option
-- A, and its one nonce rule, brief X1.5). An event names its actor only when
-- its own transaction proves one: a consumed session-bound operation nonce,
-- or the person's own JWT. Three gaps are closed here.
--
--   1. Nine writers consumed no nonce, so the events they write could never
--      name the person who acted: declare_jurisdiction_v2,
--      declare_chromosomal_sex_v1, pause_, resume_ and stop_family_sharing_v1,
--      revoke_directional_purpose_v1, acknowledge_portrait_v1,
--      create_adult_subject_invitation_v1, and the pause and resume of the
--      subject-sharing route. Each now has a service-only door that records
--      the hash of the nonce its page rendered in
--      public.account_operation_nonces, in the same transaction and before
--      the writer runs, then runs the unchanged writer. A replayed nonce
--      writes nothing. The subject-sharing stop already recorded its nonce;
--      item 2 lets the ledger see it.
--   2. A nonce recorded already consumed (subject delete, subject transfer,
--      subject-sharing stop, and the new subject-sharing pause and resume)
--      was never seen: the attribution trigger fired on an update of
--      consumed_at only. It now fires on such an insert too.
--   3. PR 324's eight person-caused event codes join the closed list, each
--      bound to the account route that writes it. The rights-session variant
--      of the reaffirmation (api.consent-reaffirm-rights) stays off it: the
--      rights-session actors wait on the owner and counsel.
--
-- Pattern: the operation check is widened by reading the values it holds, as
-- PR 324 does; existing bodies are patched in place, md5-guarded with their
-- exact reviewed ACL, one anchor each, with the successor md5 and unchanged
-- ACL asserted (55000 otherwise). No table, column, audit event, writer body
-- or wording changes; the writers themselves are untouched.

do $predecessor$
begin
 if to_regprocedure('private.note_legal_audit_actor_from_nonce_v1()') is null
  or to_regprocedure('private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)') is null
  or to_regprocedure('private.legal_audit_person_event_v1(text,text)') is null
  or exists(select 1 from pg_trigger where tgrelid='public.account_operation_nonces'::regclass
   and tgname='legal_audit_actor_on_consumed_insert') then
  raise exception using errcode='55000',message='attribution completeness prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The operation check gains the new operations and keeps every value it
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
 if v_now is null or not ('subject_transfer'=any(v_now)) then
  raise exception using errcode='55000',message='account operation check unreadable'; end if;
 select array_agg(distinct v order by v) into v_values from unnest(v_now||array['jurisdiction_declare','chromosomal_sex_declare',
  'family_sharing_pause','family_sharing_resume','family_sharing_stop','consent_revoke','portrait_acknowledge',
  'adult_invitation_create','subject_sharing_pause','subject_sharing_resume']) v;
 alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
 execute format('alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check'
  ' check (operation in (%s))',(select string_agg(quote_literal(v),',' order by v) from unnest(v_values) v));
end;
$widen$;

-- The one-time account operation nonce of an account-level writer: the page
-- rendered it for this account, session, operation and target; the route has
-- verified its MAC; this records its hash once and marks it consumed, which
-- names the account as the transaction's actor (legal_audit_actor_on_consume).
create function private.consume_account_operation_nonce_v1(p_account_id uuid,p_session_id uuid,p_operation text,
 p_nonce_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();
begin
 if p_account_id is null or p_session_id is null or p_operation is null
  or p_operation not in ('jurisdiction_declare','chromosomal_sex_declare','family_sharing_pause','family_sharing_resume',
   'family_sharing_stop','consent_revoke','portrait_acknowledge','adult_invitation_create')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>v_now);
 if not found then raise exception using errcode='42501',message='operation unavailable'; end if;
 delete from public.account_operation_nonces where operation=p_operation and expires_at<=v_now;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(p_nonce_hash,p_account_id,p_session_id,p_operation,p_expires_at)
 on conflict(nonce_hash) do nothing;
 if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 update public.account_operation_nonces set consumed_at=v_now where nonce_hash=p_nonce_hash;
end $$;
revoke all on function private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The doors. Each consumes the nonce first, then runs the unchanged writer in
-- the same transaction, so the writer's own audit event names the account.
create function public.declare_jurisdiction_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_code text,p_subdivision text,
 p_attestation_version integer,p_attestation_sha256 text,p_test_jurisdiction boolean,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'jurisdiction_declare',p_nonce_hash,p_nonce_expires_at);
 return public.declare_jurisdiction_v2(p_account_id,p_session_id,p_code,p_subdivision,p_attestation_version,
  p_attestation_sha256,p_test_jurisdiction);
end $$;

create function public.declare_chromosomal_sex_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_chromosomal_sex text,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'chromosomal_sex_declare',p_nonce_hash,p_nonce_expires_at);
 return public.declare_chromosomal_sex_v1(p_account_id,p_subject_id,p_chromosomal_sex);
end $$;

create function public.pause_family_sharing_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_counterpart_account_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'family_sharing_pause',p_nonce_hash,p_nonce_expires_at);
 return public.pause_family_sharing_v1(p_account_id,p_counterpart_account_id);
end $$;

create function public.resume_family_sharing_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_counterpart_account_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'family_sharing_resume',p_nonce_hash,p_nonce_expires_at);
 return public.resume_family_sharing_v1(p_account_id,p_counterpart_account_id);
end $$;

create function public.stop_family_sharing_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_counterpart_account_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns table(ended_at timestamptz,deleted_counts jsonb) language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'family_sharing_stop',p_nonce_hash,p_nonce_expires_at);
 return query select x.ended_at,x.deleted_counts from public.stop_family_sharing_v1(p_account_id,p_counterpart_account_id) x;
end $$;

create function public.revoke_directional_purpose_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_grant_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);
 return public.revoke_directional_purpose_v1(p_account_id,p_grant_id);
end $$;

create function public.acknowledge_portrait_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'portrait_acknowledge',p_nonce_hash,p_nonce_expires_at);
 return public.acknowledge_portrait_v1(p_account_id,p_subject_id);
end $$;

create function public.create_adult_subject_invitation_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_contact_ciphertext bytea,p_contact_hmac text,p_idempotency_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb,p_quota_keys jsonb,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns table(invitation_id uuid,subject_id uuid,expires_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'adult_invitation_create',p_nonce_hash,p_nonce_expires_at);
 return query select x.invitation_id,x.subject_id,x.expires_at from public.create_adult_subject_invitation_v1(p_account_id,
  p_contact_ciphertext,p_contact_hmac,p_idempotency_key,p_test_jurisdiction,p_contact_hmac_set,p_quota_keys) x;
end $$;

-- The subject-sharing route's pause and resume take the one-time code its
-- page issued for that route and that record, as its stop does.
create function public.pause_subject_sharing_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_counterpart_account_id uuid,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
begin
 if p_account_id is null or p_counterpart_account_id is null or p_subject_id is null
  or p_account_id=p_counterpart_account_id then
  raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform 1 from public.subjects s where s.id=p_subject_id and s.subject_account_id=p_counterpart_account_id
  and s.subject_class in ('self','other_adult') and s.lifecycle in ('active','claimed_bound')
 for share;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_sharing_pause',
  p_subject_id,p_nonce_hash,p_nonce_expires_at);
 return public.pause_family_sharing_v1(p_account_id,p_counterpart_account_id);
end $$;

create function public.resume_subject_sharing_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_counterpart_account_id uuid,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
begin
 if p_account_id is null or p_counterpart_account_id is null or p_subject_id is null
  or p_account_id=p_counterpart_account_id then
  raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform 1 from public.subjects s where s.id=p_subject_id and s.subject_account_id=p_counterpart_account_id
  and s.subject_class in ('self','other_adult') and s.lifecycle in ('active','claimed_bound')
 for share;
 if not found then raise exception using errcode='42501',message='family sharing authority is unavailable'; end if;
 perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_sharing_resume',
  p_subject_id,p_nonce_hash,p_nonce_expires_at);
 return public.resume_family_sharing_v1(p_account_id,p_counterpart_account_id);
end $$;

do $grants$
declare f text;
begin
 foreach f in array array[
  'public.declare_jurisdiction_with_nonce_v1(uuid,uuid,text,text,integer,text,boolean,text,timestamptz)',
  'public.declare_chromosomal_sex_with_nonce_v1(uuid,uuid,uuid,text,text,timestamptz)',
  'public.pause_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.resume_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.stop_family_sharing_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.revoke_directional_purpose_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.acknowledge_portrait_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)',
  'public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)',
  'public.pause_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)',
  'public.resume_subject_sharing_v1(uuid,uuid,uuid,uuid,text,timestamptz)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end;
$grants$;

-- 2. A nonce recorded already consumed is seen too.
create trigger legal_audit_actor_on_consumed_insert after insert on public.account_operation_nonces
 for each row when (new.consumed_at is not null) execute function private.note_legal_audit_actor_from_nonce_v1();

-- Guarded in-place patches.
do $patch_attribution$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The subject operation recorder accepts the subject-sharing pause and resume.
  (1,'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)','9539afdc5057346d44c1b8cd826b7ee2',
   '71a7ae8e88edc449ddf24e28973c1a14','{postgres=X/postgres}',
   $old$p_operation not in ('subject_sharing_stop','subject_delete','subject_transfer')$old$,
   $new$p_operation not in ('subject_sharing_stop','subject_delete','subject_transfer','subject_sharing_pause','subject_sharing_resume')$new$,
   'subject operation nonce recorder'),
  -- 3. PR 324's person-caused events, each on the account route that writes it.
  (2,'private.legal_audit_person_event_v1(text,text)','b566386791e9736ef744924a2d4d3039','56990e96581e5dc415222f44f09b5ac0','{postgres=X/postgres}',
   $old$    or (p_route_id='api.future-person-identity-profile' and p_event_code in (
      'embryo.identity_profile_saved','embryo.identity_profile_deleted'));$old$,
   $new$    or (p_route_id='api.future-person-identity-profile' and p_event_code in (
      'embryo.identity_profile_saved','embryo.identity_profile_deleted'))
    -- 20261023120000: PR 324's person-caused events.
    or coalesce((p_route_id,p_event_code) in (values ('api.consents-revoke-all','consents.revoked-all'),
      ('api.consent-reaffirm','purpose.reaffirmed'),('api.adult-subject-bind','subject.account-bound'),
      ('api.subject-delete','subject.deleted'),('api.subject-delete','subject.emptied'),
      ('api.subject-transfer','subject.ownership_transferred'),('api.subject-drafts','subject-draft.created'),
      ('api.subject-download','download.session.created')),false);$new$,
   'person event list')
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
$patch_attribution$;

notify pgrst, 'reload schema';
