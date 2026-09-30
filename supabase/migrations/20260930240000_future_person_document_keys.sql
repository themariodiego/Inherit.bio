-- Independently erasable identity and per-document envelope keys. TEST-LOCAL.
-- Existing legacy ciphertext cannot be relabeled as independently encrypted.
-- Refuse a nonempty legacy store; a reviewed re-encryption migration is needed
-- before this can be applied where any such session already exists.
do $$begin
 if exists(select 1 from private.claim_document_sessions) then
   raise exception using errcode='55000',message='legacy claim document re-encryption required';
 end if;
end $$;
alter table private.claim_document_sessions
 add column wrapped_document_key bytea,
 add column document_key_shredded_at timestamptz,
 add constraint claim_document_independent_key_shape check (
   (wrapped_document_key is null)=(document_key_shredded_at is not null)
   and (wrapped_document_key is null or octet_length(wrapped_document_key)=72)
   and (state<>'failed' or wrapped_document_key is null)
 );
create unique index claim_document_independent_wrapped_key on private.claim_document_sessions(wrapped_document_key)
 where wrapped_document_key is not null;
alter table private.future_person_claim_intakes add column identity_key_shredded_at timestamptz;

-- Runtime creation is the only API path that accepts a wrapped random key.
-- Old signatures lose all API grants; there is no identity-key fallback.
revoke all on function private.open_claim_document_session_v1(text,text,text,text,integer,text,text),
 public.open_claim_document_session_v1(text,text,text,text,integer,text,text),
 private.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text),
 public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text)
 from public,anon,authenticated,service_role;

create or replace function private.open_claim_document_session_v1(
  p_claim_session_hash text, p_create_nonce_hash text, p_document_kind text, p_media_type text,
  p_size_bytes integer, p_sha256 text, p_cookie_hash text, p_wrapped_document_key bytea
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_intake private.future_person_claim_intakes;
  v_limits jsonb := private.claim_document_limits_v1();
  v_session private.claim_document_sessions;
begin
  if p_wrapped_document_key is null or octet_length(p_wrapped_document_key)<>72
    or p_document_kind is null or p_document_kind not in ('future-photo-identity', 'future-birth-record')
    or p_media_type is null or p_media_type not in ('application/pdf', 'image/jpeg', 'image/png')
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > (v_limits->>'maximumDocumentBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_create_nonce_hash is null or p_create_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document session invalid';
  end if;
  v_intake := private.touch_live_claim_intake_v1(p_claim_session_hash);
  if v_intake.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_wrapped_document_key=v_intake.wrapped_data_key then
    raise exception using errcode='22023',message='claim document key invalid';
  end if;
  if exists (select 1 from private.claim_document_sessions where create_nonce_hash = p_create_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document nonce already used';
  end if;
  if (select count(*) from private.claim_document_sessions s
      where s.intake_id = v_intake.id and s.state in ('open', 'composing'))
      >= (v_limits->>'maximumActiveSessionsPerPrincipal')::integer
    or (select count(*) from private.claim_document_sessions s
      where s.intake_id = v_intake.id and s.document_kind = p_document_kind and s.state <> 'failed')
      >= (v_limits->>'maximumDocumentsPerTargetAndKind')::integer then
    return jsonb_build_object('status', 'capacity_limited');
  end if;
  insert into private.claim_document_sessions (
    intake_id, document_kind, media_type, declared_bytes, declared_sha256, cookie_hash,
    create_nonce_hash, expires_at, created_at, wrapped_document_key)
  select v_intake.id, p_document_kind, p_media_type, p_size_bytes, p_sha256, p_cookie_hash,
    p_create_nonce_hash, least(t.now_at + interval '24 hours', v_intake.expires_at), t.now_at, p_wrapped_document_key
  from (select clock_timestamp() as now_at) t
  returning * into v_session;
  return jsonb_build_object('status', 'open', 'session', v_session.id,
    'documentKind', v_session.document_kind, 'expiresAt', v_session.expires_at);
end;
$$;

create function public.open_claim_document_session_v1(
 p_claim_session_hash text,p_create_nonce_hash text,p_document_kind text,p_media_type text,
 p_size_bytes integer,p_sha256 text,p_cookie_hash text,p_wrapped_document_key bytea
) returns jsonb language sql security invoker set search_path='' as $$
 select private.open_claim_document_session_v1(p_claim_session_hash,p_create_nonce_hash,p_document_kind,
   p_media_type,p_size_bytes,p_sha256,p_cookie_hash,p_wrapped_document_key);
$$;
revoke all on function private.open_claim_document_session_v1(text,text,text,text,integer,text,text,bytea),
 public.open_claim_document_session_v1(text,text,text,text,integer,text,text,bytea) from public,anon,authenticated,service_role;
grant execute on function private.open_claim_document_session_v1(text,text,text,text,integer,text,text,bytea),
 public.open_claim_document_session_v1(text,text,text,text,integer,text,text,bytea) to service_role;

create or replace function private.open_claim_document_session_rotated_v1(
  p_claim_session_hash text, p_successor_claim_session_hash text, p_create_nonce_hash text,
  p_document_kind text, p_media_type text, p_size_bytes integer, p_sha256 text, p_cookie_hash text, p_wrapped_document_key bytea
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_successor_claim_session_hash is null or p_successor_claim_session_hash !~ '^[0-9a-f]{64}$'
    or p_successor_claim_session_hash = p_claim_session_hash then
    raise exception using errcode = '22023', message = 'claim session rotation invalid';
  end if;
  v_result := private.open_claim_document_session_v1(p_claim_session_hash, p_create_nonce_hash,
    p_document_kind, p_media_type, p_size_bytes, p_sha256, p_cookie_hash, p_wrapped_document_key);
  if v_result->>'status' = 'open' then
    update private.future_person_claim_intakes set session_hash = p_successor_claim_session_hash
    where session_hash = p_claim_session_hash;
    if not found then raise exception using errcode = '42501', message = 'claim session unavailable'; end if;
  end if;
  return v_result;
end;
$$;

create function public.open_claim_document_session_rotated_v1(
 p_claim_session_hash text,p_successor_claim_session_hash text,p_create_nonce_hash text,
 p_document_kind text,p_media_type text,p_size_bytes integer,p_sha256 text,p_cookie_hash text,p_wrapped_document_key bytea
) returns jsonb language sql security invoker set search_path='' as $$
 select private.open_claim_document_session_rotated_v1(p_claim_session_hash,p_successor_claim_session_hash,
   p_create_nonce_hash,p_document_kind,p_media_type,p_size_bytes,p_sha256,p_cookie_hash,p_wrapped_document_key);
$$;
revoke all on function private.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text,bytea),
 public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text,bytea) from public,anon,authenticated,service_role;
grant execute on function private.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text,bytea),
 public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text,bytea) to service_role;

