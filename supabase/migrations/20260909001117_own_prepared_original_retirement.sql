-- Opt-in for NEW prepared publications only. Existing real sources are not
-- backfilled and ordinary DB-backed sources keep their live-original contract.
create table private.own_original_retention_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false, applies_after timestamptz not null default clock_timestamp());
insert into private.own_original_retention_config(singleton) values(true);
create table private.own_original_retirements (
 file_id uuid primary key references public.genome_files(id) on delete cascade,
 manifest_id uuid not null, account_id uuid not null,
 source jsonb not null check(jsonb_typeof(source)='object' and octet_length(source::text)<=4096),
 object_id uuid not null, object_key uuid not null, storage_version uuid not null,
 byte_count bigint not null check(byte_count>0), sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 created_at timestamptz not null, expires_at timestamptz not null,
 state text not null default 'scheduled' check(state in('scheduled','claimed','retired')),
 claim_hash text check(claim_hash~'^[0-9a-f]{64}$'), claim_expires_at timestamptz,
 delete_started_at timestamptz, provider_ack jsonb, retired_at timestamptz,
 check(expires_at=created_at+interval '1 month'),
 check((state='retired')=(retired_at is not null)),
 check((provider_ack is null)=(retired_at is null))
);
alter table private.own_original_retention_config enable row level security;
alter table private.own_original_retirements enable row level security;
revoke all on private.own_original_retention_config,private.own_original_retirements from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'variant-rows','private.own_original_retirements',coalesce(max(store_order),0)+1 from public.purge_target_stores where target_id='variant-rows';
create function private.guard_own_original_retirement_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if (to_jsonb(new)-array['state','claim_hash','claim_expires_at','delete_started_at','provider_ack','retired_at']) is distinct from
 (to_jsonb(old)-array['state','claim_hash','claim_expires_at','delete_started_at','provider_ack','retired_at'])
 or (old.state='retired' and to_jsonb(new) is distinct from to_jsonb(old))
 or (old.delete_started_at is not null and new.delete_started_at is distinct from old.delete_started_at) then
 raise exception using errcode='22023',message='original_retirement_immutable';end if;
 return new;
end; $$;
create trigger own_original_retirement_immutable before update on private.own_original_retirements
 for each row execute function private.guard_own_original_retirement_v1();
create function private.track_own_original_retirement_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; object_version text;
begin
 if not exists(select 1 from private.own_original_retention_config where singleton and enabled) then return new;end if;
 select * into strict f from public.genome_files where id=new.file_id;
 if f.created_at<(select applies_after from private.own_original_retention_config where singleton) then return new;end if;
 select version into object_version from storage.objects where id=f.storage_object_id and bucket_id='genomes'
 and name=f.bucket_path and (metadata->>'size')::numeric=f.size_bytes for share;
 if object_version is null or object_version!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or f.created_at+interval '1 month'<=clock_timestamp() then raise exception using errcode='55000',message='original_retention_unavailable';end if;
 insert into private.own_original_retirements(file_id,manifest_id,account_id,source,object_id,object_key,storage_version,byte_count,sha256,created_at,expires_at)
 values(f.id,new.id,f.user_id,new.source,f.storage_object_id,f.bucket_path::uuid,object_version::uuid,f.size_bytes,f.sha256,f.created_at,f.created_at+interval '1 month');
 return new;
end; $$;
create trigger track_own_original_retirement after insert on private.own_prepared_manifests
 for each row execute function private.track_own_original_retirement_v1();
-- Prevent an old original key from reappearing after deletion started. This is
-- metadata admission fencing, not evidence that a provider deleted any payload.
create function private.guard_retiring_original_storage_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.bucket_id='genomes' and exists(select 1 from private.own_original_retirements where object_key::text=new.name and delete_started_at is not null) then
 raise exception using errcode='42501',message='original_retired';end if;return new;
end; $$;
create trigger guard_retiring_original_storage before insert or update on storage.objects
 for each row execute function private.guard_retiring_original_storage_v1();

