-- ADR 0020 safeguard 3: the terminal graph purge of an abandoned embryo
-- upload, and the removal of a published upload's fragment objects.
-- TEST-LOCAL only. No route or scheduler calls these doors yet and
-- EMBRYO_INGEST_AVAILABLE stays false.
--
-- Both run only after 20260929101000's exact storage disposal:
--   * An abandoned attempt (`purpose = 'abandoned'`, planned by
--     prepare_embryo_ingest_unwind_v1) is purged only once its unwind is
--     `storage_confirmed`. One transaction invalidates every Record Key hash
--     and print right, queues exactly one terminal notice slot per frozen
--     Record Key recipient, deletes the attempt graph and the cohort-only
--     authority, terminalizes the exact `embryo.ingest-session-24h` due phase
--     and proves that no row in any store still names a deleted row. Any
--     failure rolls the whole purge back; the unwind stays
--     `storage_confirmed` and can be retried.
--   * A published attempt (`purpose = 'published'`) gets its own cleanup plan
--     in the publication transaction. Its fragment objects go through the
--     same claim, finish and confirm doors, with the same exact evidence.
--     Only after `storage_confirmed` are the fragment, write intent and
--     handle-map rows deleted. Published embryos, QC and genotype rows are
--     never read for writing or deleted here.
--
-- Register: lifecycleDispositionContracts.retention-due-phase-v1 (the
-- ingest-abandoned-no-source effect), sensitive-purge-target-registry-v1
-- (cohort-prepublication-complete and zeroResidualVerification) and
-- policyResolvers.embryo-ingest-session-v1.attemptFailure.

do $$ begin
  -- No published attempt may predate its cleanup plan.
  if exists (select 1 from public.embryo_ingest_sessions s where s.status = 'published'
      and exists (select 1 from public.embryo_ingest_fragments f where f.session_id = s.id)) then
    raise exception using errcode = '55000', message = 'published embryo fragments require explicit review';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Why an unwind exists
-- ---------------------------------------------------------------------------

alter table public.embryo_ingest_unwinds
  add column purpose text not null default 'abandoned' check (purpose in ('abandoned', 'published')),
  add constraint embryo_ingest_unwinds_published_shape
    check (purpose = 'abandoned' or (matrix_fingerprint is null and recipients is null));

-- 20260929101000's state order, plus identity: the purpose, revision and
-- deadline never change, and the live references change only by being
-- cleared as the unwind completes.
create or replace function private.guard_embryo_ingest_unwind_state_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.id, new.purpose, new.ingest_revision, new.fixed_ingest_deadline)
      is distinct from (old.id, old.purpose, old.ingest_revision, old.fixed_ingest_deadline)
    or (new.state <> 'complete' and (new.cohort_id, new.session_id, new.draft_id, new.matrix_fingerprint, new.recipients)
      is distinct from (old.cohort_id, old.session_id, old.draft_id, old.matrix_fingerprint, old.recipients)) then
    raise exception using errcode='55000', message='embryo_unwind_identity';
  end if;
  if new.state is distinct from old.state then
    if (old.state,new.state) not in (('planned','storage_pending'),('storage_pending','storage_confirmed'),
        ('storage_confirmed','complete')) then
      raise exception using errcode='55000',message='embryo_unwind_state_order';
    end if;
    if new.state='storage_confirmed' and (new.storage_confirmed_at is null
        or private.embryo_ingest_unwind_unresolved_count_v1(new.id)<>0) then
      raise exception using errcode='55000',message='embryo_unwind_storage_unresolved';
    end if;
  end if;
  if (old.storage_confirmed_at is not null and new.storage_confirmed_at is distinct from old.storage_confirmed_at)
    or (new.storage_confirmed_at is not null and new.state not in ('storage_confirmed','complete')) then
    raise exception using errcode='55000',message='embryo_unwind_state_order';
  end if;
  return new;
end $$;

