-- A claimed source can outlive its parent's live cohort/session. Freeze its
-- exact immutable part inventory under the existing retention stores; no
-- parent selector, ownership rewrite, replacement source or new store.
-- This is a private prerequisite. The public deletion-accepted door remains
-- closed until complete subject/body/export graph cleanup is proved.
insert into public.retention_phase_registry(retention_id,phase_id,phase_kind)
values('future-person.claimant-reverification-until-request','future-person-claimed-source-disposal','purge');

-- New supported custody has an exact random audit selector. Existing slices
-- stay NULL: no historical identity or ciphertext is guessed or backfilled.
alter table private.future_person_custody_slices add column audit_principal_id uuid
 references public.audit_principals(id) on delete restrict;
create unique index future_person_custody_audit_selector on private.future_person_custody_slices(audit_principal_id)
 where audit_principal_id is not null;
create function private.issue_future_person_audit_selector_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.audit_principal_id is not null then raise exception using errcode='42501',message='claimant audit unavailable';end if;
 insert into public.audit_principals default values returning id into new.audit_principal_id;
 return new;
end $$;
revoke all on function private.issue_future_person_audit_selector_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
create trigger future_person_custody_audit_issuer before insert on private.future_person_custody_slices
 for each row execute function private.issue_future_person_audit_selector_v1();
