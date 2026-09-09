-- Inactive own prepared-object authority prototype. No writer, scheduler,
-- publication, existing-reader replacement or deletion-success operation.
-- Captured originating sessions remain live authority; there is no delegation.
create table private.own_preparation_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.own_preparation_config(singleton,enabled) values(true,false);
create table private.own_preparation_jobs (
 id uuid primary key default gen_random_uuid(),
 file_id uuid not null unique references public.genome_files(id) on delete restrict,
 account_id uuid not null references auth.users(id) on delete restrict,
 subject_id uuid not null references public.subjects(id) on delete restrict,
 session_id uuid not null,
 version text not null default 'own-preparation-job-v1' check(version='own-preparation-job-v1'),
 backend text not null default 'prepared-object-v1' check(backend='prepared-object-v1'),
 authority jsonb not null check(jsonb_typeof(authority)='object'),
 source jsonb not null check(jsonb_typeof(source)='object'),
 created_at timestamptz not null default clock_timestamp(),
 job_deadline timestamptz not null,
 cleanup_deadline timestamptz not null,
 state text not null default 'queued' check(state in('queued','claimed','frozen')),
 attempt_id uuid unique,
 claim_token_hash text check(claim_token_hash ~ '^[0-9a-f]{64}$'),
 claim_expires_at timestamptz,
 attempts smallint not null default 0 check(attempts between 0 and 3),
 reserved_bytes bigint not null default 0 check(reserved_bytes between 0 and 104857600),
 artifact_count integer not null default 0 check(artifact_count between 0 and 4096),
 frozen_at timestamptz,
 write_fence_at timestamptz,
 check(job_deadline>created_at and job_deadline<=created_at+interval '15 minutes'),
 check(cleanup_deadline=created_at+interval '2 hours'),
 check((attempt_id is null)=(claim_token_hash is null)),
 check((attempt_id is null)=(claim_expires_at is null)),
 check((attempts=0)=(attempt_id is null)),
 check(claim_expires_at is null or claim_expires_at<=job_deadline),
 check((state='frozen')=(frozen_at is not null and write_fence_at is not null)),
 check(state<>'claimed' or attempt_id is not null)
);
create index own_preparation_jobs_due_idx on private.own_preparation_jobs(state,created_at,id);
create table private.own_preparation_artifacts (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references private.own_preparation_jobs(id) on delete restrict,
 attempt_id uuid not null,
 sequence integer not null check(sequence between 0 and 4095),
 kind text not null check(kind='container'),
 object_key text not null unique default ('prepared/'||gen_random_uuid()::text)
  check(object_key ~ '^prepared/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 byte_count bigint not null check(byte_count between 1 and 8388608),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 write_expires_at timestamptz not null,
 state text not null default 'reserved' check(state in('reserved','acknowledged')),
 storage_object_id uuid unique,
 observed_sha256 text check(observed_sha256=sha256),
 acknowledged_at timestamptz,
 unique(job_id,sequence),
 check((state='acknowledged')=(storage_object_id is not null and acknowledged_at is not null and observed_sha256 is not null))
);
-- Object ids deliberately are not Storage foreign keys: a provider DELETE must
-- be possible before independent absence verification and metadata retirement.
alter table private.own_preparation_config enable row level security;
alter table private.own_preparation_jobs enable row level security;
alter table private.own_preparation_artifacts enable row level security;
revoke all on private.own_preparation_config,private.own_preparation_jobs,private.own_preparation_artifacts
 from public,anon,authenticated,inherit_upload_only,service_role;
-- Same source-working partition as private normalization staging; artifacts
-- must be physically removed before these RESTRICT-protected identities retire.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_preparation_artifacts',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_preparation_jobs',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';

create function private.guard_own_preparation_identity_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_table_name='own_preparation_jobs' then
  if (to_jsonb(new)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at']) is distinct from
   (to_jsonb(old)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at'])
   or (old.state='frozen' and to_jsonb(new) is distinct from to_jsonb(old))
   or new.attempts<old.attempts or new.reserved_bytes<old.reserved_bytes or new.artifact_count<old.artifact_count then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 else
  if (to_jsonb(new)-array['state','storage_object_id','observed_sha256','acknowledged_at']) is distinct from
    (to_jsonb(old)-array['state','storage_object_id','observed_sha256','acknowledged_at'])
   or (old.state='acknowledged' and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 end if;
 return new;
end; $$;
create trigger guard_own_preparation_job_identity before update on private.own_preparation_jobs
 for each row execute function private.guard_own_preparation_identity_v1();
create trigger guard_own_preparation_artifact_identity before update on private.own_preparation_artifacts
 for each row execute function private.guard_own_preparation_identity_v1();

create function private.own_preparation_source_v1(p_account uuid,p_session uuid,p_file uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; a jsonb; deadline timestamptz; maximum bigint;
begin
 select * into f from public.genome_files where id=p_file and user_id=p_account;
 if f.id is null or f.subject_id is null then raise exception using errcode='42501',message='not_found'; end if;
 a:=private.own_upload_store_authority_v1(p_account,p_session,f.subject_id);
 -- The existing helper locks account/subject before this exact source lock.
 select * into f from public.genome_files where id=p_file and user_id=p_account for update;
 if f.id is null or f.tier is distinct from 1 or f.file_type::text not in('vcf','gvcf')
  or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or f.status not in('uploaded','stored','failed') or f.normalization_completed_at is not null
  or f.sha256 is null or f.source_sha256 is null or f.storage_object_id is null
  or not exists(select 1 from public.subjects s where s.id=f.subject_id and s.subject_class='self'
   and s.lifecycle='active' and s.owner_account_id=p_account and s.subject_account_id=p_account)
  or exists(select 1 from private.genome_file_deletions d where d.file_id=f.id)
  or exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.state in('running','complete','rejecting','rejected'))
  or exists(select 1 from public.worker_jobs w where w.file_id=f.id and w.status in('queued','running')) then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
 where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
  and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
  and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
  and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes
 for share of g,o;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select maximum_vcf_bytes into maximum from private.upload_authorization_config where singleton for share;
 if maximum is null or f.size_bytes>maximum then raise exception using errcode='42501',message='not_found'; end if;
 select least(s.not_after,c.expires_at) into deadline from auth.sessions s join public.subject_consents c
  on c.id=(a->>'uploadConsentId')::uuid where s.id=p_session and s.user_id=p_account;
 if not found or (deadline is not null and deadline<=clock_timestamp()) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('authority',a,'authorityDeadline',deadline,'source',jsonb_build_object(
  'fileId',f.id,'subjectId',f.subject_id,'sourceRevision',f.upload_revision,'rawSha256',f.sha256,
  'decodedSha256',f.source_sha256,'bucket','genomes','objectId',f.storage_object_id,'objectKey',f.bucket_path,
  'sizeBytes',f.size_bytes,'fileType',f.file_type,'maximumDecodedBytes',maximum));
end; $$;

create function private.own_preparation_claim_receipt_v1(j private.own_preparation_jobs)
returns jsonb language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('version','own-preparation-claim-v1','jobId',j.id,'attemptId',j.attempt_id,
  'claimExpiresAt',j.claim_expires_at,'jobDeadline',j.job_deadline,'source',j.source,'authority',j.authority);
$$;
create function private.own_preparation_artifact_receipt_v1(a private.own_preparation_artifacts)
returns jsonb language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('version','own-preparation-artifact-v1','artifactId',a.id,'jobId',a.job_id,
  'attemptId',a.attempt_id,'sequence',a.sequence,'bucket','genomes','objectKey',a.object_key,
  'byteCount',a.byte_count,'sha256',a.sha256,'writeExpiresAt',a.write_expires_at);
$$;

create function private.enqueue_own_preparation_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c jsonb; j private.own_preparation_jobs%rowtype; stamp timestamptz; deadline timestamptz;
begin
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,p_file_id);
 select * into j from private.own_preparation_jobs where file_id=p_file_id for update;
 if j.id is null then
  stamp:=clock_timestamp(); deadline:=least(stamp+interval '15 minutes',(c->>'authorityDeadline')::timestamptz);
  if deadline<=stamp then raise exception using errcode='42501',message='not_found'; end if;
  insert into private.own_preparation_jobs(file_id,account_id,subject_id,session_id,authority,source,created_at,job_deadline,cleanup_deadline)
  values(p_file_id,p_account_id,(c->'source'->>'subjectId')::uuid,p_session_id,c->'authority',c->'source',stamp,deadline,stamp+interval '2 hours')
  returning * into j;
 elsif j.account_id is distinct from p_account_id or j.session_id is distinct from p_session_id
  or j.authority is distinct from c->'authority' or j.source is distinct from c->'source' then
  raise exception using errcode='42501',message='not_found';
 end if;
 if j.state='frozen' or j.job_deadline<=clock_timestamp() then
  raise exception using errcode='55000',message='preparation_cleanup_pending'; end if;
 return jsonb_build_object('version',j.version,'jobId',j.id,'fileId',j.file_id,'state',j.state,'jobDeadline',j.job_deadline);
end; $$;

create function private.claim_next_own_preparation_v1(p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare candidate record; j private.own_preparation_jobs%rowtype; c jsonb; stamp timestamptz;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 -- Candidate lookup is not authority. Obtain account/source locks before the
 -- job lock; a second claimant rechecks state after those locks are acquired.
 for candidate in select id,account_id,session_id,file_id from private.own_preparation_jobs
  where job_deadline>clock_timestamp() and attempts<3 and (state='queued' or
   (state='claimed' and claim_expires_at+make_interval(secs=>30*power(2,attempts)::integer)<=clock_timestamp()))
  order by created_at,id limit 5 loop
  begin c:=private.own_preparation_source_v1(candidate.account_id,candidate.session_id,candidate.file_id);
  exception when insufficient_privilege or object_not_in_prerequisite_state then continue; end;
  select * into j from private.own_preparation_jobs where id=candidate.id for update skip locked;
  if j.id is null or j.state='frozen' or j.attempts>=3 or j.job_deadline<=clock_timestamp()
   or j.authority is distinct from c->'authority' or j.source is distinct from c->'source'
   or (j.state='claimed' and j.claim_expires_at+make_interval(secs=>30*power(2,j.attempts)::integer)>clock_timestamp()) then continue; end if;
  if exists(select 1 from private.own_preparation_artifacts a where a.job_id=j.id and a.write_expires_at>clock_timestamp()) then continue; end if;
  stamp:=clock_timestamp();
  update private.own_preparation_jobs set state='claimed',attempt_id=gen_random_uuid(),claim_token_hash=p_claim_token_hash,
   attempts=attempts+1,claim_expires_at=least(stamp+interval '5 minutes',job_deadline,(c->>'authorityDeadline')::timestamptz)
   where id=j.id returning * into j;
  if j.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
  return private.own_preparation_claim_receipt_v1(j);
 end loop;
 return null;
end; $$;

create function private.check_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; c jsonb;
begin
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 select * into j from private.own_preparation_jobs where id=p_job_id;
 if j.id is null then raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_preparation_source_v1(j.account_id,j.session_id,j.file_id);
 select * into j from private.own_preparation_jobs where id=p_job_id for update;
 if j.state<>'claimed' or p_attempt_id is null or p_claim_token_hash is null
  or j.attempt_id is distinct from p_attempt_id or j.claim_token_hash is distinct from p_claim_token_hash
  or least(j.claim_expires_at,j.job_deadline,(c->>'authorityDeadline')::timestamptz)<=clock_timestamp()
  or j.authority is distinct from c->'authority' or j.source is distinct from c->'source' then
  raise exception using errcode='42501',message='not_found'; end if;
 return private.own_preparation_claim_receipt_v1(j);
end; $$;

create function private.reserve_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,p_descriptor jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; a private.own_preparation_artifacts%rowtype; c jsonb; sequence_no integer;
begin
 if jsonb_typeof(p_descriptor) is distinct from 'object' or octet_length(p_descriptor::text)>1024
  or not(p_descriptor ?& array['kind','sequence','byteCount','sha256'])
  or p_descriptor-array['kind','sequence','byteCount','sha256']<>'{}'::jsonb
  or p_descriptor->>'kind' is distinct from 'container'
  or jsonb_typeof(p_descriptor->'sequence') is distinct from 'number' or (p_descriptor->>'sequence')!~'^(0|[1-9][0-9]{0,3})$'
  or jsonb_typeof(p_descriptor->'byteCount') is distinct from 'number' or (p_descriptor->>'byteCount')!~'^[1-9][0-9]{0,7}$'
  or jsonb_typeof(p_descriptor->'sha256') is distinct from 'string' or (p_descriptor->>'sha256')!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
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
 if sequence_no<>j.artifact_count or j.artifact_count>=4096 or j.reserved_bytes+(p_descriptor->>'byteCount')::bigint>104857600 then
  raise exception using errcode='22023',message='artifact_limit_or_sequence'; end if;
 insert into private.own_preparation_artifacts(job_id,attempt_id,sequence,kind,byte_count,sha256,write_expires_at)
 values(j.id,p_attempt_id,sequence_no,'container',(p_descriptor->>'byteCount')::bigint,p_descriptor->>'sha256',
  least(clock_timestamp()+interval '30 seconds',j.claim_expires_at,j.job_deadline,(c->>'authorityDeadline')::timestamptz)) returning * into a;
 update private.own_preparation_jobs set artifact_count=artifact_count+1,reserved_bytes=reserved_bytes+a.byte_count where id=j.id;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 if a.write_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return private.own_preparation_artifact_receipt_v1(a);
end; $$;

create function private.ack_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_artifact_id uuid,p_storage_object_id uuid,p_expected_receipt jsonb,p_observed_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype;
begin
 if jsonb_typeof(p_expected_receipt) is distinct from 'object' or octet_length(p_expected_receipt::text)>2048 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into a from private.own_preparation_artifacts where id=p_artifact_id and job_id=p_job_id for update;
 if a.id is null or a.attempt_id is distinct from p_attempt_id or p_storage_object_id is null
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

-- Freeze is metadata-only and intentionally remains possible after live read
-- authority disappears. It never says bytes were deleted or returns read keys.
-- Auth rows are locked first, even when expired/revoked; missing session rows
-- do not prevent cleanup. This matches the live context lock order.
create function private.freeze_own_preparation_job_v1(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; stamp timestamptz;
begin
 select * into j from private.own_preparation_jobs where id=p_job_id;
 if j.id is null then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.users where id=j.account_id for share;
 perform 1 from auth.sessions where id=j.session_id and user_id=j.account_id for share;
 perform 1 from public.profiles where id=j.account_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 perform 1 from public.genome_files where id=j.file_id for update;
 select * into j from private.own_preparation_jobs where id=p_job_id for update;
 if j.state<>'frozen' then
  stamp:=clock_timestamp();
  update private.own_preparation_jobs set state='frozen',frozen_at=stamp,
   write_fence_at=greatest(stamp,(select max(write_expires_at) from private.own_preparation_artifacts where job_id=j.id))
   where id=j.id returning * into j;
 end if;
 return jsonb_build_object('version','own-preparation-freeze-v1','jobId',j.id,'state','frozen',
  'frozenAt',j.frozen_at,'writeFenceAt',j.write_fence_at,'cleanupDeadline',j.cleanup_deadline,'cleanupComplete',false);
end; $$;
create function private.freeze_own_preparation_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype;
begin
 select * into j from private.own_preparation_jobs where id=p_job_id;
 if j.id is null or p_attempt_id is null or p_claim_token_hash is null
  or j.attempt_id is distinct from p_attempt_id or j.claim_token_hash is distinct from p_claim_token_hash then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Recheck after the common lock order to exclude a concurrently replaced claim.
 perform 1 from auth.users where id=j.account_id for share;
 perform 1 from auth.sessions where id=j.session_id and user_id=j.account_id for share;
 perform 1 from public.profiles where id=j.account_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 perform 1 from public.genome_files where id=j.file_id for update;
 select * into j from private.own_preparation_jobs where id=p_job_id for update;
 if j.attempt_id is distinct from p_attempt_id or j.claim_token_hash is distinct from p_claim_token_hash then
  raise exception using errcode='42501',message='not_found'; end if;
 return private.freeze_own_preparation_job_v1(j.id);
end; $$;
create function private.freeze_due_own_preparations_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare candidate record; j private.own_preparation_jobs%rowtype; c jsonb; eligible boolean; count_frozen integer:=0;
begin
 -- No scheduler is attached. Service-owned bounded scan also catches revoked
 -- sessions/store grants before job expiry; no caller-selected account/target.
 for candidate in select * from private.own_preparation_jobs where state<>'frozen' order by created_at,id limit 5 loop
  -- Hold the same parent/source/job locks across eligibility and freeze. An
  -- expired candidate cannot accidentally freeze a newly replaced live claim.
  perform 1 from auth.users where id=candidate.account_id for share;
  perform 1 from auth.sessions where id=candidate.session_id and user_id=candidate.account_id for share;
  perform 1 from public.profiles where id=candidate.account_id for update;
  perform 1 from public.subjects where id=candidate.subject_id for update;
  perform 1 from public.genome_files where id=candidate.file_id for update;
  select * into j from private.own_preparation_jobs where id=candidate.id for update skip locked;
  if j.id is null or j.state='frozen' then continue; end if;
  eligible:=j.job_deadline<=clock_timestamp() or (j.attempts>=3 and j.claim_expires_at<=clock_timestamp());
  if not eligible then
   begin c:=private.own_preparation_source_v1(j.account_id,j.session_id,j.file_id);
    eligible:=c->'source' is distinct from j.source or c->'authority' is distinct from j.authority;
   exception when insufficient_privilege or object_not_in_prerequisite_state then eligible:=true; end;
  end if;
  if eligible then perform private.freeze_own_preparation_job_v1(j.id); count_frozen:=count_frozen+1; end if;
 end loop;
 return jsonb_build_object('version','own-preparation-freeze-scan-v1','frozen',count_frozen,'cleanupComplete',false);
end; $$;

-- The namespace guard survives every job/artifact row. Unknown prepared/*
-- names therefore never become writable after their metadata is retired.
-- This is a Storage metadata fence only: provider blob ordering and later
-- physical absence verification remain separate integration prerequisites.
create function private.guard_own_preparation_object_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare a private.own_preparation_artifacts%rowtype; j private.own_preparation_jobs%rowtype; size_field text;
begin
 if tg_op='UPDATE' then
  if (old.bucket_id='genomes' and old.name like 'prepared/%')
   or (new.bucket_id='genomes' and new.name like 'prepared/%') then
   raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
  return new;
 end if;
 if new.bucket_id<>'genomes' or new.name not like 'prepared/%' then return new; end if;
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 select * into a from private.own_preparation_artifacts where object_key=new.name;
 if a.id is null then raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 select * into j from private.own_preparation_jobs where id=a.job_id;
 if j.id is null then raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 -- The existing exact claim checker takes Auth user, originating session,
 -- profile, subject and source locks before its job lock. Artifact is last.
 begin
  perform private.check_own_preparation_claim_v1(j.id,a.attempt_id,j.claim_token_hash);
 exception when insufficient_privilege or object_not_in_prerequisite_state then
  raise exception using errcode='42501',message='prepared_object_unavailable'; end;
 select * into j from private.own_preparation_jobs where id=j.id for update;
 select * into a from private.own_preparation_artifacts where id=a.id for update;
 if a.id is null or a.job_id is distinct from j.id or a.attempt_id is distinct from j.attempt_id
  or a.object_key is distinct from new.name or a.state<>'reserved'
  or j.state<>'claimed' or least(a.write_expires_at,j.claim_expires_at,j.job_deadline)<=clock_timestamp() then
  raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 -- Storage v1.70.3 create-only admission uses a rollback-only version='1'
 -- INSERT with contentLength. Finalization uses a generated UUID version and
 -- metadata.size. A separate deferred constraint forbids committing probes.
 if new.version='1' then
  size_field:='contentLength';
 elsif new.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  size_field:='size';
 else raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 if jsonb_typeof(new.metadata->size_field) is distinct from 'number'
  or (new.metadata->>size_field)!~'^[1-9][0-9]{0,7}$'
  or (new.metadata->>size_field)::bigint<>a.byte_count then
  raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 -- Metadata hashes are not content evidence. Only a subsequent exact ACK can
 -- record the service transport's separately observed full-object SHA256.
 perform private.check_own_preparation_claim_v1(j.id,a.attempt_id,j.claim_token_hash);
 if least(a.write_expires_at,j.claim_expires_at,j.job_deadline)<=clock_timestamp() then
  raise exception using errcode='42501',message='prepared_object_unavailable'; end if;
 return new;
end; $$;
create trigger guard_own_preparation_object before insert or update on storage.objects
 for each row execute function private.guard_own_preparation_object_v1();
revoke all on function private.guard_own_preparation_object_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

create function private.refuse_committed_preparation_probe_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 -- Provider admission explicitly rolls its transaction back. Even a service
 -- caller cannot turn that weaker metadata shape into a committed object row.
 raise exception using errcode='42501',message='prepared_probe_uncommittable';
end; $$;
create constraint trigger refuse_committed_preparation_probe
 after insert on storage.objects deferrable initially deferred
 for each row when (new.bucket_id='genomes' and new.name like 'prepared/%' and new.version='1')
 execute function private.refuse_committed_preparation_probe_v1();
revoke all on function private.refuse_committed_preparation_probe_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Public RPC wrappers are invokers; only the service role can reach their
-- private authority-checking entry points. Internal source/receipt/freeze
-- helpers and all underlying tables remain inaccessible to service callers.
create function public.enqueue_own_preparation_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.enqueue_own_preparation_v1(p_account_id,p_session_id,p_file_id);
$$;
create function public.claim_next_own_preparation_v1(p_claim_token_hash text) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.claim_next_own_preparation_v1(p_claim_token_hash);
$$;
create function public.check_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
$$;
create function public.reserve_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,p_descriptor jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.reserve_own_preparation_artifact_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_descriptor);
$$;
create function public.ack_own_preparation_artifact_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,p_artifact_id uuid,p_storage_object_id uuid,p_expected_receipt jsonb,p_observed_sha256 text) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.ack_own_preparation_artifact_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_artifact_id,p_storage_object_id,p_expected_receipt,p_observed_sha256);
$$;
create function public.freeze_own_preparation_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.freeze_own_preparation_v1(p_job_id,p_attempt_id,p_claim_token_hash);
$$;
create function public.freeze_due_own_preparations_v1() returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$
 select private.freeze_due_own_preparations_v1();
$$;
revoke all on function private.enqueue_own_preparation_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.enqueue_own_preparation_v1(uuid,uuid,uuid) to service_role;
revoke all on function public.enqueue_own_preparation_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.enqueue_own_preparation_v1(uuid,uuid,uuid) to service_role;
revoke all on function private.claim_next_own_preparation_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.claim_next_own_preparation_v1(text) to service_role;
revoke all on function public.claim_next_own_preparation_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.claim_next_own_preparation_v1(text) to service_role;
revoke all on function private.check_own_preparation_claim_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.check_own_preparation_claim_v1(uuid,uuid,text) to service_role;
revoke all on function public.check_own_preparation_claim_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.check_own_preparation_claim_v1(uuid,uuid,text) to service_role;
revoke all on function private.reserve_own_preparation_artifact_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.reserve_own_preparation_artifact_v1(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.reserve_own_preparation_artifact_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.reserve_own_preparation_artifact_v1(uuid,uuid,text,jsonb) to service_role;
revoke all on function private.ack_own_preparation_artifact_v1(uuid,uuid,text,uuid,uuid,jsonb,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.ack_own_preparation_artifact_v1(uuid,uuid,text,uuid,uuid,jsonb,text) to service_role;
revoke all on function public.ack_own_preparation_artifact_v1(uuid,uuid,text,uuid,uuid,jsonb,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.ack_own_preparation_artifact_v1(uuid,uuid,text,uuid,uuid,jsonb,text) to service_role;
revoke all on function private.freeze_own_preparation_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.freeze_own_preparation_v1(uuid,uuid,text) to service_role;
revoke all on function public.freeze_own_preparation_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.freeze_own_preparation_v1(uuid,uuid,text) to service_role;
revoke all on function private.freeze_due_own_preparations_v1() from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.freeze_due_own_preparations_v1() to service_role;
revoke all on function public.freeze_due_own_preparations_v1() from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.freeze_due_own_preparations_v1() to service_role;
revoke all on function private.guard_own_preparation_identity_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.own_preparation_source_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.own_preparation_claim_receipt_v1(private.own_preparation_jobs) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.own_preparation_artifact_receipt_v1(private.own_preparation_artifacts) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.freeze_own_preparation_job_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

-- This migration neither schedules work nor registers a cleanup executor.
-- cleanup_deadline is fixed preparation.scratch-2h metadata; the future
-- coherent lifecycle must drain outstanding writes and verify object absence.
notify pgrst,'reload schema';
