-- Refusal cleanup uses the registered draft phase and frozen manifest. No
-- caller may supply a draft, recipient, bucket or path to the claim endpoint.
create or replace function private.refused_draft_evidence_objects_v1(p_kind text,p_draft uuid)
returns table(object_id uuid) language sql stable security invoker set search_path='' as $$
 with sessions as (
  select id from public.legal_evidence_ingest_sessions
  where target_kind=p_kind and target_id=p_draft
 ), documents as (
  select d.* from public.legal_evidence_documents d where d.session_id in(select id from sessions)
 )
 select f.object_id from public.legal_evidence_fragments f where f.session_id in(select id from sessions)
 union select d.object_id from documents d
 union select c.object_id from public.legal_evidence_review_copies c where c.document_id in(select id from documents)
 union select r.storage_object_id from public.reviewed_evidence r
 where r.id in(select reviewed_evidence_id from documents) and r.storage_object_id is not null;
$$;

create or replace function private.assert_refused_draft_v1(p public.retention_due_phases)
returns text language plpgsql security invoker set search_path='' as $$
declare d public.embryo_cohort_drafts%rowtype; a public.adult_subject_drafts%rowtype;
begin
 if p.immutable_envelope->>'reason' is distinct from 'invitation-refused'
  or p.immutable_envelope->>'draftId' is distinct from p.target_id::text then
  raise exception using errcode='55000',message='refusal_purge_binding_invalid';
 end if;
 if p.retention_id='embryo.cohort-draft-30d' and p.phase_id='embryo-cohort-draft-expiry'
  and p.target_kind='cohort' then
  select * into d from public.embryo_cohort_drafts where id=p.target_id for update;
  if d.id is null or d.state<>'cancelled'
   or d.participant_set_revision<>p.target_lifecycle_revision
   or exists(select 1 from public.embryo_cohorts where draft_id=d.id) then
   raise exception using errcode='55000',message='refusal_purge_draft_changed';
  end if;
  return 'cohort_draft';
 elsif p.retention_id='adult.subject-draft-30d' and p.phase_id='adult-subject-draft-expiry'
  and p.target_kind='subject' then
  select * into a from public.adult_subject_drafts where id=p.target_id for update;
  if a.id is null or a.state<>'cancelled' or a.draft_revision<>p.target_lifecycle_revision
   or not exists(select 1 from public.subjects s where s.id=a.subject_id
    and s.subject_class='other_adult' and s.lifecycle='purge_queued'
    and s.subject_account_id is null)
   or exists(select 1 from public.genome_files where subject_id=a.subject_id)
   or exists(select 1 from public.upload_sessions where subject_id=a.subject_id) then
   -- The current reservation flow has no upload. A future quarantine graph
   -- requires its exact upload-revision executor, never an account-wide purge.
   raise exception using errcode='55000',message='refusal_purge_draft_changed';
  end if;
  return 'adult_draft';
 end if;
 raise exception using errcode='55000',message='refusal_purge_binding_invalid';
end;
$$;

create or replace function private.lock_refused_draft_purge_v1(p_manifest uuid,p_claim text)
returns public.retention_due_phases language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select r.* into p from public.retention_due_phases r join public.purge_manifests x
  on x.retention_row_id=r.retention_row_id and x.phase_id=r.phase_id and x.phase_revision=r.phase_revision
 where x.id=p_manifest for update of r;
 select * into m from public.purge_manifests where id=p_manifest for update;
 if p.retention_row_id is null or p.status<>'claimed' or p_claim is null
  or p.claim_token_hash is distinct from p_claim or p.claim_expires_at<=clock_timestamp()
  or m.state<>'executing' then
  raise exception using errcode='55000',message='refusal_purge_claim_stale';
 end if;
 perform private.assert_refused_draft_v1(p);
 return p;
end;
$$;

