-- The exact storage disposal of an unwound embryo upload, and D-130.
-- Test-local primitives only. No route, scheduler, gateway deployment or
-- terminal purge is added; EMBRYO_INGEST_AVAILABLE stays false.
--
-- Rules (owner decision, 28 September 2026: prove cleanup, do not assume it;
-- docs/retention.md: a missing object, empty response or lost acknowledgement
-- remains unresolved):
--   * Nothing is claimed for disposal until the session's writes are
--     `settled` (20260928100000), which is after `fence_at`.
--   * R2, landed or uncertain: the exact registered key gets a permanent empty
--     marker through the fragment gateway, which reads it back to EOF. The
--     acknowledgement must carry that exact marker identity. The marker proves
--     the current payload is gone and the key is fenced against any late
--     create-only write. It is not key absence or physical erasure.
--   * Supabase, landed: the exact object id and version are deleted through
--     the Storage API. The acknowledgement must carry that exact identity and
--     no metadata row may remain under the id or the name. A landed object whose
--     metadata is already gone cannot be claimed: it stays unresolved.
--   * Supabase, uncertain: no evidence can prove absence, so it is never
--     claimed and its unwind stays `storage_pending`.
--   * `storage_confirmed` needs every inventory row proved by an exact
--     acknowledgement. A trigger enforces this, for every writer.
-- Lock order: session (through settle), then unwind, then inventory rows,
-- then disposal rows, then storage.objects rows.

