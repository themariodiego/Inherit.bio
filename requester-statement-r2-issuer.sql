-- SOURCE ONLY. NEW native R2 allocations, distinct from the real Supabase
-- logical key. No legacy locator is converted and no deployment is enabled.
create table private.new_correction_archive_r2_configuration (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 bucket_name text check(bucket_name~'^inherit-export-[a-z0-9-]{1,40}$'),
 binding_sha256 text check(binding_sha256~'^[0-9a-f]{64}$'),
 protocol_revision text check(protocol_revision='r2-current-object-qualified-all-writer-gateway-v1'),
 check((not enabled and bucket_name is null and binding_sha256 is null and protocol_revision is null)
  or(enabled and bucket_name is not null and binding_sha256 is not null and protocol_revision is not null))
);
insert into private.new_correction_archive_r2_configuration(singleton) values(true);
create table private.new_correction_archive_r2_allocations (
 id uuid primary key default gen_random_uuid(),attempt_id uuid not null,ordinal bigint not null,
 provider_key text not null unique check(provider_key~'^export/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 locator jsonb not null,write_identity jsonb not null,
 write_binding_sha256 text not null check(write_binding_sha256~'^[0-9a-f]{64}$'),
 allocation_sha256 text not null unique check(allocation_sha256~'^[0-9a-f]{64}$'),
 reservation_sha256 text not null check(reservation_sha256~'^[0-9a-f]{64}$'),
 configuration_sha256 text not null check(configuration_sha256~'^[0-9a-f]{64}$'),
 original_deadline timestamptz not null,issued_at timestamptz not null,
 state text not null default 'reserved' check(state in('reserved','written','closing','disposed')),
 provider_version text,provider_etag text,
 closed_at timestamptz,claim_hash text check(claim_hash~'^[0-9a-f]{64}$'),claim_expires_at timestamptz,
 claimed_reservation jsonb,provider_evidence jsonb,disposed_at timestamptz,
 unique(attempt_id,ordinal),
 foreign key(attempt_id,ordinal) references private.export_archive_segments(attempt_id,ordinal) on delete restrict,
 check((claim_hash is null)=(claim_expires_at is null)),
 check((claim_hash is null)=(claimed_reservation is null)),
 check((state='disposed')=(disposed_at is not null and provider_evidence is not null))
);
do $tables$
declare name text;
begin
 foreach name in array array['new_correction_archive_r2_configuration','new_correction_archive_r2_allocations'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $tables$;

create function private.issue_new_correction_archive_r2_allocation_v1()
returns trigger language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare a private.export_archive_attempts;j private.export_archive_jobs;
 config private.new_correction_archive_r2_configuration;key text;locator jsonb;identity jsonb;allocation text;write_hash text;
begin
 select * into a from private.export_archive_attempts where id=new.attempt_id;
 if not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id) then return new;end if;
 select * into j from private.export_archive_jobs where export_id=a.export_id for share;
 select * into config from private.new_correction_archive_r2_configuration where singleton for share;
 if not private.requester_statement_test_enabled_v1() or not config.enabled
  or exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state<>'active') then
  raise exception using errcode='42501',message='correction_archive_backend_not_enabled';end if;
 key:='export/'||gen_random_uuid()::text;
 locator:=jsonb_build_object('provider','archive-r2-current-object-v1','bucket',config.bucket_name,
  'objectKey',key,'byteCount',new.byte_count,'sha256',new.sha256);
 identity:=jsonb_build_object('purpose','inherit-export-reservation-v1','exportId',a.export_id,'attemptId',a.id,
  'ordinal',new.ordinal,'offset',new.byte_offset,'byteCount',new.byte_count,'sha256',new.sha256,
  'logicalKey',new.object_key,'reservedAt',new.reserved_at,'authorityReceipt',a.authority_receipt,'locator',locator);
 write_hash:=encode(extensions.digest(identity::text,'sha256'),'hex');
 allocation:=encode(extensions.digest(convert_to('inherit-export-r2-allocation-v1'||E'\n'||config.bucket_name||E'\n'||key,'UTF8'),'sha256'),'hex');
 insert into private.new_correction_archive_r2_allocations(attempt_id,ordinal,provider_key,locator,write_identity,
  write_binding_sha256,allocation_sha256,reservation_sha256,configuration_sha256,original_deadline,issued_at)
 values(a.id,new.ordinal,key,locator,identity,write_hash,allocation,
  encode(extensions.digest(jsonb_build_object('identity',identity,'allocation',allocation,'configuration',config.binding_sha256,'originalDeadline',j.deadline)::text,'sha256'),'hex'),
  config.binding_sha256,j.deadline,new.reserved_at);
 return new;
