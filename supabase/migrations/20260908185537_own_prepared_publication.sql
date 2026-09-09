-- Disabled publication foundation. Metadata checks do not prove object bytes.
-- No checkpoint/resume, activation, cleanup executor or deletion-success claim.
alter table private.own_preparation_jobs drop constraint own_preparation_jobs_state_check;
alter table private.own_preparation_jobs add constraint own_preparation_jobs_state_check
 check(state in('queued','claimed','published','frozen'));
create table private.own_prepared_manifests (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null unique references private.own_preparation_jobs(id) on delete restrict,
 file_id uuid not null unique references public.genome_files(id) on delete restrict,
 attempt_id uuid not null,
 source jsonb not null check(jsonb_typeof(source)='object'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1048576),
 root_artifact_id uuid not null references private.own_preparation_artifacts(id) on delete restrict,
 member_count integer not null check(member_count between 1 and 4096),
 membership_sha256 text not null check(membership_sha256 ~ '^[0-9a-f]{64}$'),
 published_at timestamptz not null
);
create table private.own_prepared_manifest_members (
 manifest_id uuid not null references private.own_prepared_manifests(id) on delete restrict,
 artifact_id uuid not null unique references private.own_preparation_artifacts(id) on delete restrict,
 primary key(manifest_id,artifact_id)
);
alter table private.own_prepared_manifests enable row level security;
alter table private.own_prepared_manifest_members enable row level security;
revoke all on private.own_prepared_manifests,private.own_prepared_manifest_members
 from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_prepared_manifest_members',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_prepared_manifests',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='variant-rows';
create function private.guard_own_prepared_manifest_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; m private.own_prepared_manifests%rowtype;
 a private.own_preparation_artifacts%rowtype;
begin
 if tg_op='UPDATE' then raise exception using errcode='22023',message='prepared_manifest_immutable'; end if;
 if tg_table_name='own_prepared_manifests' then
  select * into j from private.own_preparation_jobs where id=new.job_id for update;
  if j.state is distinct from 'claimed' or new.file_id is distinct from j.file_id
   or new.attempt_id is distinct from j.attempt_id or new.source is distinct from j.source then
   raise exception using errcode='22023',message='prepared_manifest_immutable'; end if;
 else
  select * into m from private.own_prepared_manifests where id=new.manifest_id;
  select * into j from private.own_preparation_jobs where id=m.job_id for update;
  select * into a from private.own_preparation_artifacts where id=new.artifact_id;
  if j.state is distinct from 'claimed' or a.job_id is distinct from j.id or a.attempt_id is distinct from m.attempt_id
   or a.state is distinct from 'acknowledged' then
   raise exception using errcode='22023',message='prepared_manifest_immutable'; end if;
 end if;
 return new;
end; $$;
create trigger own_prepared_manifest_immutable before insert or update on private.own_prepared_manifests
 for each row execute function private.guard_own_prepared_manifest_v1();