-- Exact immutable identity resolver. Only the already-verified prepared branch
-- may admit a retired original; an absent legacy/orphan original never qualifies.
create function private.own_prepared_original_identity_v1(p_file_id uuid,p_manifest_id uuid,p_lock boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; m private.own_prepared_manifests%rowtype; r private.own_original_retirements%rowtype;
begin
 if p_manifest_id is null or p_lock is null then return false;end if;
 select * into f from public.genome_files where id=p_file_id;
 select * into m from private.own_prepared_manifests where id=p_manifest_id and file_id=f.id;
 if m.id is null then return false;end if;
 if p_lock then
 perform 1 from public.genome_storage_objects g where g.genome_file_id=f.id and g.object_id=f.storage_object_id
 and g.bucket_id='genomes' and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
 and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null for share;
 else
 perform 1 from public.genome_storage_objects g where g.genome_file_id=f.id and g.object_id=f.storage_object_id
 and g.bucket_id='genomes' and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
 and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null;
 end if;
 if not found then return false;end if;
 if p_lock then select * into r from private.own_original_retirements where file_id=f.id for share;
 else select * into r from private.own_original_retirements where file_id=f.id;end if;
 if r.file_id is not null and (r.manifest_id is distinct from m.id or r.source is distinct from m.source
 or r.account_id is distinct from f.user_id or r.object_id is distinct from f.storage_object_id or r.object_key::text is distinct from f.bucket_path
 or r.sha256 is distinct from f.sha256 or r.byte_count is distinct from f.size_bytes) then return false;end if;
 if r.state='retired' then
 return r.provider_ack is not null and r.retired_at>=r.expires_at and not exists(select 1 from storage.objects where id=r.object_id or (bucket_id='genomes' and name=r.object_key::text));
 end if;
 if p_lock then
 perform 1 from storage.objects o where o.id=f.storage_object_id and o.bucket_id='genomes' and o.name=f.bucket_path
 and (o.metadata->>'size')::numeric=f.size_bytes and (r.file_id is null or o.version=r.storage_version::text) for share;
 else
 perform 1 from storage.objects o where o.id=f.storage_object_id and o.bucket_id='genomes' and o.name=f.bucket_path
 and (o.metadata->>'size')::numeric=f.size_bytes and (r.file_id is null or o.version=r.storage_version::text);
 end if; return found;
end; $$;

create function private.own_original_retirement_receipt_v1(r private.own_original_retirements) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('version','own-original-retirement-v1','fileId',r.file_id,'manifestId',r.manifest_id,
 'objectId',r.object_id,'bucket','genomes','objectKey',r.object_key,'storageVersion',r.storage_version,
 'byteCount',r.byte_count,'sha256',r.sha256,'expiresAt',r.expires_at,'claimExpiresAt',r.claim_expires_at);
$$;
create function private.lock_own_original_retirement_v1(p_file_id uuid) returns private.own_original_retirements
language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_original_retirements%rowtype;
begin
 select * into r from private.own_original_retirements where file_id=p_file_id;
 if r.file_id is null then raise exception using errcode='42501',message='not_found';end if;
 perform 1 from auth.users where id=r.account_id for share;
 perform 1 from auth.sessions where user_id=r.account_id order by id for share;
 perform 1 from public.profiles where id=r.account_id for update;
 perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=r.file_id) for update;
 perform 1 from public.genome_files where id=r.file_id for update;
 perform 1 from private.own_preparation_jobs where file_id=r.file_id for update;
 perform 1 from private.own_prepared_manifests where id=r.manifest_id for share;
 select * into r from private.own_original_retirements where file_id=p_file_id for update;
 return r;