end $body$;
create trigger issue_new_correction_archive_r2_allocation after insert on private.export_archive_segments
 for each row execute function private.issue_new_correction_archive_r2_allocation_v1();
revoke all on function private.issue_new_correction_archive_r2_allocation_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Owner-only writer selection takes the existing logical reservation, never a
-- caller bucket/key. Its real provider operation must use this native locator.
create function private.current_new_correction_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;j private.export_archive_jobs;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt;
 perform private.export_archive_current_v1(a.export_id,p_receipt);
 select * into j from private.export_archive_jobs where export_id=a.export_id for update;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state<>'reserved' or a.state<>'writing' or j.active_attempt is distinct from a.id
  or a.lease_expires_at<=clock_timestamp() or allocation.original_deadline<=clock_timestamp()
  or exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('objectId',allocation.id,'writeIdentity',allocation.write_identity,
  'writeBindingSha256',allocation.write_binding_sha256,'allocationSha256',allocation.allocation_sha256,
  'configurationSha256',allocation.configuration_sha256,'originalDeadline',allocation.original_deadline);
end $body$;
create function private.complete_new_correction_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_expected jsonb,p_provider_version text,p_provider_etag text)
returns uuid language plpgsql security invoker set search_path='' as $body$
declare current_frame jsonb;result uuid;
begin
 current_frame:=private.current_new_correction_archive_r2_write_v1(p_attempt,p_ordinal,p_receipt);
 if current_frame is distinct from p_expected or coalesce(p_provider_version,'')!~'^[A-Za-z0-9._-]{1,256}$'
  or coalesce(p_provider_etag,'')!~'^[A-Za-z0-9._-]{1,256}$' then raise exception using errcode='42501',message='not_found';end if;
 update private.new_correction_archive_r2_allocations set state='written',provider_version=p_provider_version,provider_etag=p_provider_etag
  where attempt_id=p_attempt and ordinal=p_ordinal returning id into result;
 return result;
end $body$;
revoke all on function private.current_new_correction_archive_r2_write_v1(uuid,bigint,text),
 private.complete_new_correction_archive_r2_write_v1(uuid,bigint,text,jsonb,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Actual existing worker ABI preserved. Marked R2 ACK references the real
-- native allocation row UUID, not a fictional Supabase storage.objects row.
alter function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)
 rename to export_archive_worker_before_requester_statement_v1;
revoke all on function public.export_archive_worker_before_requester_statement_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_worker_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare a private.export_archive_attempts;j private.export_archive_jobs;s private.export_archive_segments;allocation private.new_correction_archive_r2_allocations;
begin
 if p_operation is distinct from 'acknowledge' or not exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id) then
  return public.export_archive_worker_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for update;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or not(p_payload ?& array['ordinal','offset','sizeBytes','sha256','objectKey','objectId']) then raise exception using errcode='22023',message='invalid_request';end if;
 select * into s from private.export_archive_segments where attempt_id=a.id and ordinal=(p_payload->>'ordinal')::bigint for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=s.ordinal for update;
 if a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing' or a.lease_expires_at<=clock_timestamp()
  or a.authority_receipt is distinct from p_authority_receipt or s.attempt_id is null or s.acknowledged_at is not null
  or s.byte_offset is distinct from(p_payload->>'offset')::bigint or s.byte_count is distinct from(p_payload->>'sizeBytes')::integer
  or s.sha256 is distinct from p_payload->>'sha256' or s.object_key is distinct from p_payload->>'objectKey'
  or allocation.state is distinct from 'written' or allocation.id::text is distinct from p_payload->>'objectId'
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id and state<>'active') then raise exception using errcode='42501',message='not_found';end if;
 update private.export_archive_segments set object_id=allocation.id,acknowledged_at=clock_timestamp() where attempt_id=a.id and ordinal=s.ordinal;
 update private.export_archive_attempts set segment_count=segment_count+1,byte_count=byte_count+s.byte_count where id=a.id;
 return jsonb_build_object('ordinal',s.ordinal,'authorityReceipt',p_authority_receipt);
end $body$;
revoke all on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb) to service_role;

