-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge.
-- =====================================================================
--
-- api.subject-download (GET /api/subjects/[id]/download?file=...), owner
-- decision of 16 October 2026 ("The subjects endpoints (G2.1)",
-- docs/protocol/decisions.md): a revocable genome chunk session for the
-- person's own data only, with no signed URL.
--
--   1. The session is the declared public.download_sessions row
--      (20260831224054_storage_and_download_sessions.sql:66-91), reused
--      rather than superseded: every deletion, revocation and account purge
--      that already removes download_sessions by object, principal or
--      subject keeps covering it. It gains the columns
--      revocable-chunk-session-v1 needs and never had a writer for: the
--      SHA-256 of a 256-bit download cookie (the only credential, never
--      stored itself), the originating auth session and its revisions, the
--      exact file, object version, size, SHA-256 and chunk count, and an
--      idle clock (one hour absolute, five minutes idle).
--   2. The create step (public.open_subject_original_download_v1) admits
--      only the register's own-right cases: the route subject is the
--      caller's self record, or an adult record whose subject_account_id is
--      the caller. It reuses the existing own-source check
--      (private.own_export_source_v1), which rechecks the live account,
--      session, profile, subject binding, the file's single-sample
--      structural evidence (genetic-file-ingest-v1.ordinarySubjectSingleSample)
--      and its integrity record: the current genome_storage_objects row and
--      the Storage object with the recorded SHA-256 and size. A retired or
--      deleted original, an embryo, an uploader, a grantee, a held Path B
--      file (no genome_files row) and any other subject all refuse with the
--      same opaque not-found.
--   3. Every chunk (public.authorize_subject_original_chunk_v1) recomputes
--      the whole authority and compares its fingerprint and the Storage
--      object version with the row before any byte is read, and
--      public.record_subject_original_chunk_v1 rechecks it again after the
--      read, so a revocation during the read still stops delivery. Ranges
--      served are recorded in public.download_ranges.
--
-- Nothing here grants a purpose, reads a genotype or returns a bucket name
-- to a client. The service transport alone receives the object key.

alter table public.download_sessions
 add column cookie_hash text unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
 add column file_id uuid references public.genome_files (id) on delete cascade,
 add column object_version text,
 add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
 add column chunk_count integer check (chunk_count > 0),
 add column account_auth_session_revision bigint check (account_auth_session_revision > 0),
 add column originating_session_revision bigint check (originating_session_revision > 0),
 add column last_activity_at timestamptz,
 add constraint download_sessions_subject_original_shape check (
  purpose <> 'subject-original-download' or (
   target_kind = 'subject' and cookie_hash is not null and file_id is not null
   and object_version is not null and sha256 is not null and chunk_count is not null
   and account_auth_session_revision is not null and originating_session_revision is not null
   and last_activity_at is not null and grant_revision is null
   and chunk_count = (max_bytes + 3999999) / 4000000
   and expires_at <= created_at + interval '1 hour'));
create index download_sessions_subject_original_idx on public.download_sessions (file_id, status)
 where purpose = 'subject-original-download';