end; $$;
create function public.claim_own_original_retirement_v1(p_claim_token_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare candidate record; r private.own_original_retirements%rowtype;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid_request';end if;
 if not exists(select 1 from private.own_original_retention_config where singleton and enabled) then return null;end if;
 for candidate in select file_id from private.own_original_retirements where state<>'retired' and expires_at<=clock_timestamp()
 and (claim_expires_at is null or claim_expires_at<=clock_timestamp()) order by expires_at,file_id limit 5 loop
 r:=private.lock_own_original_retirement_v1(candidate.file_id);
 if r.state='retired' or r.expires_at>clock_timestamp() or r.claim_expires_at>clock_timestamp() then continue;end if;
 -- No live original means no new provider-version proof is possible. Preserve
 -- the unresolved record; never turn a lost DELETE response into inferred ACK.
 if not private.own_prepared_original_identity_v1(r.file_id,r.manifest_id,true)
 or exists(select 1 from private.genome_file_deletions where file_id=r.file_id)
 or not exists(select 1 from private.own_preparation_jobs where file_id=r.file_id and state='published') then continue;end if;
 update private.own_original_retirements set state='claimed',claim_hash=p_claim_token_hash,
 claim_expires_at=clock_timestamp()+interval '30 seconds',delete_started_at=coalesce(delete_started_at,clock_timestamp())
 where file_id=r.file_id returning * into r;
 return private.own_original_retirement_receipt_v1(r);
 end loop;return null;
end; $$;
create function public.check_own_original_retirement_v1(p_file_id uuid,p_claim_token_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_original_retirements%rowtype;
begin
 r:=private.lock_own_original_retirement_v1(p_file_id);
 if r.state<>'claimed' or r.claim_hash is distinct from p_claim_token_hash or r.claim_expires_at<=clock_timestamp()
 or not private.own_prepared_original_identity_v1(r.file_id,r.manifest_id,true)
 or exists(select 1 from private.genome_file_deletions where file_id=r.file_id) then raise exception using errcode='42501',message='not_found';end if;
 if r.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 return private.own_original_retirement_receipt_v1(r);
end; $$;
create function public.finish_own_original_retirement_v1(p_file_id uuid,p_claim_token_hash text,p_expected jsonb,p_evidence jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_original_retirements%rowtype; expected_evidence jsonb;
begin
 r:=private.lock_own_original_retirement_v1(p_file_id);
 if r.state='retired' and r.claim_hash=p_claim_token_hash and r.provider_ack=p_evidence
 and private.own_original_retirement_receipt_v1(r) is not distinct from p_expected then return true;end if;
 if r.state<>'claimed' or r.claim_hash is distinct from p_claim_token_hash or r.claim_expires_at<=clock_timestamp()
 or private.own_original_retirement_receipt_v1(r) is distinct from p_expected
 or exists(select 1 from private.genome_file_deletions where file_id=r.file_id)
 or not exists(select 1 from private.own_prepared_manifests where id=r.manifest_id and file_id=r.file_id and source=r.source)
 or not exists(select 1 from public.genome_storage_objects where object_id=r.object_id and genome_file_id=r.file_id
 and object_name=r.object_key::text and bucket_id='genomes' and sha256=r.sha256 and byte_count=r.byte_count and state='current' and revoked_at is null)
 or exists(select 1 from storage.objects where id=r.object_id or (bucket_id='genomes' and name=r.object_key::text)) then raise exception using errcode='42501',message='not_found';end if;
 expected_evidence:=jsonb_build_object('version','own-original-delete-evidence-v1','provider','supabase','disposition','original-payload-deleted',
 'objectId',r.object_id,'objectKey',r.object_key,'storageVersion',r.storage_version,'byteCount',r.byte_count,'sha256',r.sha256);
 if p_evidence is distinct from expected_evidence then raise exception using errcode='22023',message='invalid_original_delete_evidence';end if;
 update private.own_original_retirements set state='retired',retired_at=clock_timestamp(),provider_ack=p_evidence where file_id=r.file_id;
 if r.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 return true;
end; $$;
-- Owner-scoped download state. The existing route applies ownership before this
-- service read; no object URL, new grant or signed token is emitted by SQL.
create function public.own_original_download_state_v1(p_account_id uuid,p_file_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.own_original_retirements%rowtype;
begin
 if not exists(select 1 from public.genome_files where id=p_file_id and user_id=p_account_id) then raise exception using errcode='42501',message='not_found';end if;
 select * into r from private.own_original_retirements where file_id=p_file_id;
 return jsonb_build_object('version','own-original-download-state-v1','fileId',p_file_id,
 'prepared',exists(select 1 from private.own_prepared_manifests where file_id=p_file_id),
 'retired',exists(select 1 from private.genome_file_deletions where file_id=p_file_id) or (r.file_id is not null and (r.state='retired' or r.delete_started_at is not null or r.expires_at<=clock_timestamp())),'expiresAt',r.expires_at);
end; $$;

create or replace function private.own_prepared_read_context_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected_manifest_id uuid)
returns table(context_manifest private.own_prepared_manifests,context_authority jsonb,context_deadline timestamptz)
language plpgsql security definer set search_path=pg_catalog,private as $$
declare m private.own_prepared_manifests%rowtype; j private.own_preparation_jobs%rowtype;
 f public.genome_files%rowtype; a jsonb; deadline timestamptz;
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
 if not private.own_prepared_original_identity_v1(f.id,m.id,true) then raise exception using errcode='42501',message='not_found';end if;
 -- Auth session and exact current store consent are already held FOR SHARE.
 -- Capturing their clock deadline here preserves the final fence after any
 -- bounded member work; it never extends the originating or current authority.
 select least(s.not_after,c.expires_at) into deadline from auth.sessions s join public.subject_consents c
  on c.id=(a->>'uploadConsentId')::uuid where s.id=p_session_id and s.user_id=p_account_id;
 if not found or (deadline is not null and deadline<=clock_timestamp()) then
  raise exception using errcode='42501',message='not_found'; end if;
 return query select m,a,deadline;
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
 if m.id is not null then
  if not private.own_prepared_original_identity_v1(f.id,m.id,p_lock) then raise exception using errcode='42501',message='not_found';end if;
 else
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
 end if;
 return jsonb_build_object('fileType',f.file_type,'verifiedFileType',case when m.id is not null then m.source->'fileType' else n.manifest->'fileType' end)
  ||case when m.id is null then '{}'::jsonb else jsonb_build_object('preparedSource',jsonb_build_object(
   'version','own-prepared-report-source-v1','backend','prepared-object-v1','manifestId',m.id,
   'membershipSha256',m.membership_sha256,'rootArtifactId',root.id,'rootSha256',root.sha256)) end;
end; $$;

create or replace function private.own_export_source_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; s public.subjects%rowtype; p public.profiles%rowtype;
 b public.subject_account_bindings%rowtype; sp public.subject_principals%rowtype;
 ap public.subject_principals%rowtype; session_revision bigint; normalized boolean;
 published jsonb; manifest_id uuid; result jsonb;
begin
 -- Serialize backend selection against enqueue/publication/deletion in the
 -- same Auth -> session -> profile -> subject -> file order as preparation.
 -- Existing own-right eligibility below (including pending deletion) is kept.
 perform 1 from auth.users where id=p_account_id for share;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share;
 perform 1 from public.profiles where id=p_account_id for update;
 select * into f from public.genome_files where id=p_file_id;
 perform 1 from public.subjects where id=f.subject_id for share;
 perform 1 from public.genome_files where id=p_file_id for share;
 -- Decide the backend before reading snapshot fields. The full published read
 -- obtains the existing Auth/session/profile/subject/file/job/member locks.
 -- A frozen unmanifested attempt remains eligible for genuine DB recovery.
 if p_file_id is not null and (exists(select 1 from private.own_prepared_manifests where file_id=p_file_id)
  or exists(select 1 from private.own_preparation_jobs where file_id=p_file_id and state<>'frozen')) then
  select id into manifest_id from private.own_prepared_manifests where file_id=p_file_id;
  if manifest_id is null then raise exception using errcode='55000',message='prepared_source_not_ready'; end if;
  published:=private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,manifest_id);
 end if;
 perform 1 from auth.users where id=p_account_id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(refresh_token_counter,0)+1 into session_revision from auth.sessions
  where id=p_session_id and user_id=p_account_id and (not_after is null or not_after>clock_timestamp());
 select * into p from public.profiles where id=p_account_id;
 -- A pending account-deletion notice does not remove the subject's data right.
 if session_revision is null or p.id is null or exists(select 1 from public.account_deletion_requests d
  where d.account_id=p_account_id and (d.state in ('delete_started','complete') or d.delete_started_at is not null
   or d.storage_manifest_frozen_at is not null or d.storage_completed_at is not null or d.database_purged_at is not null)) then raise exception using errcode='42501',message='not_found'; end if;
 select * into f from public.genome_files where id=p_file_id;
 select * into s from public.subjects where id=f.subject_id;
 if s.id is null or s.subject_account_id is distinct from p_account_id
  or s.subject_class not in ('self','other_adult') or s.lifecycle not in ('active','restricted')
  or f.tier is distinct from 1 or f.status='uploading'
  or f.single_logical_sample_verified_at is null or f.source_sha256 is null
  or f.structural_validator_version is distinct from 'single-logical-sample-v1' then return null; end if;
 select * into b from public.subject_account_bindings where subject_id=s.id and account_id=p_account_id and status='current';
 select * into sp from public.subject_principals where id=b.subject_principal_id and subject_id=s.id
  and account_id=p_account_id and principal_kind='account_subject' and status='active';
 select * into ap from public.subject_principals where id=b.account_principal_id
  and account_id=p_account_id and principal_kind='account_subject' and status='active';
 if b.id is null or sp.id is null or ap.id is null then return null; end if;
 if published is not null then
  if not private.own_prepared_original_identity_v1(f.id,manifest_id,true) then return null;end if;
 else
 perform 1 from public.genome_storage_objects o join storage.objects obj on obj.id=o.object_id
  where o.genome_file_id=f.id and o.object_id=f.storage_object_id and o.object_name=f.bucket_path
   and o.bucket_id='genomes' and o.sha256=f.sha256 and o.byte_count=f.size_bytes
   and o.object_revision=f.upload_revision and o.state='current' and o.revoked_at is null
   and obj.bucket_id=o.bucket_id and obj.name=o.object_name and (obj.metadata->>'size')::numeric=f.size_bytes;
 if not found then return null; end if;
 end if;
 if published is not null then normalized:=true;
 else
 select exists(select 1 from private.own_normalization_runs n where n.file_id=f.id and n.account_id=f.user_id
  and n.state='complete' and f.normalization_completed_at is not null and f.normalization_source_revision=f.upload_revision
  and n.manifest->>'rawSha256'=f.sha256 and n.manifest->>'decodedSha256'=f.source_sha256
  and n.manifest->'sourceRevision'=to_jsonb(f.upload_revision)
  and n.manifest->>'objectId'=f.storage_object_id::text and n.manifest->>'objectKey'=f.bucket_path) into normalized;
 end if;
 result:=jsonb_build_object('file',jsonb_build_object('id',f.id,'subject_id',s.id,'original_name',f.original_name,
  'file_type',f.file_type,'tier',f.tier,'size_bytes',f.size_bytes,'sha256',f.sha256,'source_sha256',f.source_sha256,
  'status',f.status,'build',f.build,'created_at',f.created_at,'variant_count',case when normalized then f.variant_count else null end,
  'bucket_path',f.bucket_path,'storage_object_id',f.storage_object_id,'upload_revision',f.upload_revision),
  'binding',jsonb_build_object('accountId',p_account_id,'sessionId',p_session_id,
   'accountRevision',p.account_revision,'authSessionRevision',p.auth_session_revision,'sessionRevision',session_revision,
   'subjectBindingRevision',s.subject_binding_revision,'lifecycleRevision',s.lifecycle_revision,
   'accountBindingId',b.id,'accountBindingRevision',b.binding_revision,
   'subjectPrincipalId',sp.id,'subjectPrincipalRevision',sp.principal_revision,
   'accountPrincipalId',ap.id,'accountPrincipalRevision',ap.principal_revision,
   'normalizedAt',case when normalized then f.normalization_completed_at else null end), 'normalized',normalized);
 if published is not null then
  result:=result||jsonb_build_object('preparedSource',jsonb_build_object(
   'version','own-prepared-report-source-v1','backend','prepared-object-v1','manifestId',published->'manifestId',
   'membershipSha256',published->'membershipSha256','rootArtifactId',published#>'{root,receipt,artifactId}',
   'rootSha256',published#>'{root,receipt,sha256}'));
  -- Final full membership and source clock fence after JSON construction.
  if private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,manifest_id) is distinct from published then
   raise exception using errcode='42501',message='not_found'; end if;
 end if;
 return result;
end; $$;
revoke all on function private.guard_own_original_retirement_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.track_own_original_retirement_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.guard_retiring_original_storage_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.own_prepared_original_identity_v1(uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.own_original_retirement_receipt_v1(private.own_original_retirements) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.lock_own_original_retirement_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function public.claim_own_original_retirement_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.claim_own_original_retirement_v1(text) to service_role;
revoke all on function public.check_own_original_retirement_v1(uuid,text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.check_own_original_retirement_v1(uuid,text) to service_role;
revoke all on function public.finish_own_original_retirement_v1(uuid,text,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.finish_own_original_retirement_v1(uuid,text,jsonb,jsonb) to service_role;
revoke all on function public.own_original_download_state_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.own_original_download_state_v1(uuid,uuid) to service_role;

-- Finite current-session original streaming authority. Full prepared membership
-- is validated at entry; every chunk rechecks exact source/store/session clocks.
create function public.authorize_own_prepared_original_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c record; m private.own_prepared_manifests%rowtype; f public.genome_files%rowtype; r private.own_original_retirements%rowtype;
 original_version text; expiry timestamptz; expected_expiry timestamptz; source jsonb; a jsonb;
begin
 if p_expected is not null and (jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>2048) then
 raise exception using errcode='22023',message='invalid_request';end if;
 select * into c from private.own_prepared_read_context_v1(p_account_id,p_session_id,p_file_id,null);
 m:=c.context_manifest; a:=c.context_authority;
 if p_expected is null then perform private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,m.id);end if;
 select * into f from public.genome_files where id=p_file_id for share;
 select * into r from private.own_original_retirements where file_id=f.id for share;
 if r.file_id is not null and (r.state='retired' or r.delete_started_at is not null or r.expires_at<=clock_timestamp()) then
 raise exception using errcode='55000',message='original_retired';end if;
 select version into original_version from storage.objects where id=f.storage_object_id and bucket_id='genomes'
 and name=f.bucket_path and (metadata->>'size')::numeric=f.size_bytes for share;
 if original_version is null or original_version!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
 raise exception using errcode='42501',message='not_found';end if;
 expiry:=least(clock_timestamp()+interval '270 seconds',c.context_deadline,r.expires_at);
 if p_expected is not null then
 begin expected_expiry:=(p_expected->>'expiresAt')::timestamptz;
 exception when others then raise exception using errcode='22023',message='invalid_request';end;
 if expected_expiry is null or expected_expiry>expiry then raise exception using errcode='42501',message='not_found';end if;
 expiry:=expected_expiry;
 end if;
 source:=jsonb_build_object('version','prepared-original-download-v1','fileId',f.id,'manifestId',m.id,
 'sourceRevision',f.upload_revision,'rawSha256',f.sha256,'bucket','genomes','objectId',f.storage_object_id,
 'objectKey',f.bucket_path,'storageVersion',original_version,'sizeBytes',f.size_bytes,'expiresAt',expiry);
 if p_expected is not null and source is distinct from p_expected then raise exception using errcode='42501',message='not_found';end if;
 if private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id) is distinct from a
 or expiry<=clock_timestamp() then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('source',source,'originalName',f.original_name);
end; $$;
revoke all on function public.authorize_own_prepared_original_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.authorize_own_prepared_original_v1(uuid,uuid,uuid,jsonb) to service_role;