create or replace function private.claim_document_session_for_v1(p_session_id uuid, p_cookie_hash text)
returns private.claim_document_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_intake private.future_person_claim_intakes;
begin
  if p_session_id is null or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select s.* into v_session from private.claim_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null or v_session.wrapped_document_key is null then return null; end if;
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id for update;
  if v_intake.id is null or not private.claim_intake_live_v1(v_intake) or v_session.expires_at <= clock_timestamp() then
    return null;
  end if;
  update private.future_person_claim_intakes set last_active_at = clock_timestamp() where id = v_intake.id;
  return v_session;
end;
$$;

create or replace function private.reserve_claim_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_limits jsonb := private.claim_document_limits_v1();
  v_written bigint;
  v_key text;
  v_intake private.future_person_claim_intakes;
begin
  v_session := private.claim_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_sequence is null or p_sequence < 0 or p_sequence >= (v_limits->>'maximumChunks')::integer
    or exists (select 1 from private.claim_document_fragments f where f.session_id = v_session.id and f.sequence = p_sequence) then
    raise exception using errcode = '23505', message = 'claim document chunk already written';
  end if;
  select coalesce(sum(f.byte_count), 0) into v_written from private.claim_document_fragments f
  where f.session_id = v_session.id;
  if p_byte_count is null or p_byte_count < 1 or p_byte_count > (v_limits->>'chunkBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or v_written + p_byte_count > v_session.declared_bytes then
    perform private.fail_claim_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'invalid');
  end if;
  v_key := v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text;
  insert into private.claim_document_fragments (session_id, sequence, object_key, byte_count, sha256)
  values (v_session.id, p_sequence, v_key, p_byte_count, p_sha256);
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'reserved', 'objectKey', v_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'));
end;
$$;

create or replace function private.begin_claim_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_chunk_count integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.claim_document_sessions;
  v_count integer;
  v_bytes bigint;
  v_max integer;
  v_intake private.future_person_claim_intakes;
