-- Owned-cohort account deletion. No parent consent can veto the owner's
-- deletion selector. Already-detached claimant sources remain isolated.
-- A publication's session/job UUIDs are immutable provenance, not authority.

create table private.claimed_embryo_ingest_receipts (
  id uuid primary key,
  historical_cohort_id uuid not null,
  worker_job_id uuid not null unique,
  ingest_revision bigint not null check(ingest_revision>0),
  publication_revision bigint not null check(publication_revision>0),
  manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
  manifest_chunk_count integer not null check(manifest_chunk_count between 1 and 50),
  source_binding_fingerprint text not null check(source_binding_fingerprint~'^[0-9a-f]{64}$'),
  reference_build text not null check(reference_build in('GRCh37','GRCh38'))
);
create table private.claimed_embryo_job_receipts (
  id uuid primary key,
  session_id uuid not null unique references private.claimed_embryo_ingest_receipts(id) on delete restrict,
  historical_cohort_id uuid not null,
  attempt smallint not null check(attempt between 1 and 20),
  source_binding_revision bigint not null check(source_binding_revision>0),
  file_sha256 text not null check(file_sha256~'^[0-9a-f]{64}$'),
  computation_revision text not null,
  idempotency_key text not null check(idempotency_key~'^[0-9a-f]{64}$')
);
create table private.account_owned_cohort_purges (
  deletion_id uuid not null references public.account_deletion_requests(id) on delete restrict,
  cohort_id uuid not null,
  draft_id uuid not null,
  fixed_deadline timestamptz not null,
  lifecycle_revision bigint not null,
  source_unwind_id uuid,
  primary key(deletion_id,cohort_id)
);
alter table private.claimed_embryo_ingest_receipts enable row level security;
alter table private.claimed_embryo_job_receipts enable row level security;
alter table private.account_owned_cohort_purges enable row level security;
revoke all on private.claimed_embryo_ingest_receipts,private.claimed_embryo_job_receipts,
  private.account_owned_cohort_purges from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
select 'variant-rows','private.claimed_embryo_ingest_receipts',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='variant-rows';
insert into public.purge_target_stores(target_id,store_name,store_order)
select 'variant-rows','private.claimed_embryo_job_receipts',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='variant-rows';
insert into public.purge_target_stores(target_id,store_name,store_order)
select 'worker-and-model-working-state','private.account_owned_cohort_purges',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='worker-and-model-working-state';

-- The two old existence-only FKs become a closed tuple check: a part either
-- still names its exact live split session/job or its minimum claimed receipt.
-- Source, membership and part rows are never rewritten during this move.
alter table private.embryo_canonical_parts
  drop constraint embryo_canonical_parts_session_id_fkey,
  drop constraint embryo_canonical_parts_worker_job_id_fkey;

