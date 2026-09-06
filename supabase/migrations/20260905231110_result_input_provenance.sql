-- File-owned processing metadata follows the file's existing retention target.
alter table public.genome_files
  add column input_provenance jsonb,
  add column input_source_sha256 text,
  add column processing_run_id uuid;

alter table public.genome_files add constraint input_provenance_completion check ((
  (input_provenance is null and input_source_sha256 is null) or
  (input_provenance is not null and input_source_sha256 ~ '^[0-9a-f]{64}$'
    and status = 'annotated' and processing_finished_at is not null
    and input_provenance->>'version' = 'listed-calls-v1'
    and input_provenance->>'sourceSha256' = input_source_sha256
    and (input_provenance->>'completedAt')::timestamptz = processing_finished_at)) is true
);

create function private.guard_input_provenance_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and
    ((tg_op = 'INSERT' and (new.input_provenance is not null or new.input_source_sha256 is not null or new.processing_run_id is not null)) or
     (tg_op = 'UPDATE' and (new.input_provenance is distinct from old.input_provenance or
       new.input_source_sha256 is distinct from old.input_source_sha256 or
       new.processing_run_id is distinct from old.processing_run_id))) then
    raise exception using errcode = '42501', message = 'Processing provenance is service-written';
  end if;
  if new.status <> 'annotated' then
    new.input_provenance := null;
    new.input_source_sha256 := null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_input_provenance_v1() from public, anon, authenticated;
create trigger guard_input_provenance before insert or update on public.genome_files
for each row execute function private.guard_input_provenance_v1();
