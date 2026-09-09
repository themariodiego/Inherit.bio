-- R2 prepared objects: explicit provider identities, create-only signed writes,
-- and zero-byte tombstones for uncertain in-flight writes. Disabled by default.
alter table private.own_preparation_config
 add column artifact_provider text not null default 'supabase' check(artifact_provider in('supabase','r2')),
 add column r2_bucket text check(r2_bucket ~ '^inherit-prepared-[a-z0-9-]{1,40}$'),
 add column max_artifact_bytes bigint not null default 104857600 check(max_artifact_bytes between 1 and 1073741824),
 add constraint own_preparation_r2_config check(artifact_provider<>'r2' or r2_bucket is not null);
alter table private.own_preparation_jobs drop constraint own_preparation_jobs_reserved_bytes_check;
alter table private.own_preparation_jobs add constraint own_preparation_jobs_reserved_bytes_check check(reserved_bytes between 0 and 1073741824);
alter table private.own_preparation_artifacts
 add column provider text not null default 'supabase' check(provider in('supabase','r2')),
 add column provider_bucket text not null default 'genomes',
 add column provider_version text,
 add column provider_etag text;
alter table private.own_preparation_artifacts drop constraint own_preparation_artifacts_check1;
alter table private.own_preparation_artifacts add constraint own_preparation_artifact_provider_identity check(
 (provider='supabase' and provider_bucket='genomes' and provider_version is null and provider_etag is null
  and ((state='acknowledged')=(storage_object_id is not null and acknowledged_at is not null and observed_sha256 is not null)))
 or (provider='r2' and provider_bucket ~ '^inherit-prepared-[a-z0-9-]{1,40}$' and storage_object_id is null
  and ((state='reserved' and provider_version is null and provider_etag is null and acknowledged_at is null and observed_sha256 is null)
   or (state='acknowledged' and provider_version ~ '^[0-9a-f]{32}$' and provider_etag ~ '^[0-9a-f]{32}$'
    and provider_version is not null and provider_etag is not null and acknowledged_at is not null and observed_sha256 is not null))));

create function private.own_preparation_artifact_current_v1(p_artifact_id uuid,p_lock boolean default true) returns void
language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype;
begin
 if p_lock is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_lock then select * into a from private.own_preparation_artifacts where id=p_artifact_id for share;
 else select * into a from private.own_preparation_artifacts where id=p_artifact_id; end if;
 if a.id is null or a.state<>'acknowledged' or a.observed_sha256 is distinct from a.sha256 then
  raise exception using errcode='42501',message='not_found'; end if;
 if a.provider='r2' then
  if a.storage_object_id is not null or a.provider_version is null or a.provider_etag is null then
   raise exception using errcode='42501',message='not_found'; end if;
  -- Registry identity only. The transport verifies exact provider version and
  -- full selected bytes. SQL never manufactures a Storage row for R2.
 else
  if p_lock then perform 1 from storage.objects o where o.id=a.storage_object_id and o.bucket_id='genomes'
   and o.name=a.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=a.byte_count for share;
  else perform 1 from storage.objects o where o.id=a.storage_object_id and o.bucket_id='genomes'
   and o.name=a.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=a.byte_count; end if;
  if not found then raise exception using errcode='42501',message='not_found'; end if;
 end if;
end; $$;


