-- Crash-safe account deletion for the currently implemented self-account
-- graph. Advanced adult, family, embryo, claim, and reviewer graphs fail
-- closed until their independent transfer/restriction resolvers are live.

alter table public.account_deletion_requests
  drop constraint account_deletion_requests_account_id_fkey,
  alter column account_id drop not null,
  add column account_pseudonym_id uuid not null default gen_random_uuid(),
  add column claim_token_hash text
    check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  add column claim_expires_at timestamptz,
  add column storage_manifest_frozen_at timestamptz,
  add column storage_completed_at timestamptz,
  add column database_purged_at timestamptz,
  add column last_error_code text,
  add constraint account_deletion_requests_claim_shape check (
    (claim_token_hash is null) = (claim_expires_at is null)
  );

create table public.account_deletion_storage_entries (
  deletion_id uuid not null
    references public.account_deletion_requests (id) on delete restrict,
  entry_ordinal bigint not null check (entry_ordinal > 0),
  bucket_id text not null check (bucket_id in (
    'genomes', 'genomes-staging', 'generated-artifacts', 'legal-evidence'
  )),
  object_name text not null check (char_length(object_name) between 1 and 1024),
  source_kind text not null check (source_kind in (
    'canonical-source', 'legacy-source', 'upload-staging',
    'generated-export', 'legal-evidence'
  )),
  source_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'deleted', 'missing')),
  completed_at timestamptz,
  primary key (deletion_id, entry_ordinal),
  unique (deletion_id, bucket_id, object_name),
  check ((status = 'pending') = (completed_at is null))
);

create index account_deletion_storage_entries_pending_idx
  on public.account_deletion_storage_entries (deletion_id, status, entry_ordinal);

alter table public.account_deletion_storage_entries enable row level security;
revoke all on table public.account_deletion_storage_entries
  from public, anon, authenticated;
grant all on table public.account_deletion_storage_entries to service_role;