create function private.future_person_audit_selector_v1(p_subject uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 perform private.assert_future_person_subject_custody_v1(p_subject);
 select c.audit_principal_id into result from private.future_person_custody_slices c
   join public.subjects s on s.id=c.subject_id and s.claimant_principal_id=c.claimant_principal_id
   where c.subject_id=p_subject and s.lifecycle='claimed_unbound' and s.subject_account_id is null;
 if result is null then raise exception using errcode='42501',message='claimant audit unavailable';end if;
 return result;
end $$;
revoke all on function private.future_person_audit_selector_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The original create-only write capability may still be unexpired after
-- publication. A permanent empty marker fences it; only genuinely completed
-- publication provenance qualifies. Unsettled writers remain refused.
create function private.assert_future_person_settled_source_v1(p_file uuid)
returns void language plpgsql security definer set search_path='' as $$
declare x private.embryo_canonical_sources; settled boolean:=false;
begin
 select * into x from private.embryo_canonical_sources where file_id=p_file;
 if x.file_id is null then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select exists(select 1 from public.embryo_ingest_sessions s join public.worker_jobs w
   on w.id=s.worker_job_id and w.source_binding_id=s.id and w.cohort_id=s.cohort_id
   where s.id=x.session_id and s.cohort_id=x.cohort_id and s.status='published'
     and s.reference_build=x.reference_build and w.id=x.worker_job_id and w.status='done'
     and w.finished_at is not null and w.kind='split_cohort_vcf' and w.attempts=x.attempt
     and w.output_kind='ingest.normalize' and w.source_binding_kind='embryo-ingest-fragment-set'
     and w.source_binding_revision=s.ingest_revision and w.file_sha256=s.manifest_sha256) into settled;
 if not settled and to_regclass('private.claimed_embryo_ingest_receipts') is not null
   and to_regclass('private.claimed_embryo_job_receipts') is not null then
   execute $receipt$select exists(select 1 from private.claimed_embryo_ingest_receipts s
     join private.claimed_embryo_job_receipts j on j.id=s.worker_job_id and j.session_id=s.id
       and j.historical_cohort_id=s.historical_cohort_id and j.source_binding_revision=s.ingest_revision
       and j.file_sha256=s.manifest_sha256
     join private.embryo_canonical_sources x on x.session_id=s.id and x.worker_job_id=j.id
       and x.cohort_id=s.historical_cohort_id and x.attempt=j.attempt
       and x.publication_revision=s.publication_revision and x.reference_build=s.reference_build
     join private.future_person_custody_slices c on c.subject_id=x.subject_id and c.source_file_id=x.file_id
       and c.historical_cohort_id=x.cohort_id and c.publication_revision=x.publication_revision
       and c.source_sha256=x.source_sha256 and c.source_membership_sha256=x.membership_sha256
     where x.file_id=$1)$receipt$ into settled using p_file;
 end if;
 if not settled then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
end $$;
revoke all on function private.assert_future_person_settled_source_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Existing archive children are physical erasure targets, including every
-- uncertain reservation. Their export exclusion never exempted deletion.
do $$ declare name text; ordinal integer;begin
 select max(store_order) into ordinal from public.purge_target_stores where target_id='generated-artifacts';
 foreach name in array array['private.export_archive_jobs','private.export_archive_attempts',
   'private.export_archive_downloads','private.export_archive_manifest_pages',
   'private.export_archive_segments','private.export_archive_nonce_uses'] loop
  ordinal:=ordinal+1;
  insert into public.purge_target_stores(target_id,store_name,store_order) values('generated-artifacts',name,ordinal);
 end loop;
end $$;



-- Literal closed selector inventory. Only primary/unique identity fields and
-- exact provider object handles leave this helper; body, genotype, ciphertext and provider payload never do.
create function private.future_person_deletion_graph_rows_v1(p_subject uuid,p_claimant uuid,p_file uuid,p_embryo uuid,p_audit uuid)
returns table(purge_target_id text,physical_store text,primary_key jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.subjects s join private.future_person_custody_slices c on c.subject_id=s.id
   join private.embryo_canonical_sources x on x.file_id=c.source_file_id and x.subject_id=s.id
   join public.embryos e on e.id=x.embryo_id and e.subject_id=s.id
   where s.id=p_subject and c.claimant_principal_id=p_claimant and s.claimant_principal_id=p_claimant
    and x.file_id=p_file and e.id=p_embryo and c.audit_principal_id is not distinct from p_audit
    and s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.subject_account_id is null
    and s.cohort_id is null and e.cohort_id is null and e.status=s.lifecycle
    and (c.source_sha256,c.source_membership_sha256,c.publication_revision)
      is not distinct from (x.source_sha256,x.membership_sha256,x.publication_revision)) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_subject_custody_v1(p_subject);
 return query
 select 'ancestry-regions'::text target_id,'public.ancestry_regions'::text store_name,jsonb_build_object('ancestry_result_id',t.ancestry_result_id,'region_code',t.region_code) row_key from public.ancestry_regions t where t.subject_id=p_subject
 union all
 select 'ancestry-results'::text target_id,'public.ancestry_results'::text store_name,jsonb_build_object('id',t.id) row_key from public.ancestry_results t where t.subject_id=p_subject or t.file_id=p_file
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.appeal_intakes'::text store_name,jsonb_build_object('id',t.id) row_key from public.appeal_intakes t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.appellant_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.appeal_evidence'::text store_name,jsonb_build_object('id',t.id) row_key from public.appeal_evidence t where t.appeal_id in (select id from public.appeal_intakes where (target_kind in('subject','claimed-subject') and target_id=p_subject) or appellant_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.appeal_assignments'::text store_name,jsonb_build_object('id',t.id) row_key from public.appeal_assignments t where t.appeal_id in (select id from public.appeal_intakes where (target_kind in('subject','claimed-subject') and target_id=p_subject) or appellant_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.correction_requests'::text store_name,jsonb_build_object('id',t.id) row_key from public.correction_requests t where t.subject_id=p_subject or t.claimant_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.correction_working_data'::text store_name,jsonb_build_object('id',t.id) row_key from public.correction_working_data t where t.correction_id in (select id from public.correction_requests where subject_id=p_subject or claimant_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.correction_assignments'::text store_name,jsonb_build_object('id',t.id) row_key from public.correction_assignments t where t.correction_id in (select id from public.correction_requests where subject_id=p_subject or claimant_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'appeal-and-correction-working-packages'::text target_id,'public.legal_reviews'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_reviews t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject)
 union all
 select 'audit-principal-link-key-envelope'::text target_id,'public.audit_principal_links'::text store_name,jsonb_build_object('audit_principal_id',t.audit_principal_id) row_key from public.audit_principal_links t where t.audit_principal_id=p_audit
 union all
 select 'audit-principal-link-key-envelope'::text target_id,'public.audit_principal_link_keys'::text store_name,jsonb_build_object('audit_principal_id',t.audit_principal_id) row_key from public.audit_principal_link_keys t where t.audit_principal_id=p_audit
 union all
 select 'chat-derived-contexts'::text target_id,'public.chat_messages'::text store_name,jsonb_build_object('id',t.id) row_key from public.chat_messages t where t.chat_id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or (t.chat_id,t.turn_id) in (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids))
 union all
 select 'chat-derived-contexts'::text target_id,'public.chats'::text store_name,jsonb_build_object('id',t.id) row_key from public.chats t where t.id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject)
 union all
 select 'chat-derived-contexts'::text target_id,'public.copilot_context_tokens'::text store_name,jsonb_build_object('id',t.id) row_key from public.copilot_context_tokens t where (t.scope_kind='subject' and t.target_id=p_subject) or t.chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z))
 union all
 select 'chat-derived-contexts'::text target_id,'public.copilot_context_history'::text store_name,jsonb_build_object('id',t.id) row_key from public.copilot_context_history t where t.chat_id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or (t.chat_id,t.turn_id) in (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids))
 union all
 select 'chat-derived-contexts'::text target_id,'public.copilot_turn_dependencies'::text store_name,jsonb_build_object('chat_id',t.chat_id,'turn_id',t.turn_id,'dependency_kind',t.dependency_kind,'dependency_id',t.dependency_id) row_key from public.copilot_turn_dependencies t where t.chat_id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or (t.chat_id,t.turn_id) in (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids))
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claims'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claims t where t.embryo_id=p_embryo
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claim_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_sessions t where t.embryo_id=p_embryo
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claim_documents'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_documents t where t.claim_id in (select id from public.future_person_claims where embryo_id=p_embryo)
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claim_review_packages'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_review_packages t where t.claim_id in (select id from public.future_person_claims where embryo_id=p_embryo)
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claim_assignments'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_assignments t where t.claim_id in (select id from public.future_person_claims where embryo_id=p_embryo)
 union all
 select 'claim-review-working-packages'::text target_id,'public.future_person_claim_objections'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_objections t where t.claim_id in (select id from public.future_person_claims where embryo_id=p_embryo)
 union all
 select 'claim-review-working-packages'::text target_id,'private.future_person_claim_intakes'::text store_name,jsonb_build_object('id',t.id) row_key from private.future_person_claim_intakes t where t.id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_documents'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_documents t where t.intake_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_reviews'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_reviews t where t.id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_assignments'::text store_name,jsonb_build_object('review_id',t.review_id,'reviewer_account_id',t.reviewer_account_id,'assignment_revision',t.assignment_revision) row_key from private.claim_review_assignments t where t.review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_reads'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_review_reads t where t.review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_decisions'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_review_decisions t where t.review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_downloads'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_review_downloads t where t.review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_receipt_sessions'::text store_name,jsonb_build_object('download_id',t.download_id,'nonce_hash',t.nonce_hash) row_key from private.claim_review_receipt_sessions t where t.download_id in (select id from private.claim_review_downloads where review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo)))
 union all
 select 'claim-review-working-packages'::text target_id,'private.claim_review_chunk_receipts'::text store_name,jsonb_build_object('download_id',t.download_id,'sequence',t.sequence) row_key from private.claim_review_chunk_receipts t where t.download_id in (select id from private.claim_review_downloads where review_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo)))
 union all
 select 'claimant-reverification-authority'::text target_id,'public.future_person_claimant_principals'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claimant_principals t where t.id=p_claimant
 union all
 select 'claimant-reverification-authority'::text target_id,'public.future_person_claimant_identity_hmacs'::text store_name,jsonb_build_object('claimant_principal_id',t.claimant_principal_id,'hmac_key_revision',t.hmac_key_revision) row_key from public.future_person_claimant_identity_hmacs t where t.claimant_principal_id=p_claimant
 union all
 select 'claimant-reverification-authority'::text target_id,'public.future_person_recovery_key_hashes'::text store_name,jsonb_build_object('claimant_principal_id',t.claimant_principal_id) row_key from public.future_person_recovery_key_hashes t where t.claimant_principal_id=p_claimant
 union all
 select 'cloud-provider-working-state'::text target_id,'public.cloud_provider_payloads'::text store_name,jsonb_build_object('id',t.id) row_key from public.cloud_provider_payloads t where t.cloud_model_call_id in (select id from public.cloud_model_calls where model_context_id in (select id from public.model_contexts where generation_session_id in (select id from public.copilot_generation_sessions where chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z)))))
 union all
 select 'cloud-provider-working-state'::text target_id,'public.cloud_provider_attempts'::text store_name,jsonb_build_object('id',t.id) row_key from public.cloud_provider_attempts t where t.cloud_model_call_id in (select id from public.cloud_model_calls where model_context_id in (select id from public.model_contexts where generation_session_id in (select id from public.copilot_generation_sessions where chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z)))))
 union all
 select 'cloud-provider-working-state'::text target_id,'public.cloud_model_calls'::text store_name,jsonb_build_object('id',t.id) row_key from public.cloud_model_calls t where t.id in (select id from public.cloud_model_calls where model_context_id in (select id from public.model_contexts where generation_session_id in (select id from public.copilot_generation_sessions where chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z)))))
 union all
 select 'contact-refusal-and-rate-limit-state'::text target_id,'public.encrypted_contact_references'::text store_name,jsonb_build_object('id',t.id) row_key from public.encrypted_contact_references t where t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'contact-refusal-and-rate-limit-state'::text target_id,'public.contact_hmac_indexes'::text store_name,jsonb_build_object('contact_reference_id',t.contact_reference_id,'hmac_key_revision',t.hmac_key_revision) row_key from public.contact_hmac_indexes t where t.contact_reference_id in (select id from public.encrypted_contact_references where principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'contact-refusal-and-rate-limit-state'::text target_id,'public.subject_control_refusal_authorities'::text store_name,jsonb_build_object('id',t.id) row_key from public.subject_control_refusal_authorities t where t.subject_id=p_subject or t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'disposition-proposals-and-transient-authority'::text target_id,'public.embryo_disposition_proposals'::text store_name,jsonb_build_object('id',t.id) row_key from public.embryo_disposition_proposals t where t.embryo_id=p_embryo
 union all
 select 'disposition-proposals-and-transient-authority'::text target_id,'public.embryo_disposition_confirmations'::text store_name,jsonb_build_object('proposal_id',t.proposal_id,'confirmer_principal_id',t.confirmer_principal_id) row_key from public.embryo_disposition_confirmations t where t.proposal_id in (select id from public.embryo_disposition_proposals where embryo_id=p_embryo)
 union all
 select 'disposition-proposals-and-transient-authority'::text target_id,'public.retention_notice_campaigns'::text store_name,jsonb_build_object('id',t.id) row_key from public.retention_notice_campaigns t where t.retention_row_id in (select id from public.retention_rows where ((target_kind='subject' and target_id=p_subject) or (target_kind='claim' and target_id=p_claimant and retention_id='future-person.claimed-unbound-24mo')) and retention_id<>'future-person.claimant-reverification-until-request')
 union all
 select 'drafts-invitations-and-candidates'::text target_id,'public.adult_subject_drafts'::text store_name,jsonb_build_object('id',t.id) row_key from public.adult_subject_drafts t where t.subject_id=p_subject
 union all
 select 'drafts-invitations-and-candidates'::text target_id,'public.subject_invitations'::text store_name,jsonb_build_object('id',t.id) row_key from public.subject_invitations t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.inviter_principal_id in (select id from public.subject_principals where subject_id=p_subject) or t.invitee_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'drafts-invitations-and-candidates'::text target_id,'public.invitation_candidates'::text store_name,jsonb_build_object('id',t.id) row_key from public.invitation_candidates t where t.invitation_id in (select id from public.subject_invitations where (target_kind in('subject','claimed-subject') and target_id=p_subject) or inviter_principal_id in (select id from public.subject_principals where subject_id=p_subject) or invitee_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'drafts-invitations-and-candidates'::text target_id,'public.invitation_reminders'::text store_name,jsonb_build_object('id',t.id) row_key from public.invitation_reminders t where t.invitation_id in (select id from public.subject_invitations where (target_kind in('subject','claimed-subject') and target_id=p_subject) or inviter_principal_id in (select id from public.subject_principals where subject_id=p_subject) or invitee_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'drafts-invitations-and-candidates'::text target_id,'public.draft_participant_slots'::text store_name,jsonb_build_object('id',t.id) row_key from public.draft_participant_slots t where t.adult_draft_id in (select id from public.adult_subject_drafts where subject_id=p_subject)
 union all
 select 'embryo-figures'::text target_id,'public.embryo_figures'::text store_name,jsonb_build_object('id',t.id) row_key from public.embryo_figures t where t.finding_id in (select id from public.embryo_scores where embryo_id=p_embryo)
 union all
 select 'embryo-projections'::text target_id,'public.embryos'::text store_name,jsonb_build_object('id',t.id) row_key from public.embryos t where t.id=p_embryo
 union all
 select 'embryo-qc'::text target_id,'public.embryo_qc'::text store_name,jsonb_build_object('embryo_id',t.embryo_id) row_key from public.embryo_qc t where t.embryo_id=p_embryo
 union all
 select 'embryo-scores'::text target_id,'public.embryo_scores'::text store_name,jsonb_build_object('id',t.id) row_key from public.embryo_scores t where t.embryo_id=p_embryo
 union all
 select 'future-person-identity-profiles'::text target_id,'public.future_person_identity'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_identity t where t.embryo_id=p_embryo
 union all
 select 'generated-artifacts'::text target_id,'public.report_artifacts'::text store_name,jsonb_build_object('id',t.id) row_key from public.report_artifacts t where t.subject_id=p_subject
 union all
 select 'generated-artifacts'::text target_id,'public.generated_exports'::text store_name,jsonb_build_object('id',t.id) row_key from public.generated_exports t where t.id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject)
 union all
 select 'generated-artifacts'::text target_id,'public.download_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.download_sessions t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'generated-artifacts'::text target_id,'public.model_contexts'::text store_name,jsonb_build_object('id',t.id) row_key from public.model_contexts t where t.id in (select id from public.model_contexts where generation_session_id in (select id from public.copilot_generation_sessions where chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z))))
 union all
 select 'generated-artifacts'::text target_id,'private.own_analysis_runs'::text store_name,jsonb_build_object('id',t.id) row_key from private.own_analysis_runs t where t.subject_id=p_subject or t.file_id=p_file
 union all
 select 'genome-files'::text target_id,'public.genome_files'::text store_name,jsonb_build_object('id',t.id) row_key from public.genome_files t where t.id=p_file
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_ingest_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_evidence_ingest_sessions t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_fragments'::text store_name,jsonb_build_object('session_id',t.session_id,'fragment_ordinal',t.fragment_ordinal) row_key from public.legal_evidence_fragments t where t.session_id in (select id from public.legal_evidence_ingest_sessions where (target_kind in('subject','claimed-subject') and target_id=p_subject) or principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_documents'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_evidence_documents t where t.session_id in (select id from public.legal_evidence_ingest_sessions where (target_kind in('subject','claimed-subject') and target_id=p_subject) or principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_review_copies'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_evidence_review_copies t where t.document_id in (select id from public.legal_evidence_documents where session_id in (select id from public.legal_evidence_ingest_sessions where (target_kind in('subject','claimed-subject') and target_id=p_subject) or principal_id in (select id from public.subject_principals where subject_id=p_subject)))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_assignments'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_evidence_assignments t where t.document_id in (select id from public.legal_evidence_documents where session_id in (select id from public.legal_evidence_ingest_sessions where (target_kind in('subject','claimed-subject') and target_id=p_subject) or principal_id in (select id from public.subject_principals where subject_id=p_subject)))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'public.legal_evidence_working_data'::text store_name,jsonb_build_object('id',t.id) row_key from public.legal_evidence_working_data t where t.document_id in (select id from public.legal_evidence_documents where session_id in (select id from public.legal_evidence_ingest_sessions where (target_kind in('subject','claimed-subject') and target_id=p_subject) or principal_id in (select id from public.subject_principals where subject_id=p_subject)))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'private.claim_document_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from private.claim_document_sessions t where t.intake_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo))
 union all
 select 'legal-evidence-working-and-private-objects'::text target_id,'private.claim_document_fragments'::text store_name,jsonb_build_object('session_id',t.session_id,'sequence',t.sequence) row_key from private.claim_document_fragments t where t.session_id in (select id from private.claim_document_sessions where intake_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo)))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.mail_outbox'::text store_name,jsonb_build_object('id',t.id) row_key from public.mail_outbox t where t.id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.mail_deliveries'::text store_name,jsonb_build_object('id',t.id) row_key from public.mail_deliveries t where t.outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.mail_provider_attempts'::text store_name,jsonb_build_object('id',t.id) row_key from public.mail_provider_attempts t where t.outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.token_hashes'::text store_name,jsonb_build_object('id',t.id) row_key from public.token_hashes t where t.id in (select id from public.token_hashes where candidate_id in (select id from public.token_candidates where outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject))))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.token_candidates'::text store_name,jsonb_build_object('id',t.id) row_key from public.token_candidates t where t.id in (select id from public.token_candidates where outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject)))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.rights_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.rights_sessions t where t.id in (select id from public.rights_sessions where principal_id in (select id from public.subject_principals where subject_id=p_subject) or (target_kind='claimed-subject' and target_id=p_subject) or token_hash_id in (select id from public.token_hashes where candidate_id in (select id from public.token_candidates where outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject)))))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.rights_nonces'::text store_name,jsonb_build_object('rights_session_id',t.rights_session_id,'nonce_revision',t.nonce_revision) row_key from public.rights_nonces t where t.rights_session_id in (select id from public.rights_sessions where principal_id in (select id from public.subject_principals where subject_id=p_subject) or (target_kind='claimed-subject' and target_id=p_subject) or token_hash_id in (select id from public.token_hashes where candidate_id in (select id from public.token_candidates where outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject)))))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.future_person_claim_notices'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_notices t where t.claim_id in (select id from public.future_person_claims where embryo_id=p_embryo) or t.outbox_id in (select id from public.mail_outbox where (target_kind in('subject','claimed-subject') and target_id=p_subject) or recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject))
 union all
 select 'mail-token-and-rights-delivery-state'::text target_id,'public.future_person_claim_release_credentials'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_claim_release_credentials t where t.claimant_principal_id=p_claimant or t.subject_id=p_subject
 union all
 select 'polygenic-results'::text target_id,'public.user_prs'::text store_name,jsonb_build_object('id',t.id) row_key from public.user_prs t where t.subject_id=p_subject or t.file_id=p_file
 union all
 select 'portrait-pair-results'::text target_id,'public.portrait_results'::text store_name,jsonb_build_object('id',t.id) row_key from public.portrait_results t where t.parent_a_subject_id=p_subject or t.parent_b_subject_id=p_subject
 union all
 select 'record-key-authority'::text target_id,'public.future_person_record_key_hashes'::text store_name,jsonb_build_object('embryo_id',t.embryo_id,'recipient_principal_id',t.recipient_principal_id,'recipient_set_revision',t.recipient_set_revision,'key_revision',t.key_revision) row_key from public.future_person_record_key_hashes t where t.embryo_id=p_embryo
 union all
 select 'record-key-authority'::text target_id,'public.future_person_record_key_print_rights'::text store_name,jsonb_build_object('id',t.id) row_key from public.future_person_record_key_print_rights t where t.embryo_id=p_embryo
 union all
 select 'result-suppressions'::text target_id,'public.suppressions'::text store_name,jsonb_build_object('id',t.id) row_key from public.suppressions t where t.subject_id=p_subject
 union all
 select 'storage-objects'::text target_id,'storage.objects'::text store_name,jsonb_build_object('id',t.id,'bucket_id',t.bucket_id,'name',t.name) row_key from storage.objects t where t.bucket_id='future-person-identity' and t.name in (select object_key from private.claim_documents where intake_id in (select id from private.claim_reviews where matched_embryo_id=p_embryo or matched_claimant_principal_id=p_claimant or id in (select id from public.future_person_claims where embryo_id=p_embryo)))
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.subject_consents'::text store_name,jsonb_build_object('id',t.id) row_key from public.subject_consents t where t.subject_id=p_subject
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.consent_signatures'::text store_name,jsonb_build_object('id',t.id) row_key from public.consent_signatures t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.signer_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.attestations'::text store_name,jsonb_build_object('id',t.id) row_key from public.attestations t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.attestation_contradictions'::text store_name,jsonb_build_object('id',t.id) row_key from public.attestation_contradictions t where t.subject_id=p_subject or t.principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.purpose_grants'::text store_name,jsonb_build_object('grant_id',t.grant_id) row_key from public.purpose_grants t where (t.target_kind in('subject','claimed-subject') and t.target_id=p_subject) or t.signer_principal_id in (select id from public.subject_principals where subject_id=p_subject) or t.data_subject_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.directional_grants'::text store_name,jsonb_build_object('grant_id',t.grant_id,'grant_revision',t.grant_revision) row_key from public.directional_grants t where t.recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject) or t.grant_id in (select grant_id from public.purpose_grants where target_kind='subject' and target_id=p_subject)
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.subject_principals'::text store_name,jsonb_build_object('id',t.id) row_key from public.subject_principals t where t.subject_id=p_subject
 union all
 select 'subject-bound-authority-and-lifecycle-terminalization'::text target_id,'public.subjects'::text store_name,jsonb_build_object('id',t.id) row_key from public.subjects t where t.id=p_subject
 union all
 select 'subject-demographics'::text target_id,'public.subject_demographics'::text store_name,jsonb_build_object('subject_id',t.subject_id) row_key from public.subject_demographics t where t.subject_id=p_subject
 union all
 select 'subject-relationships'::text target_id,'public.subject_relationships'::text store_name,jsonb_build_object('id',t.id) row_key from public.subject_relationships t where t.subject_id=p_subject or t.data_subject_principal_id in (select id from public.subject_principals where subject_id=p_subject) or t.recipient_principal_id in (select id from public.subject_principals where subject_id=p_subject)
 union all
 select 'upload-and-ingest-working-state'::text target_id,'public.upload_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.upload_sessions t where t.subject_id=p_subject or t.finalized_file_id=p_file
 union all
 select 'upload-and-ingest-working-state'::text target_id,'public.upload_chunks'::text store_name,jsonb_build_object('upload_session_id',t.upload_session_id,'chunk_ordinal',t.chunk_ordinal) row_key from public.upload_chunks t where t.upload_session_id in (select id from public.upload_sessions where subject_id=p_subject or finalized_file_id=p_file)
 union all
 select 'upload-and-ingest-working-state'::text target_id,'public.upload_staging_objects'::text store_name,jsonb_build_object('object_id',t.object_id) row_key from public.upload_staging_objects t where t.upload_session_id in (select id from public.upload_sessions where subject_id=p_subject or finalized_file_id=p_file)
 union all
 select 'upload-and-ingest-working-state'::text target_id,'public.pending_source_rows'::text store_name,jsonb_build_object('id',t.id) row_key from public.pending_source_rows t where t.subject_id=p_subject or t.worker_job_id in (select id from public.worker_jobs where subject_id=p_subject or file_id=p_file)
 union all
 select 'variant-rows'::text target_id,'public.user_variants'::text store_name,jsonb_build_object('id',t.id) row_key from public.user_variants t where t.subject_id=p_subject or t.file_id=p_file
 union all
 select 'variant-rows'::text target_id,'public.embryo_variants'::text store_name,jsonb_build_object('id',t.id) row_key from public.embryo_variants t where t.embryo_id=p_embryo or t.source_file_id=p_file
 union all
 select 'variant-rows'::text target_id,'public.report_observed_calls'::text store_name,jsonb_build_object('file_id',t.file_id,'source_line',t.source_line) row_key from public.report_observed_calls t where t.file_id=p_file or t.subject_id=p_subject
 union all
 select 'variant-rows'::text target_id,'private.own_preparation_jobs'::text store_name,jsonb_build_object('id',t.id) row_key from private.own_preparation_jobs t where t.subject_id=p_subject or t.file_id=p_file
 union all
 select 'variant-rows'::text target_id,'private.embryo_canonical_source_parts'::text store_name,jsonb_build_object('file_id',t.file_id,'part_id',t.part_id) row_key from private.embryo_canonical_source_parts t where t.file_id=p_file
 union all
 select 'variant-rows'::text target_id,'private.embryo_canonical_sources'::text store_name,jsonb_build_object('file_id',t.file_id) row_key from private.embryo_canonical_sources t where t.file_id=p_file
 union all
 select 'variant-rows'::text target_id,'private.embryo_canonical_parts'::text store_name,jsonb_build_object('id',t.id) row_key from private.embryo_canonical_parts t where t.id in (select part_id from private.embryo_canonical_source_parts where file_id=p_file)
 union all
 select 'variant-rows'::text target_id,'private.future_person_custody_slices'::text store_name,jsonb_build_object('subject_id',t.subject_id) row_key from private.future_person_custody_slices t where t.subject_id=p_subject
 union all
 select 'worker-and-model-working-state'::text target_id,'public.worker_jobs'::text store_name,jsonb_build_object('id',t.id) row_key from public.worker_jobs t where t.id in (select id from public.worker_jobs where subject_id=p_subject or file_id=p_file)
 union all
 select 'worker-and-model-working-state'::text target_id,'public.worker_job_batches'::text store_name,jsonb_build_object('worker_job_id',t.worker_job_id,'batch_ordinal',t.batch_ordinal) row_key from public.worker_job_batches t where t.worker_job_id in (select id from public.worker_jobs where subject_id=p_subject or file_id=p_file)
 union all
 select 'worker-and-model-working-state'::text target_id,'public.analysis_jobs'::text store_name,jsonb_build_object('id',t.id) row_key from public.analysis_jobs t where t.worker_job_id in (select id from public.worker_jobs where subject_id=p_subject or file_id=p_file)
 union all
 select 'worker-and-model-working-state'::text target_id,'public.copilot_generation_sessions'::text store_name,jsonb_build_object('id',t.id) row_key from public.copilot_generation_sessions t where t.id in (select id from public.copilot_generation_sessions where chat_id in (select id from public.chats where id in (select id from public.chats where scope_kind='subject' and subject_id=p_subject) or id in (select chat_id from (select distinct chat_id,turn_id from public.chat_messages where p_subject=any(retrieved_subject_ids) union select distinct chat_id,turn_id from public.copilot_context_history where p_subject=any(retrieved_subject_ids)) z)))
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_jobs'::text store_name,jsonb_build_object('export_id',t.export_id) row_key from private.export_archive_jobs t where t.export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject)
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_attempts'::text store_name,jsonb_build_object('id',t.id) row_key from private.export_archive_attempts t where t.export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject)
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_downloads'::text store_name,jsonb_build_object('id',t.id) row_key from private.export_archive_downloads t where t.export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject)
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_manifest_pages'::text store_name,jsonb_build_object('attempt_id',t.attempt_id,'page',t.page) row_key from private.export_archive_manifest_pages t where t.attempt_id in (select id from private.export_archive_attempts where export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject))
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_segments'::text store_name,jsonb_build_object('attempt_id',t.attempt_id,'ordinal',t.ordinal) row_key from private.export_archive_segments t where t.attempt_id in (select id from private.export_archive_attempts where export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject))
 union all
 select 'generated-artifacts'::text target_id,'private.export_archive_nonce_uses'::text store_name,jsonb_build_object('nonce_hash',t.nonce_hash) row_key from private.export_archive_nonce_uses t where t.export_id in (select id from public.generated_exports where target_kind='subject' and target_id=p_subject);
