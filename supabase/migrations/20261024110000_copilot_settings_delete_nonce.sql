-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261023130000, whose consumer it patches,
-- and 20260907081757, whose removal writer it wraps unchanged.
-- =====================================================================
--
-- G8.5, api.llm-settings (owner decision of 23 October 2026, "G8.5: forms,
-- CSRF, the server action and the Resend webhook", item 1: the DELETE reads
-- the registered nonce). The register's DELETE requires
-- X-Inherit-Operation-Nonce, and its transaction "consume[s] the distinct
-- current session-bound operation nonce" before it deletes the setting and
-- its key and revokes the permission (mutationSecurityBindings
-- .destructiveBindings, operation provider-setting-and-cloud-authority-
-- delete). Until now nothing read or recorded one.
--
--   1. The operation check gains provider_setting_delete and keeps every
--      value it holds, read the way 20261023120000 reads it.
--   2. One service-only door, public.remove_own_copilot_settings_with_nonce_v1,
--      records the hash of the nonce /settings/copilot rendered, through
--      private.consume_account_operation_nonce_v1, in the same transaction
--      and before the unchanged writer public.remove_own_copilot_settings_v1
--      runs. A replayed or foreign nonce writes nothing.
--   3. The consumer accepts the new operation: patched in place,
--      md5-guarded with its exact reviewed ACL, one anchor, with the
--      successor md5 and unchanged ACL asserted (55000 otherwise).
--
-- No table, column, audit event, writer body or wording changes.

do $predecessor$
begin
 if to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)') is null
  or to_regprocedure('public.remove_own_copilot_settings_v1(uuid,uuid)') is null
  or not exists(select 1 from pg_proc p where p.oid='public.remove_own_copilot_settings_v1(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='f45c9a8b18e64acc5b3e13612f1d6d86'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or to_regprocedure('public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz)') is not null then
  raise exception using errcode='55000',message='copilot settings delete nonce prerequisite differs'; end if;
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
 if v_now is null or not ('subject_download_open'=any(v_now)) or 'provider_setting_delete'=any(v_now) then
  raise exception using errcode='55000',message='account operation check unreadable'; end if;
 select array_agg(distinct v order by v) into v_values from unnest(v_now||array['provider_setting_delete']) v;
 alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
 execute format('alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check'
  ' check (operation in (%s))',(select string_agg(quote_literal(v),',' order by v) from unnest(v_values) v));
end;
$widen$;

-- 2. The door. It consumes the nonce first, then runs the unchanged writer
-- in the same transaction: the setting, its key and every permission and
-- context token bound to it go together, or nothing does.
create function public.remove_own_copilot_settings_with_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'provider_setting_delete',p_nonce_hash,p_nonce_expires_at);
 return public.remove_own_copilot_settings_v1(p_account_id,p_session_id);
end $$;
revoke all on function public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.remove_own_copilot_settings_with_nonce_v1(uuid,uuid,text,timestamptz) to service_role;

-- 3. Guarded in-place patch.
do $patch_copilot_delete_nonce$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  -- The consumer accepts the new operation.
  (1,'private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','933df95029c3f1f8a9a306726fccccff',
   '6869593d67ff37d93a6d4caea62f01c3','{postgres=X/postgres}',
   $old$   'path_b_draft_create','subject_download_open')$old$,
   $new$   'path_b_draft_create','subject_download_open','provider_setting_delete')$new$,
   'account operation nonce consumer')
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
$patch_copilot_delete_nonce$;

notify pgrst, 'reload schema';
