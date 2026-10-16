-- SOURCE PROPOSAL ONLY. No migration ID, apply eligibility or default selector.
-- The complete predecessor catalog/ABI/ACL/source guard is deliberately UNBOUND.
-- Bind it only after root source review and native captured predecessor proof.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '5s';
set local jit = off;
do $unbound$
begin
  if current_user <> 'postgres' then
    raise exception using errcode='42501',message='correction_source_owner_required';
  end if;
  raise exception using errcode='55000',message='correction_source_predecessor_unbound';
end $unbound$;

-- Every existing opaque/legacy row retains NULL proof fields. No inferred
-- author, key, assignment, format, field mapping or deadline is backfilled.
alter table public.subject_principals add column reviewer_case_purposes text[];
alter table public.subject_principals add column correction_intake_assignee boolean;
alter table public.subject_principals add constraint correction_purpose_shape check ((
  (reviewer_case_purposes is null and correction_intake_assignee is null)
  or (principal_kind='reviewer' and subject_id is null and account_id is not null
    and reviewer_case_purposes=array['correction']::text[]
    and correction_intake_assignee is not null)
) is true);
create unique index correction_one_current_designated_reviewer
  on public.subject_principals(correction_intake_assignee)
  where status='active' and correction_intake_assignee is true;

alter table public.rights_nonces add column correction_prepare_binding jsonb;
alter table public.correction_requests
  add column review_case_format text,
  add column requested_field text,
  add column review_case_binding jsonb,
  add column review_case_wrapped_key bytea,
  add column case_working_ciphertext bytea,
  add column review_deadline timestamptz,
  add column current_reviewer_principal_id uuid references public.subject_principals(id) on delete restrict,
  add column review_assignment_revision bigint,
  add column terminal_shredded_at timestamptz,
  add column terminal_reviewer_audit_principal_id uuid references public.audit_principals(id) on delete restrict;
-- A new requested field is NEVER mapped to the old four-value semantic enum.
alter table public.correction_requests alter column correction_kind drop not null;
alter table public.correction_requests alter column statement_ciphertext drop not null;
alter table public.correction_requests alter column claimant_principal_id drop not null;
alter table public.correction_requests add constraint correction_new_format_shape check ((
  (review_case_format is null and correction_kind is not null
    and claimant_principal_id is not null and statement_ciphertext is not null
    and requested_field is null and review_case_binding is null and review_case_wrapped_key is null
    and case_working_ciphertext is null and review_deadline is null
    and current_reviewer_principal_id is null and review_assignment_revision is null
    and terminal_shredded_at is null
    and terminal_reviewer_audit_principal_id is null)
  or (review_case_format='reviewer-only-case-statement-v1' and correction_kind is null
    and condition_id is null and requested_field in ('display-label','disposition-record',
      'identity-match-profile','report-provenance','variant-call-source')
    and review_deadline=submitted_at+interval '30 days'
    and review_assignment_revision>0
    and ((state in ('submitted','reviewing') and claimant_principal_id is not null
      and jsonb_typeof(review_case_binding)='object' and review_case_wrapped_key is null
      and statement_ciphertext is null and case_working_ciphertext is null
      and current_reviewer_principal_id is not null and terminal_shredded_at is null
      and terminal_reviewer_audit_principal_id is null)
      or (state in ('rejected','withdrawn','expired') and claimant_principal_id is null
        and review_case_binding is null and review_case_wrapped_key is null
        and statement_ciphertext is null and case_working_ciphertext is null
        and current_reviewer_principal_id is null
        and terminal_shredded_at is not null and terminal_shredded_at=decided_at)))
) is true);

-- Only NEW bodies use this actual independently deletable working row.
-- Legacy public bytes are untouched. No API table role can select its key.
create table private.new_correction_case_envelopes (
 correction_id uuid primary key references public.correction_requests(id) on delete restrict,
 wrapped_case_key bytea not null check(octet_length(wrapped_case_key)=72),
 statement_ciphertext bytea not null check(octet_length(statement_ciphertext) between 48 and 16028),
 working_ciphertext bytea not null check(octet_length(working_ciphertext) between 48 and 16384),
 reviewer_reason_ciphertext bytea check(reviewer_reason_ciphertext is null or octet_length(reviewer_reason_ciphertext) between 48 and 8028)
);
alter table private.new_correction_case_envelopes enable row level security;
revoke all on table private.new_correction_case_envelopes from public,anon,authenticated,service_role,inherit_upload_only;

-- Only POST records a consumed review nonce. GET writes no case/nonce row.
-- This new credential table remains entirely API-denied and is removed by
-- the exact case row shred. It is not an export or a provider-disposal ACK.
create table private.new_correction_review_nonce_uses (
 nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
 correction_id uuid not null references public.correction_requests(id) on delete restrict,
 consumed_at timestamptz not null default clock_timestamp()
);
alter table private.new_correction_review_nonce_uses enable row level security;
revoke all on table private.new_correction_review_nonce_uses from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY. Insert these definitions after the NEW case schema and before
-- the NEW intake/read bodies. The complete predecessor guard stays UNBOUND.
-- No old body, scientific payload, ciphertext or principal is reinterpreted.
create table private.new_correction_provenance_observations (
 correction_id uuid primary key references public.correction_requests(id) on delete restrict,
 source_reference uuid not null unique default gen_random_uuid(),
 observation_version bigint not null check(observation_version>0),
 provenance_revision bigint not null check(provenance_revision>0),
 source_kind text not null check(source_kind in('neutral-display-label','disposition-event',
  'identity-profile','report-result','imported-variant-source')),
 domain_revision_vector jsonb not null check(jsonb_typeof(domain_revision_vector)='object'),
 source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
 affected_result_count bigint not null check(affected_result_count>=0),
 analysis_stopped boolean not null,
 observed_at timestamptz not null default clock_timestamp()
);
alter table private.new_correction_provenance_observations enable row level security;
revoke all on table private.new_correction_provenance_observations
 from public,anon,authenticated,service_role,inherit_upload_only;

-- All collection members participate, including old/superseded/nonreportable
-- rows and literal absence. No reference selects one convenient result.
-- Raw source values are digested inside Postgres and never enter the GET DTO.
create function private.new_correction_source_frame_v1(p_subject uuid,p_field text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare s public.subjects; e public.embryos; cp public.future_person_claimant_principals;
 sp public.subject_principals; x private.future_person_custody_slices; f public.genome_files;
 canonical private.embryo_canonical_sources; source jsonb; revisions jsonb;
 results jsonb; job_controls jsonb; affected bigint; stopped boolean; kind text; applicable_jobs uuid[];
begin
 select * into s from public.subjects where id=p_subject for share;
 select * into e from public.embryos where subject_id=s.id for share;
 select * into cp from public.future_person_claimant_principals where id=s.claimant_principal_id for share;
 select * into sp from public.subject_principals where id=cp.principal_id for share;
 select * into x from private.future_person_custody_slices where subject_id=s.id for share;
 select * into canonical from private.embryo_canonical_sources where file_id=x.source_file_id for share;
 select * into f from public.genome_files where id=x.source_file_id for share;
 if s.id is null or e.id is null or cp.id is null or sp.id is null or x.subject_id is null
  or canonical.file_id is null or f.id is null or p_field is null
  or p_field not in('display-label','disposition-record','identity-match-profile','report-provenance','variant-call-source')
  or s.subject_class<>'embryo' or s.lifecycle<>'claimed_unbound'
  or s.owner_account_id is not null or s.subject_account_id is not null or s.cohort_id is not null
  or e.cohort_id is not null or e.status<>'claimed_unbound' or e.subject_id is distinct from s.id
  or cp.status<>'current' or cp.principal_id is distinct from sp.id
  or x.claimant_principal_id is distinct from cp.id or sp.subject_id is distinct from s.id
  or sp.status<>'active' or sp.principal_kind<>'future_person' or sp.account_id is not null
  or canonical.subject_id is distinct from s.id or canonical.embryo_id is distinct from e.id
  or canonical.source_sha256 is distinct from x.source_sha256
  or canonical.membership_sha256 is distinct from x.source_membership_sha256
  or canonical.publication_revision is distinct from x.publication_revision
  or f.subject_id is distinct from s.id or f.user_id is not null or f.cohort_id is not null or f.is_cohort_file
  or (select count(*) from public.embryos where subject_id=s.id)<>1
  or (select count(*) from public.genome_files where subject_id=s.id)<>1
 then raise exception using errcode='42501',message='correction_unavailable';end if;

 -- Lock the same complete physical collections before their exact census.
 -- Every writer/terminal route must share the subject-first order. Native
 -- compilation/races must prove that composition before this source opens.
 perform 1 from public.embryo_scores where embryo_id=e.id order by id for share;
 perform 1 from public.embryo_figures where finding_id in(select id from public.embryo_scores where embryo_id=e.id) order by id for share;
 perform 1 from public.report_artifacts where subject_id=s.id order by id for share;
 perform 1 from public.user_prs where (subject_id=s.id or file_id=f.id) order by id for share;
 perform 1 from public.ancestry_results where (subject_id=s.id or file_id=f.id) order by id for share;
 perform 1 from public.ancestry_regions where (subject_id=s.id or ancestry_result_id in(
  select id from public.ancestry_results where subject_id=s.id or file_id=f.id)) order by ancestry_result_id,region_code for share;
 perform 1 from public.portrait_results where parent_a_subject_id=s.id or parent_b_subject_id=s.id order by id for share;
 if exists(select 1 from public.user_prs where file_id=f.id and subject_id is distinct from s.id)
  or exists(select 1 from public.ancestry_results where file_id=f.id and subject_id is distinct from s.id)
  or exists(select 1 from public.user_variants where file_id=f.id and subject_id is distinct from s.id)
  or exists(select 1 from public.report_observed_calls where file_id=f.id and subject_id is distinct from s.id)
  or exists(select 1 from public.ancestry_regions where ancestry_result_id in(
   select id from public.ancestry_results where subject_id=s.id or file_id=f.id) and subject_id is distinct from s.id) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 perform private.assert_future_person_settled_source_v1(f.id);
 perform 1 from public.family_pairs where subject_a_id=s.id or subject_b_id=s.id order by id for share;
 -- Original immutable ingest and historical-cohort work can concern this source
 -- even after claimant detach. Include that complete conservative census;
 -- do not equate missing live ingest rows with completed publication.
 select coalesce(array_agg(w.id order by w.id),'{}'::uuid[]) into applicable_jobs
 from public.worker_jobs w where w.subject_id=s.id or w.file_id=f.id
  or w.id=canonical.worker_job_id or w.cohort_id=x.historical_cohort_id
  or (w.source_binding_kind='genome-file' and w.source_binding_id=f.id)
  or (w.source_binding_kind='embryo-ingest-fragment-set' and w.source_binding_id=canonical.session_id)
  or (w.source_binding_kind='cohort-source-set' and w.source_binding_id=x.historical_cohort_id)
  or (w.source_binding_kind='family-pair-source-set' and w.source_binding_id in(
   select id from public.family_pairs where subject_a_id=s.id or subject_b_id=s.id));
 perform 1 from public.worker_jobs where id=any(applicable_jobs) order by id for share;
 perform 1 from public.analysis_jobs where worker_job_id=any(applicable_jobs) order by id for share;
 select coalesce(jsonb_agg(jsonb_build_object('store',store,'key',key,'row',row) order by store,key),'[]') into results from (
  select 'public.embryo_scores' store,id::text key,to_jsonb(t) row from public.embryo_scores t where embryo_id=e.id
  union all select 'public.report_artifacts',id::text,to_jsonb(t) from public.report_artifacts t where subject_id=s.id
  union all select 'public.user_prs',id::text,to_jsonb(t) from public.user_prs t where (subject_id=s.id or file_id=f.id)
  union all select 'public.ancestry_results',id::text,to_jsonb(t) from public.ancestry_results t where (subject_id=s.id or file_id=f.id)
  union all select 'public.portrait_results',id::text,to_jsonb(t) from public.portrait_results t where parent_a_subject_id=s.id or parent_b_subject_id=s.id
 ) complete_results;
 select jsonb_build_object(
  'analysisStoppedAt',s.analysis_stopped_at,
  'sourcePublicationState',f.source_publication_state,'sourcePublicationRevision',f.source_publication_revision,
  'settledCanonical',jsonb_build_object('sessionId',canonical.session_id,'workerId',canonical.worker_job_id,
   'attempt',canonical.attempt,'publicationRevision',canonical.publication_revision),
  'familyPairs',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.family_pairs p
   where p.subject_a_id=s.id or p.subject_b_id=s.id),'[]'),
  'workers',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.worker_jobs w where w.id=any(applicable_jobs)),'[]'),
  'analysisJobs',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.analysis_jobs a where a.worker_job_id=any(applicable_jobs)),'[]')) into job_controls;
 -- Absence of a profile/result/case never means analysis is stopped.
 stopped:=s.analysis_stopped_at is not null and f.source_publication_state='published'
  and f.source_publication_revision=canonical.publication_revision
  and not exists(select 1 from public.worker_jobs where id=any(applicable_jobs) and status in('queued','running')
   and output_kind in('ingest.normalize','embryo.single-locus','embryo.statistical-estimate','embryo.carrier-match','family.portrait','ancestry.estimate'))
  and not exists(select 1 from public.analysis_jobs where state in('pending','running') and worker_job_id in(
   select id from public.worker_jobs where id=any(applicable_jobs)
    and output_kind in('ingest.normalize','embryo.single-locus','embryo.statistical-estimate','embryo.carrier-match','family.portrait','ancestry.estimate')));
 affected:=case when p_field in('report-provenance','variant-call-source') then jsonb_array_length(results) else 0 end;
 revisions:=jsonb_build_object('subjectBinding',s.subject_binding_revision,'subjectLifecycle',s.lifecycle_revision,
  'claimantRelease',cp.release_revision,'claimantPrincipal',sp.principal_revision,
  'canonicalPublication',canonical.publication_revision,'fileContent',f.export_content_revision);
 case p_field
 when 'display-label' then
  kind:='neutral-display-label';source:=jsonb_build_object('label',s.display_label,'subject',to_jsonb(s));
 when 'disposition-record' then
  kind:='disposition-event';
  perform 1 from public.embryo_disposition_proposals where embryo_id=e.id order by id for share;
  perform 1 from public.embryo_disposition_confirmations where proposal_id in(
   select id from public.embryo_disposition_proposals where embryo_id=e.id) order by proposal_id,confirmer_principal_id for share;
  source:=jsonb_build_object('embryo',to_jsonb(e),'proposals',coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
   from public.embryo_disposition_proposals p where p.embryo_id=e.id),'[]'),
   'confirmations',coalesce((select jsonb_agg(to_jsonb(c) order by c.proposal_id,c.confirmer_principal_id)
    from public.embryo_disposition_confirmations c where c.proposal_id in(select id from public.embryo_disposition_proposals where embryo_id=e.id)),'[]'));
  revisions:=revisions||jsonb_build_object('embryoDisposition',e.disposition_revision);
 when 'identity-match-profile' then
  kind:='identity-profile';
  perform 1 from public.future_person_identity where embryo_id=e.id order by identity_revision,id for share;
  source:=coalesce((select jsonb_agg(to_jsonb(i) order by i.identity_revision,i.id)
   from public.future_person_identity i where i.embryo_id=e.id),'[]');
  revisions:=revisions||jsonb_build_object('allIdentityRevisions',coalesce((select jsonb_agg(jsonb_build_object(
   'identityRevision',i.identity_revision,'state',i.state,'profileFormat',i.profile_format_version)
    order by i.identity_revision,i.id) from public.future_person_identity i where i.embryo_id=e.id),'[]'));
 when 'report-provenance' then
  kind:='report-result';source:=jsonb_build_object('allResults',results,
   'figures',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.embryo_figures t where finding_id in(
    select id from public.embryo_scores where embryo_id=e.id)),'[]'),
   'ancestryRegions',coalesce((select jsonb_agg(to_jsonb(t) order by ancestry_result_id,region_code)
    from public.ancestry_regions t where (subject_id=s.id or ancestry_result_id in(
     select id from public.ancestry_results where subject_id=s.id or file_id=f.id))),'[]'));
 when 'variant-call-source' then
  kind:='imported-variant-source';
  perform 1 from public.embryo_variants where embryo_id=e.id order by id for share;
  perform 1 from public.user_variants where (subject_id=s.id or file_id=f.id) order by id for share;
  perform 1 from public.report_observed_calls where (subject_id=s.id or file_id=f.id) order by file_id,source_line for share;
  perform 1 from private.embryo_canonical_source_parts where file_id=f.id order by sequence for share;
  source:=jsonb_build_object('canonical',to_jsonb(canonical),'custody',to_jsonb(x),'file',to_jsonb(f),
   'parts',coalesce((select jsonb_agg(to_jsonb(t) order by sequence) from private.embryo_canonical_source_parts t where file_id=f.id),'[]'),
   'embryoVariants',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.embryo_variants t where embryo_id=e.id),'[]'),
   'subjectVariants',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.user_variants t where (subject_id=s.id or file_id=f.id)),'[]'),
   'observedCalls',coalesce((select jsonb_agg(to_jsonb(t) order by file_id,source_line) from public.report_observed_calls t where (subject_id=s.id or file_id=f.id)),'[]'));
 end case;
 return jsonb_build_object('sourceKind',kind,'domainRevisionVector',revisions,
  'sourceFingerprint',encode(extensions.digest(convert_to(jsonb_build_object('version',1,'field',p_field,
   'subjectAuthority',to_jsonb(s),'claimant',to_jsonb(cp),'principal',to_jsonb(sp),
   'source',source,'allResults',results,'jobControls',job_controls,'domainRevisions',revisions)::text,'UTF8'),'sha256'),'hex'),
  'affectedResultCount',affected,'analysisStopped',stopped);
end $body$;

-- The observation revision is a genuine new native capture. It is not a
-- pretend legacy domain revision or a number manufactured from a hash.
-- Initial capture is called atomically by intake. Later refresh is an
-- owner/maintenance operation over actual changed source; GET never refreshes.
create function private.capture_new_correction_provenance_v1(p_id uuid)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; frame jsonb; old private.new_correction_provenance_observations;
begin
 select * into c from public.correction_requests where id=p_id;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=p_id for update;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.state not in('submitted','reviewing') or c.review_deadline<=clock_timestamp()
  or c.claimant_principal_id is distinct from (select cp.principal_id from public.subjects s
   join public.future_person_claimant_principals cp on cp.id=s.claimant_principal_id and cp.status='current'
   where s.id=c.subject_id)
  or c.review_case_binding->'scope'->>'originalAuthorPrincipalId' is distinct from c.claimant_principal_id::text
  or c.review_case_binding->'scope'->>'originalSubjectId' is distinct from c.subject_id::text then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 frame:=private.new_correction_source_frame_v1(c.subject_id,c.requested_field);
 select * into old from private.new_correction_provenance_observations where correction_id=c.id for update;
 if old.correction_id is null then
  insert into private.new_correction_provenance_observations(correction_id,observation_version,provenance_revision,
   source_kind,domain_revision_vector,source_fingerprint,affected_result_count,analysis_stopped)
  values(c.id,1,1,frame->>'sourceKind',frame->'domainRevisionVector',frame->>'sourceFingerprint',
   (frame->>'affectedResultCount')::bigint,(frame->>'analysisStopped')::boolean);
 elsif old.source_fingerprint is distinct from frame->>'sourceFingerprint' then
  update private.new_correction_provenance_observations set observation_version=observation_version+1,
   provenance_revision=provenance_revision+1,source_kind=frame->>'sourceKind',domain_revision_vector=frame->'domainRevisionVector',
   source_fingerprint=frame->>'sourceFingerprint',affected_result_count=(frame->>'affectedResultCount')::bigint,
   analysis_stopped=(frame->>'analysisStopped')::boolean,observed_at=clock_timestamp() where correction_id=c.id;
 end if;
end $body$;

create function private.current_new_correction_provenance_v1(p_case public.correction_requests)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare observed private.new_correction_provenance_observations; actual jsonb;
begin
 if p_case.claimant_principal_id is null or p_case.claimant_principal_id is distinct from
  (select cp.principal_id from public.subjects s join public.future_person_claimant_principals cp
   on cp.id=s.claimant_principal_id and cp.status='current' where s.id=p_case.subject_id)
  or p_case.review_case_binding->'scope'->>'originalAuthorPrincipalId' is distinct from p_case.claimant_principal_id::text
  or p_case.review_case_binding->'scope'->>'originalSubjectId' is distinct from p_case.subject_id::text then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into observed from private.new_correction_provenance_observations where correction_id=p_case.id for share;
 actual:=private.new_correction_source_frame_v1(p_case.subject_id,p_case.requested_field);
 if observed.correction_id is null or observed.source_fingerprint is distinct from actual->>'sourceFingerprint'
  or observed.source_kind is distinct from actual->>'sourceKind'
  or observed.domain_revision_vector is distinct from actual->'domainRevisionVector'
  or observed.affected_result_count is distinct from (actual->>'affectedResultCount')::bigint
  or observed.analysis_stopped is distinct from (actual->>'analysisStopped')::boolean then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return jsonb_build_object('fieldVersion',observed.observation_version,'sourceKind',observed.source_kind,
  'sourceReference',observed.source_reference,'provenanceRevision',observed.provenance_revision,
  'affectedResultCount',observed.affected_result_count,'analysisStopped',observed.analysis_stopped);