create trigger own_prepared_member_immutable before insert or update on private.own_prepared_manifest_members
 for each row execute function private.guard_own_prepared_manifest_v1();
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
  if (to_jsonb(new)-array['state','storage_object_id','observed_sha256','acknowledged_at']) is distinct from
    (to_jsonb(old)-array['state','storage_object_id','observed_sha256','acknowledged_at'])
   or (old.state='acknowledged' and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 end if;
 return new;
end; $$;
create or replace function private.freeze_own_preparation_job_v1(p_job_id uuid)
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
 if j.state='published' then raise exception using errcode='55000',message='prepared_source_published'; end if;
 if j.state<>'frozen' then
  stamp:=clock_timestamp();
  update private.own_preparation_jobs set state='frozen',frozen_at=stamp,
   write_fence_at=greatest(stamp,(select max(write_expires_at) from private.own_preparation_artifacts where job_id=j.id))
   where id=j.id returning * into j;
 end if;
 return jsonb_build_object('version','own-preparation-freeze-v1','jobId',j.id,'state','frozen',
  'frozenAt',j.frozen_at,'writeFenceAt',j.write_fence_at,'cleanupDeadline',j.cleanup_deadline,'cleanupComplete',false);
end; $$;
create or replace function private.freeze_due_own_preparations_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare candidate record; j private.own_preparation_jobs%rowtype; c jsonb; eligible boolean; count_frozen integer:=0;
begin
 -- No scheduler is attached. Service-owned bounded scan also catches revoked
 -- sessions/store grants before job expiry; no caller-selected account/target.
 for candidate in select * from private.own_preparation_jobs where state in('queued','claimed') order by created_at,id limit 5 loop
  -- Hold the same parent/source/job locks across eligibility and freeze. An
  -- expired candidate cannot accidentally freeze a newly replaced live claim.
  perform 1 from auth.users where id=candidate.account_id for share;
  perform 1 from auth.sessions where id=candidate.session_id and user_id=candidate.account_id for share;
  perform 1 from public.profiles where id=candidate.account_id for update;
  perform 1 from public.subjects where id=candidate.subject_id for update;
  perform 1 from public.genome_files where id=candidate.file_id for update;
  select * into j from private.own_preparation_jobs where id=candidate.id for update skip locked;
  if j.id is null or j.state not in('queued','claimed') then continue; end if;
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
-- Source serialization prevents the legacy normalizer from stealing an object
-- backend source. Its real begin already owns this file lock; no new Auth locks.
create function private.guard_own_normalization_backend_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 perform 1 from public.genome_files where id=new.file_id for update;
 if exists(select 1 from private.own_preparation_jobs where file_id=new.file_id
   and state in('queued','claimed','published')) then
  raise exception using errcode='55000',message='prepared_backend_reserved'; end if;
 return new;
end; $$;
create trigger own_normalization_backend_reserved before insert or update on private.own_normalization_runs
 for each row execute function private.guard_own_normalization_backend_v1();

create function private.validate_own_prepared_publication_v1(p jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private as $$
declare s jsonb; k text; count_members integer;
begin
 if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>1048576
  or not(p ?& array['version','rootArtifactId','memberIds','summary'])
  or p-array['version','rootArtifactId','memberIds','summary']<>'{}'::jsonb
  or p->>'version' is distinct from 'own-prepared-publication-v1'
  or coalesce(p->>'rootArtifactId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p->'memberIds') is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_publication'; end if;
 count_members:=jsonb_array_length(p->'memberIds');
 if count_members not between 1 and 4096 or exists(select 1 from jsonb_array_elements(p->'memberIds') x
  where jsonb_typeof(x) is distinct from 'string' or (x#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (select count(distinct x) from jsonb_array_elements_text(p->'memberIds') x)<>count_members
  or not(p->'memberIds' @> jsonb_build_array(p->>'rootArtifactId')) then
  raise exception using errcode='22023',message='invalid_publication'; end if;
 s:=p->'summary';
 if jsonb_typeof(s) is distinct from 'object' or not(s ?& array['version','sourceBuild','parserRevision','canonicalRevision',
   'sourceVariantCount','sourceObservedCount','sourceReferenceCount','variantCount','observedCallCount','usableObservedCount','attempted','unmapped','rsidPointerCount'])
  or s-array['version','sourceBuild','parserRevision','canonicalRevision','sourceVariantCount','sourceObservedCount',
   'sourceReferenceCount','variantCount','observedCallCount','usableObservedCount','attempted','unmapped','rsidPointerCount']<>'{}'::jsonb
  or s->>'version' is distinct from 'own-prepared-summary-v1'
  or coalesce(s->>'sourceBuild','') not in('GRCh37','GRCh38')
  or jsonb_typeof(s->'parserRevision') is distinct from 'string' or length(s->>'parserRevision') not between 1 and 128
  or s->>'canonicalRevision' is distinct from 'prepared-canonical-v1' then
  raise exception using errcode='22023',message='invalid_publication'; end if;
 foreach k in array array['sourceVariantCount','sourceObservedCount','sourceReferenceCount','variantCount',
  'observedCallCount','usableObservedCount','attempted','unmapped','rsidPointerCount'] loop
  if jsonb_typeof(s->k) is distinct from 'number' or coalesce(s->>k,'')!~'^(0|[1-9][0-9]*)$'
   or (s->>k)::numeric>9007199254740991 then raise exception using errcode='22023',message='invalid_publication'; end if;
 end loop;
 if (s->>'sourceVariantCount')::numeric+(s->>'sourceObservedCount')::numeric+(s->>'sourceReferenceCount')::numeric>9007199254740991
  or (s->>'variantCount')::numeric>(s->>'sourceVariantCount')::numeric
  or (s->>'observedCallCount')::numeric>(s->>'sourceObservedCount')::numeric
  or (s->>'usableObservedCount')::numeric>(s->>'observedCallCount')::numeric
  or ((s->>'variantCount')::numeric=0 and (s->>'usableObservedCount')::numeric=0)
  or (s->>'unmapped')::numeric>(s->>'attempted')::numeric
  or (s->>'attempted')::numeric>(s->>'sourceVariantCount')::numeric+(s->>'sourceObservedCount')::numeric
  or (s->>'rsidPointerCount')::numeric>(s->>'sourceVariantCount')::numeric+(s->>'sourceObservedCount')::numeric
  or (s->>'sourceBuild'='GRCh38' and ((s->>'attempted')::numeric<>0 or (s->>'unmapped')::numeric<>0)) then
  raise exception using errcode='22023',message='invalid_publication'; end if;
end; $$;

-- Digest encoding: JSONB array, sorted by artifact UUID, of exact tuples
-- [artifactId,jobId,attemptId,sequence,objectKey,byteCount,sha256,storageObjectId].
-- JSONB text UTF8 SHA256; no timestamps or ambient query order participate.
create function private.own_prepared_membership_v1(p_manifest_id uuid) returns text
language sql security definer set search_path=pg_catalog,private as $$
 select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_array(a.id,a.job_id,a.attempt_id,
  a.sequence,a.object_key,a.byte_count,a.sha256,a.storage_object_id) order by a.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 from private.own_prepared_manifest_members m join private.own_preparation_artifacts a on a.id=m.artifact_id
 where m.manifest_id=p_manifest_id;
$$;
create function private.own_prepared_manifest_receipt_v1(m private.own_prepared_manifests) returns jsonb
language sql security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('version','own-prepared-source-v1','backend','prepared-object-v1','manifestId',m.id,
  'fileId',m.file_id,'subjectId',m.source->'subjectId','sourceRevision',m.source->'sourceRevision',
  'rawSha256',m.source->'rawSha256','decodedSha256',m.source->'decodedSha256','preparedAt',m.published_at,
  'root',jsonb_build_object('receipt',private.own_preparation_artifact_receipt_v1(a),'storageObjectId',a.storage_object_id),
  'summary',m.payload->'summary','memberCount',m.member_count,'membershipSha256',m.membership_sha256)
 from private.own_preparation_artifacts a where a.id=m.root_artifact_id;
$$;

-- Current-reader gate, deliberately independent of originating session/lease.
-- It grants store-backed reads only; analytical purpose gates remain callers'.
create function private.read_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected_manifest_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare m private.own_prepared_manifests%rowtype; j private.own_preparation_jobs%rowtype;
 f public.genome_files%rowtype; a jsonb; deadline timestamptz; member record; seen integer:=0; result jsonb;
begin
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null then raise exception using errcode='42501',message='not_found'; end if;
 a:=private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for share;
 select * into j from private.own_preparation_jobs where file_id=f.id for share;
 select * into m from private.own_prepared_manifests where file_id=f.id for share;
 if m.id is null or j.state is distinct from 'published' or m.job_id is distinct from j.id
  or j.account_id is distinct from p_account_id or m.attempt_id is distinct from j.attempt_id
  or (p_expected_manifest_id is not null and m.id is distinct from p_expected_manifest_id)
  or m.source is distinct from j.source or f.subject_id is distinct from j.subject_id
  or f.status not in('stored','annotated') or f.tier is distinct from 1
  or f.normalization_completed_at is distinct from m.published_at
  or f.normalization_source_revision is distinct from f.upload_revision
  or f.build is distinct from m.payload->'summary'->>'sourceBuild'
  or f.variant_count::bigint is distinct from (m.payload->'summary'->>'variantCount')::bigint
  or f.sha256 is distinct from m.source->>'rawSha256' or f.source_sha256 is distinct from m.source->>'decodedSha256'
  or f.upload_revision is distinct from (m.source->>'sourceRevision')::bigint
  or f.storage_object_id is distinct from (m.source->>'objectId')::uuid
  or f.bucket_path is distinct from m.source->>'objectKey' or f.size_bytes is distinct from (m.source->>'sizeBytes')::bigint
  or f.file_type::text is distinct from m.source->>'fileType'
  or f.single_logical_sample_verified_at is null or f.structural_validator_version is distinct from 'single-logical-sample-v1'
  or exists(select 1 from private.genome_file_deletions where file_id=f.id)
  or exists(select 1 from private.own_normalization_runs where file_id=f.id and state in('running','complete','rejecting','rejected'))
  or exists(select 1 from public.worker_jobs where file_id=f.id and status in('queued','running'))
  or not exists(select 1 from public.subjects where id=f.subject_id and subject_class='self' and lifecycle='active'
    and owner_account_id=p_account_id and subject_account_id=p_account_id)
  or a->'subjectBindingRevision' is distinct from j.authority->'subjectBindingRevision'
  or a->'accountBindingRevision' is distinct from j.authority->'accountBindingRevision'
  or a->'subjectLifecycleRevision' is distinct from j.authority->'subjectLifecycleRevision' then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
 where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
  and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
  and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
  and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes for share of g,o;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 for member in select t.*,x.manifest_id from private.own_prepared_manifest_members x
  join private.own_preparation_artifacts t on t.id=x.artifact_id where x.manifest_id=m.id order by t.id for share of x,t loop
  if member.job_id is distinct from j.id or member.attempt_id is distinct from m.attempt_id
   or member.state is distinct from 'acknowledged' or member.observed_sha256 is distinct from member.sha256 then
   raise exception using errcode='42501',message='not_found'; end if;
  perform 1 from storage.objects o where o.id=member.storage_object_id and o.bucket_id='genomes'
   and o.name=member.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=member.byte_count for share;
  if not found then raise exception using errcode='42501',message='not_found'; end if;
  seen:=seen+1;
 end loop;
 if seen<>m.member_count or not exists(select 1 from private.own_prepared_manifest_members
   where manifest_id=m.id and artifact_id=m.root_artifact_id)
  or private.own_prepared_membership_v1(m.id) is distinct from m.membership_sha256
  or private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id) is distinct from a then
  raise exception using errcode='42501',message='not_found'; end if;
 select least(s.not_after,c.expires_at) into deadline from auth.sessions s join public.subject_consents c
  on c.id=(a->>'uploadConsentId')::uuid where s.id=p_session_id and s.user_id=p_account_id;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 result:=private.own_prepared_manifest_receipt_v1(m);
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create function private.publish_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_job_id uuid,
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
  perform 1 from storage.objects o where o.id=member.storage_object_id and o.bucket_id='genomes'
   and o.name=member.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=member.byte_count for share;
  if not found then raise exception using errcode='42501',message='not_found'; end if;
 end loop;
 current_c:=private.own_preparation_source_v1(p_account_id,p_session_id,j.file_id);
 if current_c is distinct from c then raise exception using errcode='42501',message='not_found'; end if;
 deadline:=least(j.claim_expires_at,j.job_deadline,(c->>'authorityDeadline')::timestamptz);
 stamp:=clock_timestamp();
 if deadline is null or deadline<=stamp then raise exception using errcode='42501',message='not_found'; end if;
 -- Insert an immutable final membership atomically with the file and job state.
 -- Membership digest is computed before INSERT so immutability needs no bypass.
 select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_array(a.id,a.job_id,a.attempt_id,
  a.sequence,a.object_key,a.byte_count,a.sha256,a.storage_object_id) order by a.id)::text,'UTF8'),'sha256'),'hex') into membership
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

