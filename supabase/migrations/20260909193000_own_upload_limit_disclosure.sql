-- Read-only disclosure of the deployment's own-upload ceilings and the
-- account's own reserved total, so a refusal can name the limit it hit.
-- Additive only: no existing function, limit, admission state or authority
-- changes here, and nothing new is writable. The reservation arithmetic is
-- copied from `private.issue_own_storage_upload_v1` deliberately, so a
-- disclosed remainder and an actual refusal cannot disagree.
--
-- `public.upload_sessions.maximum_decoded_bytes` is set by issuance to the
-- same per-format ceiling returned here, so a compressed source is measured
-- against this one number twice: once as stored bytes at issuance, and again
-- as decompressed bytes during finalization. There is no second limit.
create function private.own_upload_limits_v1(p_account_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare limits private.upload_authorization_config%rowtype; v_reserved numeric; v_active bigint;
begin
 if p_account_id is null or p_session_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- A live session of this exact account only. This discloses deployment
 -- capacity and one account's own byte total, never another account's.
 if not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>clock_timestamp())) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 select v_reserved+coalesce(sum(expected_size),0),count(*) into v_reserved,v_active
  from public.upload_sessions where account_id=p_account_id
  and status in('issued','uploaded','validating') and expires_at>clock_timestamp();
 return jsonb_build_object('maximumArrayBytes',limits.maximum_array_bytes,
  'maximumVcfBytes',limits.maximum_vcf_bytes,'maximumAccountBytes',limits.maximum_account_bytes,
  'maximumActiveUploads',limits.maximum_active_uploads,'reservedBytes',v_reserved::bigint,
  'activeUploads',v_active);
end;
$function$;
revoke all on function private.own_upload_limits_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_limits_v1(uuid,uuid) to service_role;
create function public.own_upload_limits_v1(p_account_id uuid,p_session_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.own_upload_limits_v1(p_account_id,p_session_id);
$function$;
revoke all on function public.own_upload_limits_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_upload_limits_v1(uuid,uuid) to service_role;