-- The own-right authority for one file of one route subject, or 42501. The
-- returned fingerprint binds every revision a later chunk must still match.
create function private.subject_original_download_authority_v1(p_account_id uuid, p_session_id uuid,
 p_subject_id uuid, p_file_id uuid, p_checkpoint text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $function$
declare v_source jsonb; s public.subjects%rowtype; f public.genome_files%rowtype;
 r private.own_original_retirements%rowtype; v_version text; v_mitigation jsonb; v_fingerprint text;
 v_session_revision bigint; v_profile public.profiles%rowtype;
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null or p_file_id is null
  or p_checkpoint not in ('download-session-create', 'every-download-chunk') then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 -- The existing own-source check: live account and session, a current own
 -- binding, the single-sample evidence and the current integrity record.
 v_source := private.own_export_source_v1(p_account_id, p_session_id, p_file_id);
 if v_source is null or (v_source #>> '{file,subject_id}')::uuid is distinct from p_subject_id then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 select * into s from public.subjects where id = p_subject_id for share;
 select * into f from public.genome_files where id = p_file_id for share;
 -- Own data only: the self record, or an adult record bound to this account.
 -- An uploader, grantee or embryo case is not this route's case yet.
 if s.id is null or f.id is null or f.subject_id is distinct from s.id
  or s.subject_account_id is distinct from p_account_id
  or s.lifecycle not in ('active', 'restricted')
  or not ((s.subject_class = 'self' and s.owner_account_id = p_account_id) or s.subject_class = 'other_adult')
  or f.is_cohort_file or f.cohort_id is not null or f.sample_count <> 1
  or f.sha256 is null or f.sha256 !~ '^[0-9a-f]{64}$' or f.size_bytes is null or f.size_bytes < 1
  or f.storage_object_id is null then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 if private.public_appeal_target_held_v1('subject', s.id) then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 -- other-adult-mitigation-state-v1 applies to a Path B record.
 if exists (select 1 from public.adult_subject_drafts d where d.subject_id = s.id
   and d.adult_flow in ('path-b-subject-esignature', 'path-b-reviewed-document')) then
  v_mitigation := private.other_adult_mitigation_v1(s.id, p_account_id, p_checkpoint);
  if v_mitigation ->> 'decision' not in ('subject-own-right-only', 'allow') then
   raise exception using errcode = '42501', message = 'not_found'; end if;
 end if;
 -- The original itself must still exist: not deleting, not retired.
 if exists (select 1 from private.genome_file_deletions where file_id = f.id) then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 select * into r from private.own_original_retirements where file_id = f.id for share;
 if r.file_id is not null and (r.state = 'retired' or r.delete_started_at is not null
  or r.expires_at <= clock_timestamp() + interval '1 minute') then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 perform 1 from public.genome_storage_objects g where g.genome_file_id = f.id
  and g.object_id = f.storage_object_id and g.bucket_id = 'genomes' and g.object_name = f.bucket_path
  and g.sha256 = f.sha256 and g.byte_count = f.size_bytes and g.object_revision = f.upload_revision
  and g.state = 'current' and g.revoked_at is null for share;
 if not found then raise exception using errcode = '42501', message = 'not_found'; end if;
 select o.version into v_version from storage.objects o where o.id = f.storage_object_id
  and o.bucket_id = 'genomes' and o.name = f.bucket_path and (o.metadata ->> 'size')::numeric = f.size_bytes
  and (r.file_id is null or o.version = r.storage_version::text) for share;
 if v_version is null or length(v_version) not between 1 and 200 then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 select * into v_profile from public.profiles where id = p_account_id;
 select coalesce(refresh_token_counter, 0) + 1 into v_session_revision from auth.sessions
  where id = p_session_id and user_id = p_account_id;
 v_fingerprint := encode(extensions.digest(jsonb_build_object('version', 'subject-original-download-v1',
  'binding', v_source -> 'binding', 'subject', jsonb_build_object('id', s.id, 'class', s.subject_class,
   'lifecycle', s.lifecycle, 'lifecycleRevision', s.lifecycle_revision, 'bindingRevision', s.subject_binding_revision),
  'file', jsonb_build_object('id', f.id, 'sha256', f.sha256, 'sourceSha256', f.source_sha256, 'size', f.size_bytes,
   'uploadRevision', f.upload_revision, 'publicationRevision', f.source_publication_revision,
   'objectId', f.storage_object_id, 'objectKey', f.bucket_path, 'objectVersion', v_version))::text, 'sha256'), 'hex');
 return jsonb_build_object('fingerprint', v_fingerprint, 'principalId', v_source #>> '{binding,accountPrincipalId}',
  'lifecycleRevision', s.lifecycle_revision, 'publicationRevision', f.source_publication_revision,
  'objectId', f.storage_object_id, 'objectKey', f.bucket_path, 'objectVersion', v_version,
  'sha256', f.sha256, 'sizeBytes', f.size_bytes, 'fileType', f.file_type, 'originalName', f.original_name,
  'sourceSha256', f.source_sha256, 'authSessionRevision', v_profile.auth_session_revision,
  'sessionRevision', v_session_revision,
  'retirementExpiresAt', r.expires_at);
end;
$function$;
revoke all on function private.subject_original_download_authority_v1(uuid, uuid, uuid, uuid, text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- invalid-request-v1.authorizationPrecedence: whether the route subject is one
-- this live account may download from at all, asked only to choose between
-- the opaque 404 and a field error for a malformed query. It names no file.
create function public.subject_original_download_target_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog
as $function$
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null then return false; end if;
 perform 1 from auth.users u join auth.sessions x on x.user_id = u.id
  where u.id = p_account_id and x.id = p_session_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until <= clock_timestamp())
   and (x.not_after is null or x.not_after > clock_timestamp());
 if not found then return false; end if;
 return exists (select 1 from public.subjects s
  join public.subject_account_bindings b on b.subject_id = s.id and b.account_id = p_account_id and b.status = 'current'
  where s.id = p_subject_id and s.subject_account_id = p_account_id and s.lifecycle in ('active', 'restricted')
   and ((s.subject_class = 'self' and s.owner_account_id = p_account_id) or s.subject_class = 'other_adult'));
end;
$function$;
revoke all on function public.subject_original_download_target_v1(uuid, uuid, uuid)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.subject_original_download_target_v1(uuid, uuid, uuid) to service_role;

-- The create step. One live session per account and file: a new one ends the
-- earlier one, so an old cookie stops working at once.
create function public.open_subject_original_download_v1(p_account_id uuid, p_session_id uuid,
 p_subject_id uuid, p_file_id uuid, p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $function$
declare a jsonb; v_now timestamptz; v_expires timestamptz; v_id uuid; v_chunks integer;
begin
 if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 a := private.subject_original_download_authority_v1(p_account_id, p_session_id, p_subject_id, p_file_id,
  'download-session-create');
 v_now := clock_timestamp();
 v_expires := least(v_now + interval '1 hour', coalesce((a ->> 'retirementExpiresAt')::timestamptz, 'infinity'));
 if v_expires <= v_now + interval '1 minute' then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 v_chunks := (((a ->> 'sizeBytes')::bigint + 3999999) / 4000000)::integer;
 update public.download_sessions set status = 'revoked', ended_at = v_now, session_revision = session_revision + 1
  where purpose = 'subject-original-download' and account_id = p_account_id and file_id = p_file_id
   and status = 'active';
 insert into public.download_sessions (account_id, auth_session_id, principal_id, target_kind, target_id, purpose,
  object_id, lifecycle_revision, grant_revision, publication_revision, authorization_fingerprint, status, max_bytes,
  expires_at, created_at, cookie_hash, file_id, object_version, sha256, chunk_count, account_auth_session_revision,
  originating_session_revision, last_activity_at)
 values (p_account_id, p_session_id, (a ->> 'principalId')::uuid, 'subject', p_subject_id, 'subject-original-download',
  (a ->> 'objectId')::uuid, (a ->> 'lifecycleRevision')::bigint, null, (a ->> 'publicationRevision')::bigint,
  a ->> 'fingerprint', 'active', (a ->> 'sizeBytes')::bigint, v_expires, v_now, p_cookie_hash, p_file_id,
  a ->> 'objectVersion', a ->> 'sha256', v_chunks, (a ->> 'authSessionRevision')::bigint,
  (a ->> 'sessionRevision')::bigint, v_now)
 returning id into v_id;
 perform private.append_legal_audit_event('download.session.created', null, 'api.subject-download', 'accepted',
  jsonb_build_object('kind', 'subject-original'));
 return jsonb_build_object('session', v_id, 'sizeBytes', (a ->> 'sizeBytes')::bigint, 'sha256', a ->> 'sha256',
  'chunkCount', v_chunks, 'fileType', a ->> 'fileType', 'originalName', a ->> 'originalName',
  'sourceSha256', a ->> 'sourceSha256', 'expiresAt', v_expires);
end;
$function$;
revoke all on function public.open_subject_original_download_v1(uuid, uuid, uuid, uuid, text)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.open_subject_original_download_v1(uuid, uuid, uuid, uuid, text) to service_role;

-- The session a chunk names, locked, with its whole authority recomputed.
-- Null only when the id is not a subject original session at all, so the
-- shared chunk route can try its other session kinds; anything else that
-- does not authorize ends the session and is the opaque 42501.
create function private.subject_original_download_at_v1(p_account_id uuid, p_session_id uuid,
 p_download_id uuid, p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $function$
declare d public.download_sessions%rowtype; a jsonb; v_now timestamptz := clock_timestamp();
begin
 select * into d from public.download_sessions where id = p_download_id;
 if d.id is null or d.purpose is distinct from 'subject-original-download' then return null; end if;
 if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' or d.cookie_hash is distinct from p_cookie_hash
  or d.account_id is distinct from p_account_id or d.auth_session_id is distinct from p_session_id then
  raise exception using errcode = '42501', message = 'not_found'; end if;
 select * into d from public.download_sessions where id = p_download_id for update;
 if d.status <> 'active' then raise exception using errcode = '42501', message = 'not_found'; end if;
 if d.expires_at <= v_now or d.last_activity_at <= v_now - interval '5 minutes' then
  update public.download_sessions set status = 'expired', ended_at = v_now where id = d.id;
  return jsonb_build_object('ended', true);
 end if;
 begin
  a := private.subject_original_download_authority_v1(p_account_id, p_session_id, d.target_id, d.file_id,
   'every-download-chunk');
 exception when sqlstate '42501' then
  a := null;
 end;
 if a is null or a ->> 'fingerprint' is distinct from d.authorization_fingerprint
  or a ->> 'objectVersion' is distinct from d.object_version or a ->> 'sha256' is distinct from d.sha256
  or (a ->> 'sizeBytes')::bigint is distinct from d.max_bytes or (a ->> 'objectId')::uuid is distinct from d.object_id
  or (a ->> 'authSessionRevision')::bigint is distinct from d.account_auth_session_revision
  or (a ->> 'sessionRevision')::bigint is distinct from d.originating_session_revision then
  update public.download_sessions set status = 'revoked', ended_at = v_now, session_revision = session_revision + 1
   where id = d.id;
  return jsonb_build_object('ended', true);
 end if;
 return jsonb_build_object('ended', false, 'session', to_jsonb(d), 'authority', a);
end;
$function$;
revoke all on function private.subject_original_download_at_v1(uuid, uuid, uuid, text)
 from public, anon, authenticated, inherit_upload_only, service_role;

-- Before the Storage read: the exact object, version and byte range of one
-- canonical sequence. A sequence past the end is an invalid request (22023).
create function public.authorize_subject_original_chunk_v1(p_account_id uuid, p_session_id uuid,
 p_download_id uuid, p_cookie_hash text, p_sequence integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $function$
declare v jsonb; d public.download_sessions%rowtype; v_start bigint; v_end bigint;
begin
 v := private.subject_original_download_at_v1(p_account_id, p_session_id, p_download_id, p_cookie_hash);
 if v is null then return null; end if;
 -- An ended session's status change is kept; the answer is the opaque 404.
 if (v ->> 'ended')::boolean then return jsonb_build_object('status', 'ended'); end if;
 d := jsonb_populate_record(null::public.download_sessions, v -> 'session');
 if p_sequence is null or p_sequence < 0 or p_sequence >= d.chunk_count then
  raise exception using errcode = '22023', message = 'invalid_request'; end if;
 v_start := p_sequence::bigint * 4000000;
 v_end := least(v_start + 4000000, d.max_bytes) - 1;
 update public.download_sessions set last_activity_at = clock_timestamp() where id = d.id;
 return jsonb_build_object('status', 'authorized', 'session', d.id, 'objectKey', v #>> '{authority,objectKey}',
  'objectVersion', d.object_version, 'sha256', d.sha256, 'sizeBytes', d.max_bytes, 'chunkCount', d.chunk_count,
  'start', v_start, 'end', v_end, 'expiresAt', d.expires_at);
end;
$function$;
revoke all on function public.authorize_subject_original_chunk_v1(uuid, uuid, uuid, text, integer)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.authorize_subject_original_chunk_v1(uuid, uuid, uuid, text, integer) to service_role;

-- After the Storage read and before any byte leaves: the same authority
-- again, and the served range recorded once.
create function public.record_subject_original_chunk_v1(p_account_id uuid, p_session_id uuid,
 p_download_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer)
returns text language plpgsql security definer set search_path = pg_catalog, private
as $function$
declare v jsonb; d public.download_sessions%rowtype; v_start bigint; v_end bigint; v_inserted integer;
begin
 v := private.subject_original_download_at_v1(p_account_id, p_session_id, p_download_id, p_cookie_hash);
 if v is null or (v ->> 'ended')::boolean then return 'ended'; end if;
 d := jsonb_populate_record(null::public.download_sessions, v -> 'session');
 if p_sequence is null or p_sequence < 0 or p_sequence >= d.chunk_count then
  raise exception using errcode = '22023', message = 'invalid_request'; end if;
 v_start := p_sequence::bigint * 4000000;
 v_end := least(v_start + 4000000, d.max_bytes) - 1;
 if p_byte_count is distinct from (v_end - v_start + 1)::integer then
  raise exception using errcode = '22023', message = 'invalid_request'; end if;
 insert into public.download_ranges (session_id, range_sequence, byte_start, byte_end)
 values (d.id, p_sequence, v_start, v_end) on conflict do nothing;
 get diagnostics v_inserted = row_count;
 update public.download_sessions set last_activity_at = clock_timestamp(),
  served_bytes = served_bytes + case when v_inserted = 1 then v_end - v_start + 1 else 0 end
  where id = d.id;
 if v_inserted = 1 then
  perform private.append_legal_audit_event('download.chunk.read', null, 'api.download-chunk', 'accepted',
   jsonb_build_object('kind', 'subject-original'));
 end if;
 return 'recorded';
end;
$function$;
revoke all on function public.record_subject_original_chunk_v1(uuid, uuid, uuid, text, integer, integer)
 from public, anon, authenticated, inherit_upload_only;
grant execute on function public.record_subject_original_chunk_v1(uuid, uuid, uuid, text, integer, integer) to service_role;

-- jobs.retention: an ended or expired session holds identifiers only, and is
-- removed with its served ranges an hour after it can no longer be used.
create function public.purge_ended_subject_original_downloads_v1()
returns integer language plpgsql security definer set search_path = pg_catalog
as $function$
declare v_count integer;
begin
 delete from public.download_sessions where purpose = 'subject-original-download'
  and (expires_at <= clock_timestamp() - interval '1 hour'
   or (status <> 'active' and ended_at <= clock_timestamp() - interval '1 hour'));
 get diagnostics v_count = row_count;
 return v_count;
end;
$function$;
revoke all on function public.purge_ended_subject_original_downloads_v1() from public, anon, authenticated, inherit_upload_only;
grant execute on function public.purge_ended_subject_original_downloads_v1() to service_role;