create function public.publish_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_job_id uuid,
 p_attempt_id uuid,p_claim_token_hash text,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select private.publish_own_prepared_manifest_v1(p_account_id,p_session_id,p_job_id,p_attempt_id,p_claim_token_hash,p_payload);
$$;
create function public.read_own_prepared_manifest_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected_manifest_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,p_expected_manifest_id);
$$;
revoke all on function private.guard_own_prepared_manifest_v1(),private.guard_own_normalization_backend_v1(),
 private.validate_own_prepared_publication_v1(jsonb),private.own_prepared_membership_v1(uuid),
 private.own_prepared_manifest_receipt_v1(private.own_prepared_manifests)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.read_own_prepared_manifest_v1(uuid,uuid,uuid,uuid),
 private.publish_own_prepared_manifest_v1(uuid,uuid,uuid,uuid,text,jsonb),
 public.read_own_prepared_manifest_v1(uuid,uuid,uuid,uuid),
 public.publish_own_prepared_manifest_v1(uuid,uuid,uuid,uuid,text,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.read_own_prepared_manifest_v1(uuid,uuid,uuid,uuid),
 private.publish_own_prepared_manifest_v1(uuid,uuid,uuid,uuid,text,jsonb),
 public.read_own_prepared_manifest_v1(uuid,uuid,uuid,uuid),
 public.publish_own_prepared_manifest_v1(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