end $$;
revoke all on function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;


-- A closed PK operation used only by the sealed graph executor. Even trusted
-- service transports cannot supply a relation, predicate, handle or body.
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_store text;v_keys text[];v_count bigint;v_join text;
begin
 case p_store
 when 'public.ancestry_regions' then v_store:='public.ancestry_regions';v_keys:=array['ancestry_result_id','region_code'];
 when 'public.ancestry_results' then v_store:='public.ancestry_results';v_keys:=array['id'];
 when 'public.appeal_intakes' then v_store:='public.appeal_intakes';v_keys:=array['id'];
 when 'public.appeal_evidence' then v_store:='public.appeal_evidence';v_keys:=array['id'];
 when 'public.appeal_assignments' then v_store:='public.appeal_assignments';v_keys:=array['id'];
 when 'public.correction_requests' then v_store:='public.correction_requests';v_keys:=array['id'];
 when 'public.correction_working_data' then v_store:='public.correction_working_data';v_keys:=array['id'];
 when 'public.correction_assignments' then v_store:='public.correction_assignments';v_keys:=array['id'];
 when 'public.legal_reviews' then v_store:='public.legal_reviews';v_keys:=array['id'];
 when 'public.audit_principal_links' then v_store:='public.audit_principal_links';v_keys:=array['audit_principal_id'];
 when 'public.audit_principal_link_keys' then v_store:='public.audit_principal_link_keys';v_keys:=array['audit_principal_id'];
 when 'public.chat_messages' then v_store:='public.chat_messages';v_keys:=array['id'];
 when 'public.chats' then v_store:='public.chats';v_keys:=array['id'];
 when 'public.copilot_context_tokens' then v_store:='public.copilot_context_tokens';v_keys:=array['id'];
 when 'public.copilot_context_history' then v_store:='public.copilot_context_history';v_keys:=array['id'];
 when 'public.copilot_turn_dependencies' then v_store:='public.copilot_turn_dependencies';v_keys:=array['chat_id','turn_id','dependency_kind','dependency_id'];
 when 'public.future_person_claims' then v_store:='public.future_person_claims';v_keys:=array['id'];
 when 'public.future_person_claim_sessions' then v_store:='public.future_person_claim_sessions';v_keys:=array['id'];
 when 'public.future_person_claim_documents' then v_store:='public.future_person_claim_documents';v_keys:=array['id'];
 when 'public.future_person_claim_review_packages' then v_store:='public.future_person_claim_review_packages';v_keys:=array['id'];
 when 'public.future_person_claim_assignments' then v_store:='public.future_person_claim_assignments';v_keys:=array['id'];
 when 'public.future_person_claim_objections' then v_store:='public.future_person_claim_objections';v_keys:=array['id'];
 when 'private.future_person_claim_intakes' then v_store:='private.future_person_claim_intakes';v_keys:=array['id'];
 when 'private.claim_documents' then v_store:='private.claim_documents';v_keys:=array['id'];
 when 'private.claim_reviews' then v_store:='private.claim_reviews';v_keys:=array['id'];
 when 'private.claim_review_assignments' then v_store:='private.claim_review_assignments';v_keys:=array['review_id','reviewer_account_id','assignment_revision'];
 when 'private.claim_review_reads' then v_store:='private.claim_review_reads';v_keys:=array['id'];
 when 'private.claim_review_decisions' then v_store:='private.claim_review_decisions';v_keys:=array['id'];
 when 'private.claim_review_downloads' then v_store:='private.claim_review_downloads';v_keys:=array['id'];
 when 'private.claim_review_receipt_sessions' then v_store:='private.claim_review_receipt_sessions';v_keys:=array['download_id','nonce_hash'];
 when 'private.claim_review_chunk_receipts' then v_store:='private.claim_review_chunk_receipts';v_keys:=array['download_id','sequence'];
 when 'public.future_person_claimant_principals' then v_store:='public.future_person_claimant_principals';v_keys:=array['id'];
 when 'public.future_person_claimant_identity_hmacs' then v_store:='public.future_person_claimant_identity_hmacs';v_keys:=array['claimant_principal_id','hmac_key_revision'];
 when 'public.future_person_recovery_key_hashes' then v_store:='public.future_person_recovery_key_hashes';v_keys:=array['claimant_principal_id'];
 when 'public.cloud_provider_payloads' then v_store:='public.cloud_provider_payloads';v_keys:=array['id'];
 when 'public.cloud_provider_attempts' then v_store:='public.cloud_provider_attempts';v_keys:=array['id'];
 when 'public.cloud_model_calls' then v_store:='public.cloud_model_calls';v_keys:=array['id'];
 when 'public.encrypted_contact_references' then v_store:='public.encrypted_contact_references';v_keys:=array['id'];
 when 'public.contact_hmac_indexes' then v_store:='public.contact_hmac_indexes';v_keys:=array['contact_reference_id','hmac_key_revision'];
 when 'public.subject_control_refusal_authorities' then v_store:='public.subject_control_refusal_authorities';v_keys:=array['id'];
 when 'public.embryo_disposition_proposals' then v_store:='public.embryo_disposition_proposals';v_keys:=array['id'];
 when 'public.embryo_disposition_confirmations' then v_store:='public.embryo_disposition_confirmations';v_keys:=array['proposal_id','confirmer_principal_id'];
 when 'public.retention_notice_campaigns' then v_store:='public.retention_notice_campaigns';v_keys:=array['id'];
 when 'public.adult_subject_drafts' then v_store:='public.adult_subject_drafts';v_keys:=array['id'];
 when 'public.subject_invitations' then v_store:='public.subject_invitations';v_keys:=array['id'];
 when 'public.invitation_candidates' then v_store:='public.invitation_candidates';v_keys:=array['id'];
 when 'public.invitation_reminders' then v_store:='public.invitation_reminders';v_keys:=array['id'];
 when 'public.draft_participant_slots' then v_store:='public.draft_participant_slots';v_keys:=array['id'];
 when 'public.embryo_figures' then v_store:='public.embryo_figures';v_keys:=array['id'];
 when 'public.embryos' then v_store:='public.embryos';v_keys:=array['id'];
 when 'public.embryo_qc' then v_store:='public.embryo_qc';v_keys:=array['embryo_id'];
 when 'public.embryo_scores' then v_store:='public.embryo_scores';v_keys:=array['id'];
 when 'public.future_person_identity' then v_store:='public.future_person_identity';v_keys:=array['id'];
 when 'public.report_artifacts' then v_store:='public.report_artifacts';v_keys:=array['id'];
 when 'public.generated_exports' then v_store:='public.generated_exports';v_keys:=array['id'];
 when 'public.download_sessions' then v_store:='public.download_sessions';v_keys:=array['id'];
 when 'public.model_contexts' then v_store:='public.model_contexts';v_keys:=array['id'];
 when 'private.own_analysis_runs' then v_store:='private.own_analysis_runs';v_keys:=array['id'];
 when 'public.genome_files' then v_store:='public.genome_files';v_keys:=array['id'];
 when 'public.legal_evidence_ingest_sessions' then v_store:='public.legal_evidence_ingest_sessions';v_keys:=array['id'];
 when 'public.legal_evidence_fragments' then v_store:='public.legal_evidence_fragments';v_keys:=array['session_id','fragment_ordinal'];
 when 'public.legal_evidence_documents' then v_store:='public.legal_evidence_documents';v_keys:=array['id'];
 when 'public.legal_evidence_review_copies' then v_store:='public.legal_evidence_review_copies';v_keys:=array['id'];
 when 'public.legal_evidence_assignments' then v_store:='public.legal_evidence_assignments';v_keys:=array['id'];
 when 'public.legal_evidence_working_data' then v_store:='public.legal_evidence_working_data';v_keys:=array['id'];
 when 'private.claim_document_sessions' then v_store:='private.claim_document_sessions';v_keys:=array['id'];
 when 'private.claim_document_fragments' then v_store:='private.claim_document_fragments';v_keys:=array['session_id','sequence'];
 when 'public.mail_outbox' then v_store:='public.mail_outbox';v_keys:=array['id'];
 when 'public.mail_deliveries' then v_store:='public.mail_deliveries';v_keys:=array['id'];
 when 'public.mail_provider_attempts' then v_store:='public.mail_provider_attempts';v_keys:=array['id'];
 when 'public.token_hashes' then v_store:='public.token_hashes';v_keys:=array['id'];
 when 'public.token_candidates' then v_store:='public.token_candidates';v_keys:=array['id'];
 when 'public.rights_sessions' then v_store:='public.rights_sessions';v_keys:=array['id'];
 when 'public.rights_nonces' then v_store:='public.rights_nonces';v_keys:=array['rights_session_id','nonce_revision'];
 when 'public.future_person_claim_notices' then v_store:='public.future_person_claim_notices';v_keys:=array['id'];
 when 'public.future_person_claim_release_credentials' then v_store:='public.future_person_claim_release_credentials';v_keys:=array['id'];
 when 'public.user_prs' then v_store:='public.user_prs';v_keys:=array['id'];
 when 'public.portrait_results' then v_store:='public.portrait_results';v_keys:=array['id'];
 when 'public.future_person_record_key_hashes' then v_store:='public.future_person_record_key_hashes';v_keys:=array['embryo_id','recipient_principal_id','recipient_set_revision','key_revision'];
 when 'public.future_person_record_key_print_rights' then v_store:='public.future_person_record_key_print_rights';v_keys:=array['id'];
 when 'public.suppressions' then v_store:='public.suppressions';v_keys:=array['id'];
 when 'storage.objects' then v_store:='storage.objects';v_keys:=array['id','bucket_id','name'];
 when 'public.subject_consents' then v_store:='public.subject_consents';v_keys:=array['id'];
 when 'public.consent_signatures' then v_store:='public.consent_signatures';v_keys:=array['id'];
 when 'public.attestations' then v_store:='public.attestations';v_keys:=array['id'];
 when 'public.attestation_contradictions' then v_store:='public.attestation_contradictions';v_keys:=array['id'];
 when 'public.purpose_grants' then v_store:='public.purpose_grants';v_keys:=array['grant_id'];
 when 'public.directional_grants' then v_store:='public.directional_grants';v_keys:=array['grant_id','grant_revision'];
 when 'public.subject_principals' then v_store:='public.subject_principals';v_keys:=array['id'];
 when 'public.subjects' then v_store:='public.subjects';v_keys:=array['id'];
 when 'public.subject_demographics' then v_store:='public.subject_demographics';v_keys:=array['subject_id'];
 when 'public.subject_relationships' then v_store:='public.subject_relationships';v_keys:=array['id'];
 when 'public.upload_sessions' then v_store:='public.upload_sessions';v_keys:=array['id'];
 when 'public.upload_chunks' then v_store:='public.upload_chunks';v_keys:=array['upload_session_id','chunk_ordinal'];
 when 'public.upload_staging_objects' then v_store:='public.upload_staging_objects';v_keys:=array['object_id'];
 when 'public.pending_source_rows' then v_store:='public.pending_source_rows';v_keys:=array['id'];
 when 'public.user_variants' then v_store:='public.user_variants';v_keys:=array['id'];
 when 'public.embryo_variants' then v_store:='public.embryo_variants';v_keys:=array['id'];
 when 'public.report_observed_calls' then v_store:='public.report_observed_calls';v_keys:=array['file_id','source_line'];
 when 'private.own_preparation_jobs' then v_store:='private.own_preparation_jobs';v_keys:=array['id'];
 when 'private.embryo_canonical_source_parts' then v_store:='private.embryo_canonical_source_parts';v_keys:=array['file_id','part_id'];
 when 'private.embryo_canonical_sources' then v_store:='private.embryo_canonical_sources';v_keys:=array['file_id'];
 when 'private.embryo_canonical_parts' then v_store:='private.embryo_canonical_parts';v_keys:=array['id'];
 when 'private.future_person_custody_slices' then v_store:='private.future_person_custody_slices';v_keys:=array['subject_id'];
 when 'public.worker_jobs' then v_store:='public.worker_jobs';v_keys:=array['id'];
 when 'public.worker_job_batches' then v_store:='public.worker_job_batches';v_keys:=array['worker_job_id','batch_ordinal'];
 when 'public.analysis_jobs' then v_store:='public.analysis_jobs';v_keys:=array['id'];
 when 'public.copilot_generation_sessions' then v_store:='public.copilot_generation_sessions';v_keys:=array['id'];
 when 'private.export_archive_jobs' then v_store:='private.export_archive_jobs';v_keys:=array['export_id'];
 when 'private.export_archive_attempts' then v_store:='private.export_archive_attempts';v_keys:=array['id'];
 when 'private.export_archive_downloads' then v_store:='private.export_archive_downloads';v_keys:=array['id'];
 when 'private.export_archive_manifest_pages' then v_store:='private.export_archive_manifest_pages';v_keys:=array['attempt_id','page'];
 when 'private.export_archive_segments' then v_store:='private.export_archive_segments';v_keys:=array['attempt_id','ordinal'];
 when 'private.export_archive_nonce_uses' then v_store:='private.export_archive_nonce_uses';v_keys:=array['nonce_hash'];
 else raise exception using errcode='42501',message='claimant deletion unavailable';end case;
 if p_key is null or jsonb_typeof(p_key)<>'object'
  or (select array_agg(k order by k) from jsonb_object_keys(p_key) k)
   is distinct from (select array_agg(k order by k) from unnest(v_keys) k)
  or exists(select 1 from jsonb_each(p_key) field where field.value='null'::jsonb) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select string_agg(format('t.%I=k.%I',key,key),' and ') into v_join from unnest(v_keys) key;
 -- Typed equality uses the real PK/unique indexes. It neither scans/report-
 -- serializes each body nor accepts a caller-supplied predicate.
 execute format('select count(*) from %s t,jsonb_populate_record(null::%s,$1) k where %s',v_store,v_store,v_join)
  into v_count using p_key;
 if v_count>1 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_delete and v_count=1 then
  -- Storage metadata is deleted only by the real provider API, never SQL.
  if v_store='storage.objects' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  execute format('delete from %s t using jsonb_populate_record(null::%s,$1) k where %s',v_store,v_store,v_join) using p_key;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end if;
 return v_count;