create function private.assert_embryo_part_provenance_v1(p_part uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p private.embryo_canonical_parts;
begin
  select * into p from private.embryo_canonical_parts where id=p_part;
  if p.id is null then return; end if;
  if exists(select 1 from public.embryo_ingest_sessions s join public.worker_jobs w
    on w.id=s.worker_job_id and w.source_binding_id=s.id and w.cohort_id=s.cohort_id
    where s.id=p.session_id and w.id=p.worker_job_id and w.kind='split_cohort_vcf'
      and w.output_kind='ingest.normalize' and w.source_binding_kind='embryo-ingest-fragment-set'
      and w.source_binding_revision=s.ingest_revision and w.file_sha256=s.manifest_sha256
      and p.attempt<=w.attempts) then return; end if;
  if p.state='landed' and exists(select 1
    from private.claimed_embryo_ingest_receipts s join private.claimed_embryo_job_receipts j
      on j.id=s.worker_job_id and j.session_id=s.id and j.historical_cohort_id=s.historical_cohort_id
        and j.source_binding_revision=s.ingest_revision and j.file_sha256=s.manifest_sha256
    join private.embryo_canonical_source_parts m on m.part_id=p.id
    join private.embryo_canonical_sources x on x.file_id=m.file_id
      and x.session_id=s.id and x.worker_job_id=j.id and x.attempt=j.attempt
      and x.cohort_id=s.historical_cohort_id and x.sample_ordinal=p.sample_ordinal
      and x.publication_revision=s.publication_revision
    join private.future_person_custody_slices c on c.source_file_id=x.file_id and c.subject_id=x.subject_id
      and c.historical_cohort_id=x.cohort_id and c.source_sha256=x.source_sha256
      and c.source_membership_sha256=x.membership_sha256 and c.publication_revision=x.publication_revision
    join public.subjects u on u.id=c.subject_id and u.cohort_id is null
      and u.claimant_principal_id=c.claimant_principal_id and u.lifecycle in('claimed_unbound','claimed_bound')
    where s.id=p.session_id and j.id=p.worker_job_id and j.attempt=p.attempt
      and m.sequence=p.sequence and x.reference_build=s.reference_build) then return; end if;
  raise exception using errcode='23514',message='invalid embryo part provenance';
end $$;

create function private.guard_embryo_part_provenance_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; r jsonb; ids uuid[]:='{}'; p uuid;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  foreach r in array array[before_row,after_row] loop
    if r is null then continue; end if;
    if tg_table_name='embryo_canonical_parts' then ids:=array_append(ids,(r->>'id')::uuid);
    elsif tg_table_name in('worker_jobs','claimed_embryo_job_receipts') then
      select array_cat(ids,coalesce(array_agg(id),'{}')) into ids from private.embryo_canonical_parts
        where worker_job_id=(r->>'id')::uuid;
    elsif tg_table_name in('embryo_ingest_sessions','claimed_embryo_ingest_receipts') then
      select array_cat(ids,coalesce(array_agg(id),'{}')) into ids from private.embryo_canonical_parts
        where session_id=(r->>'id')::uuid;
    elsif tg_table_name='embryo_canonical_source_parts' then ids:=array_append(ids,(r->>'part_id')::uuid);
    elsif tg_table_name='embryo_canonical_sources' then
      select array_cat(ids,coalesce(array_agg(part_id),'{}')) into ids from private.embryo_canonical_source_parts
        where file_id=(r->>'file_id')::uuid;
    elsif tg_table_name='future_person_custody_slices' then
      select array_cat(ids,coalesce(array_agg(part_id),'{}')) into ids from private.embryo_canonical_source_parts
        where file_id=(r->>'source_file_id')::uuid;
    elsif tg_table_name='subjects' then
      select array_cat(ids,coalesce(array_agg(m.part_id),'{}')) into ids from private.embryo_canonical_sources x
        join private.embryo_canonical_source_parts m on m.file_id=x.file_id where x.subject_id=(r->>'id')::uuid;
    end if;
  end loop;
  foreach p in array ids loop perform private.assert_embryo_part_provenance_v1(p); end loop;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['private.embryo_canonical_parts','public.worker_jobs',
    'public.embryo_ingest_sessions','private.claimed_embryo_ingest_receipts','private.claimed_embryo_job_receipts',
    'private.embryo_canonical_source_parts','private.embryo_canonical_sources','private.future_person_custody_slices','public.subjects'] loop
    execute format('create constraint trigger embryo_part_provenance after insert or update or delete on %s
      deferrable initially deferred for each row execute function private.guard_embryo_part_provenance_v1()',t);
  end loop;
end $$;

create function private.freeze_claimed_embryo_receipt_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='23514',message='claimed provenance receipt immutable';
end $$;
create trigger claimed_embryo_session_immutable before update on private.claimed_embryo_ingest_receipts
  for each row execute function private.freeze_claimed_embryo_receipt_v1();
create trigger claimed_embryo_job_immutable before update on private.claimed_embryo_job_receipts
  for each row execute function private.freeze_claimed_embryo_receipt_v1();

-- No generic archive door. Only an already-started due owner deletion can
-- retain the exact session/job needed by an already-detached claimed source.
create function private.capture_claimed_embryo_provenance_v1(p_deletion uuid,p_cohort uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests; r record;
begin
  select * into d from public.account_deletion_requests where id=p_deletion
    and state='delete_started' and notice_ends_at<=clock_timestamp() and claim_expires_at>clock_timestamp() for update;
  if d.id is null or not exists(select 1 from public.embryo_cohorts where id=p_cohort
    and owner_account_id=d.account_id for update) then
    raise exception using errcode='42501',message='account cohort purge unavailable'; end if;
  for r in select distinct x.session_id,x.worker_job_id from private.future_person_custody_slices c
    join private.embryo_canonical_sources x on x.file_id=c.source_file_id and x.subject_id=c.subject_id
      and x.cohort_id=c.historical_cohort_id and x.source_sha256=c.source_sha256
      and x.membership_sha256=c.source_membership_sha256 and x.publication_revision=c.publication_revision
    join public.subjects u on u.id=c.subject_id and u.cohort_id is null
      and u.claimant_principal_id=c.claimant_principal_id and u.lifecycle in('claimed_unbound','claimed_bound')
    where c.historical_cohort_id=p_cohort order by x.session_id,x.worker_job_id
  loop
    perform 1 from public.embryo_ingest_sessions s join public.worker_jobs w on w.id=s.worker_job_id
      and w.source_binding_id=s.id and w.cohort_id=s.cohort_id
      where s.id=r.session_id and s.cohort_id=p_cohort and s.status='published'
        and w.id=r.worker_job_id and w.status='done' and w.kind='split_cohort_vcf'
        and w.output_kind='ingest.normalize' and w.source_binding_kind='embryo-ingest-fragment-set'
        and w.source_binding_revision=s.ingest_revision and w.file_sha256=s.manifest_sha256
      for update of s,w;
    if not found then raise exception using errcode='55000',message='claimed source provenance unavailable'; end if;
    insert into private.claimed_embryo_ingest_receipts
      select s.id,s.cohort_id,s.worker_job_id,s.ingest_revision,c.publication_revision,s.manifest_sha256,s.manifest_chunk_count,
        s.source_binding_fingerprint,s.reference_build from public.embryo_ingest_sessions s
        join public.embryo_cohorts c on c.id=s.cohort_id where s.id=r.session_id
      on conflict do nothing;
    insert into private.claimed_embryo_job_receipts
      select w.id,w.source_binding_id,w.cohort_id,w.attempts,w.source_binding_revision,w.file_sha256,
        w.computation_revision,w.idempotency_key from public.worker_jobs w where w.id=r.worker_job_id
      on conflict do nothing;
    if exists(select 1 from private.claimed_embryo_ingest_receipts q join public.embryo_ingest_sessions s on s.id=q.id
      where q.id=r.session_id and (q.historical_cohort_id,q.worker_job_id,q.ingest_revision,q.publication_revision,q.manifest_sha256,
        q.manifest_chunk_count,q.source_binding_fingerprint,q.reference_build) is distinct from
        (s.cohort_id,s.worker_job_id,s.ingest_revision,(select publication_revision from public.embryo_cohorts where id=s.cohort_id),s.manifest_sha256,s.manifest_chunk_count,s.source_binding_fingerprint,s.reference_build))
      or exists(select 1 from private.claimed_embryo_job_receipts q join public.worker_jobs w on w.id=q.id
        where q.id=r.worker_job_id and (q.session_id,q.historical_cohort_id,q.attempt,q.source_binding_revision,
          q.file_sha256,q.computation_revision,q.idempotency_key) is distinct from
          (w.source_binding_id,w.cohort_id,w.attempts,w.source_binding_revision,w.file_sha256,w.computation_revision,w.idempotency_key)) then
      raise exception using errcode='23514',message='claimed provenance receipt mismatch'; end if;
  end loop;
end $$;
revoke all on function private.assert_embryo_part_provenance_v1(uuid),
  private.guard_embryo_part_provenance_v1(),private.freeze_claimed_embryo_receipt_v1(),
  private.capture_claimed_embryo_provenance_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.prepare_account_owned_cohorts_v1(p_deletion uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests; c public.embryo_cohorts;
  files uuid[]; result jsonb; unwind uuid;
begin
  select * into d from public.account_deletion_requests where id=p_deletion and state='delete_started'
    and notice_ends_at<=clock_timestamp() and claim_expires_at>clock_timestamp() for update;
  if d.id is null then raise exception using errcode='42501',message='account cohort purge unavailable'; end if;
  for c in select * from public.embryo_cohorts where owner_account_id=d.account_id order by id for update loop
    if exists(select 1 from private.account_owned_cohort_purges where deletion_id=d.id and cohort_id=c.id) then continue; end if;
    perform 1 from public.embryo_participant_sets where cohort_id=c.id order by set_kind,principal_id,membership_revision for update;
    perform 1 from public.subjects where cohort_id=c.id order by id for update;
    perform 1 from public.embryos where cohort_id=c.id order by id for update;
    perform private.assert_account_owned_cohorts_v1(d.account_id);
    perform private.capture_claimed_embryo_provenance_v1(d.id,c.id);
    -- Claim approval has already moved every claimant out of both live cohort
    -- selectors. Historical source.cohort_id alone cannot select a source.
    delete from public.embryo_figures f using public.embryo_scores sc,public.embryos e
      where f.finding_id=sc.id and sc.embryo_id=e.id and e.cohort_id=c.id;
    delete from public.embryo_scores sc using public.embryos e where sc.embryo_id=e.id and e.cohort_id=c.id;
    delete from public.embryo_qc q using public.embryos e where q.embryo_id=e.id and e.cohort_id=c.id;
    delete from public.embryo_variants v using public.embryos e where v.embryo_id=e.id and e.cohort_id=c.id;
    update public.embryo_cohorts set status='purge_queued',lifecycle_revision=lifecycle_revision+1 where id=c.id;
    update public.subjects set lifecycle='restricted',lifecycle_revision=lifecycle_revision+1,updated_at=clock_timestamp()
      where cohort_id=c.id and lifecycle<>'purged';
    select array_agg(x.file_id order by x.file_id) into files from private.embryo_canonical_sources x
      join public.subjects u on u.id=x.subject_id and u.cohort_id=c.id
      join public.embryos e on e.id=x.embryo_id and e.subject_id=u.id and e.cohort_id=c.id
      where u.lifecycle not in('claimed_unbound','claimed_bound');
    unwind:=null;
    if files is not null then
      result:=private.plan_embryo_source_deletion_v1(files,'retention-deadline');
      unwind:=(result->>'unwindId')::uuid;

    end if;
    insert into private.account_owned_cohort_purges(deletion_id,cohort_id,draft_id,fixed_deadline,lifecycle_revision,source_unwind_id)
      select d.id,c.id,c.draft_id,d.notice_ends_at,x.lifecycle_revision,unwind from public.embryo_cohorts x where x.id=c.id;
    update public.purpose_grants set revoked_at=coalesce(revoked_at,clock_timestamp()),revocation_reason=coalesce(revocation_reason,'account-deletion')
      where target_kind='cohort' and target_id=c.id;
    update public.directional_grants set status='revoked',ended_at=clock_timestamp()
      where grant_id in(select grant_id from public.purpose_grants where target_kind='cohort' and target_id=c.id) and status='current';
    update public.future_person_record_key_hashes h set status='revoked',ended_at=clock_timestamp()
      from public.embryos e where e.id=h.embryo_id and e.cohort_id=c.id and h.status='current';
    update public.future_person_record_key_print_rights h set status='revoked'
      from public.embryos e where e.id=h.embryo_id and e.cohort_id=c.id and h.status='unconsumed';
    update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,claim_expires_at=null,claimed_by=null
      where cohort_id=c.id and status in('queued','running');
  end loop;
end $$;
revoke all on function private.prepare_account_owned_cohorts_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function public.account_embryo_unwinds_v1(p_deletion_id uuid,p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; result jsonb;
begin
  select account_id into a from public.account_deletion_requests where id=p_deletion_id and state='delete_started'
    and claim_token_hash=p_claim_token_hash and claim_expires_at>clock_timestamp() for update;
  if a is null then raise exception using errcode='42501',message='account cohort purge unavailable'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('unwindId',u.id,'purpose',u.purpose,'state',u.state)
    order by case u.purpose when 'published' then 0 when 'abandoned' then 1 else 2 end,u.id),'[]') into result
    from public.embryo_ingest_unwinds u where u.state in('storage_pending','storage_confirmed') and (
      u.id in(select source_unwind_id from private.account_owned_cohort_purges where deletion_id=p_deletion_id)
      or u.session_id in(select s.id from public.embryo_ingest_sessions s join private.account_owned_cohort_purges p
        on p.cohort_id=s.cohort_id where p.deletion_id=p_deletion_id));
  if jsonb_array_length(result)>100 then raise exception using errcode='55000',message='account cohort batch exceeded'; end if;
  return result;
end $$;
revoke all on function public.account_embryo_unwinds_v1(uuid,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.account_embryo_unwinds_v1(uuid,text) to service_role;

create function private.assert_account_owned_cohorts_v1(p_account uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.embryo_cohorts; principals uuid[];
begin
  for c in select * from public.embryo_cohorts where owner_account_id=p_account order by id for update loop
    perform 1 from public.embryo_cohort_drafts where id=c.draft_id and owner_account_id=p_account for update;
    if not found then raise exception using errcode='55000',message='unsupported_account_graph'; end if;
    -- Human-review/private-object deletion is a separate registered executor;
    -- it cannot be guessed by this cohort source implementation.
    if c.basis_case not in('true_two_parent','anonymous_donor') or c.publication_revision is null then
      raise exception using errcode='55000',message='unsupported_account_graph'; end if;
    principals:=array(select distinct p.id from public.subject_principals p
      join public.embryo_draft_participants s on s.principal_id=p.id and s.draft_id=c.draft_id
      where p.principal_kind in('genetic_parent','identified_donor') order by p.id);
    if exists(select 1 from public.subject_principals where id=any(principals) and subject_id is not null)
      or exists(select 1 from public.embryo_draft_participants where principal_id=any(principals) and draft_id<>c.draft_id)
      or exists(select 1 from public.draft_participant_slots where principal_id=any(principals) and embryo_draft_id<>c.draft_id)
      or exists(select 1 from public.embryo_participant_sets where principal_id=any(principals) and cohort_id<>c.id)
      or exists(select 1 from public.consent_signatures where signer_principal_id=any(principals)
        and not((target_kind='cohort_draft' and target_id=c.draft_id) or(target_kind='cohort' and target_id=c.id)))
      or exists(select 1 from public.purpose_grants where signer_principal_id=any(principals)
        and not(target_kind='cohort' and target_id=c.id)) then
      raise exception using errcode='55000',message='unsupported_account_graph'; end if;
    if exists(select 1 from public.future_person_claims f join public.embryos e on e.id=f.embryo_id
      where e.cohort_id=c.id) then
      -- Approved detached claims are outside this selector. An unapproved
      -- documentary case still needs its object-aware case executor.
      raise exception using errcode='55000',message='unsupported_account_graph'; end if;
  end loop;
end $$;
revoke all on function private.assert_account_owned_cohorts_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.purge_account_owned_cohorts_v1(p_deletion uuid)
returns void language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests; t private.account_owned_cohort_purges;
  c public.embryo_cohorts; v_principal_ids uuid[]; v_subject_ids uuid[]; v_embryo_ids uuid[]; v_session_ids uuid[]; v_job_ids uuid[];
  v_outbox_ids uuid[]; v_invitation_ids uuid[]; deleted_ids uuid[]; r record; n bigint;
begin
  select * into d from public.account_deletion_requests where id=p_deletion and state='delete_started'
    and storage_completed_at is not null and claim_expires_at>clock_timestamp() for update;
  if d.id is null then raise exception using errcode='55000',message='storage_purge_incomplete'; end if;
  for t in select * from private.account_owned_cohort_purges where deletion_id=d.id order by cohort_id for update loop
    if t.fixed_deadline is distinct from d.notice_ends_at then
      raise exception using errcode='55000',message='account cohort deadline changed'; end if;
    if t.source_unwind_id is not null and not exists(select 1 from public.embryo_ingest_unwinds
      where id=t.source_unwind_id and state='complete') then
      raise exception using errcode='55000',message='storage_purge_incomplete'; end if;
    select * into c from public.embryo_cohorts where id=t.cohort_id for update;
    if c.id is null then
      if not exists(select 1 from public.embryo_ingest_unwinds where id=t.source_unwind_id and purpose='abandoned' and state='complete') then
        raise exception using errcode='55000',message='account cohort purge unavailable'; end if;
      delete from private.account_owned_cohort_purges where deletion_id=d.id and cohort_id=t.cohort_id;
      continue;
    end if;
    if c.owner_account_id is distinct from d.account_id or c.status<>'purge_queued'
      or c.lifecycle_revision<>t.lifecycle_revision or c.draft_id<>t.draft_id then
      raise exception using errcode='55000',message='account cohort purge unavailable'; end if;
    perform private.assert_account_owned_cohorts_v1(d.account_id);
    v_subject_ids:=array(select id from public.subjects where cohort_id=c.id order by id);
    v_embryo_ids:=array(select id from public.embryos where cohort_id=c.id order by id);
    v_session_ids:=array(select id from public.embryo_ingest_sessions where cohort_id=c.id order by id);
    v_job_ids:=array(select id from public.worker_jobs where cohort_id=c.id order by id);
    v_principal_ids:=array(select distinct p.id from public.subject_principals p
      join public.embryo_draft_participants s on s.principal_id=p.id and s.draft_id=c.draft_id
      where p.principal_kind in('genetic_parent','identified_donor') order by p.id);
    if exists(select 1 from private.embryo_canonical_parts p where p.session_id=any(v_session_ids)
      and not exists(select 1 from private.embryo_canonical_source_parts m join private.future_person_custody_slices x
        on x.source_file_id=m.file_id where m.part_id=p.id))
      or exists(select 1 from public.embryo_ingest_unwinds where session_id=any(v_session_ids) and state<>'complete')
      or exists(select 1 from public.embryo_ingest_fragments where session_id=any(v_session_ids)) then
      raise exception using errcode='55000',message='storage_purge_incomplete'; end if;
    -- Force the replacement tuple check while both live and archived paths
    -- exist. After runtime deletion it runs again against the archive alone.
    for r in select id from private.embryo_canonical_parts where session_id=any(v_session_ids) loop
      perform private.assert_embryo_part_provenance_v1(r.id); end loop;
    v_invitation_ids:=array(select id from public.subject_invitations where
      (target_kind='cohort_draft' and target_id=c.draft_id) or (target_kind='cohort' and target_id=c.id));
    v_outbox_ids:=array(select id from public.mail_outbox where target_id=c.id or target_id=c.draft_id
      or target_id=any(v_invitation_ids) or recipient_principal_id=any(v_principal_ids));
    delete from public.download_ranges where session_id in(select id from public.download_sessions
      where (target_kind='cohort' and target_id=c.id) or principal_id=any(v_principal_ids));
    delete from public.download_sessions where (target_kind='cohort' and target_id=c.id) or principal_id=any(v_principal_ids);
    delete from public.rights_nonces where rights_session_id in(select id from public.rights_sessions
      where target_id=c.id or target_id=c.draft_id or target_id=any(v_invitation_ids) or principal_id=any(v_principal_ids)
        or token_hash_id in(select th.id from public.token_hashes th join public.token_candidates tc on tc.id=th.candidate_id
          where tc.outbox_id=any(v_outbox_ids)));
    delete from public.rights_sessions where target_id=c.id or target_id=c.draft_id or target_id=any(v_invitation_ids)
      or principal_id=any(v_principal_ids) or token_hash_id in(select th.id from public.token_hashes th
        join public.token_candidates tc on tc.id=th.candidate_id where tc.outbox_id=any(v_outbox_ids));
    delete from public.future_person_claim_notices where outbox_id=any(v_outbox_ids);
    delete from public.invitation_reminders where invitation_id=any(v_invitation_ids) or outbox_id=any(v_outbox_ids);
    delete from public.mail_deliveries where outbox_id=any(v_outbox_ids);
    delete from public.mail_provider_attempts where outbox_id=any(v_outbox_ids);
    delete from public.mail_outbox where id=any(v_outbox_ids);
    delete from public.subject_invitations where id=any(v_invitation_ids);
    delete from public.future_person_record_key_print_rights where embryo_id=any(v_embryo_ids) or recipient_principal_id=any(v_principal_ids);
    delete from public.future_person_record_key_hashes where embryo_id=any(v_embryo_ids) or recipient_principal_id=any(v_principal_ids);
    delete from public.future_person_record_key_recipients where cohort_id=c.id;
    delete from public.embryo_disposition_proposals where embryo_id=any(v_embryo_ids) or proposer_principal_id=any(v_principal_ids);
    delete from public.purpose_grant_nonces where grant_id in(select grant_id from public.purpose_grants where target_kind='cohort' and target_id=c.id);
    delete from public.directional_grants where grant_id in(select grant_id from public.purpose_grants where target_kind='cohort' and target_id=c.id);
    delete from public.purpose_grants where target_kind='cohort' and target_id=c.id;
    delete from public.attestation_contradictions where cohort_id=c.id or subject_id=any(v_subject_ids) or attestation_id in(
      select id from public.attestations where target_id=c.id or target_id=c.draft_id);
    delete from public.attestations where target_id=c.id or target_id=c.draft_id;
    delete from public.embryo_basis_bindings where cohort_id=c.id;
    delete from public.embryo_donor_attributions where cohort_id=c.id;
    delete from public.consent_signatures where (target_kind='cohort_draft' and target_id=c.draft_id) or(target_kind='cohort' and target_id=c.id);
    delete from public.embryo_participant_sets where cohort_id=c.id;
    delete from private.embryo_split_variants where session_id=any(v_session_ids);
    delete from private.embryo_split_ordinals where session_id=any(v_session_ids);
    -- These live rows carry parent accounts, credentials and authority; their
    -- minimum frozen receipts, rather than mutable rows, serve retained parts.
    delete from public.embryo_ingest_sessions where id=any(v_session_ids);
    delete from public.worker_job_batches where worker_job_id=any(v_job_ids);
    delete from public.analysis_jobs where worker_job_id=any(v_job_ids);
    delete from public.worker_jobs where id=any(v_job_ids);
    delete from public.subject_consents where subject_id=any(v_subject_ids);
    delete from public.subject_demographics where subject_id=any(v_subject_ids);
    delete from public.suppressions where subject_id=any(v_subject_ids);
    delete from public.embryos where id=any(v_embryo_ids);
    delete from public.subjects where id=any(v_subject_ids);
    -- End only the exact parent graph's existing clocks. Detached claimant
    -- retention rows are selected by neither current subject nor cohort.
    update public.retention_due_phases set status='succeeded',terminal_outcome_code='account_owned_cohort_purged',
      completed_at=clock_timestamp(),claim_token_hash=null,claim_expires_at=null
      where retention_row_id in(select id from public.retention_rows where target_id=any(array[c.id,c.draft_id]||v_subject_ids||v_embryo_ids||v_session_ids))
        and status in('pending','retry','claimed');
    update public.purge_manifests set state='complete' where retention_row_id in(
      select id from public.retention_rows where target_id=any(array[c.id,c.draft_id]||v_subject_ids||v_embryo_ids||v_session_ids))
      and state in('frozen','executing');
    update public.retention_rows set state='complete',ended_at=clock_timestamp()
      where target_id=any(array[c.id,c.draft_id]||v_subject_ids||v_embryo_ids||v_session_ids) and state in('scheduled','active');
    delete from public.embryo_operation_nonces where target_id=c.id or target_id=c.draft_id or target_id=any(v_session_ids);
    delete from public.embryo_cohorts where id=c.id;
    delete from public.embryo_cohort_drafts where id=c.draft_id;
    delete from public.encrypted_contact_references where principal_id=any(v_principal_ids);
    delete from public.subject_principals where id=any(v_principal_ids);
    delete from private.account_owned_cohort_purges where deletion_id=d.id and cohort_id=c.id;
    perform private.assert_no_public_fk_residual_v1(null,v_subject_ids,v_principal_ids);
    -- Claimed receipts deliberately retain historical UUIDs. No live FK may
    -- name the deleted parent cohort/draft/session/job or unclaimed subject.
    deleted_ids:=array[c.id,c.draft_id]||v_session_ids||v_job_ids||v_subject_ids||v_embryo_ids||v_principal_ids;
    for r in select con.conrelid::regclass relation,a.attname from pg_constraint con
      join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
      where con.contype='f' and array_length(con.conkey,1)=1 and con.confrelid in(
        'public.embryo_cohorts'::regclass,'public.embryo_cohort_drafts'::regclass,
        'public.embryo_ingest_sessions'::regclass,'public.worker_jobs'::regclass,'public.embryos'::regclass)
    loop
      execute format('select count(*) from %s where %I=any($1)',r.relation,r.attname) into n using deleted_ids;
      if n<>0 then raise exception using errcode='55000',message='account cohort residual'; end if;
    end loop;
  end loop;
end $$;
revoke all on function private.purge_account_owned_cohorts_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;

-- Preserve the existing adult graph, nonce checks and worker ABI.

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
    'profiles.id', 'purpose_grant_nonces.account_id', 'provider_recipient_grants.account_id',
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
    'worker_jobs.subject_id', 'worker_jobs.user_id',
    'embryo_cohort_drafts.owner_account_id','embryo_cohort_drafts.uploader_principal_id',
    'embryo_cohorts.owner_account_id','embryos.subject_id','embryo_draft_participants.principal_id',
    'draft_participant_slots.principal_id','embryo_participant_sets.principal_id',
    'embryo_donor_attributions.donor_principal_id',
    'embryo_ingest_sessions.account_id','embryo_ingest_sessions.uploader_principal_id',
    'future_person_record_key_recipients.recipient_principal_id',
    'future_person_record_key_hashes.recipient_principal_id',
    'future_person_record_key_print_rights.recipient_principal_id',
    'embryo_disposition_proposals.proposer_principal_id','embryo_operation_nonces.account_id',
    'subject_invitations.inviter_principal_id','subject_invitations.invitee_principal_id'
  ];
begin
  -- This newly supported FK is only the exact live owner-cohort tuple.
  -- An arbitrary embryo pointing into the selected subject list is not an
  -- owned graph and cannot gain admission from the table-name census.
  if exists(select 1 from public.embryos e join public.subjects s on s.id=e.subject_id
    where e.subject_id=any(p_subject_ids) and (s.subject_class<>'embryo'
      or s.cohort_id is distinct from e.cohort_id
      or not exists(select 1 from public.embryo_cohorts c where c.id=e.cohort_id
        and c.owner_account_id=p_account_id and s.owner_account_id=p_account_id))) then
    raise exception using errcode='55000',message='unsupported_account_graph'; end if;
  -- The cohort worker deletes invitations only for its exact parent-owned
  -- cohort/draft targets. A principal FK in any other invitation still blocks.
  if exists(select 1 from public.subject_invitations i
    where (i.inviter_principal_id=any(p_principal_ids) or i.invitee_principal_id=any(p_principal_ids))
      and not exists(select 1 from public.embryo_cohorts c where c.owner_account_id=p_account_id
        and ((i.target_kind='cohort_draft' and i.target_id=c.draft_id)
          or (i.target_kind='cohort' and i.target_id=c.id)))) then
    raise exception using errcode='55000',message='unsupported_account_graph'; end if;
  -- These hash-only replay receipts are now also written by canonical own
  -- choices. Admit only an exact owned historical self-grant tuple. Current
  -- validity is intentionally irrelevant after withdrawal/deletion hold.
  -- A foreign nonce referencing an owned grant must block, not be erased.
  for r in
    select n.* from public.purpose_grant_nonces n
    where n.account_id = p_account_id or n.grant_id in (
      select g.grant_id from public.purpose_grants g
      where g.data_subject_principal_id = any(p_principal_ids)
         or g.signer_principal_id = any(p_principal_ids)
         or (g.target_kind = 'subject' and g.target_id = any(p_subject_ids))
    )
    order by n.nonce_hash for update
  loop
    -- A counterpart's nonce may refer only to this exact owned cohort grant.
    -- Full owner deletion removes that scoped credential; no other grant is admitted.
    if r.grant_id is not null and exists(select 1 from public.purpose_grants g
      join public.embryo_cohorts c on c.id=g.target_id and c.owner_account_id=p_account_id
      join public.subject_principals sp on sp.id=g.signer_principal_id and sp.account_id=r.account_id
      join public.consent_signatures cs on cs.id=g.signature_id and cs.signer_principal_id=sp.id
        and cs.signer_account_id=r.account_id and cs.target_kind='cohort' and cs.target_id=c.id
        and cs.purpose=g.purpose and cs.artifact_key=g.artifact_key and cs.artifact_version=g.artifact_version
        and cs.artifact_body_sha256=g.artifact_body_sha256
      where g.grant_id=r.grant_id and g.target_kind='cohort') then continue; end if;
    if r.account_id is distinct from p_account_id or (
      r.grant_id is not null and not exists (
        select 1 from public.purpose_grants g
        join public.directional_grants d on d.grant_id = g.grant_id and d.grant_revision = g.grant_revision
        join public.subjects s on s.id = g.target_id
        join public.subject_principals p on p.id = g.data_subject_principal_id
        join public.consent_signatures cs on cs.id = g.signature_id
        where g.grant_id = r.grant_id and g.target_kind = 'subject'
          and g.target_id = any(p_subject_ids) and s.subject_class = 'self'
          and s.owner_account_id = p_account_id and s.subject_account_id = p_account_id
          and g.signer_principal_id = g.data_subject_principal_id
          and p.id = any(p_principal_ids) and p.account_id = p_account_id and p.subject_id = s.id
          and p.principal_kind = 'account_subject'
          and d.direction = 'self' and d.recipient_account_id = p_account_id
          and d.recipient_principal_id = p.id and d.relationship_id is null and d.pair_id is null
          and cs.signer_account_id = p_account_id and cs.signer_principal_id = p.id
          and cs.target_kind = 'subject' and cs.target_id = s.id and cs.purpose = g.purpose
          and cs.artifact_key = g.artifact_key and cs.artifact_version = g.artifact_version
          and cs.artifact_body_sha256 = g.artifact_body_sha256
          and cs.subject_binding_revision = g.subject_binding_revision
          and cs.jurisdiction_code = g.jurisdiction_code and cs.jurisdiction_revision = g.jurisdiction_revision
      )
    ) then
      raise exception using errcode = '55000', message = 'unsupported_account_graph';
    end if;
    -- NULL grant_id carries no grant authority; it is only this account's
    -- consumed replay marker. Its hash/consumed timestamp stay unchanged until
    -- the authorized physical account purge, never while merely claiming.
  end loop;

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
  perform private.assert_account_owned_cohorts_v1(p_account_id);
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
          or (s.subject_class not in ('self', 'other_adult') and not (s.subject_class='embryo'
            and s.cohort_id in(select id from public.embryo_cohorts where owner_account_id=p_account_id)))
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
        not coalesce((sp.subject_id=any(v_subject_ids) and (sp.account_id is null or sp.account_id=p_account_id)
          and sp.principal_kind in('account_subject','non_account_subject')),false)
        and not (sp.subject_id is null and sp.principal_kind in('genetic_parent','identified_donor')
          and sp.id in(select p.principal_id from public.embryo_draft_participants p
            join public.embryo_cohorts c on c.draft_id=p.draft_id where c.owner_account_id=p_account_id))
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
    where (d.owner_account_id=p_account_id or d.uploader_principal_id=any(v_principal_ids))
      and not exists(select 1 from public.embryo_cohorts c where c.draft_id=d.id and c.owner_account_id=p_account_id)
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
      and not (r.retention_id in('embryo.stored-or-unknown-24mo','embryo.transferred-claim-window',
        'embryo.donated-or-discarded-90d','embryo.ingest-session-24h','embryo.cohort-draft-30d')
        and (r.target_id in(select id from public.embryo_cohorts where owner_account_id=p_account_id)
          or r.target_id in(select draft_id from public.embryo_cohorts where owner_account_id=p_account_id)
          or r.target_id in(select u.id from public.subjects u join public.embryo_cohorts c on c.id=u.cohort_id where c.owner_account_id=p_account_id)
          or r.target_id in(select e.id from public.embryos e join public.embryo_cohorts c on c.id=e.cohort_id where c.owner_account_id=p_account_id)
          or r.target_id in(select s.id from public.embryo_ingest_sessions s join public.embryo_cohorts c on c.id=s.cohort_id where c.owner_account_id=p_account_id)))
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

    -- The corresponding public request/notice contract remains closed.
    -- A legacy unnotified request must not bypass the same boundary.
    if exists(select 1 from public.embryo_cohorts where owner_account_id=v_request.account_id) then
      raise exception using errcode='55000',message='unsupported_account_graph';
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

    perform private.prepare_account_owned_cohorts_v1(v_request.id);

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

      select us.storage_bucket, us.staging_object_name,
        'upload-staging', us.id
      from public.upload_sessions us
      where us.account_id = v_request.account_id
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = us.storage_bucket
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
  if exists(select 1 from private.account_owned_cohort_purges p
    where p.deletion_id=p_deletion_id and p.source_unwind_id is not null and not exists(
      select 1 from public.embryo_ingest_unwinds u where u.id=p.source_unwind_id and u.state='complete'))
    or exists(select 1 from public.embryo_ingest_unwinds u join public.embryo_ingest_sessions s on s.id=u.session_id
      join private.account_owned_cohort_purges p on p.cohort_id=s.cohort_id
      where p.deletion_id=p_deletion_id and u.state<>'complete') then
    raise exception using errcode='55000',message='storage_purge_incomplete'; end if;
  update public.account_deletion_requests
  set storage_completed_at = coalesce(storage_completed_at, clock_timestamp())
  where id = p_deletion_id;
end;
$$;

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
  perform private.purge_account_owned_cohorts_v1(p_deletion_id);
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

-- Keep public requests closed until the separate exact recipient contract.
create or replace function public.request_account_deletion_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_nonce_hash text,
  p_contact_ciphertext bytea,
  p_contact_hmac text,
  p_notice_idempotency_key text
)
returns table (
  deletion_id uuid,
  status text,
  notice_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_profile public.profiles%rowtype;
  v_principal public.subject_principals%rowtype;
  v_graph_revision bigint;
  v_request public.account_deletion_requests%rowtype;
  v_retention_id uuid;
  v_contact_id uuid;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);
  -- This worker prerequisite does not yet implement account-deletion-v1's
  -- affected-recipient notice/cancellation envelope. No new owned-cohort
  -- request may start a notice hold until that atomic contract is present.
  if exists(select 1 from public.embryo_cohorts where owner_account_id=p_account_id) then
    raise exception using errcode='55000',message='unsupported_account_graph';
  end if;

  if p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_contact_ciphertext is null
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_notice_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid_deletion_request';
  end if;

  update public.account_operation_nonces
  set consumed_at = v_now
  where nonce_hash = p_nonce_hash
    and account_id = p_account_id
    and session_id = p_session_id
    and operation = 'account_delete'
    and consumed_at is null
    and expires_at > v_now;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_operation_nonce';
  end if;

  select p.* into strict v_profile
  from public.profiles p where p.id = p_account_id for update;

  if exists (
    select 1 from public.account_deletion_requests d
    where d.account_id = p_account_id
      and d.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '23505', message = 'deletion_request_exists';
  end if;

  select sp.* into strict v_principal
  from public.subject_principals sp
  join public.subjects s on s.id = sp.subject_id
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and s.subject_class = 'self'
    and s.subject_account_id = p_account_id
  order by sp.created_at, sp.id
  limit 1
  for update of sp;

  select greatest(coalesce(max(sp.principal_revision), 1), 1)
  into v_graph_revision
  from public.subject_principals sp
  where sp.account_id = p_account_id;

  update public.profiles
  set deletion_requested_at = v_now,
      account_revision = account_revision + 1,
      auth_session_revision = auth_session_revision + 1
  where id = p_account_id
  returning * into v_profile;

  insert into public.account_deletion_requests (
    account_id, request_account_revision, request_auth_session_revision,
    principal_graph_revision, deletion_hold_revision, state,
    requested_at, notice_ends_at
  ) values (
    p_account_id, v_profile.account_revision,
    v_profile.auth_session_revision, v_graph_revision,
    v_profile.account_revision, 'notice_period', v_now,
    v_now + interval '7 days'
  ) returning * into v_request;

  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline, state
  ) values (
    'account-deletion.notice-7d', 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    v_profile.account_revision, v_request.notice_ends_at, 'scheduled'
  ) returning id into v_retention_id;

  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'account-deletion.notice-7d',
    'account-deletion-notice-deadline', 'compound-atomic', 1,
    v_request.notice_ends_at, 'account', p_account_id,
    v_profile.account_revision, v_profile.account_revision,
    'account-subject-principal', v_principal.principal_revision,
    jsonb_build_object(
      'deletionRequestId', v_request.id,
      'principalGraphRevision', v_graph_revision,
      'originalNoticeEndsAt', v_request.notice_ends_at
    )
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'account-deletion-notice-deadline', 1,
    'complete-retention', 1,
    encode(extensions.digest(
      concat_ws(':', 'account-deletion-v1', v_request.id::text,
        p_account_id::text, v_graph_revision::text,
        v_request.notice_ends_at::text),
      'sha256'
    ), 'hex'),
    'frozen'
  );

  select ecr.id into v_contact_id
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_principal.id
    and ecr.contact_hmac = p_contact_hmac
    and ecr.status = 'current'
  order by ecr.created_at desc limit 1 for update;

  if v_contact_id is null then
    update public.encrypted_contact_references ecr
    set status = 'rotated', ended_at = v_now
    where ecr.principal_id = v_principal.id and ecr.status = 'current';

    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal.id, p_contact_ciphertext, p_contact_hmac, 1,
      v_principal.principal_revision, 'current'
    ) returning id into v_contact_id;

    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (
      v_contact_id, p_contact_hmac, 1, 'current',
      v_request.notice_ends_at + interval '1 day'
    );
  end if;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    template_payload, expires_at
  ) values (
    'account-deletion-notice', 'account-deletion-notice', 'account',
    v_request.id, v_principal.id, v_contact_id,
    v_principal.principal_revision, 1, p_notice_idempotency_key,
    jsonb_build_object(
      'noticeEndsAt', v_request.notice_ends_at,
      'cancelPath', '/settings/data',
      'exportPath', '/api/export'
    ),
    v_request.notice_ends_at + interval '1 day'
  );

  -- Keep only the verified session that requested deletion. The proxy limits
  -- that session to export, revocation, transfer, and cancellation operations.
  delete from auth.sessions
  where user_id = p_account_id and id <> p_session_id;

  return query select v_request.id, 'notice_period'::text, v_request.notice_ends_at;
end;
$$;

notify pgrst, 'reload schema';