end $body$;
revoke all on function private.new_correction_source_frame_v1(uuid,text),
 private.capture_new_correction_provenance_v1(uuid),private.current_new_correction_provenance_v1(public.correction_requests)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY, under the unbound predecessor fence. Insert after NEW case
-- schema and before intake bodies. No generic mail selector is changed here.
alter table public.mail_outbox add column correction_case_id uuid
 references public.correction_requests(id) on delete restrict;
alter table public.encrypted_contact_references add column correction_case_id uuid
 references public.correction_requests(id) on delete restrict;
-- A case contact is not a new current shared contact. All existing current
-- contact selectors retain their exact bodies and cannot choose this copy.
-- The predecessor catalog fence must verify this exact original constraint.
alter table public.encrypted_contact_references drop constraint encrypted_contact_references_status_check;
alter table public.encrypted_contact_references add constraint encrypted_contact_references_status_check
 check ((correction_case_id is null and status in('current','rotated','shredded'))
  or(correction_case_id is not null and status='correction-case-working'));
alter table public.mail_provider_attempts add column correction_case_id uuid
 references public.correction_requests(id) on delete restrict;
alter table public.mail_deliveries add column correction_case_id uuid
 references public.correction_requests(id) on delete restrict;
create table private.new_correction_delivery (
 correction_id uuid primary key references public.correction_requests(id) on delete restrict,
 contact_reference_id uuid not null unique references public.encrypted_contact_references(id) on delete restrict,
 -- Native intake receipt only, no FK/lifetime hold on the original contact.
 source_contact_reference_id uuid not null,
 outbox_id uuid not null unique references public.mail_outbox(id) on delete restrict,
 retention_row_id uuid not null unique references public.retention_rows(id) on delete restrict,
 acknowledgement_deadline timestamptz not null
);
-- The native reserved attempt is committed BEFORE any provider call. A lost
-- send/COMMIT stays reserved; elapsed lease time never proves no provider write.
create table private.new_correction_mail_reservations (
 id uuid primary key default gen_random_uuid(),
 correction_id uuid not null references public.correction_requests(id) on delete restrict,
 outbox_id uuid not null,
 attempt_ordinal smallint not null check(attempt_ordinal between 1 and 10),
 idempotency_key text not null unique check(idempotency_key~'^[0-9a-f]{64}$'),
 state text not null default 'reserved' check(state in('reserved','accepted','confirmed-no-submission')),
 reserved_at timestamptz not null default clock_timestamp(),
 provider_message_id_hmac text check(provider_message_id_hmac is null or provider_message_id_hmac~'^[0-9a-f]{64}$'),
 -- Exact encrypted handle from the actual accepted response, held only for
 -- unresolved provider disposal. A hash alone cannot address a future erase.
 provider_id_ciphertext bytea check(provider_id_ciphertext is null or octet_length(provider_id_ciphertext) between 29 and 4124),
 completed_at timestamptz,
 check((state='reserved' and provider_message_id_hmac is null and provider_id_ciphertext is null and completed_at is null)
  or(state='accepted' and provider_message_id_hmac is not null and provider_id_ciphertext is not null and completed_at is not null)
  or(state='confirmed-no-submission' and provider_message_id_hmac is null and provider_id_ciphertext is null and completed_at is not null)),
 unique(outbox_id,attempt_ordinal)
);
create unique index new_correction_one_actual_provider_message
 on private.new_correction_mail_reservations(provider_message_id_hmac)
 where provider_message_id_hmac is not null;
-- Native transaction-local mutation permit. No caller-writable GUC, client
-- role string, generic cleanup flag or API grant can manufacture this row.
create table private.new_correction_mail_mutation_context (
 backend_pid integer not null, transaction_id bigint not null,
 correction_id uuid not null, primary key(backend_pid,transaction_id,correction_id)
);
alter table private.new_correction_delivery enable row level security;
alter table private.new_correction_mail_reservations enable row level security;
alter table private.new_correction_mail_mutation_context enable row level security;
revoke all on table private.new_correction_delivery,private.new_correction_mail_reservations,
 private.new_correction_mail_mutation_context from public,anon,authenticated,service_role,inherit_upload_only;

create function private.guard_new_correction_outbox_v1()
returns trigger language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
declare case_id uuid; contact_case uuid;
begin
 case_id:=case when tg_op='DELETE' then old.correction_case_id else new.correction_case_id end;
 if tg_op<>'DELETE' then
  select correction_case_id into contact_case from public.encrypted_contact_references where id=new.contact_reference_id;
  if contact_case is not null and case_id is distinct from contact_case then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 end if;
 if tg_op='UPDATE' and (old.correction_case_id is not null or new.correction_case_id is not null)
  and (new.correction_case_id is distinct from old.correction_case_id
   or new.id is distinct from old.id or new.contact_reference_id is distinct from old.contact_reference_id
   or new.recipient_principal_id is distinct from old.recipient_principal_id
   or new.recipient_authority_revision is distinct from old.recipient_authority_revision
   or new.semantic_revision is distinct from old.semantic_revision
   or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
   or new.idempotency_key is distinct from old.idempotency_key or new.template_id is distinct from old.template_id
   or new.template_payload is distinct from old.template_payload or new.token_purpose is distinct from old.token_purpose
   or new.token_target_id is distinct from old.token_target_id or new.target_kind is distinct from old.target_kind
   or new.target_id is distinct from old.target_id or new.purpose is distinct from old.purpose) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if case_id is not null then
  if current_user<>'postgres' or not exists(select 1 from private.new_correction_mail_mutation_context
    where backend_pid=pg_backend_pid() and transaction_id=txid_current() and correction_id=case_id) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  if tg_op<>'DELETE' and (new.template_id<>'future-person-correction-acknowledgement'
   or new.purpose<>'future-person-correction-acknowledgement' or new.target_kind<>'correction'
   or new.target_id is distinct from case_id or new.template_payload is distinct from '{}'::jsonb
   or new.token_purpose is not null or new.token_target_id is not null) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 elsif tg_op<>'DELETE' and (new.template_id='future-person-correction-acknowledgement'
  or new.purpose='future-person-correction-acknowledgement') then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_correction_outbox before insert or update or delete on public.mail_outbox
 for each row execute function private.guard_new_correction_outbox_v1();

create function private.guard_new_correction_contact_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid;
begin
 case_id:=case when tg_op='DELETE' then old.correction_case_id else new.correction_case_id end;
 if tg_op='UPDATE' and(old.correction_case_id is not null or new.correction_case_id is not null) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if case_id is not null then
  if current_user<>'postgres' then raise exception using errcode='42501',message='correction_unavailable';end if;
  if tg_op<>'DELETE' and new.status<>'correction-case-working' then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  if not exists(select 1 from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and correction_id=case_id) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_correction_contact before insert or update or delete on public.encrypted_contact_references
 for each row execute function private.guard_new_correction_contact_v1();

create function private.guard_new_correction_contact_index_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare contact_case uuid;
begin
 if tg_op='UPDATE' and exists(select 1 from public.encrypted_contact_references
  where id=old.contact_reference_id and correction_case_id is not null) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select correction_case_id into contact_case from public.encrypted_contact_references
 where id=case when tg_op='DELETE' then old.contact_reference_id else new.contact_reference_id end;
 if contact_case is not null then
  if tg_op<>'DELETE' or current_user<>'postgres' then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  if not exists(select 1 from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and correction_id=contact_case) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_correction_contact_index before insert or update or delete on public.contact_hmac_indexes
 for each row execute function private.guard_new_correction_contact_index_v1();

create function private.guard_new_correction_mail_child_v1()
returns trigger language plpgsql security invoker set search_path='' as $body$
declare case_id uuid; declared_case uuid; outbox uuid;
begin
 outbox:=case when tg_op='DELETE' then old.outbox_id else new.outbox_id end;
 declared_case:=case when tg_op='DELETE' then old.correction_case_id else new.correction_case_id end;
 select correction_case_id into case_id from public.mail_outbox where id=outbox;
 if tg_op='UPDATE' and(old.correction_case_id is not null or new.correction_case_id is not null)
  and(new.id is distinct from old.id or new.outbox_id is distinct from old.outbox_id
   or new.correction_case_id is distinct from old.correction_case_id) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if declared_case is not null or case_id is not null then
  if declared_case is distinct from case_id or current_user<>'postgres' then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  if not exists(select 1 from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and correction_id=case_id) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $body$;
create trigger guard_new_correction_mail_attempt before insert or update or delete on public.mail_provider_attempts
 for each row execute function private.guard_new_correction_mail_child_v1();
create trigger guard_new_correction_mail_delivery before insert or update or delete on public.mail_deliveries
 for each row execute function private.guard_new_correction_mail_child_v1();

create function private.new_correction_claimant_contact_v1(p_rs public.rights_sessions)
returns public.encrypted_contact_references language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare contact public.encrypted_contact_references;
begin
 select e.* into contact from public.token_hashes h
 join public.token_candidates tc on tc.id=h.candidate_id
 join public.future_person_claim_release_credentials release on release.candidate_id=tc.id
 join public.future_person_claimant_principals cp on cp.id=release.claimant_principal_id
 join public.subjects s on s.id=release.subject_id and s.claimant_principal_id=cp.id
 join public.subject_principals sp on sp.id=cp.principal_id
 join public.encrypted_contact_references e on e.id=release.contact_reference_id
 where h.id=p_rs.token_hash_id and h.status='consumed' and release.credential_hash=h.token_hash
  and cp.release_revision=p_rs.authority_revision and cp.release_revision=release.credential_revision
  and s.lifecycle_revision=release.subject_lifecycle_revision and s.subject_binding_revision=release.subject_binding_revision
  and p_rs.purpose='approved-future-person-release'
  and p_rs.target_kind='claimed-subject' and p_rs.target_id=s.id and p_rs.principal_id=sp.id
  and release.status='consumed' and release.expires_at>clock_timestamp()
  and cp.status='current' and cp.contact_expires_at>clock_timestamp()
  and s.lifecycle='claimed_unbound' and s.subject_account_id is null
  and sp.principal_kind='future_person' and sp.status='active' and sp.account_id is null
  and e.principal_id=sp.id and e.authority_revision=sp.principal_revision
  and e.status='current' and e.contact_ciphertext is not null for share of e;
 if contact.id is null then raise exception using errcode='42501',message='correction_unavailable';end if;
 return contact;
end $body$;

-- An internal, explicitly stricter target: enqueue immediately and submit within
-- 24 calendar hours. It cannot be later than the registered five business days.
-- It does not redefine jurisdictional business calendars or extend 30 days.
create function private.new_correction_ack_target_v1(p_submitted timestamptz)
returns timestamptz language sql immutable security definer set search_path='' set timezone='UTC' as $body$
 select p_submitted+interval '24 hours'
$body$;

create function public.read_new_correction_intake_contact_v1(p_session_hash text,p_nonce text,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; n public.rights_nonces; contact public.encrypted_contact_references;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 select * into n from public.rights_nonces where rights_session_id=rs.id
  and nonce_hash=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex') for share;
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'correct','api.future-person-correction')
  or n.correction_prepare_binding is null or n.correction_prepare_binding is distinct from p_expected
  or n.consumed_at is not null or n.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 contact:=private.new_correction_claimant_contact_v1(rs);
 if contact.id::text is distinct from p_expected->>'sourceContactReferenceId'
  or encode(extensions.digest(contact.contact_ciphertext,'sha256'),'hex') is distinct from p_expected->>'sourceContactFingerprint'
  or p_expected->>'rightsSessionId' is distinct from rs.id::text
  or p_expected->>'tokenHashId' is distinct from rs.token_hash_id::text
  or (p_expected->>'authorityRevision')::bigint is distinct from rs.authority_revision then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return jsonb_build_object('caseContactId',p_expected->>'caseContactId',
  'sourceContactCiphertextHex',encode(contact.contact_ciphertext,'hex'));
 -- This ciphertext is internal only. No contact leaves an intake response.
end $body$;

create function private.queue_new_correction_ack_v1(p_case uuid,p_rs public.rights_sessions,
 p_expected jsonb,p_contact_cipher bytea,p_contact_set jsonb)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; contact public.encrypted_contact_references;
 contact_id uuid; outbox_id uuid:=gen_random_uuid(); v_retention_id uuid; envelope jsonb;
 contact_set jsonb; active_revision bigint; acknowledgement_target timestamptz;
