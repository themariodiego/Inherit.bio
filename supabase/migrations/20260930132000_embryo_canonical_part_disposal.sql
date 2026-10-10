-- ADR 0020 safeguards, unit 4: the disposal and deletion of embryo canonical
-- parts and sources (20260930123000). TEST-LOCAL only; no route, scheduler or
-- deployment, and EMBRYO_INGEST_AVAILABLE stays false.
--
-- A canonical part is an R2 object under `embryo/<uuid>`, reserved and landed
-- exactly like a fragment. It is disposed of the same way: a verified empty
-- marker at the exact key, through the same claim, finish and confirm doors
-- (20260929101000), with the same exact evidence.
--   * An abandoned attempt's unwind inventories every part of its session,
--     landed or not. Such an attempt never has a canonical source; planning
--     and the terminal purge both refuse one. The purge deletes the part rows
--     with the rest of the attempt graph.
--   * A published attempt's cleanup inventories only the parts no canonical
--     source binds: those of earlier or failed attempts. The part rows go after
--     `storage_confirmed`. A bound part is never claimed, by any unwind.
--   * `private.plan_embryo_source_deletion_v1` is the internal planner for the
--     retention deadline and restriction or withdrawal slices. In one
--     transaction it deletes the membership, then the source, then the
--     genotypes, then the `genome_files` row, and inventories the parts under
--     a `purpose = 'source'` unwind. The part rows go only after their
--     disposal is confirmed. No caller is wired to it yet, and
--     `public.restrict_embryo_cohort_v1` is unchanged.
-- A part whose write window is still open is not claimed: after the window
-- no acknowledgement can land it, and a late create-only write fails once
-- the marker exists.

alter table public.embryo_ingest_delete_objects
  drop constraint embryo_ingest_delete_objects_source_kind_check,
  add constraint embryo_ingest_delete_objects_source_kind_check check (source_kind in (
    'ingest-fragment','canonical-part','canonical-source','legacy-source','upload-staging','legal-evidence'));
alter table public.embryo_ingest_unwinds
  drop constraint embryo_ingest_unwinds_purpose_check,
  add constraint embryo_ingest_unwinds_purpose_check check (purpose in ('abandoned','published','source'));

-- ---------------------------------------------------------------------------
-- 1. What stands between an unwind and storage_confirmed, with parts
-- ---------------------------------------------------------------------------