end $$;
revoke all on function private.future_person_deletion_row_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The live catalog is a refusal fence, never an ownership resolver. Every
-- FK child of a frozen row must itself be explicitly selected by a literal
-- predicate, including CASCADE/SET NULL children and newly introduced stores.
-- This prevents a database cascade from deleting a sibling or unclassified
-- body that the closed inventory did not authorize.
create function private.assert_future_person_deletion_fk_closure_v1(p_manifest uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.purge_manifest_entries;fk record;v_join text;v_unclassified boolean;
begin
 for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50 loop
  perform private.future_person_deletion_row_v1(e.store_name,e.row_key,false);
  for fk in select c.oid,c.conkey,c.confkey,c.conrelid,c.confrelid,
    format('%I.%I',n.nspname,r.relname) child_store,
    format('%I.%I',pn.nspname,pr.relname) parent_store
   from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid
    join pg_catalog.pg_namespace n on n.oid=r.relnamespace
    join pg_catalog.pg_class pr on pr.oid=c.confrelid join pg_catalog.pg_namespace pn on pn.oid=pr.relnamespace
   where c.contype='f' and c.confrelid=to_regclass(e.store_name) loop
   select string_agg(format('child.%I=parent.%I',ca.attname,pa.attname),' and ' order by k.i)
    into v_join from generate_subscripts(fk.conkey,1) k(i)
     join pg_catalog.pg_attribute ca on ca.attrelid=fk.conrelid and ca.attnum=fk.conkey[k.i]
     join pg_catalog.pg_attribute pa on pa.attrelid=fk.confrelid and pa.attnum=fk.confkey[k.i];
   execute format('select exists(select 1 from %s child join %s parent on %s
     where to_jsonb(parent) @> $1 and not exists(select 1 from public.purge_manifest_entries allowed
      where allowed.manifest_id=$2 and allowed.entry_revision>50 and allowed.store_name=$3
       and to_jsonb(child) @> allowed.row_key))',fk.child_store,fk.parent_store,v_join)
    into v_unclassified using e.row_key,p_manifest,fk.child_store;
   if v_unclassified then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  end loop;
 end loop;
end $$;
revoke all on function private.assert_future_person_deletion_fk_closure_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.assert_future_person_deletion_graph_v1(p_manifest uuid)
returns void language plpgsql security definer set search_path='' as $$
declare env jsonb;v_embryo uuid;v_audit uuid;g record;e public.purge_manifest_entries;
begin
 select p.immutable_envelope into env from public.purge_manifests m
  join public.retention_due_phases p on p.retention_row_id=m.retention_row_id
   and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
  where m.id=p_manifest and m.phase_id='future-person-claimed-source-disposal';
 select embryo_id into v_embryo from private.embryo_canonical_sources where file_id=(env->>'sourceFileId')::uuid;
 select audit_principal_id into v_audit from private.future_person_custody_slices where subject_id=(env->>'subjectId')::uuid;
 -- Both directions: a new live row cannot slip past the sealed inventory;
 -- disappearance is accepted only after a durable exact disposal ACK.
 for g in select * from private.future_person_deletion_graph_rows_v1((env->>'subjectId')::uuid,
  (env->>'claimantPrincipalId')::uuid,(env->>'sourceFileId')::uuid,v_embryo,v_audit) loop
  if not exists(select 1 from public.purge_manifest_entries q where q.manifest_id=p_manifest and q.entry_revision>50
   and q.target_id=g.purge_target_id and q.store_name=g.physical_store and q.row_key=g.primary_key) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end loop;
 for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50 loop
  if e.object_id is not null or e.status not in('pending','deleted') then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  if private.future_person_deletion_row_v1(e.store_name,e.row_key,false)=0 and e.status<>'deleted' then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end loop;
end $$;
revoke all on function private.assert_future_person_deletion_graph_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.assert_future_person_deletion_plan_v1(p_manifest uuid)
returns public.retention_due_phases language plpgsql security definer set search_path='' as $$
declare m public.purge_manifests; p public.retention_due_phases; r public.retention_rows;
 s public.subjects; v_embryo public.embryos; c private.future_person_custody_slices; x private.embryo_canonical_sources; n bigint;
begin
 -- Resolve without locks, then take the registered subject-first lock order.
 select * into m from public.purge_manifests where id=p_manifest;
 select * into r from public.retention_rows where id=m.retention_row_id;
 select * into s from public.subjects where id=r.target_id for update;
 select * into r from public.retention_rows where id=m.retention_row_id for update;
 select * into m from public.purge_manifests where id=p_manifest for update;
 select * into p from public.retention_due_phases where retention_row_id=r.id
   and phase_id=m.phase_id and phase_revision=m.phase_revision for update;
 select * into c from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=c.source_file_id;
 select * into v_embryo from public.embryos where id=x.embryo_id for update;
 if m.id is null or m.manifest_class<>'complete-retention' or m.state not in('frozen','executing')
   or r.retention_id<>'future-person.claimant-reverification-until-request' or r.target_kind<>'subject' or r.state<>'active'
   or p.phase_id<>'future-person-claimed-source-disposal' or p.status not in('pending','retry','claimed')
   or s.id is null or s.lifecycle<>'claimed_unbound' or s.owner_account_id is not null
   or s.subject_account_id is not null or s.cohort_id is not null or s.analysis_stopped_at is null
   or c.subject_id is null or c.claimant_principal_id is distinct from s.claimant_principal_id
   or x.file_id is null or x.subject_id is distinct from s.id
   or v_embryo.id is null or v_embryo.subject_id is distinct from s.id or v_embryo.cohort_id is not null or v_embryo.status<>'claimed_unbound'
   or r.disposition_revision is distinct from v_embryo.disposition_revision
   or p.disposition_revision is distinct from v_embryo.disposition_revision
   or r.target_lifecycle_revision is distinct from s.lifecycle_revision
   or p.target_lifecycle_revision is distinct from s.lifecycle_revision
   or (c.source_sha256,c.source_membership_sha256,c.publication_revision,c.historical_cohort_id)
     is distinct from (x.source_sha256,x.membership_sha256,x.publication_revision,x.cohort_id)
   or p.immutable_envelope is distinct from jsonb_build_object('version','future-person-deletion-plan-v1',
     'subjectId',s.id,'claimantPrincipalId',c.claimant_principal_id,'sourceFileId',x.file_id,
     'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,
     'publicationRevision',x.publication_revision,'subjectBindingRevision',s.subject_binding_revision,
     'subjectLifecycleRevision',s.lifecycle_revision,'embryoDispositionRevision',v_embryo.disposition_revision,'requestedAt',r.created_at,
     'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days')
   or r.fixed_deadline is distinct from r.created_at+interval '7 days'
   or p.phase_deadline is distinct from r.created_at
   or m.source_binding_fingerprint is distinct from encode(extensions.digest(convert_to(p.immutable_envelope::text,'UTF8'),'sha256'),'hex')
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_subject_custody_v1(s.id);
 perform private.assert_future_person_settled_source_v1(x.file_id);
 select count(*) into n from public.purge_manifest_entries where manifest_id=m.id and entry_revision<=50;
 if n<>x.part_count or n not between 1 and 50 or exists(
   select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision<=50 and
     (e.target_id<>'variant-rows' or e.store_name<>'private.embryo_canonical_parts' or e.object_id is not null
       or e.status not in('pending','deleted') or not exists(
         select 1 from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id
         where b.file_id=x.file_id and b.sequence=e.entry_revision-1 and a.sequence=b.sequence
           and a.state='landed'
           and a.session_id=x.session_id and a.worker_job_id=x.worker_job_id and a.attempt=x.attempt
           and a.sample_ordinal=x.sample_ordinal and e.row_key=to_jsonb(a))))
   or exists(select 1 from private.embryo_canonical_source_parts b where b.file_id=x.file_id and not exists(
     select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision=b.sequence+1
       and e.row_key->>'id'=b.part_id::text))
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_deletion_graph_v1(m.id);
 return p;
end $$;

-- The registered derived.revocation-60s clock is independent of source
-- disposal. Known database-only results disappear in the request transaction;
-- provider-bearing/uncertain results have no fabricated completion door.
create function private.purge_future_person_derived_v1(p_manifest uuid)
returns bigint language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare p public.retention_due_phases;m public.purge_manifests;e public.purge_manifest_entries;
 v_count bigint;v_progress bigint;v_pending bigint;v_total bigint:=0;
 v_stores constant text[]:=array['public.ancestry_regions','public.ancestry_results','public.user_prs',
  'public.portrait_results','public.embryo_figures','public.embryo_qc','public.embryo_scores','public.suppressions',
  'public.chat_messages','public.chats','public.copilot_context_tokens','public.copilot_context_history',
  'public.copilot_turn_dependencies','public.copilot_generation_sessions','public.model_contexts',
  'private.own_analysis_runs','public.report_observed_calls','public.generated_exports',
  'private.export_archive_jobs','private.export_archive_nonce_uses'];
begin
 p:=private.assert_future_person_deletion_plan_v1(p_manifest);
 select * into m from public.purge_manifests where id=p_manifest;
 if m.state<>'frozen' or m.physical_purge_started_at is not null or p.claim_token_hash is not null
  or p.claim_expires_at is not null then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);
 -- An admitted provider operation cannot become absent by deleting its SQL
 -- reservation. Refuse the whole request before promising immediate cleanup.
 if exists(select 1 from public.purge_manifest_entries candidate where candidate.manifest_id=p_manifest and candidate.entry_revision>50
  and candidate.store_name in('public.report_artifacts','public.cloud_model_calls','public.cloud_provider_attempts',
   'public.cloud_provider_payloads','private.export_archive_attempts','private.export_archive_segments',
   'private.export_archive_downloads','private.export_archive_manifest_pages')) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 loop
  v_progress:=0;
  for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50
   and store_name=any(v_stores) order by case store_name when 'private.export_archive_nonce_uses' then 0
    when 'private.export_archive_jobs' then 1 when 'public.generated_exports' then 2 else 0 end,entry_revision loop
   v_count:=private.future_person_deletion_row_v1(e.store_name,e.row_key,false);
   if v_count=0 then
    if e.status<>'deleted' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
    continue;
   end if;
   begin
    update public.purge_manifest_entries set status='deleted' where manifest_id=e.manifest_id
     and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
    perform private.future_person_deletion_row_v1(e.store_name,e.row_key,true);
    v_progress:=v_progress+1;v_total:=v_total+1;
   exception when foreign_key_violation then
    null;
   end;
  end loop;
  v_pending:=0;
  for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50
   and store_name=any(v_stores) loop
   v_pending:=v_pending+private.future_person_deletion_row_v1(e.store_name,e.row_key,false);
  end loop;
  exit when v_pending=0;
  if v_progress=0 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end loop;
 return v_total;
