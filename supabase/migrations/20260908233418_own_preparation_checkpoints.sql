-- Durable progress for one CURRENT preparation attempt. No capability issuance,
-- cross-attempt adoption, provider operation, scheduler activation or publication.
-- Defaults remain the existing 15-minute job and fixed two-hour scratch cleanup.
alter table private.own_preparation_config add column max_job_seconds integer not null default 900
 check(max_job_seconds between 900 and 3600);
do $$declare constraint_name text; n integer; begin
 select count(*),min(conname) into n,constraint_name from pg_constraint
 where conrelid='private.own_preparation_jobs'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%job_deadline > created_at%';
 if n<>1 then raise exception 'preparation_deadline_constraint_mismatch'; end if;
 execute format('alter table private.own_preparation_jobs drop constraint %I',constraint_name);
end; $$;
alter table private.own_preparation_jobs add constraint own_preparation_jobs_worker_deadline_bound
 check(job_deadline>created_at and job_deadline<=created_at+interval '1 hour');

create table private.own_preparation_checkpoints (
 job_id uuid primary key references private.own_preparation_jobs(id) on delete cascade,
 attempt_id uuid not null,
 revision bigint not null check(revision between 1 and 1000000),
 checkpoint jsonb not null check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=4000000),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.own_preparation_checkpoints enable row level security;
revoke all on private.own_preparation_checkpoints from public,anon,authenticated,inherit_upload_only,service_role;
-- Exact guarded job retirement removes only its bounded, non-authorizing
-- checkpoint. There is no second lifetime and no genetic-source fallback.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_preparation_checkpoints',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';

create or replace function private.enqueue_own_preparation_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c jsonb; j private.own_preparation_jobs%rowtype; stamp timestamptz; deadline timestamptz; seconds integer;
begin
 select max_job_seconds into seconds from private.own_preparation_config where singleton and enabled for share;
 if not found then raise exception using errcode='55000',message='preparation_disabled'; end if;
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,p_file_id);
 select * into j from private.own_preparation_jobs where file_id=p_file_id for update;
 if j.id is null then
  stamp:=clock_timestamp(); deadline:=least(stamp+make_interval(secs=>seconds),(c->>'authorityDeadline')::timestamptz);
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

create function private.own_preparation_phase_rank_v1(p_phase text) returns integer
language sql immutable set search_path=pg_catalog as $$
 select array_position(array['source-scan','source-runs','source-merge','canonical-runs','canonical-merge',
  'canonical-materialization','rsid-runs','rsid-merge','publication-preflight'],p_phase);
$$;
create function private.read_own_preparation_checkpoint_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c jsonb; j private.own_preparation_jobs%rowtype; p private.own_preparation_checkpoints%rowtype;
begin
 c:=private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into j from private.own_preparation_jobs where id=p_job_id;
 select * into p from private.own_preparation_checkpoints where job_id=p_job_id for share;
 -- A checkpoint from a prior attempt is never adopted. Expired attempts require
 -- exact cleanup and a fresh job; neither read nor renewal resurrects them.
 if p.job_id is not null and p.attempt_id is distinct from p_attempt_id then
  raise exception using errcode='55000',message='preparation_cleanup_pending'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 return jsonb_build_object('version','own-preparation-checkpoint-receipt-v1','jobId',j.id,'attemptId',j.attempt_id,
  'revision',coalesce(p.revision,0),'nextArtifactSequence',j.artifact_count,'checkpoint',p.checkpoint);
end; $$;

