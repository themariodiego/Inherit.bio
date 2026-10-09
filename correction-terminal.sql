-- SOURCE ONLY. The exact local graph is physical rows; retained coded public
-- metadata is never declared physically deleted. The existing whole-account
-- and claimant graph guards remain closed until their new-store composition.
-- Register only actual new owned stores, under existing targets/class. No
-- frozen historical manifest is rewritten and no arbitrary store is accepted.
do $stores$
declare ordinal integer; name text;
begin
 select max(store_order) into ordinal from public.purge_target_stores where target_id='appeal-and-correction-working-packages';
 foreach name in array array['private.new_correction_case_envelopes','private.new_correction_review_nonce_uses',
  'private.new_correction_provenance_observations','private.new_correction_delivery'] loop
  ordinal:=ordinal+1;
  insert into public.purge_target_stores(target_id,store_name,store_order)
  values('appeal-and-correction-working-packages',name,ordinal);
 end loop;
 select max(store_order) into ordinal from public.purge_target_stores where target_id='mail-token-and-rights-delivery-state';
 insert into public.purge_target_stores(target_id,store_name,store_order)
 values('mail-token-and-rights-delivery-state','private.new_correction_mail_reservations',ordinal+1);
end $stores$;

create function private.new_correction_owned_graph_v1(p_case uuid,p_contact uuid,p_outbox uuid)
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 select 'appeal-and-correction-working-packages','private.new_correction_case_envelopes',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_case_envelopes t where correction_id=p_case
 union all select 'appeal-and-correction-working-packages','private.new_correction_review_nonce_uses',jsonb_build_object('nonce_hash',t.nonce_hash)
 from private.new_correction_review_nonce_uses t where correction_id=p_case
 union all select 'appeal-and-correction-working-packages','private.new_correction_provenance_observations',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_provenance_observations t where correction_id=p_case
 union all select 'appeal-and-correction-working-packages','private.new_correction_delivery',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_delivery t where correction_id=p_case
 union all select 'mail-token-and-rights-delivery-state','private.new_correction_mail_reservations',jsonb_build_object('id',t.id)
 from private.new_correction_mail_reservations t where correction_id=p_case
 union all select 'mail-token-and-rights-delivery-state','public.mail_outbox',jsonb_build_object('id',t.id)
 from public.mail_outbox t where id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.mail_deliveries',jsonb_build_object('id',t.id)
 from public.mail_deliveries t where outbox_id=p_outbox
 union all select 'mail-token-and-rights-delivery-state','public.mail_provider_attempts',jsonb_build_object('id',t.id)
 from public.mail_provider_attempts t where outbox_id=p_outbox
 union all select 'contact-refusal-and-rate-limit-state','public.encrypted_contact_references',jsonb_build_object('id',t.id)
 from public.encrypted_contact_references t where id=p_contact
 union all select 'contact-refusal-and-rate-limit-state','public.contact_hmac_indexes',jsonb_build_object('contact_reference_id',t.contact_reference_id,'hmac_key_revision',t.hmac_key_revision)
 from public.contact_hmac_indexes t where contact_reference_id=p_contact
 union select * from private.new_correction_archive_graph_v1(p_case)
$body$;

-- Allowed coded terminal result, independently immutable. No original/current
-- author/account/session/reviewer ID, contact, prose, key or working binding.
-- The native observed immutable reference/version is retained explicitly; it
-- must not become a historical source row fabricated from an opaque legacy row.
create table private.new_correction_terminal_outcomes (
 correction_id uuid primary key references public.correction_requests(id) on delete restrict,
 format text not null default 'new-correction-coded-outcome-v1' check(format='new-correction-coded-outcome-v1'),
 outcome text not null check(outcome in('rejected','withdrawn','expired')),
 correction_revision bigint not null check(correction_revision>0),
 review_revision bigint not null check(review_revision>0),
 source_kind text not null check(source_kind in('neutral-display-label','disposition-event','identity-profile','report-result','imported-variant-source')),
 source_reference uuid not null,
 observed_field_version bigint not null check(observed_field_version>0),
 provenance_revision bigint not null check(provenance_revision>0),
 native_domain_revision_vector jsonb not null check(jsonb_typeof(native_domain_revision_vector)='object'),
 native_source_fingerprint text not null check(native_source_fingerprint~'^[0-9a-f]{64}$'),
 pseudonymous_reviewer_audit_principal_id uuid references public.audit_principals(id) on delete restrict,
 resolved_at timestamptz not null
);
alter table private.new_correction_terminal_outcomes enable row level security;
revoke all on table private.new_correction_terminal_outcomes from public,anon,authenticated,service_role,inherit_upload_only;
create function private.guard_new_correction_terminal_outcome_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
begin
 if current_user<>'postgres' or tg_op='UPDATE' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_correction_terminal_outcome before insert or update or delete on private.new_correction_terminal_outcomes
 for each row execute function private.guard_new_correction_terminal_outcome_v1();

