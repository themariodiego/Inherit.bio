-- Claim session rotation and reviewer byte-receipt proofs. TEST-LOCAL only.
-- Rotation and its original absolute deadline commit in the same transaction
-- as the document/session or completion operation; no GET writes a nonce.
create function private.open_claim_document_session_rotated_v1(
  p_claim_session_hash text, p_successor_claim_session_hash text, p_create_nonce_hash text,
  p_document_kind text, p_media_type text, p_size_bytes integer, p_sha256 text, p_cookie_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_successor_claim_session_hash is null or p_successor_claim_session_hash !~ '^[0-9a-f]{64}$'
    or p_successor_claim_session_hash = p_claim_session_hash then
    raise exception using errcode = '22023', message = 'claim session rotation invalid';
  end if;
  v_result := private.open_claim_document_session_v1(p_claim_session_hash, p_create_nonce_hash,
    p_document_kind, p_media_type, p_size_bytes, p_sha256, p_cookie_hash);
  if v_result->>'status' = 'open' then
    update private.future_person_claim_intakes set session_hash = p_successor_claim_session_hash
    where session_hash = p_claim_session_hash;
    if not found then raise exception using errcode = '42501', message = 'claim session unavailable'; end if;
  end if;
  return v_result;
end;
$$;
create function public.open_claim_document_session_rotated_v1(
  p_claim_session_hash text, p_successor_claim_session_hash text, p_create_nonce_hash text,
  p_document_kind text, p_media_type text, p_size_bytes integer, p_sha256 text, p_cookie_hash text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.open_claim_document_session_rotated_v1(p_claim_session_hash, p_successor_claim_session_hash,
    p_create_nonce_hash, p_document_kind, p_media_type, p_size_bytes, p_sha256, p_cookie_hash);
$$;
revoke all on function private.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text),
  public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text),
  public.open_claim_document_session_rotated_v1(text,text,text,text,text,integer,text,text) to service_role;

