-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261023120000, whose consumer it patches,
-- and PR 324's 20261016190000, 20261016191000 and 20261016207000, whose
-- bodies it checks.
-- =====================================================================
--
-- G5.6, the last four of PR 324's person-caused event codes (owner decision
-- of 23 October 2026, item 4 of "Export completeness"; the attribution
-- design of 28 September 2026, option A, and its one nonce rule, brief
-- X1.5). An event names its actor only when its own transaction proves one:
-- a consumed session-bound nonce, or the person's own JWT.
--
--   * purpose.reaffirmed (api.consent-reaffirm) already does: each grant
--     function the reaffirmation re-runs records the presentation's
--     single-use nonce in public.purpose_grant_nonces for the account, and
--     that insert names it. Nothing changes here.
--   * subject.account-bound (api.adult-subject-bind) named no one: its one
--     nonce, the rights session's, was recorded with no account. The bind
--     now records that same nonce once, with the signed-in account and its
--     auth session, through private.adult_subject_control_for_account_v1,
--     a copy of private.adult_subject_control_v1 derived from its reviewed
--     body that differs only in those two values. The rights-session routes
--     keep private.adult_subject_control_v1 unchanged.
--   * subject-draft.created (api.subject-drafts, both Path B bodies) named
--     no one: the page token was verified and never recorded. The page now
--     renders a one-time account operation nonce in its place, and two
--     doors record its hash before the unchanged draft writers run.
--   * download.session.created (api.subject-download) named no one: the
--     create step had no nonce. It now takes one, recorded by a door before
--     the unchanged writer.
--
-- Pattern: as 20261023120000. The operation check is widened by reading the
-- values it holds; existing bodies are patched in place, md5-guarded with
-- their exact reviewed ACL, one anchor each, with the successor md5 and
-- unchanged ACL asserted (55000 otherwise). No table, column, audit event or
-- wording changes; the writers themselves are untouched.

do $predecessor$
begin
 if to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)') is null
  or to_regprocedure('private.adult_subject_control_v1(text,text,text,text,boolean)') is null
  or to_regprocedure('public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)') is null
  or to_regprocedure('public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)') is null
  or to_regprocedure('public.create_path_b_reviewed_document_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)') is null
  or to_regprocedure('public.open_subject_original_download_v1(uuid,uuid,uuid,uuid,text)') is null
  or not exists(select 1 from pg_trigger where tgrelid='public.account_operation_nonces'::regclass
   and tgname='legal_audit_actor_on_consumed_insert')
  or not exists(select 1 from pg_trigger where tgrelid='public.embryo_operation_nonces'::regclass
   and tgname='legal_audit_actor_on_consume')
  or to_regprocedure('private.adult_subject_control_for_account_v1(text,text,text,text,boolean,uuid,uuid)') is not null then
  raise exception using errcode='55000',message='attribution remaining prerequisite differs'; end if;
end;
$predecessor$;

