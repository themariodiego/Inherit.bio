-- Account deletion expansion for wholly owned, unshared adult subjects and
-- their family-pair outputs. Cross-account and embryo/claim/review graphs
-- remain fail-closed before the first physical delete.

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
    'family_pairs.subject_a_id', 'family_pairs.subject_b_id',
    'generated_exports.account_id', 'generated_exports.requester_principal_id',
    'genome_files.subject_id', 'genome_files.user_id',
    'llm_keys.user_id', 'llm_settings.user_id',
    'mail_outbox.recipient_principal_id', 'pending_source_rows.subject_id',
    'portrait_results.owner_account_id',
    'portrait_results.parent_a_subject_id',
    'portrait_results.parent_b_subject_id',
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
  v_self_subject_id uuid;
  v_subject_ids uuid[];
  v_principal_ids uuid[];
  v_pair_ids uuid[];
begin
  select s.id into v_self_subject_id
  from public.subjects s
  where s.owner_account_id = p_account_id
    and s.subject_account_id = p_account_id
    and s.subject_class = 'self'
    and s.lifecycle not in ('purged', 'claimed_unbound')
  order by s.created_at, s.id
  limit 1
  for update;

  select coalesce(array_agg(s.id order by s.created_at, s.id), '{}'::uuid[])
  into v_subject_ids
  from public.subjects s
  where s.owner_account_id = p_account_id
     or s.subject_account_id = p_account_id;

  if v_self_subject_id is null
    or exists (
      select 1 from public.subjects s
      where s.id = any(v_subject_ids)
        and (
          s.owner_account_id is distinct from p_account_id
          or s.subject_account_id is not null
             and s.subject_account_id is distinct from p_account_id
          or s.subject_class not in ('self', 'other_adult')
          or s.lifecycle in ('purged', 'claimed_unbound', 'claimed_bound')
        )
    )
  then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  select coalesce(array_agg(sp.id), '{}'::uuid[]) into v_principal_ids
  from public.subject_principals sp
  where sp.account_id = p_account_id or sp.subject_id = any(v_subject_ids);

  if exists (
    select 1 from public.subject_principals sp
    where sp.id = any(v_principal_ids)
      and (
        sp.subject_id is null or sp.subject_id <> all(v_subject_ids)
        or sp.account_id is not null and sp.account_id is distinct from p_account_id
        or sp.principal_kind not in ('account_subject', 'non_account_subject')
      )
  ) or exists (
    select 1 from public.subject_account_bindings b
    where (b.account_id = p_account_id or b.subject_id = any(v_subject_ids))
      and (
        b.account_id is distinct from p_account_id
        or b.subject_id <> all(v_subject_ids)
        or b.account_principal_id <> all(v_principal_ids)
        or b.subject_principal_id <> all(v_principal_ids)
      )
  ) or exists (
    select 1 from public.subject_relationships sr
    where sr.subject_id = any(v_subject_ids)
       or sr.data_subject_principal_id = any(v_principal_ids)
       or sr.recipient_principal_id = any(v_principal_ids)
       or sr.recipient_account_id = p_account_id
    group by sr.id
    having bool_or(
      sr.subject_id <> all(v_subject_ids)
      or sr.data_subject_principal_id <> all(v_principal_ids)
      or sr.recipient_principal_id <> all(v_principal_ids)
      or sr.recipient_account_id is not null
         and sr.recipient_account_id is distinct from p_account_id
    )
  ) then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  select coalesce(array_agg(fp.id), '{}'::uuid[]) into v_pair_ids
  from public.family_pairs fp
  where fp.subject_a_id = any(v_subject_ids)
     or fp.subject_b_id = any(v_subject_ids);

  if exists (
    select 1 from public.family_pairs fp
    where fp.id = any(v_pair_ids)
      and (fp.subject_a_id <> all(v_subject_ids)
        or fp.subject_b_id <> all(v_subject_ids))
  ) or exists (
    select 1 from public.portrait_results pr
    where pr.family_pair_id = any(v_pair_ids)
       or pr.parent_a_subject_id = any(v_subject_ids)
       or pr.parent_b_subject_id = any(v_subject_ids)
    group by pr.id
    having bool_or(
      pr.owner_account_id is distinct from p_account_id
      or pr.parent_a_subject_id <> all(v_subject_ids)
      or pr.parent_b_subject_id <> all(v_subject_ids)
      or pr.family_pair_id <> all(v_pair_ids)
    )
  ) or exists (
    select 1 from public.chats c
    where c.family_pair_id = any(v_pair_ids)
      and c.user_id is distinct from p_account_id
  ) or exists (
    select 1 from public.directional_grants dg
    where dg.pair_id = any(v_pair_ids)
      and (
        dg.recipient_account_id is not null
           and dg.recipient_account_id is distinct from p_account_id
        or dg.recipient_principal_id <> all(v_principal_ids)
      )
  ) then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  if exists (
    select 1 from public.genome_files gf
    where gf.subject_id = any(v_subject_ids)
      and gf.user_id is distinct from p_account_id
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
  ) or exists (
    select 1 from public.attestation_contradictions c
    where c.subject_id = any(v_subject_ids)
       or c.principal_id = any(v_principal_ids)
  ) or exists (
    select 1 from public.retention_rows r
    where r.state in ('scheduled', 'active')
      and r.retention_id <> 'account-deletion.notice-7d'
      and (
        r.target_id = p_account_id
        or r.target_id = any(v_subject_ids)
        or r.target_id = any(v_pair_ids)
        or r.target_id in (
          select gf.id from public.genome_files gf
          where gf.user_id = p_account_id or gf.subject_id = any(v_subject_ids)
        )
      )
  ) then
    raise exception using errcode = '55000', message = 'unsupported_account_graph';
  end if;

  perform private.assert_supported_account_fk_shape_v1(
    p_account_id, v_subject_ids, v_principal_ids
  );

  return v_self_subject_id;