create or replace function public.claim_refused_invitation_draft_purge_v1(p_claim_token_hash text)
returns table(manifest_id uuid,storage_objects jsonb)
language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 k text; v_objects uuid[]; v_max bigint;
begin
 if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_retention_claim';
 end if;
 perform private.lock_invitation_transitions_v1();
 select r.* into p from public.retention_due_phases r
 where r.immutable_envelope->>'reason'='invitation-refused'
  and r.retention_id in('embryo.cohort-draft-30d','adult.subject-draft-30d')
  and r.phase_deadline<=clock_timestamp()
  and (r.status in('pending','retry') or (r.status='claimed' and r.claim_expires_at<=clock_timestamp()))
 order by r.phase_deadline,r.retention_row_id for update skip locked limit 1;
 if p.retention_row_id is null then return; end if;
 k:=private.assert_refused_draft_v1(p);
 select x.* into strict m from public.purge_manifests x
 where x.retention_row_id=p.retention_row_id and x.phase_id=p.phase_id and x.phase_revision=p.phase_revision
  and x.manifest_class=case when k='cohort_draft' then 'cohort-draft-complete' else 'adult-draft-complete' end
  and x.state in('frozen','executing') for update;
 select coalesce(array_agg(o.object_id),'{}'::uuid[]) into v_objects
 from private.refused_draft_evidence_objects_v1(k,p.target_id) o;
 if exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id
  and (e.target_id<>'storage-objects' or e.store_name<>'storage.objects'
   or not(coalesce(e.object_id,(e.row_key->>'objectId')::uuid)=any(v_objects)))) then
  raise exception using errcode='55000',message='refusal_purge_manifest_scope_invalid';
 end if;
 -- Reject an object claimed by an unrelated evidence package before any
 -- storage call. Shared reviewed evidence cannot be silently destroyed.
 if exists(
  select 1 from public.legal_evidence_ingest_sessions s
  cross join lateral private.refused_draft_evidence_objects_v1(s.target_kind,s.target_id) o
  where (s.target_kind<>k or s.target_id<>p.target_id) and o.object_id=any(v_objects)
 ) then raise exception using errcode='55000',message='refusal_purge_evidence_shared'; end if;
 if exists(select 1 from storage.objects o where o.id=any(v_objects) and o.bucket_id<>'legal-evidence') then
  raise exception using errcode='55000',message='refusal_purge_storage_binding_invalid';
 end if;
 -- Include reviewed-evidence object copies as well as fragments/documents.
 -- Resume never overwrites an already-frozen address or receipt.
 select coalesce(max(e.entry_revision),0) into v_max from public.purge_manifest_entries e
 where e.manifest_id=m.id;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,object_id,entry_revision,status)
 select m.id,'storage-objects','storage.objects',o.object_id,v_max+row_number() over(order by o.object_id),'pending'
 from unnest(v_objects) o(object_id) where not exists(
  select 1 from public.purge_manifest_entries e where e.manifest_id=m.id
   and (e.object_id=o.object_id or e.row_key->>'objectId'=o.object_id::text)
 );
 -- A UUID reference is converted to an immutable address only by resolving
 -- that exact Storage row. SQL never deletes Storage metadata.
 update public.purge_manifest_entries e set object_id=null,
  row_key=jsonb_build_object('objectId',o.id,'bucketId',o.bucket_id,'objectName',o.name)
 from storage.objects o where e.manifest_id=m.id and e.object_id=o.id
  and e.target_id='storage-objects' and e.store_name='storage.objects' and e.status='pending';
 update public.purge_manifest_entries e set status='missing'
 where e.manifest_id=m.id and e.object_id is not null and e.status='pending'
  and not exists(select 1 from storage.objects o where o.id=e.object_id);
 update public.retention_due_phases set status='claimed',claim_token_hash=p_claim_token_hash,
  claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=least(attempts+1,20)
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.purge_manifests set state='executing' where id=m.id;
 return query select m.id,coalesce(jsonb_agg(e.row_key||jsonb_build_object('ordinal',e.entry_revision)
  order by e.entry_revision) filter(where e.status='pending'),'[]'::jsonb)
 from public.purge_manifest_entries e where e.manifest_id=m.id;
end;
$$;

create or replace function public.complete_refused_invitation_storage_v1(
 p_manifest_id uuid,p_claim_token_hash text,p_ordinals bigint[]
)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform private.lock_refused_draft_purge_v1(p_manifest_id,p_claim_token_hash);
 if p_ordinals is null or cardinality(p_ordinals) not between 1 and 1000
  or cardinality(p_ordinals)<>(select count(distinct x) from unnest(p_ordinals) x)
  or exists(select 1 from unnest(p_ordinals) n where not exists(
   select 1 from public.purge_manifest_entries e where e.manifest_id=p_manifest_id
    and e.entry_revision=n and e.target_id='storage-objects' and e.store_name='storage.objects'
    and e.row_key is not null and e.status in('pending','deleted')
  )) then raise exception using errcode='22023',message='refusal_purge_batch_invalid'; end if;
 -- A claimed success is not evidence of deletion while the exact object or
 -- its frozen address is still present. An ambiguous provider ACK is retried.
 if exists(select 1 from public.purge_manifest_entries e join storage.objects o
  on o.id=(e.row_key->>'objectId')::uuid
   or (o.bucket_id=e.row_key->>'bucketId' and o.name=e.row_key->>'objectName')
  where e.manifest_id=p_manifest_id and e.entry_revision=any(p_ordinals)) then
  raise exception using errcode='55000',message='refusal_purge_storage_remaining';
 end if;
 update public.purge_manifest_entries set status='deleted'
 where manifest_id=p_manifest_id and entry_revision=any(p_ordinals);