begin
 select * into c from public.correction_requests where id=p_case for update;
 contact:=private.new_correction_claimant_contact_v1(p_rs);
 contact_id:=(p_expected->>'caseContactId')::uuid;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.review_case_binding is distinct from p_expected or c.state<>'submitted'
  or c.claimant_principal_id is distinct from p_rs.principal_id or c.subject_id is distinct from p_rs.target_id
  or c.review_deadline<>c.submitted_at+interval '30 days' or c.review_deadline<=clock_timestamp()
  or contact.id::text is distinct from p_expected->>'sourceContactReferenceId'
  or encode(extensions.digest(contact.contact_ciphertext,'sha256'),'hex') is distinct from p_expected->>'sourceContactFingerprint'
  or contact_id is null or contact_id=contact.id or p_contact_cipher is null
  or octet_length(p_contact_cipher) not between 29 and 16384
  or exists(select 1 from private.new_correction_delivery where correction_id=c.id)
  or exists(select 1 from public.mail_outbox where target_kind='correction' and target_id=c.id) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 contact_set:=private.resolve_hmac_set_v1('contact',null,p_contact_set);
 active_revision:=private.hmac_active_revision_v1('contact');
 acknowledgement_target:=private.new_correction_ack_target_v1(c.submitted_at);
 if acknowledgement_target<=clock_timestamp() then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 perform private.lock_invitation_transitions_v1();
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,
  authority_revision,created_at,status,correction_case_id) values(contact_id,c.claimant_principal_id,p_contact_cipher,
  contact_set->>active_revision::text,active_revision,contact.authority_revision,c.submitted_at,'correction-case-working',c.id);
 -- The case copy deliberately issues no global contact lookup/refusal index.
 -- Native validation still checks the actual submitted complete keyring set.
 insert into public.mail_outbox(id,template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,template_payload,expires_at,created_at,correction_case_id)
 values(outbox_id,'future-person-correction-acknowledgement','future-person-correction-acknowledgement','correction',c.id,
  c.claimant_principal_id,contact_id,contact.authority_revision,c.correction_revision,
  encode(extensions.digest(convert_to('new-correction-ack-v1|'||c.id||'|'||c.correction_revision,'UTF8'),'sha256'),'hex'),
  '{}',acknowledgement_target,c.submitted_at,c.id);
 envelope:=jsonb_build_object('version',1,'caseId',c.id,'format',c.review_case_format,
  'requestedField',c.requested_field,'correctionRevision',c.correction_revision,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline);
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
  disposition_revision,fixed_deadline,state)
 values('future-person.correction-review-30d','correction',c.id,c.correction_revision,
  (select lifecycle_revision from public.subjects where id=c.subject_id),1,c.review_deadline,'active') returning id into v_retention_id;
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
  target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 select v_retention_id,'future-person.correction-review-30d',phase_id,phase_kind,1,
  case when phase_id='correction-acknowledgement' then acknowledgement_target else c.review_deadline end,
  'correction',c.id,(select lifecycle_revision from public.subjects where id=c.subject_id),1,
  'current-correction-case',c.correction_revision,envelope
 from public.retention_phase_registry where retention_id='future-person.correction-review-30d';
 if (select count(*) from public.retention_due_phases where retention_row_id=v_retention_id)<>2 then
  raise exception using errcode='55000',message='correction_retention_unavailable';end if;
 insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(v_retention_id,'correction-review-close',1,'review-working',1,
  encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex'));
 insert into private.new_correction_delivery values(c.id,contact_id,contact.id,outbox_id,v_retention_id,acknowledgement_target);
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=c.id;
end $body$;

-- One exact queue member, committed reservation, no contact/key in this DTO.
create function private.reserve_new_correction_ack_v1(p_case uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; d private.new_correction_delivery; o public.mail_outbox;
 reservation private.new_correction_mail_reservations;
begin
 select * into c from public.correction_requests where id=p_case;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=p_case for update;
 select * into d from private.new_correction_delivery where correction_id=c.id for update;
 perform private.lock_invitation_transitions_v1();
 select * into o from public.mail_outbox where id=d.outbox_id for update;
 if c.id is null or d.correction_id is null or c.state not in('submitted','reviewing')
  or c.review_case_format is distinct from 'reviewer-only-case-statement-v1' or c.review_deadline<=clock_timestamp()
  or o.id is null or o.correction_case_id is distinct from c.id
  or (o.state<>'queued' and not(o.state='claimed' and o.claimed_at<clock_timestamp()-interval '10 minutes'
   and exists(select 1 from private.new_correction_mail_reservations
    where outbox_id=o.id and attempt_ordinal=o.attempt_count and state='confirmed-no-submission')))
  or o.not_before>clock_timestamp() or o.expires_at<=clock_timestamp() or o.attempt_count>=10
  or exists(select 1 from private.new_correction_mail_reservations where correction_id=c.id and state in('reserved','accepted')) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 update public.mail_outbox set state='claimed',attempt_count=attempt_count+1,claimed_at=clock_timestamp()
  where id=o.id returning * into o;
 insert into private.new_correction_mail_reservations(correction_id,outbox_id,attempt_ordinal,idempotency_key)
 values(c.id,o.id,o.attempt_count,encode(extensions.digest(convert_to(
  'new-correction-ack-attempt-v1|'||o.id||'|'||o.attempt_count,'UTF8'),'sha256'),'hex')) returning * into reservation;
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=c.id;
 return jsonb_build_object('reservationId',reservation.id,'caseId',c.id,'idempotencyKey',reservation.idempotency_key);
end $body$;

-- Called inside the actual transaction that spans provider send. The locks stay
-- held until the adapter completes/COMMITs. This has no API execute grant.
create function private.lock_new_correction_ack_send_v1(p_reservation uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare reservation private.new_correction_mail_reservations; c public.correction_requests;
 d private.new_correction_delivery; o public.mail_outbox; contact public.encrypted_contact_references;
 cp public.future_person_claimant_principals; sp public.subject_principals;
begin
 select * into reservation from private.new_correction_mail_reservations where id=p_reservation;
 select * into c from public.correction_requests where id=reservation.correction_id;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=c.id for update;
 select * into cp from public.future_person_claimant_principals where id=(select claimant_principal_id from public.subjects where id=c.subject_id) for share;
 select * into sp from public.subject_principals where id=c.claimant_principal_id for share;
 select * into d from private.new_correction_delivery where correction_id=c.id for update;
 perform private.lock_invitation_transitions_v1();
 select * into o from public.mail_outbox where id=d.outbox_id for update;
 select * into contact from public.encrypted_contact_references where id=d.contact_reference_id for share;
 select * into reservation from private.new_correction_mail_reservations where id=p_reservation for update;
 if c.id is null or d.correction_id is null or reservation.id is null or reservation.state<>'reserved'
  or c.review_case_format is distinct from 'reviewer-only-case-statement-v1' or c.state not in('submitted','reviewing')
  or c.review_deadline<=clock_timestamp() or d.acknowledgement_deadline<=clock_timestamp()
  or cp.status<>'current' or cp.principal_id is distinct from c.claimant_principal_id
  or cp.release_revision is distinct from(c.review_case_binding->>'authorityRevision')::bigint
  or sp.status<>'active' or sp.principal_kind<>'future_person' or sp.account_id is not null
  or o.id is null or o.state<>'claimed' or o.correction_case_id is distinct from c.id
  or o.id is distinct from reservation.outbox_id or o.attempt_count is distinct from reservation.attempt_ordinal
  or o.contact_reference_id is distinct from contact.id or o.recipient_principal_id is distinct from sp.id
  or o.recipient_authority_revision is distinct from sp.principal_revision or o.expires_at<=clock_timestamp()
  or contact.correction_case_id is distinct from c.id or contact.status<>'correction-case-working' or contact.contact_ciphertext is null
  or contact.principal_id is distinct from sp.id or contact.authority_revision is distinct from sp.principal_revision
  or exists(select 1 from public.retention_due_phases p join public.retention_rows r on r.id=p.retention_row_id
   where r.target_kind='subject' and r.target_id=c.subject_id and r.state='active'
    and p.phase_id='future-person-claimed-source-disposal') then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 -- The exact subject/custody/publication currentness remains necessary here.
 perform private.new_correction_source_frame_v1(c.subject_id,c.requested_field);
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 return jsonb_build_object('reservationId',reservation.id,'caseId',c.id,'outboxId',o.id,
  'attemptOrdinal',reservation.attempt_ordinal,'idempotencyKey',reservation.idempotency_key,
  'contactCiphertextHex',encode(contact.contact_ciphertext,'hex'));
end $body$;

create function private.complete_new_correction_ack_send_v1(p_reservation uuid,p_provider_hmac text,p_provider_cipher bytea)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare reservation private.new_correction_mail_reservations; ended timestamptz:=clock_timestamp(); attempt_id uuid;
begin
 select * into reservation from private.new_correction_mail_reservations where id=p_reservation for update;
 if reservation.id is null or reservation.state<>'reserved' or p_provider_hmac is null or p_provider_hmac!~'^[0-9a-f]{64}$'
  or p_provider_cipher is null or octet_length(p_provider_cipher) not between 29 and 4124
  or not exists(select 1 from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
   and transaction_id=txid_current() and correction_id=reservation.correction_id)
  or not exists(select 1 from public.correction_requests where id=reservation.correction_id
   and state in('submitted','reviewing') and review_deadline>ended) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 insert into public.mail_provider_attempts(outbox_id,attempt_ordinal,provider,provider_message_id_hmac,outcome_code,submitted_at,completed_at,correction_case_id)
 values(reservation.outbox_id,reservation.attempt_ordinal,'resend',p_provider_hmac,'accepted',ended,ended,reservation.correction_id) returning id into attempt_id;
 insert into public.mail_deliveries(outbox_id,provider_attempt_id,status,occurred_at,correction_case_id)
 values(reservation.outbox_id,attempt_id,'accepted',ended,reservation.correction_id);
 update public.mail_outbox set state='submitted',claimed_at=null,last_outcome_code='accepted' where id=reservation.outbox_id;
 update private.new_correction_mail_reservations set state='accepted',provider_message_id_hmac=p_provider_hmac,
  provider_id_ciphertext=p_provider_cipher,completed_at=ended where id=reservation.id;
 -- Acceptance is not delivery or provider disposal. No acknowledgement phase
 -- or purge manifest is completed from this provider response.
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=reservation.correction_id;
end $body$;

-- After an uncertain send/COMMIT, record the actual already reserved sender's
-- accepted result. A still-current case may reconcile its existing queue rows;
-- a terminal/revoked case retains only the external-disposal hold. This never
-- sends, recreates an outbox/contact/body, or reopens a case. API-denied.
create function private.record_new_correction_late_acceptance_v1(p_reservation uuid,p_provider_hmac text,p_provider_cipher bytea)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare reservation private.new_correction_mail_reservations; c public.correction_requests;
 d private.new_correction_delivery; o public.mail_outbox; contact public.encrypted_contact_references;
 cp public.future_person_claimant_principals; sp public.subject_principals; attempt_id uuid; ended timestamptz:=clock_timestamp();
begin
 select * into reservation from private.new_correction_mail_reservations where id=p_reservation;
 select * into c from public.correction_requests where id=reservation.correction_id;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=c.id for update;
 select * into cp from public.future_person_claimant_principals
  where id=(select claimant_principal_id from public.subjects where id=c.subject_id) for share;
 select * into sp from public.subject_principals where id=cp.principal_id for share;
 select * into d from private.new_correction_delivery where correction_id=c.id for update;
 perform private.lock_invitation_transitions_v1();
 select * into o from public.mail_outbox where id=d.outbox_id for update;
 select * into contact from public.encrypted_contact_references where id=d.contact_reference_id for share;
 select * into reservation from private.new_correction_mail_reservations where id=p_reservation for update;
 if reservation.id is null or p_provider_hmac is null or p_provider_hmac!~'^[0-9a-f]{64}$'
  or p_provider_cipher is null or octet_length(p_provider_cipher) not between 29 and 4124
  or (reservation.state='accepted' and reservation.provider_message_id_hmac is distinct from p_provider_hmac)
  or reservation.state='confirmed-no-submission' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 update private.new_correction_mail_reservations set state='accepted',provider_message_id_hmac=p_provider_hmac,
  provider_id_ciphertext=coalesce(provider_id_ciphertext,p_provider_cipher),completed_at=coalesce(completed_at,ended) where id=reservation.id;
 -- Terminal delivery/body rows are physically gone and must stay gone.
 if c.id is null or c.state not in('submitted','reviewing') or c.review_deadline<=ended
  or c.review_case_format is distinct from 'reviewer-only-case-statement-v1' or d.correction_id is null
  or cp.status<>'current' or cp.principal_id is distinct from c.claimant_principal_id
  or cp.release_revision is distinct from(c.review_case_binding->>'authorityRevision')::bigint
  or sp.status<>'active' or sp.principal_kind<>'future_person' or sp.account_id is not null
  or o.id is null or o.id is distinct from reservation.outbox_id or o.correction_case_id is distinct from c.id
  or o.attempt_count is distinct from reservation.attempt_ordinal
  or o.state not in('claimed','submitted','delivered','failed','expired','invalidated')
  or (o.state='invalidated' and o.last_outcome_code is distinct from 'correction_acknowledgement_held')
  or o.recipient_principal_id is distinct from sp.id or o.recipient_authority_revision is distinct from sp.principal_revision
  or contact.id is null or contact.correction_case_id is distinct from c.id
  or contact.principal_id is distinct from sp.id or contact.authority_revision is distinct from sp.principal_revision
  or contact.status<>'correction-case-working' or contact.contact_ciphertext is null then return;end if;
 select id into attempt_id from public.mail_provider_attempts where outbox_id=o.id
  and attempt_ordinal=reservation.attempt_ordinal and provider_message_id_hmac=p_provider_hmac;
 if exists(select 1 from public.mail_provider_attempts where outbox_id=o.id and attempt_ordinal=reservation.attempt_ordinal
  and provider_message_id_hmac is distinct from p_provider_hmac) then
  raise exception using errcode='55000',message='correction_mail_result_conflict';end if;
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 if attempt_id is null then
  insert into public.mail_provider_attempts(outbox_id,attempt_ordinal,provider,provider_message_id_hmac,
   outcome_code,submitted_at,completed_at,correction_case_id)
  values(o.id,reservation.attempt_ordinal,'resend',p_provider_hmac,'accepted',ended,ended,c.id) returning id into attempt_id;
 end if;
 if not exists(select 1 from public.mail_deliveries where outbox_id=o.id) then
  insert into public.mail_deliveries(outbox_id,provider_attempt_id,status,occurred_at,correction_case_id)
  values(o.id,attempt_id,'accepted',ended,c.id);
 elsif not exists(select 1 from public.mail_deliveries where outbox_id=o.id and provider_attempt_id=attempt_id
  and correction_case_id=c.id) then
  raise exception using errcode='55000',message='correction_mail_result_conflict';end if;
 update public.mail_outbox set state='submitted',claimed_at=null,last_outcome_code='accepted'
  where id=o.id and state in('claimed','expired','invalidated');
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=c.id;
end $body$;

revoke all on function private.guard_new_correction_outbox_v1(),private.guard_new_correction_contact_v1(),private.guard_new_correction_contact_index_v1(),private.guard_new_correction_mail_child_v1(),private.new_correction_claimant_contact_v1(public.rights_sessions),
 private.new_correction_ack_target_v1(timestamptz),private.queue_new_correction_ack_v1(uuid,public.rights_sessions,jsonb,bytea,jsonb),
 private.reserve_new_correction_ack_v1(uuid),private.lock_new_correction_ack_send_v1(uuid),
 private.complete_new_correction_ack_send_v1(uuid,text,bytea),private.record_new_correction_late_acceptance_v1(uuid,text,bytea)
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.read_new_correction_intake_contact_v1(text,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_new_correction_intake_contact_v1(text,text,jsonb) to service_role;

-- This is the correction-specific native event branch for the existing
-- signature-verified Resend callback, composed by correction-mail-composition.
-- It updates only an exact current case; a late terminal event creates no row.
create function private.record_new_correction_ack_event_v1(p_provider_hmac text,p_event_hmac text,
 p_status text,p_occurred timestamptz)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare reservation private.new_correction_mail_reservations; c public.correction_requests;
 d private.new_correction_delivery; o public.mail_outbox; t public.retention_rows; p public.retention_due_phases;
begin
 if p_provider_hmac is null or p_provider_hmac!~'^[0-9a-f]{64}$'
  or p_event_hmac is null or p_event_hmac!~'^[0-9a-f]{64}$'
  or p_status is null or p_status not in('accepted','delivered','bounced','complained','reviewed_undeliverable')
  or p_occurred is null or p_occurred>clock_timestamp()+interval '60 seconds' then
  raise exception using errcode='22023',message='correction_mail_event_unavailable';end if;
 select * into reservation from private.new_correction_mail_reservations where provider_message_id_hmac=p_provider_hmac and state='accepted';
 select * into c from public.correction_requests where id=reservation.correction_id;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into c from public.correction_requests where id=c.id for update;
 if c.id is null or c.state not in('submitted','reviewing') or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.review_deadline<=clock_timestamp() then return false;end if;
 select * into d from private.new_correction_delivery where correction_id=c.id for update;
 select * into t from public.retention_rows where id=d.retention_row_id for update;
 select * into p from public.retention_due_phases where retention_row_id=t.id and phase_id='correction-acknowledgement' and phase_revision=1 for update;
 perform private.lock_invitation_transitions_v1();
 select * into o from public.mail_outbox where id=d.outbox_id for update;
 if d.correction_id is null or o.id is null or o.id is distinct from reservation.outbox_id
  or o.correction_case_id is distinct from c.id or o.state not in('submitted','delivered','failed')
  or o.attempt_count is distinct from reservation.attempt_ordinal
  or p.phase_deadline is distinct from d.acknowledgement_deadline
  or t.fixed_deadline is distinct from c.review_deadline
  or p_occurred<reservation.reserved_at-interval '60 seconds'
  or not exists(select 1 from public.mail_provider_attempts where outbox_id=o.id
   and attempt_ordinal=reservation.attempt_ordinal and provider_message_id_hmac=p_provider_hmac)
  or not exists(select 1 from public.subjects s join public.future_person_claimant_principals cp
   on cp.id=s.claimant_principal_id and cp.status='current' join public.subject_principals sp on sp.id=cp.principal_id
   where s.id=c.subject_id and cp.principal_id=c.claimant_principal_id and s.lifecycle='claimed_unbound'
    and cp.release_revision=(c.review_case_binding->>'authorityRevision')::bigint
    and sp.status='active' and sp.account_id is null
    and sp.principal_revision=o.recipient_authority_revision) then return false;end if;
 insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),c.id);
 update public.mail_deliveries set status=case
  when status='complained' or p_status='complained' then 'complained'
  when status in('bounced','reviewed_undeliverable') then status
  when p_status in('bounced','reviewed_undeliverable') then p_status
  when status='delivered' or p_status='delivered' then 'delivered' else 'accepted' end,
  provider_event_hmac=p_event_hmac,occurred_at=p_occurred,recorded_at=clock_timestamp() where outbox_id=o.id;
 if not found then raise exception using errcode='55000',message='correction_mail_event_unavailable';end if;
 update public.mail_outbox set state=case when state='failed' then 'failed'
  when p_status in('bounced','complained','reviewed_undeliverable') then 'failed'
  when p_status='delivered' then 'delivered' else state end,last_outcome_code='resend.'||p_status where id=o.id;
 if p_status='delivered' and p_occurred<=p.phase_deadline
  and exists(select 1 from public.mail_deliveries where outbox_id=o.id and status='delivered') then
  update public.retention_due_phases set status='succeeded',completed_at=clock_timestamp(),
   terminal_outcome_code='acknowledgement-delivered',claim_token_hash=null,claim_expires_at=null
  where retention_row_id=t.id and phase_id=p.phase_id and phase_revision=p.phase_revision and status<>'succeeded';
 end if;
 delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
  and transaction_id=txid_current() and correction_id=c.id;
 return true;
end $body$;
revoke all on function private.record_new_correction_ack_event_v1(text,text,text,timestamptz)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY, after V3 definitions. No migration number or activation.
-- The outer unconditional pre-DDL fence remains in unbound-source-candidate.sql.
-- This explicit owner-only TEST scope is configuration, never claimant authority.
create table private.new_requester_statement_test_scope (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 test_environment_binding uuid,
 check((not enabled and test_environment_binding is null) or(enabled and test_environment_binding is not null))
);
insert into private.new_requester_statement_test_scope(singleton) values(true);
alter table private.new_requester_statement_test_scope enable row level security;
revoke all on table private.new_requester_statement_test_scope from public,anon,authenticated,service_role,inherit_upload_only;

create function private.requester_statement_test_enabled_v1()
returns boolean language sql stable security definer set search_path='' as $body$
 select coalesce((select enabled and test_environment_binding is not null
  from private.new_requester_statement_test_scope where singleton),false)
$body$;
revoke all on function private.requester_statement_test_enabled_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Existing actual approved-release rights and export action are the ownership
-- door. A case UUID, reviewer assignment, parent role or account cannot replace it.
create function private.current_requester_statement_session_v1(p_hash text)
returns public.rights_sessions language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare rs public.rights_sessions;
begin
 if not private.requester_statement_test_enabled_v1() then
  raise exception using errcode='42501',message='not_found';end if;
 rs:=private.future_person_rights_session_v1(p_hash,false);
 if rs.id is null then raise exception using errcode='42501',message='not_found';end if;
 -- Lock the actual subject first, then the exact session and its existing
 -- release/token/principal/contact/custody rows. GET writes no row or nonce.
 perform 1 from public.subjects where id=rs.target_id for share;
 perform 1 from public.rights_sessions where id=rs.id for share;
 perform 1 from public.token_hashes where id=rs.token_hash_id for share;
 perform 1 from public.future_person_claim_release_credentials where candidate_id in(
  select candidate_id from public.token_hashes where id=rs.token_hash_id) order by id for share;
 perform 1 from public.future_person_claimant_principals where principal_id=rs.principal_id order by id for share;
 perform 1 from public.subject_principals where id=rs.principal_id for share;
 perform 1 from public.encrypted_contact_references where id in(
  select contact_reference_id from public.future_person_claim_release_credentials where candidate_id in(
   select candidate_id from public.token_hashes where id=rs.token_hash_id)) order by id for share;
 perform 1 from private.future_person_custody_slices where subject_id=rs.target_id for share;
 rs:=private.future_person_rights_session_v1(p_hash,false);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'export','api.future-person-export') then
  raise exception using errcode='42501',message='not_found';end if;
 return rs;
end $body$;
revoke all on function private.current_requester_statement_session_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.current_requester_correction_statement_v1(p_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='250ms' as $body$
declare rs public.rights_sessions; c public.correction_requests; e private.new_correction_case_envelopes;
 s public.subjects; sp public.subject_principals; scope jsonb; capture jsonb; binding jsonb;
begin
 rs:=private.current_requester_statement_session_v1(p_hash);
 select * into c from public.correction_requests where id=p_id and subject_id=rs.target_id for share;
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 select * into s from public.subjects where id=rs.target_id for share;
 select * into sp from public.subject_principals where id=rs.principal_id for share;
 scope:=jsonb_build_object('version',1,'caseKind','correction','caseId',c.id,
  'originalAuthorPrincipalId',rs.principal_id,'initialStatementRevision',1,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline,
  'requestedField',c.requested_field,'originalSubjectId',rs.target_id);
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.claimant_principal_id is distinct from rs.principal_id
  or c.review_case_binding->'scope' is distinct from scope
  or c.correction_revision<>1 or c.state not in('submitted','reviewing')
  or c.terminal_shredded_at is not null or c.review_deadline<=clock_timestamp()
  or c.review_deadline is distinct from c.submitted_at+interval '30 days'
  or e.correction_id is null or e.wrapped_case_key is null
  or e.statement_ciphertext is null or e.working_ciphertext is null then
  raise exception using errcode='42501',message='not_found';end if;
 -- This is the actual complete export source receipt. No hash grants access.
 capture:=private.future_person_export_capture_before_requester_statement_v1(p_hash);
 binding:=jsonb_build_object('rightsSessionId',rs.id,'principalId',rs.principal_id,'subjectId',rs.target_id,
  'authorityRevision',rs.authority_revision,'tokenHashId',rs.token_hash_id,
  'principalRevision',sp.principal_revision,'lifecycleRevision',s.lifecycle_revision,
  'bindingRevision',s.subject_binding_revision,'sourceReceipt',capture#>>'{authority,authorityReceipt}',
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e))::text,'sha256'),'hex'));
 return jsonb_build_object('scope',scope,'binding',binding,'envelope',jsonb_build_object(
  'format',c.review_case_format,'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),
  'workingCiphertextHex',encode(e.working_ciphertext,'hex'),'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex')));