end $$;
revoke all on function private.purge_future_person_derived_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.prepare_future_person_deletion_v1(p_session_hash text,p_nonce text)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;s public.subjects;v_embryo public.embryos;c private.future_person_custody_slices;
 x private.embryo_canonical_sources;v_now timestamptz;r uuid;m uuid;env jsonb;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select * into s from public.subjects where id=rs.target_id for update;
 select * into c from private.future_person_custody_slices where subject_id=s.id for update;
 select * into x from private.embryo_canonical_sources where file_id=c.source_file_id for update;
 select * into v_embryo from public.embryos where id=x.embryo_id for update;
 perform private.assert_future_person_subject_custody_v1(s.id);
 perform private.assert_future_person_settled_source_v1(x.file_id);
 v_now:=clock_timestamp();
 -- Until the real archive cleanup door can prove every reservation absent,
 -- any archive attempt is a refusal, including unACKed/uncertain writes.
 if x.file_id is null or v_embryo.id is null or v_embryo.subject_id is distinct from s.id
   or v_embryo.cohort_id is not null or v_embryo.status<>'claimed_unbound' or c.audit_principal_id is null or (select count(*) from public.genome_files where subject_id=s.id)<>1
   or exists(select 1 from private.export_archive_attempts a join public.generated_exports e on e.id=a.export_id
      where e.target_kind='subject' and e.target_id=s.id)
   or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
      and (e.object_id is not null or e.archive_sha256 is not null or e.byte_count is not null))
   or exists(select 1 from private.claim_document_sessions ds join private.claim_reviews cr on cr.id=ds.intake_id
      where (cr.matched_embryo_id=x.embryo_id or cr.matched_claimant_principal_id=c.claimant_principal_id)
       and (ds.state<>'finalized' or ds.complete_nonce_hash is null))
   or exists(select 1 from private.claim_document_fragments f join private.claim_document_sessions ds on ds.id=f.session_id
      join private.claim_reviews cr on cr.id=ds.intake_id
      where (cr.matched_embryo_id=x.embryo_id or cr.matched_claimant_principal_id=c.claimant_principal_id) and f.state='reserved')
   or exists(select 1 from public.retention_rows q where q.retention_id='future-person.claimant-reverification-until-request'
      and q.target_kind='subject' and q.target_id=s.id and q.state in('scheduled','active'))
   or (select count(*) from private.embryo_canonical_source_parts where file_id=x.file_id)<>x.part_count
   or exists(select 1 from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id
      where b.file_id=x.file_id and a.state<>'landed')
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 -- Only a genuinely issued current selector attributes a new action; legacy
 -- NULL actors are never backfilled or guessed.
 if c.audit_principal_id is not null then
   perform private.append_legal_audit_event('claimant.deletion_requested',
     private.future_person_audit_selector_v1(s.id),'api.future-person-delete','accepted','{}');
 end if;
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline,state,created_at)
 values('future-person.claimant-reverification-until-request','subject',s.id,1,s.lifecycle_revision,v_embryo.disposition_revision,v_now+interval '7 days','active',v_now)
 returning id into r;
 env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,
   'claimantPrincipalId',c.claimant_principal_id,'sourceFileId',x.file_id,'sourceSha256',x.source_sha256,
   'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
   'subjectBindingRevision',s.subject_binding_revision,'subjectLifecycleRevision',s.lifecycle_revision,
   'embryoDispositionRevision',v_embryo.disposition_revision,'requestedAt',v_now,'sourceDeadline',v_now+interval '7 days','completionDeadline',v_now+interval '30 days');
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 values(r,'future-person.claimant-reverification-until-request','future-person-claimed-source-disposal','purge',1,v_now,'subject',s.id,
   s.lifecycle_revision,v_embryo.disposition_revision,'approved-claimant',rs.authority_revision,env);
 insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(r,'future-person-claimed-source-disposal',1,'complete-retention',1,
   encode(extensions.digest(convert_to(env::text,'UTF8'),'sha256'),'hex')) returning id into m;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'variant-rows','private.embryo_canonical_parts',to_jsonb(a),b.sequence+1
   from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id where b.file_id=x.file_id;
 update public.subjects set analysis_stopped_at=coalesce(analysis_stopped_at,v_now) where id=s.id;
 update public.worker_jobs w set status='cancelled',claimed_by=null,claim_token_hash=null,
   claim_expires_at=null,finished_at=v_now where w.status in('queued','running') and w.kind not in('revoke_purge','retention_purge')
     and (w.subject_id=s.id or w.file_id=x.file_id);
 update public.rights_sessions q set status='revoked',ended_at=v_now
   where q.target_kind='claimed-subject' and q.target_id=s.id and q.status='active';
 -- Close every currently issued claimant capability before freezing rows.
 -- Raising the real release revision also fences a concurrent old issuer;
 -- it does not change the frozen source or create a new claimant authority.
 update public.future_person_claimant_principals set release_revision=release_revision+1 where id=c.claimant_principal_id;
 update public.future_person_claim_release_credentials set status='revoked'
  where claimant_principal_id=c.claimant_principal_id and status in('current','consumed');
 update public.mail_outbox o set state='invalidated',claimed_at=null,last_outcome_code='claimant_deletion'
  where o.state in('queued','claimed') and ((o.target_kind in('subject','claimed-subject') and o.target_id=s.id)
   or o.recipient_principal_id in(select id from public.subject_principals where subject_id=s.id));
 update public.token_candidates tc set state='invalidated' where tc.state in('pending','issued') and tc.outbox_id in(
  select id from public.mail_outbox o where (o.target_kind in('subject','claimed-subject') and o.target_id=s.id)
   or o.recipient_principal_id in(select id from public.subject_principals where subject_id=s.id));
 update public.token_hashes h set status='revoked',ended_at=v_now where h.status='current' and h.candidate_id in(
  select tc.id from public.token_candidates tc join public.mail_outbox o on o.id=tc.outbox_id
   where (o.target_kind in('subject','claimed-subject') and o.target_id=s.id)
    or o.recipient_principal_id in(select id from public.subject_principals where subject_id=s.id));
 update public.download_sessions q set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where q.status='active' and ((q.target_kind in('subject','claimed-subject') and q.target_id=s.id)
   or q.principal_id in(select id from public.subject_principals where subject_id=s.id));
 update public.generated_exports e set status='revoked' where e.target_kind='subject' and e.target_id=s.id
  and e.status in('queued','building');
 update public.copilot_generation_sessions cg set state='refused' where cg.state in('authorizing','generating','validated')
  and exists(select 1 from private.future_person_deletion_graph_rows_v1(s.id,c.claimant_principal_id,x.file_id,x.embryo_id,c.audit_principal_id) g
   where g.physical_store='public.copilot_generation_sessions' and g.primary_key=jsonb_build_object('id',cg.id));
 update public.model_contexts ctx set state='invalidated' where ctx.state<>'invalidated'
  and exists(select 1 from private.future_person_deletion_graph_rows_v1(s.id,c.claimant_principal_id,x.file_id,x.embryo_id,c.audit_principal_id) g
   where g.physical_store='public.model_contexts' and g.primary_key=jsonb_build_object('id',ctx.id));
 delete from public.future_person_recovery_key_hashes where claimant_principal_id=c.claimant_principal_id;
 delete from public.future_person_claimant_identity_hmacs where claimant_principal_id=c.claimant_principal_id;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,g.purge_target_id,g.physical_store,g.primary_key,
  50+row_number() over(order by g.purge_target_id,g.physical_store,g.primary_key::text)
 from private.future_person_deletion_graph_rows_v1(s.id,c.claimant_principal_id,x.file_id,x.embryo_id,c.audit_principal_id) g;
 if exists(select 1 from public.purge_manifests earlier where earlier.state='executing' and earlier.retention_row_id in(
  select control_row_id from private.future_person_deletion_controls_v1(m))) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.purge_future_person_derived_v1(m);
 perform private.assert_future_person_deletion_plan_v1(m);
 return m;
end $$;

