-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Path B is TEST-LOCAL only, and the transfer door is
-- built closed: no jurisdiction, capability or rate limit is opened here.
-- =====================================================================
--
-- api.subject-transfer: POST /api/subjects/[id]/transfer (owner decisions
-- 2026-10-16, "The subjects endpoints (G2.1)" and "Subjects delete and
-- transfer: four further cases"; the 2026-10-22 rule for routes that need
-- wording nobody has approved; docs/protocol/decisions.md). The register's
-- contract is lifecycleDispositionContracts.subject-ownership-transfer-v1
-- and workerExecutionBindings.subject-object-relocation.
--
-- BUILT CLOSED. The contract names three notices (to the new owner, the
-- former owning account and every principal whose access is revoked), and
-- none has approved wording. Under the 2026-10-22 rule the door,
-- public.transfer_subject_v1, answers resource-not-found and writes nothing
-- until that wording is approved: private.subject_transfer_open_v1() is the
-- one switch. Everything behind it is built and tested directly. Nothing is
-- mailed.
--
-- What a transfer does, in one transaction, for a Path B record (either
-- flow) whose verified person account is the caller:
--
--   1. Ownership. The record stays a separate other_adult record, now owned
--      by the person (owner_account_id = subject_account_id). The ownership
--      check, subjects_self_or_claimant_owner_shape, is widened for exactly
--      that shape, marked by subjects.ownership_transferred_at. Original
--      consents, signatures, drafts and the audit trail are kept as they
--      are, and no upload is merged into the person's own record.
--   2. Files. The transfer is refused, with nothing written, while any Path
--      B file on the record is still pending, or while an upload into it is
--      being validated. Each confirmed file revision is detached into a
--      person-owned file: its genome_files row (made by normalization, with
--      the revision's id) is rebound to the person, or one is made. The
--      revision ends as 'transferred'. One idempotent relocation row per
--      object records its id, version, size and SHA-256, and the old and
--      new owners. The worker (workerExecutionBindings.subject-object-
--      relocation) copies it to a fresh flat <uuid> key, verifies every
--      byte, swaps the file's reference in one transaction, then deletes
--      the old object. Until then the new owner is authorized through the
--      database reference, which still names the old key.
--   3. Results. Completed saved results whose recipient is the person stay,
--      readable under the person's own current grants through the existing
--      Path B readers. Every other saved result, queued or running report
--      and former-owner job is removed or cancelled. No new analysis runs:
--      every Path B analysis door checks that the uploader owns the record,
--      and a transferred record has no other analysis path yet.
--   4. The uploader loses all access in the same transaction: every grant
--      and relationship that names another recipient is revoked, and their
--      upload, download, rights and export credentials end. Chats are never
--      reassigned: every chat about the record that the person does not own
--      is deleted with its model working state, and every other turn that
--      retrieved the record is removed through the existing helper.
--   5. Audit: one subject.ownership_transferred event, with no raw contact
--      or token.
--
-- After a transfer the person deletes the record through api.subject-delete's
-- adult case: each person-owned file goes through the file deletion pipeline
-- and its backstop, relocations still waiting are cancelled, and the rest is
-- the existing Path B delete by the person, with the refusal bar.

do $predecessor$
begin
 if to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)') is null
  or to_regprocedure('private.delete_path_b_subject_for_route_v1(uuid,text)') is null
  or to_regprocedure('private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)') is null
  or to_regprocedure('private.path_b_account_current_v1(uuid)') is null
  or to_regprocedure('private.path_b_report_authority_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regprocedure('private.file_claimant_transition_matches_v1(public.genome_files,public.genome_files)') is null
  or to_regclass('private.path_b_report_bindings') is null
  or to_regclass('private.genome_file_deletions') is null then
  raise exception using errcode='55000',message='subject transfer prerequisite missing'; end if;
 if to_regprocedure('public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regclass('private.subject_ownership_transfers') is not null
  or exists(select 1 from pg_attribute where attrelid='public.subjects'::regclass
   and attname='ownership_transferred_at' and not attisdropped) then
  raise exception using errcode='55000',message='subject transfer successor already exists'; end if;
end;
$predecessor$;

-- 1. The ownership check -------------------------------------------------------
alter table public.subjects add column ownership_transferred_at timestamptz;
alter table public.subjects add constraint subjects_ownership_transfer_shape
 check (ownership_transferred_at is null or (subject_class='other_adult' and upload_class='adult'));
alter table public.subjects drop constraint subjects_self_or_claimant_owner_shape;
alter table public.subjects add constraint subjects_self_or_claimant_owner_shape check (
 (subject_class='self'
  or (subject_class='embryo' and lifecycle='claimed_bound')
  or (subject_class='other_adult' and ownership_transferred_at is not null and lifecycle<>'purged'))
 = (owner_account_id is not null and owner_account_id=subject_account_id));

-- A detached revision ends as 'transferred'.
alter table public.other_adult_held_uploads drop constraint other_adult_held_uploads_state_check;
alter table public.other_adult_held_uploads add constraint other_adult_held_uploads_state_check
 check (state in ('pending','confirmed','refused','deleted','expired','withdrawn','transferred'));

-- The one-time code.
alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign',
  'own_account_completion','other_adult_upload_artifact_sign','subject_sharing_stop','subject_delete',
  'subject_transfer'));

do $patch_nonce$
declare target regprocedure:='private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$p_operation not in ('subject_sharing_stop','subject_delete')$old$;
 new_fragment text:=$new$p_operation not in ('subject_sharing_stop','subject_delete','subject_transfer')$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='8ca7925a33003ca56d0d96921ee35693';
 if definition is null then raise exception using errcode='55000',message='subject operation nonce predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='subject operation nonce anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='846078adb108ca24b140cc2f9febc627'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='subject operation nonce successor differs'; end if;
end;
$patch_nonce$;

-- 2. The transfer and relocation rows ---------------------------------------------
-- One immutable row per transfer: the worker's database authorization
-- (subject-object-relocation: one exact immutable transfer row, never an
-- account prefix). No foreign key names an account, so Auth cleanup is
-- never blocked by a record of who held the record before.
create table private.subject_ownership_transfers (
 id uuid primary key default gen_random_uuid(),
 transfer_revision bigint generated always as identity unique check (transfer_revision>0),
 subject_id uuid not null unique references public.subjects(id) on delete restrict,
 from_account_id uuid not null,
 to_account_id uuid not null,
 subject_lifecycle_revision bigint not null check (subject_lifecycle_revision>0),
 file_count integer not null check (file_count>=0),
 transferred_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current(),
 check (from_account_id<>to_account_id)
);
create function private.freeze_subject_ownership_transfer_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 raise exception using errcode='42501',message='subject ownership transfer is immutable';
end $$;
create trigger subject_ownership_transfer_immutable before update or delete on private.subject_ownership_transfers
 for each row execute function private.freeze_subject_ownership_transfer_v1();

