-- A nonce is consumed by the authorized operation, never by a service caller
-- supplying an arbitrary polymorphic target. Keep the existing operation
-- bodies, target checks, lock order, replay behavior and NULL form target.
revoke all on function private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)
  from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on table public.embryo_operation_nonces
  from public,anon,authenticated,inherit_upload_only,service_role;
grant select on table public.embryo_operation_nonces to service_role;

-- The retention route previously used the service role's table DELETE grant.
-- Keep its exact no-argument operation behind a narrow private definer. Its
-- existing lock is acquired first; do not add a late lock to nonce consumers.
create function private.expire_invitation_refusal_receipts_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform private.lock_invitation_transitions_v1();
 delete from public.embryo_operation_nonces where operation='invitation_refuse'
  and rights_receipt_expires_at<=clock_timestamp();
 get diagnostics n=row_count;
 return n;
end;
$$;
revoke all on function private.expire_invitation_refusal_receipts_v1()
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.expire_invitation_refusal_receipts_v1() to service_role;

create or replace function public.expire_invitation_refusal_receipts_v1()
returns integer language sql security invoker set search_path='' as $$
 select private.expire_invitation_refusal_receipts_v1();
$$;
revoke all on function public.expire_invitation_refusal_receipts_v1()
  from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_invitation_refusal_receipts_v1() to service_role;