create or replace function private.assert_supported_account_fk_shape_v1(
  p_account_id uuid,
  p_subject_ids uuid[],
  p_principal_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count bigint;
  v_reference text;
  v_allowed_references constant text[] := array[
    'account_operation_nonces.account_id',
    'account_security_states.account_id',
    'ancestry_regions.subject_id',
    'ancestry_results.subject_id', 'ancestry_results.user_id',
    'attestation_contradictions.principal_id',
    'attestation_contradictions.subject_id',
    'attestations.principal_id',
    'chat_messages.user_id', 'chats.subject_id', 'chats.user_id',
    'consent_grants.user_id', 'consent_signatures.signer_account_id',
    'consent_signatures.signer_principal_id',
    'copilot_context_tokens.account_id',
    'copilot_generation_sessions.account_id',
    'directional_grants.recipient_account_id',
    'directional_grants.recipient_principal_id',
    'download_sessions.account_id', 'download_sessions.principal_id',
    'encrypted_contact_references.principal_id',
    'generated_exports.account_id', 'generated_exports.requester_principal_id',
    'genome_files.subject_id', 'genome_files.user_id',
    'llm_keys.user_id', 'llm_settings.user_id',
    'mail_outbox.recipient_principal_id', 'pending_source_rows.subject_id',
    'profiles.id', 'provider_recipient_grants.account_id',
    'provider_recipient_grants.recipient_principal_id',
    'purpose_grants.data_subject_principal_id',
    'purpose_grants.signer_principal_id', 'report_artifacts.subject_id',
    'rights_sessions.principal_id', 'subject_account_bindings.account_id',
    'subject_account_bindings.account_principal_id',
    'subject_account_bindings.subject_id',
    'subject_account_bindings.subject_principal_id',
    'subject_consents.account_id', 'subject_consents.subject_id',
    'subject_control_refusal_authorities.principal_id',
    'subject_control_refusal_authorities.subject_id',
    'subject_demographics.subject_id', 'subject_principals.account_id',
    'subject_principals.subject_id',
    'subject_relationships.data_subject_principal_id',
    'subject_relationships.recipient_account_id',
    'subject_relationships.recipient_principal_id',
    'subject_relationships.subject_id', 'subjects.owner_account_id',
    'subjects.subject_account_id', 'suppressions.subject_id',
    'upload_sessions.account_id', 'upload_sessions.subject_id',
    'user_prs.subject_id', 'user_prs.user_id',
    'user_variants.subject_id', 'user_variants.user_id',
    'worker_jobs.subject_id', 'worker_jobs.user_id'
  ];
begin
  for r in
    select nc.nspname schema_name, cc.relname table_name,
      ac.attname column_name, np.nspname parent_schema, cp.relname parent_table
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_namespace nc on nc.oid = cc.relnamespace
    join pg_class cp on cp.oid = con.confrelid
    join pg_namespace np on np.oid = cp.relnamespace
    join lateral unnest(con.conkey) with ordinality ck(attnum, ord) on true
    join lateral unnest(con.confkey) with ordinality pk(attnum, ord)
      on pk.ord = ck.ord
    join pg_attribute ac on ac.attrelid = con.conrelid and ac.attnum = ck.attnum
    where con.contype = 'f' and array_length(con.conkey, 1) = 1
      and nc.nspname = 'public'
      and ((np.nspname = 'auth' and cp.relname = 'users')
        or (np.nspname = 'public' and cp.relname in ('subjects', 'subject_principals')))
  loop
    v_reference := format('%s.%s', r.table_name, r.column_name);
    if not v_reference = any(v_allowed_references) then
      if r.parent_schema = 'auth' then
        execute format('select count(*) from %I.%I where %I = $1',
          r.schema_name, r.table_name, r.column_name)
        into v_count using p_account_id;
      elsif r.parent_table = 'subjects' then
        execute format('select count(*) from %I.%I where %I = any($1)',
          r.schema_name, r.table_name, r.column_name)
        into v_count using p_subject_ids;
      else
        execute format('select count(*) from %I.%I where %I = any($1)',
          r.schema_name, r.table_name, r.column_name)
        into v_count using p_principal_ids;
      end if;
      if v_count > 0 then
        raise exception using errcode = '55000', message = 'unsupported_account_graph';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_supported_account_fk_shape_v1(
  uuid, uuid[], uuid[]
) from public, anon, authenticated;

create or replace function private.assert_supported_self_deletion_graph_v1(
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_principal_ids uuid[];
begin
  select s.id into v_subject_id
  from public.subjects s
  where s.owner_account_id = p_account_id
    and s.subject_account_id = p_account_id
    and s.subject_class = 'self'
    and s.lifecycle not in ('purged', 'claimed_unbound')
  order by s.created_at, s.id
  limit 1
  for update;

  if v_subject_id is null
    or (select count(*) from public.subjects s
        where s.owner_account_id = p_account_id
           or s.subject_account_id = p_account_id) <> 1
  then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  select coalesce(array_agg(sp.id), '{}'::uuid[]) into v_principal_ids
  from public.subject_principals sp
  where sp.account_id = p_account_id or sp.subject_id = v_subject_id;

  if exists (
    select 1 from public.subject_principals sp
    where (sp.account_id = p_account_id or sp.subject_id = v_subject_id)
      and (sp.subject_id is distinct from v_subject_id
        or sp.principal_kind <> 'account_subject')
  ) or exists (
    select 1 from public.subject_relationships sr
    where sr.subject_id = v_subject_id
      and sr.relationship_kind <> 'self'
  ) or exists (
    select 1 from public.family_pairs fp
    where fp.subject_a_id = v_subject_id or fp.subject_b_id = v_subject_id
  ) or exists (
    select 1 from public.adult_subject_drafts d
    where d.owner_account_id = p_account_id
  ) or exists (
    select 1 from public.embryo_cohort_drafts d
    where d.owner_account_id = p_account_id
       or d.uploader_principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.embryo_cohorts c
    where c.owner_account_id = p_account_id
  ) or exists (
    select 1 from public.future_person_claims c
    where c.claimant_account_id = p_account_id
       or c.claimant_principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.appeal_intakes a
    where a.appellant_account_id = p_account_id
       or a.appellant_principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.correction_requests c
    where c.claimant_principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.legal_evidence_ingest_sessions e
    where e.principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.template_reviews tr
    where tr.reviewer_principal_id = any(v_principal_ids)
  ) then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  if exists (
    select 1 from public.attestation_contradictions c
    where c.subject_id = v_subject_id
       or c.principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.retention_rows r
    where r.state in ('scheduled', 'active')
      and r.retention_id <> 'account-deletion.notice-7d'
      and (
        r.target_id = p_account_id
        or r.target_id = v_subject_id
        or r.target_id in (
          select gf.id from public.genome_files gf
          where gf.user_id = p_account_id or gf.subject_id = v_subject_id
        )
      )
  ) then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  perform private.assert_supported_account_fk_shape_v1(
    p_account_id, array[v_subject_id], v_principal_ids
  );

  return v_subject_id;
end;
$$;

revoke all on function private.assert_supported_self_deletion_graph_v1(uuid)
  from public, anon, authenticated;

create or replace function public.claim_due_account_deletion_v1(
  p_claim_token_hash text,
  p_lease_seconds integer default 300
)
returns table (
  deletion_id uuid,
  account_id uuid,
  storage_objects jsonb,
  database_already_purged boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.account_deletion_requests%rowtype;
  v_retention public.retention_rows%rowtype;
  v_phase public.retention_due_phases%rowtype;
  v_manifest_id uuid;
  v_subject_id uuid;
begin
  if p_claim_token_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds not between 30 and 300
  then
    raise exception using errcode = '22023', message = 'invalid_retention_claim';
  end if;

  select d.* into v_request
  from public.account_deletion_requests d
  where (
      d.state = 'notice_period'
      and d.notice_ends_at <= v_now
    ) or (
      d.state = 'delete_started'
      and (d.claim_expires_at is null or d.claim_expires_at <= v_now)
    )
  order by d.notice_ends_at, d.id
  for update skip locked
  limit 1;

  if v_request.id is null then return; end if;
  if v_request.account_id is null then
    raise exception using errcode = '55000', message = 'deletion_account_missing';
  end if;

  select r.* into strict v_retention
  from public.retention_rows r
  where r.retention_id = 'account-deletion.notice-7d'
    and r.target_kind = 'account'
    and r.target_id = v_request.account_id
    and r.state in ('scheduled', 'active')
    and r.fixed_deadline = v_request.notice_ends_at
  order by r.created_at desc limit 1
  for update;

  select p.* into strict v_phase
  from public.retention_due_phases p
  where p.retention_row_id = v_retention.id
    and p.phase_id = 'account-deletion-notice-deadline'
    and p.phase_deadline = v_request.notice_ends_at
    and p.status in ('pending', 'retry', 'claimed')
  for update;

  select m.id into strict v_manifest_id
  from public.purge_manifests m
  where m.retention_row_id = v_retention.id
    and m.phase_id = v_phase.phase_id
    and m.phase_revision = v_phase.phase_revision
    and m.manifest_class = 'complete-retention'
    and m.state in ('frozen', 'executing')
  for update;

  if v_request.state = 'notice_period' then
    if v_phase.status not in ('pending', 'retry')
      or v_retention.fixed_deadline > v_now
    then
      raise exception using errcode = '55000', message = 'retention_not_due';
    end if;

    v_subject_id := private.assert_supported_self_deletion_graph_v1(
      v_request.account_id
    );

    if not exists (
      select 1 from public.profiles p
      where p.id = v_request.account_id
        and p.deletion_requested_at is not null
      for update
    ) then
      raise exception using errcode = '55000', message = 'deletion_hold_missing';
    end if;

    update public.account_deletion_requests
    set state = 'delete_started', delete_started_at = v_now,
        claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
        storage_manifest_frozen_at = v_now,
        last_error_code = null
    where id = v_request.id
    returning * into v_request;

    update public.retention_rows
    set state = 'active'
    where id = v_retention.id;
    update public.retention_due_phases
    set status = 'claimed', claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_request.claim_expires_at,
        attempts = attempts + 1
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
    update public.purge_manifests
    set state = 'executing'
    where id = v_manifest_id;

    -- No Auth session survives the deadline transition.
    delete from auth.sessions where user_id = v_request.account_id;

    insert into public.account_deletion_storage_entries (
      deletion_id, entry_ordinal, bucket_id, object_name,
      source_kind, source_id
    )
    select v_request.id,
      row_number() over (order by x.bucket_id, x.object_name),
      x.bucket_id, x.object_name, x.source_kind, x.source_id
    from (
      select gso.bucket_id, gso.object_name,
        case when gso.generated_export_id is null
          then 'canonical-source' else 'generated-export' end as source_kind,
        gso.object_id as source_id
      from public.genome_storage_objects gso
      left join public.genome_files gf on gf.id = gso.genome_file_id
      left join public.generated_exports ge on ge.id = gso.generated_export_id
      where gf.user_id = v_request.account_id
         or gf.subject_id = v_subject_id
         or ge.account_id = v_request.account_id

      union

      select 'genomes', gf.bucket_path, 'legacy-source', gf.id
      from public.genome_files gf
      where (gf.user_id = v_request.account_id or gf.subject_id = v_subject_id)
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = 'genomes' and so.name = gf.bucket_path
        )
        and not exists (
          select 1 from public.genome_storage_objects gso
          where gso.genome_file_id = gf.id
            and gso.bucket_id = 'genomes'
            and gso.object_name = gf.bucket_path
        )

      union

      select 'genomes-staging', us.staging_object_name,
        'upload-staging', us.id
      from public.upload_sessions us
      where us.account_id = v_request.account_id
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = 'genomes-staging'
            and so.name = us.staging_object_name
        )
    ) x
    on conflict do nothing;

    insert into public.purge_manifest_entries (
      manifest_id, target_id, store_name, row_key, entry_revision, status
    )
    select v_manifest_id, 'storage-objects', 'storage.objects',
      jsonb_build_object('bucketId', e.bucket_id, 'objectName', e.object_name),
      e.entry_ordinal, 'pending'
    from public.account_deletion_storage_entries e
    where e.deletion_id = v_request.id
    on conflict do nothing;
  else
    update public.account_deletion_requests
    set claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_now + make_interval(secs => p_lease_seconds),
        last_error_code = null
    where id = v_request.id
    returning * into v_request;
    update public.retention_due_phases
    set status = 'claimed', claim_token_hash = p_claim_token_hash,
        claim_expires_at = v_request.claim_expires_at,
        attempts = least(attempts + 1, 20)
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
  end if;

  return query
  select v_request.id, v_request.account_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketId', e.bucket_id,
        'objectName', e.object_name,
        'ordinal', e.entry_ordinal
      ) order by e.entry_ordinal)
      from public.account_deletion_storage_entries e
      where e.deletion_id = v_request.id and e.status = 'pending'
    ), '[]'::jsonb),
    v_request.database_purged_at is not null;