end;
$$;

create or replace function public.finish_refused_invitation_draft_purge_v1(
 p_manifest_id uuid,p_claim_token_hash text
)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype; k text; v_subject uuid;
 v_invitations uuid[]; v_contacts uuid[]; v_principals uuid[]; v_mail uuid[];
 v_sessions uuid[]; v_documents uuid[]; v_reviewed uuid[];
begin
 p:=private.lock_refused_draft_purge_v1(p_manifest_id,p_claim_token_hash);
 k:=case when p.target_kind='cohort' then 'cohort_draft' else 'adult_draft' end;
 if exists(select 1 from public.purge_manifest_entries e where e.manifest_id=p_manifest_id
  and e.status not in('deleted','missing'))
  or exists(select 1 from private.refused_draft_evidence_objects_v1(k,p.target_id) e
   join storage.objects o on o.id=e.object_id)
  or exists(select 1 from public.purge_manifest_entries e join storage.objects o
   on o.id=coalesce(e.object_id,(e.row_key->>'objectId')::uuid)
    or (o.bucket_id=e.row_key->>'bucketId' and o.name=e.row_key->>'objectName')
   where e.manifest_id=p_manifest_id) then
  raise exception using errcode='55000',message='refusal_purge_storage_remaining';
 end if;
 if k='adult_draft' then
  select subject_id into v_subject from public.adult_subject_drafts where id=p.target_id;
 end if;
 select coalesce(array_agg(i.id),'{}'::uuid[]) into v_invitations
 from public.subject_invitations i
 where (k='cohort_draft' and i.target_kind='cohort_draft' and i.target_id=p.target_id)
  or (k='adult_draft' and i.target_kind='subject' and i.target_id=v_subject);
 if exists(select 1 from public.subject_invitations where id=any(v_invitations) and status='pending') then
  raise exception using errcode='55000',message='refusal_purge_invitation_current';
 end if;
 select coalesce(array_agg(distinct x.id),'{}'::uuid[]) into v_principals from (
  select s.principal_id id from public.draft_participant_slots s
  where s.embryo_draft_id=p.target_id or s.adult_draft_id=p.target_id
  union select principal_id from public.embryo_draft_participants where draft_id=p.target_id
  union select id from public.subject_principals where subject_id=v_subject
 ) x join public.subject_principals sp on sp.id=x.id
 where sp.principal_kind in('genetic_parent','identified_donor','non_account_subject');
 select coalesce(array_agg(id),'{}'::uuid[]) into v_mail from public.mail_outbox
 where target_kind='subject_invitation' and target_id=any(v_invitations)
  and invitation_terminal_notice_id is null;
 select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_contacts from (
  select contact_reference_id id from public.invitation_candidates where invitation_id=any(v_invitations)
  union select contact_reference_id from public.mail_outbox where id=any(v_mail)
  union select id from public.encrypted_contact_references where principal_id=any(v_principals)
 ) x where id is not null;
 select coalesce(array_agg(id),'{}'::uuid[]) into v_sessions from public.legal_evidence_ingest_sessions
 where target_kind=k and target_id=p.target_id;
 select coalesce(array_agg(id),'{}'::uuid[]),coalesce(array_agg(reviewed_evidence_id)
  filter(where reviewed_evidence_id is not null),'{}'::uuid[])
 into v_documents,v_reviewed from public.legal_evidence_documents where session_id=any(v_sessions);
 delete from public.legal_evidence_assignments where document_id=any(v_documents);
 delete from public.legal_evidence_documents where id=any(v_documents);
 delete from public.legal_evidence_ingest_sessions where id=any(v_sessions);
 -- Keep the review's minimal decision/hash record, never its private object.
 update public.reviewed_evidence set storage_object_id=null,purged_at=clock_timestamp()
 where id=any(v_reviewed);
 delete from public.attestations where
  (target_kind=k and target_id=p.target_id) or (k='adult_draft' and target_kind='subject' and target_id=v_subject);
 delete from public.consent_signatures where
  (target_kind=k and target_id=p.target_id) or (k='adult_draft' and target_kind='subject' and target_id=v_subject);
 delete from public.rights_sessions where
  (target_kind=k and target_id=p.target_id) or (k='adult_draft' and target_kind='subject' and target_id=v_subject)
  or token_hash_id in(select th.id from public.token_hashes th join public.token_candidates tc
   on tc.id=th.candidate_id where tc.outbox_id=any(v_mail));
 delete from public.token_hashes where candidate_id in(select id from public.token_candidates where outbox_id=any(v_mail));
 delete from public.invitation_reminders where invitation_id=any(v_invitations);
 delete from public.token_candidates where outbox_id=any(v_mail);
 delete from public.mail_deliveries where outbox_id=any(v_mail);
 delete from public.mail_provider_attempts where outbox_id=any(v_mail);
 delete from public.mail_outbox where id=any(v_mail);
 delete from public.subject_invitations where id=any(v_invitations);
 delete from public.contact_hmac_indexes where contact_reference_id=any(v_contacts);
 delete from public.encrypted_contact_references where id=any(v_contacts);
 if k='cohort_draft' then
  delete from public.embryo_cohort_drafts where id=p.target_id;
 else
  delete from public.adult_subject_drafts where id=p.target_id;
  delete from public.subject_relationships where subject_id=v_subject;
  delete from public.subject_demographics where subject_id=v_subject;
 end if;
 -- Restricting FKs deliberately reject unexpected shared/live authority.
 -- This is exact draft-principal cleanup, never account-principal deletion.
 delete from public.subject_principals where id=any(v_principals);
 if v_subject is not null then delete from public.subjects where id=v_subject; end if;
 update public.retention_due_phases set status='succeeded',claim_token_hash=null,claim_expires_at=null,
  terminal_outcome_code='invitation_refused_draft_purged',completed_at=clock_timestamp()
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.purge_manifests set state='complete' where id=p_manifest_id;
 update public.retention_rows set state='complete',ended_at=clock_timestamp() where id=p.retention_row_id;
 perform private.append_legal_audit_event('invitation.draft.purged',null,'jobs.retention','accepted',
  jsonb_build_object('kind',k));