begin
  if p_complete_nonce_hash is null or p_complete_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  select s.* into v_session from private.claim_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if v_session.state <> 'open' then
    -- The same nonce may ask again for the outcome; nothing else may.
    if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash then
      raise exception using errcode = '23505', message = 'claim document completion already used';
    end if;
    return private.claim_document_status_v1(v_session);
  end if;
  v_session := private.claim_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if exists (select 1 from private.claim_document_sessions where complete_nonce_hash = p_complete_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document completion already used';
  end if;
  select count(*), coalesce(sum(byte_count), 0), coalesce(max(sequence), -1)
  into v_count, v_bytes, v_max
  from private.claim_document_fragments where session_id = v_session.id and state = 'written';
  if p_chunk_count is null or p_chunk_count < 1 or p_chunk_count <> v_count or v_max <> v_count - 1
    or exists (select 1 from private.claim_document_fragments where session_id = v_session.id and state <> 'written')
    or v_bytes <> v_session.declared_bytes then
    update private.claim_document_sessions set complete_nonce_hash = p_complete_nonce_hash
    where id = v_session.id;
    perform private.fail_claim_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'refused', 'reason', 'integrity');
  end if;
  update private.claim_document_sessions set state = 'composing', complete_nonce_hash = p_complete_nonce_hash,
    planned_object_key = v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text
  where id = v_session.id
  returning * into v_session;
  select i.* into v_intake from private.future_person_claim_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'compose',
    'documentId', v_session.document_id, 'documentKind', v_session.document_kind,
    'mediaType', v_session.media_type, 'sizeBytes', v_session.declared_bytes,
    'sha256', v_session.declared_sha256,
    'objectKey', v_session.planned_object_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'),
    'fragments', (select jsonb_agg(jsonb_build_object('sequence', f.sequence, 'objectKey', f.object_key,
        'byteCount', f.byte_count, 'sha256', f.sha256) order by f.sequence)
      from private.claim_document_fragments f where f.session_id = v_session.id));
end;
$$;