-- One row per exact object. The new key is the attempt's own random id, a
-- fresh flat <uuid> key as live code uses (owner decision 2026-10-16).
create table private.subject_transfer_relocations (
 id uuid primary key default gen_random_uuid(),
 transfer_id uuid not null references private.subject_ownership_transfers(id) on delete restrict,
 subject_id uuid not null references public.subjects(id) on delete restrict,
 held_upload_id uuid not null unique,
 file_id uuid not null unique,
 old_owner_account_id uuid not null,
 new_owner_account_id uuid not null,
 bucket_id text not null default 'genomes' check (bucket_id='genomes'),
 old_object_id uuid not null,
 old_object_key text not null check (old_object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 old_object_version text,
 byte_count bigint not null check (byte_count>0),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'queued' check (state in ('queued','copying','swapped','complete','cancelled')),
 current_attempt_id uuid,
 new_object_id uuid,
 new_object_key text check (new_object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 attempts integer not null default 0 check (attempts between 0 and 1000),
 retire_claim_token_hash text check (retire_claim_token_hash ~ '^[0-9a-f]{64}$'),
 retire_claim_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 swapped_at timestamptz,
 swap_transaction_id bigint,
 completed_at timestamptz,
 cancelled_at timestamptz,
 check ((state='copying')=(current_attempt_id is not null)),
 check ((state in ('swapped','complete'))=(new_object_id is not null and new_object_key is not null
  and swapped_at is not null and swap_transaction_id is not null)),
 check ((state='complete')=(completed_at is not null)),
 check ((state='cancelled')=(cancelled_at is not null)),
 check (new_object_key is null or new_object_key<>old_object_key),
 check (old_owner_account_id<>new_owner_account_id)
);
create table private.subject_transfer_relocation_attempts (
 id uuid primary key default gen_random_uuid(),
 relocation_id uuid not null references private.subject_transfer_relocations(id) on delete restrict,
 state text not null default 'copying' check (state in ('copying','swapped','fenced','disposed')),
 claim_token_hash text check (claim_token_hash ~ '^[0-9a-f]{64}$'),
 claim_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,
 check ((state in ('copying','fenced'))=(claim_token_hash is not null and claim_expires_at is not null)
  or state='fenced'),
 check ((state in ('swapped','disposed'))=(ended_at is not null))
);
create unique index subject_transfer_relocation_one_copying_idx
 on private.subject_transfer_relocation_attempts(relocation_id) where state='copying';

do $tables$ declare table_name text; begin
 foreach table_name in array array['subject_ownership_transfers','subject_transfer_relocations',
  'subject_transfer_relocation_attempts'] loop
  execute format('alter table private.%I enable row level security', table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,inherit_upload_only', table_name);
 end loop;
end $tables$;
revoke all on function private.freeze_subject_ownership_transfer_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 3. The file identity guard -------------------------------------------------------
-- A verified file's identity is immutable, except the claimant transition
-- and now the two transfer transitions, each only inside the exact
-- transaction that recorded it:
--   * rebind: only user_id changes, from the transfer's former owner to its
--     new owner, in the transfer's own transaction;
--   * swap: only bucket_path and storage_object_id change, from the
--     relocation's old key (no own-file object yet) to its verified new key
--     and object, in the swap's own transaction.
create function private.file_transfer_transition_matches_v1(p_old public.genome_files,p_new public.genome_files)
returns boolean language sql stable security definer set search_path='' as $$
 select ((to_jsonb(p_new)-'user_id') is not distinct from (to_jsonb(p_old)-'user_id')
   and exists(select 1 from private.subject_ownership_transfers t
    join public.subjects s on s.id=t.subject_id
    where t.subject_id=(p_new).subject_id and t.transaction_id=txid_current()
     and (p_old).user_id=t.from_account_id and (p_new).user_id=t.to_account_id
     and s.owner_account_id=t.to_account_id and s.subject_account_id=t.to_account_id
     and s.ownership_transferred_at is not null))
  or ((to_jsonb(p_new)-'bucket_path'-'storage_object_id') is not distinct from (to_jsonb(p_old)-'bucket_path'-'storage_object_id')
   and exists(select 1 from private.subject_transfer_relocations r
    where r.file_id=(p_new).id and r.subject_id=(p_new).subject_id and r.state='swapped'
     and r.swap_transaction_id=txid_current() and (p_old).storage_object_id is null
     and (p_old).bucket_path=r.old_object_key and (p_new).bucket_path=r.new_object_key
     and (p_new).storage_object_id=r.new_object_id and (p_new).user_id=r.new_owner_account_id));
$$;
-- The trigger runs as its caller, so the matcher keeps the claimant
-- matcher's grant: the service role may evaluate it, and no API role may.
revoke all on function private.file_transfer_transition_matches_v1(public.genome_files,public.genome_files)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.file_transfer_transition_matches_v1(public.genome_files,public.genome_files) to service_role;

do $patch_guard$
declare target regprocedure:='private.guard_structural_file_identity_v1()'::regprocedure; before_acl aclitem[];
begin
 select proacl into before_acl from pg_proc where oid=target and md5(prosrc)='1081b5ccc70375acffe4f9d61bbce652'
  and not prosecdef and proconfig=array['search_path=pg_catalog']::text[];
 if not found then raise exception using errcode='55000',message='file identity guard predecessor differs'; end if;
 -- Current body (20260930233000) with the change marked "20261016221000".
 execute $definition$
create or replace function private.guard_structural_file_identity_v1()
 returns trigger language plpgsql set search_path to 'pg_catalog'
as $function$
begin
  if new.single_logical_sample_verified_at is not null
    and current_user not in('postgres','service_role','supabase_admin') then
    raise exception using errcode='42501',message='file_authority_required'; end if;
  if tg_op='UPDATE' and old.single_logical_sample_verified_at is not null
    and (new.user_id,new.subject_id,new.bucket_path,new.storage_object_id,new.size_bytes,new.sha256,
      new.source_sha256,new.structural_validator_version,new.single_logical_sample_verified_at)
    is distinct from (old.user_id,old.subject_id,old.bucket_path,old.storage_object_id,old.size_bytes,old.sha256,
      old.source_sha256,old.structural_validator_version,old.single_logical_sample_verified_at) then
    if current_user not in('postgres','service_role','supabase_admin') then
      raise exception using errcode='55000',message='immutable_file_identity';
    end if;
    -- 20261016221000: a subject transfer's own rebind or relocation swap.
    if private.file_transfer_transition_matches_v1(old,new) then return new; end if;
    if (to_jsonb(new)-'user_id') is distinct from (to_jsonb(old)-'user_id') then
      raise exception using errcode='55000',message='immutable_file_identity';
    end if;
    if not private.file_claimant_transition_matches_v1(old,new) then
      raise exception using errcode='55000',message='immutable_file_identity';
    end if;
  end if;
  return new;
end $function$
$definition$;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='2639f2ffdb7ec97d02a7375f483943d6'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='file identity guard successor differs'; end if;
end;
$patch_guard$;

-- A transferred revision keeps its file: the person owns it now. Current
-- body (20260930231000) with the change marked "20261016221000".
do $patch_end$
declare target regprocedure:='private.end_path_b_normalized_revision_v1()'::regprocedure; before_acl aclitem[];
begin
 select proacl into before_acl from pg_proc where oid=target and md5(prosrc)='c363f202cabc481aa74f270ebaff56de';
 if not found then raise exception using errcode='55000',message='held revision ending predecessor differs'; end if;
 execute $definition$
create or replace function private.end_path_b_normalized_revision_v1()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
 -- 20261016221000: never for a revision detached into the person's file.
 if (tg_op='DELETE' and old.state<>'transferred')
  or (tg_op='UPDATE' and new.state not in('pending','confirmed','transferred')) then
  delete from public.genome_files where id=old.id and subject_id=old.subject_id;
 end if;
 return null;
end;
$function$
$definition$;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='64fe2b4578fc5df789c4671a3eab1359'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='held revision ending successor differs'; end if;
end;
$patch_end$;

-- 4. The transfer --------------------------------------------------------------------
-- The one switch. The three notices of subject-ownership-transfer-v1 have no
-- approved wording, so the door stays closed (2026-10-22 rule). Approving
-- that wording, and queueing the notices, is the change that opens it.
create function private.subject_transfer_open_v1()
returns boolean language sql immutable set search_path='' as $$ select false $$;
revoke all on function private.subject_transfer_open_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The whole transfer, behind the door. Lock order: the invitation-transition
-- lock (every Path B writer takes it first), the account, its sessions and
-- profile, then the subject and its revisions and files.
create function private.transfer_subject_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; h public.other_adult_held_uploads%rowtype; v_now timestamptz:=clock_timestamp();
 v_principal uuid; v_uploader uuid; v_transfer private.subject_ownership_transfers%rowtype;
 v_revisions uuid[]; v_files uuid[]; v_object storage.objects%rowtype; v_readers uuid[]; v_reader uuid;
 v_chats uuid[]; v_generations uuid[]; v_contexts uuid[]; v_calls uuid[]; v_grants uuid[];
 v_exports uuid[]; n_grants integer; n_results integer;
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions where user_id=p_account_id order by id for share;
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found or not private.path_b_account_current_v1(p_account_id) then
  raise exception using errcode='42501',message='not_found'; end if;

 -- Only the record's own server-verified person account, for a confirmed
 -- Path B record (either flow) still held by its uploader.
 select * into s from public.subjects where id=p_subject_id for update;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'active' or s.ownership_transferred_at is not null
  or s.subject_account_id is distinct from p_account_id
  or s.owner_account_id is null or s.owner_account_id=p_account_id
  or not exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
   and d.owner_account_id=s.owner_account_id
   and d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
  raise exception using errcode='42501',message='not_found'; end if;
 select sp.id into v_principal from public.subject_principals sp where sp.subject_id=s.id
  and sp.principal_kind='account_subject' and sp.account_id=p_account_id and sp.status='active' for share;
 if v_principal is null then raise exception using errcode='42501',message='not_found'; end if;
 v_uploader:=s.owner_account_id;

 -- Refused, with nothing written, while a file is pending or still arriving.
 v_revisions:=array(select x.id from public.other_adult_held_uploads x where x.subject_id=s.id
  and x.state in ('pending','confirmed') order by x.id);
 perform 1 from public.other_adult_held_uploads where id=any(v_revisions) order by id for update;
 if exists(select 1 from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='pending')
  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.genome_files where id=any(v_revisions) order by id for update;
 if exists(select 1 from public.genome_files f where f.subject_id=s.id and not (f.id=any(v_revisions)))
  or exists(select 1 from private.genome_file_deletions d where d.file_id=any(v_revisions))
  or exists(select 1 from public.genome_files f where f.id=any(v_revisions)
   and (f.user_id is distinct from v_uploader or f.subject_id is distinct from s.id or f.storage_object_id is not null
    or f.cohort_id is not null)) then
  raise exception using errcode='42501',message='not_found'; end if;

 perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_transfer',s.id,
  p_nonce_hash,p_nonce_expires_at);

 -- 1. Ownership, then the immutable transfer row the file rebind and every
 -- relocation row name.
 update public.subjects set owner_account_id=p_account_id,ownership_transferred_at=v_now,
  lifecycle_revision=lifecycle_revision+1,updated_at=v_now where id=s.id returning * into s;
 insert into private.subject_ownership_transfers(subject_id,from_account_id,to_account_id,subject_lifecycle_revision,file_count)
 values(s.id,v_uploader,p_account_id,s.lifecycle_revision,cardinality(v_revisions)) returning * into v_transfer;

 -- Former-owner work stops.
 update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,claim_expires_at=null,claimed_by=null
  where status in ('queued','running') and kind not in ('revoke_purge','retention_purge')
   and (subject_id=s.id or file_id=any(v_revisions));
 update public.upload_sessions set status='cancelled',consumed_at=coalesce(consumed_at,v_now),expires_at=least(expires_at,v_now)
  where subject_id=s.id and status in ('issued','uploaded');

 -- 2. Each confirmed revision becomes a person-owned file, and one relocation
 -- row records its exact object.
 foreach h.id in array v_revisions loop
  select * into strict h from public.other_adult_held_uploads where id=h.id;
  select * into v_object from storage.objects o where o.id=h.storage_object_id and o.bucket_id='genomes'
   and o.name=h.object_name for share;
  if v_object.id is null or (v_object.metadata->>'size')::numeric is distinct from h.size_bytes then
   raise exception using errcode='55000',message='subject_transfer_object_unavailable'; end if;
  if exists(select 1 from public.genome_files f where f.id=h.id) then
   update public.genome_files set user_id=p_account_id where id=h.id and user_id=v_uploader;
   if not found then raise exception using errcode='55000',message='subject_transfer_file_unavailable'; end if;
   update public.user_variants set user_id=p_account_id where file_id=h.id and user_id=v_uploader;
  else
   insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
    upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256)
   values(h.id,p_account_id,s.id,h.object_name,'Genome file',h.file_type,1,h.size_bytes,h.raw_sha256,'uploaded',
    h.upload_revision,'single-logical-sample-v1',h.held_at,h.decoded_sha256);
  end if;
  insert into private.subject_transfer_relocations(transfer_id,subject_id,held_upload_id,file_id,old_owner_account_id,
   new_owner_account_id,old_object_id,old_object_key,old_object_version,byte_count,sha256)
  values(v_transfer.id,s.id,h.id,h.id,v_uploader,p_account_id,h.storage_object_id,h.object_name,v_object.version,
   h.size_bytes,h.raw_sha256);
  update public.other_adult_held_uploads set state='transferred',terminal_at=v_now where id=h.id;
  -- The revision's notice and its credentials end; the person owns the file.
  update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='subject_transferred'
   where id=h.notice_outbox_id and state in ('queued','claimed');
  update public.token_candidates set state='invalidated' where outbox_id=h.notice_outbox_id and state in ('pending','issued');
  update public.token_hashes th set status='revoked',ended_at=v_now from public.token_candidates tc
   where tc.id=th.candidate_id and tc.outbox_id=h.notice_outbox_id and th.status='current';
  update public.rights_sessions set status='revoked',ended_at=v_now
   where purpose='adult-upload-confirmation' and target_kind='adult_upload_revision' and target_id=h.id and status='active';
 end loop;
 v_files:=v_revisions;

 -- 3. Results. Only the person's own completed saved results stay.
 delete from private.path_b_report_bindings b where b.subject_id=s.id
  and (b.recipient_account_id<>p_account_id or b.state<>'complete');
 get diagnostics n_results=row_count;

 -- 4. The uploader's access ends. Every grant on the record to anyone but
 -- the person, and every relationship naming another recipient.
 v_grants:=array(select distinct g.grant_id from public.purpose_grants g
  join public.directional_grants dg on dg.grant_id=g.grant_id
  where g.target_kind='subject' and g.target_id=s.id and dg.recipient_account_id is distinct from p_account_id
  order by g.grant_id);
 perform 1 from public.purpose_grants where grant_id=any(v_grants) order by grant_id for update;
 update public.purpose_grants set revoked_at=v_now,revocation_reason='subject_transferred'
  where grant_id=any(v_grants) and revoked_at is null;
 get diagnostics n_grants=row_count;
 update public.directional_grants set status='revoked',ended_at=v_now
  where grant_id=any(v_grants) and status='current';
 update public.subject_relationships set status='revoked',ended_at=v_now
  where subject_id=s.id and status in ('pending','current') and recipient_account_id is distinct from p_account_id;
 v_exports:=array(select e.id from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id
  and e.status in ('queued','building','ready') order by e.id);
 update public.generated_exports set status='revoked' where id=any(v_exports);
 update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=v_uploader;
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and ((target_kind='subject' and target_id=s.id) or (target_kind='export' and target_id=any(v_exports))
   or file_id=any(v_files) or object_id in (select x.storage_object_id from public.other_adult_held_uploads x where x.subject_id=s.id));
 update public.rights_sessions set status='revoked',ended_at=v_now
  where status='active' and target_kind='subject' and target_id=s.id;

 -- Chats are never reassigned. Every chat about the record that the person
 -- does not own goes, with its model working state, and every other turn
 -- that retrieved the record is removed.
 v_readers:=array(select distinct c.user_id from public.chats c where c.user_id<>p_account_id and (
   exists(select 1 from public.chat_messages m where m.chat_id=c.id and m.retrieved_subject_ids && array[s.id])
   or exists(select 1 from public.copilot_context_history x where x.chat_id=c.id and x.retrieved_subject_ids && array[s.id]))
  order by c.user_id);
 foreach v_reader in array v_readers loop
  perform private.delete_pair_derived_rows_v1('{}'::uuid[],v_reader,array[s.id],null);
 end loop;
 v_chats:=array(select c.id from public.chats c where c.subject_id=s.id and c.user_id<>p_account_id order by c.id);
 perform 1 from public.chats where id=any(v_chats) order by id for update;
 v_generations:=array(select g.id from public.copilot_generation_sessions g where g.chat_id=any(v_chats));
 v_contexts:=array(select m.id from public.model_contexts m where m.generation_session_id=any(v_generations));
 v_calls:=array(select c.id from public.cloud_model_calls c where c.model_context_id=any(v_contexts));
 delete from public.cloud_provider_payloads where cloud_model_call_id=any(v_calls);
 delete from public.cloud_provider_attempts where cloud_model_call_id=any(v_calls);
 delete from public.cloud_model_calls where id=any(v_calls);
 delete from public.model_contexts where id=any(v_contexts);
 delete from public.copilot_context_tokens where chat_id=any(v_chats);
 delete from public.copilot_context_history where chat_id=any(v_chats);
 delete from public.copilot_turn_dependencies where chat_id=any(v_chats);
 delete from public.copilot_generation_sessions where id=any(v_generations);
 delete from public.chat_messages where chat_id=any(v_chats);
 delete from public.chats where id=any(v_chats);
 if exists(select 1 from public.chat_messages m join public.chats c on c.id=m.chat_id
   where c.user_id<>p_account_id and m.retrieved_subject_ids && array[s.id])
  or exists(select 1 from public.copilot_context_history x join public.chats c on c.id=x.chat_id
   where c.user_id<>p_account_id and x.retrieved_subject_ids && array[s.id])
  or exists(select 1 from public.copilot_context_tokens t join public.chats c on c.id=t.chat_id
   where c.user_id<>p_account_id and t.target_id=s.id) then
  raise exception using errcode='55000',message='subject_transfer_chat_residual'; end if;

 -- 5. Audit, with no raw contact or token.
 perform private.append_legal_audit_event('subject.ownership_transferred',null,'api.subject-transfer','accepted',
  jsonb_build_object('upload_class','other_adult','files',cardinality(v_files),'grants',n_grants,
   'results_removed',n_results,'chats',cardinality(v_chats),'revision',v_transfer.transfer_revision));
 return jsonb_build_object('status','transferred','subjectId',s.id,'effectiveAt',v_transfer.transferred_at,
  'relocations',cardinality(v_files));
end $$;
revoke all on function private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The door. Closed until the three notices' wording is approved.
create function public.transfer_subject_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.subject_transfer_open_v1() then
  raise exception using errcode='42501',message='not_found'; end if;
 return private.transfer_subject_v1(p_account_id,p_session_id,p_subject_id,p_nonce_hash,p_nonce_expires_at);
end $$;
revoke all on function public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

-- 5. Reading after a transfer -----------------------------------------------------------
-- A saved result of a transferred record is readable only by the person who
-- now owns it, only while the person's own grant that produced it is
-- current: not revoked or expired, the same grant and subject revisions,
-- the self direction, the person's principal still active, their account
-- current and the grant's own signing session still live (as the Path B
-- reader requires). The uploader's evidence is no longer part of it.
create function private.transferred_report_binding_current_v1(p_binding_id uuid,p_account_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.path_b_report_bindings b
  join public.subjects s on s.id=b.subject_id and s.ownership_transferred_at is not null and s.lifecycle='active'
   and s.owner_account_id=p_account_id and s.subject_account_id=p_account_id
  join private.subject_ownership_transfers t on t.subject_id=s.id and t.to_account_id=p_account_id
  join public.genome_files f on f.id=b.file_id and f.subject_id=s.id and f.user_id=p_account_id
  join public.purpose_grants g on g.grant_id=b.grant_id and g.target_kind='subject' and g.target_id=s.id
   and g.purpose=b.purpose and g.grant_revision=b.grant_revision and g.revoked_at is null
   and (g.expires_at is null or g.expires_at>clock_timestamp())
   and g.subject_binding_revision=s.subject_binding_revision
  join public.directional_grants d on d.grant_id=g.grant_id and d.grant_revision=g.grant_revision
   and d.status='current' and d.direction='self' and d.relationship_id is null and d.recipient_account_id=p_account_id
  join public.subject_principals sp on sp.id=g.data_subject_principal_id and sp.id=g.signer_principal_id
   and sp.id=d.recipient_principal_id and sp.subject_id=s.id and sp.account_id=p_account_id and sp.status='active'
   and sp.principal_kind='account_subject' and d.self_principal_revision=sp.principal_revision
  join auth.sessions x on x.id=g.path_b_originating_session_id and x.user_id=p_account_id
   and (x.not_after is null or x.not_after>clock_timestamp())
  join auth.users u on u.id=p_account_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
  where b.id=p_binding_id and b.recipient_account_id=p_account_id and b.state='complete'
   and private.path_b_account_current_v1(p_account_id));
