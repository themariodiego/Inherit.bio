-- Account-only R2 allocations. The provider/generation gates stay closed.
-- Existing public worker reservations are committed before this owner INSERT;
-- the owner never adopts a case export or a storage.objects identity.
create table private.account_archive_r2_configuration (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 bucket text check(bucket~'^inherit-export-[a-z0-9-]{1,40}$'),
 binding_sha256 text check(binding_sha256~'^[0-9a-f]{64}$'),
 check(not enabled or (bucket is not null and binding_sha256 is not null))
);
insert into private.account_archive_r2_configuration(singleton,enabled) values(true,false);
create table private.account_archive_r2_allocations (
 attempt_id uuid not null, ordinal bigint not null,
 object_id uuid not null unique default gen_random_uuid(),
 bucket text not null check(bucket~'^inherit-export-[a-z0-9-]{1,40}$'),
 provider_key text not null unique,
 configuration_sha256 text not null check(configuration_sha256~'^[0-9a-f]{64}$'),
 allocation_sha256 text not null unique check(allocation_sha256~'^[0-9a-f]{64}$'),
 write_identity jsonb not null, write_binding_sha256 text not null check(write_binding_sha256~'^[0-9a-f]{64}$'),
 write_claim text not null check(write_claim~'^[0-9a-f]{64}$'),
 original_deadline timestamptz not null,
 provider_version text, provider_etag text, written_at timestamptz,
 disposal_claim text check(disposal_claim~'^[0-9a-f]{64}$'), disposal_claim_expires_at timestamptz,
 disposed_at timestamptz, disposal_evidence jsonb,
 primary key(attempt_id,ordinal),
 foreign key(attempt_id,ordinal) references private.export_archive_segments(attempt_id,ordinal) on delete restrict,
 check(provider_key~'^export/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 check(jsonb_typeof(write_identity)='object'),
 check((written_at is null)=(provider_version is null) and (written_at is null)=(provider_etag is null)),
 check(provider_version is null or (char_length(provider_version) between 1 and 256 and provider_version~'^[A-Za-z0-9._-]+$')),
 check(provider_etag is null or (char_length(provider_etag) between 1 and 256 and provider_etag~'^[A-Za-z0-9._-]+$')),
 check((disposal_claim is null)=(disposal_claim_expires_at is null)),
 check((disposed_at is null)=(disposal_evidence is null))
);
alter table private.account_archive_r2_configuration enable row level security;
alter table private.account_archive_r2_allocations enable row level security;
revoke all on private.account_archive_r2_configuration,private.account_archive_r2_allocations
 from public,anon,authenticated,inherit_upload_only,service_role;

create function private.guard_account_archive_r2_allocation_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='account_archive_r2_allocation_retained';end if;
 if to_jsonb(new)-array['provider_version','provider_etag','written_at','disposal_claim','disposal_claim_expires_at','disposed_at','disposal_evidence']
  is distinct from to_jsonb(old)-array['provider_version','provider_etag','written_at','disposal_claim','disposal_claim_expires_at','disposed_at','disposal_evidence']
  or (old.written_at is not null and row(new.provider_version,new.provider_etag,new.written_at)
   is distinct from row(old.provider_version,old.provider_etag,old.written_at))
  or (old.disposed_at is not null and row(new.disposed_at,new.disposal_evidence)
   is distinct from row(old.disposed_at,old.disposal_evidence)) then
  raise exception using errcode='23514',message='account_archive_r2_identity_immutable';end if;
 return new;
end $$;
create trigger account_archive_r2_identity before update or delete on private.account_archive_r2_allocations
 for each row execute function private.guard_account_archive_r2_allocation_v1();

-- This common authority/lock ordering is also used by the service-only ACK
-- wrapper. Only the separate private owner doors demand session_user postgres.
create function private.account_archive_r2_write_context_v1(p_attempt uuid,p_receipt text)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
declare job_row private.export_archive_jobs;attempt_row private.export_archive_attempts;export_row public.generated_exports;
begin
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 if attempt_row.id is null then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 perform private.export_archive_current_v1(attempt_row.export_id,p_receipt);
 select * into export_row from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 if job_row.origin->>'kind' is distinct from 'account' or job_row.export_contract<>'account-export-v1'
  or export_row.target_kind<>'account' or export_row.target_id is distinct from export_row.account_id
  or export_row.status<>'building' or job_row.active_attempt is distinct from p_attempt
  or job_row.authority_receipt is distinct from p_receipt or attempt_row.authority_receipt is distinct from p_receipt
  or attempt_row.state<>'writing' or least(attempt_row.lease_expires_at,job_row.deadline-interval '30 seconds')<=clock_timestamp() then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
end $$;
create function private.account_archive_r2_frame_v1(p_attempt uuid,p_ordinal bigint)
returns jsonb language sql stable security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('objectId',object_id,'writeIdentity',write_identity,'writeBindingSha256',write_binding_sha256,
  'allocationSha256',allocation_sha256,'configurationSha256',configuration_sha256,'originalDeadline',original_deadline)
 from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal
$$;
create function private.reserve_account_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_claim text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare segment_row private.export_archive_segments;attempt_row private.export_archive_attempts;job_row private.export_archive_jobs;
 config_row private.account_archive_r2_configuration;locator jsonb;identity_row jsonb;key_at text;allocation_at text;
begin
 if session_user<>'postgres' or current_user<>'postgres' or p_claim is null or p_claim!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 perform private.account_archive_r2_write_context_v1(p_attempt,p_receipt);
 select * into config_row from private.account_archive_r2_configuration where singleton for share;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id;
 select * into segment_row from private.export_archive_segments where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if config_row.enabled is distinct from true or segment_row.attempt_id is null or segment_row.acknowledged_at is not null
  or segment_row.delete_acknowledged_at is not null or p_ordinal<>attempt_row.segment_count
  or segment_row.byte_offset<>attempt_row.byte_count then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 key_at:='export/'||gen_random_uuid()::text;
 allocation_at:=encode(extensions.digest(convert_to('inherit-export-r2-allocation-v1'||chr(10)||config_row.bucket||chr(10)||key_at,'UTF8'),'sha256'),'hex');
 locator:=jsonb_build_object('provider','archive-r2-current-object-v1','bucket',config_row.bucket,'objectKey',key_at,
  'byteCount',segment_row.byte_count,'sha256',segment_row.sha256);
 identity_row:=jsonb_build_object('purpose','inherit-export-reservation-v1','exportId',job_row.export_id,'attemptId',p_attempt,
  'ordinal',p_ordinal,'offset',segment_row.byte_offset,'byteCount',segment_row.byte_count,'sha256',segment_row.sha256,
  'logicalKey',segment_row.object_key,'reservedAt',segment_row.reserved_at,'authorityReceipt',p_receipt,'locator',locator);
 -- No conflict handler: even an unknown INSERT response never adopts/retries.
 insert into private.account_archive_r2_allocations(attempt_id,ordinal,bucket,provider_key,configuration_sha256,
  allocation_sha256,write_identity,write_binding_sha256,write_claim,original_deadline)
 values(p_attempt,p_ordinal,config_row.bucket,key_at,config_row.binding_sha256,allocation_at,identity_row,
  encode(extensions.digest(convert_to(identity_row::text,'UTF8'),'sha256'),'hex'),p_claim,
  least(attempt_row.lease_expires_at,job_row.deadline-interval '30 seconds'));
 perform private.export_archive_current_v1(job_row.export_id,p_receipt);
 return private.account_archive_r2_frame_v1(p_attempt,p_ordinal);
end $$;
create function private.current_account_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_claim text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare allocation_row private.account_archive_r2_allocations;config_row private.account_archive_r2_configuration;
begin
 if session_user<>'postgres' or current_user<>'postgres' then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 perform private.account_archive_r2_write_context_v1(p_attempt,p_receipt);
 select * into config_row from private.account_archive_r2_configuration where singleton for share;
 select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if allocation_row.attempt_id is null or allocation_row.write_claim is distinct from p_claim
  or allocation_row.written_at is not null or allocation_row.disposal_claim is not null or allocation_row.disposed_at is not null
  or allocation_row.original_deadline<=clock_timestamp() or config_row.enabled is distinct from true
  or allocation_row.bucket is distinct from config_row.bucket or allocation_row.configuration_sha256 is distinct from config_row.binding_sha256 then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 return private.account_archive_r2_frame_v1(p_attempt,p_ordinal);
end $$;
create function private.complete_account_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_claim text,
 p_frame jsonb,p_version text,p_etag text) returns uuid