create or replace function private.claim_next_claim_document_scan_v1(p_lease_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_document private.claim_documents;
  v_limits jsonb := private.claim_document_limits_v1();
begin
  if p_lease_hash is null or p_lease_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'scan lease invalid';
  end if;
  select d.* into v_document from private.claim_documents d
  join private.future_person_claim_intakes i on i.id = d.intake_id
  join private.claim_document_sessions ds on ds.id=d.session_id and ds.wrapped_document_key is not null
  where d.state = 'quarantined' and (d.lease_expires_at is null or d.lease_expires_at <= clock_timestamp())
    and i.expires_at > clock_timestamp()
  order by d.created_at, d.id
  limit 1
  for update of d skip locked;
  if v_document.id is null then return null; end if;
  update private.claim_documents set lease_hash = p_lease_hash,
    lease_expires_at = clock_timestamp() + make_interval(secs => (v_limits->>'scanLeaseSeconds')::integer),
    scan_attempts = scan_attempts + 1
  where id = v_document.id;
  return jsonb_build_object('documentId', v_document.id, 'objectKey', v_document.object_key,
    'sha256', v_document.sha256, 'byteCount', v_document.byte_count, 'mediaType', v_document.media_type,
    'wrappedDataKey', (select encode(ds.wrapped_document_key,'hex') from private.claim_document_sessions ds
      where ds.id=v_document.session_id));
end;
$$;

create or replace function private.claim_review_document_v1(p_review private.claim_reviews, p_document_id uuid)
returns private.claim_documents
language sql stable security definer set search_path = '' as $$
  select d.* from private.claim_documents d
  join private.claim_document_sessions ds on ds.id=d.session_id and ds.wrapped_document_key is not null
  where d.id = p_document_id and d.intake_id = p_review.id
    and d.id in (p_review.photo_document_id, p_review.birth_record_document_id)
    and d.state = 'clean' and d.scan_verdict = 'OK' and d.scanned_sha256 = d.sha256
    and d.object_deleted_at is null
    and d.sha256 = case when d.id = p_review.photo_document_id then p_review.photo_sha256
      else p_review.birth_record_sha256 end;
$$;

create or replace function private.claim_document_review_object_v1(p_document_id uuid)
returns table (object_key text, wrapped_data_key bytea, sha256 text, media_type text, byte_count integer)
language sql stable security definer set search_path = '' as $$
  select d.object_key, ds.wrapped_document_key, d.sha256, d.media_type, d.byte_count
  from private.claim_documents d
  join private.claim_document_sessions ds on ds.id=d.session_id and ds.wrapped_document_key is not null
  join private.claim_reviews r on r.id = d.intake_id
  where d.id = p_document_id and d.state = 'clean' and d.scan_verdict = 'OK'
    and d.scanned_sha256 = d.sha256 and d.object_deleted_at is null
    and private.claim_review_open_v1(r) and d.id in (r.photo_document_id, r.birth_record_document_id);
$$;

create or replace function private.authorize_claim_review_chunk_v1(p_session_id uuid, p_cookie_hash text, p_sequence integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_download private.claim_review_downloads;
  v_review private.claim_reviews;
  v_document private.claim_documents;
begin
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select d.* into v_download from private.claim_review_downloads d
  where d.id = p_session_id and d.cookie_hash = p_cookie_hash for update;
  if v_download.id is null or v_download.revoked_at is not null or v_download.reviewer_account_id <> v_reviewer.account_id
    or v_download.auth_session_id <> v_reviewer.auth_session_id
    or v_download.account_auth_session_revision <> v_reviewer.account_auth_session_revision
    or v_download.originating_session_revision <> v_reviewer.session_revision
    or v_download.expires_at <= clock_timestamp()
    or v_download.last_used_at <= clock_timestamp() - interval '300 seconds'
    or p_sequence is null or p_sequence < 0 or p_sequence >= v_download.chunk_count then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_review := private.assigned_claim_review_v1(v_download.review_id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required')
    or v_download.review_revision is distinct from v_review.review_revision
    or not exists(select 1 from private.claim_review_assignments a where a.review_id=v_review.id
      and a.reviewer_account_id=v_reviewer.account_id and a.status='current'
      and a.assignment_revision=v_download.assignment_revision) then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, v_download.document_id);
  if v_document.id is null or v_document.sha256 <> v_download.sha256 then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  update private.claim_review_downloads set last_used_at = clock_timestamp() where id = v_download.id;
  return jsonb_build_object('objectKey', v_document.object_key, 'sha256', v_document.sha256,
    'byteCount', v_document.byte_count, 'chunkCount', v_download.chunk_count,
    'receiptChallenge', private.claim_review_receipt_challenge_v1(v_download.id,p_sequence),
    'documentId', v_document.id, 'reviewId',v_review.id,
    'wrappedDataKey', (select encode(ds.wrapped_document_key,'hex') from private.claim_document_sessions ds
      where ds.id=v_document.session_id));
end;
$$;

-- Immutable binding; erasure can never be reversed or restore another key.
create function private.guard_claim_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if (new.id,new.intake_id,new.document_id,new.document_kind) is distinct from
     (old.id,old.intake_id,old.document_id,old.document_kind)
     or (old.wrapped_document_key is null and
       (new.wrapped_document_key is not null or new.document_key_shredded_at is distinct from old.document_key_shredded_at))
     or (old.wrapped_document_key is not null and new.wrapped_document_key is not null
       and new.wrapped_document_key is distinct from old.wrapped_document_key) then
     raise exception using errcode='42501',message='claim document key immutable';
   end if;
 end if;
 if new.state='failed' then
   new.wrapped_document_key:=null;
   new.document_key_shredded_at:=coalesce(new.document_key_shredded_at,clock_timestamp());
 end if;
 return new;
end $$;
revoke all on function private.guard_claim_document_key_v1() from public,anon,authenticated,service_role;
create trigger claim_document_key_immutable before insert or update on private.claim_document_sessions
 for each row execute function private.guard_claim_document_key_v1();

create function private.shred_refused_claim_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='refused' then
   update private.claim_document_sessions set wrapped_document_key=null,
     document_key_shredded_at=coalesce(document_key_shredded_at,clock_timestamp())
   where id=new.session_id and wrapped_document_key is not null;
 end if;
 return new;
end $$;
revoke all on function private.shred_refused_claim_document_key_v1() from public,anon,authenticated,service_role;
create trigger claim_document_refusal_shreds_key after insert or update of state on private.claim_documents
 for each row execute function private.shred_refused_claim_document_key_v1();

create or replace function private.shred_resolved_future_person_review_v1(p_review uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.claim_reviews where id=p_review and state in('refused','closed')
   and resolved_at is not null) then raise exception using errcode='42501',message='claim review unavailable';end if;
 update private.future_person_claim_intakes set identity_ciphertext=extensions.gen_random_bytes(29),
   wrapped_data_key=extensions.gen_random_bytes(29),identity_key_shredded_at=clock_timestamp(),
   key_hash=case when mode='keyless-start' then null else encode(extensions.gen_random_bytes(32),'hex') end,
   identifier_hmac=encode(extensions.gen_random_bytes(32),'hex'),network_hmac=encode(extensions.gen_random_bytes(32),'hex')
 where id=p_review and identity_key_shredded_at is null;
 update private.claim_document_sessions set wrapped_document_key=null,document_key_shredded_at=clock_timestamp()
 where intake_id=p_review and wrapped_document_key is not null;
 update private.claim_review_decisions set reason_ciphertext=extensions.gen_random_bytes(29),
   documentary_attestation_ciphertext=null,verified_identity_hmac=null,identity_hmac_revision=null,
   verified_date_of_birth=null,recorded_parent_link_confirmed=false where review_id=p_review;
 update private.claim_review_assignments set status='ended',ended_at=clock_timestamp() where review_id=p_review and status='current';
 update private.claim_review_downloads set expires_at=created_at where review_id=p_review;
end $$;
revoke all on function private.shred_resolved_future_person_review_v1(uuid) from public,anon,authenticated,service_role;

create function private.shred_terminal_claim_review_keys_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state in('refused','closed') and new.resolved_at is not null then
   perform private.shred_resolved_future_person_review_v1(new.id);
 end if;
 return new;
end $$;
revoke all on function private.shred_terminal_claim_review_keys_v1() from public,anon,authenticated,service_role;
create trigger claim_review_terminal_shreds_keys after update of state,resolved_at on private.claim_reviews
 for each row execute function private.shred_terminal_claim_review_keys_v1();

-- Erase due keys before Storage deletion. A stalled/deleted object is still
-- unreadable even when the Storage deletion itself must be retried later.
create function private.shred_due_claim_working_keys_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare total integer:=0;n integer;
begin
 update private.claim_document_sessions s set wrapped_document_key=null,document_key_shredded_at=clock_timestamp()
 where s.id in(select ds.id from private.claim_document_sessions ds
   join private.future_person_claim_intakes i on i.id=ds.intake_id
   where ds.wrapped_document_key is not null and
     (ds.state='failed' or (not exists(select 1 from private.claim_documents d where d.session_id=ds.id
         and d.state<>'refused' and private.claim_document_retained_v1(d))
       and (ds.expires_at<=clock_timestamp() or not private.claim_intake_live_v1(i))))
   order by ds.id limit 1000 for update of ds skip locked);
 get diagnostics n=row_count;total:=total+n;
 update private.future_person_claim_intakes i set identity_ciphertext=extensions.gen_random_bytes(29),
   wrapped_data_key=extensions.gen_random_bytes(29),identity_key_shredded_at=clock_timestamp(),
   key_hash=case when mode='keyless-start' then null else encode(extensions.gen_random_bytes(32),'hex') end,
   identifier_hmac=encode(extensions.gen_random_bytes(32),'hex'),network_hmac=encode(extensions.gen_random_bytes(32),'hex')
 where i.id in(select ci.id from private.future_person_claim_intakes ci
   where ci.identity_key_shredded_at is null and not private.claim_intake_live_v1(ci)
     and not exists(select 1 from private.claim_reviews r where r.id=ci.id and private.claim_review_open_v1(r))
   order by ci.id limit 1000 for update of ci skip locked);
 get diagnostics n=row_count;return total+n;
end $$;
create function public.shred_due_claim_working_keys_v1()
returns integer language sql security invoker set search_path='' as $$select private.shred_due_claim_working_keys_v1();$$;
revoke all on function private.shred_due_claim_working_keys_v1(),public.shred_due_claim_working_keys_v1()
 from public,anon,authenticated,service_role;
grant execute on function private.shred_due_claim_working_keys_v1(),public.shred_due_claim_working_keys_v1() to service_role;


-- Identity envelope keys also cannot be restored after their terminal erase.
create function private.guard_claim_identity_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.identity_key_shredded_at is not null and
   (new.wrapped_data_key is distinct from old.wrapped_data_key
     or new.identity_key_shredded_at is distinct from old.identity_key_shredded_at) then
   raise exception using errcode='42501',message='claim identity key immutable';
 end if;
 if new.identity_key_shredded_at is not null and octet_length(new.wrapped_data_key)<>29 then
   raise exception using errcode='42501',message='claim identity key immutable';
 end if;
 return new;
end $$;
revoke all on function private.guard_claim_identity_key_v1() from public,anon,authenticated,service_role;
create trigger claim_identity_key_irreversible before update on private.future_person_claim_intakes
 for each row execute function private.guard_claim_identity_key_v1();