-- 1. The operation check gains the two new operations and keeps every value
-- it holds now, read as 20261023120000 reads it.
do $widen$
declare v_def text; v_now text[]; v_values text[];
begin
 select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
 where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';
 select array_agg(v) into v_now from (
  select m[1] v from regexp_matches(v_def,'''([a-z_]+)''::text','g') m
  union all
  select unnest(string_to_array((regexp_match(v_def,'''\{([a-z_,]+)\}''::text\[\]'))[1],','))) s;
 if v_now is null or not ('adult_invitation_create'=any(v_now)) then
  raise exception using errcode='55000',message='account operation check unreadable'; end if;
 select array_agg(distinct v order by v) into v_values from unnest(v_now||array['path_b_draft_create',
  'subject_download_open']) v;
 alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
 execute format('alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check'
  ' check (operation in (%s))',(select string_agg(quote_literal(v),',' order by v) from unnest(v_values) v));
end;
$widen$;

-- 2. The bind's rights-session nonce, recorded with the signed-in account.
-- Derived from the reviewed body of private.adult_subject_control_v1: three
-- anchors, each exactly once, and the result's md5 asserted.
do $derive$
declare definition text;
begin
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 where p.oid='private.adult_subject_control_v1(text,text,text,text,boolean)'::regprocedure
  and md5(pg_get_functiondef(p.oid))='f6201a3830d82dcd8a95d2b8487b59ad' and p.proacl::text='{postgres=X/postgres}';
 if definition is null then raise exception using errcode='55000',message='adult subject control predecessor differs';end if;
 if (select count(*) from (values
   ('CREATE OR REPLACE FUNCTION private.adult_subject_control_v1(p_session_hash text, p_nonce text, p_action text, p_route_id text, p_test_jurisdiction boolean)'),
   (' if p_test_jurisdiction is distinct from true or p_session_hash is null'),
   ('consume_embryo_operation_nonce_v1(p_nonce,null,null,')) a(fragment)
   where (length(definition)-length(replace(definition,a.fragment,'')))/length(a.fragment)=1)<>3 then
  raise exception using errcode='55000',message='adult subject control anchor differs';end if;
 definition:=replace(definition,
  'CREATE OR REPLACE FUNCTION private.adult_subject_control_v1(p_session_hash text, p_nonce text, p_action text, p_route_id text, p_test_jurisdiction boolean)',
  'CREATE FUNCTION private.adult_subject_control_for_account_v1(p_session_hash text, p_nonce text, p_action text, p_route_id text, p_test_jurisdiction boolean, p_account_id uuid, p_auth_session_id uuid)');
 definition:=replace(definition,' if p_test_jurisdiction is distinct from true or p_session_hash is null',
  ' if p_account_id is null or p_auth_session_id is null'||E'\n'||'  or p_test_jurisdiction is distinct from true or p_session_hash is null');
 definition:=replace(definition,'consume_embryo_operation_nonce_v1(p_nonce,null,null,',
  'consume_embryo_operation_nonce_v1(p_nonce,p_account_id,p_auth_session_id,');
 execute definition;
 execute 'revoke all on function private.adult_subject_control_for_account_v1(text,text,text,text,boolean,uuid,uuid)'
  ' from public,anon,authenticated,inherit_upload_only,service_role';
 if not exists(select 1 from pg_proc p
   where p.oid='private.adult_subject_control_for_account_v1(text,text,text,text,boolean,uuid,uuid)'::regprocedure
    and md5(pg_get_functiondef(p.oid))='b1e3b29ba8d18d67e1a16aefaf929550' and p.proacl::text='{postgres=X/postgres}') then
  raise exception using errcode='55000',message='adult subject control derivation differs';end if;
end;
$derive$;

-- 3. The doors. Each records the page's nonce first, then runs the unchanged
-- writer in the same transaction, so the writer's own audit event names the
-- account; a replayed nonce writes nothing.
create function public.create_path_b_adult_draft_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_display_name text,p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,
 p_test_jurisdiction boolean,p_contact_hmac_set jsonb,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'path_b_draft_create',p_nonce_hash,p_nonce_expires_at);
 return public.create_path_b_adult_draft_v1(p_account_id,p_session_id,p_display_name,p_date_of_birth,
  p_contact_ciphertext,p_contact_hmac,p_request_key,p_test_jurisdiction,p_contact_hmac_set);
end $$;

create function public.create_path_b_reviewed_document_draft_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_display_name text,p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,
 p_test_jurisdiction boolean,p_contact_hmac_set jsonb,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'path_b_draft_create',p_nonce_hash,p_nonce_expires_at);
 return public.create_path_b_reviewed_document_draft_v1(p_account_id,p_session_id,p_display_name,p_date_of_birth,
  p_contact_ciphertext,p_contact_hmac,p_request_key,p_test_jurisdiction,p_contact_hmac_set);
end $$;

create function public.open_subject_original_download_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_file_id uuid,p_cookie_hash text,p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'subject_download_open',p_nonce_hash,p_nonce_expires_at);
 return public.open_subject_original_download_v1(p_account_id,p_session_id,p_subject_id,p_file_id,p_cookie_hash);
end $$;

do $grants$
declare f text;
begin
 foreach f in array array[
  'public.create_path_b_adult_draft_with_nonce_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb,text,timestamptz)',
  'public.create_path_b_reviewed_document_draft_with_nonce_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb,text,timestamptz)',
  'public.open_subject_original_download_with_nonce_v1(uuid,uuid,uuid,uuid,text,text,timestamptz)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end;
$grants$;

-- 4. Guarded in-place patches.
do $patch_attribution_remaining$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The consumer accepts the two new operations.
  (1,'private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','24176df7a1411cc624697c7c2596af36',
   '933df95029c3f1f8a9a306726fccccff','{postgres=X/postgres}',
   $old$'family_sharing_stop','consent_revoke','portrait_acknowledge','adult_invitation_create')$old$,
   $new$'family_sharing_stop','consent_revoke','portrait_acknowledge','adult_invitation_create',
   'path_b_draft_create','subject_download_open')$new$,
   'account operation nonce consumer'),
  -- The bind records its one nonce with the signed-in account.
  (2,'public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','a7375f589e70ff54ced2b5b1d34b69cd',
   '159a4f50563935de05351b8ef320c6f8','{postgres=X/postgres,service_role=X/postgres}',
   $old$ c:=private.adult_subject_control_v1(p_session_hash,p_nonce,'bind-account','api.adult-subject-bind',p_test_jurisdiction);$old$,
   $new$ -- 20261023130000: the rights session's one nonce is recorded with this
 -- account and its auth session, which names the account on the bind's event.
 c:=private.adult_subject_control_for_account_v1(p_session_hash,p_nonce,'bind-account','api.adult-subject-bind',
  p_test_jurisdiction,p_account_id,p_auth_session_id);$new$,
   'adult subject bind')
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
$patch_attribution_remaining$;

notify pgrst, 'reload schema';