create function private.write_own_preparation_checkpoint_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,
 p_expected_revision bigint,p_checkpoint jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; old private.own_preparation_checkpoints%rowtype;
 phase_rank integer; old_rank integer; generation integer; completed integer; item jsonb; a private.own_preparation_artifacts%rowtype;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=1000000
  or jsonb_typeof(p_checkpoint) is distinct from 'object' or octet_length(p_checkpoint::text)>4000000
  or not(p_checkpoint ?& array['version','state','phase','sourceScan','generation','completedInputRuns','inputs','outputs','nextArtifactSequence','terminal','resume'])
  or p_checkpoint-array['version','state','phase','sourceScan','generation','completedInputRuns','inputs','outputs','nextArtifactSequence','terminal','resume']<>'{}'::jsonb
  or p_checkpoint->>'version' is distinct from 'own-preparation-checkpoint-v1' or p_checkpoint->>'state' is distinct from 'provisional'
  or jsonb_typeof(p_checkpoint->'inputs') is distinct from 'array' or jsonb_typeof(p_checkpoint->'outputs') is distinct from 'array'
  or jsonb_typeof(p_checkpoint->'sourceScan') is distinct from 'object'
  or jsonb_typeof(p_checkpoint->'generation') is distinct from 'number' or (p_checkpoint->>'generation')!~'^(0|[1-9][0-9]{0,3})$'
  or jsonb_typeof(p_checkpoint->'completedInputRuns') is distinct from 'number' or (p_checkpoint->>'completedInputRuns')!~'^(0|[1-9][0-9]{0,3})$'
  or jsonb_typeof(p_checkpoint->'nextArtifactSequence') is distinct from 'number' or (p_checkpoint->>'nextArtifactSequence')!~'^(0|[1-9][0-9]{0,3})$' then
  raise exception using errcode='22023',message='invalid_checkpoint'; end if;
 phase_rank:=private.own_preparation_phase_rank_v1(p_checkpoint->>'phase');
 generation:=(p_checkpoint->>'generation')::integer; completed:=(p_checkpoint->>'completedInputRuns')::integer;
 if phase_rank is null or jsonb_array_length(p_checkpoint->'inputs')>4096 or jsonb_array_length(p_checkpoint->'outputs')>4096
  or generation>4096 or completed>jsonb_array_length(p_checkpoint->'inputs') then
  raise exception using errcode='22023',message='invalid_checkpoint'; end if;
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into j from private.own_preparation_jobs where id=p_job_id;
 select * into old from private.own_preparation_checkpoints where job_id=p_job_id for update;
 if old.job_id is not null and old.attempt_id is distinct from p_attempt_id then
  raise exception using errcode='55000',message='preparation_cleanup_pending'; end if;
 if coalesce(old.revision,0)<>p_expected_revision then
  raise exception using errcode='40001',message='checkpoint_revision_conflict'; end if;
 if (p_checkpoint->>'nextArtifactSequence')::integer<>j.artifact_count
  or p_checkpoint->'sourceScan'->'source' is distinct from j.source
  or p_checkpoint->'sourceScan'->>'version' is distinct from 'own-preparation-source-v1'
  or p_checkpoint->'sourceScan'->>'rawSha256' is distinct from j.source->>'rawSha256'
  or p_checkpoint->'sourceScan'->>'decodedSha256' is distinct from j.source->>'decodedSha256'
  or coalesce(p_checkpoint->'sourceScan'->>'build','') not in('GRCh37','GRCh38') then
  raise exception using errcode='42501',message='not_found'; end if;
 if old.job_id is not null then
  old_rank:=private.own_preparation_phase_rank_v1(old.checkpoint->>'phase');
  if phase_rank<old_rank or (phase_rank=old_rank and generation<(old.checkpoint->>'generation')::integer)
   or (phase_rank=old_rank and generation=(old.checkpoint->>'generation')::integer
    and completed<(old.checkpoint->>'completedInputRuns')::integer) then
   raise exception using errcode='22023',message='checkpoint_regression'; end if;
 end if;
 -- Bounded metadata-only receipt membership. Provider bytes/hash/EOF remain the
 -- writer/reader's obligation, and final publication independently verifies ALL
 -- membership. A checkpoint never claims a genetic source is ready to read.
 for item in select distinct value from jsonb_path_query(p_checkpoint,'$.**.receipt') as receipts(value) loop
  if jsonb_typeof(item) is distinct from 'object' or (item->>'artifactId') is null
   or (item->>'artifactId')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception using errcode='22023',message='invalid_checkpoint'; end if;
  select * into a from private.own_preparation_artifacts where id=(item->>'artifactId')::uuid for share;
  if a.id is null or a.job_id<>j.id or a.attempt_id<>p_attempt_id or a.state<>'acknowledged'
   or item is distinct from private.own_preparation_artifact_receipt_v1(a) then
   raise exception using errcode='42501',message='not_found'; end if;
 end loop;
 if exists(select 1 from private.own_preparation_artifacts where job_id=j.id and attempt_id=p_attempt_id and state<>'acknowledged') then
  raise exception using errcode='55000',message='preparation_write_unsettled'; end if;
 insert into private.own_preparation_checkpoints(job_id,attempt_id,revision,checkpoint)
 values(j.id,p_attempt_id,p_expected_revision+1,p_checkpoint)
 on conflict(job_id) do update set revision=excluded.revision,checkpoint=excluded.checkpoint,updated_at=clock_timestamp();
 -- Locks cannot stop clock expiry. Repeat the current source fence last.
 return private.read_own_preparation_checkpoint_v1(p_job_id,p_attempt_id,p_claim_token_hash);