$$;
revoke all on function private.transferred_report_binding_current_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function private.transferred_subject_result_read_v1(p_account_id uuid,p_subject_id uuid,p_purpose text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.subjects s where s.id=p_subject_id and s.ownership_transferred_at is not null
   and s.lifecycle='active' and s.owner_account_id=p_account_id and s.subject_account_id=p_account_id) then
  return jsonb_build_object('allowed',false,'gate','not-found'); end if;
 if exists(select 1 from private.path_b_report_bindings b where b.subject_id=p_subject_id and b.purpose=p_purpose
   and b.recipient_account_id=p_account_id and b.state='complete'
   and private.transferred_report_binding_current_v1(b.id,p_account_id)) then
  return jsonb_build_object('allowed',true,'gate','ready'); end if;
 return jsonb_build_object('allowed',false,'gate','analysis-not-generated');
end $$;
revoke all on function private.transferred_subject_result_read_v1(uuid,uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The read decision: a transferred record has its own branch, before the
-- uploader-dependent mitigation and normalization authority.
do $patch_read$
declare target regprocedure:='private.path_b_result_read_v1(uuid,uuid,text)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$ m:=private.other_adult_mitigation_v1(p_subject_id,p_account_id,'route-read-before-fetch');$old$;
 new_fragment text:=$new$ -- 20261016221000: a record transferred to its person.
 if exists(select 1 from public.subjects t where t.id=p_subject_id and t.ownership_transferred_at is not null) then
  return private.transferred_subject_result_read_v1(p_account_id,p_subject_id,p_purpose); end if;
 m:=private.other_adult_mitigation_v1(p_subject_id,p_account_id,'route-read-before-fetch');$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='6a11b090fe19408849eef67b55e456e6';
 if definition is null then raise exception using errcode='55000',message='path b read decision predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='path b read decision anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='d229cc3de2fe8973525b75d06a8f0af7'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='path b read decision successor differs'; end if;
end;
$patch_read$;

-- The saved-result reader and its readiness check: a binding of a
-- transferred record is checked by the person's own current grant; every
-- other binding keeps the existing full authority comparison.
do $patch_results$
declare target regprocedure:='private.path_b_report_results_v1(uuid,uuid,uuid,text,boolean)'::regprocedure;
 before_acl aclitem[];
begin
 select proacl into before_acl from pg_proc where oid=target and md5(prosrc)='15fba855b30040199449da320428e26c';
 if not found then raise exception using errcode='55000',message='path b results predecessor differs'; end if;
 -- Current body (20260930234000) with the changes marked "20261016221000".
 execute $definition$
create or replace function private.path_b_report_results_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_purpose text, p_test_jurisdiction boolean)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare b private.path_b_report_bindings%rowtype; a jsonb; result jsonb:='[]'; v_bindings uuid[]:='{}'; v_id uuid;
 v_transferred boolean;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_purpose is null or p_purpose not in('reports.monogenic','reports.polygenic') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform 1 from auth.sessions x join auth.users u on u.id=x.user_id where x.id=p_session_id and x.user_id=p_account_id
  and(x.not_after is null or x.not_after>clock_timestamp()) and u.deleted_at is null
  and(u.banned_until is null or u.banned_until<=clock_timestamp()) for share of x,u;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform private.lock_invitation_transitions_v1();
 -- 20261016221000: a record transferred to its person.
 v_transferred:=exists(select 1 from public.subjects t where t.id=p_subject_id and t.ownership_transferred_at is not null);
 for b in select * from private.path_b_report_bindings where subject_id=p_subject_id and purpose=p_purpose
  and recipient_account_id=p_account_id and state='complete' order by file_id,binding_revision for share
 loop
  begin
   if v_transferred then
    if not private.transferred_report_binding_current_v1(b.id,p_account_id) then
     raise exception using errcode='42501',message='not_found'; end if;
    a:=b.authority;
   else
    a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read');
    if a is distinct from b.authority then raise exception using errcode='42501',message='not_found'; end if;
    if(a->>'authorityExpiresAt')::timestamptz<=clock_timestamp() then
     raise exception using errcode='42501',message='not_found'; end if;
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('fileId',b.file_id,'subjectId',b.subject_id,'purpose',b.purpose,
    'completedAt',b.completed_at,'sourceRevision',a->'source'->'sourceRevision','sourceSha256',a->'source'->'decodedSha256',
    'normalizedAt',a->'normalizedAt','computationRevision',b.computation_revision,'result',b.result));
   v_bindings:=array_append(v_bindings,b.id);
  exception when insufficient_privilege then null;
  end;
 end loop;
 if octet_length(result::text)>4000000 then raise exception using errcode='22023',message='invalid_request'; end if;
 foreach v_id in array v_bindings loop
  select * into strict b from private.path_b_report_bindings where id=v_id;
  if v_transferred then
   if not private.transferred_report_binding_current_v1(b.id,p_account_id) then
    raise exception using errcode='42501',message='not_found'; end if;
  elsif private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read') is distinct from b.authority then
   raise exception using errcode='42501',message='not_found'; end if;
 end loop;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id
  and(not_after is null or not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return result;
end;
$function$
$definition$;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='58217447bdf3de92e315e3cee03fb4f0'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='path b results successor differs'; end if;
end;
$patch_results$;

do $patch_ready$
declare target regprocedure:='private.path_b_report_read_ready_v1(uuid,uuid,text)'::regprocedure;
 before_acl aclitem[];
begin
 select proacl into before_acl from pg_proc where oid=target and md5(prosrc)='ae73cb79432cb38b5db4b575c08a0a0b';
 if not found then raise exception using errcode='55000',message='path b readiness predecessor differs'; end if;
 -- Current body (20260930234000) with the change marked "20261016221000".
 execute $definition$
create or replace function private.path_b_report_read_ready_v1(p_account_id uuid, p_subject_id uuid, p_purpose text)
 returns boolean language plpgsql security definer set search_path to ''
as $function$
declare b private.path_b_report_bindings%rowtype;
begin
 -- 20261016221000: a record transferred to its person.
 if exists(select 1 from public.subjects t where t.id=p_subject_id and t.ownership_transferred_at is not null) then
  return (private.transferred_subject_result_read_v1(p_account_id,p_subject_id,p_purpose)->>'allowed')::boolean;
 end if;
 for b in select * from private.path_b_report_bindings where recipient_account_id=p_account_id
  and subject_id=p_subject_id and purpose=p_purpose and state='complete' order by binding_revision desc for share
 loop
  begin
   if private.path_b_report_authority_v1(b.file_id,b.grant_id,'derived-write-and-read')=b.authority then return true; end if;
  exception when insufficient_privilege then null;
  end;
 end loop;
 return false;
end;
$function$
$definition$;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='53d9878b9f36ec14daed247b141fd573'
   and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='path b readiness successor differs'; end if;
end;
$patch_ready$;

-- 6. The relocation worker's doors (workerExecutionBindings.subject-object-
-- relocation), service role only, TEST-LOCAL only. Every door names one
-- exact database row; no client path, prefix or request field chooses an
-- object. The checkpoints:
--   copy: claim the queued row (one attempt, a five-minute lease, its own
--     fresh key), recheck before and after the copy, then swap in one
--     transaction after the worker hashed every byte of the new object;
--   retire: only after a committed swap, delete the exact old object, then
--     prove it is gone and mark the row complete;
--   dispose: an attempt that never swapped (failed, expired or cancelled)
--     deletes only its own new key, then proves it is gone.
-- A lease that expires fences its attempt; the row is queued again.

