-- TEST-LOCAL actual consumed account request/attempt composition. No stored
-- JWT, new store, analytical grant, public door, READY or provider delivery.
create function public.export_archive_account_content_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare permit jsonb;capture jsonb;result jsonb;f uuid;subject uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('history','chats','chat-messages','check','variants','observed','reports','prs','ancestry')
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 -- This door composes the existing exact ordinary per-file authority. A genuine
 -- bound source must use its distinct current-location reader and cannot borrow
 -- an ordinary source descriptor or a former uploader's original.
 if p_operation in('check','variants','observed','reports','prs','ancestry') then
  if jsonb_typeof(p_payload->'fileId') is distinct from 'string' then raise exception using errcode='22023',message='invalid_request';end if;
  f:=(p_payload->>'fileId')::uuid;
  select subject_id into subject from public.genome_files where id=f;
  if subject is null or not exists(select 1 from jsonb_array_elements(capture->'partitions') x
   where x->>'subjectId'=subject::text and x->>'class'='ordinary') then
   raise exception using errcode='42501',message='not_found';end if;
 end if;
 -- The original reader validates its complete closed payload, pages and scope,
 -- preserves current purpose/source checks and applies current chat projections.
 -- All account/session/target values are selected from the real stored job.
 result:=public.export_archive_content_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb) to service_role;
