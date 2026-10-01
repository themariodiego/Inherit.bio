-- Brief X1.5 for the own-upload page, second half: retire the stored-nonce
-- path. Apply after the code that calls sign_own_upload_artifact_v2 and
-- complete_own_upload_account_v2 (20260930140400) is deployed.
--
-- issue_own_upload_nonce_v1 stored a nonce hash on every render of the upload
-- page; both its doors are dropped. The v1 signature and completion
-- functions, which consume only a nonce stored in advance, stay as the second
-- half of v2 and are no longer callable by the service role.

drop function public.issue_own_upload_nonce_v1(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, text, text, timestamptz);
drop function private.issue_own_upload_nonce_v1(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, text, text, timestamptz);

revoke execute on function
  public.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text),
  private.sign_own_upload_artifact_v1(uuid, uuid, uuid, text, integer, text, text[], bigint, bigint, bigint, bigint, bigint, text),
  public.complete_own_upload_account_v1(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text),
  private.complete_own_upload_account_v1(uuid, uuid, uuid, bigint, bigint, bigint, bigint, bigint, date, text)
  from service_role;

notify pgrst, 'reload schema';
