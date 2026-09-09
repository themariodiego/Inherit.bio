-- Exact prepared-payload lifecycle. R2 completion means a permanent verified
-- empty fence, never key absence. Unknown Supabase physical versions stay pending.
create table private.own_prepared_cleanups (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null,
 file_id uuid not null references public.genome_files(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 mode text not null check(mode in('file','account','published-scratch','unpublished-scratch')),
 parent_token uuid,
 account_deletion_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 cleanup_deadline timestamptz not null,
 write_fence_at timestamptz not null,
 entry_count integer not null check(entry_count between 0 and 4096),
 state text not null default 'pending' check(state in('pending','claimed','complete')),
 claim_hash text check(claim_hash~'^[0-9a-f]{64}$'),
 claim_expires_at timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 completed_at timestamptz,
 check((state='complete')=(completed_at is not null)),
 check((mode='file')=(parent_token is not null)),
 check((mode='account')=(account_deletion_id is not null))
);
create unique index own_prepared_cleanup_active_job on private.own_prepared_cleanups(job_id) where state<>'complete';
create index own_prepared_cleanup_due on private.own_prepared_cleanups(state,created_at,id);
create table private.own_prepared_cleanup_entries (
 cleanup_id uuid not null references private.own_prepared_cleanups(id) on delete cascade,
 artifact_id uuid not null references private.own_preparation_artifacts(id) on delete restrict,
 sequence integer not null check(sequence between 0 and 4095),
 locator jsonb not null check(jsonb_typeof(locator)='object' and octet_length(locator::text)<=4096),
 evidence jsonb,
 acknowledged_at timestamptz,
 primary key(cleanup_id,artifact_id),unique(cleanup_id,sequence),
 check((evidence is null)=(acknowledged_at is null))
);
alter table private.own_prepared_cleanups enable row level security;
alter table private.own_prepared_cleanup_entries enable row level security;
revoke all on private.own_prepared_cleanups,private.own_prepared_cleanup_entries from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows',n,coalesce((select max(store_order) from public.purge_target_stores where target_id='variant-rows'),0)+i
 from (values('private.own_prepared_cleanup_entries',1),('private.own_prepared_cleanups',2)) v(n,i);

create function private.lock_own_prepared_cleanup_job_v1(p_job uuid) returns private.own_preparation_jobs
language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype;
begin
 select * into j from private.own_preparation_jobs where id=p_job;
 if j.id is null then raise exception using errcode='42501',message='not_found';end if;
 perform 1 from auth.users where id=j.account_id for share;
 perform 1 from auth.sessions where user_id=j.account_id order by id for share;
 perform 1 from public.profiles where id=j.account_id for update;
 perform 1 from public.subjects where id=j.subject_id for update;
 perform 1 from public.genome_files where id=j.file_id for update;
 select * into j from private.own_preparation_jobs where id=p_job for update;
 if j.id is null then raise exception using errcode='42501',message='not_found';end if;
 return j;
end; $$;

create function private.prepare_own_prepared_cleanup_v1(p_job uuid,p_mode text,p_parent uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; d private.own_prepared_cleanups%rowtype; selected integer; stamp timestamptz; artifact_row record;
begin
 if p_mode not in('file','account','published-scratch','unpublished-scratch') or p_mode is null then raise exception using errcode='22023',message='invalid_request';end if;
 j:=private.lock_own_prepared_cleanup_job_v1(p_job);
 if p_mode='file' and not exists(select 1 from private.genome_file_deletions where file_id=j.file_id and account_id=j.account_id and token=p_parent) then raise exception using errcode='42501',message='not_found';end if;
 if p_mode='account' and not exists(select 1 from public.account_deletion_requests where id=p_parent and account_id=j.account_id and state='delete_started') then raise exception using errcode='42501',message='not_found';end if;
 if p_mode='published-scratch' and j.state<>'published' then raise exception using errcode='42501',message='not_found';end if;
 if p_mode='unpublished-scratch' and j.state<>'frozen' then raise exception using errcode='42501',message='not_found';end if;
 select * into d from private.own_prepared_cleanups where job_id=j.id and state<>'complete' for update;
 if d.id is not null then
  -- Complete a previous immutable scratch selection before widening to file/account.
  return d.id;
 end if;
 if j.state not in('frozen','published') then
  stamp:=clock_timestamp();
  update private.own_preparation_jobs set state='frozen',frozen_at=stamp,
   write_fence_at=greatest(stamp,(select max(write_expires_at) from private.own_preparation_artifacts where job_id=j.id)) where id=j.id returning * into j;
 end if;
 perform 1 from private.own_prepared_manifests where job_id=j.id order by id for update;
 perform 1 from private.own_preparation_artifacts where job_id=j.id order by id for update;
 select count(*) into selected from private.own_preparation_artifacts a where a.job_id=j.id
  and (p_mode<>'published-scratch' or not exists(select 1 from private.own_prepared_manifest_members m where m.artifact_id=a.id));
 if selected>4096 then raise exception using errcode='55000',message='cleanup_capacity';end if;
 insert into private.own_prepared_cleanups(job_id,file_id,account_id,mode,parent_token,account_deletion_id,cleanup_deadline,write_fence_at,entry_count)
 values(j.id,j.file_id,j.account_id,p_mode,case when p_mode='file' then p_parent end,case when p_mode='account' then p_parent end,
 j.cleanup_deadline,greatest(clock_timestamp(),j.write_fence_at,(select max(write_expires_at) from private.own_preparation_artifacts where job_id=j.id)),selected) returning * into d;
 for artifact_row in select * from private.own_preparation_artifacts a where a.job_id=j.id
  and (p_mode<>'published-scratch' or not exists(select 1 from private.own_prepared_manifest_members m where m.artifact_id=a.id)) order by a.id loop
  insert into private.own_prepared_cleanup_entries(cleanup_id,artifact_id,sequence,locator)
   values(d.id,artifact_row.id,artifact_row.sequence,private.own_preparation_cleanup_locator_v1(artifact_row.id));
 end loop;
 return d.id;
end; $$;

-- File authorization remains the existing owner/session/subject/graph contract.
-- Obtain Auth-first locks before invoking its older file-first body.
create function public.prepare_own_prepared_file_cleanup_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare original jsonb; j uuid; cleanup uuid;
begin
 perform 1 from auth.users where id=p_account_id for share;
 perform 1 from auth.sessions where user_id=p_account_id order by id for share;
 perform 1 from public.profiles where id=p_account_id for update;
 perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=p_file_id and user_id=p_account_id) for update;
 original:=public.prepare_genome_file_deletion_v1(p_account_id,p_session_id,p_file_id);
 select id into j from private.own_preparation_jobs where file_id=p_file_id and account_id=p_account_id;
 if j is not null then cleanup:=private.prepare_own_prepared_cleanup_v1(j,'file',(original->>'token')::uuid);end if;
 return jsonb_build_object('version','own-prepared-file-cleanup-v1','original',original,'cleanupId',cleanup,'preparedComplete',j is null);
end; $$;

create function public.prepare_account_prepared_cleanup_v1(p_deletion_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare a uuid; j record; ids jsonb:='[]'; parent_deadline timestamptz;
begin
 select account_id into a from public.account_deletion_requests where id=p_deletion_id;
 if a is null then raise exception using errcode='42501',message='invalid_deletion_claim';end if;
 perform 1 from auth.users where id=a for share;
 perform 1 from auth.sessions where user_id=a order by id for share;
 perform 1 from public.profiles where id=a for update;
 select account_id,claim_expires_at into a,parent_deadline from public.account_deletion_requests where id=p_deletion_id and state='delete_started'
 and claim_token_hash=p_claim_token_hash and claim_expires_at>clock_timestamp() for update;
 if a is null then raise exception using errcode='42501',message='invalid_deletion_claim';end if;
 for j in select id from private.own_preparation_jobs where account_id=a order by id limit 16 loop
  ids:=ids||jsonb_build_array(private.prepare_own_prepared_cleanup_v1(j.id,'account',p_deletion_id));
 end loop;
 if parent_deadline<=clock_timestamp() then raise exception using errcode='42501',message='invalid_deletion_claim';end if;
 return jsonb_build_object('version','own-prepared-account-cleanup-v1','cleanupIds',ids,
 'preparedComplete',not exists(select 1 from private.own_preparation_jobs where account_id=a));
end; $$;

-- Bounded server-selected scratch work. Expired/revoked sessions may freeze
-- unpublished work; published source authority is never revoked by this sweep.
create function public.prepare_due_prepared_scratch_v1() returns integer
language plpgsql security definer set search_path=pg_catalog,private as $$
declare job_row record; n integer:=0;
begin
 perform public.freeze_due_own_preparations_v1();
 for job_row in select j.id,j.state from private.own_preparation_jobs j where j.state in('frozen','published')
 and (j.state='frozen' or exists(select 1 from private.own_preparation_checkpoints where job_id=j.id) or exists(select 1 from private.own_preparation_artifacts a where a.job_id=j.id
  and not exists(select 1 from private.own_prepared_manifest_members m where m.artifact_id=a.id)))
 and not exists(select 1 from private.own_prepared_cleanups d where d.job_id=j.id and d.state<>'complete')
 order by j.created_at,j.id limit 5 loop
  perform private.prepare_own_prepared_cleanup_v1(job_row.id,case when job_row.state='published' then 'published-scratch' else 'unpublished-scratch' end);
  n:=n+1;
 end loop;
 return n;
end; $$;

create function private.authorize_own_prepared_cleanup_v1(p_id uuid,p_hash text)
returns private.own_prepared_cleanups language plpgsql security definer set search_path=pg_catalog,private as $$
declare d private.own_prepared_cleanups%rowtype; j private.own_preparation_jobs%rowtype;
begin
 select * into d from private.own_prepared_cleanups where id=p_id;
 if d.id is null then raise exception using errcode='42501',message='not_found';end if;
 j:=private.lock_own_prepared_cleanup_job_v1(d.job_id);
 select * into d from private.own_prepared_cleanups where id=p_id for update;
 if d.state<>'claimed' or p_hash is null or d.claim_hash is distinct from p_hash or d.claim_expires_at<=clock_timestamp()
 or j.file_id is distinct from d.file_id or j.account_id is distinct from d.account_id then raise exception using errcode='42501',message='not_found';end if;
 if d.mode='file' and not exists(select 1 from private.genome_file_deletions where file_id=d.file_id and token=d.parent_token and account_id=d.account_id) then raise exception using errcode='42501',message='not_found';end if;
 if d.mode='account' and not exists(select 1 from public.account_deletion_requests where id=d.account_deletion_id and account_id=d.account_id and state='delete_started') then raise exception using errcode='42501',message='not_found';end if;
 if (d.mode='published-scratch' and j.state<>'published') or (d.mode='unpublished-scratch' and j.state<>'frozen') then raise exception using errcode='42501',message='not_found';end if;
 return d;
end; $$;

create function public.claim_own_prepared_cleanup_v1(p_claim_token_hash text,p_cleanup_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare candidate record; d private.own_prepared_cleanups%rowtype; entries jsonb;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_request';end if;
 for candidate in select id,job_id from private.own_prepared_cleanups where state<>'complete'
 and (p_cleanup_id is null or id=p_cleanup_id) and (claim_expires_at is null or claim_expires_at<=clock_timestamp()) order by created_at,id limit 5 loop
  perform private.lock_own_prepared_cleanup_job_v1(candidate.job_id);
  select * into d from private.own_prepared_cleanups where id=candidate.id for update skip locked;
  if d.id is null or d.state='complete' or d.claim_expires_at>clock_timestamp() then continue;end if;
  update private.own_prepared_cleanups set state='claimed',claim_hash=p_claim_token_hash,claim_expires_at=clock_timestamp()+interval '30 seconds',attempts=attempts+1 where id=d.id returning * into d;
  d:=private.authorize_own_prepared_cleanup_v1(d.id,p_claim_token_hash);
  select coalesce(jsonb_agg(jsonb_build_object('artifactId',artifact_id,'sequence',sequence,'locator',locator) order by sequence),'[]') into entries
  from (select * from private.own_prepared_cleanup_entries where cleanup_id=d.id and evidence is null order by sequence limit 16) e;
  return jsonb_build_object('version','own-prepared-cleanup-claim-v1','cleanupId',d.id,'mode',d.mode,'claimExpiresAt',d.claim_expires_at,
   'cleanupDeadline',d.cleanup_deadline,'writeFenceAt',d.write_fence_at,'entries',entries);
 end loop;
 return null;
end; $$;

create function public.check_own_prepared_cleanup_entry_v1(p_cleanup_id uuid,p_claim_token_hash text,p_artifact_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare d private.own_prepared_cleanups%rowtype; e private.own_prepared_cleanup_entries%rowtype; locator jsonb;
begin
 d:=private.authorize_own_prepared_cleanup_v1(p_cleanup_id,p_claim_token_hash);
 select * into e from private.own_prepared_cleanup_entries where cleanup_id=d.id and artifact_id=p_artifact_id for update;
 if e.artifact_id is null then raise exception using errcode='42501',message='not_found';end if;
 locator:=private.own_preparation_cleanup_locator_v1(e.artifact_id);
 if locator is distinct from e.locator then raise exception using errcode='42501',message='cleanup_identity_changed';end if;
 if d.mode='published-scratch' and exists(select 1 from private.own_prepared_manifest_members where artifact_id=e.artifact_id) then raise exception using errcode='42501',message='not_found';end if;
 if d.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('artifactId',e.artifact_id,'sequence',e.sequence,'locator',e.locator);
end; $$;

create function public.ack_own_prepared_cleanup_entry_v1(p_cleanup_id uuid,p_claim_token_hash text,p_artifact_id uuid,p_expected jsonb,p_evidence jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare current_entry jsonb; prior jsonb;
begin
 current_entry:=public.check_own_prepared_cleanup_entry_v1(p_cleanup_id,p_claim_token_hash,p_artifact_id);
 if current_entry is distinct from p_expected or current_entry#>>'{locator,provider}'<>'r2' then raise exception using errcode='42501',message='cleanup_unresolved';end if;
 if jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence-array['disposition','providerVersion','etag','byteCount','sha256']<>'{}'::jsonb
 or not(p_evidence ?& array['disposition','providerVersion','etag','byteCount','sha256'])
 or p_evidence->>'disposition' is distinct from 'payload-tombstoned'
 or jsonb_typeof(p_evidence->'providerVersion') is distinct from 'string'
 or coalesce(p_evidence->>'providerVersion','')!~'^[0-9a-f]{32}$'
 or p_evidence->>'etag' is distinct from 'd41d8cd98f00b204e9800998ecf8427e'
 or p_evidence->'byteCount' is distinct from '0'::jsonb
 or p_evidence->>'sha256' is distinct from 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' then raise exception using errcode='22023',message='invalid_cleanup_evidence';end if;
 select evidence into prior from private.own_prepared_cleanup_entries where cleanup_id=p_cleanup_id and artifact_id=p_artifact_id;
 if prior is not null then return prior=p_evidence;end if;
 update private.own_prepared_cleanup_entries set evidence=p_evidence,acknowledged_at=clock_timestamp() where cleanup_id=p_cleanup_id and artifact_id=p_artifact_id;
 if (select claim_expires_at from private.own_prepared_cleanups where id=p_cleanup_id)<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 return true;
end; $$;

create function public.finish_own_prepared_cleanup_v1(p_cleanup_id uuid,p_claim_token_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare d private.own_prepared_cleanups%rowtype; n integer; ids uuid[];
begin
 -- An exact completed claim may be replayed while the parent file remains.
 select * into d from private.own_prepared_cleanups where id=p_cleanup_id;
 if d.state='complete' and d.claim_hash=p_claim_token_hash then return true;end if;
 d:=private.authorize_own_prepared_cleanup_v1(p_cleanup_id,p_claim_token_hash);
 if exists(select 1 from private.own_prepared_cleanup_entries where cleanup_id=d.id and evidence is null) then return false;end if;
 select count(*),coalesce(array_agg(artifact_id),'{}') into n,ids from private.own_prepared_cleanup_entries where cleanup_id=d.id;
 if n<>d.entry_count or n<>(select count(*) from private.own_preparation_artifacts a where job_id=d.job_id and
  (d.mode<>'published-scratch' or not exists(select 1 from private.own_prepared_manifest_members m where m.artifact_id=a.id))) then raise exception using errcode='42501',message='cleanup_identity_changed';end if;
 if d.mode in('file','account') then
  delete from private.own_prepared_manifest_members where manifest_id in(select id from private.own_prepared_manifests where job_id=d.job_id);
  delete from private.own_prepared_manifests where job_id=d.job_id;
 end if;
 delete from private.own_prepared_cleanup_entries where cleanup_id=d.id;
 delete from private.own_preparation_artifacts where job_id=d.job_id and id=any(ids);
 -- Checkpoints describe provisional generations and never survive scratch retirement.
 delete from private.own_preparation_checkpoints where job_id=d.job_id;
 if d.mode in('file','account','unpublished-scratch') then delete from private.own_preparation_jobs where id=d.job_id;end if;
 if d.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 update private.own_prepared_cleanups set state='complete',completed_at=clock_timestamp() where id=d.id;
 return true;
end; $$;

create function public.release_own_prepared_cleanup_v1(p_cleanup_id uuid,p_claim_token_hash text)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 perform private.authorize_own_prepared_cleanup_v1(p_cleanup_id,p_claim_token_hash);
 update private.own_prepared_cleanups set state='pending',claim_hash=null,claim_expires_at=null where id=p_cleanup_id;
end; $$;

-- Old account completion cannot bypass prepared children. File deletion retains
-- existing RESTRICT job/artifact FKs until the exact cleanup finish removes them.
create function private.guard_account_prepared_cleanup_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.storage_completed_at is not null and old.storage_completed_at is null
 and exists(select 1 from private.own_preparation_jobs where account_id=new.account_id) then
  raise exception using errcode='55000',message='prepared_cleanup_pending';end if;
 return new;
end; $$;
create trigger guard_account_prepared_cleanup before update of storage_completed_at on public.account_deletion_requests
 for each row execute function private.guard_account_prepared_cleanup_v1();

-- Closed service-only RPC surface; private helpers remain unavailable to callers.
revoke all on function private.lock_own_prepared_cleanup_job_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.prepare_own_prepared_cleanup_v1(uuid,text,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid) to service_role;
revoke all on function public.prepare_account_prepared_cleanup_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.prepare_account_prepared_cleanup_v1(uuid,text) to service_role;
revoke all on function public.prepare_due_prepared_scratch_v1() from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.prepare_due_prepared_scratch_v1() to service_role;
revoke all on function private.authorize_own_prepared_cleanup_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.claim_own_prepared_cleanup_v1(text,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.claim_own_prepared_cleanup_v1(text,uuid) to service_role;
revoke all on function public.check_own_prepared_cleanup_entry_v1(uuid,text,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.check_own_prepared_cleanup_entry_v1(uuid,text,uuid) to service_role;
revoke all on function public.ack_own_prepared_cleanup_entry_v1(uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.ack_own_prepared_cleanup_entry_v1(uuid,text,uuid,jsonb,jsonb) to service_role;
revoke all on function public.finish_own_prepared_cleanup_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.finish_own_prepared_cleanup_v1(uuid,text) to service_role;
revoke all on function public.release_own_prepared_cleanup_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.release_own_prepared_cleanup_v1(uuid,text) to service_role;
revoke all on function private.guard_account_prepared_cleanup_v1() from public,anon,authenticated,inherit_upload_only,service_role;