create function private.complete_future_person_claim_rotated_v1(
  p_session_hash text, p_successor_session_hash text, p_nonce_hash text, p_mode text,
  p_photo_document_id uuid, p_birth_record_document_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_expiry timestamptz;
begin
  if p_successor_session_hash is null or p_successor_session_hash !~ '^[0-9a-f]{64}$'
    or p_successor_session_hash = p_session_hash then
    raise exception using errcode = '22023', message = 'claim session rotation invalid';
  end if;
  v_status := private.complete_future_person_claim_v1(p_session_hash, p_nonce_hash, p_mode,
    p_photo_document_id, p_birth_record_document_id);
  update private.future_person_claim_intakes set session_hash = p_successor_session_hash
  where session_hash = p_session_hash returning expires_at into v_expiry;
  if not found then raise exception using errcode = '42501', message = 'claim session unavailable'; end if;
  return jsonb_build_object('status', v_status, 'expiresAt', v_expiry);
end;
$$;
create function public.complete_future_person_claim_rotated_v1(
  p_session_hash text, p_successor_session_hash text, p_nonce_hash text, p_mode text,
  p_photo_document_id uuid, p_birth_record_document_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.complete_future_person_claim_rotated_v1(p_session_hash, p_successor_session_hash,
    p_nonce_hash, p_mode, p_photo_document_id, p_birth_record_document_id);
$$;
revoke all on function private.complete_future_person_claim_rotated_v1(text,text,text,text,uuid,uuid),
  public.complete_future_person_claim_rotated_v1(text,text,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_future_person_claim_rotated_v1(text,text,text,text,uuid,uuid),
  public.complete_future_person_claim_rotated_v1(text,text,text,text,uuid,uuid) to service_role;

-- An authorized Storage read is not delivery. Only a complete client proof
-- accepted under the same live reviewer/assignment/credential counts.
alter table private.claim_review_downloads add column review_revision bigint,
  add column assignment_revision bigint, add column revoked_at timestamptz;
alter table private.claim_review_reads add column delivery_verified_at timestamptz,
  add column assignment_revision bigint,
  add column document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  add column account_auth_session_revision bigint,
  add column originating_session_revision bigint;
create table private.claim_review_receipt_sessions (
  download_id uuid primary key references private.claim_review_downloads(id) on delete cascade,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  challenge bytea not null check (octet_length(challenge) = 32),
  created_at timestamptz not null default clock_timestamp()
);
create table private.claim_review_chunk_receipts (
  download_id uuid not null references private.claim_review_receipt_sessions(download_id) on delete cascade,
  sequence integer not null check (sequence between 0 and 4),
  expected_proof text not null check (expected_proof ~ '^[0-9a-f]{64}$'),
  acknowledged_at timestamptz,
  acknowledgement_nonce_hash text unique check (acknowledgement_nonce_hash ~ '^[0-9a-f]{64}$'),
  primary key(download_id, sequence)
);
alter table private.claim_review_receipt_sessions enable row level security;
alter table private.claim_review_chunk_receipts enable row level security;
revoke all on private.claim_review_receipt_sessions, private.claim_review_chunk_receipts
  from public, anon, authenticated, service_role;
insert into public.purge_target_stores(target_id, store_name, store_order) values
  ('claim-review-working-packages','private.claim_review_receipt_sessions',16),
  ('claim-review-working-packages','private.claim_review_chunk_receipts',17);

create function private.claim_review_receipt_challenge_v1(p_session uuid, p_sequence integer)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(encode(r.challenge,'hex') || '|' || d.id::text || '|' ||
    p_sequence::text || '|' || d.sha256,'UTF8'),'sha256'),'hex')
  from private.claim_review_receipt_sessions r join private.claim_review_downloads d on d.id=r.download_id
  where d.id=p_session and p_sequence between 0 and d.chunk_count-1;
$$;
revoke all on function private.claim_review_receipt_challenge_v1(uuid,integer) from public,anon,authenticated,service_role;

create or replace function private.open_claim_review_download_v1(p_document_id uuid, p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reviewer record;
  v_review private.claim_reviews;
  v_document private.claim_documents;
  v_download private.claim_review_downloads;
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim review download invalid';
  end if;
  select * into v_reviewer from private.claim_reviewer_step_up_v1();
  if v_reviewer.account_id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  select r.id into v_review.id from private.claim_reviews r
  where r.photo_document_id = p_document_id or r.birth_record_document_id = p_document_id;
  v_review := private.assigned_claim_review_v1(v_review.id, v_reviewer.account_id);
  if v_review.id is null or v_review.state not in ('document_review_pending', 'more_information_required') then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  v_document := private.claim_review_document_v1(v_review, p_document_id);
  if v_document.id is null then
    raise exception using errcode = '42501', message = 'claim review unavailable';
  end if;
  update private.claim_review_downloads set revoked_at=clock_timestamp()
  where reviewer_account_id=v_reviewer.account_id and auth_session_id=v_reviewer.auth_session_id and revoked_at is null;
  insert into private.claim_review_downloads (cookie_hash, review_id, document_id, reviewer_account_id,
    auth_session_id, account_auth_session_revision, originating_session_revision,
    sha256, byte_count, chunk_count, created_at, last_used_at, expires_at)
  select p_cookie_hash, v_review.id, v_document.id, v_reviewer.account_id, v_reviewer.auth_session_id,
    v_reviewer.account_auth_session_revision, v_reviewer.session_revision,
    v_document.sha256, v_document.byte_count, ceil(v_document.byte_count / 4000000.0)::integer,
    t.now_at, t.now_at, t.now_at + interval '1 hour'
  from (select clock_timestamp() as now_at) t
  returning * into v_download;
  update private.claim_review_downloads set review_revision=v_review.review_revision,
    assignment_revision=(select a.assignment_revision from private.claim_review_assignments a
      where a.review_id=v_review.id and a.reviewer_account_id=v_reviewer.account_id and a.status='current')
  where id=v_download.id;
  return jsonb_build_object('session', v_download.id, 'sizeBytes', v_download.byte_count,
    'sha256', v_download.sha256, 'chunkCount', v_download.chunk_count, 'mediaType', v_document.media_type,
    'documentKind', v_document.document_kind);
end;
$$;
revoke all on function private.open_claim_review_download_v1(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.open_claim_review_download_v1(uuid, text) to authenticated;


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
    'wrappedDataKey', (select encode(i.wrapped_data_key, 'hex') from private.future_person_claim_intakes i
      where i.id = v_review.id));
end;
$$;
revoke all on function private.authorize_claim_review_chunk_v1(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function private.authorize_claim_review_chunk_v1(uuid, text, integer) to authenticated;


-- Only this POST consumes an operation nonce and creates a receipt challenge.
create function private.open_claim_review_receipt_v1(p_session_id uuid,p_cookie_hash text,p_nonce_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_grant jsonb; v_download private.claim_review_downloads;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='claim receipt invalid'; end if;
  v_grant:=private.authorize_claim_review_chunk_v1(p_session_id,p_cookie_hash,0);
  select * into v_download from private.claim_review_downloads where id=p_session_id for update;
  insert into private.claim_review_receipt_sessions(download_id,nonce_hash,challenge)
    values(p_session_id,p_nonce_hash,extensions.gen_random_bytes(32));
  return jsonb_build_object('session',p_session_id,'chunks',(select jsonb_agg(
    jsonb_build_object('sequence',n,'challenge',private.claim_review_receipt_challenge_v1(p_session_id,n)) order by n)
    from generate_series(0,v_download.chunk_count-1) n));
end;
$$;
create function public.open_claim_review_receipt_v1(p_session_id uuid,p_cookie_hash text,p_nonce_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.open_claim_review_receipt_v1(p_session_id,p_cookie_hash,p_nonce_hash);
$$;
revoke all on function private.open_claim_review_receipt_v1(uuid,text,text),public.open_claim_review_receipt_v1(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.open_claim_review_receipt_v1(uuid,text,text),public.open_claim_review_receipt_v1(uuid,text,text) to authenticated;

-- The JWT can authorize a read, but cannot create the expected delivery proof.
-- It is prepared only by service code from the verified plaintext bytes.
create function private.prepare_claim_review_chunk_receipt_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_expected_proof text)
returns void language plpgsql security definer set search_path='' as $$
declare v_download private.claim_review_downloads; v_existing text;
begin
  if p_expected_proof is null or p_expected_proof !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='claim receipt invalid'; end if;
  select * into v_download from private.claim_review_downloads where id=p_session_id and cookie_hash=p_cookie_hash for update;
  if v_download.id is null or v_download.revoked_at is not null or v_download.expires_at<=clock_timestamp()
    or p_sequence is null or p_sequence not between 0 and v_download.chunk_count-1
    or not exists(select 1 from private.claim_review_receipt_sessions where download_id=p_session_id)
    or not exists(select 1 from private.claim_review_assignments a join private.claim_reviews r on r.id=a.review_id
      where a.review_id=v_download.review_id and a.reviewer_account_id=v_download.reviewer_account_id
      and a.status='current' and a.assignment_revision=v_download.assignment_revision
      and r.review_revision=v_download.review_revision and private.claim_review_open_v1(r)) then
    raise exception using errcode='42501',message='claim receipt unavailable'; end if;
  select expected_proof into v_existing from private.claim_review_chunk_receipts where download_id=p_session_id and sequence=p_sequence;
  if v_existing is not null and v_existing<>p_expected_proof then
    raise exception using errcode='42501',message='claim receipt unavailable'; end if;
  insert into private.claim_review_chunk_receipts(download_id,sequence,expected_proof)
    values(p_session_id,p_sequence,p_expected_proof) on conflict(download_id,sequence) do nothing;
end;
$$;
create function public.prepare_claim_review_chunk_receipt_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_expected_proof text)
returns void language sql security invoker set search_path='' as $$
  select private.prepare_claim_review_chunk_receipt_v1(p_session_id,p_cookie_hash,p_sequence,p_expected_proof);
$$;
revoke all on function private.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text),
  public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function private.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text),
  public.prepare_claim_review_chunk_receipt_v1(uuid,text,integer,text) to service_role;

-- This helper is never executable by a reviewer JWT or the public API.
create function private.settle_claim_review_chunk_receipt_v1(p_session_id uuid,p_sequence integer,p_proof text,p_nonce_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare v_receipt private.claim_review_chunk_receipts;
begin
  select * into v_receipt from private.claim_review_chunk_receipts
    where download_id=p_session_id and sequence=p_sequence for update;
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' or v_receipt.download_id is null or p_proof is null or p_proof !~ '^[0-9a-f]{64}$'
    or v_receipt.expected_proof<>p_proof or v_receipt.acknowledged_at is not null then
    raise exception using errcode='42501',message='claim receipt unavailable'; end if;
  update private.claim_review_chunk_receipts set acknowledged_at=clock_timestamp(),acknowledgement_nonce_hash=p_nonce_hash
    where download_id=p_session_id and sequence=p_sequence;
end;
$$;
revoke all on function private.settle_claim_review_chunk_receipt_v1(uuid,integer,text,text) from public,anon,authenticated,service_role;

create function private.acknowledge_claim_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_proof text,p_nonce_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare v_grant jsonb; v_download private.claim_review_downloads;
begin
  -- Acquires the same locks and rechecks current MFA, auth/assignment revisions,
  -- open case and clean document before the proof can be settled atomically.
  v_grant:=private.authorize_claim_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence);
  select * into v_download from private.claim_review_downloads where id=p_session_id for update;
  perform private.settle_claim_review_chunk_receipt_v1(p_session_id,p_sequence,p_proof,p_nonce_hash);
  insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,
    document_id,chunk_sequence,delivery_verified_at,assignment_revision,document_sha256,
    account_auth_session_revision,originating_session_revision)
  values(v_download.review_id,v_download.reviewer_account_id,v_download.auth_session_id,v_download.review_revision,
    v_download.document_id,p_sequence,clock_timestamp(),v_download.assignment_revision,v_download.sha256,
    v_download.account_auth_session_revision,v_download.originating_session_revision);
  perform private.append_legal_audit_event('claim.document.read',null,'api.claim-review-chunk-acknowledgement','accepted','{}'::jsonb);
end;
$$;
create function public.acknowledge_claim_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_proof text,p_nonce_hash text)
returns void language sql security invoker set search_path='' as $$
  select private.acknowledge_claim_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_proof,p_nonce_hash);