language plpgsql security definer set search_path=pg_catalog,private as $$
declare frame jsonb;
begin
 frame:=private.current_account_archive_r2_write_v1(p_attempt,p_ordinal,p_receipt,p_claim);
 if p_frame is distinct from frame or p_version is null or char_length(p_version) not between 1 and 256 or p_version!~'^[A-Za-z0-9._-]+$'
  or p_etag is null or char_length(p_etag) not between 1 and 256 or p_etag!~'^[A-Za-z0-9._-]+$' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 -- Caller performed the actual create-only PUT and same-version complete
 -- EOF/hash readback while this transaction held the current authority locks.
 update private.account_archive_r2_allocations set provider_version=p_version,provider_etag=p_etag,written_at=clock_timestamp()
  where attempt_id=p_attempt and ordinal=p_ordinal;
 return (frame->>'objectId')::uuid;
end $$;

-- The existing worker's other operations remain exact. Only a recorded R2
-- allocation takes this ACK path, retaining the original payload/sequence CAS.
do $account_r2_predecessor$
begin
 if not exists(select 1 from pg_proc p where p.oid='public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)'::regprocedure
  and md5(p.prosrc)='b7b0ac6e6d523a644070ee1cfcea9075' and p.prosecdef and p.proowner='postgres'::regrole
  and p.proconfig=array['search_path=pg_catalog, private']) then
  raise exception using errcode='55000',message='account_archive_r2_worker_predecessor_differs';end if;
