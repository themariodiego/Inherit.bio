-- Closed TEST account R2 completion. The ordinary generation capability remains
-- NULL; the disabled account configuration is never enabled by this migration.
-- Only the dedicated native owner can submit a complete producer/readback proof.
alter table private.export_archive_attempts add column account_r2_completion jsonb;

create function private.guard_account_r2_completion_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_op='DELETE' then
  if old.account_r2_completion is not null then
   raise exception using errcode='55000',message='account_r2_completion_retained';end if;
  return old;
 end if;
 if old.account_r2_completion is not null and new.account_r2_completion is distinct from old.account_r2_completion then
  raise exception using errcode='55000',message='account_r2_completion_retained';end if;
 return new;
end $$;
create trigger account_r2_completion_immutable before update or delete on private.export_archive_attempts
 for each row execute function private.guard_account_r2_completion_v1();

create function private.account_archive_r2_completed_context_v1(p_attempt uuid,p_receipt text,p_ready boolean)
returns private.export_archive_attempts language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;er public.generated_exports;jr private.export_archive_jobs;
 cr private.account_archive_r2_configuration;counts record;
begin
 if current_user<>'postgres' or session_user<>'postgres' or p_ready is null then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into ar from private.export_archive_attempts where id=p_attempt;
 if ar.id is null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 perform private.export_archive_current_v1(ar.export_id,p_receipt);
 select * into er from public.generated_exports where id=ar.export_id for update;
 select * into jr from private.export_archive_jobs where export_id=ar.export_id for update;
 select * into ar from private.export_archive_attempts where id=p_attempt for update;
 select * into cr from private.account_archive_r2_configuration where singleton for share;
 perform 1 from private.export_archive_segments where attempt_id=p_attempt order by ordinal for share;
 perform 1 from private.account_archive_r2_allocations where attempt_id=p_attempt order by ordinal for share;
 select count(*) n,coalesce(sum(byte_count),0) bytes,min(ordinal) first,max(ordinal) last
  into counts from private.export_archive_segments where attempt_id=p_attempt;
 if cr.enabled is distinct from true or jr.origin->>'kind' is distinct from 'account'
  or jr.export_contract is distinct from 'account-export-v1' or er.target_kind is distinct from 'account'
  or er.target_id is distinct from er.account_id or jr.active_attempt is distinct from p_attempt
  or jr.authority_receipt is distinct from p_receipt or ar.authority_receipt is distinct from p_receipt
  or er.status is distinct from (case when p_ready then 'ready' else 'building' end)
  or ar.state is distinct from 'bytes_complete' or ar.archive_sha256 is null or ar.manifest_sha256 is null or jr.deadline<=clock_timestamp()
  or (p_ready and (ar.account_r2_completion is null or er.expires_at<=clock_timestamp()
   or ar.account_r2_completion->>'authorityReceipt' is distinct from p_receipt
   or ar.account_r2_completion->>'archiveSha256' is distinct from ar.archive_sha256
   or ar.account_r2_completion->>'manifestSha256' is distinct from ar.manifest_sha256
   or (ar.account_r2_completion->>'sizeBytes')::bigint is distinct from ar.byte_count
   or (ar.account_r2_completion->>'expiresAt')::timestamptz is distinct from er.expires_at))
  or (not p_ready and ar.account_r2_completion is not null)
  or counts.n=0 or counts.n<>ar.segment_count or counts.bytes<>ar.byte_count
  or counts.first<>0 or counts.last<>counts.n-1
  or ar.segment_count<>(ar.byte_count+3999999)/4000000 or ar.page_count<>(ar.segment_count+127)/128
  or (select count(*) from private.export_archive_manifest_pages where attempt_id=p_attempt)<>ar.page_count
  or (select count(*) from private.account_archive_r2_allocations where attempt_id=p_attempt)<>counts.n
  or exists(select 1 from private.export_archive_segments s left join private.account_archive_r2_allocations r
   on r.attempt_id=s.attempt_id and r.ordinal=s.ordinal where s.attempt_id=p_attempt and
   (s.byte_offset<>s.ordinal*4000000 or (s.ordinal<ar.segment_count-1 and s.byte_count<>4000000) or s.acknowledged_at is null or s.delete_acknowledged_at is not null
    or s.object_id is distinct from r.object_id or r.written_at is null or r.disposal_claim is not null
    or r.disposed_at is not null or r.original_deadline<=clock_timestamp()
    or r.bucket is distinct from cr.bucket or r.configuration_sha256 is distinct from cr.binding_sha256
    or r.write_identity->>'exportId' is distinct from ar.export_id::text
    or r.write_identity->>'attemptId' is distinct from p_attempt::text
    or r.write_identity->>'authorityReceipt' is distinct from p_receipt
    or (r.write_identity->>'ordinal')::bigint is distinct from s.ordinal
    or (r.write_identity->>'offset')::bigint is distinct from s.byte_offset
    or (r.write_identity->>'byteCount')::bigint is distinct from s.byte_count
    or r.write_identity->>'sha256' is distinct from s.sha256
    or r.write_identity->>'logicalKey' is distinct from s.object_key)) then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return ar;
