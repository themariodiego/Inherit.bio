-- Owner/self file deletion: immutable target, Storage ACK, then database purge.
-- No authenticated Storage or table-delete privileges are restored.
create table private.genome_file_deletions (
  file_id uuid primary key references public.genome_files(id) on delete cascade,
  account_id uuid not null,
  token uuid not null default gen_random_uuid(),
  bucket_id text not null check (bucket_id = 'genomes'),
  object_name text not null,
  started_at timestamptz not null default clock_timestamp()
);
alter table private.genome_file_deletions enable row level security;
revoke all on private.genome_file_deletions from public, anon, authenticated;

create function private.freeze_deleting_genome_file_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.genome_file_deletions where file_id=old.id) then
    raise exception using errcode='55000', message='file_deletion_pending';
  end if;
  return new;
end;
$$;
revoke all on function private.freeze_deleting_genome_file_v1() from public, anon, authenticated;
create trigger freeze_deleting_genome_file before update on public.genome_files
  for each row execute function private.freeze_deleting_genome_file_v1();

create function private.prevent_deleted_file_worker_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.file_id is not null then
    perform id from public.genome_files where id=new.file_id for update;
    if exists (select 1 from private.genome_file_deletions where file_id=new.file_id) then
      raise exception using errcode='55000', message='file_deletion_pending';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_deleted_file_worker_v1() from public, anon, authenticated;
create trigger prevent_deleted_file_worker before insert or update on public.worker_jobs
  for each row execute function private.prevent_deleted_file_worker_v1();

create function public.prepare_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.genome_files%rowtype;
  s public.subjects%rowtype;
  d private.genome_file_deletions%rowtype;
begin
  if not exists (select 1 from auth.sessions where id=p_session_id and user_id=p_account_id
    and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for update;
  if f.id is null then
    raise exception using errcode='P0002', message='file_delete_not_found';
  end if;
  select * into s from public.subjects where id=f.subject_id for update;
  if s.subject_class is distinct from 'self' or s.owner_account_id is distinct from p_account_id
    or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' or f.cohort_id is not null then
    raise exception using errcode='55000', message='file_delete_subject_unavailable';
  end if;
  -- These graph cases need their existing subject-level disposition, not a
  -- file shortcut that might remove another adult's shared working data.
  if exists (select 1 from public.family_pairs where subject_a_id=s.id or subject_b_id=s.id)
    or exists (select 1 from public.subject_relationships where subject_id=s.id
      and status='current' and recipient_account_id is distinct from p_account_id)
    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)
    or exists (select 1 from public.report_artifacts where subject_id=s.id)
    or exists (select 1 from public.embryo_variants where source_file_id=f.id) then
    raise exception using errcode='55000', message='file_delete_shared_graph';
  end if;
  if f.status in ('uploading','parsing','parsed') or exists (
    select 1 from public.worker_jobs where file_id=f.id and status in ('queued','running')
  ) then
    raise exception using errcode='55000', message='file_delete_processing';
  end if;
  if exists (select 1 from public.genome_files where id<>f.id and bucket_path=f.bucket_path)
    or (f.storage_object_id is null and f.bucket_path not like p_account_id::text||'/%')
    or (f.storage_object_id is not null and not exists (
      select 1 from public.genome_storage_objects where object_id=f.storage_object_id
      and genome_file_id=f.id and cohort_id is null and bucket_id='genomes' and object_name=f.bucket_path
    )) or exists (select 1 from public.genome_storage_objects where genome_file_id=f.id
      and (object_id is distinct from f.storage_object_id or bucket_id<>'genomes' or object_name<>f.bucket_path)) then
    raise exception using errcode='55000', message='file_delete_identity_mismatch';
  end if;
  select * into d from private.genome_file_deletions where file_id=f.id;
  if d.file_id is null then
    -- Persist the unreadable/retryable state before freezing subsequent updates.
    update public.genome_files set status='failed', error='File deletion is pending. Try Delete again.' where id=f.id;
    insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
      values(f.id,p_account_id,'genomes',f.bucket_path) returning * into d;
    update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())
      where genome_file_id=f.id;
  end if;
  return jsonb_build_object('token',d.token,'bucket',d.bucket_id,'name',d.object_name);
end;
$$;

create function public.finish_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid, p_token uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  -- Recheck authority, exact bindings and unsupported graph additions.
  perform public.prepare_genome_file_deletion_v1(p_account_id,p_session_id,p_file_id);
  select * into d from private.genome_file_deletions where file_id=p_file_id and account_id=p_account_id for update;
  if d.token is distinct from p_token then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  -- Route calls this only after Storage.remove acknowledged success. This
  -- independent metadata check also refuses a direct premature finish call.
  if exists (select 1 from storage.objects where bucket_id=d.bucket_id and name=d.object_name) then
    raise exception using errcode='55000', message='file_delete_storage_incomplete';
  end if;
  delete from public.download_sessions where object_id in (
    select object_id from public.genome_storage_objects where genome_file_id=p_file_id
  );
  delete from public.analysis_jobs where worker_job_id in (select id from public.worker_jobs where file_id=p_file_id);
  delete from public.worker_jobs where file_id=p_file_id;
  set constraints public.genome_files_storage_object_fk deferred;
  delete from public.genome_storage_objects where genome_file_id=p_file_id;
  delete from public.genome_files where id=p_file_id and user_id=p_account_id;
end;
$$;
revoke all on function public.prepare_genome_file_deletion_v1(uuid,uuid,uuid),
  public.finish_genome_file_deletion_v1(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_genome_file_deletion_v1(uuid,uuid,uuid),
  public.finish_genome_file_deletion_v1(uuid,uuid,uuid,uuid) to service_role;