-- Literal whole-graph closure precedes any unlink. In this NEW producer no
-- evidence, public token, old assignment or old working row is ever issued.
-- Finding one refuses this closed path instead of claiming it deleted an object.
create function private.shred_new_correction_row_v1(p_id uuid,p_expected jsonb,p_state text,p_audit uuid)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; d private.new_correction_delivery; contact public.encrypted_contact_references;
 o public.mail_outbox; t public.retention_rows; p public.retention_due_phases; m public.purge_manifests;
 observed private.new_correction_provenance_observations; ended timestamptz:=clock_timestamp();
 manifest_hash text; inventory_count bigint; phase_envelope jsonb;
begin
 select * into c from public.correction_requests where id=p_id for update;
 select * into d from private.new_correction_delivery where correction_id=c.id for update;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.state not in('submitted','reviewing') or c.review_case_binding is distinct from p_expected
  or p_state is null or p_state not in('rejected','withdrawn','expired') or d.correction_id is null then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 perform private.lock_invitation_transitions_v1();
 select * into t from public.retention_rows where id=d.retention_row_id for update;
 select * into p from public.retention_due_phases where retention_row_id=t.id and phase_id='correction-review-close' and phase_revision=1 for update;
 select * into m from public.purge_manifests where retention_row_id=t.id and phase_id=p.phase_id and phase_revision=p.phase_revision for update;
 select * into o from public.mail_outbox where id=d.outbox_id for update;
 select * into contact from public.encrypted_contact_references where id=d.contact_reference_id for update;
 select * into observed from private.new_correction_provenance_observations where correction_id=c.id for update;
 perform 1 from private.new_correction_mail_reservations where correction_id=c.id order by id for update;
 phase_envelope:=jsonb_build_object('version',1,'caseId',c.id,'format',c.review_case_format,
  'requestedField',c.requested_field,'correctionRevision',c.correction_revision,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline);
 if t.id is null or t.retention_id<>'future-person.correction-review-30d' or t.target_kind<>'correction' or t.target_id is distinct from c.id
  or t.state<>'active' or t.fixed_deadline is distinct from c.review_deadline
  or p.retention_row_id is null or p.phase_deadline is distinct from c.review_deadline or p.target_id is distinct from c.id
  or p.immutable_envelope is distinct from phase_envelope or p.status not in('pending','retry','claimed')
  or m.id is null or m.state<>'frozen' or m.manifest_class<>'review-working'
  or m.source_binding_fingerprint is distinct from encode(extensions.digest(convert_to(phase_envelope::text,'UTF8'),'sha256'),'hex')
  or observed.correction_id is null or contact.id is null or o.id is null
  or d.source_contact_reference_id=d.contact_reference_id
  or contact.correction_case_id is distinct from c.id or contact.principal_id is distinct from c.claimant_principal_id
  or contact.created_at is distinct from c.submitted_at
  or o.correction_case_id is distinct from c.id or o.contact_reference_id is distinct from contact.id
  or o.target_kind<>'correction' or o.target_id is distinct from c.id
  or o.recipient_principal_id is distinct from c.claimant_principal_id
  or exists(select 1 from public.mail_outbox where (target_kind='correction' and target_id=c.id and id<>o.id)
    or(contact_reference_id=contact.id and id<>o.id))
  or exists(select 1 from public.token_candidates where outbox_id=o.id)
  or exists(select 1 from public.future_person_claim_release_credentials where contact_reference_id=contact.id)
  or exists(select 1 from public.legal_evidence_ingest_sessions where target_kind='correction' and target_id=c.id)
  or exists(select 1 from public.correction_assignments where correction_id=c.id)
  or exists(select 1 from public.correction_working_data where correction_id=c.id)
  or exists(select 1 from public.purge_manifest_entries where manifest_id=m.id) then
  raise exception using errcode='0A000',message='correction_disposal_scope_unavailable';end if;
 perform private.close_new_correction_archives_v1(c.id);
 select count(*) into inventory_count from private.new_correction_owned_graph_v1(c.id,contact.id,o.id);
 if inventory_count<5 then
  raise exception using errcode='55000',message='correction_disposal_inventory_unavailable';end if;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m.id,r.target_id,r.store_name,r.row_key,row_number() over(order by r.target_id,r.store_name,r.row_key::text)
 from private.new_correction_owned_graph_v1(c.id,contact.id,o.id) r;
 if exists(select 1 from public.purge_manifest_entries e where manifest_id=m.id and not exists(
  select 1 from public.purge_manifest_class_targets a where a.manifest_class=m.manifest_class and a.target_id=e.target_id)) then
  raise exception using errcode='55000',message='correction_disposal_class_unavailable';end if;
 select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object('target',target_id,'store',store_name,'key',row_key)
  order by entry_revision)::text,'UTF8'),'sha256'),'hex') into manifest_hash from public.purge_manifest_entries where manifest_id=m.id;
 update public.purge_manifests set state='executing',physical_purge_started_at=ended,frozen_manifest_hash=manifest_hash where id=m.id;
 insert into private.new_correction_terminal_outcomes(correction_id,outcome,correction_revision,review_revision,source_kind,
  source_reference,observed_field_version,provenance_revision,native_domain_revision_vector,native_source_fingerprint,
  pseudonymous_reviewer_audit_principal_id,resolved_at)
 values(c.id,p_state,c.correction_revision,c.review_assignment_revision+1,observed.source_kind,observed.source_reference,
  observed.observation_version,observed.provenance_revision,observed.domain_revision_vector,observed.source_fingerprint,p_audit,ended);
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 -- Actual physical deletion, including independently wrapped contact key.
 delete from private.new_correction_case_envelopes where correction_id=c.id;
 delete from private.new_correction_review_nonce_uses where correction_id=c.id;
 delete from private.new_correction_provenance_observations where correction_id=c.id;
 delete from private.new_correction_delivery where correction_id=c.id;
 delete from public.mail_deliveries where outbox_id=o.id;
 delete from public.mail_provider_attempts where outbox_id=o.id;
 delete from public.mail_outbox where id=o.id;
 delete from public.contact_hmac_indexes where contact_reference_id=contact.id;
 delete from public.encrypted_contact_references where id=contact.id;
 delete from private.new_correction_mail_reservations where correction_id=c.id and state='confirmed-no-submission';
 update public.correction_requests set state=p_state,decided_at=ended,terminal_shredded_at=ended,
  statement_ciphertext=null,case_working_ciphertext=null,review_case_wrapped_key=null,
  review_case_binding=null,claimant_principal_id=null,current_reviewer_principal_id=null,
  terminal_reviewer_audit_principal_id=p_audit where id=c.id;
 if exists(select 1 from private.new_correction_owned_graph_v1(c.id,contact.id,o.id)
  where store_name<>'private.new_correction_mail_reservations' and target_id<>'correction-case-export-copies') then
  raise exception using errcode='55000',message='correction_disposal_local_residual';end if;
 -- A remaining reserved/accepted sender is a real external disposition hold.
 -- Never equate a ledger DELETE, provider acceptance, 30 elapsed days, or an
 -- email bounce with deletion of Resend's retained payload.
 update public.purge_manifest_entries set status='deleted' where manifest_id=m.id
  and target_id<>'correction-case-export-copies'
  and(store_name<>'private.new_correction_mail_reservations' or not exists(
   select 1 from private.new_correction_mail_reservations where id=(row_key->>'id')::uuid));
 update public.retention_due_phases set status='cancelled',completed_at=ended,terminal_outcome_code='case-closed',
  claim_token_hash=null,claim_expires_at=null where retention_row_id=t.id and phase_id='correction-acknowledgement' and status<>'succeeded';
 if exists(select 1 from private.new_correction_mail_reservations where correction_id=c.id)
  or exists(select 1 from private.new_correction_archive_cases where correction_id=c.id) then
  update public.retention_due_phases set status='retry',terminal_outcome_code='provider-disposal-pending',
   claim_token_hash=null,claim_expires_at=null where retention_row_id=t.id and phase_id='correction-review-close' and phase_revision=1;
 else
  update public.purge_manifests set state='complete',batch_cursor=inventory_count where id=m.id;
  update public.retention_due_phases set status='succeeded',completed_at=ended,terminal_outcome_code='case-working-material-purged',
   claim_token_hash=null,claim_expires_at=null where retention_row_id=t.id and phase_id='correction-review-close' and phase_revision=1;
  update public.retention_rows set state='complete',ended_at=ended where id=t.id;
 end if;
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=c.id;
end $body$;