end $body$;
revoke all on function private.current_requester_correction_statement_v1(text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.read_requester_correction_statement_v1(p_hash text,p_id uuid)
returns jsonb language sql security definer set search_path='' as $body$
 select private.current_requester_correction_statement_v1(p_hash,p_id)
$body$;
create function public.check_requester_correction_statement_v1(p_hash text,p_id uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' as $body$
declare current_frame jsonb;
begin
 current_frame:=private.current_requester_correction_statement_v1(p_hash,p_id);
 if p_expected is null or current_frame->'binding' is distinct from p_expected then
  raise exception using errcode='42501',message='not_found';end if;
 return true;
end $body$;
revoke all on function public.read_requester_correction_statement_v1(text,uuid),
 public.check_requester_correction_statement_v1(text,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.read_requester_correction_statement_v1(text,uuid),
 public.check_requester_correction_statement_v1(text,uuid,jsonb) to service_role;

-- SOURCE ONLY. Real existing claimant archive composition; no provider adapter
-- is relabeled and no opaque appeal/correction row is adopted.
alter function private.future_person_export_capture_v1(text)
 rename to future_person_export_capture_before_requester_statement_v1;
revoke all on function private.future_person_export_capture_before_requester_statement_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create table private.new_correction_archive_cases (
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 correction_id uuid not null references public.correction_requests(id) on delete restrict,
 original_deadline timestamptz not null,
 original_author_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 origin_account_id uuid references auth.users(id) on delete restrict,
 case_hash text not null check(case_hash~'^[0-9a-f]{64}$'),
 state text not null default 'active' check(state in('active','closing')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(export_id,correction_id)
);
create table private.new_correction_archive_runs (
 id uuid primary key default gen_random_uuid(),
 export_id uuid not null references private.export_archive_jobs(export_id) on delete restrict,
 attempt_id uuid not null references private.export_archive_attempts(id) on delete restrict,
 nonce_hash text not null unique check(nonce_hash~'^[0-9a-f]{64}$'),
 state text not null default 'active' check(state in('active','cancellation-requested','buffers-zeroed')),
 started_at timestamptz not null default clock_timestamp(),
 original_deadline timestamptz not null,
 buffers_zeroed_at timestamptz,
 check((state='buffers-zeroed')=(buffers_zeroed_at is not null))
);
create table private.new_correction_archive_provider_dispositions (
 attempt_id uuid not null,
 ordinal bigint not null,
 reservation_hash text not null check(reservation_hash~'^[0-9a-f]{64}$'),
 backend text not null,
 immutable_evidence jsonb not null check(jsonb_typeof(immutable_evidence)='object'),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(attempt_id,ordinal),
 foreign key(attempt_id,ordinal) references private.export_archive_segments(attempt_id,ordinal) on delete restrict
);
do $private_tables$
declare name text;
begin
 foreach name in array array['new_correction_archive_cases','new_correction_archive_runs','new_correction_archive_provider_dispositions'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $private_tables$;

create function private.requester_correction_statement_inventory_v1(p_hash text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; c public.correction_requests; frame jsonb;
 rows jsonb:='[]'; digest bytea; earliest timestamptz; n integer:=0;
begin
 rs:=private.current_requester_statement_session_v1(p_hash);
 -- Census the actual requester principal. Subject control alone does not make
 -- a foreign person's prose the requester's statement. Unknown owned legacy
 -- classes fail the complete TEST archive before its first byte reservation.
 if exists(select 1 from public.appeal_intakes where appellant_principal_id=rs.principal_id)
  or exists(select 1 from public.correction_requests where claimant_principal_id=rs.principal_id
   and review_case_format is distinct from 'reviewer-only-case-statement-v1') then
  raise exception using errcode='0A000',message='requester_statement_format_unavailable';end if;
 digest:=extensions.digest(convert_to('test-requester-own-statements-v1','UTF8'),'sha256');
 for c in select * from public.correction_requests where subject_id=rs.target_id
  and review_case_format='reviewer-only-case-statement-v1' order by id for share loop
  if c.state in('submitted','reviewing') then
   frame:=private.current_requester_correction_statement_v1(p_hash,c.id);
   n:=n+1;earliest:=least(earliest,c.review_deadline);
   rows:=rows||jsonb_build_array(jsonb_build_object('correctionId',c.id,'caseHash',frame#>>'{binding,caseHash}',
    'originalDeadline',c.review_deadline));
   digest:=extensions.digest(digest||convert_to(c.id::text||':'||(frame->'binding')::text||E'\n','UTF8'),'sha256');
  elsif c.state not in('rejected','withdrawn','expired') or c.terminal_shredded_at is null
   or exists(select 1 from private.new_correction_case_envelopes where correction_id=c.id) then
   raise exception using errcode='42501',message='not_found';end if;
 end loop;
 return jsonb_build_object('version','test-requester-own-statements-v1','corrections',n,'appeals',0,
  'membershipSha256',encode(digest,'hex'),'originalDeadline',earliest,'cases',rows);
end $body$;
revoke all on function private.requester_correction_statement_inventory_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.future_person_export_capture_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare captured jsonb; own jsonb; receipt text;
begin
 captured:=private.future_person_export_capture_before_requester_statement_v1(p_session_hash);
 if not private.requester_statement_test_enabled_v1() then return captured;end if;
 own:=private.requester_correction_statement_inventory_v1(p_session_hash);
 receipt:=encode(extensions.digest(jsonb_build_object('version','test-requester-archive-capture-v1',
  'originalCapture',captured,'ownStatements',own)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))
  ||jsonb_build_object('ownStatements',own-'cases');
end $body$;
revoke all on function private.future_person_export_capture_v1(text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The actual create/nonce/currentness transaction creates the case bindings.
-- Every archive deadline is clamped, never extended, to its earliest case.
alter function public.future_person_export_request_v1(text,text,jsonb,text)
 rename to future_person_export_request_before_requester_statement_v1;
revoke all on function public.future_person_export_request_before_requester_statement_v1(text,text,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.future_person_export_request_v1(p_operation text,p_session_hash text,p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; inventory jsonb; task_export_id uuid; original_deadline timestamptz;
begin
 result:=public.future_person_export_request_before_requester_statement_v1(p_operation,p_session_hash,p_payload,p_csrf_binding);
 if p_operation='create' and private.requester_statement_test_enabled_v1() then
  inventory:=private.requester_correction_statement_inventory_v1(p_session_hash);
  task_export_id:=(result->>'exportId')::uuid;
  insert into private.new_correction_archive_cases(export_id,correction_id,original_deadline,case_hash,original_author_principal_id,origin_account_id)
  select task_export_id,(x->>'correctionId')::uuid,(x->>'originalDeadline')::timestamptz,x->>'caseHash',
   (private.current_requester_statement_session_v1(p_session_hash)).principal_id,null
   from jsonb_array_elements(inventory->'cases')x;
  original_deadline:=(inventory->>'originalDeadline')::timestamptz;
  if original_deadline is not null then update private.export_archive_jobs
   set deadline=least(deadline,original_deadline) where export_id=task_export_id;end if;
 end if;
 return result;
end $body$;
revoke all on function public.future_person_export_request_v1(text,text,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_request_v1(text,text,jsonb,text) to service_role;

-- Preserve every old member operation behind its actual predecessor. This
-- additional operation carries internal envelopes only to the exact worker.
alter function public.future_person_export_members_v1(text,uuid,uuid,text,text)
 rename to future_person_export_members_before_requester_statement_v1;
revoke all on function public.future_person_export_members_before_requester_statement_v1(text,uuid,uuid,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.future_person_export_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare e public.generated_exports; j private.export_archive_jobs; a private.export_archive_attempts;
 rs public.rights_sessions; inventory jsonb; frame jsonb; c record; rows jsonb:='[]'; n integer:=0; last_id uuid; after_id uuid;
begin
 if p_operation is distinct from 'own-statements' then
  return public.future_person_export_members_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_after_id);end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into e from public.generated_exports where id=p_export_id for share;
 select * into j from private.export_archive_jobs where export_id=e.id for share;
 rs:=private.current_requester_statement_session_v1(j.origin->>'sessionHash');
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=e.id for share;
 if e.id is null or e.origin_kind<>'independent-rights' or e.account_id is not null
  or e.requester_principal_id is distinct from rs.principal_id or e.target_id is distinct from rs.target_id
  or e.status<>'building' or j.route_id<>'api.future-person-export' or j.export_contract<>'approved-future-person-export-v1'
  or a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing'
  or a.lease_expires_at<=clock_timestamp() or a.authority_receipt is distinct from p_authority_receipt
  or exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 inventory:=private.requester_correction_statement_inventory_v1(j.origin->>'sessionHash');
 if inventory->'cases' is distinct from(select coalesce(jsonb_agg(jsonb_build_object('correctionId',b.correction_id,
  'caseHash',b.case_hash,'originalDeadline',b.original_deadline) order by b.correction_id),'[]')
  from private.new_correction_archive_cases b where b.export_id=e.id) then
  raise exception using errcode='42501',message='not_found';end if;
 if p_after_id is not null then after_id:=p_after_id::uuid;end if;
 for c in select correction_id from private.new_correction_archive_cases where export_id=e.id
  and(after_id is null or correction_id>after_id) order by correction_id limit 32 loop
  frame:=private.current_requester_correction_statement_v1(j.origin->>'sessionHash',c.correction_id);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',c.correction_id,'frame',frame));n:=n+1;last_id:=c.correction_id;
 end loop;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 return jsonb_build_object('rows',rows,'count',n,'nextAfterId',last_id);
end $body$;
revoke all on function public.future_person_export_members_v1(text,uuid,uuid,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_members_v1(text,uuid,uuid,text,text) to service_role;

-- SOURCE ONLY. NEW native R2 allocations, distinct from the real Supabase
-- logical key. No legacy locator is converted and no deployment is enabled.
create table private.new_correction_archive_r2_configuration (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 bucket_name text check(bucket_name~'^inherit-export-[a-z0-9-]{1,40}$'),
 binding_sha256 text check(binding_sha256~'^[0-9a-f]{64}$'),
 protocol_revision text check(protocol_revision='r2-current-object-qualified-all-writer-gateway-v1'),
 check((not enabled and bucket_name is null and binding_sha256 is null and protocol_revision is null)
  or(enabled and bucket_name is not null and binding_sha256 is not null and protocol_revision is not null))
);
insert into private.new_correction_archive_r2_configuration(singleton) values(true);
create table private.new_correction_archive_r2_allocations (
 id uuid primary key default gen_random_uuid(),attempt_id uuid not null,ordinal bigint not null,
 provider_key text not null unique check(provider_key~'^export/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 locator jsonb not null,write_identity jsonb not null,
 write_binding_sha256 text not null check(write_binding_sha256~'^[0-9a-f]{64}$'),
 allocation_sha256 text not null unique check(allocation_sha256~'^[0-9a-f]{64}$'),
 reservation_sha256 text not null check(reservation_sha256~'^[0-9a-f]{64}$'),
 configuration_sha256 text not null check(configuration_sha256~'^[0-9a-f]{64}$'),
 original_deadline timestamptz not null,issued_at timestamptz not null,
 state text not null default 'reserved' check(state in('reserved','written','closing','disposed')),
 provider_version text,provider_etag text,
 closed_at timestamptz,claim_hash text check(claim_hash~'^[0-9a-f]{64}$'),claim_expires_at timestamptz,
 claimed_reservation jsonb,provider_evidence jsonb,disposed_at timestamptz,
 unique(attempt_id,ordinal),
 foreign key(attempt_id,ordinal) references private.export_archive_segments(attempt_id,ordinal) on delete restrict,
 check((claim_hash is null)=(claim_expires_at is null)),
 check((claim_hash is null)=(claimed_reservation is null)),
 check((state='disposed')=(disposed_at is not null and provider_evidence is not null))
);
do $tables$
declare name text;
begin
 foreach name in array array['new_correction_archive_r2_configuration','new_correction_archive_r2_allocations'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role,inherit_upload_only',name);
 end loop;
end $tables$;

create function private.issue_new_correction_archive_r2_allocation_v1()
returns trigger language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare a private.export_archive_attempts;j private.export_archive_jobs;
 config private.new_correction_archive_r2_configuration;key text;locator jsonb;identity jsonb;allocation text;write_hash text;
begin
 select * into a from private.export_archive_attempts where id=new.attempt_id;
 if not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id) then return new;end if;
 select * into j from private.export_archive_jobs where export_id=a.export_id for share;
 select * into config from private.new_correction_archive_r2_configuration where singleton for share;
 if not private.requester_statement_test_enabled_v1() or not config.enabled
  or exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state<>'active') then
  raise exception using errcode='42501',message='correction_archive_backend_not_enabled';end if;
 key:='export/'||gen_random_uuid()::text;
 locator:=jsonb_build_object('provider','archive-r2-current-object-v1','bucket',config.bucket_name,
  'objectKey',key,'byteCount',new.byte_count,'sha256',new.sha256);
 identity:=jsonb_build_object('purpose','inherit-export-reservation-v1','exportId',a.export_id,'attemptId',a.id,
  'ordinal',new.ordinal,'offset',new.byte_offset,'byteCount',new.byte_count,'sha256',new.sha256,
  'logicalKey',new.object_key,'reservedAt',new.reserved_at,'authorityReceipt',a.authority_receipt,'locator',locator);
 write_hash:=encode(extensions.digest(identity::text,'sha256'),'hex');
 allocation:=encode(extensions.digest(convert_to('inherit-export-r2-allocation-v1'||E'\n'||config.bucket_name||E'\n'||key,'UTF8'),'sha256'),'hex');
 insert into private.new_correction_archive_r2_allocations(attempt_id,ordinal,provider_key,locator,write_identity,
  write_binding_sha256,allocation_sha256,reservation_sha256,configuration_sha256,original_deadline,issued_at)
 values(a.id,new.ordinal,key,locator,identity,write_hash,allocation,
  encode(extensions.digest(jsonb_build_object('identity',identity,'allocation',allocation,'configuration',config.binding_sha256,'originalDeadline',j.deadline)::text,'sha256'),'hex'),
  config.binding_sha256,j.deadline,new.reserved_at);
 return new;
end $body$;
create trigger issue_new_correction_archive_r2_allocation after insert on private.export_archive_segments
 for each row execute function private.issue_new_correction_archive_r2_allocation_v1();
revoke all on function private.issue_new_correction_archive_r2_allocation_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Owner-only writer selection takes the existing logical reservation, never a
-- caller bucket/key. Its real provider operation must use this native locator.
create function private.current_new_correction_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;j private.export_archive_jobs;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt;
 perform private.export_archive_current_v1(a.export_id,p_receipt);
 select * into j from private.export_archive_jobs where export_id=a.export_id for update;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state<>'reserved' or a.state<>'writing' or j.active_attempt is distinct from a.id
  or a.lease_expires_at<=clock_timestamp() or allocation.original_deadline<=clock_timestamp()
  or exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('objectId',allocation.id,'writeIdentity',allocation.write_identity,
  'writeBindingSha256',allocation.write_binding_sha256,'allocationSha256',allocation.allocation_sha256,
  'configurationSha256',allocation.configuration_sha256,'originalDeadline',allocation.original_deadline);
end $body$;
create function private.complete_new_correction_archive_r2_write_v1(p_attempt uuid,p_ordinal bigint,p_receipt text,p_expected jsonb,p_provider_version text,p_provider_etag text)
returns uuid language plpgsql security invoker set search_path='' as $body$
declare current_frame jsonb;result uuid;
begin
 current_frame:=private.current_new_correction_archive_r2_write_v1(p_attempt,p_ordinal,p_receipt);
 if current_frame is distinct from p_expected or coalesce(p_provider_version,'')!~'^[A-Za-z0-9._-]{1,256}$'
  or coalesce(p_provider_etag,'')!~'^[A-Za-z0-9._-]{1,256}$' then raise exception using errcode='42501',message='not_found';end if;
 update private.new_correction_archive_r2_allocations set state='written',provider_version=p_provider_version,provider_etag=p_provider_etag
  where attempt_id=p_attempt and ordinal=p_ordinal returning id into result;
 return result;
end $body$;
revoke all on function private.current_new_correction_archive_r2_write_v1(uuid,bigint,text),
 private.complete_new_correction_archive_r2_write_v1(uuid,bigint,text,jsonb,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Actual existing worker ABI preserved. Marked R2 ACK references the real
-- native allocation row UUID, not a fictional Supabase storage.objects row.
alter function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)
 rename to export_archive_worker_before_requester_statement_v1;
revoke all on function public.export_archive_worker_before_requester_statement_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_worker_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare a private.export_archive_attempts;j private.export_archive_jobs;s private.export_archive_segments;allocation private.new_correction_archive_r2_allocations;
begin
 if p_operation is distinct from 'acknowledge' or not exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id) then
  return public.export_archive_worker_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_payload);end if;
 perform private.export_archive_current_v1(p_export_id,p_authority_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export_id for update;
 select * into a from private.export_archive_attempts where id=p_attempt_id and export_id=p_export_id for update;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or not(p_payload ?& array['ordinal','offset','sizeBytes','sha256','objectKey','objectId']) then raise exception using errcode='22023',message='invalid_request';end if;
 select * into s from private.export_archive_segments where attempt_id=a.id and ordinal=(p_payload->>'ordinal')::bigint for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=s.ordinal for update;
 if a.id is null or j.active_attempt is distinct from a.id or a.state<>'writing' or a.lease_expires_at<=clock_timestamp()
  or a.authority_receipt is distinct from p_authority_receipt or s.attempt_id is null or s.acknowledged_at is not null
  or s.byte_offset is distinct from(p_payload->>'offset')::bigint or s.byte_count is distinct from(p_payload->>'sizeBytes')::integer
  or s.sha256 is distinct from p_payload->>'sha256' or s.object_key is distinct from p_payload->>'objectKey'
  or allocation.state is distinct from 'written' or allocation.id::text is distinct from p_payload->>'objectId'
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id and state<>'active') then raise exception using errcode='42501',message='not_found';end if;
 update private.export_archive_segments set object_id=allocation.id,acknowledged_at=clock_timestamp() where attempt_id=a.id and ordinal=s.ordinal;
 update private.export_archive_attempts set segment_count=segment_count+1,byte_count=byte_count+s.byte_count where id=a.id;
 return jsonb_build_object('ordinal',s.ordinal,'authorityReceipt',p_authority_receipt);
end $body$;
revoke all on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_worker_v1(text,uuid,uuid,text,jsonb) to service_role;

-- Actual durable native issuer/check for the frozen current-object algorithm.
-- This is a NEW allocation only. Existing Supabase reservations refuse.
create function private.claim_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;claim_until timestamptz;frame jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_claim,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state not in('reserved','written','closing') or a.state<>'cleanup_pending'
  or a.cleanup_not_before>clock_timestamp() or(allocation.claim_expires_at is not null and allocation.claim_expires_at>clock_timestamp())
  or not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing') then raise exception using errcode='42501',message='not_found';end if;
 claim_until:=clock_timestamp()+interval '30 seconds';
 frame:=jsonb_build_object('version','archive-r2-current-cleanup-reservation-v1','exportId',a.export_id,'attemptId',a.id,
  'ordinal',allocation.ordinal,'authorityReceipt',a.authority_receipt,'reservationSha256',allocation.reservation_sha256,
  'locator',allocation.locator,'writeIdentity',allocation.write_identity,'writeBindingSha256',allocation.write_binding_sha256,
  'allocationSha256',allocation.allocation_sha256,'cleanupNotBefore',a.cleanup_not_before,'claimExpiresAt',claim_until);
 update private.new_correction_archive_r2_allocations set state='closing',closed_at=coalesce(closed_at,clock_timestamp()),
  claim_hash=encode(extensions.digest(convert_to(p_claim,'UTF8'),'sha256'),'hex'),claim_expires_at=claim_until,claimed_reservation=frame
  where id=allocation.id;
 return frame;
end $body$;
create function private.check_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare allocation private.new_correction_archive_r2_allocations;a private.export_archive_attempts;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_claim,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into a from private.export_archive_attempts where id=p_attempt for update;
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=p_ordinal for update;
 if allocation.id is null or allocation.state<>'closing' or a.state<>'cleanup_pending' or a.cleanup_not_before>clock_timestamp()
  or allocation.claim_hash is null or allocation.claimed_reservation is null or allocation.claim_expires_at is null
  or allocation.claim_expires_at<=clock_timestamp() or allocation.claimed_reservation is distinct from p_expected
  or not private.claim_hash_matches_v1(allocation.claim_hash,encode(extensions.digest(convert_to(p_claim,'UTF8'),'sha256'),'hex'))
  or not exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing') then raise exception using errcode='42501',message='not_found';end if;
 return allocation.claimed_reservation;
end $body$;
create function private.ack_new_correction_archive_r2_disposal_v1(p_attempt uuid,p_ordinal bigint,p_claim text,p_expected jsonb,p_evidence jsonb)
returns boolean language plpgsql security invoker set search_path='' as $body$
declare current_frame jsonb;allocation private.new_correction_archive_r2_allocations;
begin
 current_frame:=private.check_new_correction_archive_r2_disposal_v1(p_attempt,p_ordinal,p_claim,p_expected);
 select * into allocation from private.new_correction_archive_r2_allocations where attempt_id=p_attempt and ordinal=p_ordinal for update;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or(select count(*) from jsonb_object_keys(p_evidence))<>6
  or p_evidence->>'version' is distinct from 'archive-r2-current-object-evidence-v1'
  or p_evidence->>'reservationSha256' is distinct from allocation.reservation_sha256
  or p_evidence->>'allocationSha256' is distinct from allocation.allocation_sha256
  or p_evidence->>'disposition' is distinct from 'current-payload-tombstoned'
  or p_evidence->>'historyScope' is distinct from 'current-object-only'
  or p_evidence#>>'{marker,kind}' is distinct from 'permanent-empty-fence'
  or p_evidence#>>'{marker,objectKey}' is distinct from allocation.provider_key
  or p_evidence#>>'{marker,allocationSha256}' is distinct from allocation.allocation_sha256
  or p_evidence#>'{marker,byteCount}' is distinct from '0'::jsonb
  or p_evidence#>'{marker,writeBindingSha256}' is distinct from 'null'::jsonb
  or coalesce(p_evidence#>>'{marker,version}','')!~'^[A-Za-z0-9._-]{1,256}$'
  or coalesce(p_evidence#>>'{marker,etag}','')!~'^[A-Za-z0-9._-]{1,256}$'
  or(select count(*) from jsonb_object_keys(p_evidence->'marker'))<>7 then raise exception using errcode='42501',message='not_found';end if;
 update private.new_correction_archive_r2_allocations set state='disposed',provider_evidence=p_evidence,disposed_at=clock_timestamp(),
  claim_hash=null,claim_expires_at=null,claimed_reservation=null where id=allocation.id;
 insert into private.new_correction_archive_provider_dispositions(attempt_id,ordinal,reservation_hash,backend,immutable_evidence)
 values(p_attempt,p_ordinal,allocation.reservation_sha256,'archive-r2-current-object-v1',p_evidence);
 update private.export_archive_segments set delete_acknowledged_at=clock_timestamp() where attempt_id=p_attempt and ordinal=p_ordinal;
 return true;
end $body$;
revoke all on function private.claim_new_correction_archive_r2_disposal_v1(uuid,bigint,text),
 private.check_new_correction_archive_r2_disposal_v1(uuid,bigint,text,jsonb),
 private.ack_new_correction_archive_r2_disposal_v1(uuid,bigint,text,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY. The existing own-account actor and actual claimed-bound
-- binding supply ownership. An uploader/parent/reviewer role is insufficient.
create function private.current_account_correction_statement_v1(p_origin jsonb,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='250ms' as $body$
declare actor jsonb; source jsonb; c public.correction_requests; e private.new_correction_case_envelopes;
 b private.future_person_account_bindings; s public.subjects; sp public.subject_principals; scope jsonb;
begin
 if not private.requester_statement_test_enabled_v1() or p_origin->>'kind' is distinct from 'account'
  or jsonb_typeof(p_origin)<>'object' or (select count(*) from jsonb_object_keys(p_origin))<>3 then
  raise exception using errcode='42501',message='not_found';end if;
 actor:=private.future_person_archive_account_actor_v1((p_origin->>'accountId')::uuid,(p_origin->>'sessionId')::uuid);
 if actor is null then raise exception using errcode='42501',message='not_found';end if;
 select * into c from public.correction_requests where id=p_id;
 perform 1 from public.subjects where id=c.subject_id for share;
 select * into b from private.future_person_account_bindings where subject_id=c.subject_id
  and account_id=(actor->>'accountId')::uuid for share;
 source:=private.future_person_bound_source_for_actor_v1(c.subject_id,clock_timestamp()+interval '30 seconds',actor);
 select * into s from public.subjects where id=c.subject_id for share;
 select * into sp from public.subject_principals where id=b.subject_principal_id for share;
 select * into c from public.correction_requests where id=p_id for share;
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 scope:=jsonb_build_object('version',1,'caseKind','correction','caseId',c.id,
  'originalAuthorPrincipalId',b.subject_principal_id,'initialStatementRevision',1,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline,
  'requestedField',c.requested_field,'originalSubjectId',s.id);
 if actor is null or source is null or b.id is null or sp.id is null or sp.status<>'active' or sp.account_id is distinct from b.account_id
  or c.claimant_principal_id is distinct from b.subject_principal_id
  or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.review_case_binding->'scope' is distinct from scope
  or c.correction_revision<>1 or c.state not in('submitted','reviewing') or c.terminal_shredded_at is not null
  or c.review_deadline<=clock_timestamp() or c.review_deadline is distinct from c.submitted_at+interval '30 days'
  or e.correction_id is null or e.wrapped_case_key is null or e.statement_ciphertext is null or e.working_ciphertext is null then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('scope',scope,'binding',jsonb_build_object(
  'accountId',b.account_id,'sessionId',(actor->>'sessionId')::uuid,'bindingId',b.id,
  'principalId',b.subject_principal_id,'subjectId',s.id,
  'accountAuthSessionRevision',actor->'account_auth_session_revision','sessionRevision',actor->'session_revision',
  'principalRevision',sp.principal_revision,'lifecycleRevision',s.lifecycle_revision,'bindingRevision',s.subject_binding_revision,
  'sourceReceipt',encode(extensions.digest(jsonb_build_object('binding',to_jsonb(b),'fileId',source->'fileId',
   'sourceSha256',source->'sourceSha256','membershipSha256',source->'membershipSha256','publicationRevision',source->'publicationRevision')::text,'sha256'),'hex'),
  'caseHash',encode(extensions.digest(jsonb_build_object('case',to_jsonb(c),'envelope',to_jsonb(e))::text,'sha256'),'hex')),
  'envelope',jsonb_build_object('format',c.review_case_format,'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),
   'workingCiphertextHex',encode(e.working_ciphertext,'hex'),'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex')));
end $body$;
revoke all on function private.current_account_correction_statement_v1(jsonb,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.account_correction_statement_inventory_v1(p_origin jsonb,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; frame jsonb; rows jsonb:='[]'; counts jsonb; digest bytea;
 subjects uuid[]; a uuid:=(p_origin->>'accountId')::uuid; n bigint:=0; earliest timestamptz;
begin
 if not private.requester_statement_test_enabled_v1() then raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 -- Complete actual class census. Nonempty unregistered legacy input is refused;
 -- its ciphertext, identity and retention are never reinterpreted.
 if exists(select 1 from public.appeal_intakes where appellant_account_id=a or appellant_principal_id in(
   select id from public.subject_principals where account_id=a)) then
  raise exception using errcode='0A000',message='requester_appeal_format_unavailable';end if;
 digest:=extensions.digest(convert_to('test-account-own-statements-v1','UTF8'),'sha256');
 for c in select * from public.correction_requests where subject_id=any(subjects)
  or claimant_principal_id in(select id from public.subject_principals where account_id=a) order by id for share loop
  if c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
   or not(c.subject_id=any(subjects)) then raise exception using errcode='0A000',message='requester_statement_format_unavailable';end if;
  if c.state in('submitted','reviewing') then
   frame:=private.current_account_correction_statement_v1(p_origin,c.id);
   n:=n+1;earliest:=least(earliest,c.review_deadline);
   rows:=rows||jsonb_build_array(jsonb_build_object('correctionId',c.id,'subjectId',c.subject_id,
    'caseHash',frame#>>'{binding,caseHash}','originalDeadline',c.review_deadline));
   digest:=extensions.digest(digest||convert_to(c.id::text||':'||(frame->'binding')::text||E'\n','UTF8'),'sha256');
  elsif c.state not in('rejected','withdrawn','expired') or c.terminal_shredded_at is null
   or exists(select 1 from private.new_correction_case_envelopes where correction_id=c.id) then
   raise exception using errcode='42501',message='not_found';end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('subjectId',subject,'rows',amount) order by subject),'[]') into counts from(
  select x->>'subjectId' subject,count(*) amount from jsonb_array_elements(rows)x group by x->>'subjectId')grouped;
 return jsonb_build_object('version','test-account-own-statements-v1','corrections',n,'appeals',0,
  'membershipSha256',encode(digest,'hex'),'originalDeadline',earliest,'partitions',counts,'cases',rows);
end $body$;
revoke all on function private.account_correction_statement_inventory_v1(jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)
 rename to export_account_owned_capture_before_requester_statement_v1;
revoke all on function private.export_account_owned_capture_before_requester_statement_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.export_account_owned_capture_pre_classes_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare captured jsonb; inventory jsonb; receipt text;
begin
 captured:=private.export_account_owned_capture_before_requester_statement_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' or not private.requester_statement_test_enabled_v1() then return captured;end if;
 inventory:=private.account_correction_statement_inventory_v1(p_origin,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','test-account-own-statements-capture-v1',
  'capture',captured,'ownStatements',inventory)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('ownStatements',inventory-'cases');
end $body$;
revoke all on function private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)
 rename to export_archive_request_before_requester_statement_v1;
revoke all on function public.export_archive_request_before_requester_statement_v1(text,jsonb,text,uuid,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_request_v1(p_operation text,p_origin jsonb,p_target_kind text,p_target_id uuid,
 p_payload jsonb default null,p_csrf_binding text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; inventory jsonb; task_export_id uuid; deadline_at timestamptz;
begin
 result:=public.export_archive_request_before_requester_statement_v1(p_operation,p_origin,p_target_kind,p_target_id,p_payload,p_csrf_binding);
 if p_operation='create' and p_target_kind='account' and private.requester_statement_test_enabled_v1() then
  inventory:=private.account_correction_statement_inventory_v1(p_origin,
   private.export_account_owned_capture_before_requester_statement_v1(p_origin,p_target_kind,p_target_id));
  task_export_id:=(result->>'exportId')::uuid;
  insert into private.new_correction_archive_cases(export_id,correction_id,original_deadline,case_hash,original_author_principal_id,origin_account_id)
  select task_export_id,(x->>'correctionId')::uuid,(x->>'originalDeadline')::timestamptz,x->>'caseHash',
   (private.current_account_correction_statement_v1(p_origin,(x->>'correctionId')::uuid)#>>'{binding,principalId}')::uuid,(p_origin->>'accountId')::uuid
   from jsonb_array_elements(inventory->'cases')x;
  deadline_at:=(inventory->>'originalDeadline')::timestamptz;
  if deadline_at is not null then update private.export_archive_jobs
   set deadline=least(deadline,deadline_at) where export_id=task_export_id;end if;
 end if;
 return result;
end $body$;
revoke all on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text) to service_role;

alter function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)
 rename to export_archive_account_classes_before_requester_statement_v1;
revoke all on function public.export_archive_account_classes_before_requester_statement_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_account_classes_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_kind text default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare result jsonb; permit jsonb; captured jsonb;
begin
 result:=public.export_archive_account_classes_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_kind,p_after_id);
 if p_operation='context' and private.requester_statement_test_enabled_v1() then
  permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
  captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
  result:=result||jsonb_build_object('ownStatements',captured->'ownStatements');
 end if;
 return result;
end $body$;
revoke all on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid) to service_role;

alter function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)
 rename to export_archive_account_members_before_requester_statement_v1;
revoke all on function public.export_archive_account_members_before_requester_statement_v1(text,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_account_members_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid default null,p_after_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare permit jsonb; captured jsonb; inventory jsonb; row record; frame jsonb; rows jsonb:='[]'; n integer:=0; last_id uuid;
begin
 if p_operation<>'own-statements' then return public.export_archive_account_members_before_requester_statement_v1(
  p_operation,p_export_id,p_attempt_id,p_authority_receipt,p_subject_id,p_after_id);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind'<>'account' or not private.requester_statement_test_enabled_v1() then
  raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 inventory:=private.account_correction_statement_inventory_v1(permit->'origin',captured);
 if inventory->'cases' is distinct from(select coalesce(jsonb_agg(jsonb_build_object('correctionId',b.correction_id,
  'subjectId',c.subject_id,'caseHash',b.case_hash,'originalDeadline',b.original_deadline) order by b.correction_id),'[]')
  from private.new_correction_archive_cases b join public.correction_requests c on c.id=b.correction_id where b.export_id=p_export_id)
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id and state<>'active') then
  raise exception using errcode='42501',message='not_found';end if;
 for row in select b.correction_id from private.new_correction_archive_cases b join public.correction_requests c on c.id=b.correction_id
  where b.export_id=p_export_id and c.subject_id=p_subject_id
   and(p_after_id is null or b.correction_id>p_after_id::uuid) order by b.correction_id limit 32 loop
  frame:=private.current_account_correction_statement_v1(permit->'origin',row.correction_id);
  rows:=rows||jsonb_build_array(jsonb_build_object('id',row.correction_id,'frame',frame));n:=n+1;last_id:=row.correction_id;
 end loop;
 perform private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 return jsonb_build_object('rows',rows,'count',n,'nextAfterId',last_id);
end $body$;
revoke all on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) to service_role;

-- SOURCE ONLY. Exact current 039 class body plus one guarded TEST branch.
create or replace function private.export_account_class_inventory_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 select array_agg(id order by id) into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_account_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_account_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   if exists(select 1 from public.embryos e where e.subject_id=any(ordinary))
    or (kind='report_artifacts' and exists(select 1 from public.report_artifacts r where r.subject_id=any(ordinary) or r.cohort_id=any(cohorts))) then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  elsif kind in('embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals',
   'embryo_donor_attributions','embryo_participant_sets','family_pairs') then
   handling:='graph';
   select (x->>'rows')::bigint,decode(x->>'membershipSha256','hex'),x->'partitions' into n,digest,counts
    from jsonb_array_elements(p_capture#>'{readableGraph,inventory}')x where x->>'kind'=kind;
   if n is null or digest is null or counts is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  elsif kind='path_b_report_bindings' then
   handling:='path-b-results';
   for item in select x->>'id' id,x->>'subjectId' subject,x->>'rowText' row_text
    from jsonb_array_elements(p_capture->'pathBResults')s cross join lateral jsonb_array_elements(s->'records')x
    order by (x->>'id') collate "C" loop
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.id||':'||item.subject||':'||item.row_text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','rows',x->'rows') order by x->>'subjectId'),'[]') into counts
    from jsonb_array_elements(p_capture->'pathBResults')x where (x->>'rows')::bigint>0;
   -- Exact recipient-scoped internal bindings have a registered result-only
   -- subject projection. Other recipients' grants/results are not borrowed.
   if n<>(select count(*) from private.path_b_report_bindings b where b.recipient_account_id=p_account) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  elsif kind='correction_requests' and private.requester_statement_test_enabled_v1() then
   handling:='requester-statements';
   if p_capture#>>'{ownStatements,version}' is distinct from 'test-account-own-statements-v1' then
    raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   n:=(p_capture#>>'{ownStatements,corrections}')::bigint;
   digest:=decode(p_capture#>>'{ownStatements,membershipSha256}','hex');
   counts:=p_capture#>'{ownStatements,partitions}';
  elsif kind='other_adult_held_uploads' then
   handling:='excluded';
   select count(*) into n from public.other_adult_held_uploads h where h.uploader_account_id=p_account or h.subject_id=any(subjects);
   if n<>coalesce((select sum((x->>'excludedHeldUploads')::bigint) from jsonb_array_elements(p_capture->'pathBResults')x),0) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
   digest:=extensions.digest(convert_to('account-excluded-held-objects-v1|'||coalesce((select jsonb_agg(to_jsonb(h) order by h.id)
    from public.other_adult_held_uploads h where h.subject_id=any(subjects)),'[]')::text,'UTF8'),'sha256');
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where owner_account_id=p_account or parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where uploader_account_id=p_account or subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where recipient_account_id=p_account or subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end
$body$;
revoke all on function private.export_account_class_inventory_v1(uuid,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY. Existing real archive download grant, live origin, exact ready
-- attempt and original deadline; an allocation UUID is not a read capability.
create function private.current_requester_statement_r2_read_v1(p_download_hash text,p_attempt uuid,p_ordinal bigint,p_receipt text)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare d private.export_archive_downloads;e public.generated_exports;j private.export_archive_jobs;
 a private.export_archive_attempts;s private.export_archive_segments;r private.new_correction_archive_r2_allocations;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_download_hash,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into d from private.export_archive_downloads where cookie_hash=p_download_hash;
 select * into j from private.export_archive_jobs where export_id=d.export_id;
 -- Existing origin door takes the subject/session authority lock before grants
 -- and attempt locks. It recomputes exact case-bound receipt via V4 capture.
 perform private.export_archive_current_v1(d.export_id,p_receipt);
 select * into d from private.export_archive_downloads where cookie_hash=p_download_hash for share;
 select * into e from public.generated_exports where id=d.export_id for share;
 select * into j from private.export_archive_jobs where export_id=e.id for share;
 select * into a from private.export_archive_attempts where id=p_attempt and export_id=e.id for share;
 select * into s from private.export_archive_segments where attempt_id=a.id and ordinal=p_ordinal for share;
 select * into r from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=s.ordinal for share;
 if not private.requester_statement_test_enabled_v1() or d.id is null or d.revoked_at is not null
  or d.expires_at<=clock_timestamp() or d.idle_expires_at<=clock_timestamp()
  or d.attempt_id is distinct from a.id or d.export_revision is distinct from e.export_revision
  or d.authority_receipt is distinct from p_receipt or e.status<>'ready' or e.expires_at<=clock_timestamp()
  or j.deadline<=clock_timestamp() or j.active_attempt is distinct from a.id or a.state<>'bytes_complete'
  or r.id is null or r.state<>'written' or s.object_id is distinct from r.id or s.acknowledged_at is null
  or s.delete_acknowledged_at is not null or r.original_deadline<=clock_timestamp()
  or not exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state='active')
  or exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state<>'active') then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('objectId',r.id,'writeIdentity',r.write_identity,'writeBindingSha256',r.write_binding_sha256,
  'allocationSha256',r.allocation_sha256,'configurationSha256',r.configuration_sha256,'originalDeadline',r.original_deadline);
end $body$;
revoke all on function private.current_requester_statement_r2_read_v1(text,uuid,bigint,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY. Literal actual copies, not a guess from provider age/absence.
-- The actual baseline segments are plaintext in Supabase exports. There is no
-- archive encryption key table in that producer. The statement key remains in
-- V3's case envelope; runtime central-directory buffers are inventoried below.
do $stores$
declare ordering integer; name text;
begin
 select max(delete_order)+1 into ordering from public.purge_targets;
 insert into public.purge_targets(target_id,delete_order) values('correction-case-export-copies',ordering);
 insert into public.purge_manifest_class_targets(manifest_class,target_id)
 values('review-working','correction-case-export-copies'),('complete-retention','correction-case-export-copies');
 ordering:=0;
 foreach name in array array['private.new_correction_archive_provider_dispositions','private.new_correction_archive_r2_allocations','public.download_ranges','public.download_sessions','private.export_archive_downloads',
  'private.export_archive_manifest_pages','private.export_archive_segments','private.new_correction_archive_runs',
  'private.new_correction_archive_cases','private.export_archive_attempts','private.export_archive_nonce_uses',
  'private.export_archive_jobs','public.generated_exports','storage.objects'] loop
  ordering:=ordering+1;
  insert into public.purge_target_stores(target_id,store_name,store_order)
  values('correction-case-export-copies',name,ordering);
 end loop;
end $stores$;

create function private.new_correction_archive_graph_v1(p_case uuid)
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 with exports as(select export_id from private.new_correction_archive_cases where correction_id=p_case),
 attempts as(select id from private.export_archive_attempts where export_id in(select export_id from exports))
 select 'correction-case-export-copies','private.new_correction_archive_provider_dispositions',
  jsonb_build_object('attempt_id',t.attempt_id,'ordinal',t.ordinal)
 from private.new_correction_archive_provider_dispositions t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.new_correction_archive_r2_allocations',jsonb_build_object('id',t.id)
 from private.new_correction_archive_r2_allocations t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','public.download_ranges',jsonb_build_object('session_id',t.session_id,'range_sequence',t.range_sequence)
 from public.download_ranges t where t.session_id in(select id from public.download_sessions where target_kind='export' and target_id in(select export_id from exports))
 union all select 'correction-case-export-copies','public.download_sessions',jsonb_build_object('id',t.id)
 from public.download_sessions t where t.target_kind='export' and t.target_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_downloads',jsonb_build_object('id',t.id)
 from private.export_archive_downloads t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_manifest_pages',jsonb_build_object('attempt_id',t.attempt_id,'page',t.page)
 from private.export_archive_manifest_pages t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.export_archive_segments',jsonb_build_object('attempt_id',t.attempt_id,'ordinal',t.ordinal)
 from private.export_archive_segments t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.new_correction_archive_runs',jsonb_build_object('id',t.id)
 from private.new_correction_archive_runs t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.new_correction_archive_cases',jsonb_build_object('export_id',t.export_id,'correction_id',t.correction_id)
 from private.new_correction_archive_cases t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_attempts',jsonb_build_object('id',t.id)
 from private.export_archive_attempts t where t.id in(select id from attempts)
 union all select 'correction-case-export-copies','private.export_archive_nonce_uses',jsonb_build_object('nonce_hash',t.nonce_hash)
 from private.export_archive_nonce_uses t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_jobs',jsonb_build_object('export_id',t.export_id)
 from private.export_archive_jobs t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','public.generated_exports',jsonb_build_object('id',t.id)
 from public.generated_exports t where t.id in(select export_id from exports)
 union all select 'correction-case-export-copies','storage.objects',jsonb_build_object('id',t.id,'bucket_id',t.bucket_id,'name',t.name)
 from storage.objects t where t.bucket_id='exports' and t.name in(
  select object_key from private.export_archive_segments where attempt_id in(select id from attempts))
$body$;
revoke all on function private.new_correction_archive_graph_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Called while V3 holds the real subject/case locks BEFORE its immutable
-- inventory. Revoke the entire shared archive: a ZIP cannot retain one closed
-- statement while removing its bytes without creating a new separate archive.
create function private.close_new_correction_archives_v1(p_case uuid)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare e public.generated_exports; c public.correction_requests; b record;
begin
 select * into c from public.correction_requests where id=p_case for update;
 for b in select export_id from private.new_correction_archive_cases where correction_id=c.id order by export_id loop
  select * into e from public.generated_exports where id=b.export_id for update;
  perform 1 from private.export_archive_jobs where export_id=e.id for update;
  perform 1 from private.export_archive_attempts where export_id=e.id order by id for update;
  perform 1 from private.export_archive_segments where attempt_id in(
   select id from private.export_archive_attempts where export_id=e.id) order by attempt_id,ordinal for update;
  perform 1 from private.new_correction_archive_cases where export_id=e.id order by correction_id for update;
  if e.id is null or not(
   (e.origin_kind='independent-rights' and e.account_id is null and e.target_kind='subject' and e.target_id=c.subject_id
    and not exists(select 1 from private.new_correction_archive_cases link join public.correction_requests other on other.id=link.correction_id
     where link.export_id=e.id and(other.subject_id is distinct from c.subject_id or link.original_author_principal_id is distinct from e.requester_principal_id or link.origin_account_id is not null)))
   or(e.origin_kind='account' and e.account_id is not null and e.target_kind='account' and e.target_id=e.account_id
    and not exists(select 1 from private.new_correction_archive_cases link join public.correction_requests other on other.id=link.correction_id
     where link.export_id=e.id and(link.origin_account_id is distinct from e.account_id
      or not(e.subject_partitions ? other.subject_id::text)
      or(other.terminal_shredded_at is null and other.claimant_principal_id is distinct from link.original_author_principal_id))))) then
   raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end if;
  update private.new_correction_archive_cases set state='closing' where export_id=e.id;
  update private.new_correction_archive_runs set state='cancellation-requested'
   where export_id=e.id and state='active';
  update public.generated_exports set status='revoked' where id=e.id;
  update private.export_archive_downloads set revoked_at=coalesce(revoked_at,clock_timestamp()) where export_id=e.id;
  update public.download_sessions set status='revoked',ended_at=coalesce(ended_at,clock_timestamp()),session_revision=session_revision+1
   where target_kind='export' and target_id=e.id and status='active';
  update private.export_archive_attempts set state='cleanup_pending',stopped_at=coalesce(stopped_at,clock_timestamp()),
   cleanup_not_before=greatest(coalesce(cleanup_not_before,'-infinity'),lease_expires_at+interval '30 seconds')
   where export_id=e.id and state<>'cleaned';
 end loop;
end $body$;
revoke all on function private.close_new_correction_archives_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Generic metadata ACK is not a provider-disposal proof. Marked copies cannot
-- use the old two-field acknowledge-delete door, even with a service JWT.
alter function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)
 rename to export_archive_cleanup_before_requester_statement_v1;
revoke all on function public.export_archive_cleanup_before_requester_statement_v1(text,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_cleanup_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
begin
 if p_operation='acknowledge-delete' and exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id) then
  raise exception using errcode='42501',message='correction_archive_provider_proof_required';end if;
 return public.export_archive_cleanup_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_payload);
end $body$;
revoke all on function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb) to service_role;

-- A durable runtime reservation exists BEFORE decrypting/serializing any own
-- statement. The bounded memory central directory contains no statement body.
-- Actual buffer disposal is acknowledged only by the holder of the fresh run
-- nonce. Expiry/cancellation/process absence does not manufacture that ACK.
create function public.begin_requester_statement_archive_run_v1(p_export uuid,p_attempt uuid,p_receipt text,p_nonce text)
returns uuid language plpgsql security definer set search_path='' as $body$
declare j private.export_archive_jobs; a private.export_archive_attempts; result uuid;
begin
 perform private.export_archive_current_v1(p_export,p_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export for share;
 select * into a from private.export_archive_attempts where id=p_attempt and export_id=p_export for share;
 if not private.requester_statement_test_enabled_v1() or coalesce(p_nonce,'')!~'^[0-9a-f]{64}$'
  or j.active_attempt is distinct from a.id or a.state<>'writing' or a.lease_expires_at<=clock_timestamp()
  or not exists(select 1 from private.new_correction_archive_cases where export_id=p_export and state='active')
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export and state<>'active')
  or exists(select 1 from private.new_correction_archive_runs where attempt_id=a.id and state<>'buffers-zeroed') then
  raise exception using errcode='42501',message='not_found';end if;
 insert into private.new_correction_archive_runs(export_id,attempt_id,nonce_hash,original_deadline)
 values(p_export,p_attempt,encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex'),j.deadline) returning id into result;
 return result;
end $body$;
create function public.finish_requester_statement_archive_run_v1(p_run uuid,p_nonce text)
returns boolean language plpgsql security definer set search_path='' as $body$
declare run private.new_correction_archive_runs;
begin
 select * into run from private.new_correction_archive_runs where id=p_run for update;
 if run.id is null or coalesce(p_nonce,'')!~'^[0-9a-f]{64}$' or not private.claim_hash_matches_v1(run.nonce_hash,
  encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex')) then
  raise exception using errcode='42501',message='not_found';end if;
 -- Worker invokes this only after its actual finally/zeroization completed.
 -- Crash recovery needs actual process/buffer disposition evidence separately.
 update private.new_correction_archive_runs set state='buffers-zeroed',buffers_zeroed_at=coalesce(buffers_zeroed_at,clock_timestamp()) where id=run.id;
 return true;
end $body$;
revoke all on function public.begin_requester_statement_archive_run_v1(uuid,uuid,text,text),
 public.finish_requester_statement_archive_run_v1(uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.begin_requester_statement_archive_run_v1(uuid,uuid,text,text),
 public.finish_requester_statement_archive_run_v1(uuid,text) to service_role;

-- Native provider evidence now enters through the separate NEW R2 issuer and
-- private.ack_new_correction_archive_r2_disposal_v1. Existing Supabase objects
-- have no such allocation and cannot be adopted by this branch. The generic
-- metadata-only acknowledge-delete refusal above remains deliberate.

-- Actual zero-provider-reservation branch has complete physical cleanup now.
-- Any reserved segment, active run, uncertain write or provider copy holds it.
create function private.drain_requester_statement_archive_zero_v1(p_case uuid)
returns boolean language plpgsql security definer set search_path='' as $body$
declare task_export_id uuid; e public.generated_exports; item record;
begin
 for task_export_id in select export_id from private.new_correction_archive_cases where correction_id=p_case order by export_id loop
  select * into e from public.generated_exports where generated_exports.id=task_export_id for update;
  perform 1 from private.export_archive_jobs where export_id=task_export_id for update;
  perform 1 from private.export_archive_attempts where export_id=task_export_id order by export_archive_attempts.id for update;
  perform 1 from private.new_correction_archive_runs where export_id=task_export_id order by new_correction_archive_runs.id for update;
  if exists(select 1 from private.new_correction_archive_cases where export_id=task_export_id and state<>'closing')
   or exists(select 1 from private.new_correction_archive_runs where export_id=task_export_id and state<>'buffers-zeroed')
   or exists(select 1 from private.export_archive_segments s join private.export_archive_attempts a on a.id=s.attempt_id
    left join private.new_correction_archive_r2_allocations r on r.attempt_id=s.attempt_id and r.ordinal=s.ordinal
    left join private.new_correction_archive_provider_dispositions d on d.attempt_id=s.attempt_id and d.ordinal=s.ordinal
    where a.export_id=task_export_id and(r.id is null or r.state<>'disposed' or d.reservation_hash is distinct from r.reservation_sha256
     or d.backend is distinct from 'archive-r2-current-object-v1' or d.immutable_evidence is distinct from r.provider_evidence
     or s.delete_acknowledged_at is null))
   or exists(select 1 from storage.objects o where o.bucket_id='exports' and o.name in(
    select s.object_key from private.export_archive_segments s join private.export_archive_attempts a on a.id=s.attempt_id where a.export_id=task_export_id)) then
   return false;end if;
  -- Only durable, exact, native R2 dispositions reach these physical deletes.
  delete from private.new_correction_archive_provider_dispositions where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  delete from private.new_correction_archive_r2_allocations where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  delete from private.export_archive_segments where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  -- Delete only its exact durable child rows, retaining no orphan cookie/nonce.
  delete from private.new_correction_archive_runs where export_id=task_export_id;
  delete from private.export_archive_downloads where export_id=task_export_id;
  delete from public.download_ranges where session_id in(select d.id from public.download_sessions d where d.target_kind='export' and d.target_id=task_export_id);
  delete from public.download_sessions where target_kind='export' and target_id=task_export_id;
  delete from private.export_archive_manifest_pages where attempt_id in(select export_archive_attempts.id from private.export_archive_attempts where export_id=task_export_id);
  delete from private.export_archive_nonce_uses where export_id=task_export_id;
  delete from private.new_correction_archive_cases where export_id=task_export_id;
  -- The actual guard removes empty attempts/jobs and checks no segment remains.
  delete from public.generated_exports where generated_exports.id=task_export_id;
 end loop;
 return not exists(select 1 from private.new_correction_archive_cases where correction_id=p_case);
end $body$;
revoke all on function private.drain_requester_statement_archive_zero_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- SOURCE ONLY. Exact literal PK census; no arbitrary predicate/SQL from callers.
create function private.requester_statement_archive_row_count_v1(p_store text,p_key jsonb)
returns bigint language plpgsql security definer set search_path='' as $body$
declare keys text[];n bigint;predicate text;
begin
 case p_store
 when 'private.new_correction_archive_cases' then keys:=array['export_id','correction_id'];
 when 'private.new_correction_archive_runs' then keys:=array['id'];
 when 'private.new_correction_archive_r2_allocations' then keys:=array['id'];
 when 'private.new_correction_archive_provider_dispositions' then keys:=array['attempt_id','ordinal'];
 when 'private.export_archive_jobs' then keys:=array['export_id'];
 when 'private.export_archive_attempts' then keys:=array['id'];
 when 'private.export_archive_downloads' then keys:=array['id'];
 when 'private.export_archive_manifest_pages' then keys:=array['attempt_id','page'];
 when 'private.export_archive_segments' then keys:=array['attempt_id','ordinal'];
 when 'private.export_archive_nonce_uses' then keys:=array['nonce_hash'];
 when 'public.generated_exports' then keys:=array['id'];
 when 'public.download_sessions' then keys:=array['id'];
 when 'public.download_ranges' then keys:=array['session_id','range_sequence'];
 when 'storage.objects' then keys:=array['id','bucket_id','name'];
 else raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end case;
 if p_key is null or jsonb_typeof(p_key)<>'object' or exists(select 1 from jsonb_each(p_key) where value='null'::jsonb)
  or(select array_agg(k order by k) from jsonb_object_keys(p_key)k) is distinct from(select array_agg(k order by k) from unnest(keys)k) then
  raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end if;
 select string_agg(format('t.%I=k.%I',key,key),' and ') into predicate from unnest(keys)key;
 execute format('select count(*) from %s t,jsonb_populate_record(null::%s,$1)k where %s',p_store,p_store,predicate) into n using p_key;
 if n>1 then raise exception using errcode='55000',message='correction_archive_disposal_unavailable';end if;
 return n;
end $body$;
revoke all on function private.requester_statement_archive_row_count_v1(text,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;


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

-- SOURCE ONLY. Global non-personal operation signing material, distinct from
-- every independent case data key. DDL creates it once; GET never creates or
-- rotates a key, case, credential, session or consumed nonce row.
create table private.new_correction_review_operation_key (
 singleton boolean primary key check(singleton is true),
 key_bytes bytea not null check(octet_length(key_bytes)=32)
);
alter table private.new_correction_review_operation_key enable row level security;
revoke all on table private.new_correction_review_operation_key
 from public,anon,authenticated,service_role,inherit_upload_only;
insert into private.new_correction_review_operation_key values(true,extensions.gen_random_bytes(32));
create function private.mint_native_correction_review_nonce_v1(p_case uuid,p_binding jsonb,p_deadline timestamptz)
returns text language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare secret bytea; payload text; nonce text; expires bigint; token text;
begin
 if p_deadline<=clock_timestamp() then raise exception using errcode='42501',message='correction_unavailable';end if;
 select key_bytes into strict secret from private.new_correction_review_operation_key where singleton;
 nonce:=rtrim(translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_'),'=');
 expires:=floor(extract(epoch from least(clock_timestamp()+interval '10 minutes',p_deadline))*1000)::bigint;
 payload:=rtrim(translate(replace(encode(convert_to(jsonb_build_object('operation','future-person-correction-review-decision',
  'caseId',p_case,'readBinding',p_binding,'originalDeadline',p_deadline,'nonce',nonce,'expiresAt',expires)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=');
 token:=payload||'.'||encode(extensions.hmac(convert_to('future-person-correction-review-decision|'||payload,'UTF8'),secret,'sha256'),'hex');
 if length(token)>2048 then raise exception using errcode='55000',message='correction_nonce_binding_unavailable';end if;
 return token;
end $body$;
create function private.read_native_correction_review_nonce_v1(p_case uuid,p_binding jsonb,p_deadline timestamptz,p_token text)
returns text language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare parts text[]; secret bytea; actual_mac text; claims jsonb; expires bigint; now_ms bigint;
begin
 if p_token is null or length(p_token)>2048 then raise exception using errcode='42501',message='correction_unavailable';end if;
 parts:=string_to_array(p_token,'.');
 if cardinality(parts)<>2 or parts[1]!~'^[A-Za-z0-9_-]+$' or parts[2]!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select key_bytes into strict secret from private.new_correction_review_operation_key where singleton;
 actual_mac:=encode(extensions.hmac(convert_to('future-person-correction-review-decision|'||parts[1],'UTF8'),secret,'sha256'),'hex');
 if not private.claim_hash_matches_v1(parts[2],actual_mac) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 begin
  claims:=convert_from(decode(translate(parts[1],'-_','+/')||repeat('=',(4-length(parts[1])%4)%4),'base64'),'UTF8')::jsonb;
  if jsonb_typeof(claims)<>'object' or (claims-array['nonce','expiresAt']) is distinct from jsonb_build_object(
    'operation','future-person-correction-review-decision','caseId',p_case,'readBinding',p_binding,'originalDeadline',p_deadline)
   or jsonb_typeof(claims->'nonce') is distinct from 'string' or claims->>'nonce'!~'^[A-Za-z0-9_-]{32}$'
   or jsonb_typeof(claims->'expiresAt') is distinct from 'number' or claims->>'expiresAt'!~'^[0-9]+$' then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  expires:=(claims->>'expiresAt')::bigint;now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if expires<=now_ms or expires>now_ms+600000 or expires>floor(extract(epoch from p_deadline)*1000)::bigint then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 exception when invalid_text_representation or character_not_in_repertoire or numeric_value_out_of_range then
  raise exception using errcode='42501',message='correction_unavailable';
 end;
 return claims->>'nonce';
end $body$;
-- Route unwraps a rejection basis only after this real own-JWT native check.
-- The mutating reject transaction repeats the same check before consuming it.
create function public.check_new_correction_review_nonce_v1(p_id uuid,p_expected_read jsonb,p_token text)
returns text language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare actor jsonb; c public.correction_requests;
begin
 actor:=private.correction_reviewer_context_v1(false);c:=private.current_new_correction_v1(p_id,actor,false);
 perform public.check_new_correction_read_v1(p_id,p_expected_read);
 return private.read_native_correction_review_nonce_v1(c.id,p_expected_read,c.review_deadline,p_token);
end $body$;
revoke all on function private.mint_native_correction_review_nonce_v1(uuid,jsonb,timestamptz),
 private.read_native_correction_review_nonce_v1(uuid,jsonb,timestamptz,text),
 public.check_new_correction_review_nonce_v1(uuid,jsonb,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.check_new_correction_review_nonce_v1(uuid,jsonb,text) to authenticated;

-- Guard functions are INVOKER. The current SQL role is the real role, rather
-- than a SECURITY DEFINER trigger's owner. Existing NULL-format algorithms keep
-- their original behavior; a direct API role cannot manufacture NEW proof.
create function private.guard_new_correction_principal_v1()
returns trigger language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
begin
 if tg_op='DELETE' then
  if (old.reviewer_case_purposes is not null or old.correction_intake_assignee is not null)
   and current_user<>'postgres' then
   raise exception using errcode='42501',message='correction_unavailable';end if;return old;end if;
 if (new.reviewer_case_purposes is not null or new.correction_intake_assignee is not null
   or (tg_op='UPDATE' and (old.reviewer_case_purposes is not null or old.correction_intake_assignee is not null)))
   and current_user<>'postgres' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return new;
end $body$;
create trigger guard_new_correction_principal before insert or update or delete on public.subject_principals
 for each row execute function private.guard_new_correction_principal_v1();

create function private.guard_new_correction_nonce_v1()
returns trigger language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
begin
 if tg_op='DELETE' then
  if old.correction_prepare_binding is not null and current_user<>'postgres' then
   raise exception using errcode='42501',message='correction_unavailable';end if;return old;end if;
 if (new.correction_prepare_binding is not null
   or (tg_op='UPDATE' and old.correction_prepare_binding is not null)) and current_user<>'postgres' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if tg_op='UPDATE' and old.correction_prepare_binding is not null
   and (new.rights_session_id is distinct from old.rights_session_id or new.nonce_hash is distinct from old.nonce_hash
    or new.nonce_revision is distinct from old.nonce_revision or new.expires_at is distinct from old.expires_at
    or (new.correction_prepare_binding is distinct from old.correction_prepare_binding
      and not (new.correction_prepare_binding is null and old.consumed_at is null and new.consumed_at is not null))) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return new;
end $body$;
create trigger guard_new_correction_nonce before insert or update or delete on public.rights_nonces
 for each row execute function private.guard_new_correction_nonce_v1();

create function private.guard_new_correction_row_v1()
returns trigger language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
begin
 if tg_op='DELETE' then
  if old.review_case_format is not null and current_user<>'postgres' then
   raise exception using errcode='42501',message='correction_unavailable';end if;return old;end if;
 if (new.review_case_format is not null or (tg_op='UPDATE' and old.review_case_format is not null))
   and current_user<>'postgres' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if tg_op='UPDATE' and old.review_case_format is not null then
  if new.id is distinct from old.id or new.subject_id is distinct from old.subject_id
   or new.review_case_format is distinct from old.review_case_format or new.requested_field is distinct from old.requested_field
   or new.submitted_at is distinct from old.submitted_at or new.review_deadline is distinct from old.review_deadline
   or new.correction_revision is distinct from old.correction_revision
   or (old.state in ('rejected','withdrawn','expired') and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
  if new.state in ('submitted','reviewing') and (new.claimant_principal_id is distinct from old.claimant_principal_id
    or new.review_case_binding is distinct from old.review_case_binding
    or new.review_case_wrapped_key is distinct from old.review_case_wrapped_key
    or new.statement_ciphertext is distinct from old.statement_ciphertext
    or new.case_working_ciphertext is distinct from old.case_working_ciphertext) then
   raise exception using errcode='42501',message='correction_unavailable';end if;
 end if;
 return new;
end $body$;
create trigger guard_new_correction_row before insert or update or delete on public.correction_requests
 for each row execute function private.guard_new_correction_row_v1();

-- This OWNER-ONLY explicit designation supplies new correction purpose.
-- It never promotes a claim-reviewer membership or a completed old assignment.
create function private.designate_correction_reviewer_v1(p_principal uuid,p_expected_revision bigint,p_enabled boolean)
returns void language plpgsql security invoker set search_path='' set timezone='UTC' as $body$
declare sp public.subject_principals;
begin
 if current_user<>'postgres' or p_enabled is null then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into sp from public.subject_principals where id=p_principal;
 perform 1 from auth.users where id=sp.account_id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 perform 1 from public.profiles where id=sp.account_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into sp from public.subject_principals where id=p_principal for update;
 if sp.id is null or sp.principal_kind<>'reviewer' or sp.subject_id is not null
  or sp.status<>'active' or sp.principal_revision is distinct from p_expected_revision then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 update public.subject_principals set reviewer_case_purposes=array['correction'],
  correction_intake_assignee=p_enabled,principal_revision=principal_revision+1 where id=sp.id;
 -- Current cases bind the older exact reviewer revision and now refuse.
 -- Reassignment requires a separate owner-issued case revision, not inference.
end $body$;

-- All reviewer operations use the caller's OWN authenticated JWT and shared
-- general live-session helper, then add correction purpose. No claim-reviewer
-- helper, client role parameter, service JWT or completed assignment substitutes.
create function private.correction_reviewer_context_v1(p_write boolean)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare claims jsonb; live jsonb; sp public.subject_principals;
begin
 claims:=auth.jwt();
 if claims->>'role' is distinct from 'authenticated' or claims->>'aal' is distinct from 'aal2'
  or jsonb_typeof(claims->'amr') is distinct from 'array' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if p_write then live:=private.assert_live_authenticated_session_write_v1();
 else live:=private.assert_live_authenticated_session_read_v1();end if;
 if live->>'authorized' is distinct from 'true' or not exists (
  select 1 from jsonb_array_elements(claims->'amr') a where a->>'method' in ('totp','webauthn','phone')
   and jsonb_typeof(a->'timestamp')='number' and a->>'timestamp'~'^[0-9]+(?:\.[0-9]+)?$'
   and (a->>'timestamp')::numeric>=extract(epoch from clock_timestamp())-900
   and (a->>'timestamp')::numeric<=extract(epoch from clock_timestamp())+60) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if (select count(*) from public.subject_principals p where p.account_id=auth.uid() and p.subject_id is null
  and p.principal_kind='reviewer' and p.status='active' and p.reviewer_case_purposes=array['correction'])<>1 then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into sp from public.subject_principals where account_id=auth.uid() and subject_id is null
  and principal_kind='reviewer' and status='active' and reviewer_case_purposes=array['correction'];
 -- No principal lock before subject: preserve shared user→session→profile→subject→case→principal order.
 return jsonb_build_object('accountId',auth.uid(),'sessionId',claims->>'session_id',
  'principalId',sp.id,'principalRevision',sp.principal_revision,'live',live);
end $body$;

create function public.prepare_new_correction_v1(p_session_hash text,p_nonce text,p_field text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; reviewer public.subject_principals; frame jsonb;
 submitted timestamptz:=clock_timestamp(); nonce_hash text; next_revision bigint; contact public.encrypted_contact_references;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_field is null
  or p_field not in ('display-label','disposition-record','identity-match-profile','report-provenance','variant-call-source')
  or p_nonce is null or p_nonce!~'^[A-Za-z0-9_-]{16,256}$' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if (select count(*) from public.subject_principals where status='active' and correction_intake_assignee is true)<>1 then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into reviewer from public.subject_principals where status='active' and correction_intake_assignee is true;
 -- Intake prelocks its designated reviewer's user/profile BEFORE subject.
 perform 1 from auth.users where id=reviewer.account_id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 perform 1 from public.profiles where id=reviewer.account_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'correct','api.future-person-correction') then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into reviewer from public.subject_principals where id=reviewer.id for share;
 if reviewer.status<>'active' or reviewer.reviewer_case_purposes is distinct from array['correction']::text[]
  or reviewer.correction_intake_assignee is distinct from true then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 nonce_hash:=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex');
 if exists(select 1 from public.rights_nonces n where n.rights_session_id=rs.id and n.nonce_hash=nonce_hash) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 contact:=private.new_correction_claimant_contact_v1(rs);
 frame:=jsonb_build_object('scope',jsonb_build_object('version',1,'caseKind','correction','caseId',gen_random_uuid(),
  'originalAuthorPrincipalId',rs.principal_id,'initialStatementRevision',1,'originalSubmittedAt',submitted,
  'originalDeadline',submitted+interval '30 days','requestedField',p_field,'originalSubjectId',rs.target_id),
  'rightsSessionId',rs.id,'authorityRevision',rs.authority_revision,'tokenHashId',rs.token_hash_id,
  'reviewerPrincipalId',reviewer.id,'reviewerPrincipalRevision',reviewer.principal_revision,'assignmentRevision',1,
  'sourceContactReferenceId',contact.id,'sourceContactFingerprint',encode(extensions.digest(contact.contact_ciphertext,'sha256'),'hex'),
  'caseContactId',gen_random_uuid());
 select coalesce(max(nonce_revision),0)+1 into next_revision from public.rights_nonces where rights_session_id=rs.id;
 insert into public.rights_nonces(rights_session_id,nonce_hash,nonce_revision,expires_at,consumed_at,correction_prepare_binding)
 values(rs.id,nonce_hash,next_revision,least(rs.expires_at,submitted+interval '10 minutes'),null,frame);
 -- This is a DB-issued reserved nonce/frame, NOT a received correction or delivery.
 return frame;
end $body$;

create function public.commit_new_correction_v1(p_session_hash text,p_nonce text,p_expected jsonb,
 p_statement bytea,p_working bytea,p_wrapped_key bytea,p_contact_cipher bytea,p_contact_hmac_set jsonb)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; n public.rights_nonces; s jsonb; reviewer public.subject_principals;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_nonce is null or p_nonce!~'^[A-Za-z0-9_-]{16,256}$'
  or p_statement is null or octet_length(p_statement) not between 48 and 16028
  or p_working is null or octet_length(p_working) not between 48 and 16384
  or p_wrapped_key is null or octet_length(p_wrapped_key)<>72 then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 -- Same designated reviewer's user/profile prelock prefix as prepare.
 select * into reviewer from public.subject_principals where id=(p_expected->>'reviewerPrincipalId')::uuid;
 perform 1 from auth.users where id=reviewer.account_id and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 perform 1 from public.profiles where id=reviewer.account_id and deletion_requested_at is null for share;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'correct','api.future-person-correction') then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 select * into n from public.rights_nonces where rights_session_id=rs.id
  and nonce_hash=encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex') for update;
 if n.correction_prepare_binding is null or n.correction_prepare_binding is distinct from p_expected
  or n.consumed_at is not null or n.expires_at<=clock_timestamp()
  or p_expected->>'rightsSessionId' is distinct from rs.id::text
  or p_expected->>'tokenHashId' is distinct from rs.token_hash_id::text
  or (p_expected->>'authorityRevision')::bigint is distinct from rs.authority_revision then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 s:=p_expected->'scope';
 select * into reviewer from public.subject_principals where id=reviewer.id for share;
 if reviewer.status<>'active' or reviewer.reviewer_case_purposes is distinct from array['correction']::text[]
  or reviewer.correction_intake_assignee is distinct from true
  or reviewer.principal_revision is distinct from (p_expected->>'reviewerPrincipalRevision')::bigint
  or s->>'originalAuthorPrincipalId' is distinct from rs.principal_id::text
  or s->>'originalSubjectId' is distinct from rs.target_id::text then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 insert into public.correction_requests(id,subject_id,claimant_principal_id,correction_kind,correction_revision,
  statement_ciphertext,submitted_at,review_case_format,requested_field,review_case_binding,review_case_wrapped_key,
  case_working_ciphertext,review_deadline,current_reviewer_principal_id,review_assignment_revision)
 values((s->>'caseId')::uuid,rs.target_id,rs.principal_id,null,1,null,(s->>'originalSubmittedAt')::timestamptz,
  'reviewer-only-case-statement-v1',s->>'requestedField',p_expected,null,null,
  (s->>'originalDeadline')::timestamptz,reviewer.id,1);
 insert into private.new_correction_case_envelopes(correction_id,wrapped_case_key,statement_ciphertext,working_ciphertext)
 values((s->>'caseId')::uuid,p_wrapped_key,p_statement,p_working);
 perform private.capture_new_correction_provenance_v1((s->>'caseId')::uuid);
 perform private.queue_new_correction_ack_v1((s->>'caseId')::uuid,rs,p_expected,p_contact_cipher,p_contact_hmac_set);
 update public.rights_nonces set consumed_at=clock_timestamp(),correction_prepare_binding=null
  where rights_session_id=n.rights_session_id and nonce_revision=n.nonce_revision;
 return jsonb_build_object('status','review_pending','correctionId',s->>'caseId');
end $body$;

create function private.current_new_correction_v1(p_id uuid,p_actor jsonb,p_lock boolean)
returns public.correction_requests language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare c public.correction_requests; reviewer public.subject_principals;
begin
 select * into c from public.correction_requests where id=p_id;
 if p_lock then perform 1 from public.subjects where id=c.subject_id for update;
 else perform 1 from public.subjects where id=c.subject_id for share;end if;
 if p_lock then select * into c from public.correction_requests where id=p_id for update;
 else select * into c from public.correction_requests where id=p_id for share;end if;
 select * into reviewer from public.subject_principals where id=c.current_reviewer_principal_id for share;
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or c.state not in ('submitted','reviewing') or c.review_deadline<=clock_timestamp()
  or c.current_reviewer_principal_id is distinct from (p_actor->>'principalId')::uuid
  or reviewer.account_id is distinct from (p_actor->>'accountId')::uuid or reviewer.status<>'active'
  or reviewer.reviewer_case_purposes is distinct from array['correction']::text[]
  or reviewer.principal_revision is distinct from (c.review_case_binding->>'reviewerPrincipalRevision')::bigint
  or reviewer.principal_revision is distinct from (p_actor->>'principalRevision')::bigint
  or c.current_reviewer_principal_id::text is distinct from c.review_case_binding->>'reviewerPrincipalId'
  or c.review_assignment_revision is distinct from (c.review_case_binding->>'assignmentRevision')::bigint then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if p_lock then perform 1 from private.new_correction_case_envelopes where correction_id=c.id for update;
 else perform 1 from private.new_correction_case_envelopes where correction_id=c.id for share;end if;
 if not found then raise exception using errcode='42501',message='correction_unavailable';end if;
 return c;
end $body$;

-- Explicit NEW pseudonym issuer for a currently proved reviewer event. It
-- creates a genuine account selector; historical NULL ledger actors stay NULL.
create function private.correction_reviewer_audit_v1(p_actor jsonb)
returns uuid language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare result uuid;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.uid() is distinct from (p_actor->>'accountId')::uuid then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 perform pg_catalog.pg_advisory_xact_lock(1229866068,pg_catalog.hashtext(auth.uid()::text));
 select audit_principal_id into result from private.legal_audit_account_principals where account_id=auth.uid();
 if result is null then
  insert into public.audit_principals default values returning id into result;
  insert into private.legal_audit_account_principals(account_id,audit_principal_id) values(auth.uid(),result);
 end if;
 return result;
end $body$;

-- Native GET recomputes the entire case-scoped frame under this caller's
-- own authority, subject/case/envelope/collection locks. No GET refresh exists.
create function public.read_new_correction_statement_v1(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare actor jsonb; c public.correction_requests; e private.new_correction_case_envelopes;
 binding jsonb; provenance jsonb; audit uuid;
begin
 actor:=private.correction_reviewer_context_v1(false);
 c:=private.current_new_correction_v1(p_id,actor,false);
 provenance:=private.current_new_correction_provenance_v1(c);
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 binding:=jsonb_build_object('actor',actor,'assignmentRevision',c.review_assignment_revision,
  'sourceHash',encode(extensions.digest(convert_to(jsonb_build_object('case',to_jsonb(c),
   'envelope',to_jsonb(e),'provenance',provenance)::text,'UTF8'),'sha256'),'hex'));
 audit:=private.correction_reviewer_audit_v1(actor);
 perform private.append_legal_audit_event('correction.review.read',audit,'api.future-person-correction-review','accepted','{}');
 return jsonb_build_object('scope',c.review_case_binding->'scope','assignmentRevision',c.review_assignment_revision,
  'correctionRevision',c.correction_revision,'currentProvenance',provenance,
  'readBinding',binding,'reviewNonce',private.mint_native_correction_review_nonce_v1(c.id,binding,c.review_deadline),
  'envelope',jsonb_build_object('format',c.review_case_format,
   'statementCiphertextHex',encode(e.statement_ciphertext,'hex'),'workingCiphertextHex',encode(e.working_ciphertext,'hex'),
   'wrappedCaseKeyHex',encode(e.wrapped_case_key,'hex')));
 -- Internal closed envelope only; the route unwraps after another own-JWT
 -- current check and returns only the exact five-key registered GET DTO.
end $body$;

create function public.check_new_correction_read_v1(p_id uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare actor jsonb; c public.correction_requests; e private.new_correction_case_envelopes; provenance jsonb;
begin
 actor:=private.correction_reviewer_context_v1(false);
 c:=private.current_new_correction_v1(p_id,actor,false);
 provenance:=private.current_new_correction_provenance_v1(c);
 select * into e from private.new_correction_case_envelopes where correction_id=c.id for share;
 if p_expected is distinct from jsonb_build_object('actor',actor,'assignmentRevision',c.review_assignment_revision,
  'sourceHash',encode(extensions.digest(convert_to(jsonb_build_object('case',to_jsonb(c),
   'envelope',to_jsonb(e),'provenance',provenance)::text,'UTF8'),'sha256'),'hex')) then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return true;
end $body$;

-- The exact terminal dispatcher is defined by correction-terminal.sql.

create function public.reject_new_correction_row_v1(p_id uuid,p_expected_read jsonb,p_revision bigint,p_nonce text,p_reason bytea)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare actor jsonb; c public.correction_requests; audit uuid; verified_nonce text;
begin
 actor:=private.correction_reviewer_context_v1(true);c:=private.current_new_correction_v1(p_id,actor,true);
 perform public.check_new_correction_read_v1(p_id,p_expected_read);
 if c.correction_revision is distinct from p_revision
  or p_reason is null or octet_length(p_reason) not between 48 and 8028 then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 verified_nonce:=private.read_native_correction_review_nonce_v1(c.id,p_expected_read,c.review_deadline,p_nonce);
 -- Own JWT/MFA/currentness and the native stateless token are mandatory here.
 insert into private.new_correction_review_nonce_uses(nonce_hash,correction_id)
 values(encode(extensions.digest(convert_to(verified_nonce,'UTF8'),'sha256'),'hex'),c.id);
 audit:=private.correction_reviewer_audit_v1(actor);
 update private.new_correction_case_envelopes set reviewer_reason_ciphertext=p_reason where correction_id=c.id;
 perform private.shred_new_correction_row_v1(c.id,c.review_case_binding,'rejected',audit);
 perform private.append_legal_audit_event('correction.rejected',audit,'api.future-person-correction-review','rejected','{}');
 return jsonb_build_object('correctionId',c.id,'state','rejected',
  'reviewRevision',(select review_revision from private.new_correction_terminal_outcomes where correction_id=c.id),
  'localKeyAndProseShredded',true,'completeDisposition',private.drain_new_correction_terminal_manifest_v1(c.id));
 -- Only an actual complete disposition is serializable as registered success.
end $body$;

create function public.withdraw_new_correction_row_v1(p_session_hash text,p_id uuid,p_nonce text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare rs public.rights_sessions; c public.correction_requests;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 select * into c from public.correction_requests where id=p_id for update;
 if rs.id is null or c.subject_id is distinct from rs.target_id or c.claimant_principal_id is distinct from rs.principal_id
  or not private.rights_action_permitted_v1(rs.purpose,'correct','api.future-person-correction') then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 perform private.shred_new_correction_row_v1(c.id,c.review_case_binding,'withdrawn',null);
 return jsonb_build_object('state','withdrawn','localKeyAndProseShredded',true,
  'completeDisposition',private.drain_new_correction_terminal_manifest_v1(c.id));
end $body$;

-- Actual fixed phase/claim authorizes due closure; no caller clock or flag.
-- Original case data is shredded even when an external reservation remains.
-- The manifest and exact native phase retain that unresolved disposition.
create function private.expire_new_correction_row_v1(p_retention uuid,p_phase_revision bigint,p_claim_hash text)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $body$
declare r public.retention_rows; p public.retention_due_phases; c public.correction_requests; expected jsonb;
begin
 select * into r from public.retention_rows where id=p_retention;
 select * into c from public.correction_requests where id=r.target_id;
 perform 1 from public.subjects where id=c.subject_id for update;
 select * into r from public.retention_rows where id=p_retention for update;
 select * into c from public.correction_requests where id=r.target_id for update;
 select * into p from public.retention_due_phases where retention_row_id=r.id
  and phase_id='correction-review-close' and phase_revision=p_phase_revision for update;
 expected:=jsonb_build_object('version',1,'caseId',c.id,'format',c.review_case_format,
  'requestedField',c.requested_field,'correctionRevision',c.correction_revision,
  'originalSubmittedAt',c.submitted_at,'originalDeadline',c.review_deadline);
 if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
  or p.claim_token_hash is distinct from p_claim_hash or p_claim_hash is null
  or p_claim_hash!~'^[0-9a-f]{64}$' or p.status<>'claimed' or p.claim_expires_at<=clock_timestamp()
  or r.retention_id<>'future-person.correction-review-30d' or r.target_kind<>'correction' or r.state<>'active'
  or p.phase_deadline is distinct from c.review_deadline or r.fixed_deadline is distinct from c.review_deadline
  or p.phase_deadline>clock_timestamp() or c.review_deadline>clock_timestamp()
  or p.target_id is distinct from c.id or p.immutable_envelope is distinct from expected then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if c.state in('submitted','reviewing') then
  perform private.shred_new_correction_row_v1(c.id,c.review_case_binding,'expired',null);
 end if;
 return private.drain_new_correction_terminal_manifest_v1(c.id);
end $body$;

-- Explicit service worker bridge for an already genuinely claimed close phase.
-- No generic selector, supplied clock, extension or alternate target is added.
create function public.execute_new_correction_due_close_v1(p_retention uuid,p_phase_revision bigint,p_claim_hash text)
returns boolean language plpgsql security definer set search_path='' as $body$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 return private.expire_new_correction_row_v1(p_retention,p_phase_revision,p_claim_hash);
end $body$;
revoke all on function public.execute_new_correction_due_close_v1(uuid,bigint,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.execute_new_correction_due_close_v1(uuid,bigint,text) to service_role;

-- Default PUBLIC EXECUTE is always removed. Private helpers/owner purpose issuer
-- stay denied to all API roles; user JWT doors are denied to service_role.
revoke all on function private.guard_new_correction_principal_v1(),private.guard_new_correction_nonce_v1(),
 private.guard_new_correction_row_v1(),private.designate_correction_reviewer_v1(uuid,bigint,boolean),
 private.correction_reviewer_context_v1(boolean),
 private.current_new_correction_v1(uuid,jsonb,boolean),private.correction_reviewer_audit_v1(jsonb),
 private.shred_new_correction_row_v1(uuid,jsonb,text,uuid),private.expire_new_correction_row_v1(uuid,bigint,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.prepare_new_correction_v1(text,text,text),
 public.commit_new_correction_v1(text,text,jsonb,bytea,bytea,bytea,bytea,jsonb),
 public.read_new_correction_statement_v1(uuid),public.check_new_correction_read_v1(uuid,jsonb),
 public.reject_new_correction_row_v1(uuid,jsonb,bigint,text,bytea),public.withdraw_new_correction_row_v1(text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.prepare_new_correction_v1(text,text,text),
 public.commit_new_correction_v1(text,text,jsonb,bytea,bytea,bytea,bytea,jsonb),public.withdraw_new_correction_row_v1(text,uuid,text) to service_role;
grant execute on function public.read_new_correction_statement_v1(uuid),
 public.check_new_correction_read_v1(uuid,jsonb),public.reject_new_correction_row_v1(uuid,jsonb,bigint,text,bytea) to authenticated;
-- No table or proof-column grants are added. Existing exposed table permissions
-- also require full predecessor/new-column/effective-role capture before binding.
-- Registered route/mail/retention source proposals are separate and inactive.
-- Scientific approval and request-more-information remain outside this reject/withdraw/due candidate.

-- SOURCE ONLY. These are exact new outer branches. Every legacy unmarked body
-- remains byte-identical behind an owner/API-denied predecessor rename. Full
-- native body/ABI/ACL/collision capture is still unbound in the outer fence.
alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_new_correction_v1;
revoke all on function public.claim_mail_outbox_before_new_correction_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.claim_mail_outbox()
returns table(outbox_id uuid,template_id text,template_payload jsonb,idempotency_key text,
 attempt_ordinal smallint,contact_ciphertext bytea,delivery_token text)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare candidate public.mail_outbox; c public.correction_requests; d private.new_correction_delivery;
 reservation jsonb; ordinal integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 -- A bounded native new branch drains or fences all currently eligible marked
 -- rows before legacy delegation. Fresh claims/future rows satisfy the exact
 -- existing old exclusion; no hidden marked row can fall through to that path.
 for ordinal in 1..25 loop
  select * into candidate from public.mail_outbox where correction_case_id is not null
   and state in('queued','claimed') and not_before<=clock_timestamp()
   and(state='queued' or claimed_at<clock_timestamp()-interval '10 minutes')
   order by created_at,id limit 1;
  if candidate.id is null then
   return query select * from public.claim_mail_outbox_before_new_correction_v1();return;
  end if;
  select * into c from public.correction_requests where id=candidate.correction_case_id;
  perform 1 from public.subjects where id=c.subject_id for update;
  select * into c from public.correction_requests where id=c.id for update;
  select * into d from private.new_correction_delivery where correction_id=c.id for update;
  perform private.lock_invitation_transitions_v1();
  select * into candidate from public.mail_outbox where id=candidate.id for update;
  if candidate.id is null or candidate.state not in('queued','claimed')
   or candidate.not_before>clock_timestamp() or(candidate.state='claimed'
    and candidate.claimed_at>=clock_timestamp()-interval '10 minutes') then continue;end if;
  if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
   or c.state not in('submitted','reviewing') or c.review_deadline<=clock_timestamp()
   or d.correction_id is null or d.outbox_id is distinct from candidate.id
   or candidate.expires_at<=clock_timestamp() or candidate.attempt_count>=10
   or exists(select 1 from private.new_correction_mail_reservations where correction_id=c.id
    and state in('reserved','accepted')) then
   insert into private.new_correction_mail_mutation_context values(pg_backend_pid(),txid_current(),candidate.correction_case_id);
   update public.mail_outbox set state=case when expires_at<=clock_timestamp() then 'expired' else 'invalidated' end,
    claimed_at=null,last_outcome_code='correction_acknowledgement_held' where id=candidate.id;
   delete from private.new_correction_mail_mutation_context where backend_pid=pg_backend_pid()
    and transaction_id=txid_current() and correction_id=candidate.correction_case_id;
   continue;
  end if;
  reservation:=private.reserve_new_correction_ack_v1(c.id);
  select * into candidate from public.mail_outbox where id=candidate.id;
  -- No contact/key/plaintext or authorizing bearer leaves this claimant.
  -- The current jobs route takes this exact marker to the transaction adapter.
  return query select candidate.id,candidate.template_id,'{}'::jsonb,
   reservation->>'idempotencyKey',candidate.attempt_count,null::bytea,reservation->>'reservationId';
  return;
 end loop;
 -- More marked ready work may remain: never delegate it to an old selector.
 return;
end $body$;
revoke all on function public.claim_mail_outbox() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.claim_mail_outbox() to service_role;

alter function private.authorize_mail_submission_v1(uuid,smallint)
 rename to authorize_mail_submission_before_new_correction_v1;
revoke all on function private.authorize_mail_submission_before_new_correction_v1(uuid,smallint)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
begin
 if exists(select 1 from public.mail_outbox where id=p_outbox and correction_case_id is not null)
  or exists(select 1 from private.new_correction_mail_reservations where outbox_id=p_outbox) then
  -- A single RPC that releases its locks is not a correction send fence.
  return false;
 end if;
 return private.authorize_mail_submission_before_new_correction_v1(p_outbox,p_attempt);
end $body$;
revoke all on function private.authorize_mail_submission_v1(uuid,smallint)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function public.complete_mail_attempt(uuid,smallint,boolean,text,text)
 rename to complete_mail_attempt_before_new_correction_v1;
revoke all on function public.complete_mail_attempt_before_new_correction_v1(uuid,smallint,boolean,text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.complete_mail_attempt(p_outbox_id uuid,p_attempt_ordinal smallint,p_success boolean,
 p_provider_message_id_hmac text,p_outcome_code text)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if exists(select 1 from public.mail_outbox where id=p_outbox_id and correction_case_id is not null)
  or exists(select 1 from private.new_correction_mail_reservations where outbox_id=p_outbox_id) then
  raise exception using errcode='42501',message='correction_unavailable';
 end if;
 perform public.complete_mail_attempt_before_new_correction_v1(p_outbox_id,p_attempt_ordinal,p_success,
  p_provider_message_id_hmac,p_outcome_code);
end $body$;
revoke all on function public.complete_mail_attempt(uuid,smallint,boolean,text,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.complete_mail_attempt(uuid,smallint,boolean,text,text) to service_role;

alter function public.record_resend_mail_event(text,text,text,timestamptz)
 rename to record_resend_mail_event_before_new_correction_v1;
revoke all on function public.record_resend_mail_event_before_new_correction_v1(text,text,text,timestamptz)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.record_resend_mail_event(p_provider_message_id_hmac text,p_provider_event_hmac text,
 p_status text,p_occurred_at timestamptz)
returns boolean language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 if exists(select 1 from private.new_correction_mail_reservations where provider_message_id_hmac=p_provider_message_id_hmac
   and state='accepted') then
  return private.record_new_correction_ack_event_v1(p_provider_message_id_hmac,p_provider_event_hmac,p_status,p_occurred_at);
 end if;
 return public.record_resend_mail_event_before_new_correction_v1(p_provider_message_id_hmac,p_provider_event_hmac,p_status,p_occurred_at);
end $body$;
revoke all on function public.record_resend_mail_event(text,text,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.record_resend_mail_event(text,text,text,timestamptz) to service_role;

-- SOURCE ONLY. A selector-free scheduled worker proves the original native
-- clock/phase/current case before acquiring a short actual close claim. No
-- caller-selected subject, supplied timestamp or lease extension is accepted.
create function public.drain_due_new_corrections_v1()
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='250ms' as $body$
declare candidate record; c public.correction_requests; r public.retention_rows; p public.retention_due_phases;
 claim_hash text; complete boolean; shredded integer:=0; completed integer:=0; held integer:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='correction_unavailable';end if;
 for candidate in select t.id retention_id,cases.id case_id,cases.subject_id,phase.phase_id,phase.phase_revision
  from public.retention_rows t join public.correction_requests cases on cases.id=t.target_id
  join public.retention_due_phases phase on phase.retention_row_id=t.id
  where t.retention_id='future-person.correction-review-30d' and t.target_kind='correction' and t.state='active'
   and cases.review_case_format='reviewer-only-case-statement-v1' and phase.phase_deadline<=clock_timestamp()
   and phase.phase_id in('correction-acknowledgement','correction-review-close')
   and(phase.status in('pending','retry') or(phase.status='claimed' and phase.claim_expires_at<=clock_timestamp()))
  order by phase.phase_deadline,t.id,phase.phase_id limit 25 loop
  begin
   perform 1 from public.subjects where id=candidate.subject_id for update;
   select * into c from public.correction_requests where id=candidate.case_id for update;
   select * into r from public.retention_rows where id=candidate.retention_id for update;
   select * into p from public.retention_due_phases where retention_row_id=r.id
    and phase_id=candidate.phase_id and phase_revision=candidate.phase_revision for update;
   if c.id is null or c.review_case_format is distinct from 'reviewer-only-case-statement-v1'
    or r.state<>'active' or r.fixed_deadline is distinct from c.review_deadline
    or p.phase_deadline>clock_timestamp() or p.target_id is distinct from c.id
    or(p.status not in('pending','retry') and not(p.status='claimed' and p.claim_expires_at<=clock_timestamp())) then continue;end if;
   if p.phase_id='correction-acknowledgement' then
    -- A signature-verified delivered event completes this phase. Here the
    -- original target has been missed; do not fabricate a delivered receipt.
    update public.retention_due_phases set status='failed',completed_at=clock_timestamp(),
     terminal_outcome_code='acknowledgement-not-delivered',claim_token_hash=null,claim_expires_at=null
    where retention_row_id=r.id and phase_id=p.phase_id and phase_revision=p.phase_revision;
    held:=held+1;continue;
   end if;
   claim_hash:=encode(extensions.gen_random_bytes(32),'hex');
   update public.retention_due_phases set status='claimed',claim_token_hash=claim_hash,
    claim_expires_at=clock_timestamp()+interval '60 seconds',attempts=least(attempts+1,20)
   where retention_row_id=r.id and phase_id=p.phase_id and phase_revision=p.phase_revision;
   complete:=private.expire_new_correction_row_v1(r.id,p.phase_revision,claim_hash);
   if c.state in('submitted','reviewing') then shredded:=shredded+1;end if;
   if complete then completed:=completed+1;else held:=held+1;end if;
  exception when lock_not_available or insufficient_privilege or feature_not_supported
   or object_not_in_prerequisite_state then held:=held+1;
   -- Expected authority/closed-graph failures roll back this one exact case
   -- subtransaction and leave its unchanged due row/body held. Unexpected
   -- failures still abort the batch. The outer hard fence never opens until
   -- all known graph/authority/native race proofs are qualified.
  end;
 end loop;
 return jsonb_build_object('shredded',shredded,'completed',completed,'held',held);
end $body$;
revoke all on function public.drain_due_new_corrections_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.drain_due_new_corrections_v1() to service_role;

-- SOURCE ONLY. Compose NEW rows into the actual 245 closed graph and PK door.
-- Preserve every legacy body behind an API-denied predecessor rename. The
-- unbound outer catalog fence must capture all actual predecessor ABIs/ACLs.
-- No opaque legacy row is converted, inferred, decrypted or backfilled.
do $outcome_store$
declare ordinal integer;
begin
 select max(store_order) into ordinal from public.purge_target_stores
  where target_id='appeal-and-correction-working-packages';
 insert into public.purge_target_stores(target_id,store_name,store_order)
 values('appeal-and-correction-working-packages','private.new_correction_terminal_outcomes',ordinal+1);
end $outcome_store$;

create function private.new_correction_subject_graph_v1(p_subjects uuid[],p_principals uuid[])
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 with cases as(select c.id from public.correction_requests c
  where c.review_case_format='reviewer-only-case-statement-v1'
   and(c.subject_id=any(p_subjects) or c.claimant_principal_id=any(p_principals)))
 select 'appeal-and-correction-working-packages','private.new_correction_case_envelopes',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_case_envelopes t where t.correction_id in(select id from cases)
 union all select 'appeal-and-correction-working-packages','private.new_correction_review_nonce_uses',jsonb_build_object('nonce_hash',t.nonce_hash)
 from private.new_correction_review_nonce_uses t where t.correction_id in(select id from cases)
 union all select 'appeal-and-correction-working-packages','private.new_correction_provenance_observations',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_provenance_observations t where t.correction_id in(select id from cases)
 union all select 'appeal-and-correction-working-packages','private.new_correction_delivery',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_delivery t where t.correction_id in(select id from cases)
 union all select 'appeal-and-correction-working-packages','private.new_correction_terminal_outcomes',jsonb_build_object('correction_id',t.correction_id)
 from private.new_correction_terminal_outcomes t where t.correction_id in(select id from cases)
 union all select 'mail-token-and-rights-delivery-state','private.new_correction_mail_reservations',jsonb_build_object('id',t.id)
 from private.new_correction_mail_reservations t where t.correction_id in(select id from cases)
 union all select 'appeal-and-correction-working-packages','public.correction_requests',jsonb_build_object('id',t.id)
 from public.correction_requests t where t.id in(select id from cases)
 union all select 'contact-refusal-and-rate-limit-state','public.encrypted_contact_references',jsonb_build_object('id',t.id)
 from public.encrypted_contact_references t where t.correction_case_id in(select id from cases)
 union all select 'contact-refusal-and-rate-limit-state','public.contact_hmac_indexes',
  jsonb_build_object('contact_reference_id',t.contact_reference_id,'hmac_key_revision',t.hmac_key_revision)
 from public.contact_hmac_indexes t join public.encrypted_contact_references c on c.id=t.contact_reference_id
 where c.correction_case_id in(select id from cases)
 union all select 'mail-token-and-rights-delivery-state','public.mail_outbox',jsonb_build_object('id',t.id)
 from public.mail_outbox t where t.correction_case_id in(select id from cases)
 union all select 'mail-token-and-rights-delivery-state','public.mail_provider_attempts',jsonb_build_object('id',t.id)
 from public.mail_provider_attempts t where t.correction_case_id in(select id from cases)
 union all select 'mail-token-and-rights-delivery-state','public.mail_deliveries',jsonb_build_object('id',t.id)
 from public.mail_deliveries t where t.correction_case_id in(select id from cases)
$body$;
revoke all on function private.new_correction_subject_graph_v1(uuid[],uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 rename to future_person_deletion_graph_before_new_correction_v1;
revoke all on function private.future_person_deletion_graph_before_new_correction_v1(uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.future_person_deletion_graph_rows_v1(p_subject uuid,p_claimant uuid,p_file uuid,p_embryo uuid,p_audit uuid)
returns table(purge_target_id text,physical_store text,primary_key jsonb)
language plpgsql stable security definer set search_path='' as $body$
begin
 -- The actual old guard must run first, including exact settled custody.
 return query select * from private.future_person_deletion_graph_before_new_correction_v1(
  p_subject,p_claimant,p_file,p_embryo,p_audit)
 union select * from private.new_correction_subject_graph_v1(array[p_subject],
  array(select id from public.subject_principals where subject_id=p_subject));
end $body$;
revoke all on function private.future_person_deletion_graph_rows_v1(uuid,uuid,uuid,uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Close own zero-send correction working data BEFORE the claimant graph is
-- frozen. This is part of the actual DELETE transaction, under actual current
-- rights authority and the same subject lock. Any old prepare failure rolls
-- these changes back too. Unknown/accepted sends refuse before all mutations.
alter function private.prepare_future_person_deletion_v1(text,text)
 rename to prepare_future_person_deletion_before_new_correction_v1;
revoke all on function private.prepare_future_person_deletion_before_new_correction_v1(text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.prepare_future_person_deletion_v1(p_session_hash text,p_nonce text)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare rs public.rights_sessions; c public.correction_requests;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or not private.rights_action_permitted_v1(rs.purpose,'delete','api.future-person-delete') then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform 1 from public.correction_requests where subject_id=rs.target_id
  and review_case_format='reviewer-only-case-statement-v1' order by id for update;
 perform 1 from private.new_correction_mail_reservations where correction_id in(
  select id from public.correction_requests where subject_id=rs.target_id
   and review_case_format='reviewer-only-case-statement-v1') order by id for update;
 if exists(select 1 from private.new_correction_mail_reservations where correction_id in(
   select id from public.correction_requests where subject_id=rs.target_id
    and review_case_format='reviewer-only-case-statement-v1') and state in('reserved','accepted'))
  or exists(select 1 from private.new_correction_mail_mutation_context where correction_id in(
   select id from public.correction_requests where subject_id=rs.target_id
    and review_case_format='reviewer-only-case-statement-v1')) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 for c in select * from public.correction_requests where subject_id=rs.target_id
  and review_case_format='reviewer-only-case-statement-v1' order by id loop
  if c.state in('submitted','reviewing') then
   if c.claimant_principal_id is distinct from rs.principal_id then
    raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   perform private.shred_new_correction_row_v1(c.id,c.review_case_binding,'withdrawn',null);
  end if;
  if not private.drain_new_correction_terminal_manifest_v1(c.id) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end loop;
 return private.prepare_future_person_deletion_before_new_correction_v1(p_session_hash,p_nonce);
end $body$;
revoke all on function private.prepare_future_person_deletion_v1(text,text)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Keep every old closed PK handler. Only literal new stores extend the door.
alter function private.future_person_deletion_row_v1(text,jsonb,boolean)
 rename to future_person_deletion_row_before_new_correction_v1;
revoke all on function private.future_person_deletion_row_before_new_correction_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $body$
declare key_name text; case_id uuid; n bigint; permitted boolean;
begin
 case p_store
 when 'private.new_correction_case_envelopes' then key_name:='correction_id';
 when 'private.new_correction_review_nonce_uses' then key_name:='nonce_hash';
 when 'private.new_correction_provenance_observations' then key_name:='correction_id';
 when 'private.new_correction_delivery' then key_name:='correction_id';
 when 'private.new_correction_terminal_outcomes' then key_name:='correction_id';
 when 'private.new_correction_mail_reservations' then key_name:='id';
 else return private.future_person_deletion_row_before_new_correction_v1(p_store,p_key,p_delete);
 end case;
 if p_key is null or jsonb_typeof(p_key)<>'object' or p_key->key_name is null
  or jsonb_typeof(p_key->key_name)<>'string' or(select count(*) from jsonb_object_keys(p_key))<>1 then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 -- Store identifiers above are literal. Typed PK equality has no arbitrary
 -- relation/predicate/content handle and exposes only a row count.
 execute format('select count(*) from %s t,jsonb_populate_record(null::%s,$1) k where t.%I=k.%I',
  p_store,p_store,key_name,key_name) into n using p_key;
 if n>1 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_delete and n=1 then
  select exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
   join public.retention_due_phases phase on phase.retention_row_id=m.retention_row_id
    and phase.phase_id=m.phase_id and phase.phase_revision=m.phase_revision
   where m.phase_id='future-person-claimed-source-disposal' and m.state='executing'
    and phase.status='claimed' and phase.claim_expires_at>clock_timestamp()
    and e.entry_revision>50 and e.store_name=p_store and e.row_key=p_key and e.status='deleted') into permitted;
  if not permitted then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  if p_store='private.new_correction_mail_reservations' and exists(
    select 1 from private.new_correction_mail_reservations where id=(p_key->>'id')::uuid
     and state<>'confirmed-no-submission') then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  execute format('delete from %s t using jsonb_populate_record(null::%s,$1) k where t.%I=k.%I',
   p_store,p_store,key_name,key_name) using p_key;
  get diagnostics n=row_count;
  if n<>1 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end if;
 return n;
end $body$;
revoke all on function private.future_person_deletion_row_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
do $sealed_stores$
declare name text;
begin
 foreach name in array array['new_correction_case_envelopes','new_correction_review_nonce_uses',
  'new_correction_provenance_observations','new_correction_delivery','new_correction_terminal_outcomes',
  'new_correction_mail_reservations'] loop
  execute format('create trigger guard_new_correction_sealed_graph_delete before delete on private.%I
   for each row execute function private.guard_future_person_sealed_graph_delete_v1()',name);
 end loop;
end $sealed_stores$;

-- Correction controls are minimized by the EXISTING finisher only after all
-- exact original rows are physically absent. Original deadlines/hashes stay.
alter function private.future_person_deletion_controls_v1(uuid)
 rename to future_person_deletion_controls_before_new_correction_v1;
revoke all on function private.future_person_deletion_controls_before_new_correction_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.future_person_deletion_controls_v1(p_manifest uuid)
returns table(control_row_id uuid) language sql stable security definer set search_path='' as $body$
 select * from private.future_person_deletion_controls_before_new_correction_v1(p_manifest)
 union select r.id from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
 where r.retention_id='future-person.correction-review-30d' and r.target_kind='correction'
  and p.phase_id='correction-review-close' and p.immutable_envelope->>'format'='reviewer-only-case-statement-v1'
  and p.immutable_envelope->>'caseId'=r.target_id::text
  and exists(select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
   where e.manifest_id=p_manifest and m.phase_id='future-person-claimed-source-disposal'
    and e.entry_revision>50 and e.store_name='public.correction_requests' and e.row_key=jsonb_build_object('id',r.target_id))
$body$;
revoke all on function private.future_person_deletion_controls_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The actual 235/300 account policy refuses claimed subjects and reviewer
-- principals. Do not silently extend that authority. Add a literal NEW census
-- before its existing native policy guard, before nonce/notices/account hold.
create function private.new_correction_account_graph_v1(p_account uuid)
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 select * from private.new_correction_subject_graph_v1(
  array(select id from public.subjects where owner_account_id=p_account or subject_account_id=p_account),
  array(select id from public.subject_principals where account_id=p_account))
$body$;
revoke all on function private.new_correction_account_graph_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
alter function private.assert_account_path_b_deletion_supported_v1(uuid)
 rename to assert_account_path_b_before_new_correction_v1;
revoke all on function private.assert_account_path_b_before_new_correction_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.assert_account_path_b_deletion_supported_v1(p_account_id uuid)
returns void language plpgsql security definer set search_path='' as $body$
begin
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='55000',message='unsupported_account_graph';end if;
 if exists(select 1 from private.new_correction_account_graph_v1(p_account_id))
  or exists(select 1 from public.correction_requests c join public.subject_principals reviewer
   on reviewer.id=c.current_reviewer_principal_id where reviewer.account_id=p_account_id
    and c.review_case_format='reviewer-only-case-statement-v1' and c.state in('submitted','reviewing')) then
  -- A reviewer assignment does not confer ownership of the claimant's case.
  -- Existing account Path B disposal authority remains closed for this graph.
  raise exception using errcode='55000',message='unsupported_account_graph';end if;
 perform private.assert_account_path_b_before_new_correction_v1(p_account_id);
end $body$;
revoke all on function private.assert_account_path_b_deletion_supported_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;


-- Current native claimant/account graph receives all NEW dependent stores;
-- actual pre-existing account Path-B unsupported authority stays unchanged.
alter function private.new_correction_subject_graph_v1(uuid[],uuid[])
 rename to new_correction_subject_graph_before_requester_statement_v1;
revoke all on function private.new_correction_subject_graph_before_requester_statement_v1(uuid[],uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.new_correction_subject_graph_v1(p_subjects uuid[],p_principals uuid[])
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 select * from private.new_correction_subject_graph_before_requester_statement_v1(p_subjects,p_principals)
 union select graph.* from public.correction_requests c cross join lateral private.new_correction_archive_graph_v1(c.id)graph
 where c.review_case_format='reviewer-only-case-statement-v1'
  and(c.subject_id=any(p_subjects) or c.claimant_principal_id=any(p_principals))
$body$;
revoke all on function private.new_correction_subject_graph_v1(uuid[],uuid[])
 from public,anon,authenticated,service_role,inherit_upload_only;

-- V3 closes each own case before claimant erasure freezes its graph. Closing
-- now also revokes all its exact archives. Native dispose remains a required
-- precondition: no new stores escape the actual sealed subject graph.
alter function private.future_person_deletion_row_v1(text,jsonb,boolean)
 rename to future_person_deletion_row_before_requester_statement_v1;
revoke all on function private.future_person_deletion_row_before_requester_statement_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function private.future_person_deletion_row_v1(p_store text,p_key jsonb,p_delete boolean default false)
returns bigint language plpgsql security definer set search_path='' as $body$
declare n bigint; permitted boolean;
begin
 if p_store not in('private.new_correction_archive_cases','private.new_correction_archive_runs',
  'private.new_correction_archive_r2_allocations','private.new_correction_archive_provider_dispositions') then
  return private.future_person_deletion_row_before_requester_statement_v1(p_store,p_key,p_delete);end if;
 n:=private.requester_statement_archive_row_count_v1(p_store,p_key);
 if p_delete and n<>0 then
  -- Actual V3 preparation must finish copy disposal before issuing its original
  -- immutable whole-subject manifest. Remaining rows are a real source defect,
  -- never an arbitrary deletion capability or guessed provider absence.
  raise exception using errcode='42501',message='claimant deletion archive disposal incomplete';end if;
 return n;
end $body$;
revoke all on function private.future_person_deletion_row_v1(text,jsonb,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
do $sealed_graph$
declare name text;
begin
 foreach name in array array['new_correction_archive_cases','new_correction_archive_runs',
  'new_correction_archive_r2_allocations','new_correction_archive_provider_dispositions'] loop
  execute format('create trigger guard_requester_statement_sealed_graph_delete before delete on private.%I
   for each row execute function private.guard_future_person_sealed_graph_delete_v1()',name);
 end loop;
end $sealed_graph$;

-- SOURCE ONLY. Copy expiry uses the real archive clock. Closing copies never
-- changes the statement's original submission or fixed 30-day case deadline.
create function public.drain_due_requester_statement_copies_v1()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare candidate record; item record; rows jsonb:='[]'; held bigint:=0; disposed bigint:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 for candidate in select distinct c.id,c.subject_id from private.new_correction_archive_cases b
  join private.export_archive_jobs j on j.export_id=b.export_id join public.correction_requests c on c.id=b.correction_id
  where j.deadline<=clock_timestamp() or b.state='closing' order by c.subject_id,c.id limit 25 loop
  begin
   -- Subject/case before its complete export graph. A shared ZIP is revoked
   -- whole when any included case/copy closes; no other case source is changed.
   perform 1 from public.subjects where id=candidate.subject_id for update;
   perform 1 from public.correction_requests where id=candidate.id for update;
   perform private.close_new_correction_archives_v1(candidate.id);
   if private.drain_requester_statement_archive_zero_v1(candidate.id) then disposed:=disposed+1;
   else held:=held+1;end if;
  exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state then held:=held+1;
  end;
 end loop;
 for item in select r.attempt_id,r.ordinal from private.new_correction_archive_r2_allocations r
  join private.export_archive_attempts a on a.id=r.attempt_id
  where r.state in('reserved','written','closing') and a.state='cleanup_pending'
   and a.cleanup_not_before<=clock_timestamp()
   and(r.claim_expires_at is null or r.claim_expires_at<=clock_timestamp())
   and exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing')
  order by r.attempt_id,r.ordinal limit 25 loop
  rows:=rows||jsonb_build_array(jsonb_build_object('attemptId',item.attempt_id,'ordinal',item.ordinal));
 end loop;
 return jsonb_build_object('disposed',disposed,'held',held,'segments',rows);
end $body$;
revoke all on function public.drain_due_requester_statement_copies_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.drain_due_requester_statement_copies_v1() to service_role;

rollback;