end; $$;

create function private.renew_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; c jsonb; expiry timestamptz;
begin
 -- Requires STILL live old lease; no expired-lease resurrection or token change.
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into j from private.own_preparation_jobs where id=p_job_id;
 c:=private.own_preparation_source_v1(j.account_id,j.session_id,j.file_id);
 expiry:=least(clock_timestamp()+interval '5 minutes',j.job_deadline,(c->>'authorityDeadline')::timestamptz);
 if expiry<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 update private.own_preparation_jobs set claim_expires_at=greatest(claim_expires_at,expiry) where id=j.id
  and least(claim_expires_at,job_deadline,(c->>'authorityDeadline')::timestamptz)>clock_timestamp() returning * into j;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
end; $$;

create function public.read_own_preparation_checkpoint_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select private.read_own_preparation_checkpoint_v1(p_job_id,p_attempt_id,p_claim_token_hash); $$;
create function public.write_own_preparation_checkpoint_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text,p_expected_revision bigint,p_checkpoint jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select private.write_own_preparation_checkpoint_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_expected_revision,p_checkpoint); $$;
create function public.renew_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,p_claim_token_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select private.renew_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash); $$;
revoke all on function private.own_preparation_phase_rank_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.read_own_preparation_checkpoint_v1(uuid,uuid,text),
 private.write_own_preparation_checkpoint_v1(uuid,uuid,text,bigint,jsonb),private.renew_own_preparation_claim_v1(uuid,uuid,text),
 public.read_own_preparation_checkpoint_v1(uuid,uuid,text),public.write_own_preparation_checkpoint_v1(uuid,uuid,text,bigint,jsonb),
 public.renew_own_preparation_claim_v1(uuid,uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.read_own_preparation_checkpoint_v1(uuid,uuid,text),
 private.write_own_preparation_checkpoint_v1(uuid,uuid,text,bigint,jsonb),private.renew_own_preparation_claim_v1(uuid,uuid,text),
 public.read_own_preparation_checkpoint_v1(uuid,uuid,text),public.write_own_preparation_checkpoint_v1(uuid,uuid,text,bigint,jsonb),
 public.renew_own_preparation_claim_v1(uuid,uuid,text) to service_role;

-- Current-owner metadata only. A different current session may observe status,
-- but it never replaces the originating worker session or renews that worker.
create function private.own_preparation_status_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; j private.own_preparation_jobs%rowtype; c jsonb;
 state text; deadline timestamptz;
begin
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.subject_id is null or f.tier<>1 or f.file_type::text not in('vcf','gvcf')
  or f.single_logical_sample_verified_at is null or not exists(select 1 from public.subjects where id=f.subject_id
   and subject_class='self' and owner_account_id=p_account_id and subject_account_id=p_account_id and lifecycle='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Preliminary lookup only chooses the appropriate current authority resolver.
 select * into j from private.own_preparation_jobs where file_id=f.id;
 if j.state='published' then
  perform private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,null);
  return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',j.id,'status','prepared');
 end if;
 if j.id is null and f.normalization_completed_at is not null then
  perform private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
  return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',null,'status','not_applicable');
 end if;
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,p_file_id);
 select * into j from private.own_preparation_jobs where file_id=p_file_id for share;
 if j.id is null then state:='not_requested';
 else
  if j.account_id is distinct from p_account_id or j.subject_id is distinct from f.subject_id or j.source is distinct from c->'source' then
   raise exception using errcode='42501',message='not_found'; end if;
  state:=case when j.state='frozen' or j.job_deadline<=clock_timestamp() then 'failed' else 'preparing' end;
  -- Status is metadata, not a second worker claim. Do not acquire an old
  -- session lock after current source locks; the worker independently rechecks
  -- all originating authority before any bytes or renewal.
  if state='preparing' and not exists(select 1 from auth.sessions where id=j.session_id and user_id=j.account_id
   and (not_after is null or not_after>clock_timestamp())) then state:='failed'; end if;
 end if;
 deadline:=(c->>'authorityDeadline')::timestamptz;
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',j.id,'status',state);
end; $$;
create function public.own_preparation_status_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select private.own_preparation_status_v1(p_account_id,p_session_id,p_file_id); $$;
revoke all on function private.own_preparation_status_v1(uuid,uuid,uuid),public.own_preparation_status_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.own_preparation_status_v1(uuid,uuid,uuid),public.own_preparation_status_v1(uuid,uuid,uuid) to service_role;