end $$;

create function private.account_archive_test_download_context_v1(p_attempt uuid,p_receipt text,p_download_hash text,p_origin jsonb)
returns private.export_archive_attempts language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;dr private.export_archive_downloads;jr private.export_archive_jobs;er public.generated_exports;
begin
 ar:=private.account_archive_r2_completed_context_v1(p_attempt,p_receipt,true);
 select * into jr from private.export_archive_jobs where export_id=ar.export_id;
 select * into er from public.generated_exports where id=ar.export_id;
 select * into dr from private.export_archive_downloads where cookie_hash=p_download_hash for update;
 if p_download_hash is null or p_download_hash!~'^[a-f0-9]{64}$' or p_origin is distinct from jr.origin
  or dr.id is null or dr.export_id is distinct from ar.export_id or dr.attempt_id is distinct from ar.id
  or dr.authority_receipt is distinct from p_receipt or dr.export_revision is distinct from er.export_revision
  or dr.revoked_at is not null or least(dr.expires_at,dr.idle_expires_at)<=clock_timestamp() then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return ar;
end $$;

-- Every stored page is compared to all of its actual sequential segment rows,
-- including exact raw descriptor values. No missing page/member is skipped.
create function private.account_archive_test_manifest_page_v1(p_attempt uuid,p_receipt text,p_page bigint,
 p_download_hash text default null,p_origin jsonb default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;mp private.export_archive_manifest_pages;expected jsonb;frames jsonb;
begin
 if p_download_hash is null then
  if p_origin is not null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
  ar:=private.account_archive_r2_completed_context_v1(p_attempt,p_receipt,false);
 else ar:=private.account_archive_test_download_context_v1(p_attempt,p_receipt,p_download_hash,p_origin);end if;
 if p_page is null or p_page<0 or p_page>=ar.page_count then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into mp from private.export_archive_manifest_pages where attempt_id=p_attempt and page=p_page for share;
 select jsonb_agg(jsonb_build_object('ordinal',s.ordinal,'offset',s.byte_offset,'sizeBytes',s.byte_count,
  'sha256',s.sha256,'objectKey',s.object_key,'objectId',s.object_id) order by s.ordinal),
  jsonb_agg(jsonb_build_object('segment',jsonb_build_object('ordinal',s.ordinal,'offset',s.byte_offset,'sizeBytes',s.byte_count,
   'sha256',s.sha256,'objectKey',s.object_key,'objectId',s.object_id),'frame',private.account_archive_r2_frame_v1(p_attempt,s.ordinal),
   'providerVersion',r.provider_version,'providerEtag',r.provider_etag) order by s.ordinal) into expected,frames
  from private.export_archive_segments s join private.account_archive_r2_allocations r
   on r.attempt_id=s.attempt_id and r.ordinal=s.ordinal where s.attempt_id=p_attempt
   and s.ordinal>=p_page*128 and s.ordinal<least((p_page+1)*128,ar.segment_count);
 if mp.attempt_id is null or mp.first_ordinal<>p_page*128 or mp.segments is distinct from expected
  or mp.page_sha256 is distinct from encode(extensions.digest(convert_to(expected::text,'UTF8'),'sha256'),'hex')
  or jsonb_array_length(expected)<>least(128,ar.segment_count-p_page*128) then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return jsonb_build_object('page',p_page,'sizeBytes',ar.byte_count,'segmentCount',ar.segment_count,'pageCount',ar.page_count,
  'sha256',ar.archive_sha256,'manifestSha256',ar.manifest_sha256,'segments',frames);
end $$;

create function private.current_account_archive_test_object_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,
 p_download_hash text default null,p_origin jsonb default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;rr private.account_archive_r2_allocations;
begin
 if p_download_hash is null then
  if p_origin is not null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
  ar:=private.account_archive_r2_completed_context_v1(p_attempt,p_receipt,false);
 else
  ar:=private.account_archive_test_download_context_v1(p_attempt,p_receipt,p_download_hash,p_origin);
  if not exists(select 1 from private.export_archive_downloads where cookie_hash=p_download_hash and next_sequence=p_ordinal) then
   raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 end if;
 select * into rr from private.account_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for share;
 if rr.attempt_id is null then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return jsonb_build_object('frame',private.account_archive_r2_frame_v1(p_attempt,p_ordinal),
  'providerVersion',rr.provider_version,'providerEtag',rr.provider_etag);
end $$;

create function private.complete_test_account_archive_v1(p_attempt uuid,p_receipt text,p_producer jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;jr private.export_archive_jobs;expires timestamptz;proof jsonb;
 native_manifest text;
begin
 ar:=private.account_archive_r2_completed_context_v1(p_attempt,p_receipt,false);
 if p_producer is null or jsonb_typeof(p_producer)<>'object' or (select count(*) from jsonb_object_keys(p_producer))<>5
  or not(p_producer ?& array['version','memberCount','payloadBytes','memberSha256','manifestMemberSha256'])
  or p_producer->>'version' is distinct from 'complete-account-zip64-producer-v1'
  or jsonb_typeof(p_producer->'memberCount') is distinct from 'number'
  or jsonb_typeof(p_producer->'payloadBytes') is distinct from 'number'
  or jsonb_typeof(p_producer->'memberSha256') is distinct from 'string'
  or jsonb_typeof(p_producer->'manifestMemberSha256') is distinct from 'string'
  or (p_producer->>'memberCount')::numeric not between 1 and 9007199254740991
  or (p_producer->>'memberCount')::numeric<>trunc((p_producer->>'memberCount')::numeric)
  or (p_producer->>'payloadBytes')::numeric not between 1 and ar.byte_count
  or (p_producer->>'payloadBytes')::numeric<>trunc((p_producer->>'payloadBytes')::numeric)
  or coalesce(p_producer->>'memberSha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_producer->>'manifestMemberSha256','')!~'^[a-f0-9]{64}$' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 -- Recompute the byte core's exact ASCII descriptor tuple/newline digest.
 select encode(extensions.digest(convert_to(string_agg(format('[%s,%s,%s,%s,%s,%s]%s',ordinal,byte_offset,byte_count,
  to_json(sha256)::text,to_json(object_key)::text,to_json(object_id::text)::text,chr(10)),'' order by ordinal),'UTF8'),'sha256'),'hex')
 into native_manifest from private.export_archive_segments where attempt_id=p_attempt;
 if native_manifest is distinct from ar.manifest_sha256 then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 select * into jr from private.export_archive_jobs where export_id=ar.export_id;
 select least(jr.deadline,min(original_deadline)) into expires from private.account_archive_r2_allocations where attempt_id=p_attempt;
 if expires<=clock_timestamp()+interval '30 seconds' then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 -- The dedicated owner submitted this only after the actual producer's full
 -- member EOF and a fresh complete same-version provider readback. It is not
 -- an API Boolean or a grant to bypass source currentness.
 proof:=jsonb_build_object('producer',p_producer,'authorityReceipt',p_receipt,'archiveSha256',ar.archive_sha256,
  'manifestSha256',ar.manifest_sha256,'sizeBytes',ar.byte_count,'expiresAt',expires);
 update private.export_archive_attempts set account_r2_completion=proof where id=p_attempt;
 update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=expires,
  archive_sha256=ar.archive_sha256,manifest_sha256=ar.manifest_sha256,byte_count=ar.byte_count where id=ar.export_id;
 perform private.export_archive_current_v1(ar.export_id,p_receipt);
 return jsonb_build_object('status','ready','exportId',ar.export_id,'attemptId',p_attempt,'sizeBytes',ar.byte_count,
  'sha256',ar.archive_sha256,'manifestSha256',ar.manifest_sha256,'expiresAt',expires,
  'authorityReceipt',p_receipt,'principalHash',jr.principal_hash,'segmentCount',ar.segment_count,'pageCount',ar.page_count,
  'memberCount',(p_producer->>'memberCount')::bigint,'payloadBytes',(p_producer->>'payloadBytes')::bigint,
  'memberSha256',p_producer->>'memberSha256','manifestMemberSha256',p_producer->>'manifestMemberSha256');
end $$;

-- Preserve the entire original identity fence. The one new publication case
-- requires an immutable native receipt and owner-only TEST completion; the
-- configuration is disabled by default and no public READY RPC is granted.
create or replace function private.guard_segmented_export_publication_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_op='UPDATE' and old.archive_version='archive-segments-v1' and row(new.archive_version,new.account_id,
  new.requester_principal_id,new.export_kind,new.target_kind,new.target_id,new.purpose,new.lifecycle_revision,
  new.grant_revision,new.principal_graph_revision,new.principal_graph_fingerprint,new.export_revision,new.subject_partitions,new.requested_at)
  is distinct from row(old.archive_version,old.account_id,old.requester_principal_id,old.export_kind,old.target_kind,old.target_id,
  old.purpose,old.lifecycle_revision,old.grant_revision,old.principal_graph_revision,old.principal_graph_fingerprint,old.export_revision,old.subject_partitions,old.requested_at) then
  raise exception using errcode='23514',message='export_identity_immutable';end if;
 if new.archive_version='archive-segments-v1' and new.status='ready' and not(
  session_user='postgres' and new.target_kind='account' and exists(select 1 from private.export_archive_jobs j
   join private.export_archive_attempts a on a.id=j.active_attempt and a.export_id=j.export_id
   join private.account_archive_r2_configuration c on c.singleton where j.export_id=new.id and c.enabled
   and j.export_contract='account-export-v1' and j.origin->>'kind'='account' and a.state='bytes_complete'
   and a.account_r2_completion is not null and a.account_r2_completion->>'authorityReceipt'=j.authority_receipt
   and a.account_r2_completion->>'archiveSha256'=new.archive_sha256
   and a.account_r2_completion->>'manifestSha256'=new.manifest_sha256
   and (a.account_r2_completion->>'sizeBytes')::bigint=new.byte_count
   and (a.account_r2_completion->>'expiresAt')::timestamptz=new.expires_at)) then
  raise exception using errcode='55000',message='export_publication_not_integrated';end if;
 return new;
end $$;

create function private.ack_test_account_archive_download_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_download_hash text,p_origin jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,private as $$
declare ar private.export_archive_attempts;
begin
 ar:=private.account_archive_test_download_context_v1(p_attempt,p_receipt,p_download_hash,p_origin);
 if p_ordinal is null or p_ordinal<0 or p_ordinal>=ar.segment_count then
  raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 update private.export_archive_downloads set next_sequence=next_sequence+1,
  idle_expires_at=least(expires_at,clock_timestamp()+interval '5 minutes')
  where cookie_hash=p_download_hash and next_sequence=p_ordinal;
 if not found then raise exception using errcode='42501',message='account_archive_test_unavailable';end if;
 return true;
end $$;

revoke all on function private.guard_account_r2_completion_v1(),
 private.account_archive_r2_completed_context_v1(uuid,text,boolean),
 private.account_archive_test_download_context_v1(uuid,text,text,jsonb),
 private.account_archive_test_manifest_page_v1(uuid,text,bigint,text,jsonb),
 private.current_account_archive_test_object_v1(uuid,bigint,text,text,jsonb),
 private.complete_test_account_archive_v1(uuid,text,jsonb),
 private.ack_test_account_archive_download_v1(uuid,bigint,text,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