end $account_r2_predecessor$;
alter function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb) rename to export_archive_worker_before_account_r2_v1;
revoke all on function public.export_archive_worker_before_account_r2_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
create function public.export_archive_worker_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_payload jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare allocation_row private.account_archive_r2_allocations;segment_row private.export_archive_segments;
 attempt_row private.export_archive_attempts;expected jsonb;n bigint;
begin
 if p_operation='acknowledge' then
  n:=(p_payload->>'ordinal')::bigint;
  if exists(select 1 from private.account_archive_r2_allocations where attempt_id=p_attempt_id and ordinal=n) then
   perform private.account_archive_r2_write_context_v1(p_attempt_id,p_authority_receipt);
   select * into attempt_row from private.export_archive_attempts where id=p_attempt_id;
   select * into segment_row from private.export_archive_segments where attempt_id=p_attempt_id and ordinal=n for update;
   select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt_id and ordinal=n for update;
   expected:=jsonb_build_object('ordinal',n,'offset',segment_row.byte_offset,'sizeBytes',segment_row.byte_count,
    'sha256',segment_row.sha256,'objectKey',segment_row.object_key,'objectId',allocation_row.object_id);
   if attempt_row.export_id is distinct from p_export_id or p_payload is distinct from expected
    or segment_row.acknowledged_at is not null or allocation_row.written_at is null
    or allocation_row.disposal_claim is not null or allocation_row.disposed_at is not null
    or allocation_row.original_deadline<=clock_timestamp() or n<>attempt_row.segment_count
    or segment_row.byte_offset<>attempt_row.byte_count then
    raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
   update private.export_archive_segments set object_id=allocation_row.object_id,acknowledged_at=clock_timestamp()
    where attempt_id=p_attempt_id and ordinal=n;
   update private.export_archive_attempts set segment_count=segment_count+1,byte_count=byte_count+segment_row.byte_count where id=p_attempt_id;
   perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
   return jsonb_build_object('ordinal',n,'authorityReceipt',p_authority_receipt);
  end if;
 end if;
 return public.export_archive_worker_before_account_r2_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);
end $$;
revoke all on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb) to service_role;