-- The concrete sender may call this only if its external send function was
-- never invoked. There is no caller-supplied bool, expiry inference or API grant.
create function private.confirm_new_correction_no_submission_v1(p_reservation uuid)
returns void language plpgsql security invoker set search_path='' as $body$
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='correction_unavailable';end if;
 update private.new_correction_mail_reservations set state='confirmed-no-submission',completed_at=clock_timestamp()
 where id=p_reservation and state='reserved';
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
end $body$;

-- Concrete ACK for the real zero-send branch; no provider-deletion claim.
-- Accepted/uncertain provider branches need a verified provider disposal
-- contract that is absent from current source, and remain pending.
create function private.drain_new_correction_terminal_manifest_v1(p_case uuid)
returns boolean language plpgsql security definer set search_path='' as $body$
declare c public.correction_requests; t public.retention_rows; m public.purge_manifests; count_entries bigint;
begin
 select * into c from public.correction_requests where id=p_case;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=p_case for update;
 select * into t from public.retention_rows where target_kind='correction' and target_id=c.id
  and retention_id='future-person.correction-review-30d' for update;
 select * into m from public.purge_manifests where retention_row_id=t.id and phase_id='correction-review-close' and phase_revision=1 for update;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.state not in('rejected','withdrawn','expired') or c.terminal_shredded_at is null
  or c.review_case_binding is not null or c.claimant_principal_id is not null or c.current_reviewer_principal_id is not null
  or t.fixed_deadline is distinct from c.review_deadline or m.id is null then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if m.state='complete' and t.state='complete' then
  if exists(select 1 from private.new_correction_archive_cases where correction_id=c.id) then raise exception using errcode='55000',message='correction_archive_disposal_residual';end if;return true;end if;
 if m.state<>'executing' or t.state<>'active' then raise exception using errcode='42501',message='correction_unavailable';end if;
 if not private.drain_requester_statement_archive_zero_v1(c.id) then return false;end if;
 update public.purge_manifest_entries e set status='deleted' where e.manifest_id=m.id
  and e.target_id='correction-case-export-copies'
  and private.requester_statement_archive_row_count_v1(e.store_name,e.row_key)=0;
 perform 1 from private.new_correction_mail_reservations where correction_id=c.id order by id for update;
 delete from private.new_correction_mail_reservations where correction_id=c.id and state='confirmed-no-submission'
  and exists(select 1 from public.purge_manifest_entries where manifest_id=m.id
   and store_name='private.new_correction_mail_reservations' and row_key=jsonb_build_object('id',private.new_correction_mail_reservations.id));
 update public.purge_manifest_entries set status='deleted' where manifest_id=m.id
  and store_name='private.new_correction_mail_reservations' and not exists(
   select 1 from private.new_correction_mail_reservations where id=(row_key->>'id')::uuid);
 if exists(select 1 from private.new_correction_mail_reservations where correction_id=c.id)
  or exists(select 1 from public.purge_manifest_entries where manifest_id=m.id and status<>'deleted') then return false;end if;
 select count(*) into count_entries from public.purge_manifest_entries where manifest_id=m.id;
 if count_entries<5 or exists(select 1 from private.new_correction_case_envelopes where correction_id=c.id)
  or exists(select 1 from private.new_correction_delivery where correction_id=c.id)
  or exists(select 1 from private.new_correction_provenance_observations where correction_id=c.id)
  or exists(select 1 from private.new_correction_review_nonce_uses where correction_id=c.id)
  or exists(select 1 from public.mail_outbox where correction_case_id=c.id or(target_kind='correction' and target_id=c.id)) then
  raise exception using errcode='55000',message='correction_disposal_residual';end if;
 update public.purge_manifests set state='complete',batch_cursor=count_entries where id=m.id;
 update public.retention_due_phases set status='succeeded',completed_at=clock_timestamp(),
  terminal_outcome_code='case-working-material-purged',claim_token_hash=null,claim_expires_at=null
 where retention_row_id=t.id and phase_id='correction-review-close' and phase_revision=1;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=t.id;
 return true;
end $body$;
revoke all on function private.new_correction_owned_graph_v1(uuid,uuid,uuid),
 private.guard_new_correction_terminal_outcome_v1(),private.shred_new_correction_row_v1(uuid,jsonb,text,uuid),
 private.confirm_new_correction_no_submission_v1(uuid),private.drain_new_correction_terminal_manifest_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
