-- D-126, owner decision of 2026-09-18: `source.revocation-7d` is folded into
-- immediate deletion through the existing paths. The class was registered on
-- 2026-08-31 under `revocationDispositionWorker`, a worker that was never
-- built: no phase, claim, finish or job step ever executed it. The deletions
-- it names already run in the triggering request or transaction (self file
-- deletion, cohort restriction's derived rows, account deletion's purge), and
-- the register wording becomes "immediately, and within 7 days at the latest".
--
-- Part 1 reclassifies the registry row and refuses to run if the row is not
-- exactly there. Part 2 adds the seven-day backstop that the wording still
-- needed: a self file deletion whose Storage removal or database finish failed
-- leaves a private.genome_file_deletions row behind with the file already
-- unreadable, and nothing retried it. The retention job may now claim such a
-- row after a retry delay under a claim token, redo the same Storage removal
-- and finish under that claim instead of the owner's Auth session. Every
-- identity, shared-graph, provider-acknowledgement and storage.objects-absence
-- check is the same code: the owner-facing functions keep their contracts and
-- call the shared bodies below.
--
-- Not in this migration: the guard proposed with the decision that would refuse
-- own_preparation_config.enabled with artifact_provider 'supabase' (a
-- Supabase-provider prepared artifact has no cleanup capability and would keep
-- a deletion pending). Seven pgTAP files enable that provider and assert its
-- path, so the guard is recorded on D-126 rather than added here.

do $$
declare n integer;
begin
  update public.retention_registry
    set execution_class = 'inlineEventDriven'
    where retention_id = 'source.revocation-7d';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception using errcode = '55000', message = 'source_revocation_registry_row_missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seven-day backstop for a stranded self file deletion.
-- ---------------------------------------------------------------------------

alter table private.genome_file_deletions
  add column claim_token_hash text check (claim_token_hash ~ '^[0-9a-f]{64}$'),
  add column claim_expires_at timestamptz,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_attempt_at timestamptz,
  add constraint genome_file_deletions_claim_pair
    check ((claim_token_hash is null) = (claim_expires_at is null));