end;
$$;

revoke all on function public.claim_due_account_deletion_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_account_deletion_v1(text, integer)
  to service_role;

create or replace function public.complete_account_deletion_storage_batch_v1(
  p_deletion_id uuid,
  p_claim_token_hash text,
  p_entries jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 1000 then
    raise exception using errcode = '22023', message = 'invalid_storage_batch';
  end if;
  if not exists (
    select 1 from public.account_deletion_requests d
    where d.id = p_deletion_id and d.state = 'delete_started'
      and d.claim_token_hash = p_claim_token_hash
      and d.claim_expires_at > clock_timestamp()
    for update
  ) then
    raise exception using errcode = '42501', message = 'invalid_deletion_claim';
  end if;

  with supplied as (
    select value->>'bucketId' bucket_id, value->>'objectName' object_name
    from jsonb_array_elements(p_entries)
  )
  update public.account_deletion_storage_entries e
  set status = 'deleted', completed_at = clock_timestamp()
  from supplied s
  where e.deletion_id = p_deletion_id and e.status = 'pending'
    and e.bucket_id = s.bucket_id and e.object_name = s.object_name;
  get diagnostics v_updated = row_count;

  with supplied as (
    select value->>'bucketId' bucket_id, value->>'objectName' object_name
    from jsonb_array_elements(p_entries)
  )
  update public.purge_manifest_entries pme
  set status = 'deleted'
  where pme.manifest_id in (
      select pm.id from public.purge_manifests pm
      join public.retention_rows rr on rr.id = pm.retention_row_id
      where rr.target_kind = 'account'
        and rr.target_id = (
          select d.account_id from public.account_deletion_requests d
          where d.id = p_deletion_id
        )
    )
    and pme.target_id = 'storage-objects'
    and exists (
      select 1 from supplied s
      where pme.row_key->>'bucketId' = s.bucket_id
        and pme.row_key->>'objectName' = s.object_name
    );
  return v_updated;
end;
$$;

revoke all on function public.complete_account_deletion_storage_batch_v1(
  uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_account_deletion_storage_batch_v1(
  uuid, text, jsonb
) to service_role;

create or replace function public.complete_account_deletion_storage_v1(
  p_deletion_id uuid,
  p_claim_token_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.account_deletion_requests d
    where d.id = p_deletion_id and d.state = 'delete_started'
      and d.claim_token_hash = p_claim_token_hash
      and d.claim_expires_at > clock_timestamp()
    for update
  ) or exists (
    select 1 from public.account_deletion_storage_entries e
    where e.deletion_id = p_deletion_id and e.status = 'pending'
  ) then
    raise exception using errcode = '55000', message = 'storage_purge_incomplete';
  end if;
  update public.account_deletion_requests
  set storage_completed_at = coalesce(storage_completed_at, clock_timestamp())
  where id = p_deletion_id;
end;
$$;

revoke all on function public.complete_account_deletion_storage_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_account_deletion_storage_v1(uuid, text)
  to service_role;

create or replace function private.assert_no_public_fk_residual_v1(
  p_account_id uuid,
  p_subject_ids uuid[],
  p_principal_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count bigint;
begin
  for r in
    select nc.nspname schema_name, cc.relname table_name,
      ac.attname column_name, np.nspname parent_schema, cp.relname parent_table
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_namespace nc on nc.oid = cc.relnamespace
    join pg_class cp on cp.oid = con.confrelid
    join pg_namespace np on np.oid = cp.relnamespace
    join lateral unnest(con.conkey) with ordinality ck(attnum, ord) on true
    join lateral unnest(con.confkey) with ordinality pk(attnum, ord)
      on pk.ord = ck.ord
    join pg_attribute ac on ac.attrelid = con.conrelid and ac.attnum = ck.attnum
    where con.contype = 'f' and array_length(con.conkey, 1) = 1
      and nc.nspname = 'public'
      and ((np.nspname = 'auth' and cp.relname = 'users')
        or (np.nspname = 'public' and cp.relname in ('subjects', 'subject_principals')))
  loop
    if r.parent_schema = 'auth' then
      execute format('select count(*) from %I.%I where %I = $1',
        r.schema_name, r.table_name, r.column_name)
      into v_count using p_account_id;
    elsif r.parent_table = 'subjects' then
      execute format('select count(*) from %I.%I where %I = any($1)',
        r.schema_name, r.table_name, r.column_name)
      into v_count using p_subject_ids;
    else
      execute format('select count(*) from %I.%I where %I = any($1)',
        r.schema_name, r.table_name, r.column_name)
      into v_count using p_principal_ids;
    end if;
    if v_count > 0 then
      raise exception using errcode = '55000',
        message = format('residual_fk:%s.%s.%s',
          r.schema_name, r.table_name, r.column_name);
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_no_public_fk_residual_v1(
  uuid, uuid[], uuid[]
) from public, anon, authenticated;

create or replace function public.purge_account_deletion_database_v1(
  p_deletion_id uuid,
  p_claim_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.account_deletion_requests%rowtype;
  v_account_id uuid;
  v_subject_ids uuid[];
  v_principal_ids uuid[];
  v_chat_ids uuid[];
  v_generation_ids uuid[];
  v_model_context_ids uuid[];
  v_call_ids uuid[];
  v_outbox_ids uuid[];
  v_candidate_ids uuid[];
  v_token_hash_ids uuid[];
  v_worker_ids uuid[];
  v_file_ids uuid[];
  v_export_ids uuid[];
  v_storage_ids uuid[];
begin
  select d.* into strict v_request
  from public.account_deletion_requests d
  where d.id = p_deletion_id and d.state = 'delete_started'
    and d.claim_token_hash = p_claim_token_hash
    and d.claim_expires_at > clock_timestamp()
  for update;
  if v_request.storage_completed_at is null then
    raise exception using errcode = '55000', message = 'storage_purge_incomplete';
  end if;
  if v_request.database_purged_at is not null then
    return v_request.account_id;
  end if;

  v_account_id := v_request.account_id;
  perform private.assert_supported_self_deletion_graph_v1(v_account_id);

  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_subject_ids
  from public.subjects s
  where s.owner_account_id = v_account_id or s.subject_account_id = v_account_id;
  select coalesce(array_agg(sp.id), '{}'::uuid[]) into v_principal_ids
  from public.subject_principals sp
  where sp.account_id = v_account_id or sp.subject_id = any(v_subject_ids);
  select coalesce(array_agg(gf.id), '{}'::uuid[]) into v_file_ids
  from public.genome_files gf
  where gf.user_id = v_account_id or gf.subject_id = any(v_subject_ids);
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_chat_ids
  from public.chats c
  where c.user_id = v_account_id or c.subject_id = any(v_subject_ids);
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_generation_ids
  from public.copilot_generation_sessions s
  where s.account_id = v_account_id or s.chat_id = any(v_chat_ids);
  select coalesce(array_agg(mc.id), '{}'::uuid[]) into v_model_context_ids
  from public.model_contexts mc
  where mc.generation_session_id = any(v_generation_ids);
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_call_ids
  from public.cloud_model_calls c
  where c.model_context_id = any(v_model_context_ids);
  select coalesce(array_agg(w.id), '{}'::uuid[]) into v_worker_ids
  from public.worker_jobs w
  where w.user_id = v_account_id or w.subject_id = any(v_subject_ids)
    or w.file_id = any(v_file_ids);
  select coalesce(array_agg(e.id), '{}'::uuid[]) into v_export_ids
  from public.generated_exports e
  where e.account_id = v_account_id
    or e.requester_principal_id = any(v_principal_ids)
    or (e.target_kind = 'subject' and e.target_id = any(v_subject_ids));
  select coalesce(array_agg(gso.object_id), '{}'::uuid[]) into v_storage_ids
  from public.genome_storage_objects gso
  where gso.genome_file_id = any(v_file_ids)
     or gso.generated_export_id = any(v_export_ids);
  select coalesce(array_agg(m.id), '{}'::uuid[]) into v_outbox_ids
  from public.mail_outbox m
  where m.recipient_principal_id = any(v_principal_ids)
    or m.target_id = p_deletion_id
    or m.target_id = v_account_id
    or m.target_id = any(v_subject_ids);
  select coalesce(array_agg(tc.id), '{}'::uuid[]) into v_candidate_ids
  from public.token_candidates tc where tc.outbox_id = any(v_outbox_ids);
  select coalesce(array_agg(th.id), '{}'::uuid[]) into v_token_hash_ids
  from public.token_hashes th where th.candidate_id = any(v_candidate_ids);

  -- Model, chat, download, export, and mail working state.
  delete from public.cloud_provider_payloads where cloud_model_call_id = any(v_call_ids);
  delete from public.cloud_provider_attempts where cloud_model_call_id = any(v_call_ids);
  delete from public.cloud_model_calls where id = any(v_call_ids);
  delete from public.model_contexts where id = any(v_model_context_ids);
  delete from public.copilot_context_tokens
    where account_id = v_account_id or chat_id = any(v_chat_ids);
  delete from public.copilot_context_history where chat_id = any(v_chat_ids);
  delete from public.copilot_turn_dependencies where chat_id = any(v_chat_ids);
  delete from public.copilot_generation_sessions where id = any(v_generation_ids);
  delete from public.chat_messages where user_id = v_account_id or chat_id = any(v_chat_ids);
  delete from public.chats where id = any(v_chat_ids);

  delete from public.download_ranges where session_id in (
    select id from public.download_sessions
    where account_id = v_account_id or principal_id = any(v_principal_ids)
      or object_id = any(v_storage_ids)
  );
  delete from public.download_sessions
    where account_id = v_account_id or principal_id = any(v_principal_ids)
      or object_id = any(v_storage_ids);

  delete from public.future_person_claim_notices where outbox_id = any(v_outbox_ids);
  delete from public.invitation_reminders where outbox_id = any(v_outbox_ids);
  delete from public.mail_deliveries where outbox_id = any(v_outbox_ids)
    or provider_attempt_id in (
      select id from public.mail_provider_attempts where outbox_id = any(v_outbox_ids)
    );
  delete from public.mail_provider_attempts where outbox_id = any(v_outbox_ids);
  delete from public.rights_nonces where rights_session_id in (
    select id from public.rights_sessions
    where principal_id = any(v_principal_ids) or token_hash_id = any(v_token_hash_ids)
  );
  delete from public.rights_sessions
    where principal_id = any(v_principal_ids) or token_hash_id = any(v_token_hash_ids);
  delete from public.token_hashes where id = any(v_token_hash_ids);
  delete from public.token_candidates where id = any(v_candidate_ids);
  delete from public.mail_outbox where id = any(v_outbox_ids);

  -- Account consent, processing, and derived data.
  delete from public.attestation_contradictions
    where subject_id = any(v_subject_ids) or principal_id = any(v_principal_ids)
      or attestation_id in (
        select id from public.attestations where principal_id = any(v_principal_ids)
      );
  delete from public.attestations where principal_id = any(v_principal_ids);
  delete from public.subject_consents
    where account_id = v_account_id or subject_id = any(v_subject_ids);
  delete from public.purpose_grants
    where data_subject_principal_id = any(v_principal_ids)
       or signer_principal_id = any(v_principal_ids);
  delete from public.directional_grants
    where recipient_account_id = v_account_id
       or recipient_principal_id = any(v_principal_ids);
  delete from public.provider_recipient_grants
    where account_id = v_account_id or recipient_principal_id = any(v_principal_ids);
  delete from public.consent_signatures
    where signer_account_id = v_account_id or signer_principal_id = any(v_principal_ids);
  delete from public.consent_grants where user_id = v_account_id;

  delete from public.analysis_jobs where worker_job_id = any(v_worker_ids);
  delete from public.pending_source_rows where worker_job_id = any(v_worker_ids)
    or subject_id = any(v_subject_ids);
  delete from public.worker_job_batches where worker_job_id = any(v_worker_ids);
  delete from public.worker_jobs where id = any(v_worker_ids);
  delete from public.report_artifacts where subject_id = any(v_subject_ids);
  delete from public.suppressions where subject_id = any(v_subject_ids);
  delete from public.ancestry_regions
    where subject_id = any(v_subject_ids)
       or ancestry_result_id in (
         select id from public.ancestry_results
         where user_id = v_account_id or subject_id = any(v_subject_ids)
           or file_id = any(v_file_ids)
       );
  delete from public.ancestry_results
    where user_id = v_account_id or subject_id = any(v_subject_ids)
      or file_id = any(v_file_ids);
  delete from public.user_prs
    where user_id = v_account_id or subject_id = any(v_subject_ids)
      or file_id = any(v_file_ids);
  delete from public.user_variants
    where user_id = v_account_id or subject_id = any(v_subject_ids)
      or file_id = any(v_file_ids);

  delete from public.upload_chunks where upload_session_id in (
    select id from public.upload_sessions
    where account_id = v_account_id or subject_id = any(v_subject_ids)
  );
  delete from public.upload_staging_objects where upload_session_id in (
    select id from public.upload_sessions
    where account_id = v_account_id or subject_id = any(v_subject_ids)
  );
  delete from public.upload_sessions
    where account_id = v_account_id or subject_id = any(v_subject_ids);

  -- Deferrable file/object and export cycles are deleted in one transaction.
  set constraints public.genome_files_storage_object_fk,
    public.generated_exports_object_fk,
    public.genome_storage_objects_generated_export_id_fkey deferred;
  delete from public.genome_storage_objects where object_id = any(v_storage_ids);
  delete from public.generated_exports where id = any(v_export_ids);
  delete from public.genome_files where id = any(v_file_ids);

  delete from public.subject_control_refusal_authorities
    where subject_id = any(v_subject_ids) or principal_id = any(v_principal_ids);
  delete from public.subject_account_bindings
    where account_id = v_account_id or subject_id = any(v_subject_ids)
      or account_principal_id = any(v_principal_ids)
      or subject_principal_id = any(v_principal_ids);
  delete from public.subject_relationships
    where recipient_account_id = v_account_id or subject_id = any(v_subject_ids)
      or recipient_principal_id = any(v_principal_ids)
      or data_subject_principal_id = any(v_principal_ids);
  delete from public.encrypted_contact_references
    where principal_id = any(v_principal_ids);
  delete from public.subject_demographics where subject_id = any(v_subject_ids);
  delete from public.subject_principals where id = any(v_principal_ids);
  delete from public.subjects where id = any(v_subject_ids);

  delete from public.account_operation_nonces where account_id = v_account_id;
  delete from public.account_security_states where account_id = v_account_id;
  delete from public.llm_keys where user_id = v_account_id;
  delete from public.llm_settings where user_id = v_account_id;
  delete from public.profiles where id = v_account_id;

  perform private.assert_no_public_fk_residual_v1(
    v_account_id, v_subject_ids, v_principal_ids
  );

  update public.account_deletion_requests
  set database_purged_at = clock_timestamp()
  where id = p_deletion_id;
  return v_account_id;
end;
$$;

revoke all on function public.purge_account_deletion_database_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.purge_account_deletion_database_v1(uuid, text)
  to service_role;

create or replace function public.finalize_account_deletion_v1(
  p_deletion_id uuid,
  p_claim_token_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.account_deletion_requests%rowtype;
  v_retention_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  select d.* into strict v_request
  from public.account_deletion_requests d
  where d.id = p_deletion_id and d.state = 'delete_started'
    and d.claim_token_hash = p_claim_token_hash
    and d.database_purged_at is not null
  for update;
  if exists (select 1 from auth.users u where u.id = v_request.account_id) then
    raise exception using errcode = '55000', message = 'auth_user_still_exists';
  end if;

  select r.id into strict v_retention_id
  from public.retention_rows r
  where r.retention_id = 'account-deletion.notice-7d'
    and r.target_kind = 'account' and r.target_id = v_request.account_id
    and r.state = 'active'
  order by r.created_at desc limit 1 for update;

  update public.retention_due_phases
  set status = 'succeeded', claim_token_hash = null, claim_expires_at = null,
      terminal_outcome_code = 'account_deleted_zero_residual', completed_at = v_now,
      target_id = v_request.account_pseudonym_id,
      immutable_envelope = immutable_envelope - 'principalGraphRevision'
  where retention_row_id = v_retention_id;
  update public.purge_manifests
  set state = 'complete'
  where retention_row_id = v_retention_id;
  update public.purge_manifest_entries pme
  set row_key = jsonb_build_object('purged', true), object_id = null,
      status = case when status = 'pending' then 'missing' else status end
  where pme.manifest_id in (
    select pm.id from public.purge_manifests pm
    where pm.retention_row_id = v_retention_id
  );
  delete from public.account_deletion_storage_entries
  where deletion_id = p_deletion_id;
  update public.retention_rows
  set state = 'complete', ended_at = v_now,
      target_id = v_request.account_pseudonym_id
  where id = v_retention_id;
  update public.account_deletion_requests
  set account_id = null, state = 'complete', completed_at = v_now,
      claim_token_hash = null, claim_expires_at = null, last_error_code = null
  where id = p_deletion_id;
end;
$$;

revoke all on function public.finalize_account_deletion_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_account_deletion_v1(uuid, text)
  to service_role;

create or replace function public.fail_account_deletion_attempt_v1(
  p_deletion_id uuid,
  p_claim_token_hash text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in (
    'storage_delete_failed', 'storage_commit_failed',
    'database_purge_failed', 'auth_delete_failed', 'finalize_failed'
  ) then
    p_error_code := 'database_purge_failed';
  end if;
  update public.account_deletion_requests
  set claim_token_hash = null, claim_expires_at = null,
      last_error_code = p_error_code
  where id = p_deletion_id and state = 'delete_started'
    and claim_token_hash = p_claim_token_hash;
  update public.retention_due_phases
  set status = 'retry', claim_token_hash = null, claim_expires_at = null
  where retention_row_id in (
    select r.id from public.retention_rows r
    join public.account_deletion_requests d
      on d.account_id = r.target_id
    where d.id = p_deletion_id
  ) and status = 'claimed' and claim_token_hash = p_claim_token_hash;
end;
$$;

revoke all on function public.fail_account_deletion_attempt_v1(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_account_deletion_attempt_v1(uuid, text, text)
  to service_role;