create or replace function private.guard_own_preparation_identity_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_table_name='own_preparation_jobs' then
  if (to_jsonb(new)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at']) is distinct from
   (to_jsonb(old)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at'])
   or (old.state in('frozen','published') and to_jsonb(new) is distinct from to_jsonb(old))
   or (new.state='published' and old.state<>'claimed')
   or new.attempts<old.attempts or new.reserved_bytes<old.reserved_bytes or new.artifact_count<old.artifact_count then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 else
  if (to_jsonb(new)-array['state','storage_object_id','observed_sha256','acknowledged_at','provider_version','provider_etag']) is distinct from
    (to_jsonb(old)-array['state','storage_object_id','observed_sha256','acknowledged_at','provider_version','provider_etag'])
   or (old.state='acknowledged' and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 end if;
 return new;
end; $$;

create or replace function private.own_preparation_artifact_receipt_v1(a private.own_preparation_artifacts)
returns jsonb language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('version',case when a.provider='r2' then 'own-preparation-artifact-v2' else 'own-preparation-artifact-v1' end,'artifactId',a.id,'jobId',a.job_id,
  'attemptId',a.attempt_id,'sequence',a.sequence,'bucket',a.provider_bucket,'objectKey',a.object_key,
  'byteCount',a.byte_count,'sha256',a.sha256,'writeExpiresAt',a.write_expires_at)||case when a.provider='r2' then jsonb_build_object('provider','r2') else '{}'::jsonb end;
$$;

create function private.own_preparation_stored_artifact_v1(a private.own_preparation_artifacts) returns jsonb
language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('receipt',private.own_preparation_artifact_receipt_v1(a))||case when a.provider='r2'
  then jsonb_build_object('providerVersion',a.provider_version,'etag',a.provider_etag)
  else jsonb_build_object('storageObjectId',a.storage_object_id) end;
$$;
create function private.own_preparation_membership_tuple_v1(a private.own_preparation_artifacts) returns jsonb
language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_array(a.id,a.job_id,a.attempt_id,a.sequence,a.object_key,a.byte_count,a.sha256,a.storage_object_id)
  ||case when a.provider='r2' then jsonb_build_array(a.provider,a.provider_bucket,a.provider_version,a.provider_etag) else '[]'::jsonb end;
$$;
create function private.own_preparation_cleanup_locator_v1(p_artifact_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype; v text;
begin
 select * into a from private.own_preparation_artifacts where id=p_artifact_id for share;
 if a.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if a.provider='supabase' then select o.version into v from storage.objects o
  where o.id=a.storage_object_id and o.bucket_id=a.provider_bucket and o.name=a.object_key for share; end if;
 return jsonb_build_object('provider',a.provider,'bucket',a.provider_bucket,'objectKey',a.object_key,'byteCount',a.byte_count,'sha256',a.sha256)
  ||case when a.provider='r2' then jsonb_build_object('providerVersion',a.provider_version,'etag',a.provider_etag)
  else jsonb_build_object('storageObjectId',a.storage_object_id,'storageVersion',v) end;
end; $$;


create or replace function private.reserve_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,p_descriptor jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; a private.own_preparation_artifacts%rowtype; c jsonb; sequence_no integer; cfg private.own_preparation_config%rowtype;
begin
 if jsonb_typeof(p_descriptor) is distinct from 'object' or octet_length(p_descriptor::text)>1024
  or not(p_descriptor ?& array['kind','sequence','byteCount','sha256'])
  or p_descriptor-array['kind','sequence','byteCount','sha256']<>'{}'::jsonb
  or p_descriptor->>'kind' is distinct from 'container'
  or jsonb_typeof(p_descriptor->'sequence') is distinct from 'number' or (p_descriptor->>'sequence')!~'^(0|[1-9][0-9]{0,3})$'
  or jsonb_typeof(p_descriptor->'byteCount') is distinct from 'number' or (p_descriptor->>'byteCount')!~'^[1-9][0-9]{0,7}$'
  or jsonb_typeof(p_descriptor->'sha256') is distinct from 'string' or (p_descriptor->>'sha256')!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into cfg from private.own_preparation_config where singleton for share;
 sequence_no:=(p_descriptor->>'sequence')::integer;
 if sequence_no>4095 or (p_descriptor->>'byteCount')::bigint>8388608 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into j from private.own_preparation_jobs where id=p_job_id;
 c:=private.own_preparation_source_v1(j.account_id,j.session_id,j.file_id);
 select * into a from private.own_preparation_artifacts where job_id=j.id and sequence=sequence_no for update;
 if a.id is not null then
  if a.attempt_id is distinct from p_attempt_id or a.kind<>p_descriptor->>'kind'
   or a.byte_count<>(p_descriptor->>'byteCount')::bigint or a.sha256<>p_descriptor->>'sha256'
   or a.write_expires_at<=clock_timestamp() or a.write_expires_at>(c->>'authorityDeadline')::timestamptz then raise exception using errcode='22023',message='artifact_replay_conflict'; end if;
  return private.own_preparation_artifact_receipt_v1(a);
 end if;
 if sequence_no<>j.artifact_count or j.artifact_count>=4096 or j.reserved_bytes+(p_descriptor->>'byteCount')::bigint>cfg.max_artifact_bytes then
  raise exception using errcode='22023',message='artifact_limit_or_sequence'; end if;
 insert into private.own_preparation_artifacts(job_id,attempt_id,sequence,kind,byte_count,sha256,write_expires_at,provider,provider_bucket)
 values(j.id,p_attempt_id,sequence_no,'container',(p_descriptor->>'byteCount')::bigint,p_descriptor->>'sha256',
  least(clock_timestamp()+interval '30 seconds',j.claim_expires_at,j.job_deadline,(c->>'authorityDeadline')::timestamptz),cfg.artifact_provider,case when cfg.artifact_provider='r2' then cfg.r2_bucket else 'genomes' end) returning * into a;
 update private.own_preparation_jobs set artifact_count=artifact_count+1,reserved_bytes=reserved_bytes+a.byte_count where id=j.id;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 if a.write_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return private.own_preparation_artifact_receipt_v1(a);
end; $$;

create or replace function private.ack_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_artifact_id uuid,p_storage_object_id uuid,p_expected_receipt jsonb,p_observed_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype;
begin
 if jsonb_typeof(p_expected_receipt) is distinct from 'object' or octet_length(p_expected_receipt::text)>2048 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into a from private.own_preparation_artifacts where id=p_artifact_id and job_id=p_job_id for update;
 if a.id is null or a.provider is distinct from 'supabase' or a.attempt_id is distinct from p_attempt_id or p_storage_object_id is null
  or p_expected_receipt is distinct from private.own_preparation_artifact_receipt_v1(a)
  or p_observed_sha256 is distinct from a.sha256 or a.write_expires_at<=clock_timestamp()
  or (a.storage_object_id is not null and a.storage_object_id is distinct from p_storage_object_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 -- The service transport proves complete content hashing. SQL independently
 -- checks identity/size; a metadata ACK is not a claim that SQL hashed bytes.
 perform 1 from storage.objects o where o.id=p_storage_object_id and o.bucket_id='genomes'
  and o.name=a.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (o.metadata->>'size')::numeric=a.byte_count for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from public.genome_storage_objects where object_id=p_storage_object_id)
  or exists(select 1 from public.genome_files where storage_object_id=p_storage_object_id or bucket_path=a.object_key::text) then
  raise exception using errcode='42501',message='not_found'; end if;
 if a.state='reserved' then
  update private.own_preparation_artifacts set state='acknowledged',storage_object_id=p_storage_object_id,observed_sha256=p_observed_sha256,acknowledged_at=clock_timestamp()
   where id=a.id returning * into a;
 end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 if a.write_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return private.own_preparation_artifact_receipt_v1(a);
end; $$;

create function private.ack_own_preparation_r2_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_artifact_id uuid,p_expected_receipt jsonb,p_provider_version text,p_etag text,p_observed_sha256 text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype;
begin
 if p_provider_version is null or p_provider_version !~ '^[0-9a-f]{32}$' or p_etag is null or p_etag !~ '^[0-9a-f]{32}$'
  or jsonb_typeof(p_expected_receipt) is distinct from 'object' or octet_length(p_expected_receipt::text)>2048 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into a from private.own_preparation_artifacts where id=p_artifact_id and job_id=p_job_id for update;
 if a.id is null or a.provider is distinct from 'r2' or a.attempt_id is distinct from p_attempt_id
  or p_expected_receipt is distinct from private.own_preparation_artifact_receipt_v1(a)
  or p_observed_sha256 is distinct from a.sha256 or a.write_expires_at<=clock_timestamp()
  or (a.provider_version is not null and (a.provider_version is distinct from p_provider_version or a.provider_etag is distinct from p_etag)) then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Called only by service transport AFTER exact full GET/hash/EOF. This ACK is
 -- not independent provider proof and does not authorize read/publication alone.
 if a.state='reserved' then update private.own_preparation_artifacts set state='acknowledged',provider_version=p_provider_version,
  provider_etag=p_etag,observed_sha256=p_observed_sha256,acknowledged_at=clock_timestamp() where id=a.id returning * into a; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 if a.write_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return private.own_preparation_stored_artifact_v1(a);
end; $$;
create function public.ack_own_preparation_r2_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_artifact_id uuid,p_expected_receipt jsonb,p_provider_version text,p_etag text,p_observed_sha256 text) returns jsonb
language sql security invoker set search_path='' as $$
 select private.ack_own_preparation_r2_artifact_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_artifact_id,
 p_expected_receipt,p_provider_version,p_etag,p_observed_sha256);
$$;


create or replace function private.own_prepared_membership_v1(p_manifest_id uuid) returns text
language sql security definer set search_path=pg_catalog,private as $$
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(private.own_preparation_membership_tuple_v1(a) order by a.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 from private.own_prepared_manifest_members m join private.own_preparation_artifacts a on a.id=m.artifact_id
 where m.manifest_id=p_manifest_id;
$$;

create or replace function private.own_prepared_manifest_receipt_v1(m private.own_prepared_manifests) returns jsonb
language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('version','own-prepared-source-v1','backend','prepared-object-v1','manifestId',m.id,
  'fileId',m.file_id,'subjectId',m.source->'subjectId','sourceRevision',m.source->'sourceRevision',
  'rawSha256',m.source->'rawSha256','decodedSha256',m.source->'decodedSha256','preparedAt',m.published_at,
  'root',private.own_preparation_stored_artifact_v1(a),
  'summary',m.payload->'summary','memberCount',m.member_count,'membershipSha256',m.membership_sha256)
 from private.own_preparation_artifacts a where a.id=m.root_artifact_id;
$$;

create or replace function private.read_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected_manifest_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c record; m private.own_prepared_manifests%rowtype; a jsonb; deadline timestamptz;
 member record; seen integer:=0; result jsonb;
begin
 select * into c from private.own_prepared_read_context_v1(p_account_id,p_session_id,p_file_id,p_expected_manifest_id);
 m:=c.context_manifest; a:=c.context_authority; deadline:=c.context_deadline;
 for member in select t.*,x.manifest_id from private.own_prepared_manifest_members x
  join private.own_preparation_artifacts t on t.id=x.artifact_id where x.manifest_id=m.id order by t.id for share of x,t loop
  if member.job_id is distinct from m.job_id or member.attempt_id is distinct from m.attempt_id
   or member.state is distinct from 'acknowledged' or member.observed_sha256 is distinct from member.sha256 then
   raise exception using errcode='42501',message='not_found'; end if;
  perform private.own_preparation_artifact_current_v1(member.id);
  if not found then raise exception using errcode='42501',message='not_found'; end if;
  seen:=seen+1;
 end loop;
 if seen<>m.member_count or not exists(select 1 from private.own_prepared_manifest_members
   where manifest_id=m.id and artifact_id=m.root_artifact_id)
  or private.own_prepared_membership_v1(m.id) is distinct from m.membership_sha256
  or private.own_upload_store_authority_v1(p_account_id,p_session_id,(m.source->>'subjectId')::uuid) is distinct from a then
  raise exception using errcode='42501',message='not_found'; end if;
 result:=private.own_prepared_manifest_receipt_v1(m);
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create or replace function private.check_own_prepared_member_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,
 p_expected_manifest_id uuid,p_artifact_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c record; m private.own_prepared_manifests%rowtype; a jsonb; deadline timestamptz;
 member private.own_preparation_artifacts%rowtype; result jsonb;
begin
 if p_expected_manifest_id is null or p_artifact_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into c from private.own_prepared_read_context_v1(p_account_id,p_session_id,p_file_id,p_expected_manifest_id);
 m:=c.context_manifest; a:=c.context_authority; deadline:=c.context_deadline;
 -- The PK(manifest_id,artifact_id) and artifact PK bound this lookup to one
 -- immutable final member. An acknowledged scratch artifact is not a member.
 select ar.* into member from private.own_prepared_manifest_members mm
  join private.own_preparation_artifacts ar on ar.id=mm.artifact_id
  where mm.manifest_id=m.id and mm.artifact_id=p_artifact_id for share of mm,ar;
 if member.id is null or member.job_id is distinct from m.job_id or member.attempt_id is distinct from m.attempt_id
  or member.state is distinct from 'acknowledged' or member.observed_sha256 is distinct from member.sha256 then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.own_preparation_artifact_current_v1(member.id);
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if private.own_upload_store_authority_v1(p_account_id,p_session_id,(m.source->>'subjectId')::uuid) is distinct from a then
  raise exception using errcode='42501',message='not_found'; end if;
 result:=jsonb_build_object('version','own-prepared-member-v1','manifestId',m.id,'fileId',m.file_id,
  'membershipSha256',m.membership_sha256,'member',private.own_preparation_stored_artifact_v1(member));
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create or replace function private.publish_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_job_id uuid,
 p_attempt_id uuid,p_claim_token_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; m private.own_prepared_manifests%rowtype;
 root private.own_preparation_artifacts%rowtype; member private.own_preparation_artifacts%rowtype;
 c jsonb; current_c jsonb; canonical_payload jsonb; ids uuid[]; stamp timestamptz; deadline timestamptz; result jsonb; membership text; member_id uuid;
begin
 perform private.validate_own_prepared_publication_v1(p_payload);
 if (p_payload->'summary'->>'variantCount')::numeric>2147483647 then
  raise exception using errcode='22023',message='invalid_publication'; end if;
 select array_agg(x::uuid order by x::uuid) into ids from jsonb_array_elements_text(p_payload->'memberIds') x;
 canonical_payload:=jsonb_set(p_payload,'{memberIds}',to_jsonb(ids));
 select * into j from private.own_preparation_jobs where id=p_job_id and account_id=p_account_id;
 if j.id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- Completed retry authenticates a CURRENT session; the stale worker token is
 -- not permission. No state transition or deadline extension occurs on replay.
 if j.state='published' then
  result:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,j.file_id,null);
  select * into m from private.own_prepared_manifests where job_id=j.id;
  if m.payload is distinct from canonical_payload or m.attempt_id is distinct from p_attempt_id then
   raise exception using errcode='22023',message='publication_replay_conflict'; end if;
  return result;
 end if;
 if j.session_id is distinct from p_session_id then raise exception using errcode='42501',message='not_found'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,j.file_id);
 select * into j from private.own_preparation_jobs where id=p_job_id for update;
 -- An earlier publication may have won while this caller awaited source locks.
 if j.state is distinct from 'claimed' or j.attempt_id is distinct from p_attempt_id
  or j.claim_token_hash is distinct from p_claim_token_hash or j.source is distinct from c->'source'
  or j.authority is distinct from c->'authority' then raise exception using errcode='42501',message='not_found'; end if;
 -- Lock the complete registry, not just selected members, before closing writes.
 perform 1 from private.own_preparation_artifacts where job_id=j.id order by id for update;
 if exists(select 1 from private.own_preparation_artifacts where job_id=j.id and state<>'acknowledged') then
  raise exception using errcode='55000',message='preparation_writes_unsettled'; end if;
 select * into root from private.own_preparation_artifacts where id=(p_payload->>'rootArtifactId')::uuid;
 if root.id is null or root.job_id is distinct from j.id or root.attempt_id is distinct from p_attempt_id
  or root.byte_count>4000000 then raise exception using errcode='22023',message='publication_members_invalid'; end if;
 if (select count(*) from private.own_preparation_artifacts where id=any(ids) and job_id=j.id
  and attempt_id=p_attempt_id and state='acknowledged')<>cardinality(ids) then
  raise exception using errcode='22023',message='publication_members_invalid'; end if;
 foreach member_id in array ids loop
  select * into member from private.own_preparation_artifacts where id=member_id;
  if member.observed_sha256 is distinct from member.sha256 or member.sequence>root.sequence then
   raise exception using errcode='22023',message='publication_members_invalid'; end if;
  perform private.own_preparation_artifact_current_v1(member.id);
  if not found then raise exception using errcode='42501',message='not_found'; end if;
 end loop;
 current_c:=private.own_preparation_source_v1(p_account_id,p_session_id,j.file_id);
 if current_c is distinct from c then raise exception using errcode='42501',message='not_found'; end if;
 deadline:=least(j.claim_expires_at,j.job_deadline,(c->>'authorityDeadline')::timestamptz);
 stamp:=clock_timestamp();
 if deadline is null or deadline<=stamp then raise exception using errcode='42501',message='not_found'; end if;
 -- Insert an immutable final membership atomically with the file and job state.
 -- Membership digest is computed before INSERT so immutability needs no bypass.
 select encode(extensions.digest(convert_to(jsonb_agg(private.own_preparation_membership_tuple_v1(a) order by a.id)::text,'UTF8'),'sha256'),'hex') into membership
 from private.own_preparation_artifacts a where a.id=any(ids);
 insert into private.own_prepared_manifests(job_id,file_id,attempt_id,source,payload,root_artifact_id,
  member_count,membership_sha256,published_at) values(j.id,j.file_id,p_attempt_id,j.source,canonical_payload,root.id,
  cardinality(ids),membership,stamp) returning * into m;
 insert into private.own_prepared_manifest_members(manifest_id,artifact_id) select m.id,unnest(ids);
 update public.genome_files set status='stored',build=p_payload->'summary'->>'sourceBuild',
  variant_count=(p_payload->'summary'->>'variantCount')::integer,processing_finished_at=stamp,
  normalization_completed_at=stamp,normalization_source_revision=upload_revision where id=j.file_id;
 update private.own_preparation_jobs set state='published' where id=j.id;
 result:=private.own_prepared_manifest_receipt_v1(m);
 if clock_timestamp()>=deadline then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create or replace function private.own_report_source_metadata_v1(p_account_id uuid,p_file_id uuid,p_lock boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; n private.own_normalization_runs%rowtype;
 j private.own_preparation_jobs%rowtype; m private.own_prepared_manifests%rowtype;
 root private.own_preparation_artifacts%rowtype;
begin
 if p_lock is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_lock then
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for share;
 else select * into f from public.genome_files where id=p_file_id and user_id=p_account_id; end if;
 if f.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_lock then
  select * into j from private.own_preparation_jobs where file_id=f.id for share;
  select * into m from private.own_prepared_manifests where file_id=f.id for share;
 else
  select * into j from private.own_preparation_jobs where file_id=f.id;
  select * into m from private.own_prepared_manifests where file_id=f.id;
 end if;
 -- A frozen attempt with no publication may recover through the existing
 -- genuine DB normalizer. Active/published attempts never fall back.
 if m.id is not null or (j.id is not null and j.state<>'frozen') then
  if m.id is null or j.state is distinct from 'published' or m.job_id is distinct from j.id
   or j.account_id is distinct from p_account_id or m.attempt_id is distinct from j.attempt_id
   or m.source is distinct from j.source or f.subject_id is distinct from j.subject_id
   or f.status is null or f.status not in('stored','annotated') or f.tier is distinct from 1
   or f.normalization_completed_at is distinct from m.published_at
   or f.normalization_source_revision is distinct from f.upload_revision
   or f.build is distinct from m.payload->'summary'->>'sourceBuild'
   or f.variant_count::bigint is distinct from (m.payload->'summary'->>'variantCount')::bigint
   or f.sha256 is distinct from m.source->>'rawSha256' or f.source_sha256 is distinct from m.source->>'decodedSha256'
   or f.upload_revision is distinct from (m.source->>'sourceRevision')::bigint
   or f.storage_object_id is distinct from (m.source->>'objectId')::uuid
   or f.bucket_path is distinct from m.source->>'objectKey' or f.size_bytes is distinct from (m.source->>'sizeBytes')::bigint
   or f.file_type::text is distinct from m.source->>'fileType'
   or f.file_type::text not in('vcf','gvcf')
   or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
   or exists(select 1 from private.genome_file_deletions where file_id=f.id)
   or exists(select 1 from private.own_normalization_runs where file_id=f.id and state in('running','complete','rejecting','rejected'))
   or exists(select 1 from public.worker_jobs where file_id=f.id and status in('queued','running'))
   or not exists(select 1 from public.subjects s join public.subject_account_bindings b on b.subject_id=s.id
    where s.id=f.subject_id and s.subject_class='self' and s.lifecycle='active'
     and s.owner_account_id=p_account_id and s.subject_account_id=p_account_id
     and b.account_id=p_account_id and b.status='current'
     and to_jsonb(s.subject_binding_revision)=j.authority->'subjectBindingRevision'
     and to_jsonb(b.binding_revision)=j.authority->'accountBindingRevision'
     and to_jsonb(s.lifecycle_revision)=j.authority->'subjectLifecycleRevision') then
   raise exception using errcode='42501',message='not_found'; end if;
  if p_lock then
   select a.* into root from private.own_prepared_manifest_members mm
    join private.own_preparation_artifacts a on a.id=mm.artifact_id
    where mm.manifest_id=m.id and mm.artifact_id=m.root_artifact_id for share of mm,a;
  else
   select a.* into root from private.own_prepared_manifest_members mm
    join private.own_preparation_artifacts a on a.id=mm.artifact_id
    where mm.manifest_id=m.id and mm.artifact_id=m.root_artifact_id;
  end if;
  if root.id is null or root.job_id is distinct from m.job_id or root.attempt_id is distinct from m.attempt_id
   or root.state is distinct from 'acknowledged' or root.observed_sha256 is distinct from root.sha256 then
   raise exception using errcode='42501',message='not_found'; end if;
  perform private.own_preparation_artifact_current_v1(root.id,p_lock);
 else
  if p_lock then
   select * into n from private.own_normalization_runs where file_id=f.id and account_id=p_account_id and state='complete' for share;
  else select * into n from private.own_normalization_runs where file_id=f.id and account_id=p_account_id and state='complete'; end if;
  if n.file_id is null or (n.manifest->>'rawSha256'=f.sha256
   and n.manifest->>'decodedSha256'=f.source_sha256
   and (n.manifest->>'sourceRevision')::bigint=f.upload_revision
   and n.manifest->>'objectId'=f.storage_object_id::text
   and n.manifest->>'objectKey'=f.bucket_path) is not true then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 if p_lock then
  perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
   where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
    and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
    and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
    and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes for share of g,o;
 else
  perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
   where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
    and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
    and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
    and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes;
 end if;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('fileType',f.file_type,'verifiedFileType',case when m.id is not null then m.source->'fileType' else n.manifest->'fileType' end)
  ||case when m.id is null then '{}'::jsonb else jsonb_build_object('preparedSource',jsonb_build_object(
   'version','own-prepared-report-source-v1','backend','prepared-object-v1','manifestId',m.id,
   'membershipSha256',m.membership_sha256,'rootArtifactId',root.id,'rootSha256',root.sha256)) end;
end; $$;

create or replace function private.own_report_members_metadata_current_v1(p_account_id uuid,p_file_id uuid,p_source jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare metadata jsonb; m private.own_prepared_manifests%rowtype; member record; seen integer:=0;
begin
 metadata:=private.own_report_source_metadata_v1(p_account_id,p_file_id,true);
 if p_source is null or metadata->'preparedSource' is distinct from p_source then return false; end if;
 select * into m from private.own_prepared_manifests where file_id=p_file_id and id=(p_source->>'manifestId')::uuid for share;
 if m.id is null then return false; end if;
 for member in select a.* from private.own_prepared_manifest_members mm
  join private.own_preparation_artifacts a on a.id=mm.artifact_id where mm.manifest_id=m.id order by a.id for share of mm,a loop
  if member.job_id is distinct from m.job_id or member.attempt_id is distinct from m.attempt_id
   or member.state is distinct from 'acknowledged' or member.observed_sha256 is distinct from member.sha256 then return false; end if;
  perform private.own_preparation_artifact_current_v1(member.id);
  if not found then return false; end if;
  seen:=seen+1;
 end loop;
 if seen<>m.member_count or private.own_prepared_membership_v1(m.id) is distinct from m.membership_sha256 then return false; end if;
 return private.own_report_source_metadata_v1(p_account_id,p_file_id,false)->'preparedSource'=p_source;
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return false;
end; $$;

revoke all on function private.own_preparation_artifact_current_v1(uuid,boolean),
 private.own_preparation_stored_artifact_v1(private.own_preparation_artifacts),
 private.own_preparation_membership_tuple_v1(private.own_preparation_artifacts),
 private.own_preparation_cleanup_locator_v1(uuid),
 private.ack_own_preparation_r2_artifact_v1(uuid,uuid,text,uuid,jsonb,text,text,text),
 public.ack_own_preparation_r2_artifact_v1(uuid,uuid,text,uuid,jsonb,text,text,text)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.ack_own_preparation_r2_artifact_v1(uuid,uuid,text,uuid,jsonb,text,text,text),
 public.ack_own_preparation_r2_artifact_v1(uuid,uuid,text,uuid,jsonb,text,text,text) to service_role;

-- Private worker context and exact provisional-artifact reads. These are never
-- browser grants: service credentials and the live captured claim are required.
create function private.claim_next_own_preparation_work_v1(p_claim_token_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare c jsonb; j private.own_preparation_jobs%rowtype;
begin
 c:=private.claim_next_own_preparation_v1(p_claim_token_hash);
 if c is null then return null; end if;
 select * into j from private.own_preparation_jobs where id=(c->>'jobId')::uuid;
 perform private.check_own_preparation_claim_v1(j.id,(c->>'attemptId')::uuid,p_claim_token_hash);
 return jsonb_build_object('claim',c,'actor',jsonb_build_object('accountId',j.account_id,'sessionId',j.session_id));
end; $$;
create function public.claim_next_own_preparation_work_v1(p_claim_token_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select private.claim_next_own_preparation_work_v1(p_claim_token_hash); $$;

create function private.check_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_expected_artifact jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype; result jsonb;
begin
 if jsonb_typeof(p_expected_artifact) is distinct from 'object' or octet_length(p_expected_artifact::text)>4096
  or coalesce(p_expected_artifact->'receipt'->>'artifactId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into a from private.own_preparation_artifacts where id=(p_expected_artifact->'receipt'->>'artifactId')::uuid for share;
 if a.job_id is distinct from p_job_id or a.attempt_id is distinct from p_attempt_id then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.own_preparation_artifact_current_v1(a.id);
 result:=private.own_preparation_stored_artifact_v1(a);
 if result is distinct from p_expected_artifact then raise exception using errcode='42501',message='not_found'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 return result;
end; $$;
create function public.check_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_expected_artifact jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.check_own_preparation_artifact_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_expected_artifact); $$;
revoke all on function private.claim_next_own_preparation_work_v1(text),public.claim_next_own_preparation_work_v1(text),
 private.check_own_preparation_artifact_v1(uuid,uuid,text,jsonb),public.check_own_preparation_artifact_v1(uuid,uuid,text,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.claim_next_own_preparation_work_v1(text),public.claim_next_own_preparation_work_v1(text),
 private.check_own_preparation_artifact_v1(uuid,uuid,text,jsonb),public.check_own_preparation_artifact_v1(uuid,uuid,text,jsonb) to service_role;