-- The owner path's prepare body, unchanged, without its Auth-session check.
-- Locks account, subject, then source; refuses every graph the file shortcut
-- may not remove; freezes the file and records the exact Storage target.
create function private.prepare_genome_file_deletion_body_v1(
  p_account_id uuid, p_file_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.genome_files%rowtype;
  s public.subjects%rowtype;
  d private.genome_file_deletions%rowtype;
begin
  -- Match canonical model/read locks: account, subject, then source.
  perform 1 from public.profiles where id=p_account_id for update;
  perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=p_file_id and user_id=p_account_id) for update;
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for update;
  if f.id is null then
    raise exception using errcode='P0002', message='file_delete_not_found';
  end if;
  select * into s from public.subjects where id=f.subject_id for update;
  if s.subject_class is distinct from 'self' or s.owner_account_id is distinct from p_account_id
    or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' or f.cohort_id is not null then
    raise exception using errcode='55000', message='file_delete_subject_unavailable';
  end if;
  -- These graph cases need their existing subject-level disposition, not a
  -- file shortcut that might remove another adult's shared working data.
  if exists (select 1 from public.family_pairs where subject_a_id=s.id or subject_b_id=s.id)
    or exists (select 1 from public.subject_relationships where subject_id=s.id
      and status='current' and recipient_account_id is distinct from p_account_id)
    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)
    or exists (select 1 from public.report_artifacts where subject_id=s.id)
    or exists (select 1 from public.embryo_variants where source_file_id=f.id)
    or exists (select 1 from public.chats c where c.user_id=p_account_id and c.subject_id=s.id
      and (c.canonical_authority is null or c.legacy_unverified is not false)
      and private.is_unattributed_legacy_file_chat_v1(c.id,p_account_id,s.id) is not true)
    or exists (select 1 from public.chat_messages cm join public.chats c on c.id=cm.chat_id
      where cm.user_id=p_account_id and c.subject_id=s.id
      and (cm.canonical_projection is null or cm.legacy_unverified is not false)
      and private.is_unattributed_legacy_file_chat_v1(c.id,p_account_id,s.id) is not true) then
    raise exception using errcode='55000', message='file_delete_shared_graph';
  end if;
  if f.status in ('uploading','parsing','parsed') or exists (
    select 1 from public.worker_jobs where file_id=f.id and status in ('queued','running')
  ) then
    raise exception using errcode='55000', message='file_delete_processing';
  end if;
  if exists (select 1 from public.genome_files where id<>f.id and bucket_path=f.bucket_path)
    or (f.storage_object_id is null and f.bucket_path not like p_account_id::text||'/%')
    or (f.storage_object_id is not null and not exists (
      select 1 from public.genome_storage_objects where object_id=f.storage_object_id
      and genome_file_id=f.id and cohort_id is null and bucket_id='genomes' and object_name=f.bucket_path
    )) or exists (select 1 from public.genome_storage_objects where genome_file_id=f.id
      and (object_id is distinct from f.storage_object_id or bucket_id<>'genomes' or object_name<>f.bucket_path)) then
    raise exception using errcode='55000', message='file_delete_identity_mismatch';
  end if;
  select * into d from private.genome_file_deletions where file_id=f.id;
  if d.file_id is null then
    -- Persist the unreadable/retryable state before freezing subsequent updates.
    update public.genome_files set status='failed', error='File deletion is pending. Try Delete again.' where id=f.id;
    insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
      values(f.id,p_account_id,'genomes',f.bucket_path) returning * into d;
    update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())
      where genome_file_id=f.id;
  end if;
  update public.mail_outbox set state='invalidated', claimed_at=null,
    last_outcome_code='file_target_unavailable'
  where template_id='report-ready' and target_kind='genome_file'
    and target_id=f.id and state in ('queued','claimed');
  return jsonb_build_object('token',d.token,'bucket',d.bucket_id,'name',d.object_name);
end;
$$;

-- The owner path's finish body, unchanged: exact token, Storage metadata
-- absence, frozen chat manifest, then the file graph in the existing order.
create function private.finish_genome_file_deletion_body_v1(
  p_account_id uuid, p_file_id uuid, p_token uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  select * into d from private.genome_file_deletions where file_id=p_file_id and account_id=p_account_id for update;
  if d.token is distinct from p_token then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  -- Callers reach this only after Storage.remove acknowledged success. This
  -- independent metadata check also refuses a direct premature finish call.
  if exists (select 1 from storage.objects where bucket_id=d.bucket_id and name=d.object_name) then
    raise exception using errcode='55000', message='file_delete_storage_incomplete';
  end if;
  delete from public.chat_messages m using public.chats c,jsonb_array_elements(d.canonical_chat_manifest) e
  where m.id=(e->>'id')::uuid and m.chat_id=(e->>'chatId')::uuid and m.turn_id=(e->>'turnId')::uuid
   and m.user_id=p_account_id and c.id=m.chat_id and c.user_id=p_account_id and c.scope_kind='self'
   and c.subject_id=(select subject_id from public.genome_files where id=p_file_id)
   and c.legacy_unverified is false and c.canonical_authority is not null and m.legacy_unverified is false
   and encode(extensions.digest(convert_to(m.canonical_projection::text,'UTF8'),'sha256'),'hex')=e->>'projectionHash';
  if exists(select 1 from public.chat_messages m join jsonb_array_elements(d.canonical_chat_manifest) e on m.id=(e->>'id')::uuid) then
   raise exception using errcode='55000',message='file_delete_chat_residuals'; end if;
  delete from public.download_sessions where object_id in (
    select object_id from public.genome_storage_objects where genome_file_id=p_file_id
  );
  delete from public.analysis_jobs where worker_job_id in (select id from public.worker_jobs where file_id=p_file_id);
  delete from public.worker_jobs where file_id=p_file_id;
  set constraints public.genome_files_storage_object_fk deferred;
  delete from public.genome_storage_objects where genome_file_id=p_file_id;
  delete from public.genome_files where id=p_file_id and user_id=p_account_id;
end;
$$;

-- The owner-facing contracts are unchanged: an Auth session of the owner,
-- then the shared body. Grants and revokes survive CREATE OR REPLACE and are
-- restated below for reading.
create or replace function public.prepare_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.sessions where id=p_session_id and user_id=p_account_id
    and (not_after is null or not_after>clock_timestamp())) then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  return private.prepare_genome_file_deletion_body_v1(p_account_id,p_file_id);