end;
$$;

create or replace function public.fail_refused_invitation_draft_purge_v1(p_manifest_id uuid,p_claim_token_hash text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype;
begin
 -- Do not revalidate the graph here: a changed graph is itself a retry reason.
 perform private.lock_invitation_transitions_v1();
 select r.* into p from public.retention_due_phases r join public.purge_manifests m
 on m.retention_row_id=r.retention_row_id and m.phase_id=r.phase_id and m.phase_revision=r.phase_revision
 where m.id=p_manifest_id and r.immutable_envelope->>'reason'='invitation-refused' for update of r;
 if p.status='claimed' and p.claim_token_hash=p_claim_token_hash then
  update public.retention_due_phases set status='retry',claim_token_hash=null,claim_expires_at=null
  where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 end if;
end;
$$;

revoke all on function private.refused_draft_evidence_objects_v1(text,uuid),
 private.assert_refused_draft_v1(public.retention_due_phases),
 private.lock_refused_draft_purge_v1(uuid,text),
 public.claim_refused_invitation_draft_purge_v1(text),
 public.complete_refused_invitation_storage_v1(uuid,text,bigint[]),
 public.finish_refused_invitation_draft_purge_v1(uuid,text),
 public.fail_refused_invitation_draft_purge_v1(uuid,text)
 from public,anon,authenticated;
grant execute on function private.refused_draft_evidence_objects_v1(text,uuid),
 private.assert_refused_draft_v1(public.retention_due_phases),
 private.lock_refused_draft_purge_v1(uuid,text),
 private.lock_invitation_transitions_v1(),
 public.claim_refused_invitation_draft_purge_v1(text),
 public.complete_refused_invitation_storage_v1(uuid,text,bigint[]),
 public.finish_refused_invitation_draft_purge_v1(uuid,text),
 public.fail_refused_invitation_draft_purge_v1(uuid,text)
 to service_role;

-- A cancelled refusal draft belongs to the storage-aware executor above.
-- The original expiry executor must not cancel its registered purge phase.
create or replace function public.run_due_embryo_retention_phases_v1()
returns table (
  draft_id uuid,
  owner_account_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_phase record;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_principals uuid[];
begin
  perform private.lock_invitation_transitions_v1();
  for v_phase in
    select p.retention_row_id, p.phase_id, p.phase_revision, p.target_id
    from public.retention_due_phases p
    where p.retention_id = 'embryo.cohort-draft-30d'
      and p.immutable_envelope->>'reason' is distinct from 'invitation-refused'
      and p.phase_id = 'embryo-cohort-draft-expiry'
      and p.status = 'pending'
      and p.phase_deadline <= v_now
    order by p.phase_deadline
    for update skip locked
  loop
    select d.* into v_draft
    from public.embryo_cohort_drafts d
    where d.id = v_phase.target_id
    for update;

    if v_draft.id is null or v_draft.state not in ('draft', 'evidence_pending', 'ready') then
      update public.retention_due_phases
      set status = 'cancelled', terminal_outcome_code = 'draft_finalized',
          completed_at = v_now
      where retention_row_id = v_phase.retention_row_id
        and phase_id = v_phase.phase_id
        and phase_revision = v_phase.phase_revision;
      update public.purge_manifests set state = 'cancelled'
      where retention_row_id = v_phase.retention_row_id and state = 'frozen';
      update public.retention_rows set state = 'cancelled', ended_at = v_now
      where id = v_phase.retention_row_id and state in ('scheduled', 'active');
      continue;
    end if;

    select coalesce(array_agg(s.principal_id), '{}'::uuid[]) into v_principals
    from public.draft_participant_slots s
    where s.embryo_draft_id = v_draft.id and s.principal_id is not null;

    -- docs/retention.md, embryo.cohort-draft-30d: delete the invitations,
    -- credentials, contacts, HMAC indexes, outbox rows, signatures and the
    -- draft itself. Only the audit event, a refusal-bar HMAC and the
    -- retention rows survive.
    delete from public.attestations
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.consent_signatures
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.rights_sessions
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.token_hashes th
    using public.token_candidates tc
    join public.subject_invitations si on si.id = tc.target_id
    where th.candidate_id = tc.id
      and si.target_kind = 'cohort_draft' and si.target_id = v_draft.id;
    delete from public.mail_outbox m
    where m.recipient_principal_id = any (v_principals);
    delete from public.invitation_candidates ic
    using public.subject_invitations si
    where ic.invitation_id = si.id
      and si.target_kind = 'cohort_draft' and si.target_id = v_draft.id;
    delete from public.subject_invitations
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.contact_hmac_indexes chi
    using public.encrypted_contact_references ecr
    where chi.contact_reference_id = ecr.id
      and ecr.principal_id = any (v_principals);
    delete from public.encrypted_contact_references
    where principal_id = any (v_principals);
    delete from public.embryo_cohort_drafts where id = v_draft.id;
    delete from public.subject_principals
    where id = any (v_principals) and principal_kind = 'genetic_parent';

    update public.retention_due_phases
    set status = 'succeeded', terminal_outcome_code = 'draft_expired',
        completed_at = v_now
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
    update public.purge_manifests set state = 'complete'
    where retention_row_id = v_phase.retention_row_id and state in ('frozen', 'executing');
    update public.retention_rows set state = 'complete', ended_at = v_now
    where id = v_phase.retention_row_id;

    perform private.append_legal_audit_event(
      'embryo.draft.expired', null, 'jobs.retention', 'accepted',
      jsonb_build_object('basis_case', v_draft.basis_case)
    );

    draft_id := v_draft.id;
    owner_account_id := v_draft.owner_account_id;
    return next;
  end loop;

  -- embryo.disposition-proposal-7d: a lapsed proposal is closed with no
  -- disposition, key or retention change.
  for v_phase in
    select p.retention_row_id, p.phase_id, p.phase_revision,
           (p.immutable_envelope ->> 'proposalId')::uuid as proposal_id
    from public.retention_due_phases p
    where p.retention_id = 'embryo.disposition-proposal-7d'
      and p.phase_id = 'embryo-disposition-proposal-expiry'
      and p.status = 'pending'
      and p.phase_deadline <= v_now
    order by p.phase_deadline
    for update skip locked
  loop
    if exists (
      select 1 from public.embryo_disposition_proposals pr
      where pr.id = v_phase.proposal_id and pr.status = 'pending'
    ) then
      perform private.close_embryo_disposition_proposal_v1(
        v_phase.proposal_id, 'expired', 'proposal_expired'
      );
      perform private.append_legal_audit_event(
        'embryo.disposition.proposal-expired', null, 'jobs.retention', 'accepted',
        '{}'::jsonb
      );
    else
      update public.retention_due_phases
      set status = 'cancelled', terminal_outcome_code = 'proposal_closed',
          completed_at = v_now
      where retention_row_id = v_phase.retention_row_id
        and phase_id = v_phase.phase_id
        and phase_revision = v_phase.phase_revision;
      update public.purge_manifests set state = 'cancelled'
      where retention_row_id = v_phase.retention_row_id and state = 'frozen';
      update public.retention_rows set state = 'cancelled', ended_at = v_now
      where id = v_phase.retention_row_id and state in ('scheduled', 'active');
    end if;
  end loop;
  return;
end;
$$;