create function public.future_person_deletion_parts_v1(p_operation text,p_manifest uuid,p_claim_token_hash text,
 p_expected jsonb default null,p_evidence jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.retention_due_phases;e public.purge_manifest_entries;receipt jsonb;v_now timestamptz;objects jsonb;
begin
 if p_operation is null or p_operation not in('claim','acknowledge','proof') or p_claim_token_hash is null
   or p_claim_token_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 p:=private.assert_future_person_deletion_plan_v1(p_manifest);v_now:=clock_timestamp();
 if p_operation='claim' then
   if p_expected is not null or p_evidence is not null or (p.status='claimed' and p.claim_expires_at>v_now) then
     raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   update public.retention_due_phases set status='claimed',claim_token_hash=p_claim_token_hash,
     claim_expires_at=v_now+interval '60 seconds',attempts=least(attempts+1,20)
     where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision returning * into p;
   update public.purge_manifests set state='executing',
     physical_purge_started_at=coalesce(physical_purge_started_at,v_now),
     frozen_manifest_hash=coalesce(frozen_manifest_hash,(select encode(extensions.digest(convert_to(
       jsonb_agg(jsonb_build_object('target',target_id,'store',store_name,'key',row_key) order by entry_revision)::text,'UTF8'),'sha256'),'hex')
       from public.purge_manifest_entries where manifest_id=p_manifest)) where id=p_manifest;
   select coalesce(jsonb_agg(jsonb_build_object('version','future-person-source-disposal-v1','manifestId',p_manifest,
     'ordinal',q.entry_revision,'bucket',q.row_key->>'provider_bucket','objectKey',q.row_key->>'provider_key',
     'byteCount',(q.row_key->>'byte_count')::integer,'sha256',q.row_key->>'sha256','claimExpiresAt',p.claim_expires_at)
     order by q.entry_revision),'[]') into objects from (
       select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision<=50 and status='pending' order by entry_revision limit 25) q;
   return jsonb_build_object('status','claimed','manifestId',p_manifest,'objects',objects);
 end if;
 if p.status<>'claimed' or p.claim_expires_at<=v_now or not private.claim_hash_matches_v1(p.claim_token_hash,p_claim_token_hash) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_operation='proof' then
   if p_expected is not null or p_evidence is not null then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   return jsonb_build_object('status',case when exists(select 1 from public.purge_manifest_entries where manifest_id=p_manifest
     and entry_revision<=50 and status<>'deleted') then 'source_pending' else 'source_tombstoned' end);
 end if;
 select * into e from public.purge_manifest_entries where manifest_id=p_manifest
   and entry_revision<=50 and entry_revision=(p_expected->>'ordinal')::bigint and status='pending' for update;
 receipt:=jsonb_build_object('version','future-person-source-disposal-v1','manifestId',p_manifest,
   'ordinal',e.entry_revision,'bucket',e.row_key->>'provider_bucket','objectKey',e.row_key->>'provider_key',
   'byteCount',(e.row_key->>'byte_count')::integer,'sha256',e.row_key->>'sha256','claimExpiresAt',p.claim_expires_at);
 if e.manifest_id is null or p_expected is distinct from receipt or p_evidence is null
   or jsonb_typeof(p_evidence) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_evidence))<>7
   or p_evidence->>'disposition' is distinct from 'payload-tombstoned' or p_evidence->>'bucket' is distinct from receipt->>'bucket'
   or p_evidence->>'objectKey' is distinct from receipt->>'objectKey'
   or p_evidence->>'providerVersion' is null or p_evidence->>'providerVersion'!~'^[0-9a-f]{32}$'
   or p_evidence->>'etag' is distinct from 'd41d8cd98f00b204e9800998ecf8427e'
   or p_evidence->'byteCount' is distinct from '0'::jsonb
   or p_evidence->>'sha256' is distinct from 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 update public.purge_manifest_entries set status='deleted' where manifest_id=e.manifest_id
   and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
 return jsonb_build_object('status','tombstone_acknowledged','manifestId',p_manifest,'ordinal',e.entry_revision);
end $$;
revoke all on function private.assert_future_person_deletion_plan_v1(uuid),private.prepare_future_person_deletion_v1(text,text),
 public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb) to service_role;

-- Claim leases and disposition ACKs may advance; the creation clock, target,
-- source binding, original deadlines and immutable part identity may not.
create function private.freeze_future_person_deletion_plan_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- One terminal minimization transition, after the exact graph is absent.
 -- Completed coded receipts are immutable; this is never a second write door.
 if tg_table_name='retention_due_phases' and to_jsonb(old)->>'phase_id'='future-person-claimed-source-disposal'
  and exists(select 1 from public.purge_manifests m where m.retention_row_id=(to_jsonb(old)->>'retention_row_id')::uuid
    and m.phase_id=to_jsonb(old)->>'phase_id' and m.phase_revision=(to_jsonb(old)->>'phase_revision')::bigint and m.state='complete') then
  if old.immutable_envelope->>'version'='future-person-deletion-receipt-v1' then
   if to_jsonb(new) is distinct from to_jsonb(old) then raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
   return new;
  end if;
  if old.status<>'claimed' or new.status<>'succeeded' or new.terminal_outcome_code<>'purged'
   or new.claim_token_hash is not null or new.claim_expires_at is not null
   or new.target_id=old.target_id or exists(select 1 from public.subjects where id in(old.target_id,new.target_id))
   or new.immutable_envelope is distinct from jsonb_build_object('version','future-person-deletion-receipt-v1','outcome','purged',
    'entryCount',(select count(*) from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
      where m.retention_row_id=(to_jsonb(old)->>'retention_row_id')::uuid and m.phase_id=to_jsonb(old)->>'phase_id' and m.phase_revision=(to_jsonb(old)->>'phase_revision')::bigint),
    'sourceDeadline',old.immutable_envelope->'sourceDeadline','completionDeadline',old.immutable_envelope->'completionDeadline')
   or to_jsonb(new)-array['target_id','immutable_envelope','status','claim_token_hash','claim_expires_at','terminal_outcome_code','completed_at']
    is distinct from to_jsonb(old)-array['target_id','immutable_envelope','status','claim_token_hash','claim_expires_at','terminal_outcome_code','completed_at'] then
   raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
  return new;
 elsif tg_table_name='retention_rows' and exists(select 1 from public.retention_due_phases q where q.retention_row_id=(to_jsonb(old)->>'id')::uuid
  and q.phase_id='future-person-claimed-source-disposal' and q.status='succeeded'
  and q.immutable_envelope->>'version'='future-person-deletion-receipt-v1') then
  if old.state='complete' then
   if to_jsonb(new) is distinct from to_jsonb(old) then raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
   return new;
  end if;
  if old.state<>'active' or new.state<>'complete' or exists(select 1 from public.subjects where id=old.target_id)
   or new.target_id is distinct from (select q.target_id from public.retention_due_phases q where q.retention_row_id=(to_jsonb(old)->>'id')::uuid
      and q.phase_id='future-person-claimed-source-disposal')
   or to_jsonb(new)-array['state','ended_at','target_id'] is distinct from to_jsonb(old)-array['state','ended_at','target_id'] then
   raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
  return new;
 elsif tg_table_name='purge_manifest_entries' and exists(select 1 from public.purge_manifests m
  where m.id=(to_jsonb(old)->>'manifest_id')::uuid and m.phase_id='future-person-claimed-source-disposal' and m.state='complete') then
  if old.row_key->>'version'='future-person-deletion-entry-receipt-v1' then
   if to_jsonb(new) is distinct from to_jsonb(old) then raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
   return new;
  end if;
  if old.status<>'deleted' or new.row_key is distinct from jsonb_build_object('version','future-person-deletion-entry-receipt-v1',
    'ordinal',old.entry_revision,'disposition','deleted') or to_jsonb(new)-'row_key' is distinct from to_jsonb(old)-'row_key' then
   raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
  return new;
 elsif tg_table_name='purge_manifests' and to_jsonb(old)->>'phase_id'='future-person-claimed-source-disposal' and to_jsonb(old)->>'state'='complete' then
  if to_jsonb(new) is distinct from to_jsonb(old) then raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
  return new;
 end if;
 if tg_table_name='retention_due_phases' then
   if old.phase_id='future-person-claimed-source-disposal' or new.phase_id='future-person-claimed-source-disposal' then
     if to_jsonb(new)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at']
       is distinct from to_jsonb(old)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at'] then
       raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
   end if;
 elsif tg_table_name='retention_rows' then
   if exists(select 1 from public.retention_due_phases where retention_row_id=old.id
     and phase_id='future-person-claimed-source-disposal')
     and to_jsonb(new)-array['state','ended_at'] is distinct from to_jsonb(old)-array['state','ended_at'] then
     raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
 elsif tg_table_name='purge_manifests' then
   if (old.phase_id='future-person-claimed-source-disposal' or new.phase_id='future-person-claimed-source-disposal')
     and to_jsonb(new)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       is distinct from to_jsonb(old)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor'] then
     raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
 elsif exists(select 1 from public.purge_manifests where id in(old.manifest_id,new.manifest_id)
   and phase_id='future-person-claimed-source-disposal')
   and to_jsonb(new)-'status' is distinct from to_jsonb(old)-'status' then
   raise exception using errcode='23514',message='claimant deletion plan immutable';
 end if;
 return new;
end $$;
revoke all on function private.freeze_future_person_deletion_plan_v1() from public,anon,authenticated,service_role,inherit_upload_only;
do $$ declare t text;begin
 foreach t in array array['retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries'] loop
   execute format('create trigger future_person_deletion_plan_immutable before update on public.%I
     for each row execute function private.freeze_future_person_deletion_plan_v1()',t);
 end loop;
end $$;

-- The retention stores have existing service table privileges. A worker may
-- use only the closed functions above, never create/edit/delete this plan by
-- direct table access. SECURITY INVOKER preserves that distinction: nested
-- writes by the approved security-definer executor carry its actual owner.
create function private.guard_future_person_deletion_writer_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare before_row jsonb;after_row jsonb;is_plan boolean:=false;owner_name text;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new);end if;
 if tg_table_name in('retention_due_phases','purge_manifests') then
   is_plan:=coalesce(before_row->>'phase_id'='future-person-claimed-source-disposal',false)
     or coalesce(after_row->>'phase_id'='future-person-claimed-source-disposal',false);
 elsif tg_table_name='retention_rows' then
   is_plan:=exists(select 1 from public.retention_due_phases where phase_id='future-person-claimed-source-disposal'
     and retention_row_id in((before_row->>'id')::uuid,(after_row->>'id')::uuid));
 else
   is_plan:=exists(select 1 from public.purge_manifests where phase_id='future-person-claimed-source-disposal'
     and id in((before_row->>'manifest_id')::uuid,(after_row->>'manifest_id')::uuid));
 end if;
 if is_plan then
   select pg_catalog.pg_get_userbyid(p.proowner) into owner_name from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
       and p.proname='prepare_future_person_deletion_v1' and p.proargtypes='25 25'::oidvector;
   if current_user is distinct from owner_name then
     raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_future_person_deletion_writer_v1() from public,anon,authenticated,service_role,inherit_upload_only;
do $$ declare t text;begin
 foreach t in array array['retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries'] loop
   execute format('create trigger future_person_deletion_closed_writer before insert or update or delete on public.%I
     for each row execute function private.guard_future_person_deletion_writer_v1()',t);
 end loop;
end $$;

-- Existing exact unbound rights proof, with one additional closed pending-
-- deletion fence. Even a newly activated old release cannot restore access.
create or replace function private.future_person_rights_session_v1(p_hash text,p_lock boolean)
returns public.rights_sessions language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select * into rs from public.rights_sessions where session_hash=p_hash;
 if p_lock and rs.id is not null then
   perform 1 from public.subjects where id=rs.target_id for update;
   select * into rs from public.rights_sessions where id=rs.id for update;
 end if;
 if rs.id is null or rs.status<>'active' or rs.purpose<>'approved-future-person-release'
   or rs.target_kind<>'claimed-subject' or rs.expires_at<=clock_timestamp()
   or rs.expires_at>rs.created_at+interval '60 minutes' then return null; end if;
 if not exists(select 1 from public.token_hashes h
   join public.future_person_claim_release_credentials r on r.candidate_id=h.candidate_id
     and r.credential_hash=h.token_hash and r.status='consumed' and r.expires_at>clock_timestamp()
   join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id and cp.status='current'
     and cp.release_revision=rs.authority_revision and cp.release_revision=r.credential_revision
     and cp.contact_expires_at>clock_timestamp() and cp.principal_id=rs.principal_id
   join public.subject_principals sp on sp.id=cp.principal_id and sp.subject_id=rs.target_id
     and sp.status='active' and sp.principal_kind='future_person' and sp.account_id is null
   join public.subjects s on s.id=rs.target_id and s.id=r.subject_id and s.claimant_principal_id=cp.id
     and s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null
     and s.lifecycle_revision=r.subject_lifecycle_revision and s.subject_binding_revision=r.subject_binding_revision
   join public.encrypted_contact_references e on e.id=r.contact_reference_id and e.principal_id=sp.id
     and e.status='current' and e.contact_ciphertext is not null and e.authority_revision=sp.principal_revision
   join private.future_person_custody_slices x on x.subject_id=s.id and x.claimant_principal_id=cp.id
   join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id
     and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
   where h.id=rs.token_hash_id and h.status='consumed') then return null; end if;
 if exists(select 1 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
   where r.target_kind='subject' and r.target_id=rs.target_id and r.state='active'
     and p.phase_id='future-person-claimed-source-disposal') then return null;end if;
 return rs;
end $$;

-- Generic scheduled retention may not claim this private inline continuation.
create or replace function private.claim_retention_phase_v1(
  p_claim_token_hash text,
  p_lease_seconds integer default 60
)
returns public.retention_due_phases
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.retention_due_phases;
begin
  if p_claim_token_hash !~ '^[0-9a-f]{64}$' or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'invalid retention claim';
  end if;
  select * into v_row from public.retention_due_phases
  where status in ('pending', 'retry') and phase_deadline <= clock_timestamp()
    and phase_id <> 'future-person-claimed-source-disposal'
  order by phase_deadline, retention_row_id, phase_id
  for update skip locked limit 1;
  if v_row.retention_row_id is null then return null; end if;
  update public.retention_due_phases
  set status = 'claimed', claim_token_hash = p_claim_token_hash,
      claim_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1
  where retention_row_id = v_row.retention_row_id
    and phase_id = v_row.phase_id and phase_revision = v_row.phase_revision
  returning * into v_row;
  return v_row;
end;
$$;

-- The subject -> claimant -> principal -> subject cycle otherwise cannot be
-- removed atomically. Normal writes keep immediate validated FK enforcement;
-- only this closed finisher defers the one subject-to-claimant edge.
alter table public.subjects drop constraint subjects_claimant_principal_id_fkey;
alter table public.subjects add constraint subjects_claimant_principal_id_fkey
 foreign key(claimant_principal_id) references public.future_person_claimant_principals(id)
 on delete no action deferrable initially immediate;

-- Canonical delete permission is the exact sealed claimant plan, not a parent
-- reason, lifecycle rewrite, caller flag or session alone. Whole graph cleanup
-- marks its own frozen source key just before the atomic DELETE.
create function private.future_person_canonical_erasure_allowed_v1(p_file uuid,p_subject uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
  join public.purge_manifests m on m.retention_row_id=r.id and m.phase_id=p.phase_id and m.phase_revision=p.phase_revision
  join public.subjects s on s.id=r.target_id join private.future_person_custody_slices c on c.subject_id=s.id
  where r.target_kind='subject' and r.target_id=p_subject and r.state='active' and m.state='executing'
   and p.phase_id='future-person-claimed-source-disposal' and p.status='claimed'
   and s.lifecycle='claimed_unbound' and s.claimant_principal_id=c.claimant_principal_id
   and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null
   and s.analysis_stopped_at is not null and c.source_file_id=p_file
   and p.immutable_envelope->>'sourceFileId'=p_file::text and p.immutable_envelope->>'subjectId'=p_subject::text
   and p.immutable_envelope->>'sourceSha256'=c.source_sha256
   and p.immutable_envelope->>'membershipSha256'=c.source_membership_sha256
   and (p.immutable_envelope->>'publicationRevision')::bigint=c.publication_revision
   and exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision<=50)
   and not exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision<=50 and e.status<>'deleted')
   and exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision>50
    and e.store_name='private.embryo_canonical_sources' and e.row_key=jsonb_build_object('file_id',p_file)
    and e.status='deleted'));
