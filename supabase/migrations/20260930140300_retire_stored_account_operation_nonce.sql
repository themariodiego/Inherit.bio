-- Brief X1.5, second half: retire the stored-nonce path for account
-- deletion. Apply after the code that calls request_account_deletion_v2 and
-- cancel_account_deletion_v2 (20260930140200) is deployed.
--
-- Until now GET /api/account/delete stored each nonce's hash ahead of use
-- through public.issue_account_operation_nonce_v1, on every visit to
-- /settings/data. That function is dropped. The v1 request and cancel
-- functions, which consume only a nonce stored in advance, stay as the second
-- half of v2 and are no longer callable by the service role.

revoke execute on function public.request_account_deletion_v1(uuid, uuid, text, bytea, text, text)
  from service_role;
revoke execute on function public.cancel_account_deletion_v1(uuid, uuid, text, text)
  from service_role;

drop function public.issue_account_operation_nonce_v1(uuid, uuid, text, text, timestamptz);

notify pgrst, 'reload schema';
