-- Atomically bind a verified staging object to a subject-owned genome file.

create or replace function public.complete_upload_session(
  p_upload_session_id uuid,
  p_account_id uuid,
  p_auth_session_id uuid,
  p_storage_object_id uuid,
  p_original_name text,
  p_file_type text,
  p_tier smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.upload_sessions%rowtype;
  v_file_id uuid;
  v_expected_tier smallint;
begin
  select * into v_session
  from public.upload_sessions
  where id = p_upload_session_id
  for update;

  if v_session.id is null
    or v_session.account_id <> p_account_id
    or v_session.auth_session_id <> p_auth_session_id
    or v_session.status <> 'issued'
    or v_session.expires_at <= clock_timestamp()
    or v_session.subject_id is null
    or v_session.cohort_id is not null then
    raise exception using errcode = '42501', message = 'upload authority is not current';
  end if;

  if p_original_name is null or char_length(btrim(p_original_name)) not between 1 and 255 then
    raise exception using errcode = '22023', message = 'invalid original filename';
  end if;

  v_expected_tier := case
    when p_file_type in ('array_23andme', 'array_ancestry', 'array_myheritage', 'array_ftdna', 'vcf', 'gvcf') then 1
    when p_file_type in ('bam', 'cram') then 2
    else null
  end;
  if v_expected_tier is null or p_tier <> v_expected_tier then
    raise exception using errcode = '22023', message = 'invalid file tier';
  end if;

  insert into public.genome_files (
    user_id,
    subject_id,
    bucket_path,
    original_name,
    file_type,
    tier,
    size_bytes,
    sha256,
    status,
    upload_revision
  ) values (
    p_account_id,
    v_session.subject_id,
    v_session.staging_object_name,
    btrim(p_original_name),
    p_file_type::public.genome_file_type,
    p_tier,
    v_session.expected_size,
    v_session.expected_sha256,
    case when p_tier = 1 then 'uploaded'::public.genome_file_status else 'stored'::public.genome_file_status end,
    v_session.upload_revision
  )
  returning id into v_file_id;

  insert into public.genome_storage_objects (
    object_id,
    object_name,
    bucket_id,
    genome_file_id,
    sha256,
    byte_count,
    object_revision,
    state
  ) values (
    p_storage_object_id,
    v_session.staging_object_name,
    'genomes',
    v_file_id,
    v_session.expected_sha256,
    v_session.expected_size,
    v_session.upload_revision,
    'current'
  );

  update public.genome_files
  set storage_object_id = p_storage_object_id
  where id = v_file_id;

  update public.upload_sessions
  set status = 'promoted', consumed_at = clock_timestamp()
  where id = v_session.id;

  return v_file_id;
end;
$$;

revoke all on function public.complete_upload_session(
  uuid, uuid, uuid, uuid, text, text, smallint
) from public, anon, authenticated;
grant execute on function public.complete_upload_session(
  uuid, uuid, uuid, uuid, text, text, smallint
) to service_role;

grant execute on function public.processing_time_stats() to service_role;
