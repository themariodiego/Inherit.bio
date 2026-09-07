-- Preserve Storage-before-database deletion while removing canonical upload
-- sessions before the upload consent they reference. No new deletion authority.

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

  -- A canonical uncommitted lease belongs to its existing upload-working
  -- executor. Keep its exact staging/final metadata until that executor freezes
  -- and finishes its manifest, even when bytes are already absent. This also
  -- retains the tombstone which prevents a delayed final copy being recreated.
  -- Promoted sessions have cancelled their working retention phase; their
  -- immutable source was included in the acknowledged account Storage set.
  perform 1 from public.upload_sessions
    where account_id = v_account_id or subject_id = any(v_subject_ids)
    order by id for update;
  if exists (
    select 1 from public.upload_sessions u
    where (u.account_id = v_account_id or u.subject_id = any(v_subject_ids))
      and ((u.token_jti is not null and u.status <> 'promoted')
        or exists (
          select 1 from storage.objects o
          where o.bucket_id = u.storage_bucket
            and (o.name = u.staging_object_name or o.name = u.final_object_name::text)
        ))
  ) then
    raise exception using errcode = '55000', message = 'storage_purge_incomplete';
  end if;

  -- upload_consent_id is RESTRICT: remove only the already authorized account
  -- upload graph before its consent. The selection and child order are unchanged.
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

  -- Account consent, processing, and derived data.
  delete from public.attestation_contradictions
    where subject_id = any(v_subject_ids) or principal_id = any(v_principal_ids)
      or attestation_id in (
        select id from public.attestations where principal_id = any(v_principal_ids)
      );
  delete from public.attestations where principal_id = any(v_principal_ids);
  delete from public.subject_consents
    where account_id = v_account_id or subject_id = any(v_subject_ids);
  -- RESTRICT references must be removed before their exact owned grants.
  -- The graph validator above has checked every nonce referring to this
  -- graph, including foreign-account rows; there is no cross-account cascade.
  delete from public.purpose_grant_nonces where account_id = v_account_id;
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
