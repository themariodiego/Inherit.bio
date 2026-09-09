-- Disabled prepared-object backend: exact published-member authority.
-- Initial/final full reads still validate the entire membership and digest.
-- Per-object checks perform indexed exact membership, not an exhaustive scan.
-- This is current store/source authority only, never an analytical grant.
create function private.own_prepared_read_context_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,p_expected_manifest_id uuid)
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
 perform 1 from public.genome_storage_objects g join storage.objects o on o.id=g.object_id
 where g.genome_file_id=f.id and g.object_id=f.storage_object_id and g.bucket_id='genomes'
  and g.object_name=f.bucket_path and g.sha256=f.sha256 and g.byte_count=f.size_bytes
  and g.object_revision=f.upload_revision and g.state='current' and g.revoked_at is null
  and o.bucket_id=g.bucket_id and o.name=g.object_name and (o.metadata->>'size')::numeric=f.size_bytes for share of g,o;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 -- Auth session and exact current store consent are already held FOR SHARE.
 -- Capturing their clock deadline here preserves the final fence after any
 -- bounded member work; it never extends the originating or current authority.
 select least(s.not_after,c.expires_at) into deadline from auth.sessions s join public.subject_consents c
  on c.id=(a->>'uploadConsentId')::uuid where s.id=p_session_id and s.user_id=p_account_id;
 if not found or (deadline is not null and deadline<=clock_timestamp()) then
  raise exception using errcode='42501',message='not_found'; end if;
 return query select m,a,deadline;
end; $$;

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
  perform 1 from storage.objects o where o.id=member.storage_object_id and o.bucket_id='genomes'
   and o.name=member.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=member.byte_count for share;
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

create function private.check_own_prepared_member_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,
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
 perform 1 from storage.objects o where o.id=member.storage_object_id and o.bucket_id='genomes'
  and o.name=member.object_key and o.version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and jsonb_typeof(o.metadata->'size')='number' and (o.metadata->>'size')::numeric=member.byte_count for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if private.own_upload_store_authority_v1(p_account_id,p_session_id,(m.source->>'subjectId')::uuid) is distinct from a then
  raise exception using errcode='42501',message='not_found'; end if;
 result:=jsonb_build_object('version','own-prepared-member-v1','manifestId',m.id,'fileId',m.file_id,
  'membershipSha256',m.membership_sha256,'member',jsonb_build_object(
   'receipt',private.own_preparation_artifact_receipt_v1(member),'storageObjectId',member.storage_object_id));
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end; $$;

create function public.check_own_prepared_member_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid,
 p_expected_manifest_id uuid,p_artifact_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.check_own_prepared_member_v1(p_account_id,p_session_id,p_file_id,p_expected_manifest_id,p_artifact_id);
$$;
revoke all on function private.own_prepared_read_context_v1(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid),
 public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid),
 public.check_own_prepared_member_v1(uuid,uuid,uuid,uuid,uuid) to service_role;