$$;
revoke all on function private.future_person_canonical_erasure_allowed_v1(uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.guard_claimed_canonical_deletion_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_subject uuid;s public.subjects;
begin
 if tg_table_name='embryo_canonical_sources' then v_subject:=old.subject_id;
 else select subject_id into v_subject from private.embryo_canonical_sources where file_id=old.file_id;end if;
 select * into s from public.subjects where id=v_subject for update;
 if (s.lifecycle in('claimed_unbound','claimed_bound') or s.claimant_principal_id is not null)
  and not private.future_person_canonical_erasure_allowed_v1(old.file_id,v_subject) then
  raise exception using errcode='42501',message='embryo_source_unavailable';end if;
 return old;
end $$;

create or replace function private.guard_immutable_embryo_calls_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare x private.embryo_canonical_sources; s public.subjects;
begin
 if tg_op='UPDATE' then
  select * into x from private.embryo_canonical_sources where file_id=old.source_file_id;
  if x.call_immutability_proof is null then return new;end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception using errcode='55000',message='canonical_calls_immutable';end if;return new;
 end if;
 if tg_op='DELETE' then
  select subj.* into s from public.genome_files f join public.subjects subj on subj.id=f.subject_id where f.id=old.source_file_id for update of subj;
  if (s.lifecycle in ('claimed_unbound','claimed_bound') or s.claimant_principal_id is not null)
   and not private.future_person_canonical_erasure_allowed_v1(old.source_file_id,s.id) then
   raise exception using errcode='42501',message='embryo_source_unavailable';end if;return old;
 end if;
 select * into x from private.embryo_canonical_sources where file_id=new.source_file_id and embryo_id=new.embryo_id;
 if x.call_immutability_proof is null then return new;end if;
 if x.file_id is null or new.source_binding_fingerprint<>x.source_sha256 or not exists(
  select 1 from public.worker_jobs w join public.embryo_ingest_sessions sess on sess.id=x.session_id
   where w.id=x.worker_job_id and w.kind='split_cohort_vcf' and w.status='running' and w.attempts=x.attempt
    and w.claim_expires_at>clock_timestamp() and sess.status='processing'
    and exists(select 1 from private.embryo_split_variants v where v.session_id=x.session_id and v.sample_ordinal=x.sample_ordinal
      and v.worker_job_id=x.worker_job_id and v.attempt=x.attempt
      and private.embryo_call_value_hash_v1(v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype)
        =private.embryo_call_value_hash_v1(new.chromosome,new.position,new.reference_allele,new.alternate_allele,new.genotype)
      and (v.chromosome,v.position,v.reference_allele,v.alternate_allele,v.genotype) is not distinct from
        (new.chromosome,new.position,new.reference_allele,new.alternate_allele,new.genotype))) then
  raise exception using errcode='42501',message='embryo_source_unavailable';end if;
 return new;
end $$;
create or replace function private.purge_future_person_claim_intakes_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(1869509217, 20);
  delete from private.future_person_claim_intakes i
  where not private.claim_intake_live_v1(i)
    and not exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
      where m.phase_id='future-person-claimed-source-disposal' and m.state in('frozen','executing')
       and e.store_name='private.future_person_claim_intakes' and e.row_key=jsonb_build_object('id',i.id))
    and (i.completed_at is null or exists (select 1 from private.claim_reviews r
      where r.id = i.id and r.state in ('refused', 'closed')))
    and not exists (select 1 from private.claim_document_fragments f
      join private.claim_document_sessions s on s.id = f.session_id where s.intake_id = i.id)
    and not exists (select 1 from private.claim_documents d
      where d.intake_id = i.id and d.object_deleted_at is null)
    and not exists (select 1 from private.claim_document_sessions s
      where s.intake_id = i.id and s.planned_object_key is not null
        and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key));
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.append_legal_audit_event(
      'claim.intake.expired', null, 'jobs.retention', 'purged',
      jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

create or replace function private.confirm_claim_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_rows integer;
  v_document record;
begin
  if p_route_id is null or p_route_id not in ('jobs.retention', 'jobs.claim-document-scan', 'api.evidence-complete') then
    raise exception using errcode = '22023', message = 'claim document deletion invalid';
  end if;
  -- A sealed claimant plan never treats an unACKed or uncertain write as
  -- disposable. The actual provider caller must already have removed metadata.
  if exists(select 1 from private.claim_document_sessions ds join private.claim_documents d on d.session_id=ds.id
    join public.purge_manifest_entries e on e.store_name='private.claim_documents' and e.row_key=jsonb_build_object('id',d.id)
    join public.purge_manifests m on m.id=e.manifest_id and m.phase_id='future-person-claimed-source-disposal' and m.state in('frozen','executing')
    where d.object_key=any(p_object_keys) and (ds.state<>'finalized' or ds.complete_nonce_hash is null
      or exists(select 1 from storage.objects o where o.bucket_id='future-person-identity' and o.name=d.object_key))) then
    raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  update public.purge_manifest_entries e set status='deleted'
  from public.purge_manifests m where m.id=e.manifest_id and m.phase_id='future-person-claimed-source-disposal'
   and m.state in('frozen','executing') and e.entry_revision>50 and (
    (e.store_name='private.claim_documents' and exists(select 1 from private.claim_documents d
      where e.row_key=jsonb_build_object('id',d.id) and d.object_key=any(p_object_keys)
       and not private.claim_document_retained_v1(d)))
    or (e.store_name='private.claim_document_fragments' and exists(select 1 from private.claim_document_fragments f
      where e.row_key=jsonb_build_object('session_id',f.session_id,'sequence',f.sequence) and f.object_key=any(p_object_keys)))
    or (e.store_name='storage.objects' and e.row_key->>'bucket_id'='future-person-identity'
      and e.row_key->>'name'=any(p_object_keys)
      and not exists(select 1 from storage.objects o where to_jsonb(o) @> e.row_key)
      and exists(select 1 from private.claim_documents d join public.purge_manifest_entries q on q.manifest_id=m.id
       and q.store_name='private.claim_documents' and q.row_key=jsonb_build_object('id',d.id)
       where d.object_key=e.row_key->>'name' and not private.claim_document_retained_v1(d)))
   );
  delete from private.claim_document_fragments where object_key = any (p_object_keys);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  update private.claim_document_sessions s set planned_object_key = null
  where s.planned_object_key = any (p_object_keys)
    and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  for v_document in
    select d.id, d.state, d.refusal_code, d.object_key from private.claim_documents d
    where d.object_key = any (p_object_keys) and d.object_deleted_at is null for update
  loop
    if v_document.state = 'refused' then
      update private.claim_documents set object_deleted_at = clock_timestamp(), lease_hash = null,
        lease_expires_at = null where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', v_document.refusal_code));
    elsif not private.claim_document_retained_v1(
      (select d from private.claim_documents d where d.id = v_document.id)) then
      update private.claim_document_sessions set planned_object_key = null
      where planned_object_key = v_document.object_key;
      delete from private.claim_documents where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'claim-ended'));
    else
      -- A retained document is never deleted by a confirmation.
      continue;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


-- Retention controls are not working-data purge targets. Select only the
-- exact typed targets already proved by this immutable subject manifest; an
-- old cohort UUID or a JSON string search never expands the custody boundary.
create function private.future_person_deletion_controls_v1(p_manifest uuid)
returns table(control_row_id uuid) language plpgsql stable security definer set search_path='' as $$
declare env jsonb;v_main uuid;
begin
 select p.immutable_envelope,m.retention_row_id into env,v_main from public.purge_manifests m
  join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
  where m.id=p_manifest and m.phase_id='future-person-claimed-source-disposal';
 if env->>'version' is distinct from 'future-person-deletion-plan-v1' then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 return query select r.id from public.retention_rows r where r.id<>v_main and (
  (r.target_kind='subject' and r.target_id=(env->>'subjectId')::uuid)
  or (r.target_kind='file' and r.target_id=(env->>'sourceFileId')::uuid)
  or (r.target_kind='claim' and r.target_id=(env->>'claimantPrincipalId')::uuid
    and r.retention_id='future-person.claimed-unbound-24mo')
  or exists(select 1 from public.purge_manifest_entries e where e.manifest_id=p_manifest and e.entry_revision>50 and (
    (r.target_kind='claim' and e.store_name in('public.future_person_claims','public.future_person_claim_sessions','private.future_person_claim_intakes')
      and r.target_id::text=e.row_key->>'id')
    or (r.target_kind='evidence' and e.store_name in('private.claim_documents','public.legal_evidence_documents')
      and r.target_id::text=e.row_key->>'id')
    or (r.target_kind='export' and e.store_name='public.generated_exports' and r.target_id::text=e.row_key->>'id')
    or (r.target_kind='upload_session' and e.store_name='public.upload_sessions' and r.target_id::text=e.row_key->>'id')))
 ) order by r.id;
end $$;
revoke all on function private.future_person_deletion_controls_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- This is proof, not a caller flag. Only after the entire current sealed graph
-- has disappeared may its exact older controls lose the obsolete target and
-- working envelope. All original clocks, revisions and immutable hashes stay.
create function private.future_person_control_minimization_allowed_v1(p_row uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.purge_manifests m join public.retention_due_phases p on p.retention_row_id=m.retention_row_id
  and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
  where m.phase_id='future-person-claimed-source-disposal' and m.state='complete' and p.status='claimed'
   and p.immutable_envelope->>'version'='future-person-deletion-plan-v1'
   and not exists(select 1 from public.subjects s where s.id=p.target_id)
   and exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id)
   and not exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.status<>'deleted')
   and exists(select 1 from private.future_person_deletion_controls_v1(m.id) selected where selected.control_row_id=p_row));
$$;
revoke all on function private.future_person_control_minimization_allowed_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create or replace function private.guard_future_person_contact_retention_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_minimize boolean:=false;
begin
 -- Keep the existing invoker trigger and table ACLs. The exact public control
 -- proof is inlined here; an ordinary permitted UPDATE never needs EXECUTE
 -- on the separately closed private selector helper.
 if tg_table_name in('retention_rows','retention_due_phases')
  and to_jsonb(old)->>'retention_id'='future-person.claimed-unbound-24mo' then
  select exists(select 1 from public.purge_manifests m join public.retention_due_phases p
   on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
   join public.retention_rows earlier on earlier.id=case when tg_table_name='retention_rows'
    then (to_jsonb(old)->>'id')::uuid else (to_jsonb(old)->>'retention_row_id')::uuid end
   where m.phase_id='future-person-claimed-source-disposal' and m.state='complete' and p.status='claimed'
    and p.immutable_envelope->>'version'='future-person-deletion-plan-v1'
    and earlier.retention_id='future-person.claimed-unbound-24mo' and earlier.target_kind='claim'
    and earlier.target_id=(p.immutable_envelope->>'claimantPrincipalId')::uuid
    and not exists(select 1 from public.subjects s where s.id=p.target_id)
    and exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id)
    and not exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.status<>'deleted')) into v_minimize;
 end if;
 if tg_table_name='retention_rows' and v_minimize then
  if new.state<>'complete' or new.ended_at is null or new.target_id=old.target_id
   or to_jsonb(new)-array['state','ended_at','target_id'] is distinct from to_jsonb(old)-array['state','ended_at','target_id'] then
   raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
  return new;
 elsif tg_table_name='retention_due_phases' and v_minimize then
  if new.status not in('cancelled','succeeded','failed') or new.target_id=old.target_id
   or new.immutable_envelope is distinct from jsonb_build_object('version','future-person-control-receipt-v1','outcome','subject-deleted')
   or to_jsonb(new)-array['status','target_id','immutable_envelope','claim_token_hash','claim_expires_at','terminal_outcome_code','completed_at']
    is distinct from to_jsonb(old)-array['status','target_id','immutable_envelope','claim_token_hash','claim_expires_at','terminal_outcome_code','completed_at'] then
   raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
  return new;
 end if;
 if tg_table_name='retention_rows' then
   if old.retention_id='future-person.claimed-unbound-24mo' or new.retention_id='future-person.claimed-unbound-24mo' then
     if to_jsonb(new)-array['state','ended_at'] is distinct from to_jsonb(old)-array['state','ended_at'] then
       raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
   end if;
 elsif tg_table_name='retention_due_phases' then
   if old.retention_id='future-person.claimed-unbound-24mo' or new.retention_id='future-person.claimed-unbound-24mo' then
     if to_jsonb(new)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at']
       is distinct from to_jsonb(old)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at'] then
       raise exception using errcode='23514',message='claimant contact deadline is immutable';end if;
   end if;
 else
   if old.phase_id='claimed-unbound-working-data-purge' or new.phase_id='claimed-unbound-working-data-purge' then
     if to_jsonb(new)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       is distinct from to_jsonb(old)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       or (old.physical_purge_started_at is not null and new.physical_purge_started_at is distinct from old.physical_purge_started_at)
       or (old.frozen_manifest_hash is not null and new.frozen_manifest_hash is distinct from old.frozen_manifest_hash)
       or new.batch_cursor<old.batch_cursor then
       raise exception using errcode='23514',message='claimant contact manifest is immutable';end if;
   end if;
 end if;
 return new;