-- Actual durable native issuer/check for the frozen current-object algorithm.
-- This is a NEW allocation only. Existing Supabase reservations refuse.
create function private.claim_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;claim_until timestamptz;frame jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_claim,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state not in('reserved','written','closing') or a.state<>'cleanup_pending'
  or a.cleanup_not_before>clock_timestamp() or(allocation.claim_expires_at is not null and allocation.claim_expires_at>clock_timestamp())
  or not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing') then raise exception using errcode='42501',message='not_found';end if;
 claim_until:=clock_timestamp()+interval '30 seconds';
 frame:=jsonb_build_object('version','archive-r2-current-cleanup-reservation-v1','exportId',a.export_id,'attemptId',a.id,
  'ordinal',allocation.ordinal,'authorityReceipt',a.authority_receipt,'reservationSha256',allocation.reservation_sha256,
  'locator',allocation.locator,'writeIdentity',allocation.write_identity,'writeBindingSha256',allocation.write_binding_sha256,
  'allocationSha256',allocation.allocation_sha256,'cleanupNotBefore',a.cleanup_not_before,'claimExpiresAt',claim_until);
 update private.new_correction_archive_r2_allocations set state='closing',closed_at=coalesce(closed_at,clock_timestamp()),
  claim_hash=encode(extensions.digest(convert_to(p_claim,'UTF8'),'sha256'),'hex'),claim_expires_at=claim_until,claimed_reservation=frame
  where id=allocation.id;
 return frame;
end $body$;
create function private.check_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_claim,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state<>'closing' or a.state<>'cleanup_pending' or a.cleanup_not_before>clock_timestamp()
  or allocation.claim_hash is null or allocation.claimed_reservation is null or allocation.claim_expires_at is null
  or allocation.claim_expires_at<=clock_timestamp() or allocation.claimed_reservation is distinct from p_expected
  or not private.claim_hash_matches_v1(allocation.claim_hash,encode(extensions.digest(convert_to(p_claim,'UTF8'),'sha256'),'hex'))
  or not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing') then raise exception using errcode='42501',message='not_found';end if;
 return allocation.claimed_reservation;
end $body$;
create function private.ack_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb,p_evidence jsonb)
returns boolean language plpgsql security invoker set search_path='' as $body$
declare current_frame jsonb;allocation private.new_correction_archive_r2_allocations;
begin
 current_frame:=private.check_new_correction_archive_r2_disposal_v1(p_attempt,p_ordinal,p_claim,p_expected);
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or(select count(*) from jsonb_object_keys(p_evidence))<>6
  or p_evidence->>'version' is distinct from 'archive-r2-current-object-evidence-v1'
  or p_evidence->>'reservationSha256' is distinct from allocation.reservation_sha256
  or p_evidence->>'allocationSha256' is distinct from allocation.allocation_sha256
  or p_evidence->>'disposition' is distinct from 'current-payload-tombstoned'
  or p_evidence->>'historyScope' is distinct from 'current-object-only'
  or p_evidence#>>'{marker,kind}' is distinct from 'permanent-empty-fence'
  or p_evidence#>>'{marker,objectKey}' is distinct from allocation.provider_key
  or p_evidence#>>'{marker,allocationSha256}' is distinct from allocation.allocation_sha256
  or p_evidence#>'{marker,byteCount}' is distinct from '0'::jsonb
  or p_evidence#>'{marker,writeBindingSha256}' is distinct from 'null'::jsonb
  or coalesce(p_evidence#>>'{marker,version}','')!~'^[A-Za-z0-9._-]{1,256}$'
  or coalesce(p_evidence#>>'{marker,etag}','')!~'^[A-Za-z0-9._-]{1,256}$'
  or(select count(*) from jsonb_object_keys(p_evidence->'marker'))<>7 then raise exception using errcode='42501',message='not_found';end if;
 update private.new_correction_archive_r2_allocations set state='disposed',provider_evidence=p_evidence,disposed_at=clock_timestamp(),
  claim_hash=null,claim_expires_at=null,claimed_reservation=null where id=allocation.id;
 insert into private.new_correction_archive_provider_dispositions(attempt_id,ordinal,reservation_hash,backend,immutable_evidence)
 values(p_attempt,p_ordinal,allocation.reservation_sha256,'archive-r2-current-object-v1',p_evidence);
 update private.export_archive_segments set delete_acknowledged_at=clock_timestamp() where attempt_id=p_attempt and ordinal=p_ordinal;
 return true;
end $body$;
revoke all on function private.claim_new_correction_archive_r2_disposal_v1(uuid,bigint,text),
 private.check_new_correction_archive_r2_disposal_v1(uuid,bigint,text,jsonb),
 private.ack_new_correction_archive_r2_disposal_v1(uuid,bigint,text,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