$$;
revoke all on function private.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text),
  public.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function private.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text),
  public.acknowledge_claim_review_chunk_v1(uuid,text,integer,text,text) to authenticated;

create or replace function private.claim_document_fully_read_v1(p_review_id uuid,p_account uuid,p_document private.claim_documents)
returns boolean language sql stable security definer set search_path='' as $$
  select (select count(distinct r.chunk_sequence) from private.claim_review_reads r
    join private.claim_review_assignments a on a.review_id=r.review_id and a.reviewer_account_id=r.reviewer_account_id
      and a.assignment_revision=r.assignment_revision and a.status='current'
    join private.claim_reviews c on c.id=r.review_id and c.review_revision=r.review_revision
    join public.profiles p on p.id=r.reviewer_account_id and p.auth_session_revision=r.account_auth_session_revision
    join auth.sessions s on s.id=r.auth_session_id and coalesce(s.refresh_token_counter,0)+1=r.originating_session_revision
    where r.review_id=p_review_id and r.reviewer_account_id=p_account and r.document_id=p_document.id
      and r.auth_session_id=(auth.jwt()->>'session_id')::uuid
      and r.delivery_verified_at is not null and r.document_sha256=p_document.sha256)
      =ceil(p_document.byte_count/4000000.0)::integer;
$$;
