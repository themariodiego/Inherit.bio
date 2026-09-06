-- Only newly issued dedicated-role uploads enter this lifecycle. Existing
-- uploads and files are not backfilled or selected by this executor.
alter table public.upload_staging_objects drop constraint upload_staging_objects_upload_session_id_key;
alter table public.upload_staging_objects add column object_kind text not null default 'staging'
 check(object_kind in('staging','uncommitted-final'));
alter table public.upload_staging_objects add unique(upload_session_id,object_kind);

create function private.track_own_upload_retention_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare r uuid;
begin
 if new.token_jti is null or new.maximum_decoded_bytes is null then return new; end if;
 if tg_op='INSERT' then
  insert into public.upload_staging_objects(object_id,upload_session_id,object_name,state)
  values(gen_random_uuid(),new.id,new.staging_object_name,'issued');
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
  values('upload.staging-2h','upload_session',new.id,new.upload_revision,new.upload_revision,1,new.created_at+interval '2 hours') returning id into r;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
  values(r,'upload.staging-2h','upload-staging-expiry','purge',1,new.created_at+interval '2 hours','upload_session',new.id,
   new.upload_revision,1,'service-retention',1,jsonb_build_object('uploadId',new.id,'uploadRevision',new.upload_revision));
 else
  if new.final_object_name is not null and old.final_object_name is null then
   insert into public.upload_staging_objects(object_id,upload_session_id,object_name,object_kind,state)
   values(gen_random_uuid(),new.id,new.final_object_name::text,'uncommitted-final','issued');
  end if;
  if new.status='uploaded' then update public.upload_staging_objects set state='uploaded'
   where upload_session_id=new.id and object_kind='staging'; end if;
  if new.status='promoted' and old.status<>'promoted' then
   if new.finalized_file_id is null then raise exception using errcode='55000',message='upload_finalization_incomplete'; end if;
   select id into strict r from public.retention_rows where retention_id='upload.staging-2h'
    and target_kind='upload_session' and target_id=new.id and retention_revision=new.upload_revision for update;
   update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
    completed_at=clock_timestamp(),terminal_outcome_code='immutable_file_published'
   where retention_row_id=r and status='pending';
   if not found then raise exception using errcode='55000',message='upload_retention_claimed'; end if;
   update public.retention_rows set state='cancelled',ended_at=clock_timestamp() where id=r;
   delete from public.upload_staging_objects where upload_session_id=new.id;
  end if;
 end if;
 return new;
end;
$$;
revoke all on function private.track_own_upload_retention_v1() from public,anon,authenticated,inherit_upload_only;
create trigger track_own_upload_retention after insert or update on public.upload_sessions
 for each row execute function private.track_own_upload_retention_v1();

-- A delayed provider copy cannot recreate a cleaned object after the worker
-- deletes its session. The frozen purge manifest is a nonauthorizing tombstone.
create function private.guard_own_upload_final_copy_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare u public.upload_sessions%rowtype;
begin
 if new.bucket_id<>'genomes' then return new; end if;
 if exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
  where m.manifest_class='upload-working' and m.state in('executing','complete')
   and e.target_id='storage-objects' and e.store_name='storage.objects' and e.row_key->>'objectName'=new.name) then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 select * into u from public.upload_sessions where token_jti is not null and final_object_name::text=new.name;
 if u.id is null then return new; end if;
 if tg_op<>'INSERT' or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 perform private.own_upload_finalization_v1(u.account_id,u.auth_session_id,u.id,u.finalization_claim,false);
 return new;
end;
$$;
revoke all on function private.guard_own_upload_final_copy_v1() from public,anon,authenticated,inherit_upload_only;
create trigger guard_own_upload_final_copy before insert or update on storage.objects
 for each row execute function private.guard_own_upload_final_copy_v1();
create index purge_upload_object_address_idx on public.purge_manifest_entries((row_key->>'objectName'))
 where target_id='storage-objects' and store_name='storage.objects';

create function public.claim_own_upload_purge_v1(p_claim_token_hash text)
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
  and d.phase_deadline<=clock_timestamp() and s.token_jti is not null and s.maximum_decoded_bytes is not null
  and s.status in('issued','uploaded','validating','rejected') and s.finalized_file_id is null
  and (d.status in('pending','retry') or (d.status='claimed' and d.claim_expires_at<=clock_timestamp()))
 order by d.phase_deadline,s.id for update of s skip locked limit 1;
 if u.id is null then return null; end if;
 select * into strict p from public.retention_due_phases where target_id=u.id and target_kind='upload_session'
  and retention_id='upload.staging-2h' and phase_id='upload-staging-expiry' for update;
 if p.phase_deadline>clock_timestamp() or not(p.status in('pending','retry') or (p.status='claimed' and p.claim_expires_at<=clock_timestamp()))
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