create function private.account_archive_r2_disposal_frame_v1(p_attempt uuid,p_ordinal bigint,p_claim text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare allocation_row private.account_archive_r2_allocations;attempt_row private.export_archive_attempts;
 job_row private.export_archive_jobs;value jsonb;
begin
 if session_user<>'postgres' or current_user<>'postgres' then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 perform 1 from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if allocation_row.attempt_id is null or job_row.origin->>'kind' is distinct from 'account'
  or job_row.export_contract<>'account-export-v1' or attempt_row.state<>'cleanup_pending'
  or attempt_row.cleanup_not_before>clock_timestamp() or allocation_row.original_deadline+interval '30 seconds'>clock_timestamp()
  or allocation_row.disposal_claim is distinct from p_claim or allocation_row.disposal_claim_expires_at<=clock_timestamp()
  or allocation_row.disposed_at is not null then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 value:=jsonb_build_object('version','archive-r2-current-cleanup-reservation-v1','exportId',job_row.export_id,
  'attemptId',p_attempt,'ordinal',p_ordinal,'authorityReceipt',job_row.authority_receipt,'locator',allocation_row.write_identity->'locator',
  'writeIdentity',allocation_row.write_identity,'writeBindingSha256',allocation_row.write_binding_sha256,
  'allocationSha256',allocation_row.allocation_sha256,'cleanupNotBefore',greatest(attempt_row.cleanup_not_before,allocation_row.original_deadline+interval '30 seconds'),
  'claimExpiresAt',allocation_row.disposal_claim_expires_at);
 return value||jsonb_build_object('reservationSha256',encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'));
end $$;
create function private.claim_account_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare allocation_row private.account_archive_r2_allocations;attempt_row private.export_archive_attempts;job_row private.export_archive_jobs;
begin
 if session_user<>'postgres' or current_user<>'postgres' or p_claim is null or p_claim!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt;
 perform 1 from public.generated_exports where id=attempt_row.export_id for update;
 select * into job_row from private.export_archive_jobs where export_id=attempt_row.export_id for update;
 select * into attempt_row from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation_row from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if allocation_row.attempt_id is null or job_row.origin->>'kind' is distinct from 'account' or job_row.export_contract<>'account-export-v1'
  or attempt_row.state<>'cleanup_pending' or attempt_row.cleanup_not_before>clock_timestamp()
  or allocation_row.original_deadline+interval '30 seconds'>clock_timestamp() or allocation_row.disposed_at is not null
  or allocation_row.disposal_claim_expires_at>clock_timestamp() then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 update private.account_archive_r2_allocations set disposal_claim=p_claim,disposal_claim_expires_at=clock_timestamp()+interval '30 seconds'
  where attempt_id=p_attempt and ordinal=p_ordinal;
 return private.account_archive_r2_disposal_frame_v1(p_attempt,p_ordinal,p_claim);
end $$;
create function private.check_account_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare value jsonb;
begin
 value:=private.account_archive_r2_disposal_frame_v1(p_attempt,p_ordinal,p_claim);
 if value is distinct from p_expected then raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 return value;
end $$;
create function private.ack_account_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare value jsonb;marker jsonb;
begin
 value:=private.check_account_archive_r2_disposal_v1(p_attempt,p_ordinal,p_claim,p_expected);marker:=p_evidence->'marker';
 if jsonb_typeof(p_evidence) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_evidence))<>6
  or p_evidence->>'version' is distinct from 'archive-r2-current-object-evidence-v1'
  or p_evidence->>'reservationSha256' is distinct from value->>'reservationSha256'
  or p_evidence->>'allocationSha256' is distinct from value->>'allocationSha256'
  or p_evidence->>'disposition' is distinct from 'current-payload-tombstoned' or p_evidence->>'historyScope' is distinct from 'current-object-only'
  or jsonb_typeof(marker) is distinct from 'object' or (select count(*) from jsonb_object_keys(marker))<>7
  or marker->>'objectKey' is distinct from value#>>'{locator,objectKey}' or marker->>'kind' is distinct from 'permanent-empty-fence'
  or marker->'byteCount' is distinct from '0'::jsonb or marker->'writeBindingSha256' is distinct from 'null'::jsonb
  or marker->>'allocationSha256' is distinct from value->>'allocationSha256'
  or char_length(coalesce(marker->>'version','')) not between 1 and 256 or coalesce(marker->>'version','')!~'^[A-Za-z0-9._-]+$'
  or char_length(coalesce(marker->>'etag','')) not between 1 and 256 or coalesce(marker->>'etag','')!~'^[A-Za-z0-9._-]+$' then
  raise exception using errcode='42501',message='account_archive_r2_unavailable';end if;
 update private.account_archive_r2_allocations set disposed_at=clock_timestamp(),disposal_evidence=p_evidence where attempt_id=p_attempt and ordinal=p_ordinal;
 update private.export_archive_segments set delete_acknowledged_at=clock_timestamp() where attempt_id=p_attempt and ordinal=p_ordinal;
 return true;