-- 20260929101000's counts, plus canonical parts:
--   * a part row is disposable like an R2 fragment, landed or not;
--   * a part a canonical source binds is never disposable (`unsupported`);
--   * `uninventoried` counts, for an abandoned attempt, every part of its
--     session outside its inventory and, for a published cleanup, every part
--     no source binds and no inventory lists. A source deletion lists exactly
--     the parts it unbound, so it has nothing else to find. Fragments count
--     only for the two attempt purposes.
create or replace function private.embryo_ingest_unwind_unresolved_v1(p_unwind_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with u as (select * from public.embryo_ingest_unwinds where id=p_unwind_id),
  rows as (
    select o.*, d.state disposal_state, d.backend disposal_backend,
      case o.source_kind when 'canonical-part' then 'r2' else i.backend end intent_backend,
      case o.source_kind when 'canonical-part' then case p.state when 'landed' then 'landed' else 'uncertain' end
        else i.state end intent_state,
      (o.source_kind='canonical-part' and exists(select 1 from private.embryo_canonical_source_parts m
        where m.part_id=o.source_id)) bound
      from public.embryo_ingest_delete_objects o
      left join private.embryo_ingest_object_disposals d on d.unwind_id=o.unwind_id and d.ordinal=o.ordinal
      left join public.embryo_ingest_fragments f on o.source_kind='ingest-fragment'
        and f.session_id=(select session_id from u) and f.object_id=o.source_id
      left join private.embryo_ingest_write_intents i on i.session_id=f.session_id
        and i.sequence=f.sequence and i.sample_ordinal=f.sample_ordinal
      left join private.embryo_canonical_parts p on o.source_kind='canonical-part' and p.id=o.source_id
      where o.unwind_id=p_unwind_id)
  select jsonb_build_object(
    'disposed',(select count(*) from rows where state in ('deleted','tombstoned') and disposal_state='disposed'
      and disposal_backend=case state when 'tombstoned' then 'r2' else 'supabase' end),
    -- Null-safe: a row whose intent or part cannot be joined stays pending.
    'pending',(select count(*) from rows where state='pending' and source_kind in ('ingest-fragment','canonical-part')
      and not bound and not coalesce(intent_backend='supabase' and intent_state='uncertain',false)),
    'supabaseUncertain',(select count(*) from rows where state='pending' and source_kind='ingest-fragment'
      and coalesce(intent_backend='supabase' and intent_state='uncertain',false)),
    'unsupported',(select count(*) from rows where state='pending'
      and (source_kind not in ('ingest-fragment','canonical-part') or bound)),
    'unproved',(select count(*) from rows where state='missing' or (state in ('deleted','tombstoned')
      and (disposal_state is distinct from 'disposed'
        or disposal_backend is distinct from case state when 'tombstoned' then 'r2' else 'supabase' end))),
    'uninventoried',(select count(*) from public.embryo_ingest_fragments f, u where f.session_id=u.session_id
        and u.purpose in ('abandoned','published')
        and not exists(select 1 from rows r where r.source_kind='ingest-fragment' and r.source_id=f.object_id))
      +(select count(*) from private.embryo_canonical_parts p, u where p.session_id=u.session_id
        and ((u.purpose='abandoned'
            and not exists(select 1 from rows r where r.source_kind='canonical-part' and r.source_id=p.id))
          or (u.purpose='published'
            and not exists(select 1 from private.embryo_canonical_source_parts m where m.part_id=p.id)
            and not exists(select 1 from public.embryo_ingest_delete_objects o
              where o.source_kind='canonical-part' and o.source_id=p.id)))),
    'unsettled',(select count(*) from u where u.session_id is not null and not exists(
      select 1 from private.embryo_ingest_write_fences w where w.session_id=u.session_id and w.settled_at is not null)));
$$;

-- ---------------------------------------------------------------------------
-- 2. Claim: fragments as before, and parts on the R2 marker path
-- ---------------------------------------------------------------------------

-- 20260929101000's claim with one more candidate kind. A part is claimed for
-- an empty marker when it landed, or once its write window has closed; it is
-- never claimed while a canonical source binds it.
create or replace function private.claim_embryo_ingest_object_disposals_v1(p_unwind_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.embryo_ingest_unwinds%rowtype; v_settle jsonb; r record;
  d private.embryo_ingest_object_disposals%rowtype; v_exists boolean; v_now timestamptz;
  v_objects jsonb:='[]'::jsonb;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  select * into u from public.embryo_ingest_unwinds where id=p_unwind_id;
  if not found or u.session_id is null then
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  v_settle:=private.settle_embryo_ingest_writes_v1(u.session_id);
  if v_settle->>'status' is distinct from 'settled' then
    return jsonb_build_object('status',coalesce(v_settle->>'status','denied'))
      ||case when v_settle ? 'fenceAt' then jsonb_build_object('fenceAt',v_settle->'fenceAt') else '{}'::jsonb end;
  end if;
  select * into u from public.embryo_ingest_unwinds where id=p_unwind_id for update;
  if u.state<>'storage_pending' then return jsonb_build_object('status',u.state); end if;
  v_now:=clock_timestamp();
  perform 1 from public.embryo_ingest_delete_objects o where o.unwind_id=u.id and o.state='pending'
    order by o.ordinal for update;
  for r in select o.ordinal,o.bucket_id,o.object_name,x.*
    from public.embryo_ingest_delete_objects o
    join lateral (
      select i.backend,i.state intent_state,i.byte_count,i.sha256,i.storage_object_id,i.storage_version,
          i.provider_version,i.provider_etag,i.session_id,i.sequence,i.sample_ordinal
        from public.embryo_ingest_fragments f
        join private.embryo_ingest_write_intents i on i.session_id=f.session_id and i.sequence=f.sequence
          and i.sample_ordinal=f.sample_ordinal
        where o.source_kind='ingest-fragment' and f.session_id=u.session_id and f.object_id=o.source_id
          and o.bucket_id=i.provider_bucket and o.object_name=i.provider_key
          and i.state in ('landed','uncertain') and (i.backend='r2' or i.state='landed')
      union all
      select 'r2',case p.state when 'landed' then 'landed' else 'uncertain' end,p.byte_count,p.sha256,
          null::uuid,null::text,p.provider_version,p.provider_etag,p.session_id,p.sequence::integer,p.sample_ordinal
        from private.embryo_canonical_parts p
        where o.source_kind='canonical-part' and p.id=o.source_id and p.session_id=u.session_id
          and (o.bucket_id,o.object_name)=(p.provider_bucket,p.provider_key)
          and (p.state='landed' or p.write_expires_at<=v_now)
          and not exists(select 1 from private.embryo_canonical_source_parts m where m.part_id=p.id)
    ) x on true
    where o.unwind_id=u.id and o.state='pending'
    order by o.ordinal
  loop
    exit when jsonb_array_length(v_objects)>=25;
    select * into d from private.embryo_ingest_object_disposals where unwind_id=u.id and ordinal=r.ordinal for update;
    v_exists:=found;
    if v_exists and (d.state='disposed' or d.claim_expires_at>v_now) then continue; end if;
    if r.backend='supabase' then
      -- A missing object remains unresolved: never infer a deletion.
      perform 1 from storage.objects so where so.id=r.storage_object_id and so.bucket_id='genomes'
        and so.name=r.object_name and so.version=r.storage_version
        and so.metadata->'size'=to_jsonb(r.byte_count) for share of so;
      if not found then continue; end if;
    end if;
    if v_exists then
      update private.embryo_ingest_object_disposals set claim_hash=p_claim_token_hash,
        claim_expires_at=v_now+interval '60 seconds'
        where unwind_id=u.id and ordinal=r.ordinal returning * into d;
    else
      insert into private.embryo_ingest_object_disposals(unwind_id,ordinal,backend,bucket_id,object_name,
        session_id,sequence,sample_ordinal,intent_state,byte_count,sha256,storage_object_id,storage_version,
        provider_version,provider_etag,claim_hash,claim_expires_at,first_claimed_at)
      values(u.id,r.ordinal,r.backend,r.bucket_id,r.object_name,r.session_id,r.sequence,r.sample_ordinal,
        r.intent_state,r.byte_count,r.sha256,r.storage_object_id,r.storage_version,r.provider_version,
        r.provider_etag,p_claim_token_hash,v_now+interval '60 seconds',v_now) returning * into d;
    end if;
    v_objects:=v_objects||jsonb_build_array(private.embryo_ingest_disposal_receipt_v1(d));
  end loop;
  if jsonb_array_length(v_objects)=0 then
    return jsonb_build_object('status','idle','unresolved',private.embryo_ingest_unwind_unresolved_v1(u.id));
  end if;
  return jsonb_build_object('status','claimed','unwindId',u.id,'objects',v_objects);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Planning an abandoned attempt: its parts too, and never a source
-- ---------------------------------------------------------------------------

-- 20260929101000's body with two changes: an attempt with a canonical source
-- is refused, and every canonical part of the session is inventoried.
create or replace function public.prepare_embryo_ingest_unwind_v1(p_cohort_id uuid,p_ingest_revision bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
as $$
declare c public.embryo_cohorts%rowtype; s public.embryo_ingest_sessions%rowtype;
  u public.embryo_ingest_unwinds%rowtype; v_matrix text; v_recipients jsonb; v_now timestamptz:=clock_timestamp();
begin
  select * into c from public.embryo_cohorts where id=p_cohort_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if c.publication_revision is not null then return jsonb_build_object('status','published'); end if;
  select * into s from public.embryo_ingest_sessions where cohort_id=c.id and ingest_revision=p_ingest_revision for update;
  if not found or c.ingest_revision is distinct from p_ingest_revision then
    return jsonb_build_object('status','unavailable');
  end if;
  if s.status<>'failure_pending' and s.expires_at>v_now then
    return jsonb_build_object('status','unavailable');
  end if;
  -- No renewal, session removal, due-phase cancellation or partial notice.
  perform private.mark_embryo_ingest_failure_v1(s.id,coalesce(s.failure_code,'expiry'));
  -- An unpublished attempt never has a canonical source.
  if exists(select 1 from private.embryo_canonical_sources x where x.cohort_id=c.id or x.session_id=s.id) then
    raise exception using errcode='55000',message='embryo_unwind_graph_unavailable';
  end if;
  v_matrix:=private.assert_embryo_unwind_matrix_v1(c.id);
  perform private.assert_embryo_unwind_plannable_stores_v1(array[c.id,c.draft_id,s.id]
    ||array(select id from public.subjects where cohort_id=c.id)
    ||array(select id from public.embryos where cohort_id=c.id));
  perform 1 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
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
  if not found then raise exception using errcode='55000',message='unwind due authority unavailable'; end if;
  select * into u from public.embryo_ingest_unwinds where cohort_id=c.id and ingest_revision=s.ingest_revision for update;
  if found then
    if u.matrix_fingerprint is distinct from v_matrix then
      raise exception using errcode='55000',message='unwind matrix changed';
    end if;
    return jsonb_build_object('status',u.state,'unwindId',u.id);
  end if;

  -- Preserve only identity/revision references until the atomic terminal
  -- transaction. Do not copy a contact early or restart its retention clock.
  perform 1 from public.subject_principals sp join public.embryo_participant_sets p on p.principal_id=sp.id
    where p.cohort_id=c.id and p.set_kind='record_key_recipients' order by sp.id for update of sp;
  select jsonb_agg(jsonb_build_object('principalId',p.principal_id,'membershipRevision',p.membership_revision,
      'setRevision',p.set_revision,'recipientPseudonym',gen_random_uuid()) order by p.principal_id)
    into v_recipients from public.embryo_participant_sets p
    where p.cohort_id=c.id and p.set_kind='record_key_recipients';
  insert into public.embryo_ingest_unwinds(cohort_id,session_id,draft_id,ingest_revision,
    fixed_ingest_deadline,matrix_fingerprint,recipients)
    values(c.id,s.id,c.draft_id,s.ingest_revision,s.expires_at,v_matrix,v_recipients) returning * into u;
  perform 1 from public.embryo_ingest_fragments where session_id=s.id order by sequence,sample_ordinal for update;
  perform 1 from private.embryo_canonical_parts where session_id=s.id order by id for share;
  perform 1 from public.genome_storage_objects where cohort_id=c.id order by object_id for update;

  -- Evidence fragments and pending-source rows currently lack an exact
  -- physical version/path binding. Do not silently skip these stores.
  if exists(select 1 from public.pending_source_rows where cohort_id=c.id)
    or exists(select 1 from public.legal_evidence_ingest_sessions where target_id=c.draft_id)
    or exists(select 1 from public.reviewed_evidence re join public.embryo_basis_bindings b
      on b.reviewed_evidence_id=re.id where b.cohort_id=c.id and re.storage_object_id is not null) then
    raise exception using errcode='55000',message='unbound unwind storage unavailable';
  end if;
  if exists(select 1 from public.embryo_ingest_fragments f join public.genome_storage_objects g on g.object_id=f.object_id
    where f.session_id=s.id and (f.bucket_id,f.object_name) is distinct from (g.bucket_id,g.object_name)) then
    raise exception using errcode='55000',message='contradictory unwind object binding';
  end if;
  insert into public.embryo_ingest_delete_objects(unwind_id,ordinal,bucket_id,object_name,source_kind,source_id)
    select u.id,row_number() over(order by bucket_id,object_name),bucket_id,object_name,source_kind,source_id from (
      select coalesce(i.provider_bucket,f.bucket_id) bucket_id,coalesce(i.provider_key,f.object_name) object_name,
        'ingest-fragment'::text source_kind,f.object_id source_id
        from public.embryo_ingest_fragments f left join private.embryo_ingest_write_intents i
          on i.session_id=f.session_id and i.sequence=f.sequence and i.sample_ordinal=f.sample_ordinal
        where f.session_id=s.id
      union all
      select p.provider_bucket,p.provider_key,'canonical-part',p.id from private.embryo_canonical_parts p
        where p.session_id=s.id
      union all
      select g.bucket_id,g.object_name,'canonical-source',g.object_id from public.genome_storage_objects g
        where (g.cohort_id=c.id or g.genome_file_id in(select f.id from public.genome_files f
          join public.subjects subject on subject.id=f.subject_id where subject.cohort_id=c.id))
          and not exists(select 1 from public.embryo_ingest_fragments f
          where f.session_id=s.id and f.object_id=g.object_id)
      union all
      select 'genomes',f.bucket_path,'legacy-source',f.id from public.genome_files f
        join public.subjects subject on subject.id=f.subject_id
        where subject.cohort_id=c.id and f.bucket_path is not null and f.storage_object_id is null
      union all
      select storage_bucket,staging_object_name,'upload-staging',id from public.upload_sessions
        where cohort_id=c.id or subject_id in(select id from public.subjects where cohort_id=c.id)
    ) exact_objects;
  update public.embryo_ingest_unwinds set state='storage_pending' where id=u.id;
  return jsonb_build_object('status','storage_pending','unwindId',u.id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. A published attempt's cleanup: its fragments and its unbound parts
-- ---------------------------------------------------------------------------

-- 20260930130000's plan, plus every part of the session that no published
-- canonical source binds. A bound part is the published source itself.
create or replace function private.plan_embryo_published_cleanup_v1()
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
  perform 1 from private.embryo_canonical_parts where session_id = new.id order by id for share;
  insert into public.embryo_ingest_delete_objects (unwind_id, ordinal, bucket_id, object_name, source_kind, source_id)
    select u.id, row_number() over (order by x.bucket_id, x.object_name), x.bucket_id, x.object_name,
      x.source_kind, x.object_id
    from (select coalesce(i.provider_bucket, f.bucket_id) bucket_id, coalesce(i.provider_key, f.object_name) object_name,
        'ingest-fragment'::text source_kind, f.object_id
      from public.embryo_ingest_fragments f left join private.embryo_ingest_write_intents i
        on i.session_id = f.session_id and i.sequence = f.sequence and i.sample_ordinal = f.sample_ordinal
      where f.session_id = new.id
      union all
      -- Parts of earlier or failed attempts: no published source binds them.
      select p.provider_bucket, p.provider_key, 'canonical-part', p.id
      from private.embryo_canonical_parts p
      where p.session_id = new.id
        and not exists (select 1 from private.embryo_canonical_source_parts m where m.part_id = p.id)) x;
  update public.embryo_ingest_unwinds set state = 'storage_pending' where id = u.id;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The terminal purge, with parts
-- ---------------------------------------------------------------------------

-- 20260930130000's purge with two changes: an attempt holding a canonical
-- source is refused before anything is written, and the session's part rows
-- are deleted with the split rows, once their disposal is confirmed. The
-- zero-residual check already covers the three canonical stores, which are
-- registered under variant-rows.
create or replace function private.purge_embryo_ingest_attempt_v1(p_unwind_id uuid)
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
  -- An abandoned attempt never published: no canonical source, no file row.
  if exists (select 1 from private.embryo_canonical_sources x where x.cohort_id = c.id or x.session_id = s.id
        or x.subject_id = any (v_subjects) or x.embryo_id = any (v_embryos))
    or exists (select 1 from public.genome_files g where g.cohort_id = c.id or g.subject_id = any (v_subjects)) then
    raise exception using errcode='55000', message='embryo_unwind_graph_unavailable';
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
  -- Every canonical part of the session, each proved disposed above.
  with gone as (delete from private.embryo_canonical_parts p where p.session_id = s.id returning p.id)
    select array_agg(id) into v_deleted from gone;
  v_ids := v_ids || coalesce(v_deleted, '{}'::uuid[]);
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
-- 6. A published attempt's cleanup completes with its unbound part rows
-- ---------------------------------------------------------------------------

-- 20260930130000's completion, plus the part rows its inventory listed, each
-- proved disposed. Bound parts, published sources and every published row stay.
create or replace function private.finish_embryo_published_cleanup_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare u public.embryo_ingest_unwinds%rowtype; s public.embryo_ingest_sessions%rowtype;
  c public.embryo_cohorts%rowtype; v_now timestamptz; v_objects integer; v_fragments integer; v_maps integer;
  v_parts uuid[]; v_count integer;
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
  v_parts := array(select o.source_id from public.embryo_ingest_delete_objects o
    where o.unwind_id = u.id and o.source_kind = 'canonical-part' order by o.source_id);
  perform 1 from private.embryo_canonical_parts where id = any (v_parts) order by id for update;
  if exists (select 1 from private.embryo_canonical_source_parts m where m.part_id = any (v_parts)) then
    raise exception using errcode='55000', message='embryo_publication_cleanup_unavailable';
  end if;
  delete from private.embryo_ingest_object_disposals where unwind_id = u.id;
  delete from public.embryo_ingest_delete_objects where unwind_id = u.id;
  get diagnostics v_objects = row_count;
  delete from private.embryo_canonical_parts where id = any (v_parts) and session_id = s.id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_parts) then
    raise exception using errcode='55000', message='embryo_publication_cleanup_residue';
  end if;
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
    or exists (select 1 from private.embryo_ingest_object_disposals where unwind_id = u.id)
    or exists (select 1 from private.embryo_canonical_parts p where p.session_id = s.id
      and not exists (select 1 from private.embryo_canonical_source_parts m where m.part_id = p.id)
      and not exists (select 1 from public.embryo_ingest_delete_objects o
        where o.source_kind = 'canonical-part' and o.source_id = p.id)) then
    raise exception using errcode='55000', message='embryo_publication_cleanup_residue';
  end if;
  perform private.append_legal_audit_event(
    'embryo.ingest.fragments-removed', null, null, 'accepted',
    jsonb_build_object('objects', v_objects, 'fragments', v_fragments, 'handles', v_maps, 'parts', v_count));
  return jsonb_build_object('status','complete','completedAt',v_now,'objects',v_objects,
    'fragments',v_fragments,'handles',v_maps,'parts',v_count);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Deleting published canonical sources, for later callers
-- ---------------------------------------------------------------------------

-- The internal planner the retention-deadline, restriction and withdrawal
-- slices call with the files to delete, all of one published attempt. One
-- transaction, in the order the canonical-source contract gives:
--   1. the membership, 2. the source, 3. its genotypes, 4. its `genome_files`
--   row. Nothing but the source's own rows may depend on a file: anything
--   else refuses the whole plan before a row is deleted.
--   5. the parts, which stay as rows under a `purpose = 'source'` unwind until
--      the same claim, finish and confirm doors prove each marker; then
--      `complete_embryo_ingest_unwind_v1` deletes them.
-- The zero-residual check proves no store still names a deleted file. No
-- grant: only definer code calls it. It does not change what
-- `public.restrict_embryo_cohort_v1` does.
create function private.plan_embryo_source_deletion_v1(p_file_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  c public.embryo_cohorts%rowtype;
  s public.embryo_ingest_sessions%rowtype;
  u public.embryo_ingest_unwinds%rowtype;
  v_files uuid[];
  v_parts uuid[];
  v_session uuid;
  v_cohort uuid;
  v_pre jsonb;
  v_residue jsonb;
  v_count integer;
  v_genotypes integer;
begin
  if p_reason is null or p_reason not in ('retention-deadline','restriction','withdrawal')
    or p_file_ids is null or cardinality(p_file_ids) not between 1 and 64
    or array_position(p_file_ids, null) is not null
    or (select count(distinct x) from unnest(p_file_ids) x) <> cardinality(p_file_ids) then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  v_files := array(select x from unnest(p_file_ids) x order by x);
  select min(x.session_id::text)::uuid, min(x.cohort_id::text)::uuid into v_session, v_cohort
    from private.embryo_canonical_sources x where x.file_id = any (v_files);
  if (select count(*) from private.embryo_canonical_sources x where x.file_id = any (v_files)
        and x.session_id = v_session and x.cohort_id = v_cohort) <> cardinality(v_files) then
    raise exception using errcode='42501', message='embryo_source_unavailable';
  end if;

  -- Cohort, then session, then the sources and their rows.
  select * into c from public.embryo_cohorts where id = v_cohort for update;
  select * into s from public.embryo_ingest_sessions where id = v_session for update;
  if c.id is null or s.id is null or c.publication_revision is null or s.status <> 'published'
    or s.cohort_id <> c.id then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  perform 1 from private.embryo_canonical_sources where file_id = any (v_files) order by file_id for update;
  perform 1 from public.genome_files where id = any (v_files) order by id for update;
  v_parts := array(select m.part_id from private.embryo_canonical_source_parts m
    where m.file_id = any (v_files) order by m.part_id);
  perform 1 from private.embryo_canonical_parts where id = any (v_parts) order by id for update;
  if cardinality(v_parts) <> (select sum(part_count) from private.embryo_canonical_sources where file_id = any (v_files))
    or exists (select 1 from private.embryo_canonical_parts p where p.id = any (v_parts)
      and (p.state <> 'landed' or p.session_id <> s.id)) then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  -- Nothing but the source's own rows depends on its file.
  v_pre := private.embryo_ingest_attempt_residue_v1(v_files, '{}');
  if v_pre->'unregistered' <> '{}'::jsonb or v_pre->'unverifiable' <> '0'::jsonb
    or exists (select 1 from jsonb_object_keys(v_pre->'registered') k
      where k not in ('public.genome_files','public.embryo_variants',
        'private.embryo_canonical_sources','private.embryo_canonical_source_parts')) then
    raise exception using errcode='55000', message='embryo_source_dependants';
  end if;

  insert into public.embryo_ingest_unwinds (cohort_id, session_id, draft_id, ingest_revision,
    fixed_ingest_deadline, purpose)
  values (null, s.id, null, s.ingest_revision, s.expires_at, 'source')
  returning * into u;
  insert into public.embryo_ingest_delete_objects (unwind_id, ordinal, bucket_id, object_name, source_kind, source_id)
    select u.id, row_number() over (order by p.provider_bucket, p.provider_key), p.provider_bucket, p.provider_key,
      'canonical-part', p.id
    from private.embryo_canonical_parts p where p.id = any (v_parts);

  delete from private.embryo_canonical_source_parts where file_id = any (v_files);
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_parts) then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  delete from private.embryo_canonical_sources where file_id = any (v_files);
  delete from public.embryo_variants where source_file_id = any (v_files);
  get diagnostics v_genotypes = row_count;
  delete from public.genome_files where id = any (v_files);
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_files) then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  update public.embryo_ingest_unwinds set state = 'storage_pending' where id = u.id;

  v_residue := private.embryo_ingest_attempt_residue_v1(v_files, '{}');
  if not private.embryo_ingest_residue_clear_v1(v_residue) then
    raise exception using errcode='55000', message='embryo_unwind_residue', detail=v_residue::text;
  end if;
  perform private.append_legal_audit_event(
    'embryo.source.deletion-planned', null, null, 'accepted',
    jsonb_build_object('reason', p_reason, 'sources', cardinality(v_files), 'parts', cardinality(v_parts),
      'genotypes', v_genotypes));
  return jsonb_build_object('status','storage_pending','unwindId',u.id,'sources',cardinality(v_files),
    'parts',cardinality(v_parts),'genotypes',v_genotypes);
end $$;

-- After `storage_confirmed`: the part rows the plan listed, each proved
-- disposed, then the inventory. No store may still name a deleted part.
create function private.finish_embryo_source_deletion_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare u public.embryo_ingest_unwinds%rowtype; s public.embryo_ingest_sessions%rowtype;
  v_now timestamptz; v_parts uuid[]; v_objects text[]; v_count integer; v_residue jsonb;
begin
  select * into u from public.embryo_ingest_unwinds where id = p_unwind_id;
  if not found or u.purpose <> 'source' then
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
  if private.embryo_ingest_unwind_unresolved_count_v1(u.id) <> 0 then
    raise exception using errcode='55000', message='embryo_unwind_storage_unresolved';
  end if;
  v_now := clock_timestamp();
  v_parts := array(select o.source_id from public.embryo_ingest_delete_objects o
    where o.unwind_id = u.id and o.source_kind = 'canonical-part' order by o.source_id);
  v_objects := array(select o.bucket_id||'/'||o.object_name from public.embryo_ingest_delete_objects o
    where o.unwind_id = u.id);
  if cardinality(v_parts) = 0 or cardinality(v_objects) <> cardinality(v_parts)
    or exists (select 1 from private.embryo_canonical_source_parts m where m.part_id = any (v_parts)) then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  delete from private.embryo_ingest_object_disposals where unwind_id = u.id;
  delete from public.embryo_ingest_delete_objects where unwind_id = u.id;
  delete from private.embryo_canonical_parts where id = any (v_parts) and session_id = s.id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_parts) then
    raise exception using errcode='55000', message='embryo_source_unavailable';
  end if;
  update public.embryo_ingest_unwinds
    set state = 'complete', completed_at = v_now, cohort_id = null, session_id = null, draft_id = null
    where id = u.id;
  v_residue := private.embryo_ingest_attempt_residue_v1(v_parts, v_objects);
  if not private.embryo_ingest_residue_clear_v1(v_residue) then
    raise exception using errcode='55000', message='embryo_unwind_residue', detail=v_residue::text;
  end if;
  perform private.append_legal_audit_event(
    'embryo.source.parts-removed', null, null, 'accepted', jsonb_build_object('parts', v_count));
  return jsonb_build_object('status','complete','completedAt',v_now,'parts',v_count);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The one completion door, now for three purposes
-- ---------------------------------------------------------------------------

create or replace function private.complete_embryo_ingest_unwind_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_purpose text;
begin
  select purpose into v_purpose from public.embryo_ingest_unwinds where id = p_unwind_id;
  if not found then raise exception using errcode='42501', message='embryo_unwind_unavailable'; end if;
  if v_purpose = 'published' then
    return private.finish_embryo_published_cleanup_v1(p_unwind_id);
  elsif v_purpose = 'source' then
    return private.finish_embryo_source_deletion_v1(p_unwind_id);
  end if;
  return private.purge_embryo_ingest_attempt_v1(p_unwind_id);
end $$;

revoke all on function private.plan_embryo_source_deletion_v1(uuid[], text),
  private.finish_embryo_source_deletion_v1(uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

notify pgrst, 'reload schema';