end;
$$;

create or replace function public.finish_genome_file_deletion_v1(
  p_account_id uuid, p_session_id uuid, p_file_id uuid, p_token uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Recheck authority, exact bindings and unsupported graph additions.
  perform public.prepare_genome_file_deletion_v1(p_account_id,p_session_id,p_file_id);
  perform private.finish_genome_file_deletion_body_v1(p_account_id,p_file_id,p_token);
end;
$$;

-- A claim stands in for the owner's Auth session and nothing else. The lock
-- order is the owner path's (account, subject, source) before the deletion
-- record, so a claimed retry and an owner retry serialize the same way.
create function private.authorize_genome_file_deletion_claim_v1(
  p_file_id uuid, p_claim_token_hash text
) returns private.genome_file_deletions language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='invalid_retention_claim';
  end if;
  select * into d from private.genome_file_deletions where file_id=p_file_id;
  if d.file_id is null then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  perform 1 from public.profiles where id=d.account_id for update;
  perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=p_file_id and user_id=d.account_id) for update;
  perform 1 from public.genome_files where id=p_file_id and user_id=d.account_id for update;
  select * into d from private.genome_file_deletions where file_id=p_file_id for update;
  if d.file_id is null or d.claim_token_hash is distinct from p_claim_token_hash
    or d.claim_expires_at is null or d.claim_expires_at<=clock_timestamp() then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  return d;
end;
$$;

-- Database-selected due work: one stranded record per claim, none younger than
-- the retry delay measured from its start or its last attempt, none under a
-- live claim. A record the owner or another worker holds is skipped, never
-- waited on. The caller supplies no target; the row's own bucket and name come
-- back so the same Storage removal can be redone.
create function public.claim_due_genome_file_deletion_v1(
  p_claim_token_hash text, p_retry_after interval default interval '15 minutes'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  d private.genome_file_deletions%rowtype;
  f public.genome_files%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='invalid_retention_claim';
  end if;
  if p_retry_after is null or p_retry_after < interval '1 minute' or p_retry_after > interval '7 days' then
    raise exception using errcode='22023', message='invalid_retention_claim';
  end if;
  for candidate in
    select x.file_id, x.account_id from private.genome_file_deletions x
    where greatest(x.started_at, coalesce(x.last_attempt_at, x.started_at)) <= v_now - p_retry_after
      and (x.claim_expires_at is null or x.claim_expires_at <= v_now)
    order by x.started_at, x.file_id limit 5
  loop
    perform 1 from public.profiles where id=candidate.account_id for update;
    perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=candidate.file_id and user_id=candidate.account_id) for update;
    select * into f from public.genome_files where id=candidate.file_id and user_id=candidate.account_id for update;
    if f.id is null then continue; end if;
    select * into d from private.genome_file_deletions where file_id=candidate.file_id for update skip locked;
    if d.file_id is null or (d.claim_expires_at is not null and d.claim_expires_at > v_now)
      or greatest(d.started_at, coalesce(d.last_attempt_at, d.started_at)) > v_now - p_retry_after then
      continue;
    end if;
    update private.genome_file_deletions
      set claim_token_hash=p_claim_token_hash, claim_expires_at=v_now + interval '5 minutes',
          attempts=least(attempts+1,20), last_attempt_at=v_now
      where file_id=d.file_id returning * into d;
    return jsonb_build_object('version','genome-file-deletion-claim-v1','fileId',d.file_id,
      'bucket',d.bucket_id,'name',d.object_name,'claimExpiresAt',d.claim_expires_at);
  end loop;
  return null;