end $$;
revoke all on function private.guard_account_archive_r2_allocation_v1(),private.account_archive_r2_write_context_v1(uuid,text),
 private.account_archive_r2_frame_v1(uuid,bigint),private.reserve_account_archive_r2_write_v1(uuid,bigint,text,text),
 private.current_account_archive_r2_write_v1(uuid,bigint,text,text),private.complete_account_archive_r2_write_v1(uuid,bigint,text,text,jsonb,text,text),
 private.account_archive_r2_disposal_frame_v1(uuid,bigint,text),private.claim_account_archive_r2_disposal_v1(uuid,bigint,text),
 private.check_account_archive_r2_disposal_v1(uuid,bigint,text,jsonb),private.ack_account_archive_r2_disposal_v1(uuid,bigint,text,jsonb,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Include the allocation in the exact physical erasure graph. It is provider
-- cleanup metadata, not a new portable-data class. Follow the existing segment
-- selector rather than broadening a subject deletion to all account exports.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'generated-artifacts','private.account_archive_r2_allocations',max(store_order)+1
 from public.purge_target_stores where target_id='generated-artifacts';
alter function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 rename to future_person_deletion_graph_rows_before_account_r2_v1;
create function private.future_person_deletion_graph_rows_v1(p_subject uuid,p_claimant uuid,p_file uuid,p_embryo uuid,p_audit uuid)
returns table(purge_target_id text,physical_store text,primary_key jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select * from private.future_person_deletion_graph_rows_before_account_r2_v1(p_subject,p_claimant,p_file,p_embryo,p_audit);
 return query select 'generated-artifacts'::text,'private.account_archive_r2_allocations'::text,
  jsonb_build_object('attempt_id',a.attempt_id,'ordinal',a.ordinal)
 from private.account_archive_r2_allocations a
 join private.future_person_deletion_graph_rows_before_account_r2_v1(p_subject,p_claimant,p_file,p_embryo,p_audit) prior
  on prior.physical_store='private.export_archive_segments'
  and a.attempt_id=(prior.primary_key->>'attempt_id')::uuid and a.ordinal=(prior.primary_key->>'ordinal')::bigint;
end $$;
alter function private.future_person_deletion_row_v1(text,jsonb,boolean) rename to future_person_deletion_row_before_account_r2_v1;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if p_store is distinct from 'private.account_archive_r2_allocations' then
  return private.future_person_deletion_row_before_account_r2_v1(p_store,p_key,p_delete);end if;
 if p_delete is null or jsonb_typeof(p_key) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_key))<>2 or not(p_key ?& array['attempt_id','ordinal'])
  or jsonb_typeof(p_key->'attempt_id') is distinct from 'string' or jsonb_typeof(p_key->'ordinal') is distinct from 'number' then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select count(*) into n from private.account_archive_r2_allocations
  where attempt_id=(p_key->>'attempt_id')::uuid and ordinal=(p_key->>'ordinal')::bigint;
 if p_delete and n>0 then raise exception using errcode='55000',message='account_archive_r2_allocation_retained';end if;
 return n;
end $$;
revoke all on function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_graph_rows_before_account_r2_v1(uuid,uuid,uuid,uuid,uuid),
 private.future_person_deletion_row_v1(text,jsonb,boolean),private.future_person_deletion_row_before_account_r2_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