-- 20260929101000's inventory guard, plus inserts: an inventory row is written
-- only while its unwind is being planned, and only as `pending`. A disposed
-- state can never be inserted around the disposal proof.
create or replace function private.guard_embryo_ingest_inventory_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.state<>'pending' or new.acknowledged_at is not null or not exists(
        select 1 from public.embryo_ingest_unwinds where id=new.unwind_id and state='planned') then
      raise exception using errcode='55000',message='embryo_unwind_inventory_closed';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if not exists(select 1 from public.embryo_ingest_unwinds where id=old.unwind_id
        and state in ('storage_confirmed','complete')) then
      raise exception using errcode='55000',message='embryo_unwind_inventory_retained';
    end if;
    return old;
  end if;
  if new.state is distinct from old.state or new.acknowledged_at is distinct from old.acknowledged_at then
    if old.state<>'pending' or new.state not in ('deleted','tombstoned') or not exists(
        select 1 from private.embryo_ingest_object_disposals d where d.unwind_id=new.unwind_id
          and d.ordinal=new.ordinal and d.state='disposed'
          and d.backend=case new.state when 'tombstoned' then 'r2' else 'supabase' end
          and (d.bucket_id,d.object_name)=(new.bucket_id,new.object_name)) then
      raise exception using errcode='55000',message='embryo_unwind_disposal_unproved';
    end if;
  end if;
  return new;
end $$;
drop trigger embryo_ingest_inventory_disposal on public.embryo_ingest_delete_objects;
create trigger embryo_ingest_inventory_disposal before insert or update or delete on public.embryo_ingest_delete_objects
  for each row execute function private.guard_embryo_ingest_inventory_v1();

-- ---------------------------------------------------------------------------
-- 2. Zero-residual verification
-- ---------------------------------------------------------------------------

