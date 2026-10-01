-- TEST-LOCAL consumed ordinary source prerequisite. No new store, human JWT,
-- selection/grant override, public/READY transition or provider completion.
create function private.export_account_original_frame_v1(p_file uuid,p_prepared boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare f public.genome_files;state jsonb;physical jsonb;
begin
 select * into f from public.genome_files where id=p_file for share;
 if f.id is null then raise exception using errcode='42501',message='not_found';end if;
 state:=public.own_original_download_state_v1(f.user_id,f.id);
 if (state->>'fileId')::uuid is distinct from f.id or (state->>'prepared')::boolean is distinct from p_prepared then
  raise exception using errcode='42501',message='not_found';end if;
 if (state->>'retired')::boolean is false then
  select jsonb_build_object('objectId',obj.id,'objectKey',obj.name,'bucket',obj.bucket_id,
   'storageVersion',obj.version,'sizeBytes',f.size_bytes,'rawSha256',f.sha256,'decodedSha256',f.source_sha256,
   'sourceRevision',f.upload_revision) into physical from storage.objects obj
   where obj.id=f.storage_object_id and obj.bucket_id='genomes' and obj.name=f.bucket_path
    and (obj.metadata->>'size')::numeric=f.size_bytes for share;
  if physical is null then raise exception using errcode='42501',message='not_found';end if;
 elsif not p_prepared then
  -- A deletion/authority refusal must never become a legacy retirement warning.
  raise exception using errcode='42501',message='not_found';
 end if;
 return jsonb_build_object('fileId',f.id,'state',state,'physical',physical);
end $$;
revoke all on function private.export_account_original_frame_v1(uuid,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Current original availability and exact physical identity join the full
-- account receipt. An old job cannot adopt a retirement/version transition.
-- No plaintext genetic calls or provider bytes are scanned here.
alter function private.export_account_owned_capture_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_pre_original_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare captured jsonb;item record;source jsonb;frames jsonb:='[]';receipt text;
begin
 captured:=private.export_account_owned_capture_pre_original_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 for item in select gf.id from public.genome_files gf where exists(select 1 from jsonb_array_elements(captured->'partitions')x
  where x->>'class'='ordinary' and x->>'subjectId'=gf.subject_id::text) order by gf.id loop
  source:=private.own_export_source_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid,item.id);
  if source is null then raise exception using errcode='42501',message='not_found';end if;
  frames:=frames||jsonb_build_array(private.export_account_original_frame_v1(item.id,source ? 'preparedSource'));
 end loop;
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-original-frame-v1',
  'capture',captured,'originalFrames',frames)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('originalFrames',frames);
end $$;
revoke all on function private.export_account_owned_capture_v1(jsonb,text,uuid),
 private.export_account_owned_capture_pre_original_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_original_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_file_id uuid,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;captured jsonb;snapshot jsonb;frame jsonb;state jsonb;source jsonb;receipt jsonb;result jsonb;
 expiry timestamptz;expected_expiry timestamptz;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('descriptor','check') or p_file_id is null
  or (p_operation='descriptor' and p_expected is not null) or (p_operation='check' and p_expected is null)
  or (p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object'
   or octet_length(p_expected::text)>8192)) then
  raise exception using errcode='22023',message='invalid_request';end if;
 if p_expected is not null and ((select count(*) from jsonb_object_keys(p_expected))<>9
  or not(p_expected ?& array['version','exportId','attemptId','authorityReceipt','fileId','state','source','decodedSha256','actor'])) then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 select x into frame from jsonb_array_elements(captured->'originalFrames')x where x->>'fileId'=p_file_id::text;
 if frame is null then raise exception using errcode='42501',message='not_found';end if;
 snapshot:=private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,p_file_id);
 if snapshot is null then raise exception using errcode='42501',message='not_found';end if;
 state:=frame->'state';
 if (state->>'retired')::boolean is true then source:=null;
 else
  expiry:=least(clock_timestamp()+interval '270 seconds',(permit->>'leaseExpiresAt')::timestamptz,
   (permit->>'deadline')::timestamptz-interval '30 seconds');
  if p_expected is not null then
   begin expected_expiry:=(p_expected#>>'{source,expiresAt}')::timestamptz;
   exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_request';end;
   if expected_expiry is null or expected_expiry>expiry then raise exception using errcode='42501',message='not_found';end if;
   expiry:=expected_expiry;
  end if;
  if (state->>'prepared')::boolean is true then
   receipt:=public.authorize_own_prepared_original_v1((permit#>>'{origin,accountId}')::uuid,
    (permit#>>'{origin,sessionId}')::uuid,p_file_id,case when p_expected is null then null else p_expected->'source' end);
   source:=receipt->'source';
   if (source->>'manifestId')::uuid is distinct from (snapshot#>>'{preparedSource,manifestId}')::uuid
    or (source->>'fileId')::uuid is distinct from p_file_id then raise exception using errcode='42501',message='not_found';end if;
   expiry:=least(expiry,(source->>'expiresAt')::timestamptz);
   source:=jsonb_set(source,'{expiresAt}',to_jsonb(expiry));
   receipt:=public.authorize_own_prepared_original_v1((permit#>>'{origin,accountId}')::uuid,
    (permit#>>'{origin,sessionId}')::uuid,p_file_id,source);
   if receipt->'source' is distinct from source then raise exception using errcode='42501',message='not_found';end if;
  else
   if ((frame#>>'{physical,storageVersion}')~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') is not true then
    raise exception using errcode='42501',message='not_found';end if;
   source:=jsonb_build_object('version','account-original-download-v1','fileId',p_file_id,
    'sourceRevision',frame#>'{physical,sourceRevision}','rawSha256',frame#>'{physical,rawSha256}',
    'bucket',frame#>'{physical,bucket}','objectId',frame#>'{physical,objectId}','objectKey',frame#>'{physical,objectKey}',
    'storageVersion',frame#>'{physical,storageVersion}','sizeBytes',frame#>'{physical,sizeBytes}','expiresAt',expiry);
  end if;
  if expiry<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 end if;
 result:=jsonb_build_object('version','account-archive-original-v1','exportId',p_export_id,'attemptId',p_attempt_id,
  'authorityReceipt',p_authority_receipt,'fileId',p_file_id,'state',state,'source',source,'decodedSha256',snapshot#>'{file,source_sha256}',
  'actor',jsonb_build_object('accountId',permit#>'{origin,accountId}','sessionId',permit#>'{origin,sessionId}'));
 if (p_expected is not null and result is distinct from p_expected)
  or private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from captured
  or private.own_export_source_v1((permit#>>'{origin,accountId}')::uuid,(permit#>>'{origin,sessionId}')::uuid,p_file_id) is distinct from snapshot then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_original_v1(text,uuid,uuid,text,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_original_v1(text,uuid,uuid,text,uuid,jsonb) to service_role;