-- The inventory may now name the embryo fragment bucket, and say tombstoned.
alter table public.embryo_ingest_delete_objects
  drop constraint embryo_ingest_delete_objects_bucket_id_check,
  add constraint embryo_ingest_delete_objects_bucket_id_check check (
    bucket_id in ('genomes','genomes-staging','generated-artifacts','legal-evidence')
    or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$'),
  drop constraint embryo_ingest_delete_objects_state_check,
  add constraint embryo_ingest_delete_objects_state_check check (
    state in ('pending','deleted','tombstoned','missing'));

-- Only definer code writes the unwind and its inventory. The service role
-- keeps reading them; it can no longer mark an object disposed directly.
revoke insert,update,delete,truncate,references,trigger on public.embryo_ingest_unwinds,
  public.embryo_ingest_delete_objects from service_role;

-- D-130, and the R2 location: an ingest fragment is inventoried where its write
-- intent says it lives, and an upload-staging object under its recorded bucket.
-- Everything else is 20260905203457's body unchanged.
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
revoke all on function public.prepare_embryo_ingest_unwind_v1(uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_embryo_ingest_unwind_v1(uuid,bigint) to service_role;

-- One row per claimed inventory object: what exactly was claimed, and the
-- provider evidence that disposed of it. Written only by definer code.
create table private.embryo_ingest_object_disposals (
  unwind_id uuid not null,
  ordinal bigint not null,
  backend text not null check (backend in ('supabase','r2')),
  bucket_id text not null,
  object_name text not null,
  session_id uuid not null,
  sequence integer not null,
  sample_ordinal smallint not null,
  intent_state text not null check (intent_state in ('landed','uncertain')),
  byte_count integer not null check (byte_count > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_id uuid,
  storage_version text check (storage_version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  provider_version text check (provider_version ~ '^[0-9a-f]{32}$'),
  provider_etag text check (provider_etag ~ '^[0-9a-f]{32}$'),
  state text not null default 'claimed' check (state in ('claimed','disposed')),
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  claim_expires_at timestamptz not null,
  first_claimed_at timestamptz not null,
  evidence jsonb check (evidence is null or (jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=2048)),
  disposed_at timestamptz,
  primary key (unwind_id, ordinal),
  foreign key (unwind_id, ordinal)
    references public.embryo_ingest_delete_objects(unwind_id, ordinal) on delete restrict,
  check ((state='disposed') = (evidence is not null and disposed_at is not null)),
  check (backend<>'supabase' or (intent_state='landed' and bucket_id='genomes'
    and storage_object_id is not null and storage_version is not null
    and provider_version is null and provider_etag is null)),
  check (backend<>'r2' or (bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$'
    and storage_object_id is null and storage_version is null
    and (intent_state='landed') = (provider_version is not null)
    and (intent_state='landed') = (provider_etag is not null)))
);
alter table private.embryo_ingest_object_disposals enable row level security;
revoke all on private.embryo_ingest_object_disposals from public,anon,authenticated,inherit_upload_only,service_role;
insert into public.purge_target_stores(target_id,store_name,store_order)
  select 'upload-and-ingest-working-state','private.embryo_ingest_object_disposals',coalesce(max(store_order),0)+1
  from public.purge_target_stores where target_id='upload-and-ingest-working-state';

-- The claimed identity is frozen. A claim may be renewed only while claimed;
-- a disposal is final.
create function private.freeze_embryo_ingest_object_disposal_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['state','claim_hash','claim_expires_at','evidence','disposed_at'])
      is distinct from (to_jsonb(old)-array['state','claim_hash','claim_expires_at','evidence','disposed_at'])
    or old.state='disposed' then
    raise exception using errcode='55000',message='immutable embryo disposal';
  end if;
  return new;
end $$;
create trigger embryo_ingest_object_disposal_identity before update on private.embryo_ingest_object_disposals
  for each row execute function private.freeze_embryo_ingest_object_disposal_v1();

-- What the executor is told to dispose of. A new claim changes claimExpiresAt,
-- so an older receipt can never finish.
create function private.embryo_ingest_disposal_receipt_v1(d private.embryo_ingest_object_disposals)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version','embryo-ingest-object-disposal-v1','unwindId',d.unwind_id,
    'ordinal',d.ordinal,'backend',d.backend,
    'operation',case d.backend when 'r2' then 'tombstone' else 'delete' end,
    'bucket',d.bucket_id,'objectKey',d.object_name,'byteCount',d.byte_count,'sha256',d.sha256,
    'claimExpiresAt',d.claim_expires_at)
    ||case d.backend when 'supabase' then jsonb_build_object('storageObjectId',d.storage_object_id,
      'storageVersion',d.storage_version) else '{}'::jsonb end;
$$;

-- The only evidence that disposes of an object. R2: the gateway's verified
-- empty marker at the exact key, as a version other than the landed payload.
-- Supabase: the Storage API's own DELETE result for the exact id and version.
create function private.embryo_ingest_disposal_evidence_ok_v1(d private.embryo_ingest_object_disposals,p_evidence jsonb)
returns boolean language sql immutable set search_path='' as $$
  select case d.backend
    when 'supabase' then p_evidence is not distinct from jsonb_build_object(
      'version','embryo-ingest-object-delete-evidence-v1','provider','supabase','disposition','object-deleted',
      'objectId',d.storage_object_id,'bucket',d.bucket_id,'objectKey',d.object_name,
      'storageVersion',d.storage_version,'byteCount',d.byte_count)
    else coalesce(jsonb_typeof(p_evidence)='object'
      and (select array_agg(k order by k) from jsonb_object_keys(p_evidence) k)
        = array['bucket','byteCount','disposition','etag','objectKey','provider','providerVersion','sha256','version']
      and p_evidence->>'version'='embryo-ingest-object-tombstone-evidence-v1'
      and p_evidence->>'provider'='r2' and p_evidence->>'disposition'='payload-tombstoned'
      and p_evidence->'bucket'=to_jsonb(d.bucket_id) and p_evidence->'objectKey'=to_jsonb(d.object_name)
      and jsonb_typeof(p_evidence->'providerVersion')='string'
      and p_evidence->>'providerVersion' ~ '^[0-9a-f]{32}$'
      and p_evidence->>'providerVersion' is distinct from d.provider_version
      and p_evidence->'etag'=to_jsonb('d41d8cd98f00b204e9800998ecf8427e'::text)
      and p_evidence->'byteCount'='0'::jsonb
      and p_evidence->'sha256'=to_jsonb('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::text),false)
  end;
$$;

-- What still stands between an unwind and storage_confirmed.
create function private.embryo_ingest_unwind_unresolved_v1(p_unwind_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with u as (select * from public.embryo_ingest_unwinds where id=p_unwind_id),
  rows as (
    select o.*, d.state disposal_state, d.backend disposal_backend, i.backend intent_backend, i.state intent_state
      from public.embryo_ingest_delete_objects o
      left join private.embryo_ingest_object_disposals d on d.unwind_id=o.unwind_id and d.ordinal=o.ordinal
      left join public.embryo_ingest_fragments f on o.source_kind='ingest-fragment'
        and f.session_id=(select session_id from u) and f.object_id=o.source_id
      left join private.embryo_ingest_write_intents i on i.session_id=f.session_id
        and i.sequence=f.sequence and i.sample_ordinal=f.sample_ordinal
      where o.unwind_id=p_unwind_id)
  select jsonb_build_object(
    'disposed',(select count(*) from rows where state in ('deleted','tombstoned') and disposal_state='disposed'
      and disposal_backend=case state when 'tombstoned' then 'r2' else 'supabase' end),
    -- Null-safe: a fragment row whose intent cannot be joined stays pending.
    'pending',(select count(*) from rows where state='pending' and source_kind='ingest-fragment'
      and not coalesce(intent_backend='supabase' and intent_state='uncertain',false)),
    'supabaseUncertain',(select count(*) from rows where state='pending' and source_kind='ingest-fragment'
      and coalesce(intent_backend='supabase' and intent_state='uncertain',false)),
    'unsupported',(select count(*) from rows where state='pending' and source_kind<>'ingest-fragment'),
    'unproved',(select count(*) from rows where state='missing' or (state in ('deleted','tombstoned')
      and (disposal_state is distinct from 'disposed'
        or disposal_backend is distinct from case state when 'tombstoned' then 'r2' else 'supabase' end))),
    'uninventoried',(select count(*) from public.embryo_ingest_fragments f where f.session_id=(select session_id from u)
      and not exists(select 1 from rows r where r.source_kind='ingest-fragment' and r.source_id=f.object_id)),
    'unsettled',(select count(*) from u where u.session_id is not null and not exists(
      select 1 from private.embryo_ingest_write_fences w where w.session_id=u.session_id and w.settled_at is not null)));
$$;
create function private.embryo_ingest_unwind_unresolved_count_v1(p_unwind_id uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select sum(value::bigint) from jsonb_each_text(private.embryo_ingest_unwind_unresolved_v1(p_unwind_id)-'disposed');
$$;

-- Structural rules, whoever writes. An inventory row leaves `pending` only for
-- the state its exact disposal proves, and never for `missing`. It is kept
-- until its unwind is storage_confirmed.
create function private.guard_embryo_ingest_inventory_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
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
create trigger embryo_ingest_inventory_disposal before update or delete on public.embryo_ingest_delete_objects
  for each row execute function private.guard_embryo_ingest_inventory_v1();

-- The unwind moves only forward, and storage_confirmed needs a settled drain
-- and nothing unresolved.
create function private.guard_embryo_ingest_unwind_state_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
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
create trigger embryo_ingest_unwind_state_order before update on public.embryo_ingest_unwinds
  for each row execute function private.guard_embryo_ingest_unwind_state_v1();

-- Claim up to 25 disposable inventory objects of one unwind. Settles the
-- drain first and claims nothing before it is `settled`.
create function private.claim_embryo_ingest_object_disposals_v1(p_unwind_id uuid,p_claim_token_hash text)
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
  for r in select o.ordinal,o.bucket_id,o.object_name,i.backend,i.state intent_state,i.byte_count,i.sha256,
      i.storage_object_id,i.storage_version,i.provider_version,i.provider_etag,
      i.session_id,i.sequence,i.sample_ordinal
    from public.embryo_ingest_delete_objects o
    join public.embryo_ingest_fragments f on f.session_id=u.session_id and f.object_id=o.source_id
    join private.embryo_ingest_write_intents i on i.session_id=f.session_id and i.sequence=f.sequence
      and i.sample_ordinal=f.sample_ordinal
    where o.unwind_id=u.id and o.state='pending' and o.source_kind='ingest-fragment'
      and o.bucket_id=i.provider_bucket and o.object_name=i.provider_key
      and i.state in ('landed','uncertain') and (i.backend='r2' or i.state='landed')
    order by o.ordinal for update of o
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

-- Record one exact disposal. An exact replay of a recorded disposal returns
-- the same answer; anything else that does not match is refused.
create function private.finish_embryo_ingest_object_disposal_v1(p_unwind_id uuid,p_ordinal bigint,
  p_claim_token_hash text,p_expected jsonb,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.embryo_ingest_unwinds%rowtype; o public.embryo_ingest_delete_objects%rowtype;
  d private.embryo_ingest_object_disposals%rowtype; v_state text;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' or p_ordinal is null
    or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>2048
    or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>2048 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  select * into u from public.embryo_ingest_unwinds where id=p_unwind_id for share;
  if not found then raise exception using errcode='42501',message='embryo_unwind_unavailable'; end if;
  select * into o from public.embryo_ingest_delete_objects where unwind_id=u.id and ordinal=p_ordinal for update;
  if not found then raise exception using errcode='42501',message='embryo_unwind_unavailable'; end if;
  select * into d from private.embryo_ingest_object_disposals where unwind_id=u.id and ordinal=p_ordinal for update;
  if not found then raise exception using errcode='42501',message='embryo_unwind_unavailable'; end if;
  v_state:=case d.backend when 'r2' then 'tombstoned' else 'deleted' end;
  if d.state='disposed' then
    if d.claim_hash=p_claim_token_hash and d.evidence=p_evidence
      and private.embryo_ingest_disposal_receipt_v1(d)=p_expected then
      return jsonb_build_object('status','disposed','unwindId',u.id,'ordinal',o.ordinal,'state',o.state);
    end if;
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  if u.state<>'storage_pending' or o.state<>'pending' or d.claim_hash<>p_claim_token_hash
    or d.claim_expires_at<=clock_timestamp()
    or private.embryo_ingest_disposal_receipt_v1(d) is distinct from p_expected
    or (o.bucket_id,o.object_name) is distinct from (d.bucket_id,d.object_name) then
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  -- Supabase: a DELETE result is accepted only once no metadata row remains
  -- under the id or the name, in any version the schema can hold.
  if d.backend='supabase' and exists(select 1 from storage.objects so
      where so.id=d.storage_object_id or (so.bucket_id=d.bucket_id and so.name=d.object_name)) then
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  if not private.embryo_ingest_disposal_evidence_ok_v1(d,p_evidence) then
    raise exception using errcode='22023',message='invalid_disposal_evidence';
  end if;
  update private.embryo_ingest_object_disposals set state='disposed',evidence=p_evidence,
    disposed_at=clock_timestamp() where unwind_id=u.id and ordinal=p_ordinal;
  update public.embryo_ingest_delete_objects set state=v_state,acknowledged_at=clock_timestamp()
    where unwind_id=u.id and ordinal=p_ordinal;
  if d.claim_expires_at<=clock_timestamp() then
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  return jsonb_build_object('status','disposed','unwindId',u.id,'ordinal',o.ordinal,'state',v_state);
end $$;

-- storage_confirmed once nothing is unresolved; otherwise report what is.
create function private.confirm_embryo_ingest_unwind_storage_v1(p_unwind_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.embryo_ingest_unwinds%rowtype; v_settle jsonb; v_unresolved jsonb;
begin
  select * into u from public.embryo_ingest_unwinds where id=p_unwind_id;
  if not found or (u.session_id is null and u.state<>'complete') then
    raise exception using errcode='42501',message='embryo_unwind_unavailable';
  end if;
  if u.state in ('storage_confirmed','complete') then
    return jsonb_build_object('status',u.state,'storageConfirmedAt',u.storage_confirmed_at);
  end if;
  v_settle:=private.settle_embryo_ingest_writes_v1(u.session_id);
  if v_settle->>'status' is distinct from 'settled' then
    return jsonb_build_object('status','storage_pending','drain',v_settle->>'status');
  end if;
  select * into u from public.embryo_ingest_unwinds where id=p_unwind_id for update;
  if u.state<>'storage_pending' then return jsonb_build_object('status',u.state); end if;
  v_unresolved:=private.embryo_ingest_unwind_unresolved_v1(u.id);
  if private.embryo_ingest_unwind_unresolved_count_v1(u.id)<>0 then
    return jsonb_build_object('status','storage_pending','unresolved',v_unresolved);
  end if;
  update public.embryo_ingest_unwinds set state='storage_confirmed',storage_confirmed_at=clock_timestamp()
    where id=u.id returning * into u;
  return jsonb_build_object('status','storage_confirmed','storageConfirmedAt',u.storage_confirmed_at,
    'disposed',v_unresolved->'disposed');
end $$;

create function public.claim_embryo_ingest_object_disposals_v1(p_unwind_id uuid,p_claim_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.claim_embryo_ingest_object_disposals_v1(p_unwind_id,p_claim_token_hash);
$$;
create function public.finish_embryo_ingest_object_disposal_v1(p_unwind_id uuid,p_ordinal bigint,
  p_claim_token_hash text,p_expected jsonb,p_evidence jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.finish_embryo_ingest_object_disposal_v1(p_unwind_id,p_ordinal,p_claim_token_hash,p_expected,p_evidence);
$$;
create function public.confirm_embryo_ingest_unwind_storage_v1(p_unwind_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.confirm_embryo_ingest_unwind_storage_v1(p_unwind_id);
$$;

revoke all on function private.claim_embryo_ingest_object_disposals_v1(uuid,text),
  private.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb),
  private.confirm_embryo_ingest_unwind_storage_v1(uuid),
  public.claim_embryo_ingest_object_disposals_v1(uuid,text),
  public.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb),
  public.confirm_embryo_ingest_unwind_storage_v1(uuid)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.claim_embryo_ingest_object_disposals_v1(uuid,text),
  private.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb),
  private.confirm_embryo_ingest_unwind_storage_v1(uuid),
  public.claim_embryo_ingest_object_disposals_v1(uuid,text),
  public.finish_embryo_ingest_object_disposal_v1(uuid,bigint,text,jsonb,jsonb),
  public.confirm_embryo_ingest_unwind_storage_v1(uuid)
  to service_role;
revoke all on function private.freeze_embryo_ingest_object_disposal_v1(),
  private.embryo_ingest_disposal_receipt_v1(private.embryo_ingest_object_disposals),
  private.embryo_ingest_disposal_evidence_ok_v1(private.embryo_ingest_object_disposals,jsonb),
  private.embryo_ingest_unwind_unresolved_v1(uuid),
  private.embryo_ingest_unwind_unresolved_count_v1(uuid),
  private.guard_embryo_ingest_inventory_v1(),
  private.guard_embryo_ingest_unwind_state_v1()
  from public,anon,authenticated,inherit_upload_only,service_role;

-- Still missing before any route accepts embryo bytes: the terminal graph
-- purge, the gateway deployment and a selected backend.
notify pgrst,'reload schema';