-- Counts, per store, the rows that still name any of `p_ids` in a uuid or
-- uuid[] column, plus Storage metadata rows at any of `p_objects`
-- (`bucket/name`). It covers every `public.purge_target_stores` entry and
-- every other table in `public` and `private`. What it may skip is a closed
-- list, each with the register's reason:
--   * targets `legal-audit-chain-retention` and
--     `audit-principal-link-key-envelope`: the pseudonymized audit that the
--     ingest-abandoned-no-source effect retains;
--   * `private.invitation_terminal_notices.invitation_id`: an independently
--     authorized terminal notice, excluded until its own class is due
--     (mail-token-and-rights-delivery-state joinRule);
--   * `public.retention_rows` and `public.retention_due_phases`: the exact
--     retention control tuple, terminalized and never deleted
--     (zeroResidualVerification).
-- A registered store that does not resolve counts as unverifiable.
create function private.embryo_ingest_attempt_residue_v1(p_ids uuid[], p_objects text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  r record; col record; n bigint; v_total bigint;
  v_registered jsonb := '{}'::jsonb; v_unregistered jsonb := '{}'::jsonb; v_unverifiable integer := 0;
  v_retained_targets constant text[] := array['legal-audit-chain-retention','audit-principal-link-key-envelope'];
  v_control constant text[] := array['public.retention_rows','public.retention_due_phases'];
begin
  if p_ids is null or cardinality(p_ids) = 0 or array_position(p_ids, null) is not null then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  for r in
    select 'registered' kind, s.store_name, to_regclass(s.store_name) rel, s.target_id
      from public.purge_target_stores s
      where not (s.target_id = any (v_retained_targets))
    union all
    select 'unregistered', n2.nspname||'.'||c.relname, c.oid::regclass, null
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
      where n2.nspname in ('public','private') and c.relkind in ('r','p') and not c.relispartition
        and not exists (select 1 from public.purge_target_stores s where to_regclass(s.store_name) = c.oid)
        and not (n2.nspname||'.'||c.relname = any (v_control))
    order by 1, 2
  loop
    if r.rel is null then
      v_unverifiable := v_unverifiable + 1;
      continue;
    end if;
    v_total := 0;
    for col in select a.attname, a.atttypid from pg_attribute a
        where a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
          and a.atttypid in ('uuid'::regtype, 'uuid[]'::regtype)
        order by a.attnum
    loop
      if (r.store_name, col.attname::text) = ('private.invitation_terminal_notices', 'invitation_id') then
        continue;
      end if;
      execute format(case when col.atttypid = 'uuid'::regtype
          then 'select count(*) from %s where %I = any ($1)'
          else 'select count(*) from %s where %I && $1' end, r.rel, col.attname)
        into n using p_ids;
      v_total := v_total + n;
    end loop;
    if r.store_name = 'storage.objects' then
      select count(*) into n from storage.objects so
        where so.bucket_id||'/'||so.name = any (coalesce(p_objects, '{}'::text[]));
      v_total := v_total + n;
    end if;
    if v_total > 0 then
      if r.kind = 'registered' then
        v_registered := v_registered || jsonb_build_object(r.store_name, v_total);
      else
        v_unregistered := v_unregistered || jsonb_build_object(r.store_name, v_total);
      end if;
    end if;
  end loop;
  return jsonb_build_object('registered', v_registered, 'unregistered', v_unregistered,
    'unverifiable', v_unverifiable);
end $$;

create function private.embryo_ingest_residue_clear_v1(p_residue jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_residue->'registered' = '{}'::jsonb and p_residue->'unregistered' = '{}'::jsonb
    and p_residue->'unverifiable' = '0'::jsonb, false);
$$;

-- ---------------------------------------------------------------------------
-- 3. The terminal purge of an abandoned attempt
-- ---------------------------------------------------------------------------

-- Lock order: the invitation transition lock (the basis-binding delete takes
-- it too), then cohort, session and unwind as the planner and the claim take
-- them, then the frozen matrix, then the due tuple.
create function private.purge_embryo_ingest_attempt_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  u public.embryo_ingest_unwinds%rowtype;
  c public.embryo_cohorts%rowtype;
  d public.embryo_cohort_drafts%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  v_now timestamptz;
  v_matrix text;
  v_retention uuid;
  v_ids uuid[];
  v_objects text[];
  v_subjects uuid[];
  v_embryos uuid[];
  v_principals uuid[];
  v_invitations uuid[];
  v_outbox uuid[];
  v_deleted uuid[];
  v_notices integer;
  v_unavailable integer;
  v_object_count integer;
  v_count integer;
  v_residue jsonb;
begin
  perform private.lock_invitation_transitions_v1();
  select * into u from public.embryo_ingest_unwinds where id = p_unwind_id;
  if not found or u.purpose <> 'abandoned' then
    raise exception using errcode='42501', message='embryo_unwind_unavailable';
  end if;
  if u.state = 'complete' then
    return jsonb_build_object('status','complete','completedAt',u.completed_at);
  end if;
  if u.state <> 'storage_confirmed' then
    return jsonb_build_object('status',u.state);
  end if;

  select * into c from public.embryo_cohorts where id = u.cohort_id for update;
  if not found then raise exception using errcode='55000', message='embryo_unwind_graph_unavailable'; end if;
  select * into s from public.embryo_ingest_sessions where id = u.session_id for update;
  if not found then raise exception using errcode='55000', message='embryo_unwind_graph_unavailable'; end if;
  select * into u from public.embryo_ingest_unwinds where id = p_unwind_id for update;
  if u.state <> 'storage_confirmed' then return jsonb_build_object('status',u.state); end if;
  if s.cohort_id <> c.id or s.ingest_revision <> u.ingest_revision
    or c.ingest_revision is distinct from u.ingest_revision or c.draft_id is distinct from u.draft_id
    or s.status <> 'failure_pending' or c.publication_revision is not null
    or s.expires_at <> u.fixed_ingest_deadline then
    raise exception using errcode='55000', message='embryo_unwind_graph_unavailable';
  end if;
  -- The frozen authority is still exactly the one the plan was made from.
  v_matrix := private.assert_embryo_unwind_matrix_v1(c.id);
  if v_matrix is distinct from u.matrix_fingerprint then
    raise exception using errcode='55000', message='unwind matrix changed';
  end if;
  select * into strict d from public.embryo_cohort_drafts where id = c.draft_id;
  v_subjects := array(select id from public.subjects where cohort_id = c.id order by id);
  v_embryos := array(select id from public.embryos where cohort_id = c.id order by id);
  perform private.assert_embryo_unwind_plannable_stores_v1(array[c.id, d.id, s.id] || v_subjects || v_embryos);
  if private.embryo_ingest_unwind_unresolved_count_v1(u.id) <> 0 then
    raise exception using errcode='55000', message='embryo_unwind_storage_unresolved';
  end if;

  -- The exact due tuple the plan was made under, still open.
  select r.id into v_retention from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
    where r.target_id=s.id and r.retention_id='embryo.ingest-session-24h'
      and r.target_kind='ingest_session' and r.state in ('scheduled','active')
      and r.fixed_deadline=s.expires_at and r.retention_revision=s.ingest_revision
      and p.phase_id='ingest-abandoned-no-source' and p.phase_revision=s.ingest_revision
      and p.retention_id=r.retention_id and p.phase_kind='ingest-abandoned-no-source'
      and p.target_kind=r.target_kind and p.target_id=r.target_id
      and r.target_lifecycle_revision=s.cohort_lifecycle_revision
      and p.target_lifecycle_revision=r.target_lifecycle_revision
      and r.disposition_revision=1 and p.disposition_revision=1
      and p.recipient_authority_kind='record-key-recipients'
      and p.recipient_authority_revision=c.recipient_set_revision
      and p.phase_deadline=s.expires_at and p.status in ('pending','retry','claimed')
      and p.immutable_envelope=jsonb_build_object('cohortId',c.id,'ingestRevision',s.ingest_revision)
    for update of r,p;
  if not found then raise exception using errcode='55000', message='unwind due authority unavailable'; end if;

  -- The frozen recipients are exactly the current Record Key recipient set.
  if jsonb_typeof(u.recipients) is distinct from 'array' or jsonb_array_length(u.recipients) = 0
    or (select count(distinct x->>'recipientPseudonym') from jsonb_array_elements(u.recipients) x
        where x->>'recipientPseudonym' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      <> jsonb_array_length(u.recipients)
    or (select jsonb_agg(jsonb_build_object('principalId',p.principal_id,'membershipRevision',p.membership_revision,
          'setRevision',p.set_revision) order by p.principal_id::text)
        from public.embryo_participant_sets p where p.cohort_id=c.id and p.set_kind='record_key_recipients')
      is distinct from (select jsonb_agg(x - 'recipientPseudonym' order by x->>'principalId')
        from jsonb_array_elements(u.recipients) x) then
    raise exception using errcode='55000', message='unwind recipients changed';
  end if;

  -- Cohort-only principals: this draft's parent and donor slots, never the
  -- uploader's shared account principal.
  v_principals := array(select distinct sp.id from public.subject_principals sp
    where sp.principal_kind in ('genetic_parent','identified_donor') and sp.id <> d.uploader_principal_id
      and (sp.id in (select principal_id from public.draft_participant_slots where embryo_draft_id=d.id)
        or sp.id in (select principal_id from public.embryo_draft_participants where draft_id=d.id)
        or sp.id in (select principal_id from public.embryo_participant_sets where cohort_id=c.id))
    order by sp.id);
  if exists (select 1 from jsonb_array_elements(u.recipients) x
      where not ((x->>'principalId')::uuid = any (v_principals))) then
    raise exception using errcode='55000', message='unwind recipients changed';
  end if;
  v_ids := array[c.id, d.id, s.id] || v_subjects || v_embryos || v_principals;
  v_now := clock_timestamp();

  -- One terminal notice slot per frozen recipient, before anything is deleted.
  -- Only a single current contact is copied; none, a shredded one or an
  -- ambiguous pair gives a coded delivery-unavailable slot. No rotated
  -- contact is revived and nothing is decrypted here.
  insert into public.embryo_terminal_mail (unwind_id, recipient_pseudonym, recipient_ciphertext,
    cleanup_confirmed_at, expires_at, state)
  select u.id, (x->>'recipientPseudonym')::uuid, k.contact_ciphertext, v_now, v_now + interval '24 hours',
    case when k.contact_ciphertext is null then 'delivery_unavailable' else 'queued' end
  from jsonb_array_elements(u.recipients) x
  left join lateral (
    select e.contact_ciphertext from public.encrypted_contact_references e
      where e.principal_id = (x->>'principalId')::uuid and e.status = 'current' and e.contact_ciphertext is not null
        and (select count(*) from public.encrypted_contact_references e2
          where e2.principal_id = e.principal_id and e2.status = 'current') = 1
  ) k on true;
  get diagnostics v_notices = row_count;
  if v_notices <> jsonb_array_length(u.recipients) then
    raise exception using errcode='55000', message='terminal notice unavailable';
  end if;
  select count(*) into v_unavailable from public.embryo_terminal_mail
    where unwind_id = u.id and state = 'delivery_unavailable';

  -- Attempt-owned pending rows, disposal records, then the inventory.
  delete from private.embryo_split_variants where session_id = s.id;
  delete from private.embryo_split_ordinals where session_id = s.id;
  v_objects := array(select bucket_id||'/'||object_name from public.embryo_ingest_delete_objects where unwind_id = u.id);
  v_ids := v_ids || array(select source_id from public.embryo_ingest_delete_objects where unwind_id = u.id)
    || array(select i.storage_object_id from private.embryo_ingest_write_intents i
      where i.session_id = s.id and i.storage_object_id is not null);
  delete from private.embryo_ingest_object_disposals where unwind_id = u.id;
  delete from public.embryo_ingest_delete_objects where unwind_id = u.id;
  get diagnostics v_object_count = row_count;

  -- The session and everything it cascades to (chunks, fragments, write
  -- intents, handle maps, mapping challenges, the write fence). The manifest
  -- freeze forbids clearing `worker_job_id`, so the reference goes with the
  -- row, and only then the attempt's own split job.
  delete from public.embryo_ingest_sessions where id = s.id;
  if s.worker_job_id is not null then
    delete from public.worker_jobs where id = s.worker_job_id and kind = 'split_cohort_vcf'
      and output_kind = 'ingest.normalize' and source_binding_kind = 'embryo-ingest-fragment-set'
      and source_binding_id = s.id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception using errcode='55000', message='embryo_unwind_graph_unavailable'; end if;
    v_ids := v_ids || s.worker_job_id;
  end if;

  -- Every Record Key hash, print right and recipient membership.
  delete from public.future_person_record_key_print_rights where embryo_id = any (v_embryos);
  delete from public.future_person_record_key_hashes where embryo_id = any (v_embryos);
  delete from public.future_person_record_key_recipients where cohort_id = c.id;

  -- Invitations, rights sessions and mail authority. Rights sessions hold the
  -- token hashes that the outbox rows cascade to, so they go first.
  v_invitations := array(select id from public.subject_invitations
    where (target_kind = 'cohort_draft' and target_id = d.id) or invitee_principal_id = any (v_principals));
  v_outbox := array(select m.id from public.mail_outbox m
    where m.recipient_principal_id = any (v_principals) or m.target_id = any (v_ids || v_invitations)
      or m.contact_reference_id in (select e.id from public.encrypted_contact_references e
        where e.principal_id = any (v_principals)));
  with gone as (delete from public.rights_sessions r
      where (r.target_kind = 'cohort_draft' and r.target_id = d.id) or r.principal_id = any (v_principals)
        or r.token_hash_id in (select th.id from public.token_hashes th join public.token_candidates tc
          on tc.id = th.candidate_id where tc.outbox_id = any (v_outbox))
      returning r.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
  delete from public.invitation_reminders where invitation_id = any (v_invitations) or outbox_id = any (v_outbox);
  delete from public.mail_deliveries where outbox_id = any (v_outbox);
  delete from public.mail_outbox where id = any (v_outbox);
  delete from public.subject_invitations where id = any (v_invitations);
  v_ids := v_ids || v_invitations || v_outbox;

  -- Signatures, attestations and the authority built on them.
  with gone as (delete from public.attestation_contradictions x
      where x.cohort_id = c.id or x.subject_id = any (v_subjects) or x.attestation_id in (
        select a.id from public.attestations a where (a.target_kind = 'cohort_draft' and a.target_id = d.id)
          or a.principal_id = any (v_principals))
      returning x.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
  with gone as (delete from public.attestations a
      where (a.target_kind = 'cohort_draft' and a.target_id = d.id) or a.principal_id = any (v_principals)
      returning a.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
  delete from public.embryo_basis_bindings where cohort_id = c.id;
  delete from public.embryo_donor_attributions where cohort_id = c.id;
  with gone as (delete from public.consent_signatures cs
      where (cs.target_kind = 'cohort_draft' and cs.target_id = d.id) or cs.signer_principal_id = any (v_principals)
      returning cs.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
  delete from public.embryo_participant_sets where cohort_id = c.id;

  -- The reservation: pending embryos, then their quarantined subjects.
  delete from public.embryos where cohort_id = c.id;
  delete from public.subjects where cohort_id = c.id;

  -- Contacts (their HMAC indexes cascade), the cohort, the draft (its slots,
  -- participants and invitation candidates cascade) and the principals.
  with gone as (delete from public.encrypted_contact_references e where e.principal_id = any (v_principals)
      returning e.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
  delete from public.embryo_cohorts where id = c.id;
  delete from public.embryo_cohort_drafts where id = d.id;
  delete from public.subject_principals where id = any (v_principals);

  -- Consumed operation nonces bound to anything deleted here: the draft,
  -- cohort, embryos, session and rights sessions.
  delete from public.embryo_operation_nonces where target_id = any (v_ids);

  -- Terminalize, never delete, the exact retention control tuple.
  update public.retention_due_phases
    set status = 'succeeded', terminal_outcome_code = 'ingest_abandoned_no_source', completed_at = v_now,
      claim_token_hash = null, claim_expires_at = null
    where retention_row_id = v_retention and phase_id = 'ingest-abandoned-no-source'
      and phase_revision = u.ingest_revision;
  update public.retention_rows set state = 'complete', ended_at = v_now where id = v_retention;

  update public.embryo_ingest_unwinds
    set state = 'complete', completed_at = v_now, cohort_id = null, session_id = null, draft_id = null,
      matrix_fingerprint = null, recipients = null
    where id = u.id;

  -- Prove absence before anything commits.
  v_residue := private.embryo_ingest_attempt_residue_v1(v_ids, v_objects);
  if not private.embryo_ingest_residue_clear_v1(v_residue) then
    raise exception using errcode='55000', message='embryo_unwind_residue', detail=v_residue::text;
  end if;

  perform private.append_legal_audit_event(
    'embryo.ingest.abandoned-no-source', null, null, 'accepted',
    jsonb_build_object('notices', v_notices, 'delivery_unavailable', v_unavailable,
      'objects', v_object_count));

  return jsonb_build_object('status','complete','completedAt',v_now,'notices',v_notices,
    'deliveryUnavailable',v_unavailable,'objects',v_object_count);
end $$;

-- ---------------------------------------------------------------------------
-- 4. After publication: the fragment objects and their rows
-- ---------------------------------------------------------------------------

-- In the publication transaction: one cleanup plan with an exact inventory
-- of every fragment object, where its write intent says it lives. It never
-- lists a published source.
create function private.plan_embryo_published_cleanup_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.embryo_cohorts%rowtype; u public.embryo_ingest_unwinds%rowtype;
begin
  select * into c from public.embryo_cohorts where id = new.cohort_id;
  if not found or c.publication_revision is null or c.ingest_revision is distinct from new.ingest_revision then
    raise exception using errcode='55000', message='embryo_publication_cleanup_unavailable';
  end if;
  insert into public.embryo_ingest_unwinds (cohort_id, session_id, draft_id, ingest_revision,
    fixed_ingest_deadline, purpose)
  values (c.id, new.id, c.draft_id, new.ingest_revision, new.expires_at, 'published')
  returning * into u;
  insert into public.embryo_ingest_delete_objects (unwind_id, ordinal, bucket_id, object_name, source_kind, source_id)
    select u.id, row_number() over (order by x.bucket_id, x.object_name), x.bucket_id, x.object_name,
      'ingest-fragment', x.object_id
    from (select coalesce(i.provider_bucket, f.bucket_id) bucket_id, coalesce(i.provider_key, f.object_name) object_name,
        f.object_id
      from public.embryo_ingest_fragments f left join private.embryo_ingest_write_intents i
        on i.session_id = f.session_id and i.sequence = f.sequence and i.sample_ordinal = f.sample_ordinal
      where f.session_id = new.id) x;
  update public.embryo_ingest_unwinds set state = 'storage_pending' where id = u.id;
  return null;
end $$;
create trigger embryo_ingest_published_cleanup after update of status on public.embryo_ingest_sessions
  for each row when (new.status = 'published' and old.status is distinct from 'published')
  execute function private.plan_embryo_published_cleanup_v1();

-- Once every fragment object is proved disposed: delete the fragment rows
-- (their write intents cascade), the handle map, the disposal records and
-- the inventory. The session, chunks, fence and every published row stay.
create function private.finish_embryo_published_cleanup_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare u public.embryo_ingest_unwinds%rowtype; s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype; v_now timestamptz; v_objects integer; v_fragments integer; v_maps integer;
begin
  select * into u from public.embryo_ingest_unwinds where id = p_unwind_id;
  if not found or u.purpose <> 'published' then
    raise exception using errcode='42501', message='embryo_unwind_unavailable';
  end if;
  if u.state = 'complete' then
    return jsonb_build_object('status','complete','completedAt',u.completed_at);
  end if;
  if u.state <> 'storage_confirmed' then
    return jsonb_build_object('status',u.state);
  end if;
  select * into s from public.embryo_ingest_sessions where id = u.session_id for update;
  select * into u from public.embryo_ingest_unwinds where id = p_unwind_id for update;
  if u.state <> 'storage_confirmed' then return jsonb_build_object('status',u.state); end if;
  select * into c from public.embryo_cohorts where id = u.cohort_id for share;
  if s.id is null or c.id is null or s.status <> 'published' or s.cohort_id <> c.id
    or s.ingest_revision <> u.ingest_revision or c.publication_revision is null then
    raise exception using errcode='55000', message='embryo_publication_cleanup_unavailable';
  end if;
  if private.embryo_ingest_unwind_unresolved_count_v1(u.id) <> 0 then
    raise exception using errcode='55000', message='embryo_unwind_storage_unresolved';
  end if;
  v_now := clock_timestamp();
  delete from private.embryo_ingest_object_disposals where unwind_id = u.id;
  delete from public.embryo_ingest_delete_objects where unwind_id = u.id;
  get diagnostics v_objects = row_count;
  delete from public.embryo_ingest_fragments where session_id = s.id;
  get diagnostics v_fragments = row_count;
  delete from public.embryo_fragment_handle_maps where session_id = s.id;
  get diagnostics v_maps = row_count;
  update public.embryo_ingest_unwinds
    set state = 'complete', completed_at = v_now, cohort_id = null, session_id = null, draft_id = null
    where id = u.id;
  if exists (select 1 from public.embryo_ingest_fragments where session_id = s.id)
    or exists (select 1 from private.embryo_ingest_write_intents where session_id = s.id)
    or exists (select 1 from public.embryo_fragment_handle_maps where session_id = s.id)
    or exists (select 1 from public.embryo_ingest_delete_objects where unwind_id = u.id)
    or exists (select 1 from private.embryo_ingest_object_disposals where unwind_id = u.id) then
    raise exception using errcode='55000', message='embryo_publication_cleanup_residue';
  end if;
  perform private.append_legal_audit_event(
    'embryo.ingest.fragments-removed', null, null, 'accepted',
    jsonb_build_object('objects', v_objects, 'fragments', v_fragments, 'handles', v_maps));
  return jsonb_build_object('status','complete','completedAt',v_now,'objects',v_objects,
    'fragments',v_fragments,'handles',v_maps);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Doors
-- ---------------------------------------------------------------------------

-- The one completion step after storage_confirmed, whichever the purpose.
create function private.complete_embryo_ingest_unwind_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_purpose text;
begin
  select purpose into v_purpose from public.embryo_ingest_unwinds where id = p_unwind_id;
  if not found then raise exception using errcode='42501', message='embryo_unwind_unavailable'; end if;
  if v_purpose = 'published' then
    return private.finish_embryo_published_cleanup_v1(p_unwind_id);
  end if;
  return private.purge_embryo_ingest_attempt_v1(p_unwind_id);
end $$;

-- What the executor still has to drive: unwinds waiting on storage or on
-- completion, oldest deadline first. Identifiers and states only.
create function private.embryo_ingest_unwind_work_v1(p_limit integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('unwindId',x.id,'purpose',x.purpose,'state',x.state)
    order by x.fixed_ingest_deadline, x.id), '[]'::jsonb)
  from (select id, purpose, state, fixed_ingest_deadline from public.embryo_ingest_unwinds
    where state in ('storage_pending','storage_confirmed')
    order by fixed_ingest_deadline, id
    limit least(greatest(coalesce(p_limit, 25), 1), 100)) x;
$$;

create function public.complete_embryo_ingest_unwind_v1(p_unwind_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.complete_embryo_ingest_unwind_v1(p_unwind_id);
$$;
create function public.embryo_ingest_unwind_work_v1(p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.embryo_ingest_unwind_work_v1(p_limit);
$$;

revoke all on function private.complete_embryo_ingest_unwind_v1(uuid),
  private.embryo_ingest_unwind_work_v1(integer),
  public.complete_embryo_ingest_unwind_v1(uuid),
  public.embryo_ingest_unwind_work_v1(integer)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function private.complete_embryo_ingest_unwind_v1(uuid),
  private.embryo_ingest_unwind_work_v1(integer),
  public.complete_embryo_ingest_unwind_v1(uuid),
  public.embryo_ingest_unwind_work_v1(integer)
  to service_role;
revoke all on function private.embryo_ingest_attempt_residue_v1(uuid[], text[]),
  private.embryo_ingest_residue_clear_v1(jsonb),
  private.purge_embryo_ingest_attempt_v1(uuid),
  private.plan_embryo_published_cleanup_v1(),
  private.finish_embryo_published_cleanup_v1(uuid),
  private.guard_embryo_ingest_unwind_state_v1(),
  private.guard_embryo_ingest_inventory_v1()
  from public, anon, authenticated, inherit_upload_only, service_role;

notify pgrst, 'reload schema';