end;
$$;

-- The claimed twin of prepare_own_prepared_file_cleanup_v1: the same Auth-first
-- share locks, the same prepare body, the same prepared-artifact cleanup
-- selection in 'file' mode under the record's own token, the same plan shape.
create function public.prepare_own_prepared_file_cleanup_claimed_v1(
  p_file_id uuid, p_claim_token_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
  original jsonb;
  j uuid;
  cleanup uuid;
begin
  select * into d from private.genome_file_deletions where file_id=p_file_id;
  if d.file_id is null then
    raise exception using errcode='42501', message='file_delete_unauthorized';
  end if;
  perform 1 from auth.users where id=d.account_id for share;
  perform 1 from auth.sessions where user_id=d.account_id order by id for share;
  d := private.authorize_genome_file_deletion_claim_v1(p_file_id,p_claim_token_hash);
  original := private.prepare_genome_file_deletion_body_v1(d.account_id,p_file_id);
  select id into j from private.own_preparation_jobs where file_id=p_file_id and account_id=d.account_id;
  if j is not null then
    cleanup := private.prepare_own_prepared_cleanup_v1(j,'file',(original->>'token')::uuid);
  end if;
  return jsonb_build_object('version','own-prepared-file-cleanup-v1','original',original,
    'cleanupId',cleanup,'preparedComplete',j is null);
end;
$$;

-- The claimed twin of finish_genome_file_deletion_v1: claim in place of the
-- Auth session, then the same recheck and the same finish body with the
-- record's own token.
create function public.finish_genome_file_deletion_claimed_v1(
  p_file_id uuid, p_claim_token_hash text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  d := private.authorize_genome_file_deletion_claim_v1(p_file_id,p_claim_token_hash);
  -- Recheck authority, exact bindings and unsupported graph additions.
  perform private.prepare_genome_file_deletion_body_v1(d.account_id,p_file_id);
  perform private.finish_genome_file_deletion_body_v1(d.account_id,p_file_id,d.token);
end;
$$;

-- Release a claim whose Storage removal or finish did not complete. The last
-- attempt time stays, so the record waits the retry delay before the next
-- claim; the file stays unreadable throughout.
create function public.fail_genome_file_deletion_claim_v1(
  p_file_id uuid, p_claim_token_hash text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  d private.genome_file_deletions%rowtype;
begin
  d := private.authorize_genome_file_deletion_claim_v1(p_file_id,p_claim_token_hash);
  update private.genome_file_deletions set claim_token_hash=null, claim_expires_at=null where file_id=d.file_id;
end;
$$;

revoke all on function private.prepare_genome_file_deletion_body_v1(uuid,uuid),
  private.finish_genome_file_deletion_body_v1(uuid,uuid,uuid),
  private.authorize_genome_file_deletion_claim_v1(uuid,text)
  from public, anon, authenticated, inherit_upload_only, service_role;
revoke all on function public.prepare_genome_file_deletion_v1(uuid,uuid,uuid),
  public.finish_genome_file_deletion_v1(uuid,uuid,uuid,uuid),
  public.claim_due_genome_file_deletion_v1(text,interval),
  public.prepare_own_prepared_file_cleanup_claimed_v1(uuid,text),
  public.finish_genome_file_deletion_claimed_v1(uuid,text),
  public.fail_genome_file_deletion_claim_v1(uuid,text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.prepare_genome_file_deletion_v1(uuid,uuid,uuid),
  public.finish_genome_file_deletion_v1(uuid,uuid,uuid,uuid),
  public.claim_due_genome_file_deletion_v1(text,interval),
  public.prepare_own_prepared_file_cleanup_claimed_v1(uuid,text),
  public.finish_genome_file_deletion_claimed_v1(uuid,text),
  public.fail_genome_file_deletion_claim_v1(uuid,text)
  to service_role;
