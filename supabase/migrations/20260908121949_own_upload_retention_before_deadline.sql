-- Start abandoned-upload cleanup after its existing upload/finalization
-- authority expires (normally <=30 minutes), leaving operational headroom
-- before the immutable created_at+2h maximum. No deadline, expiry, live lease,
-- retry eligibility, source binding or Storage acknowledgement is changed.
-- Publication/finalization locks the same upload row and refuses expires_at;
-- SKIP LOCKED defers an in-flight transaction. Promoted files remain excluded.
create or replace function public.claim_own_upload_purge_v1(p_claim_token_hash text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private as $$
declare u public.upload_sessions%rowtype; p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 v_objects jsonb; v_binding text;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_retention_claim'; end if;
 -- Lock upload before retention, matching the publication trigger. Never hold
 -- a phase lock while waiting for an active finalizer's upload-row lock.
 select s.* into u from public.upload_sessions s join public.retention_due_phases d on d.target_id=s.id
 where d.retention_id='upload.staging-2h' and d.phase_id='upload-staging-expiry' and d.target_kind='upload_session'
  and s.expires_at<=clock_timestamp() and s.token_jti is not null and s.maximum_decoded_bytes is not null
  and s.status in('issued','uploaded','validating','rejected') and s.finalized_file_id is null
  and (d.status in('pending','retry') or (d.status='claimed' and d.claim_expires_at<=clock_timestamp()))
 order by d.phase_deadline,s.id for update of s skip locked limit 1;
 if u.id is null then return null; end if;
 select * into strict p from public.retention_due_phases where target_id=u.id and target_kind='upload_session'
  and retention_id='upload.staging-2h' and phase_id='upload-staging-expiry' for update;
 if u.expires_at>clock_timestamp() or not(p.status in('pending','retry') or (p.status='claimed' and p.claim_expires_at<=clock_timestamp()))
  or p.target_lifecycle_revision<>u.upload_revision or p.immutable_envelope is distinct from
   jsonb_build_object('uploadId',u.id,'uploadRevision',u.upload_revision) then
  raise exception using errcode='55000',message='upload_purge_binding_invalid'; end if;
 if exists(select 1 from public.upload_chunks where upload_session_id=u.id)
  or exists(select 1 from public.genome_files where bucket_path in(u.staging_object_name,u.final_object_name::text))
  or not exists(select 1 from public.upload_staging_objects where upload_session_id=u.id and object_kind='staging' and object_name=u.staging_object_name)
  or exists(select 1 from public.upload_staging_objects where upload_session_id=u.id and
   object_name is distinct from case object_kind when 'staging' then u.staging_object_name else u.final_object_name::text end) then
  raise exception using errcode='55000',message='upload_purge_binding_invalid'; end if;
 update public.upload_sessions set status='rejected',finalization_cleanup_pending=true,
  consumed_at=coalesce(consumed_at,clock_timestamp()) where id=u.id;
 select * into m from public.purge_manifests where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision for update;
 if m.id is null then
  select encode(extensions.digest(string_agg(object_name,',' order by object_kind),'sha256'),'hex') into v_binding
   from public.upload_staging_objects where upload_session_id=u.id;
  insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint,state)
  values(p.retention_row_id,p.phase_id,p.phase_revision,'upload-working',1,v_binding,'executing') returning * into m;
  insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
  select m.id,'storage-objects','storage.objects',jsonb_build_object('objectId',coalesce(o.id,s.object_id),
   'bucketId','genomes','objectName',s.object_name),row_number() over(order by s.object_kind)
  from public.upload_staging_objects s left join storage.objects o on o.bucket_id='genomes' and o.name=s.object_name
  where s.upload_session_id=u.id;
 end if;
 if m.manifest_class<>'upload-working' or m.state not in('frozen','executing') then
  raise exception using errcode='55000',message='upload_purge_binding_invalid'; end if;
 update public.retention_rows set state='active' where id=p.retention_row_id;
 update public.retention_due_phases set status='claimed',claim_token_hash=p_claim_token_hash,
  claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=least(attempts+1,20)
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.purge_manifests set state='executing' where id=m.id;
 select coalesce(jsonb_agg(row_key||jsonb_build_object('ordinal',entry_revision) order by entry_revision),'[]'::jsonb)
 into v_objects from public.purge_manifest_entries where manifest_id=m.id;
 return jsonb_build_object('manifestId',m.id,'objects',v_objects);
end;
$$;

revoke all on function public.claim_own_upload_purge_v1(text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.claim_own_upload_purge_v1(text) to service_role;