end;
$$;

revoke all on function private.assert_supported_self_deletion_graph_v1(uuid)
  from public, anon, authenticated;
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
  v_family_pair_ids uuid[];
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
  select coalesce(array_agg(fp.id), '{}'::uuid[]) into v_family_pair_ids
  from public.family_pairs fp
  where fp.subject_a_id = any(v_subject_ids)
     or fp.subject_b_id = any(v_subject_ids);
  select coalesce(array_agg(gf.id), '{}'::uuid[]) into v_file_ids
  from public.genome_files gf
  where gf.user_id = v_account_id or gf.subject_id = any(v_subject_ids);
  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_chat_ids
  from public.chats c
  where c.user_id = v_account_id or c.subject_id = any(v_subject_ids)
     or c.family_pair_id = any(v_family_pair_ids);
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
    or (e.target_kind = 'subject' and e.target_id = any(v_subject_ids))
    or (e.target_kind = 'family_pair' and e.target_id = any(v_family_pair_ids));
  select coalesce(array_agg(gso.object_id), '{}'::uuid[]) into v_storage_ids
  from public.genome_storage_objects gso
  where gso.genome_file_id = any(v_file_ids)
     or gso.generated_export_id = any(v_export_ids);
  select coalesce(array_agg(m.id), '{}'::uuid[]) into v_outbox_ids
  from public.mail_outbox m
  where m.recipient_principal_id = any(v_principal_ids)
    or m.target_id = p_deletion_id
    or m.target_id = v_account_id
    or m.target_id = any(v_subject_ids)
    or m.target_id = any(v_family_pair_ids);
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
  delete from public.portrait_results
    where owner_account_id = v_account_id
       or family_pair_id = any(v_family_pair_ids)
       or parent_a_subject_id = any(v_subject_ids)
       or parent_b_subject_id = any(v_subject_ids);

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
       or signer_principal_id = any(v_principal_ids)
       or (target_kind = 'family_pair' and target_id = any(v_family_pair_ids));
  delete from public.directional_grants
    where recipient_account_id = v_account_id
       or recipient_principal_id = any(v_principal_ids)
       or pair_id = any(v_family_pair_ids);
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
  delete from public.family_pairs where id = any(v_family_pair_ids);

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