create function private.assert_own_upload_purge_v1(p_manifest_id uuid,p_claim_token_hash text)
returns public.retention_due_phases language plpgsql security invoker set search_path=pg_catalog,private as $$
declare p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype; u public.upload_sessions%rowtype;
 v_fingerprint text;
begin
 select * into m from public.purge_manifests where id=p_manifest_id;
 select * into p from public.retention_due_phases where retention_row_id=m.retention_row_id and phase_id=m.phase_id and phase_revision=m.phase_revision;
 select * into u from public.upload_sessions where id=p.target_id for update;
 select * into p from public.retention_due_phases where retention_row_id=m.retention_row_id and phase_id=m.phase_id and phase_revision=m.phase_revision for update;
 if u.id is null or u.status<>'rejected' or u.finalized_file_id is not null or u.token_jti is null
  or p.retention_id<>'upload.staging-2h' or p.target_kind<>'upload_session' or p.target_lifecycle_revision<>u.upload_revision
  or m.manifest_class<>'upload-working' or m.state<>'executing' or p.status<>'claimed'
  or p_claim_token_hash is null or p.claim_token_hash is distinct from p_claim_token_hash or p.claim_expires_at<=clock_timestamp() then
  raise exception using errcode='55000',message='upload_purge_claim_stale'; end if;
 select encode(extensions.digest(string_agg(object_name,',' order by object_kind),'sha256'),'hex') into v_fingerprint
 from public.upload_staging_objects where upload_session_id=u.id;
 if v_fingerprint is distinct from m.source_binding_fingerprint
  or exists(select 1 from public.upload_chunks where upload_session_id=u.id)
  or exists(select 1 from public.genome_files where bucket_path in(u.staging_object_name,u.final_object_name::text))
  or (select count(*) from public.purge_manifest_entries where manifest_id=m.id)<>(select count(*) from public.upload_staging_objects where upload_session_id=u.id)
  or exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and
   (e.target_id<>'storage-objects' or e.store_name<>'storage.objects' or e.row_key->>'bucketId' is distinct from 'genomes'
    or not exists(select 1 from public.upload_staging_objects s where s.upload_session_id=u.id and s.object_name=e.row_key->>'objectName'))) then
  raise exception using errcode='55000',message='upload_purge_binding_invalid'; end if;
 return p;
end;
$$;
create function public.authorize_own_upload_purge_v1(p_manifest_id uuid,p_claim_token_hash text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,private as $$
begin perform private.assert_own_upload_purge_v1(p_manifest_id,p_claim_token_hash); return true; end;
$$;
create function public.finish_own_upload_purge_v1(p_manifest_id uuid,p_claim_token_hash text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,private as $$
declare p public.retention_due_phases%rowtype;
begin
 p:=private.assert_own_upload_purge_v1(p_manifest_id,p_claim_token_hash);
 if exists(select 1 from public.purge_manifest_entries e join storage.objects o
  on o.id=(e.row_key->>'objectId')::uuid or (o.bucket_id='genomes' and o.name=e.row_key->>'objectName') where e.manifest_id=p_manifest_id) then
  raise exception using errcode='55000',message='upload_purge_storage_remaining'; end if;
 delete from public.upload_staging_objects where upload_session_id=p.target_id;
 delete from public.upload_sessions where id=p.target_id;
 if exists(select 1 from public.upload_sessions where id=p.target_id)
  or exists(select 1 from public.upload_staging_objects where upload_session_id=p.target_id) then
  raise exception using errcode='55000',message='upload_purge_rows_remaining'; end if;
 update public.purge_manifest_entries set status='deleted' where manifest_id=p_manifest_id;
 update public.purge_manifests set state='complete' where id=p_manifest_id;
 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='upload_working_purged',completed_at=clock_timestamp()
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=p.retention_row_id;
 return true;
end;
$$;
create function public.fail_own_upload_purge_v1(p_manifest_id uuid,p_claim_token_hash text)
returns void language plpgsql security invoker set search_path=pg_catalog,private as $$
declare p public.retention_due_phases%rowtype;
begin
 p:=private.assert_own_upload_purge_v1(p_manifest_id,p_claim_token_hash);
 update public.retention_due_phases set status='retry',claim_token_hash=null,claim_expires_at=null
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
end;
$$;
revoke all on function private.assert_own_upload_purge_v1(uuid,text),public.claim_own_upload_purge_v1(text),
 public.authorize_own_upload_purge_v1(uuid,text),public.finish_own_upload_purge_v1(uuid,text),public.fail_own_upload_purge_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.assert_own_upload_purge_v1(uuid,text),public.claim_own_upload_purge_v1(text),
 public.authorize_own_upload_purge_v1(uuid,text),public.finish_own_upload_purge_v1(uuid,text),public.fail_own_upload_purge_v1(uuid,text) to service_role;