end $$;

create function private.finish_future_person_deletion_v1(p_manifest uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare p public.retention_due_phases;m public.purge_manifests;e public.purge_manifest_entries;
 v_now timestamptz;v_count bigint;v_progress bigint;v_pending bigint;v_audit uuid;v_anon uuid:=gen_random_uuid();v_total bigint;v_controls uuid[];v_control uuid;old_entry public.purge_manifest_entries;
begin
 p:=private.assert_future_person_deletion_plan_v1(p_manifest);v_now:=clock_timestamp();
 select * into m from public.purge_manifests where id=p_manifest;
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' or p.status<>'claimed'
  or p.claim_expires_at<=v_now or not private.claim_hash_matches_v1(p.claim_token_hash,p_claim_token_hash)
  or m.state<>'executing' or m.physical_purge_started_at is null or m.frozen_manifest_hash is null
  or exists(select 1 from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision<=50 and status<>'deleted') then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);
 select audit_principal_id into v_audit from private.future_person_custody_slices where subject_id=p.target_id;
 -- Legacy unindexed audit actors cannot be guessed. Uncertain provider
 -- inventories have no completion door; do not erase the manifest or source.
 if v_audit is null or exists(select 1 from public.purge_manifest_entries candidate where candidate.manifest_id=p_manifest and candidate.entry_revision>50
  and candidate.status<>'deleted' and candidate.store_name in('private.claim_documents','private.claim_document_fragments','storage.objects',
   'private.export_archive_attempts','private.export_archive_segments','public.cloud_model_calls','public.cloud_provider_attempts',
   'public.cloud_provider_payloads','public.report_artifacts','public.legal_evidence_documents','public.legal_evidence_fragments',
   'public.legal_evidence_review_copies','public.upload_staging_objects')) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 -- A published cohort's earlier ingest fragments contain the same DNA.
 -- Only the existing actual published cleanup may remove them; sibling
 -- canonical sources remain intact. Absence is pinned to the settled producer,
 -- never inferred from source markers alone.
 if exists(select 1 from private.embryo_canonical_sources x where x.file_id=(p.immutable_envelope->>'sourceFileId')::uuid and (
    exists(select 1 from public.embryo_ingest_fragments f where f.session_id=x.session_id)
    or exists(select 1 from private.embryo_ingest_write_intents i where i.session_id=x.session_id)
    or exists(select 1 from public.embryo_fragment_handle_maps h where h.session_id=x.session_id)
    or exists(select 1 from private.embryo_split_variants v where v.session_id=x.session_id)
    or exists(select 1 from private.embryo_canonical_parts part where part.session_id=x.session_id
      and not exists(select 1 from private.embryo_canonical_source_parts b where b.part_id=part.id))
    or exists(select 1 from public.embryo_ingest_unwinds u where u.session_id=x.session_id and u.purpose='published' and u.state<>'complete'))) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select array_agg(control_row_id order by control_row_id) into v_controls
  from private.future_person_deletion_controls_v1(p_manifest);
 if exists(select 1 from public.purge_manifests earlier where earlier.retention_row_id=any(coalesce(v_controls,'{}'::uuid[]))
   and earlier.state='executing') then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select count(*) into v_total from public.purge_manifest_entries where manifest_id=p_manifest;
 set constraints public.subjects_claimant_principal_id_fkey deferred;
 -- This is an internal authorization marker within the immutable sealed key;
 -- no API role can write it or execute the finisher.
 update public.purge_manifest_entries set status='deleted' where manifest_id=p_manifest and entry_revision>50
  and store_name='private.embryo_canonical_sources';
 loop
  v_progress:=0;
  for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50
   order by case store_name when 'public.embryo_variants' then 0
    when 'private.embryo_canonical_source_parts' then 1 when 'private.embryo_canonical_sources' then 2
    when 'private.future_person_custody_slices' then 4 when 'public.genome_files' then 5
    when 'public.subjects' then 9 else 3 end,entry_revision loop
   v_count:=private.future_person_deletion_row_v1(e.store_name,e.row_key,false);
   if v_count=0 then
    if e.status<>'deleted' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
    continue;
   end if;
   begin
    update public.purge_manifest_entries set status='deleted' where manifest_id=e.manifest_id
     and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
    perform private.future_person_deletion_row_v1(e.store_name,e.row_key,true);
    v_progress:=v_progress+1;
   exception when foreign_key_violation then
    -- Exact FK children may need to go first. No constraint is disabled,
    -- and a remaining external child makes the whole transaction refuse.
    null;
   end;
  end loop;
  v_pending:=0;
  for e in select * from public.purge_manifest_entries where manifest_id=p_manifest and entry_revision>50 loop
   v_pending:=v_pending+private.future_person_deletion_row_v1(e.store_name,e.row_key,false);
  end loop;
  exit when v_pending=0;
  if v_progress=0 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end loop;
 set constraints public.subjects_claimant_principal_id_fkey immediate;
 if exists(select 1 from public.subjects where id=p.target_id)
  or exists(select 1 from private.future_person_custody_slices where subject_id=p.target_id)
  or exists(select 1 from public.purge_manifest_entries where manifest_id=p_manifest and status<>'deleted') then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.append_legal_audit_event('claimant.deleted',v_audit,'api.future-person-delete','purged','{}');
 -- Preserve coded terminal controls, original clocks/counts and chain hashes.
 -- Destroy every working row's subject, provider key, contact and body link.
 update public.purge_manifests set state='complete',batch_cursor=v_total where id=p_manifest;
 foreach v_control in array coalesce(v_controls,'{}'::uuid[]) loop
  perform 1 from public.retention_rows r where r.id=v_control for update;
  perform 1 from public.retention_due_phases q where q.retention_row_id=v_control for update;
  -- A second manifest cannot stand in for provider evidence. Every earlier
  -- row key must be a closed PK and already absent; opaque object handles or
  -- unresolved provider reservations refuse this entire final transaction.
  for old_entry in select candidate.* from public.purge_manifest_entries candidate join public.purge_manifests old_m on old_m.id=candidate.manifest_id
   where old_m.retention_row_id=v_control loop
   if old_entry.object_id is not null or private.future_person_deletion_row_v1(old_entry.store_name,old_entry.row_key,false)<>0 then
    raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   update public.purge_manifest_entries set status='deleted',row_key=jsonb_build_object('version','future-person-deletion-entry-receipt-v1',
    'ordinal',old_entry.entry_revision,'disposition','deleted') where manifest_id=old_entry.manifest_id and target_id=old_entry.target_id
    and store_name=old_entry.store_name and entry_revision=old_entry.entry_revision;
  end loop;
  update public.purge_manifests old_m set state=case when old_m.state='complete' then 'complete' else 'cancelled' end
   where old_m.retention_row_id=v_control;
  update public.retention_due_phases q set target_id=v_anon,
   immutable_envelope=jsonb_build_object('version','future-person-control-receipt-v1','outcome','subject-deleted'),
   status=case when q.status in('cancelled','succeeded','failed') then q.status else 'cancelled' end,
   terminal_outcome_code=coalesce(q.terminal_outcome_code,'subject-deleted'),completed_at=coalesce(q.completed_at,v_now),
   claim_token_hash=null,claim_expires_at=null where q.retention_row_id=v_control;
  update public.retention_rows r set target_id=v_anon,state='complete',ended_at=coalesce(r.ended_at,v_now) where r.id=v_control;
 end loop;

 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='purged',completed_at=v_now,target_id=v_anon,
  immutable_envelope=jsonb_build_object('version','future-person-deletion-receipt-v1','outcome','purged','entryCount',v_total,
   'sourceDeadline',p.immutable_envelope->'sourceDeadline','completionDeadline',p.immutable_envelope->'completionDeadline')
  where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.retention_rows set state='complete',ended_at=v_now,target_id=v_anon where id=p.retention_row_id;
 update public.purge_manifest_entries set row_key=jsonb_build_object('version','future-person-deletion-entry-receipt-v1',
  'ordinal',entry_revision,'disposition','deleted') where manifest_id=p_manifest;
 return jsonb_build_object('status','deleted');
end $$;
revoke all on function private.finish_future_person_deletion_v1(uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.guard_future_person_sealed_graph_delete_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
  where m.phase_id='future-person-claimed-source-disposal' and m.state in('frozen','executing')
   and e.entry_revision>50 and e.store_name=tg_table_schema||'.'||tg_table_name
   and e.status<>'deleted' and to_jsonb(old) @> e.row_key) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 return old;
end $$;
revoke all on function private.guard_future_person_sealed_graph_delete_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
do $$ declare relation text;begin
 foreach relation in array array[
'public.ancestry_regions','public.ancestry_results','public.appeal_intakes','public.appeal_evidence','public.appeal_assignments','public.correction_requests','public.correction_working_data','public.correction_assignments','public.legal_reviews','public.audit_principal_links','public.audit_principal_link_keys','public.chat_messages','public.chats','public.copilot_context_tokens','public.copilot_context_history','public.copilot_turn_dependencies','public.future_person_claims','public.future_person_claim_sessions','public.future_person_claim_documents','public.future_person_claim_review_packages','public.future_person_claim_assignments','public.future_person_claim_objections','private.future_person_claim_intakes','private.claim_documents','private.claim_reviews','private.claim_review_assignments','private.claim_review_reads','private.claim_review_decisions','private.claim_review_downloads','private.claim_review_receipt_sessions','private.claim_review_chunk_receipts','public.future_person_claimant_principals','public.future_person_claimant_identity_hmacs','public.future_person_recovery_key_hashes','public.cloud_provider_payloads','public.cloud_provider_attempts','public.cloud_model_calls','public.encrypted_contact_references','public.contact_hmac_indexes','public.subject_control_refusal_authorities','public.embryo_disposition_proposals','public.embryo_disposition_confirmations','public.retention_notice_campaigns','public.adult_subject_drafts','public.subject_invitations','public.invitation_candidates','public.invitation_reminders','public.draft_participant_slots','public.embryo_figures','public.embryos','public.embryo_qc','public.embryo_scores','public.future_person_identity','public.report_artifacts','public.generated_exports','public.download_sessions','public.model_contexts','private.own_analysis_runs','public.genome_files','public.legal_evidence_ingest_sessions','public.legal_evidence_fragments','public.legal_evidence_documents','public.legal_evidence_review_copies','public.legal_evidence_assignments','public.legal_evidence_working_data','private.claim_document_sessions','private.claim_document_fragments','public.mail_outbox','public.mail_deliveries','public.mail_provider_attempts','public.token_hashes','public.token_candidates','public.rights_sessions','public.rights_nonces','public.future_person_claim_notices','public.future_person_claim_release_credentials','public.user_prs','public.portrait_results','public.future_person_record_key_hashes','public.future_person_record_key_print_rights','public.suppressions','public.subject_consents','public.consent_signatures','public.attestations','public.attestation_contradictions','public.purpose_grants','public.directional_grants','public.subject_principals','public.subjects','public.subject_demographics','public.subject_relationships','public.upload_sessions','public.upload_chunks','public.upload_staging_objects','public.pending_source_rows','public.user_variants','public.embryo_variants','public.report_observed_calls','private.own_preparation_jobs','private.embryo_canonical_source_parts','private.embryo_canonical_sources','private.embryo_canonical_parts','private.future_person_custody_slices','public.worker_jobs','public.worker_job_batches','public.analysis_jobs','public.copilot_generation_sessions','private.export_archive_jobs','private.export_archive_attempts','private.export_archive_downloads','private.export_archive_manifest_pages','private.export_archive_segments','private.export_archive_nonce_uses'
 ] loop
  execute format('create trigger future_person_sealed_graph_delete before delete on %s
    for each row execute function private.guard_future_person_sealed_graph_delete_v1()',relation);
 end loop;
end $$;
