-- Let one finalization span more than one request, without letting two requests
-- drive the same finalization.
--
-- `begin_own_upload_finalization_v1` refuses a session that is already
-- `validating`, so a second request cannot pick up work the first one left
-- behind: the claim is minted inside the first call and never leaves the
-- server. That is why a failure today costs the whole upload.
--
-- Re-entry is now permitted for the same account and session, and only when the
-- previous holder recorded progress and let its lease lapse. Consequences,
-- deliberately:
--   * With no recorded progress there is nothing to resume, so the lease is
--     refused exactly as before — including the case the existing test covers,
--     a second request arriving immediately after the first.
--   * A live lease is refused, so a duplicate in-flight request cannot race the
--     holder into copying or publishing the same object twice.
--   * A checkpoint from a superseded claim never authorises re-entry.
--   * Nothing here weakens the authority checks above the branch: the same
--     account, session, consent revisions and unexpired session still apply,
--     and this creates no session-independent finalization.
create or replace function private.own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid,p_start boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_start then
  if u.status='promoted' and u.finalized_file_id is not null then
   return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
  if u.status='validating' then
   -- Resume this session's own finalization, or refuse. The lapsed lease is
   -- the only evidence that the previous holder is gone; a live one means it
   -- is still working and a second request must not join it.
   if not exists(select 1 from private.own_upload_finalization_checkpoints k
    where k.upload_id=u.id and k.finalization_claim=u.finalization_claim
     and k.lease_expires_at<=clock_timestamp()) then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  elsif u.status<>'uploaded' then
   raise exception using errcode='55000',message='upload_unavailable';
  else
   update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
    final_object_name=gen_random_uuid(),finalization_started_at=clock_timestamp()
    where id=u.id returning * into u;
  end if;
 elsif u.status<>'validating' or p_claim is null or u.finalization_claim is distinct from p_claim then
  raise exception using errcode='42501',message='not_found';
 end if;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;
-- CREATE OR REPLACE keeps the existing privileges, but this is a security
-- definer function and the storage-authorization test counts exactly which of
-- those the upload role may execute. Restate them so the guarantee does not
-- depend on remembering that.
revoke all on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean) to service_role;