create function private.subject_transfer_relocation_current_v1(r private.subject_transfer_relocations)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subjects s
  join private.subject_ownership_transfers t on t.id=(r).transfer_id and t.subject_id=s.id
   and t.to_account_id=(r).new_owner_account_id and t.from_account_id=(r).old_owner_account_id
  join public.genome_files f on f.id=(r).file_id and f.subject_id=s.id and f.user_id=(r).new_owner_account_id
   and f.bucket_path=(r).old_object_key and f.storage_object_id is null
  join storage.objects o on o.id=(r).old_object_id and o.bucket_id='genomes' and o.name=(r).old_object_key
   and o.version is not distinct from (r).old_object_version and (o.metadata->>'size')::numeric=(r).byte_count
  where s.id=(r).subject_id and s.ownership_transferred_at is not null and s.lifecycle='active'
   and s.owner_account_id=(r).new_owner_account_id and s.subject_account_id=(r).new_owner_account_id
   and not exists(select 1 from private.genome_file_deletions d where d.file_id=(r).file_id));
$$;
revoke all on function private.subject_transfer_relocation_current_v1(private.subject_transfer_relocations)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The next unit of work, or null. Expired leases are fenced first.
create function public.subject_transfer_relocation_work_v1(p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.subject_transfer_relocation_attempts%rowtype; r private.subject_transfer_relocations%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 for a in select * from private.subject_transfer_relocation_attempts where state='copying'
  and claim_expires_at<=clock_timestamp() order by created_at for update skip locked loop
  update private.subject_transfer_relocation_attempts set state='fenced' where id=a.id;
  update private.subject_transfer_relocations set state='queued',current_attempt_id=null
   where id=a.relocation_id and state='copying' and current_attempt_id=a.id;
 end loop;
 select * into r from private.subject_transfer_relocations where state='swapped'
  and (retire_claim_expires_at is null or retire_claim_expires_at<=clock_timestamp())
  order by swapped_at,id for update skip locked limit 1;
 if r.id is not null then return jsonb_build_object('kind','retire','relocationId',r.id); end if;
 select * into a from private.subject_transfer_relocation_attempts where state='fenced'
  and (claim_expires_at is null or claim_expires_at<=clock_timestamp() or claim_token_hash is null)
  order by created_at,id for update skip locked limit 1;
 if a.id is not null then return jsonb_build_object('kind','dispose','attemptId',a.id); end if;
 select * into r from private.subject_transfer_relocations where state='queued'
  order by created_at,id for update skip locked limit 1;
 if r.id is not null then return jsonb_build_object('kind','copy','relocationId',r.id); end if;
 return null;
end $$;

create function public.claim_subject_transfer_relocation_v1(p_relocation_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.subject_transfer_relocations%rowtype; a private.subject_transfer_relocation_attempts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into r from private.subject_transfer_relocations where id=p_relocation_id for update skip locked;
 if r.id is null or r.state<>'queued' then return null; end if;
 if not private.subject_transfer_relocation_current_v1(r) then
  update private.subject_transfer_relocations set state='cancelled',cancelled_at=clock_timestamp() where id=r.id;
  return null;
 end if;
 insert into private.subject_transfer_relocation_attempts(relocation_id,claim_token_hash,claim_expires_at)
 values(r.id,p_token_hash,clock_timestamp()+interval '5 minutes') returning * into a;
 update private.subject_transfer_relocations set state='copying',current_attempt_id=a.id,attempts=least(attempts+1,1000)
  where id=r.id;
 return jsonb_build_object('relocationId',r.id,'attemptId',a.id,'bucket',r.bucket_id,'oldKey',r.old_object_key,
  'newKey',a.id::text,'byteCount',r.byte_count,'sha256',r.sha256,'expiresAt',a.claim_expires_at);
end $$;

create function private.subject_transfer_attempt_current_v1(p_attempt_id uuid,p_token_hash text)
returns private.subject_transfer_relocations language plpgsql security definer set search_path='' as $$
declare r private.subject_transfer_relocations%rowtype; a private.subject_transfer_relocation_attempts%rowtype;
begin
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select * into a from private.subject_transfer_relocation_attempts where id=p_attempt_id for update;
 if a.id is null or a.state<>'copying' or a.claim_token_hash is distinct from p_token_hash
  or a.claim_expires_at<=clock_timestamp() then return null; end if;
 select * into r from private.subject_transfer_relocations where id=a.relocation_id for update;
 if r.state<>'copying' or r.current_attempt_id is distinct from a.id
  or not private.subject_transfer_relocation_current_v1(r) then return null; end if;
 return r;
end $$;
revoke all on function private.subject_transfer_attempt_current_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

create function public.check_subject_transfer_relocation_v1(p_attempt_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 return (private.subject_transfer_attempt_current_v1(p_attempt_id,p_token_hash)).id is not null;
end $$;

-- The swap: after the worker read back every byte of the new object, in
-- one transaction that rechecks every revision.
create function public.swap_subject_transfer_relocation_v1(p_attempt_id uuid,p_token_hash text,p_new_object_id uuid,
 p_byte_count bigint,p_sha256 text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare r private.subject_transfer_relocations%rowtype; f public.genome_files%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 r:=private.subject_transfer_attempt_current_v1(p_attempt_id,p_token_hash);
 if r.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if p_byte_count is distinct from r.byte_count or p_sha256 is distinct from r.sha256 then
  raise exception using errcode='22023',message='relocation_integrity_mismatch'; end if;
 perform 1 from storage.objects o where o.id=p_new_object_id and o.bucket_id='genomes' and o.name=p_attempt_id::text
  and (o.metadata->>'size')::numeric=r.byte_count;
 if not found then raise exception using errcode='22023',message='relocation_integrity_mismatch'; end if;
 select * into strict f from public.genome_files where id=r.file_id for update;
 insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values(p_new_object_id,p_attempt_id::text,'genomes',f.id,r.sha256,r.byte_count,f.upload_revision,'current');
 update private.subject_transfer_relocation_attempts set state='swapped',claim_token_hash=null,claim_expires_at=null,
  ended_at=v_now where id=p_attempt_id;
 update private.subject_transfer_relocations set state='swapped',current_attempt_id=null,new_object_id=p_new_object_id,
  new_object_key=p_attempt_id::text,swapped_at=v_now,swap_transaction_id=txid_current() where id=r.id;
 update public.genome_files set bucket_path=p_attempt_id::text,storage_object_id=p_new_object_id where id=f.id;
 return true;
end $$;

-- A failed attempt that never swapped: only its own new key is disposed of.
create function public.fence_subject_transfer_relocation_v1(p_attempt_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare a private.subject_transfer_relocation_attempts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 select * into a from private.subject_transfer_relocation_attempts where id=p_attempt_id for update;
 if a.id is null or a.state<>'copying' or a.claim_token_hash is distinct from p_token_hash then return false; end if;
 update private.subject_transfer_relocation_attempts set state='fenced',claim_expires_at=clock_timestamp() where id=a.id;
 update private.subject_transfer_relocations set state='queued',current_attempt_id=null
  where id=a.relocation_id and state='copying' and current_attempt_id=a.id;
 return true;
end $$;

create function public.claim_subject_transfer_disposal_v1(p_attempt_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.subject_transfer_relocation_attempts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into a from private.subject_transfer_relocation_attempts where id=p_attempt_id for update skip locked;
 if a.id is null or a.state<>'fenced' or (a.claim_token_hash is not null and a.claim_expires_at>clock_timestamp()) then
  return null; end if;
 update private.subject_transfer_relocation_attempts set claim_token_hash=p_token_hash,
  claim_expires_at=clock_timestamp()+interval '5 minutes' where id=a.id;
 return jsonb_build_object('attemptId',a.id,'bucket','genomes','key',a.id::text);
end $$;

create function public.finish_subject_transfer_disposal_v1(p_attempt_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare a private.subject_transfer_relocation_attempts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 select * into a from private.subject_transfer_relocation_attempts where id=p_attempt_id for update;
 if a.id is null or a.state<>'fenced' or a.claim_token_hash is distinct from p_token_hash
  or a.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from storage.objects where bucket_id='genomes' and name=a.id::text) then
  raise exception using errcode='55000',message='relocation_disposal_incomplete'; end if;
 update private.subject_transfer_relocation_attempts set state='disposed',claim_token_hash=null,claim_expires_at=null,
  ended_at=clock_timestamp() where id=a.id;
 return true;
end $$;

-- Only after a committed swap is the exact old object deleted.
create function public.claim_subject_transfer_retirement_v1(p_relocation_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.subject_transfer_relocations%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into r from private.subject_transfer_relocations where id=p_relocation_id for update skip locked;
 if r.id is null or r.state<>'swapped'
  or (r.retire_claim_expires_at is not null and r.retire_claim_expires_at>clock_timestamp()) then return null; end if;
 -- The file no longer names the old key; nothing else may either.
 if exists(select 1 from public.genome_files where bucket_path=r.old_object_key)
  or exists(select 1 from public.genome_storage_objects where object_name=r.old_object_key) then
  raise exception using errcode='55000',message='relocation_old_object_referenced'; end if;
 update private.subject_transfer_relocations set retire_claim_token_hash=p_token_hash,
  retire_claim_expires_at=clock_timestamp()+interval '5 minutes' where id=r.id;
 return jsonb_build_object('relocationId',r.id,'bucket',r.bucket_id,'key',r.old_object_key);
end $$;

create function public.finish_subject_transfer_retirement_v1(p_relocation_id uuid,p_token_hash text,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare r private.subject_transfer_relocations%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 select * into r from private.subject_transfer_relocations where id=p_relocation_id for update;
 if r.id is null or r.state<>'swapped' or r.retire_claim_token_hash is distinct from p_token_hash
  or r.retire_claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from storage.objects where bucket_id='genomes' and name=r.old_object_key) then
  raise exception using errcode='55000',message='relocation_retirement_incomplete'; end if;
 update private.subject_transfer_relocations set state='complete',completed_at=clock_timestamp(),
  retire_claim_token_hash=null,retire_claim_expires_at=null where id=r.id;
 -- The held session's working rows no longer name a stored object.
 update public.upload_staging_objects w set state='deleted' from public.other_adult_held_uploads h
  where h.id=r.held_upload_id and w.upload_session_id=h.upload_session_id and w.object_name=r.old_object_key
   and w.state<>'deleted';
 return true;
end $$;

do $grants$ declare f text; begin
 foreach f in array array['public.subject_transfer_relocation_work_v1(boolean)',
  'public.claim_subject_transfer_relocation_v1(uuid,text,boolean)','public.check_subject_transfer_relocation_v1(uuid,text,boolean)',
  'public.swap_subject_transfer_relocation_v1(uuid,text,uuid,bigint,text,boolean)',
  'public.fence_subject_transfer_relocation_v1(uuid,text,boolean)','public.claim_subject_transfer_disposal_v1(uuid,text,boolean)',
  'public.finish_subject_transfer_disposal_v1(uuid,text,boolean)','public.claim_subject_transfer_retirement_v1(uuid,text,boolean)',
  'public.finish_subject_transfer_retirement_v1(uuid,text,boolean)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,inherit_upload_only', f);
  execute format('grant execute on function %s to service_role', f);
 end loop;
end $grants$;

-- 7. Deleting a transferred record (api.subject-delete, adult case) -----------------------
-- The person deletes it. Relocations still waiting are cancelled and any
-- attempt in flight is fenced, so only its own new key is disposed of. Each
-- person-owned file is prepared for the file deletion pipeline exactly as
-- the per-file guard prepares one (unreadable at once, its Storage target
-- recorded), and the seven-day backstop finishes it. A swapped relocation
-- still retires its old object. Saved results go at once. The rest is the
-- existing Path B delete by the person, with the refusal bar.
create function private.purge_transferred_adult_subject_v1(p_subject_id uuid,p_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; f public.genome_files%rowtype; v_files uuid[]; n integer:=0;
begin
 select * into s from public.subjects where id=p_subject_id for update;
 if s.id is null or s.ownership_transferred_at is null or s.lifecycle<>'active'
  or s.owner_account_id is distinct from p_account_id or s.subject_account_id is distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from private.subject_transfer_relocations where subject_id=s.id order by id for update;
 update private.subject_transfer_relocation_attempts a set state='fenced',claim_expires_at=clock_timestamp()
  from private.subject_transfer_relocations r where r.id=a.relocation_id and r.subject_id=s.id and a.state='copying';
 update private.subject_transfer_relocations set state='cancelled',current_attempt_id=null,cancelled_at=clock_timestamp()
  where subject_id=s.id and state in ('queued','copying');
 v_files:=array(select x.id from public.genome_files x where x.subject_id=s.id order by x.id);
 perform 1 from public.genome_files where id=any(v_files) order by id for update;
 if exists(select 1 from public.genome_files x where x.id=any(v_files) and (x.user_id is distinct from p_account_id
   or x.cohort_id is not null)) then
  raise exception using errcode='55000',message='subject_delete_unsupported_graph'; end if;
 update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,claim_expires_at=null,claimed_by=null
  where status in ('queued','running') and kind not in ('revoke_purge','retention_purge')
   and (subject_id=s.id or file_id=any(v_files));
 delete from private.path_b_report_bindings where subject_id=s.id;
 foreach f.id in array v_files loop
  select * into strict f from public.genome_files where id=f.id;
  if not exists(select 1 from private.genome_file_deletions d where d.file_id=f.id) then
   update public.genome_files set status='failed',error='File deletion is pending. Try Delete again.' where id=f.id;
   insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
    values(f.id,p_account_id,'genomes',f.bucket_path);
   update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())
    where genome_file_id=f.id;
  end if;
  n:=n+1;
 end loop;
 update public.download_sessions set status='revoked',ended_at=clock_timestamp(),session_revision=session_revision+1
  where status='active' and ((target_kind='subject' and target_id=s.id) or file_id=any(v_files));
 perform private.delete_path_b_subject_for_route_v1(s.id,'deleted');
 return jsonb_build_object('case','adult','files',n);
end $$;
revoke all on function private.purge_transferred_adult_subject_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

do $patch_door$
declare target regprocedure:='public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure;
 definition text; before_acl aclitem[];
 old_fragment text:=$old$  v_path_b:=exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id$old$;
 new_fragment text:=$new$  -- 20261016221000: a record transferred to its person, deleted by that person.
  if s.ownership_transferred_at is not null then
   if s.owner_account_id is distinct from p_account_id or s.subject_account_id is distinct from p_account_id then
    raise exception using errcode='42501',message='not_found'; end if;
   perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
   perform private.purge_transferred_adult_subject_v1(s.id,p_account_id);
   return jsonb_build_object('case','adult');
  end if;
  v_path_b:=exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id$new$;
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc
  where oid=target and md5(prosrc)='09f00c92c9b1016ef554a297d02b632d';
 if definition is null then raise exception using errcode='55000',message='subject delete door predecessor differs'; end if;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception using errcode='55000',message='subject delete door anchor differs'; end if;
 execute replace(definition,old_fragment,new_fragment);
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='3dd7e58c3170b28435c1b2dac7866ea7'
   and proacl is not distinct from before_acl and prosecdef and proconfig=array['search_path=""']::text[]) then
  raise exception using errcode='55000',message='subject delete door successor differs'; end if;
end;
$patch_door$;

notify pgrst, 'reload schema';
