-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Every entry point below is TEST-LOCAL: it refuses
-- unless the server passes the test-jurisdiction flag, which it does only
-- under INHERIT_TEST_JURISDICTION=1, and no jurisdiction is opened.
-- =====================================================================
--
-- The reviewed-document branch of Path B, built as one unit (owner decision
-- of 16 October 2026, "The subjects endpoints (G2.1)",
-- docs/protocol/decisions.md). The person still signs their own Path B text
-- (consent.subject-adult-esignature v1, decided 2026-09-28 for every Path B
-- confirmation); what differs is the uploader's evidence: a document the
-- person signed, read and approved by a named human before anything is sent.
--
--   1. The draft. closed-subject-draft-create-v1 gains the
--      path-b-reviewed-document body; invitation-kind-v1 maps it, once and
--      immutably, to path-b-token-or-account plus evidence kind
--      uploaded_document (route-register.json policyResolvers.invitation-kind-v1).
--   2. The uploader signs the same consent.upload-other-adult for that draft
--      (api.subjects.policy.uploaderArtifactPrecondition).
--   3. The permission document (api.legal-evidence-upload-session,
--      documentKind adult-signed-permission): one evidence-ingest-session-v1
--      row bound to the uploader's account, originating auth session and its
--      revisions, the draft and the uploader's current signature; chunks and
--      completion through the existing api.evidence-chunk and
--      api.evidence-complete doors, each sealed under the document's own key
--      in the private legal-evidence bucket, created here with the declared
--      policies (no client policy at all); a malware scan bound to the bytes.
--   4. Named-human review (api.legal-evidence-review-download and
--      api.legal-evidence-review, subject-draft target case): only a claim
--      reviewer the database owner named and assigned to this document, in an
--      MFA-stepped-up session, who has read every chunk of the exact bytes,
--      may approve or reject. Approval only makes the document eligible;
--      rejection makes it unreadable and ends its draft. Nothing here, and
--      nothing anywhere, approves automatically.
--   5. api.subjects (closed-subject-finalize-v1): the approved document and
--      review, the uploader's signature and the global contact refusal bar
--      under every held contact key revision. An eligible contact gets one
--      hidden request bound to the draft, document and review revisions; a
--      barred one gets none. Both answer the same receipt and leave the
--      uploader the same visible state.
--   6. Recipient activation (api.withdraw confirm and its account branch):
--      the existing Path B confirmation, now accepting this flow only after
--      rechecking the bar, the exact approved document, review and request
--      binding. Only then may the uploader open a held upload.
--
-- Retention: evidence.ingest-session-24h for sessions and fragments;
-- legal-evidence.adult-permission-24mo for the document (with its draft
-- before activation, a fixed 730 days after it); adult.subject-draft-30d for
-- the draft. Every ending shreds the document key first, then the retention
-- job deletes the objects and rows. A decision row keeps only the document
-- hash, kind, decision and dates; its reason ciphertext is destroyed with the
-- document.

-- 1. The draft flow ----------------------------------------------------------
alter table public.adult_subject_drafts drop constraint adult_subject_drafts_adult_flow_check;
alter table public.adult_subject_drafts add constraint adult_subject_drafts_adult_flow_check
 check (adult_flow in ('path-a-own-account','path-b-subject-esignature','path-b-reviewed-document'));
alter table public.adult_subject_drafts drop constraint adult_subject_drafts_evidence_kind_check;
alter table public.adult_subject_drafts add constraint adult_subject_drafts_evidence_kind_check
 check (evidence_kind in ('none','esignature','uploaded_document'));
alter table public.adult_subject_drafts drop constraint adult_subject_drafts_flow_check;
alter table public.adult_subject_drafts add constraint adult_subject_drafts_flow_check check (
 (adult_flow='path-a-own-account' and confirmation_mode='path-a-account-required' and evidence_kind='none'
  and request_key is null)
 or (adult_flow='path-b-subject-esignature' and confirmation_mode='path-b-token-or-account'
  and evidence_kind='esignature' and request_key is not null)
 or (adult_flow='path-b-reviewed-document' and confirmation_mode='path-b-token-or-account'
  and evidence_kind='uploaded_document' and request_key is not null));

-- 2. The legal-evidence bucket (storage.legal-evidence-v1) --------------------
-- Private, octet-stream only (every object is application-sealed), sized for
-- one sealed whole document. No Storage policy is added: anon and
-- authenticated can list, read, write and delete nothing here. Only the
-- service transport touches it, under keys this database generates.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-evidence', 'legal-evidence', false, 20000028, array['application/octet-stream'])
on conflict (id) do nothing;
do $$ begin
 if not exists (select 1 from storage.buckets where id = 'legal-evidence' and name = 'legal-evidence'
  and public = false and file_size_limit = 20000028 and allowed_mime_types = array['application/octet-stream']) then
  raise exception using errcode = '55000', message = 'legal_evidence_bucket_incompatible';
 end if;
 if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and (qual like '%legal-evidence%' or with_check like '%legal-evidence%')) then
  raise exception using errcode = '55000', message = 'legal_evidence_bucket_policy_present';
 end if;
end $$;

-- 3. Reserving a reviewed-document draft (api.subject-drafts) ----------------
-- The same reservation as the e-signature draft
-- (20260928150000_other_adult_held_upload.sql, section 4), with the flow,
-- mode and evidence kind this body maps to. A retried request id returns the
-- same draft; a request id is never shared between the two flows because the
-- route keys each under its own context.
create function private.create_path_b_reviewed_document_draft_core_v1(p_account_id uuid,p_session_id uuid,
 p_display_name text,p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,
 p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u jsonb; d public.adult_subject_drafts%rowtype; v_subject uuid; v_principal uuid; v_contact uuid;
 v_name text:=btrim(p_display_name); v_expires timestamptz:=clock_timestamp()+interval '30 days';
 v_revision bigint;
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if v_name is null or char_length(v_name)<2 or char_length(v_name)>80 or v_name ~ '[\x00-\x1f\x7f]'
  or p_date_of_birth is null or p_date_of_birth<date '1900-01-01'
  or p_contact_ciphertext is null or octet_length(p_contact_ciphertext)<16
  or p_contact_hmac is null or p_contact_hmac!~'^[0-9a-f]{64}$'
  or p_request_key is null or p_request_key!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- 18 or older by a UTC calculation on the server, never the client's.
 if p_date_of_birth>(timezone('UTC',clock_timestamp())::date-interval '18 years')::date then
  raise exception using errcode='22023',message='subject_not_adult'; end if;
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 if exists(select 1 from public.profiles where id=p_account_id and non_self_upload_suspended_at is not null) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into d from public.adult_subject_drafts where owner_account_id=p_account_id and request_key=p_request_key;
 if d.id is not null then
  if d.adult_flow<>'path-b-reviewed-document' then
   raise exception using errcode='22023',message='invalid_request'; end if;
  return jsonb_build_object('subjectDraftId',d.subject_id,'state','awaiting_uploader_artifact',
   'next','sign_uploader_artifact','expiresAt',d.fixed_expires_at); end if;
 insert into public.subjects(owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values(p_account_id,null,'other_adult','adult',v_name,'draft') returning id into v_subject;
 insert into public.subject_demographics(subject_id,date_of_birth) values(v_subject,p_date_of_birth);
 insert into public.subject_principals(subject_id,account_id,principal_kind,status)
 values(v_subject,null,'non_account_subject','pending') returning id into v_principal;
 insert into public.adult_subject_drafts(owner_account_id,subject_id,draft_revision,state,fixed_expires_at,
  adult_flow,confirmation_mode,evidence_kind,request_key)
 values(p_account_id,v_subject,1,'draft',v_expires,'path-b-reviewed-document','path-b-token-or-account',
  'uploaded_document',p_request_key) returning * into d;
 insert into public.draft_participant_slots(adult_draft_id,slot_kind,principal_id,slot_revision,state)
 values(d.id,'adult_subject',v_principal,1,'pending');
 v_revision:=private.contact_hmac_key_revision_v1(p_contact_hmac);
 insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,
  authority_revision,status)
 values(v_principal,p_contact_ciphertext,p_contact_hmac,v_revision,1,'current') returning id into v_contact;
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
 values(v_contact,p_contact_hmac,v_revision,'current',v_expires);
 perform private.append_legal_audit_event('subject-draft.created',null,'api.subject-drafts','accepted',
  jsonb_build_object('adult_flow','path-b-reviewed-document','revision',1));
 return jsonb_build_object('subjectDraftId',v_subject,'state','awaiting_uploader_artifact',
  'next','sign_uploader_artifact','expiresAt',v_expires);
end;
$function$;
revoke all on function private.create_path_b_reviewed_document_draft_core_v1(uuid,uuid,text,date,bytea,text,text,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
-- The keyed definer (hmac_keyring, invitation_keyring_quota_doors), exactly
-- as the e-signature draft's.
create function private.create_path_b_reviewed_document_draft_keyed_v1(p_account_id uuid,p_session_id uuid,
 p_display_name text,p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,
 p_test_jurisdiction boolean,p_contact_hmac_set jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_set jsonb; v_result jsonb;
begin
 perform private.lock_invitation_transitions_v1();
 v_set:=private.resolve_hmac_set_v1('contact',p_contact_hmac,p_contact_hmac_set);
 if v_set is not null then
  perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set)); end if;
 v_result:=private.create_path_b_reviewed_document_draft_core_v1(p_account_id,p_session_id,p_display_name,
  p_date_of_birth,p_contact_ciphertext,coalesce(v_set->>private.hmac_active_revision_v1('contact')::text,p_contact_hmac),
  p_request_key,p_test_jurisdiction);
 perform private.declare_contact_alias_groups_v1('[]'::jsonb);
 return v_result;
end;
$function$;
revoke all on function private.create_path_b_reviewed_document_draft_keyed_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.create_path_b_reviewed_document_draft_keyed_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 to service_role;
create function public.create_path_b_reviewed_document_draft_v1(p_account_id uuid,p_session_id uuid,
 p_display_name text,p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,
 p_test_jurisdiction boolean,p_contact_hmac_set jsonb default null)
returns jsonb language sql security invoker set search_path=''
as $function$ select private.create_path_b_reviewed_document_draft_keyed_v1(p_account_id,p_session_id,p_display_name,p_date_of_birth,p_contact_ciphertext,p_contact_hmac,p_request_key,p_test_jurisdiction,p_contact_hmac_set); $function$;
revoke all on function public.create_path_b_reviewed_document_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.create_path_b_reviewed_document_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 to service_role;

-- The uploader's own current reviewed-document draft (not yet requested), or
-- nothing. The one place every step below reads the draft through.
create function private.path_b_reviewed_document_draft_v1(p_account_id uuid,p_subject_id uuid)
returns public.adult_subject_drafts language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare d public.adult_subject_drafts%rowtype; s public.subjects%rowtype;
begin
 select * into d from public.adult_subject_drafts where subject_id=p_subject_id;
 select * into s from public.subjects where id=p_subject_id;
 if d.id is null or s.id is null or d.adult_flow<>'path-b-reviewed-document' or d.evidence_kind<>'uploaded_document'
  or d.owner_account_id is distinct from p_account_id or s.owner_account_id is distinct from p_account_id
  or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult' or s.subject_account_id is not null
  or s.lifecycle<>'draft' or d.state<>'draft' or d.fixed_expires_at<=clock_timestamp() then
  return null; end if;
 return d;
end;
$function$;
revoke all on function private.path_b_reviewed_document_draft_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 4. What the uploader may sign for ---------------------------------------------
-- The current body (20260930210000_path_b_account_branch.sql); the one change
-- is marked "20261016190000": a reviewed-document draft is a Path B signing target too.
create or replace function private.path_b_signing_target_v1(p_account_id uuid, p_subject_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 select * into d from public.adult_subject_drafts where subject_id=p_subject_id for share;
 if s.id is null or d.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.owner_account_id is distinct from p_account_id or d.owner_account_id is distinct from p_account_id
  -- 20260930210000: a confirmed subject may be bound to the person's own account,
  -- never to the uploader's.
  or (s.subject_account_id is not null and (d.state<>'confirmed' or s.subject_account_id=p_account_id))
  -- 20261016190000: both Path B flows.
  or d.adult_flow not in ('path-b-subject-esignature','path-b-reviewed-document')
  or not ((d.state in ('draft','invited') and s.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
   or (d.state='confirmed' and s.lifecycle='active')) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,'draftState',d.state);
end;
$function$;

-- 5. The permission document stores -------------------------------------------
-- payloadBoundaryContract.evidenceIngestLimits and ingestChunkMaximumBytes.
create function private.permission_document_limits_v1()
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('maximumDocumentBytes',20000000,'maximumChunks',5,'chunkBytes',4000000,
  'maximumActiveSessionsPerPrincipal',3,'maximumDocumentsPerTargetAndKind',3,
  'signatureFreshnessSeconds',86400,'scanLeaseSeconds',300,'maximumScanAttempts',5,
  'acceptedRetentionDays',730);
$$;
revoke all on function private.permission_document_limits_v1() from public,anon,authenticated,service_role,inherit_upload_only;

-- One evidence-ingest-session-v1 row: one uploader, one draft target, one
-- document kind, one store, the declared size and SHA-256, a hard expiry, the
-- hash of the one cookie, and the originating auth session and revisions it
-- was opened under. The subject is the draft's reserved subject, whose id is
-- the subjectDraftId; it survives every draft ending as a purged tombstone.
create table private.permission_document_sessions (
 id uuid primary key default gen_random_uuid(),
 subject_id uuid not null references public.subjects (id) on delete restrict,
 owner_account_id uuid not null,
 uploader_principal_id uuid not null references public.subject_principals (id) on delete restrict,
 uploader_consent_id uuid not null,
 auth_session_id uuid not null,
 account_revision bigint not null check (account_revision > 0),
 auth_session_revision bigint not null check (auth_session_revision > 0),
 jurisdiction_revision bigint not null check (jurisdiction_revision > 0),
 document_id uuid not null unique default gen_random_uuid(),
 document_kind text not null check (document_kind = 'adult-signed-permission'),
 media_type text not null check (media_type in ('application/pdf','image/jpeg','image/png')),
 declared_bytes integer not null check (declared_bytes between 1 and 20000000),
 declared_sha256 text not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
 cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
 create_nonce_hash text not null unique check (create_nonce_hash ~ '^[0-9a-f]{64}$'),
 complete_nonce_hash text unique check (complete_nonce_hash ~ '^[0-9a-f]{64}$'),
 planned_object_key text unique check (planned_object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
 wrapped_document_key bytea,
 document_key_shredded_at timestamptz,
 state text not null default 'open' check (state in ('open','composing','finalized','failed')),
 failure_code text check (failure_code in ('integrity','type','expired','storage','closed')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check ((wrapped_document_key is null) = (document_key_shredded_at is not null)),
 check (wrapped_document_key is null or octet_length(wrapped_document_key) = 72),
 check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
 check ((state = 'failed') = (failure_code is not null)),
 check (state in ('open','failed') or complete_nonce_hash is not null)
);
create index permission_document_sessions_subject_idx on private.permission_document_sessions (subject_id);
create index permission_document_sessions_owner_idx on private.permission_document_sessions (owner_account_id, state);
create unique index permission_document_independent_wrapped_key
 on private.permission_document_sessions (wrapped_document_key) where wrapped_document_key is not null;

create table private.permission_document_fragments (
 session_id uuid not null references private.permission_document_sessions (id) on delete restrict,
 sequence integer not null check (sequence between 0 and 4),
 object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
 byte_count integer not null check (byte_count between 1 and 4000000),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'reserved' check (state in ('reserved','written','delete_pending')),
 created_at timestamptz not null default clock_timestamp(),
 primary key (session_id, sequence)
);

-- The finalized, kind-bound document. It is quarantined until a scan bound
-- to its exact SHA-256 clears it, and review_pending until a named human
-- decides. retain_until is fixed once, at recipient activation.
create table private.permission_documents (
 id uuid primary key,
 session_id uuid not null unique references private.permission_document_sessions (id) on delete restrict,
 subject_id uuid not null references public.subjects (id) on delete restrict,
 document_kind text not null check (document_kind = 'adult-signed-permission'),
 media_type text not null check (media_type in ('application/pdf','image/jpeg','image/png')),
 byte_count integer not null check (byte_count between 1 and 20000000),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 object_key text not null unique check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
 state text not null default 'quarantined' check (state in ('quarantined','clean','refused')),
 refusal_code text check (refusal_code in ('infected','unscannable','oversize')),
 scan_verdict text check (scan_verdict = 'OK'),
 scanned_sha256 text check (scanned_sha256 ~ '^[0-9a-f]{64}$'),
 scan_engine text check (length(scan_engine) between 1 and 80),
 scan_signature_version bigint check (scan_signature_version > 0),
 scan_signature_at timestamptz,
 scanned_at timestamptz,
 scan_attempts integer not null default 0 check (scan_attempts between 0 and 100),
 lease_hash text check (lease_hash ~ '^[0-9a-f]{64}$'),
 lease_expires_at timestamptz,
 review_state text not null default 'pending' check (review_state in ('pending','approved','rejected')),
 review_revision bigint not null default 1 check (review_revision > 0),
 retain_until timestamptz,
 object_deleted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check ((state = 'clean') = (scan_verdict is not null)),
 check (state <> 'clean' or (scanned_sha256 = sha256 and scan_engine is not null
  and scan_signature_version is not null and scan_signature_at is not null and scanned_at is not null)),
 check ((state = 'refused') = (refusal_code is not null)),
 check (review_state = 'pending' or state = 'clean'),
 check (object_deleted_at is null or state = 'refused')
);
create index permission_documents_subject_idx on private.permission_documents (subject_id);
create index permission_documents_queue_idx on private.permission_documents (created_at) where state = 'quarantined';

-- A named reviewer's current assignment for one document, made only by the
-- database owner. The reviewer is an active private.claim_reviewers account.
create table private.permission_document_assignments (
 document_id uuid not null references private.permission_documents (id) on delete cascade,
 reviewer_account_id uuid not null references private.claim_reviewers (account_id) on delete cascade,
 assignment_revision bigint not null check (assignment_revision > 0),
 status text not null default 'current' check (status in ('current','ended')),
 created_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,
 primary key (document_id, assignment_revision),
 check ((status = 'ended') = (ended_at is not null))
);
create unique index permission_document_assignments_current_idx
 on private.permission_document_assignments (document_id) where status = 'current';

-- revocable-chunk-session-v1 for the assigned reviewer reading the document,
-- and every chunk that session delivered (every read audited).
create table private.permission_document_review_downloads (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references private.permission_documents (id) on delete cascade,
 reviewer_account_id uuid not null,
 auth_session_id uuid not null,
 review_revision bigint not null check (review_revision > 0),
 cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 byte_count integer not null check (byte_count between 1 and 20000000),
 chunk_count integer not null check (chunk_count between 1 and 5),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 last_activity_at timestamptz not null default clock_timestamp(),
 check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create table private.permission_document_review_reads (
 download_id uuid not null references private.permission_document_review_downloads (id) on delete cascade,
 sequence integer not null check (sequence between 0 and 4),
 read_at timestamptz not null default clock_timestamp(),
 primary key (download_id, sequence)
);

-- The immutable named-human decision; its id is the legalReviewId api.subjects
-- requires. It names no reviewer to anyone and keeps no document byte. The
-- reason ciphertext alone is destroyed when the document is disposed of.
create table private.permission_document_reviews (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null,
 subject_id uuid not null,
 document_kind text not null check (document_kind = 'adult-signed-permission'),
 document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
 review_revision bigint not null check (review_revision > 0),
 decision text not null check (decision in ('approved','rejected')),
 reviewer_account_id uuid not null,
 auth_session_id uuid not null,
 reason_ciphertext bytea check (reason_ciphertext is null or octet_length(reason_ciphertext) between 48 and 16384),
 nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
 decided_at timestamptz not null default clock_timestamp(),
 reason_shredded_at timestamptz,
 unique (document_id, review_revision),
 check ((reason_ciphertext is null) = (reason_shredded_at is not null))
);
create function private.guard_permission_document_review_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op = 'DELETE' then raise exception using errcode='42501',message='review decision immutable'; end if;
 if (to_jsonb(new) - 'reason_ciphertext' - 'reason_shredded_at') is distinct from
   (to_jsonb(old) - 'reason_ciphertext' - 'reason_shredded_at')
  or (old.reason_ciphertext is null and new.reason_ciphertext is not null)
  or (new.reason_ciphertext is not null and new.reason_ciphertext is distinct from old.reason_ciphertext) then
  raise exception using errcode='42501',message='review decision immutable'; end if;
 return new;
end $$;
create trigger permission_document_review_immutable before update or delete on private.permission_document_reviews
 for each row execute function private.guard_permission_document_review_v1();

-- The request a review made possible: bound to the exact draft, document,
-- decision and revisions api.subjects saw. Activation rechecks every one.
create table private.path_b_reviewed_document_requests (
 invitation_id uuid primary key references public.subject_invitations (id) on delete cascade,
 subject_id uuid not null,
 document_id uuid not null,
 review_id uuid not null references private.permission_document_reviews (id) on delete restrict,
 document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
 review_revision bigint not null check (review_revision > 0),
 created_at timestamptz not null default clock_timestamp()
);
create index path_b_reviewed_document_requests_subject_idx on private.path_b_reviewed_document_requests (subject_id);

-- One-time operation nonces (brief X1.5): the page renders a stateless sealed
-- nonce; the state-changing request records its hash here, once.
create table private.path_b_reviewed_document_nonces (
 nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
 account_id uuid not null,
 operation text not null check (operation in ('document-session','finalize')),
 target_id uuid not null,
 consumed_at timestamptz not null default clock_timestamp(),
 purge_after timestamptz not null default clock_timestamp() + interval '1 day'
);

do $tables$ declare table_name text; begin
 foreach table_name in array array['permission_document_sessions','permission_document_fragments',
  'permission_documents','permission_document_assignments','permission_document_review_downloads',
  'permission_document_review_reads','permission_document_reviews','path_b_reviewed_document_requests',
  'path_b_reviewed_document_nonces'] loop
  execute format('alter table private.%I enable row level security', table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,inherit_upload_only', table_name);
 end loop;
end $tables$;

-- These stores are disposed of by this flow's own executors (the subject
-- lifecycle trigger and public.expire_due_path_b_reviewed_documents_v1 below),
-- and account deletion refuses an account holding any of them
-- (private.assert_account_path_b_deletion_supported_v1), exactly as it
-- refuses the e-signature flow's stores. They are not added to the generic
-- purge registry, whose executors never reach a Path B graph.

-- A document starts quarantined, is immutable, and only a recorded scan may
-- mark it clean or only a recorded human decision may change its review.
create function private.guard_permission_document_transition_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.state<>'quarantined' or new.scan_verdict is not null or new.object_deleted_at is not null
   or new.review_state<>'pending' or new.review_revision<>1 or new.retain_until is not null then
   raise exception using errcode='42501',message='a permission document starts quarantined'; end if;
  return new;
 end if;
 if (new.id,new.session_id,new.subject_id,new.sha256,new.object_key,new.byte_count,new.media_type,new.document_kind)
  is distinct from (old.id,old.session_id,old.subject_id,old.sha256,old.object_key,old.byte_count,old.media_type,old.document_kind) then
  raise exception using errcode='42501',message='a permission document is immutable'; end if;
 if old.state<>'quarantined' and new.state<>old.state then
  raise exception using errcode='42501',message='a scanned permission document keeps its verdict'; end if;
 if new.state='clean' and old.state<>'clean'
  and coalesce(current_setting('inherit.permission_document_scan',true),'')<>new.id::text then
  raise exception using errcode='42501',message='only a recorded scan marks a document clean'; end if;
 if (new.review_state,new.review_revision) is distinct from (old.review_state,old.review_revision)
  and coalesce(current_setting('inherit.permission_document_review',true),'')<>new.id::text then
  raise exception using errcode='42501',message='only a recorded human decision changes a review'; end if;
 if old.review_state<>'pending' and new.review_state<>old.review_state then
  raise exception using errcode='42501',message='a decided review is final'; end if;
 if old.retain_until is not null and new.retain_until is distinct from old.retain_until then
  raise exception using errcode='42501',message='a retention deadline is fixed once'; end if;
 return new;
end $$;
create trigger permission_document_transition before insert or update on private.permission_documents
 for each row execute function private.guard_permission_document_transition_v1();

-- The document key is written once and only ever erased.
create function private.guard_permission_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.id,new.subject_id,new.owner_account_id,new.document_id,new.document_kind,new.auth_session_id,
    new.uploader_principal_id,new.uploader_consent_id,new.declared_bytes,new.declared_sha256,new.media_type,
    new.cookie_hash,new.create_nonce_hash,new.created_at,new.expires_at)
   is distinct from (old.id,old.subject_id,old.owner_account_id,old.document_id,old.document_kind,old.auth_session_id,
    old.uploader_principal_id,old.uploader_consent_id,old.declared_bytes,old.declared_sha256,old.media_type,
    old.cookie_hash,old.create_nonce_hash,old.created_at,old.expires_at)
   or (old.wrapped_document_key is null and (new.wrapped_document_key is not null
    or new.document_key_shredded_at is distinct from old.document_key_shredded_at))
   or (old.wrapped_document_key is not null and new.wrapped_document_key is not null
    and new.wrapped_document_key is distinct from old.wrapped_document_key) then
   raise exception using errcode='42501',message='permission document key immutable'; end if;
 end if;
 if new.state='failed' then
  new.wrapped_document_key:=null;
  new.document_key_shredded_at:=coalesce(new.document_key_shredded_at,clock_timestamp());
 end if;
 return new;
end $$;
create trigger permission_document_key_immutable before insert or update on private.permission_document_sessions
 for each row execute function private.guard_permission_document_key_v1();

-- A refused document's key goes at once.
create function private.shred_refused_permission_document_key_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='refused' or new.review_state='rejected' then
  update private.permission_document_sessions set wrapped_document_key=null,
   document_key_shredded_at=coalesce(document_key_shredded_at,clock_timestamp())
  where id=new.session_id and wrapped_document_key is not null;
 end if;
 return new;
end $$;
create trigger permission_document_refusal_shreds_key after insert or update of state, review_state
 on private.permission_documents for each row execute function private.shred_refused_permission_document_key_v1();

-- 6. The permission document session (api.legal-evidence-upload-session) -----
-- evidence-ingest-session-v1.authorization: before every chunk and the
-- completion, the originating auth session must still be live, the account
-- not deleting or suspended, its account, session and jurisdiction revisions
-- unchanged, the draft current and the uploader's signature the same one.
create function private.permission_document_session_current_v1(s private.permission_document_sessions)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare p public.profiles%rowtype; d public.adult_subject_drafts%rowtype;
begin
 if s.id is null or s.wrapped_document_key is null or s.expires_at<=clock_timestamp() then return false; end if;
 perform 1 from auth.users u join auth.sessions x on x.user_id=u.id
  where u.id=s.owner_account_id and x.id=s.auth_session_id and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then return false; end if;
 select * into p from public.profiles where id=s.owner_account_id;
 if p.id is null or p.deletion_requested_at is not null or p.non_self_upload_suspended_at is not null
  or p.account_revision is distinct from s.account_revision
  or p.auth_session_revision is distinct from s.auth_session_revision
  or p.jurisdiction_revision is distinct from s.jurisdiction_revision then return false; end if;
 d:=private.path_b_reviewed_document_draft_v1(s.owner_account_id,s.subject_id);
 if d.id is null then return false; end if;
 return private.path_b_uploader_consent_v1(s.owner_account_id,s.subject_id,s.uploader_principal_id,
  s.jurisdiction_revision) is not distinct from s.uploader_consent_id;
end;
$function$;
revoke all on function private.permission_document_session_current_v1(private.permission_document_sessions)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The session a chunk or completion names, by its id and exact cookie hash,
-- locked and current; otherwise nothing.
create function private.permission_document_session_for_v1(p_session_id uuid,p_cookie_hash text)
returns private.permission_document_sessions language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare ds private.permission_document_sessions;
begin
 if p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then return null; end if;
 perform private.lock_invitation_transitions_v1();
 select * into ds from private.permission_document_sessions where id=p_session_id and cookie_hash=p_cookie_hash for update;
 if ds.id is null or not private.permission_document_session_current_v1(ds) then return null; end if;
 return ds;
end;
$function$;
revoke all on function private.permission_document_session_for_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The create step. The request supplies no bucket, key, owner, reviewer or
-- review state; the draft, the uploader and every revision come from here.
create function public.open_permission_document_session_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_media_type text,p_size_bytes integer,p_sha256 text,p_cookie_hash text,p_wrapped_document_key bytea,
 p_nonce_hash text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private set lock_timeout='250ms'
as $function$
declare u jsonb; d public.adult_subject_drafts%rowtype; v_consent uuid; v_limits jsonb:=private.permission_document_limits_v1();
 ds private.permission_document_sessions; p public.profiles%rowtype; v_now timestamptz;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_media_type is null or p_media_type not in ('application/pdf','image/jpeg','image/png')
  or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>(v_limits->>'maximumDocumentBytes')::integer
  or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$'
  or p_wrapped_document_key is null or octet_length(p_wrapped_document_key)<>72
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 select * into p from public.profiles where id=p_account_id;
 if p.non_self_upload_suspended_at is not null then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.subjects where id=p_subject_id for update;
 d:=private.path_b_reviewed_document_draft_v1(p_account_id,p_subject_id);
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.adult_subject_drafts where id=d.id for update;
 -- uploaderArtifactPrecondition: the acting draft owner's own current signature.
 v_consent:=private.path_b_uploader_consent_v1(p_account_id,p_subject_id,(u->>'principalId')::uuid,
  (u->>'jurisdictionRevision')::bigint);
 if v_consent is null then raise exception using errcode='42501',message='not_found'; end if;
 -- One review per draft: a document already approved or under review blocks another.
 if exists(select 1 from private.permission_documents doc where doc.subject_id=p_subject_id
  and doc.state<>'refused' and doc.review_state in ('pending','approved') and doc.object_deleted_at is null
  and exists(select 1 from private.permission_document_sessions x where x.id=doc.session_id and x.wrapped_document_key is not null)) then
  return jsonb_build_object('status','capacity_limited'); end if;
 if (select count(*) from private.permission_document_sessions x where x.owner_account_id=p_account_id
   and x.state in ('open','composing') and x.expires_at>v_now)>=(v_limits->>'maximumActiveSessionsPerPrincipal')::integer
  or (select count(*) from private.permission_document_sessions x where x.subject_id=p_subject_id
   and x.state<>'failed')>=(v_limits->>'maximumDocumentsPerTargetAndKind')::integer then
  return jsonb_build_object('status','capacity_limited'); end if;
 -- The page's one-time operation nonce, spent here.
 insert into private.path_b_reviewed_document_nonces(nonce_hash,account_id,operation,target_id)
 values(p_nonce_hash,p_account_id,'document-session',p_subject_id);
 insert into private.permission_document_sessions(subject_id,owner_account_id,uploader_principal_id,uploader_consent_id,
  auth_session_id,account_revision,auth_session_revision,jurisdiction_revision,document_kind,media_type,declared_bytes,
  declared_sha256,cookie_hash,create_nonce_hash,wrapped_document_key,created_at,expires_at)
 values(p_subject_id,p_account_id,(u->>'principalId')::uuid,v_consent,p_session_id,(u->>'accountRevision')::bigint,
  (u->>'authSessionRevision')::bigint,(u->>'jurisdictionRevision')::bigint,'adult-signed-permission',p_media_type,
  p_size_bytes,p_sha256,p_cookie_hash,p_nonce_hash,p_wrapped_document_key,v_now,
  least(v_now+interval '24 hours',d.fixed_expires_at))
 returning * into ds;
 perform private.append_legal_audit_event('legal-evidence.session.opened',null,'api.legal-evidence-upload-session',
  'accepted',jsonb_build_object('document_kind','adult-signed-permission'));
 return jsonb_build_object('status','open','session',ds.id,'documentKind',ds.document_kind,'expiresAt',ds.expires_at);
end;
$function$;
revoke all on function public.open_permission_document_session_v1(uuid,uuid,uuid,text,integer,text,text,bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.open_permission_document_session_v1(uuid,uuid,uuid,text,integer,text,text,bytea,text,boolean)
 to service_role;

-- 7. Chunks, completion, scan and disposal (the appeal state machine) --------
-- The same byte and scan state machine as the appeal documents
-- (20261009204626_public_appeal_evidence_session.sql), bound to this flow's
-- session authority instead of a rights session.
create function private.fail_permission_document_session_row_v1(p_session_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update private.permission_document_sessions set state='failed',failure_code=p_code
  where id=p_session_id and state in ('open','composing');
 update private.permission_document_fragments set state='delete_pending' where session_id=p_session_id;
 perform private.append_legal_audit_event('legal-evidence.document.refused',null,'api.evidence-complete',
  'refused',jsonb_build_object('reason',p_code));
end;
$$;

create function private.reserve_permission_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,
 p_byte_count integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session private.permission_document_sessions; v_limits jsonb:=private.permission_document_limits_v1();
 v_written bigint; v_key text;
begin
 v_session:=private.permission_document_session_for_v1(p_session_id,p_cookie_hash);
 if v_session.id is null or v_session.state<>'open' then
  raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if p_sequence is null or p_sequence<0 or p_sequence>=(v_limits->>'maximumChunks')::integer
  or exists(select 1 from private.permission_document_fragments f where f.session_id=v_session.id and f.sequence=p_sequence) then
  raise exception using errcode='23505',message='permission document chunk already written'; end if;
 select coalesce(sum(f.byte_count),0) into v_written from private.permission_document_fragments f where f.session_id=v_session.id;
 if p_byte_count is null or p_byte_count<1 or p_byte_count>(v_limits->>'chunkBytes')::integer
  or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or v_written+p_byte_count>v_session.declared_bytes then
  perform private.fail_permission_document_session_row_v1(v_session.id,'integrity');
  return jsonb_build_object('status','invalid'); end if;
 v_key:=v_session.subject_id::text||'/'||v_session.document_id::text||'/'||gen_random_uuid()::text;
 insert into private.permission_document_fragments(session_id,sequence,object_key,byte_count,sha256)
 values(v_session.id,p_sequence,v_key,p_byte_count,p_sha256);
 return jsonb_build_object('status','reserved','objectKey',v_key,
  'wrappedDataKey',encode(v_session.wrapped_document_key,'hex'),'storageKind','permission');
end;
$$;

create function private.settle_permission_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,
 p_written boolean)
returns text language plpgsql security definer set search_path='' as $$
declare v_session private.permission_document_sessions;
begin
 v_session:=private.permission_document_session_for_v1(p_session_id,p_cookie_hash);
 if v_session.id is null or v_session.state<>'open' then
  raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if not p_written then
  perform private.fail_permission_document_session_row_v1(v_session.id,'storage');
  return 'failed'; end if;
 update private.permission_document_fragments set state='written'
  where session_id=v_session.id and sequence=p_sequence and state='reserved';
 if not found then raise exception using errcode='42501',message='permission document session unavailable'; end if;
 return 'written';
end;
$$;

create function private.permission_document_status_v1(p_session private.permission_document_sessions)
returns jsonb language sql stable security definer set search_path='' as $$
 select case
  when p_session.state='failed' then jsonb_build_object('status','refused','reason',
   case when p_session.failure_code='closed' then 'expired' else p_session.failure_code end)
  when d.id is null then jsonb_build_object('status','composing')
  when d.state='quarantined' then jsonb_build_object('status','scanning','documentId',d.id,'documentKind',d.document_kind)
  when d.state='clean' then jsonb_build_object('status','review_pending','documentId',d.id,'documentKind',d.document_kind)
  else jsonb_build_object('status','refused','reason',d.refusal_code) end
 from (select 1) one left join private.permission_documents d on d.session_id=p_session.id;
$$;

create function private.begin_permission_document_completion_v1(p_session_id uuid,p_cookie_hash text,
 p_complete_nonce_hash text,p_chunk_count integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session private.permission_document_sessions; v_count integer; v_bytes bigint; v_max integer;
begin
 if p_complete_nonce_hash is null or p_complete_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='permission document completion invalid'; end if;
 select s.* into v_session from private.permission_document_sessions s
  where s.id=p_session_id and s.cookie_hash=p_cookie_hash for update;
 if v_session.id is null then raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if v_session.state<>'open' then
  -- The same nonce may ask again for the outcome; nothing else may.
  if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash then
   raise exception using errcode='23505',message='permission document completion already used'; end if;
  return private.permission_document_status_v1(v_session);
 end if;
 v_session:=private.permission_document_session_for_v1(p_session_id,p_cookie_hash);
 if v_session.id is null then raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if exists(select 1 from private.permission_document_sessions where complete_nonce_hash=p_complete_nonce_hash) then
  raise exception using errcode='23505',message='permission document completion already used'; end if;
 select count(*),coalesce(sum(byte_count),0),coalesce(max(sequence),-1) into v_count,v_bytes,v_max
  from private.permission_document_fragments where session_id=v_session.id and state='written';
 if p_chunk_count is null or p_chunk_count<1 or p_chunk_count<>v_count or v_max<>v_count-1
  or exists(select 1 from private.permission_document_fragments where session_id=v_session.id and state<>'written')
  or v_bytes<>v_session.declared_bytes then
  update private.permission_document_sessions set complete_nonce_hash=p_complete_nonce_hash where id=v_session.id;
  perform private.fail_permission_document_session_row_v1(v_session.id,'integrity');
  return jsonb_build_object('status','refused','reason','integrity');
 end if;
 update private.permission_document_sessions set state='composing',complete_nonce_hash=p_complete_nonce_hash,
  planned_object_key=v_session.subject_id::text||'/'||v_session.document_id::text||'/'||gen_random_uuid()::text
  where id=v_session.id returning * into v_session;
 return jsonb_build_object('status','compose','storageKind','permission','documentId',v_session.document_id,
  'documentKind',v_session.document_kind,'mediaType',v_session.media_type,'sizeBytes',v_session.declared_bytes,
  'sha256',v_session.declared_sha256,'objectKey',v_session.planned_object_key,
  'wrappedDataKey',encode(v_session.wrapped_document_key,'hex'),
  'fragments',(select jsonb_agg(jsonb_build_object('sequence',f.sequence,'objectKey',f.object_key,
    'byteCount',f.byte_count,'sha256',f.sha256) order by f.sequence)
   from private.permission_document_fragments f where f.session_id=v_session.id));
end;
$$;

create function private.finish_permission_document_completion_v1(p_session_id uuid,p_cookie_hash text,
 p_complete_nonce_hash text,p_outcome text,p_object_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session private.permission_document_sessions;
begin
 v_session:=private.permission_document_session_for_v1(p_session_id,p_cookie_hash);
 if v_session.id is null then raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash or v_session.state<>'composing' then
  raise exception using errcode='42501',message='permission document session unavailable'; end if;
 if p_outcome in ('integrity','type','storage') then
  perform private.fail_permission_document_session_row_v1(v_session.id,p_outcome);
  return private.permission_document_status_v1((select s from private.permission_document_sessions s where s.id=v_session.id));
 end if;
 if p_outcome is distinct from 'composed' or p_object_key is distinct from v_session.planned_object_key then
  raise exception using errcode='22023',message='permission document completion invalid'; end if;
 insert into private.permission_documents(id,session_id,subject_id,document_kind,media_type,byte_count,sha256,object_key)
 values(v_session.document_id,v_session.id,v_session.subject_id,v_session.document_kind,v_session.media_type,
  v_session.declared_bytes,v_session.declared_sha256,p_object_key);
 update private.permission_document_sessions set state='finalized' where id=v_session.id;
 update private.permission_document_fragments set state='delete_pending' where session_id=v_session.id;
 perform private.append_legal_audit_event('legal-evidence.document.received',null,'api.evidence-complete',
  'accepted',jsonb_build_object('document_kind','adult-signed-permission'));
 return private.permission_document_status_v1((select s from private.permission_document_sessions s where s.id=v_session.id));
end;
$$;

-- Whether a document is still part of a live basis: its session key exists,
-- its draft has not ended (before activation) or its subject is active and
-- its fixed retention has not passed (after).
create function private.permission_document_live_v1(p_document private.permission_documents)
returns boolean language sql stable security definer set search_path='' as $$
 select p_document.id is not null and p_document.object_deleted_at is null
  and exists(select 1 from private.permission_document_sessions s where s.id=p_document.session_id
   and s.wrapped_document_key is not null)
  and exists(select 1 from public.subjects subject join public.adult_subject_drafts d on d.subject_id=subject.id
   where subject.id=p_document.subject_id and d.adult_flow='path-b-reviewed-document'
    and ((d.state in ('draft','invited') and subject.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
     or (d.state='confirmed' and subject.lifecycle='active' and p_document.review_state='approved'
      and p_document.retain_until is not null and p_document.retain_until>clock_timestamp())));
$$;

create function private.claim_next_permission_document_scan_v1(p_lease_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_document private.permission_documents; v_limits jsonb:=private.permission_document_limits_v1();
begin
 if p_lease_hash is null or p_lease_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='scan lease invalid'; end if;
 select d.* into v_document from private.permission_documents d
  where d.state='quarantined' and (d.lease_expires_at is null or d.lease_expires_at<=clock_timestamp())
   and private.permission_document_live_v1(d)
  order by d.created_at,d.id limit 1 for update of d skip locked;
 if v_document.id is null then return null; end if;
 update private.permission_documents set lease_hash=p_lease_hash,
  lease_expires_at=clock_timestamp()+make_interval(secs=>(v_limits->>'scanLeaseSeconds')::integer),
  scan_attempts=scan_attempts+1 where id=v_document.id;
 return jsonb_build_object('documentId',v_document.id,'objectKey',v_document.object_key,'sha256',v_document.sha256,
  'byteCount',v_document.byte_count,'mediaType',v_document.media_type,
  'wrappedDataKey',(select encode(ds.wrapped_document_key,'hex') from private.permission_document_sessions ds
   where ds.id=v_document.session_id));
end;
$$;

create function private.record_permission_document_scan_v1(p_document_id uuid,p_lease_hash text,p_outcome text,
 p_scanned_sha256 text,p_scan_engine text,p_signature_version bigint,p_signature_at timestamptz)
returns text language plpgsql security definer set search_path='' as $$
declare v_document private.permission_documents; v_limits jsonb:=private.permission_document_limits_v1(); v_refusal text;
begin
 perform private.lock_invitation_transitions_v1();
 select d.* into v_document from private.permission_documents d
  where d.id=p_document_id and d.lease_hash=p_lease_hash and d.state='quarantined' and d.lease_expires_at>clock_timestamp()
  for update;
 if v_document.id is null then raise exception using errcode='42501',message='scan lease unavailable'; end if;
 if not private.permission_document_live_v1(v_document) then
  raise exception using errcode='42501',message='permission document unavailable'; end if;
 if p_outcome='OK' then
  if p_scanned_sha256 is distinct from v_document.sha256 or p_scan_engine is null or length(p_scan_engine) not between 1 and 80
   or p_signature_version is null or p_signature_version<1 or p_signature_at is null
   or p_signature_at<clock_timestamp()-make_interval(secs=>(v_limits->>'signatureFreshnessSeconds')::integer)
   or p_signature_at>clock_timestamp()+interval '5 minutes' then
   raise exception using errcode='22023',message='scan verdict refused'; end if;
  perform set_config('inherit.permission_document_scan',v_document.id::text,true);
  update private.permission_documents set state='clean',scan_verdict='OK',scanned_sha256=p_scanned_sha256,
   scan_engine=p_scan_engine,scan_signature_version=p_signature_version,scan_signature_at=p_signature_at,
   scanned_at=clock_timestamp(),lease_hash=null,lease_expires_at=null where id=v_document.id;
  perform set_config('inherit.permission_document_scan','',true);
  perform private.append_legal_audit_event('legal-evidence.document.scanned',null,'jobs.claim-document-scan',
   'accepted',jsonb_build_object('document_kind','adult-signed-permission'));
  return 'clean';
 elsif p_outcome='UNAVAILABLE' then
  if v_document.scan_attempts<(v_limits->>'maximumScanAttempts')::integer then
   update private.permission_documents set lease_hash=null,lease_expires_at=null where id=v_document.id;
   return 'retry'; end if;
  v_refusal:='unscannable';
 elsif p_outcome='FOUND' then v_refusal:='infected';
 elsif p_outcome='UNSCANNABLE' then v_refusal:='unscannable';
 elsif p_outcome='OVERSIZE' then v_refusal:='oversize';
 else raise exception using errcode='22023',message='scan verdict refused'; end if;
 update private.permission_documents set state='refused',refusal_code=v_refusal,lease_hash=null,lease_expires_at=null
  where id=v_document.id;
 perform private.append_legal_audit_event('legal-evidence.document.refused',null,'jobs.claim-document-scan',
  'refused',jsonb_build_object('reason',v_refusal));
 return 'delete';
end;
$$;

-- What the retention job, the scan worker and the completion may delete now.
-- Every key of a non-live session is erased before its objects are listed.
create function private.permission_document_objects_due_v1(p_limit integer)
returns table(object_key text) language plpgsql volatile security definer set search_path='' as $$
begin
 perform private.lock_invitation_transitions_v1();
 update private.permission_document_sessions ds set state='failed',failure_code='expired'
  where ds.state in ('open','composing') and ds.expires_at<=clock_timestamp();
 update private.permission_document_sessions ds set state='failed',failure_code='closed'
  where ds.state in ('open','composing') and not private.permission_document_session_current_v1(ds);
 update private.permission_document_sessions ds set wrapped_document_key=null,
  document_key_shredded_at=coalesce(ds.document_key_shredded_at,clock_timestamp())
  where ds.wrapped_document_key is not null and ds.state='finalized'
   and not exists(select 1 from private.permission_documents d where d.session_id=ds.id
    and d.state<>'refused' and private.permission_document_live_v1(d));
 return query select k.object_key from (
  select f.object_key,f.created_at from private.permission_document_fragments f
   join private.permission_document_sessions s on s.id=f.session_id
   where f.state='delete_pending' or s.wrapped_document_key is null or s.expires_at<=clock_timestamp()
  union all
  select s.planned_object_key,s.created_at from private.permission_document_sessions s
   where s.planned_object_key is not null
    and not exists(select 1 from private.permission_documents d where d.object_key=s.planned_object_key)
    and (s.state='failed' or s.wrapped_document_key is null or s.expires_at<=clock_timestamp())
  union all
  select d.object_key,d.created_at from private.permission_documents d
   join private.permission_document_sessions s on s.id=d.session_id
   where d.object_deleted_at is null and (d.state='refused' or s.wrapped_document_key is null)
 ) k order by k.created_at limit greatest(least(coalesce(p_limit,100),1000),1);
end;
$$;

create function private.confirm_permission_document_objects_deleted_v1(p_object_keys text[],p_route_id text)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer:=0; v_rows integer; v_document record;
begin
 if p_route_id is null or p_route_id not in ('jobs.retention','jobs.claim-document-scan','api.evidence-complete') then
  raise exception using errcode='22023',message='permission document deletion invalid'; end if;
 perform private.lock_invitation_transitions_v1();
 if p_object_keys is null or cardinality(p_object_keys) not between 1 and 1000 then
  raise exception using errcode='22023',message='permission document deletion invalid'; end if;
 -- A live document or a still-needed fragment is never confirmed deleted.
 if exists(select 1 from private.permission_documents d join private.permission_document_sessions s on s.id=d.session_id
   where d.object_key=any(p_object_keys) and d.state<>'refused' and s.wrapped_document_key is not null)
  or exists(select 1 from private.permission_document_fragments f join private.permission_document_sessions s on s.id=f.session_id
   where f.object_key=any(p_object_keys) and f.state<>'delete_pending' and s.wrapped_document_key is not null
    and s.expires_at>clock_timestamp()) then
  raise exception using errcode='42501',message='permission document deletion unavailable'; end if;
 delete from private.permission_document_fragments where object_key=any(p_object_keys);
 get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
 update private.permission_document_sessions s set planned_object_key=null
  where s.planned_object_key=any(p_object_keys)
   and not exists(select 1 from private.permission_documents d where d.object_key=s.planned_object_key);
 get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
 for v_document in select d.id,d.state,d.refusal_code,d.object_key from private.permission_documents d
  where d.object_key=any(p_object_keys) and d.object_deleted_at is null for update loop
  if v_document.state='refused' then
   update private.permission_documents set object_deleted_at=clock_timestamp(),lease_hash=null,lease_expires_at=null
    where id=v_document.id;
   perform private.append_legal_audit_event('legal-evidence.document.deleted',null,p_route_id,'purged',
    jsonb_build_object('reason',v_document.refusal_code));
  else
   -- The decision rows keep the hash, kind and decision; the reviewer's
   -- reason goes with the document.
   update private.permission_document_reviews set reason_ciphertext=null,reason_shredded_at=clock_timestamp()
    where document_id=v_document.id and reason_ciphertext is not null;
   update private.permission_document_sessions set planned_object_key=null where planned_object_key=v_document.object_key;
   delete from private.permission_documents where id=v_document.id;
   perform private.append_legal_audit_event('legal-evidence.document.deleted',null,p_route_id,'purged',
    jsonb_build_object('reason','basis-ended'));
  end if;
  v_count:=v_count+1;
 end loop;
 -- A session with nothing left behind it goes too.
 delete from private.permission_document_sessions s where s.wrapped_document_key is null and s.planned_object_key is null
  and not exists(select 1 from private.permission_document_fragments f where f.session_id=s.id)
  and not exists(select 1 from private.permission_documents d where d.session_id=s.id);
 return v_count;
end;
$$;

do $grants$ declare signature text; begin
 foreach signature in array array['fail_permission_document_session_row_v1(uuid,text)',
  'permission_document_status_v1(private.permission_document_sessions)',
  'permission_document_live_v1(private.permission_documents)',
  'guard_permission_document_transition_v1()','guard_permission_document_key_v1()',
  'shred_refused_permission_document_key_v1()','guard_permission_document_review_v1()'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated,service_role,inherit_upload_only';
 end loop;
 foreach signature in array array['reserve_permission_document_chunk_v1(uuid,text,integer,integer,text)',
  'settle_permission_document_chunk_v1(uuid,text,integer,boolean)',
  'begin_permission_document_completion_v1(uuid,text,text,integer)',
  'finish_permission_document_completion_v1(uuid,text,text,text,text)',
  'claim_next_permission_document_scan_v1(text)',
  'record_permission_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz)',
  'permission_document_objects_due_v1(integer)','confirm_permission_document_objects_deleted_v1(text[],text)'] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated,service_role,inherit_upload_only';
  execute 'grant execute on function private.'||signature||' to service_role';
 end loop;
end $grants$;
create function public.claim_next_permission_document_scan_v1(p_lease_hash text) returns jsonb
 language sql security invoker set search_path='' as $$ select private.claim_next_permission_document_scan_v1(p_lease_hash); $$;
create function public.record_permission_document_scan_v1(p_document_id uuid,p_lease_hash text,p_outcome text,
 p_scanned_sha256 text,p_scan_engine text,p_signature_version bigint,p_signature_at timestamptz) returns text
 language sql security invoker set search_path='' as $$
 select private.record_permission_document_scan_v1(p_document_id,p_lease_hash,p_outcome,p_scanned_sha256,p_scan_engine,p_signature_version,p_signature_at); $$;
create function public.permission_document_objects_due_v1(p_limit integer) returns table(object_key text)
 language sql security invoker set search_path='' as $$ select * from private.permission_document_objects_due_v1(p_limit); $$;
create function public.confirm_permission_document_objects_deleted_v1(p_object_keys text[],p_route_id text) returns integer
 language sql security invoker set search_path='' as $$ select private.confirm_permission_document_objects_deleted_v1(p_object_keys,p_route_id); $$;
do $grants$ declare signature text; begin
 foreach signature in array array['claim_next_permission_document_scan_v1(text)',
  'record_permission_document_scan_v1(uuid,text,text,text,text,bigint,timestamptz)',
  'permission_document_objects_due_v1(integer)','confirm_permission_document_objects_deleted_v1(text[],text)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated,inherit_upload_only';
  execute 'grant execute on function public.'||signature||' to service_role';
 end loop;
end $grants$;

-- 8. The shared evidence doors ---------------------------------------------------
-- api.evidence-chunk and api.evidence-complete keep their ABI. The native
-- session row and exact cookie choose the domain; no request value chooses a
-- bucket. Each body below is the current one (20261009204626) with the
-- permission branch, marked "20261016190000", first.
create or replace function public.reserve_claim_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_byte_count integer,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- 20261016190000: a permission document session.
 if exists(select 1 from private.permission_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.reserve_permission_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);
 end if;
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  result:=private.reserve_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);
  if result->>'status'='reserved' then return result||jsonb_build_object('storageKind','appeal');end if;return result;
 end if;
 return public.reserve_claim_document_chunk_before_public_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_byte_count,p_sha256);
end $$;
create or replace function public.settle_claim_document_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer,p_written boolean)
returns text language plpgsql security definer set search_path='' as $$
begin
 -- 20261016190000: a permission document session.
 if exists(select 1 from private.permission_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.settle_permission_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_written);end if;
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.settle_appeal_document_chunk_v1(p_session_id,p_cookie_hash,p_sequence,p_written);end if;
 return public.settle_claim_document_chunk_before_public_appeal_v1(p_session_id,p_cookie_hash,p_sequence,p_written);
end $$;
create or replace function public.begin_claim_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_chunk_count integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- 20261016190000: a permission document session.
 if exists(select 1 from private.permission_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.begin_permission_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);
 end if;
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  result:=private.begin_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);
  if result->>'status'='compose' then return result||jsonb_build_object('storageKind','appeal');end if;return result;
 end if;
 return public.begin_claim_document_completion_before_public_appeal_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_chunk_count);
end $$;
create or replace function public.finish_claim_document_completion_v1(p_session_id uuid,p_cookie_hash text,p_complete_nonce_hash text,p_outcome text,p_object_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- 20261016190000: a permission document session.
 if exists(select 1 from private.permission_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.finish_permission_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);end if;
 if exists(select 1 from private.appeal_document_sessions s where s.id=p_session_id and s.cookie_hash=p_cookie_hash) then
  return private.finish_appeal_document_completion_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);end if;
 return public.finish_claim_document_completion_before_public_appeal_v1(p_session_id,p_cookie_hash,p_complete_nonce_hash,p_outcome,p_object_key);
end $$;

-- 9. Every ending erases the document key in its own transaction ----------------
-- legal-evidence.adult-permission-24mo: rejection, refusal, deletion, expiry,
-- loss of basis or the fixed deadline makes the document unreadable in the
-- triggering transaction. These constraint triggers run at commit, so a
-- recipient activation (which changes the subject and the draft in turn) is
-- judged on its final state. Objects and rows are then deleted by the
-- retention job through public.permission_document_objects_due_v1.
create function private.shred_permission_documents_not_live_v1(p_subject_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 update private.permission_document_sessions s set state='failed',failure_code='closed'
  where s.subject_id=p_subject_id and s.state in ('open','composing')
   and not private.permission_document_session_current_v1(s);
 update private.permission_document_sessions s set wrapped_document_key=null,
  document_key_shredded_at=coalesce(s.document_key_shredded_at,clock_timestamp())
  where s.subject_id=p_subject_id and s.wrapped_document_key is not null and s.state='finalized'
   and not exists(select 1 from private.permission_documents d where d.session_id=s.id
    and d.state<>'refused' and private.permission_document_live_v1(d));
 update private.permission_document_fragments f set state='delete_pending'
  from private.permission_document_sessions s where s.id=f.session_id and s.subject_id=p_subject_id
   and s.wrapped_document_key is null and f.state<>'delete_pending';
 delete from private.permission_document_review_downloads r using private.permission_documents d
  where d.id=r.document_id and d.subject_id=p_subject_id and not private.permission_document_live_v1(d);
 update private.permission_document_assignments a set status='ended',ended_at=clock_timestamp()
  from private.permission_documents d where d.id=a.document_id and d.subject_id=p_subject_id
   and a.status='current' and not private.permission_document_live_v1(d);
end $$;
revoke all on function private.shred_permission_documents_not_live_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

create function private.permission_documents_subject_changed_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_subject uuid:=coalesce(new.id,old.id);
begin
 if exists(select 1 from private.permission_document_sessions s where s.subject_id=v_subject) then
  perform private.shred_permission_documents_not_live_v1(v_subject); end if;
 return null;
end $$;
create function private.permission_documents_draft_changed_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_subject uuid:=coalesce(new.subject_id,old.subject_id);
begin
 if exists(select 1 from private.permission_document_sessions s where s.subject_id=v_subject) then
  perform private.shred_permission_documents_not_live_v1(v_subject); end if;
 return null;
end $$;
revoke all on function private.permission_documents_subject_changed_v1() from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function private.permission_documents_draft_changed_v1() from public,anon,authenticated,service_role,inherit_upload_only;
create constraint trigger permission_documents_subject_lifecycle after update of lifecycle on public.subjects
 deferrable initially deferred for each row when (old.lifecycle is distinct from new.lifecycle)
 execute function private.permission_documents_subject_changed_v1();
create constraint trigger permission_documents_draft_state after update of state or delete on public.adult_subject_drafts
 deferrable initially deferred for each row execute function private.permission_documents_draft_changed_v1();

-- 10. Named-human review -----------------------------------------------------------
-- The database owner assigns one document to one named claim reviewer. No
-- API role can call this; the uploader of the draft can never be its reviewer.
create function private.assign_permission_document_review_v1(p_document_id uuid,p_reviewer_account_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_document private.permission_documents; v_revision bigint;
begin
 perform private.lock_invitation_transitions_v1();
 select * into v_document from private.permission_documents where id=p_document_id for update;
 if v_document.id is null or v_document.state<>'clean' or v_document.review_state<>'pending'
  or not private.permission_document_live_v1(v_document) then
  raise exception using errcode='42501',message='permission document unavailable'; end if;
 if not exists(select 1 from private.claim_reviewers where account_id=p_reviewer_account_id and status='active')
  or exists(select 1 from public.subjects s where s.id=v_document.subject_id and s.owner_account_id=p_reviewer_account_id) then
  raise exception using errcode='42501',message='permission document reviewer unavailable'; end if;
 update private.permission_document_assignments set status='ended',ended_at=clock_timestamp()
  where document_id=p_document_id and status='current';
 select coalesce(max(assignment_revision),0)+1 into v_revision from private.permission_document_assignments
  where document_id=p_document_id;
 insert into private.permission_document_assignments(document_id,reviewer_account_id,assignment_revision)
 values(p_document_id,p_reviewer_account_id,v_revision);
 perform private.append_legal_audit_event('legal-evidence.review.assigned',null,'operations','accepted',
  jsonb_build_object('document_kind','adult-signed-permission'));
 return v_revision;
end $$;
revoke all on function private.assign_permission_document_review_v1(uuid,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- The document the stepped-up caller is currently assigned, locked, clean,
-- awaiting a decision and still part of a live basis; otherwise nothing.
create function private.assigned_permission_document_v1(p_document_id uuid,p_account uuid)
returns private.permission_documents language plpgsql security definer set search_path='' as $$
declare v_document private.permission_documents;
begin
 perform private.lock_invitation_transitions_v1();
 select d.* into v_document from private.permission_documents d where d.id=p_document_id for update;
 if v_document.id is null or v_document.state<>'clean' or v_document.scan_verdict is distinct from 'OK'
  or v_document.scanned_sha256 is distinct from v_document.sha256 or v_document.review_state<>'pending'
  or not private.permission_document_live_v1(v_document)
  or not exists(select 1 from private.permission_document_assignments a join private.claim_reviewers r
   on r.account_id=a.reviewer_account_id and r.status='active'
   where a.document_id=v_document.id and a.reviewer_account_id=p_account and a.status='current')
  or exists(select 1 from public.subjects s where s.id=v_document.subject_id and s.owner_account_id=p_account) then
  return null; end if;
 return v_document;
end $$;
revoke all on function private.assigned_permission_document_v1(uuid,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- The route's discriminator: null when the id is not a permission document,
-- so the appeal branch keeps its own path; 42501 when it is one this
-- stepped-up reviewer is not currently assigned.
create function public.permission_document_review_context_v1(p_document uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reviewer record; v_document private.permission_documents;
begin
 if not exists(select 1 from private.permission_documents d where d.id=p_document) then return null; end if;
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null then raise exception using errcode='42501',message='review unavailable'; end if;
 v_document:=private.assigned_permission_document_v1(p_document,reviewer.account_id);
 if v_document.id is null then raise exception using errcode='42501',message='review unavailable'; end if;
 return jsonb_build_object('documentId',v_document.id,'sha256',v_document.sha256,
  'reviewRevision',v_document.review_revision,'documentKind',v_document.document_kind);
end $$;

-- The review-download dispatcher's permission branch: a revocable chunk
-- session for this reviewer and auth session only, one hour at most.
create function public.open_permission_review_download_v1(p_document_id uuid,p_cookie_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reviewer record; v_document private.permission_documents; v_download private.permission_document_review_downloads;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='review unavailable'; end if;
 v_document:=private.assigned_permission_document_v1(p_document_id,reviewer.account_id);
 if v_document.id is null then raise exception using errcode='42501',message='review unavailable'; end if;
 insert into private.permission_document_review_downloads(document_id,reviewer_account_id,auth_session_id,review_revision,
  cookie_hash,sha256,byte_count,chunk_count,expires_at)
 values(v_document.id,reviewer.account_id,reviewer.auth_session_id,v_document.review_revision,p_cookie_hash,
  v_document.sha256,v_document.byte_count,(v_document.byte_count+3999999)/4000000,clock_timestamp()+interval '1 hour')
 returning * into v_download;
 perform private.append_legal_audit_event('legal-evidence.review.read',null,'api.legal-evidence-review-download',
  'accepted',jsonb_build_object('document_kind','adult-signed-permission'));
 return jsonb_build_object('session',v_download.id,'sizeBytes',v_document.byte_count,'sha256',v_document.sha256,
  'chunkCount',v_download.chunk_count,'mediaType',v_document.media_type,'documentKind',v_document.document_kind,
  'reviewRevision',v_document.review_revision);
end $$;

-- The chunk dispatcher's permission branch: the same reviewer, auth session,
-- assignment, review revision and clean bytes, recorded per chunk.
create function public.authorize_permission_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reviewer record; v_download private.permission_document_review_downloads; v_document private.permission_documents;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='review unavailable'; end if;
 select * into v_download from private.permission_document_review_downloads where id=p_session_id
  and cookie_hash=p_cookie_hash and reviewer_account_id=reviewer.account_id and auth_session_id=reviewer.auth_session_id;
 if v_download.id is null or v_download.expires_at<=clock_timestamp()
  or v_download.last_activity_at<=clock_timestamp()-interval '5 minutes'
  or p_sequence is null or p_sequence not between 0 and v_download.chunk_count-1 then
  raise exception using errcode='42501',message='review unavailable'; end if;
 v_document:=private.assigned_permission_document_v1(v_download.document_id,reviewer.account_id);
 if v_document.id is null or v_document.review_revision<>v_download.review_revision
  or v_document.sha256<>v_download.sha256 or v_document.byte_count<>v_download.byte_count then
  raise exception using errcode='42501',message='review unavailable'; end if;
 update private.permission_document_review_downloads set last_activity_at=clock_timestamp() where id=v_download.id;
 insert into private.permission_document_review_reads(download_id,sequence) values(v_download.id,p_sequence)
  on conflict do nothing;
 if found then
  perform private.append_legal_audit_event('legal-evidence.document.chunk.read',null,'api.download-chunk','accepted',
   jsonb_build_object('document_kind','adult-signed-permission'));
 end if;
 return jsonb_build_object('documentId',v_document.id,'reviewId',v_document.id,'objectKey',v_document.object_key,
  'sha256',v_document.sha256,'byteCount',v_document.byte_count,
  'wrappedDataKey',(select encode(ds.wrapped_document_key,'hex') from private.permission_document_sessions ds
   where ds.id=v_document.session_id),'transport','permission');
end $$;

-- The current bodies (20261009224500) with the permission branch, marked
-- "20261016190000", first.
create or replace function public.review_document_domain_v1(p_document uuid) returns text
language plpgsql security definer set search_path='' as $$
declare reviewer record;appeal_review private.public_appeal_pending_reviews;
 claim_review private.claim_reviews;claim_document private.claim_documents;case_id uuid;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null then raise exception using errcode='42501',message='review unavailable';end if;
 -- 20261016190000: a subject-draft permission document.
 if exists(select 1 from private.permission_documents document where document.id=p_document) then
  if (private.assigned_permission_document_v1(p_document,reviewer.account_id)).id is null then
   raise exception using errcode='42501',message='review unavailable';end if;
  return 'permission';
 end if;
 if exists(select 1 from private.appeal_documents document where document.id=p_document) then
  if exists(select 1 from private.claim_documents document where document.id=p_document) then
   raise exception using errcode='42501',message='review unavailable';end if;
  select document.intake_id into case_id from private.appeal_documents document where document.id=p_document;
  appeal_review:=private.assigned_public_appeal_review_v1(case_id,reviewer.account_id);
  if appeal_review.case_id is null or not exists(select 1 from private.appeal_documents document
   join private.appeal_document_sessions session on session.id=document.session_id where document.id=p_document
    and document.id=any(array_remove(array[appeal_review.photo_document_id,appeal_review.authority_document_id,appeal_review.decision_notice_document_id],null))
    and document.state='clean' and document.object_deleted_at is null and document.scan_verdict='OK'
    and document.scanned_sha256=document.sha256 and session.wrapped_document_key is not null
    and not exists(select 1 from private.public_appeal_document_decisions outcome where outcome.document_id=document.id)) then
   raise exception using errcode='42501',message='review unavailable';end if;
  return 'appeal';
 end if;
 select review.id into case_id from private.claim_reviews review where review.photo_document_id=p_document or review.birth_record_document_id=p_document;
 claim_review:=private.assigned_claim_review_v1(case_id,reviewer.account_id);
 if claim_review.id is null or claim_review.state not in('document_review_pending','more_information_required','approved_pending_owner_notice') then
  raise exception using errcode='42501',message='review unavailable';end if;
 claim_document:=private.claim_review_document_v1(claim_review,p_document);
 if claim_document.id is null then raise exception using errcode='42501',message='review unavailable';end if;
 return 'claim';
end $$;
create or replace function public.open_claim_review_download_v1(p_document_id uuid,p_cookie_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- 20261016190000: a subject-draft permission document.
 if exists(select 1 from private.permission_documents doc where doc.id=p_document_id) then
  return public.open_permission_review_download_v1(p_document_id,p_cookie_hash);end if;
 if exists(select 1 from private.appeal_documents doc where doc.id=p_document_id) then
  return public.open_public_appeal_review_download_v1(p_document_id,p_cookie_hash);end if;
 return public.open_claim_review_download_before_appeal_v1(p_document_id,p_cookie_hash);
end $$;
create or replace function public.authorize_claim_review_chunk_v1(p_session_id uuid,p_cookie_hash text,p_sequence integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- 20261016190000: a subject-draft permission document review session.
 if exists(select 1 from private.permission_document_review_downloads d where d.id=p_session_id) then
  return public.authorize_permission_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence);end if;
 if exists(select 1 from private.public_appeal_review_downloads d where d.id=p_session_id) then
  return public.authorize_public_appeal_review_chunk_v1(p_session_id,p_cookie_hash,p_sequence)||jsonb_build_object('transport','appeal');end if;
 return public.authorize_claim_review_chunk_before_appeal_v1(p_session_id,p_cookie_hash,p_sequence);
end $$;

-- api.legal-evidence-review for a subject-draft document. Approval makes only
-- this document the eligible basis for a later api.subjects transaction;
-- rejection makes it unreadable and ends only its dependent draft. Neither
-- creates a consent on anyone's behalf. rejected-documentary-conflict must
-- dispatch contradiction-v1, which no producer implements yet: it is refused
-- here and records nothing (reported to the owner with this change).
create function public.decide_permission_document_v1(p_document uuid,p_sha256 text,p_review_revision bigint,
 p_decision text,p_nonce_hash text,p_reason_ciphertext bytea)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reviewer record; v_document private.permission_documents; v_decision uuid; v_now timestamptz;
 v_draft public.adult_subject_drafts;
begin
 select * into reviewer from private.claim_reviewer_step_up_v1();
 if reviewer.account_id is null or p_decision is null or p_decision not in ('approved','rejected')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_reason_ciphertext is null or octet_length(p_reason_ciphertext) not between 48 and 16384 then
  raise exception using errcode='42501',message='review unavailable'; end if;
 v_document:=private.assigned_permission_document_v1(p_document,reviewer.account_id);
 if v_document.id is null or p_review_revision is distinct from v_document.review_revision
  or p_sha256 is distinct from v_document.sha256 then
  raise exception using errcode='42501',message='review unavailable'; end if;
 -- The reviewer acknowledged the exact server hash their own bounded
 -- download session returned, and read every chunk of it.
 if not exists(select 1 from private.permission_document_review_downloads d where d.document_id=v_document.id
  and d.reviewer_account_id=reviewer.account_id and d.auth_session_id=reviewer.auth_session_id
  and d.review_revision=v_document.review_revision and d.sha256=v_document.sha256
  and d.expires_at>clock_timestamp()
  and (select count(*) from private.permission_document_review_reads r where r.download_id=d.id)=d.chunk_count) then
  raise exception using errcode='42501',message='review unavailable'; end if;
 v_now:=clock_timestamp();
 insert into private.permission_document_reviews(document_id,subject_id,document_kind,document_sha256,review_revision,
  decision,reviewer_account_id,auth_session_id,reason_ciphertext,nonce_hash,decided_at)
 values(v_document.id,v_document.subject_id,v_document.document_kind,v_document.sha256,v_document.review_revision,
  p_decision,reviewer.account_id,reviewer.auth_session_id,p_reason_ciphertext,p_nonce_hash,v_now)
 returning id into v_decision;
 perform set_config('inherit.permission_document_review',v_document.id::text,true);
 update private.permission_documents set review_state=p_decision,review_revision=review_revision+1
  where id=v_document.id;
 perform set_config('inherit.permission_document_review','',true);
 update private.permission_document_assignments set status='ended',ended_at=v_now
  where document_id=v_document.id and status='current';
 delete from private.permission_document_review_downloads where document_id=v_document.id;
 if p_decision='rejected' then
  -- Only the dependent draft ends; its subject becomes a purged tombstone
  -- exactly as an expired draft does, and the document key goes at commit.
  select * into v_draft from public.adult_subject_drafts where subject_id=v_document.subject_id for update;
  update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
   where principal_id in (select id from public.subject_principals where subject_id=v_document.subject_id)
    and status='current';
  update public.contact_hmac_indexes set status='revoked',expires_at=least(expires_at,v_now)
   where contact_reference_id in (select e.id from public.encrypted_contact_references e
    join public.subject_principals p on p.id=e.principal_id where p.subject_id=v_document.subject_id)
    and status='current';
  update public.subject_principals set status='deleted',principal_revision=principal_revision+1
   where subject_id=v_document.subject_id and status='pending';
  update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,updated_at=v_now
   where id=v_document.subject_id and lifecycle='draft';
  update public.subject_consents set revoked_at=v_now,revocation_reason='retention_expired'
   where subject_id=v_document.subject_id and consent_type='upload_class' and revoked_at is null;
  update public.adult_subject_drafts set state='cancelled' where id=v_draft.id and state='draft';
 end if;
 perform private.append_legal_audit_event('legal-evidence.document.reviewed',null,'api.legal-evidence-review',
  case when p_decision='approved' then 'accepted' else 'refused' end,
  jsonb_build_object('decision',p_decision,'document_kind','adult-signed-permission'));
 return jsonb_build_object('documentId',v_document.id,'decision',p_decision,'reviewRevision',v_document.review_revision+1);
end $$;

do $grants$ declare signature text; begin
 foreach signature in array array['permission_document_review_context_v1(uuid)',
  'open_permission_review_download_v1(uuid,text)','authorize_permission_review_chunk_v1(uuid,text,integer)',
  'decide_permission_document_v1(uuid,text,bigint,text,text,bytea)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated,service_role,inherit_upload_only';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $grants$;

-- 11. api.subjects (closed-subject-finalize-v1) ----------------------------------
-- The draft's own encrypted contact, for the service to compute its digests
-- under every held key revision in bounded memory. The body never carries
-- an address and none is accepted (api.subjects.policy.contact).
create function public.path_b_reviewed_document_contact_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare d public.adult_subject_drafts%rowtype; e public.encrypted_contact_references%rowtype;
begin
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 perform private.path_b_uploader_v1(p_account_id,p_session_id);
 d:=private.path_b_reviewed_document_draft_v1(p_account_id,p_subject_id);
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select e2.* into e from public.draft_participant_slots slot
  join public.subject_principals sp on sp.id=slot.principal_id
  join public.encrypted_contact_references e2 on e2.principal_id=sp.id
  where slot.adult_draft_id=d.id and slot.slot_kind='adult_subject' and slot.state='pending'
   and sp.subject_id=p_subject_id and sp.principal_kind='non_account_subject' and sp.status='pending'
   and e2.status='current' and e2.contact_ciphertext is not null and e2.authority_revision=sp.principal_revision;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('contactCiphertext',encode(e.contact_ciphertext,'hex'));
end $$;
revoke all on function public.path_b_reviewed_document_contact_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_reviewed_document_contact_v1(uuid,uuid,uuid,boolean) to service_role;

-- The approved, current review of the exact document of this draft, or null.
create function private.path_b_reviewed_document_approval_v1(p_subject_id uuid,p_document_id uuid,p_review_id uuid)
returns private.permission_document_reviews language plpgsql security definer set search_path='' as $$
declare v_document private.permission_documents; v_review private.permission_document_reviews;
begin
 select * into v_document from private.permission_documents where id=p_document_id and subject_id=p_subject_id for share;
 select * into v_review from private.permission_document_reviews where id=p_review_id for share;
 if v_document.id is null or v_review.id is null or v_document.state<>'clean' or v_document.review_state<>'approved'
  or not private.permission_document_live_v1(v_document)
  or v_review.document_id<>v_document.id or v_review.subject_id<>p_subject_id or v_review.decision<>'approved'
  or v_review.document_sha256<>v_document.sha256 or v_review.review_revision<>v_document.review_revision-1
  or exists(select 1 from private.permission_document_reviews later where later.document_id=v_document.id
   and later.review_revision>v_review.review_revision) then
  return null; end if;
 return v_review;
end $$;
revoke all on function private.path_b_reviewed_document_approval_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- The body compares one digest (the one the stored contact was written
-- under); the keyed definer below declares the whole presented set first so
-- the bar check walks every usable revision. Eligible and barred contacts
-- leave the same draft state and return the same receipt.
create function private.finalize_path_b_reviewed_document_core_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_document_id uuid,p_review_id uuid,p_nonce_hash text,p_contact_hmac text,p_idempotency_key text,
 p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare u jsonb; d public.adult_subject_drafts%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_review private.permission_document_reviews; v_slot uuid;
 v_invitation uuid; v_outbox uuid; v_expires timestamptz;
 v_received constant jsonb:=jsonb_build_object('status','received','next','awaiting_subject_confirmation');
begin
 perform private.lock_invitation_transitions_v1();
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_contact_hmac is null or p_contact_hmac!~'^[0-9a-f]{64}$'
  or p_idempotency_key is null or p_idempotency_key!~'^[0-9a-f]{64}$' or p_document_id is null or p_review_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 if exists(select 1 from public.profiles where id=p_account_id and non_self_upload_suspended_at is not null) then
  raise exception using errcode='42501',message='not_found'; end if;
 select * into s from public.subjects where id=p_subject_id for update;
 d:=private.path_b_reviewed_document_draft_v1(p_account_id,p_subject_id);
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into d from public.adult_subject_drafts where id=d.id for update;
 if private.path_b_uploader_consent_v1(p_account_id,s.id,(u->>'principalId')::uuid,
  (u->>'jurisdictionRevision')::bigint) is null then raise exception using errcode='42501',message='not_found'; end if;
 v_review:=private.path_b_reviewed_document_approval_v1(s.id,p_document_id,p_review_id);
 if v_review.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select sp.* into p from public.draft_participant_slots slot join public.subject_principals sp on sp.id=slot.principal_id
  where slot.adult_draft_id=d.id and slot.slot_kind='adult_subject' and slot.state='pending'
   and sp.subject_id=s.id and sp.principal_kind='non_account_subject' and sp.status='pending'
  for update of sp;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for update;
 if p.id is null or e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if e.contact_hmac<>p_contact_hmac then raise exception using errcode='55000',message='contact_digest_mismatch'; end if;
 -- The session-bound one-time operation nonce, spent whichever branch follows.
 insert into private.path_b_reviewed_document_nonces(nonce_hash,account_id,operation,target_id)
 values(p_nonce_hash,p_account_id,'finalize',s.id);
 -- Neither branch creates an upload-authorizing subject: the draft stays a
 -- draft until the recipient activation transaction.
 update public.adult_subject_drafts set state='invited' where id=d.id;
 if private.invitation_contact_barred_v1(p_contact_hmac) then
  return v_received; end if;
 select id into v_slot from public.draft_participant_slots where adult_draft_id=d.id and principal_id=p.id;
 v_expires:=least(clock_timestamp()+interval '30 days',d.fixed_expires_at);
 insert into public.subject_invitations(target_kind,target_id,inviter_principal_id,invitee_principal_id,email_hmac,
  email_encrypted,token_hash,invitation_kind,status,invitation_revision,expires_at)
 values('subject',s.id,(u->>'principalId')::uuid,p.id,e.contact_hmac,e.contact_ciphertext,
  encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),'adult_subject','pending',1,v_expires)
 returning id into v_invitation;
 insert into public.invitation_candidates(invitation_id,draft_slot_id,contact_reference_id,candidate_revision,state)
 values(v_invitation,v_slot,e.id,1,'issued');
 insert into private.path_b_reviewed_document_requests(invitation_id,subject_id,document_id,review_id,document_sha256,
  review_revision)
 values(v_invitation,s.id,p_document_id,v_review.id,v_review.document_sha256,v_review.review_revision);
 -- The same minimal request mail as the e-signature flow: the person is
 -- asked to sign their own Path B text, with no account.
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
 values('adult-subject-invitation','adult-subject-invitation','subject_invitation',v_invitation,p.id,e.id,
  p.principal_revision,1,p_idempotency_key,'adult-subject-invitation',v_invitation,
  jsonb_build_object('request','esignature'),v_expires)
 returning id into v_outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
 values(v_outbox,'adult-subject-invitation','subject_invitation',v_invitation,1,'pending',v_expires);
 perform private.append_legal_audit_event('invitation.issued',null,'api.subjects','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow','path-b-reviewed-document','revision',1));
 return v_received;
end $$;
revoke all on function private.finalize_path_b_reviewed_document_core_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- The keyed definer: the transition lock, then the per-account and
-- per-network invitation attempt quota (global-contact-refusal-bar-v1
-- .quotaAuthority) before any draft, document or contact match; an exhausted
-- quota writes nothing else and returns the receipt a barred contact gets.
-- Then the presented set resolves against the keyring and is declared.
create function private.finalize_path_b_reviewed_document_keyed_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_document_id uuid,p_review_id uuid,p_nonce_hash text,p_idempotency_key text,
 p_test_jurisdiction boolean,p_contact_hmac_set jsonb,p_quota_keys jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_set jsonb; v_contact text; v_stored public.encrypted_contact_references%rowtype; v_result jsonb;
begin
 perform private.lock_invitation_transitions_v1();
 if p_test_jurisdiction is distinct from true then raise exception using errcode='42501',message='not_found'; end if;
 if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then
  return jsonb_build_object('status','received','next','awaiting_subject_confirmation'); end if;
 v_set:=private.resolve_hmac_set_v1('contact',null,p_contact_hmac_set);
 if v_set is null then raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
 select e.* into v_stored from public.adult_subject_drafts d
  join public.draft_participant_slots slot on slot.adult_draft_id=d.id and slot.slot_kind='adult_subject' and slot.state='pending'
  join public.subject_principals sp on sp.id=slot.principal_id and sp.status='pending'
  join public.encrypted_contact_references e on e.principal_id=sp.id and e.status='current'
  where d.subject_id=p_subject_id and d.owner_account_id=p_account_id and d.adult_flow='path-b-reviewed-document'
  limit 1;
 v_contact:=private.presented_contact_digest_v1(v_set,v_stored.contact_hmac,v_stored.key_revision);
 v_result:=private.finalize_path_b_reviewed_document_core_v1(p_account_id,p_session_id,p_subject_id,p_document_id,
  p_review_id,p_nonce_hash,v_contact,p_idempotency_key,p_test_jurisdiction);
 perform private.declare_contact_alias_groups_v1('[]'::jsonb);
 return v_result;
end $$;
revoke all on function private.finalize_path_b_reviewed_document_keyed_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.finalize_path_b_reviewed_document_keyed_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 to service_role;
create function public.finalize_path_b_reviewed_document_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_document_id uuid,p_review_id uuid,p_nonce_hash text,p_idempotency_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb,p_quota_keys jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.finalize_path_b_reviewed_document_keyed_v1(p_account_id,p_session_id,p_subject_id,p_document_id,
  p_review_id,p_nonce_hash,p_idempotency_key,p_test_jurisdiction,p_contact_hmac_set,p_quota_keys); $$;
revoke all on function public.finalize_path_b_reviewed_document_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.finalize_path_b_reviewed_document_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 to service_role;

-- 12. Recipient activation --------------------------------------------------------
-- adult-subject-confirmation-v1, path-b-reviewed-document: recheck the exact
-- current approved document hash, review and request binding.
create function private.path_b_reviewed_document_basis_current_v1(p_subject_id uuid,p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r private.path_b_reviewed_document_requests; v_review private.permission_document_reviews;
begin
 select * into r from private.path_b_reviewed_document_requests where invitation_id=p_invitation_id and subject_id=p_subject_id
  for share;
 if r.invitation_id is null then return false; end if;
 v_review:=private.path_b_reviewed_document_approval_v1(p_subject_id,r.document_id,r.review_id);
 return v_review.id is not null and v_review.document_sha256=r.document_sha256 and v_review.review_revision=r.review_revision;
end $$;
revoke all on function private.path_b_reviewed_document_basis_current_v1(uuid,uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- The activation's own effect on the document: legal-evidence.adult-permission-24mo
-- after acceptance, a fixed deadline set once (the adult.non-account-holder-24mo length).
create function private.settle_path_b_reviewed_document_activation_v1(p_subject_id uuid,p_invitation_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare r private.path_b_reviewed_document_requests;
begin
 select * into r from private.path_b_reviewed_document_requests where invitation_id=p_invitation_id and subject_id=p_subject_id;
 update private.permission_documents set retain_until=p_now+make_interval(days=>
  (private.permission_document_limits_v1()->>'acceptedRetentionDays')::integer)
  where id=r.document_id and retain_until is null;
 if not found then raise exception using errcode='55000',message='reviewed_document_basis_changed'; end if;
end $$;
revoke all on function private.settle_path_b_reviewed_document_activation_v1(uuid,uuid,timestamptz) from public,anon,authenticated,service_role,inherit_upload_only;

-- After activation: the subject's current completed reviewed-document basis.
create function private.path_b_reviewed_document_retained_v1(p_subject_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.permission_documents d where d.subject_id=p_subject_id and d.state='clean'
  and d.review_state='approved' and private.permission_document_live_v1(d));
$$;
revoke all on function private.path_b_reviewed_document_retained_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;

-- The two confirmation transactions: their current bodies
-- (20260928150000 and 20260930210000), with the changes marked "20261016190000".
-- The person signs the same Path B text either way; the account and token
-- branches still race under the same locks and exactly one commits.
create or replace function private.confirm_path_b_subject_v1(p_session_hash text, p_nonce text, p_artifact_version integer, p_artifact_body_sha256 text, p_statement_keys text[], p_signing_name_ciphertext bytea, p_jurisdiction_code text, p_test_jurisdiction boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare v_now timestamptz; v_session public.rights_sessions%rowtype; v_token public.token_hashes%rowtype;
 v_candidate public.token_candidates%rowtype; v_invitation public.subject_invitations%rowtype;
 d public.adult_subject_drafts%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 a public.consent_artifacts%rowtype; v_dob date; v_revision bigint;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 if p_test_jurisdiction is distinct from true or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then
  return 'unavailable'; end if;
 -- statement-keys:consent.subject-adult-esignature
 if p_statement_keys is distinct from array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16
  or p_jurisdiction_code is null or p_jurisdiction_code!~'^[A-Z]{2}$' or p_artifact_version is null then
  return 'unavailable'; end if;
 select rs.* into v_session from public.rights_sessions rs where rs.session_hash=p_session_hash
  and rs.purpose='adult-subject-invitation' and rs.target_kind='subject' and rs.status='active' and rs.expires_at>v_now
 for update;
 if v_session.id is null then return 'unavailable'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'invitation_respond','rights_session',v_session.id);
 select th.* into v_token from public.token_hashes th where th.id=v_session.token_hash_id for update;
 v_invitation:=private.current_adult_subject_invitation_v1(v_session.token_hash_id,v_session.id);
 if v_token.id is null or v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then
  return 'unavailable'; end if;
 select * into d from public.adult_subject_drafts where subject_id=v_invitation.target_id and state='invited'
  -- 20261016190000: both Path B flows; the reviewed-document basis is rechecked below.
  and adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and fixed_expires_at>v_now for update;
 select * into s from public.subjects where id=v_invitation.target_id for update;
 select * into p from public.subject_principals where id=v_invitation.invitee_principal_id and subject_id=s.id
  and status='pending' and principal_kind='non_account_subject' for update;
 select date_of_birth into v_dob from public.subject_demographics where subject_id=s.id;
 if d.id is null or s.id is null or p.id is null or s.lifecycle<>'draft' or s.subject_account_id is not null
  or s.owner_account_id is distinct from d.owner_account_id or v_session.principal_id<>p.id
  or v_dob is null or v_dob>(timezone('UTC',v_now)::date-interval '18 years')::date then
  return 'unavailable'; end if;
 -- 20261016190000: the exact current approved document, review and request binding.
 if d.adult_flow='path-b-reviewed-document'
  and not private.path_b_reviewed_document_basis_current_v1(s.id,v_invitation.id) then
  return 'unavailable'; end if;
 select * into a from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'
  and version=p_artifact_version and superseded_at is null and published_at<=v_now
  and effective_on<=timezone('UTC',v_now)::date for share;
 if a.artifact_key is null or a.body_sha256 is distinct from p_artifact_body_sha256
  or encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex') is distinct from p_artifact_body_sha256 then
  return 'unavailable'; end if;
 select tc.* into v_candidate from public.token_candidates tc where tc.id=v_token.candidate_id for update;

 update public.subject_principals set status='active',principal_revision=principal_revision+1
  where id=p.id returning principal_revision into v_revision;
 -- The contact the notices go to follows the principal's revision.
 update public.encrypted_contact_references set authority_revision=v_revision
  where principal_id=p.id and status='current';
 update public.subjects set lifecycle='active',subject_binding_revision=subject_binding_revision+1,
  lifecycle_revision=lifecycle_revision+1,updated_at=v_now where id=s.id returning * into s;
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,p.id,null,'subject',s.id,'adult-subject-path-b-confirmation',
  p_statement_keys,p_signing_name_ciphertext,p_jurisdiction_code,1,s.subject_binding_revision);
 update public.subject_invitations set status='accepted',accepted_at=v_now,terminal_at=v_now,
  contact_purge_due_at=v_now+interval '30 days' where id=v_invitation.id;
 update public.token_hashes set status='consumed',ended_at=v_now where id=v_token.id and status='current';
 update public.token_candidates set state='invalidated' where id=v_candidate.id;
 update public.rights_sessions set status='consumed',ended_at=v_now where id=v_session.id;
 update public.draft_participant_slots set state='current',slot_revision=slot_revision+1
  where adult_draft_id=d.id and principal_id=p.id;
 update public.adult_subject_drafts set state='confirmed' where id=d.id;
 -- 20261016190000: the document's fixed post-acceptance deadline is set once, here.
 if d.adult_flow='path-b-reviewed-document' then
  perform private.settle_path_b_reviewed_document_activation_v1(s.id,v_invitation.id,v_now); end if;
 perform private.append_legal_audit_event('invitation.accepted',null,'api.withdraw','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow',d.adult_flow,'revision',1));
 return 'accepted';
end;
$function$;
create or replace function private.confirm_path_b_subject_account_core_v1(p_session_hash text, p_nonce text, p_artifact_version integer, p_artifact_body_sha256 text, p_statement_keys text[], p_signing_name_ciphertext bytea, p_account_id uuid, p_auth_session_id uuid, p_account_email_hmac text, p_test_jurisdiction boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare v_now timestamptz; v_session public.rights_sessions%rowtype; v_token public.token_hashes%rowtype;
 v_candidate public.token_candidates%rowtype; v_invitation public.subject_invitations%rowtype;
 d public.adult_subject_drafts%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 a public.consent_artifacts%rowtype; pr public.profiles%rowtype; v_dob date; v_revision bigint;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 if p_test_jurisdiction is distinct from true or p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$'
  or p_account_id is null or p_auth_session_id is null
  or p_account_email_hmac is null or p_account_email_hmac!~'^[0-9a-f]{64}$' then
  return 'unavailable'; end if;
 -- statement-keys:consent.subject-adult-esignature
 if p_statement_keys is distinct from array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16 or p_artifact_version is null then
  return 'unavailable'; end if;
 -- The account: its own live session, and a current own jurisdiction declaration.
 perform 1 from auth.sessions x where x.id=p_auth_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>v_now);
 if not found or not private.path_b_account_current_v1(p_account_id) then return 'unavailable'; end if;
 select * into pr from public.profiles where id=p_account_id for update;
 select rs.* into v_session from public.rights_sessions rs where rs.session_hash=p_session_hash
  and rs.purpose='adult-subject-invitation' and rs.target_kind='subject' and rs.status='active' and rs.expires_at>v_now
 for update;
 if v_session.id is null then return 'unavailable'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'invitation_respond','rights_session',v_session.id);
 select th.* into v_token from public.token_hashes th where th.id=v_session.token_hash_id for update;
 v_invitation:=private.current_adult_subject_invitation_v1(v_session.token_hash_id,v_session.id);
 if v_token.id is null or v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac)
  or p_account_email_hmac<>v_invitation.email_hmac then
  return 'unavailable'; end if;
 select * into d from public.adult_subject_drafts where subject_id=v_invitation.target_id and state='invited'
  -- 20261016190000: both Path B flows; the reviewed-document basis is rechecked below.
  and adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and fixed_expires_at>v_now for update;
 select * into s from public.subjects where id=v_invitation.target_id for update;
 select * into p from public.subject_principals where id=v_invitation.invitee_principal_id and subject_id=s.id
  and status='pending' and principal_kind='non_account_subject' and account_id is null for update;
 select date_of_birth into v_dob from public.subject_demographics where subject_id=s.id;
 -- The uploader can never confirm for the person, in any account.
 if d.id is null or s.id is null or p.id is null or s.lifecycle<>'draft' or s.subject_account_id is not null
  or s.owner_account_id is distinct from d.owner_account_id or d.owner_account_id=p_account_id
  or v_session.principal_id<>p.id
  or v_dob is null or v_dob>(timezone('UTC',v_now)::date-interval '18 years')::date then
  return 'unavailable'; end if;
 -- 20261016190000: the exact current approved document, review and request binding.
 if d.adult_flow='path-b-reviewed-document'
  and not private.path_b_reviewed_document_basis_current_v1(s.id,v_invitation.id) then
  return 'unavailable'; end if;
 select * into a from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'
  and version=p_artifact_version and superseded_at is null and published_at<=v_now
  and effective_on<=timezone('UTC',v_now)::date for share;
 if a.artifact_key is null or a.body_sha256 is distinct from p_artifact_body_sha256
  or encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex') is distinct from p_artifact_body_sha256 then
  return 'unavailable'; end if;
 select tc.* into v_candidate from public.token_candidates tc where tc.id=v_token.candidate_id for update;

 -- The one confirmation principal becomes the person's account; its contact,
 -- where every later notice goes, follows the new principal revision.
 update public.subject_principals set account_id=p_account_id,principal_kind='account_subject',status='active',
  principal_revision=principal_revision+1 where id=p.id returning principal_revision into v_revision;
 update public.encrypted_contact_references set authority_revision=v_revision
  where principal_id=p.id and status='current';
 -- Owned by the uploader, bound to the person's account.
 update public.subjects set subject_account_id=p_account_id,lifecycle='active',
  subject_binding_revision=subject_binding_revision+1,lifecycle_revision=lifecycle_revision+1,updated_at=v_now
 where id=s.id returning * into s;
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,p.id,p_account_id,'subject',s.id,'adult-subject-path-b-confirmation',
  p_statement_keys,p_signing_name_ciphertext,pr.jurisdiction_code,pr.jurisdiction_revision,s.subject_binding_revision);
 update public.subject_invitations set status='accepted',accepted_at=v_now,terminal_at=v_now,
  contact_purge_due_at=v_now+interval '30 days' where id=v_invitation.id;
 update public.token_hashes set status='consumed',ended_at=v_now where id=v_token.id and status='current';
 update public.token_candidates set state='invalidated' where id=v_candidate.id;
 update public.rights_sessions set status='consumed',ended_at=v_now where id=v_session.id;
 update public.draft_participant_slots set state='current',slot_revision=slot_revision+1
  where adult_draft_id=d.id and principal_id=p.id;
 update public.adult_subject_drafts set state='confirmed' where id=d.id;
 -- 20261016190000: the document's fixed post-acceptance deadline is set once, here.
 if d.adult_flow='path-b-reviewed-document' then
  perform private.settle_path_b_reviewed_document_activation_v1(s.id,v_invitation.id,v_now); end if;
 perform private.append_legal_audit_event('invitation.accepted',null,'api.withdraw','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow',d.adult_flow,
   'confirmation','account','revision',1));
 return 'accepted';
end;
$function$;

-- The held-upload authority: a confirmed reviewed-document subject whose
-- approved document is still its live basis may receive held uploads, after
-- activation only. Current body (20260930210000) with the change marked "20261016190000".
create or replace function private.path_b_subject_v1(p_account_id uuid, p_subject_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_signature uuid;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'active' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not distinct from p_account_id then
  raise exception using errcode='42501',message='not_found'; end if;
 -- path-b-only: a Path A subject never has a confirmed Path B draft.
 select * into d from public.adult_subject_drafts where subject_id=s.id and owner_account_id=p_account_id
  -- 20261016190000: or the reviewed-document flow, with its approved document still live.
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'
    and private.path_b_reviewed_document_retained_v1(s.id)))
  and state='confirmed' for share;
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- 20260930210000: the one confirmation principal is either the person with no
 -- account (subject_account_id null) or the person's own account.
 select * into p from public.subject_principals where subject_id=s.id and status='active'
  and ((principal_kind='non_account_subject' and account_id is null and s.subject_account_id is null)
   or (principal_kind='account_subject' and account_id=s.subject_account_id)) for share;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for share;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select cs.id into v_signature from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=p.id and cs.signer_account_id is not distinct from p.account_id
  and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision
  and ca.artifact_key='consent.subject-adult-esignature'
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1;
 if v_signature is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,
  'subjectLifecycleRevision',s.lifecycle_revision,'principalId',p.id,'principalRevision',p.principal_revision,
  'contactReferenceId',e.id,'confirmationSignatureId',v_signature);
end;
$function$;

-- The uploader's list: a confirmed reviewed-document subject is listed with
-- the e-signature subjects (the same held-upload card). Its earlier states are
-- listed by public.path_b_reviewed_document_targets_v1 below. Current body
-- (20260928150000) with the change marked "20261016190000".
create or replace function private.other_adult_upload_targets_v1(p_account_id uuid, p_session_id uuid, p_test_jurisdiction boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions a where a.id=p_session_id and a.user_id=p_account_id
  and (a.not_after is null or a.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.created_at,t.subject_id),'[]'::jsonb) into v_result from (
  select s.id as subject_id,d.created_at,jsonb_build_object(
   'subjectId',s.id,'label',s.display_label,'requestedAt',d.created_at,
   'answerBy',case when d.state in ('draft','invited') then d.fixed_expires_at end,
   'state',case
    when d.state='draft' then 'awaiting-request'
    when d.state='invited' then 'awaiting-signature'
    when pending.id is not null then 'pending'
    else 'ready' end,
   'signed',exists(select 1 from public.subject_consents sc join public.consent_signatures cs on cs.id=sc.signature_id
     where sc.subject_id=s.id and sc.account_id=p_account_id and sc.consent_type='upload_class'
      and sc.revoked_at is null and cs.artifact_key='consent.upload-other-adult'),
   'latest',case when latest.id is null then null else jsonb_build_object('state',latest.state,
    'addedOn',latest.held_at,'deleteBy',case when latest.state='pending' then latest.fixed_deadline end,
    'confirmedOn',latest.confirmed_at) end) as item
  from public.adult_subject_drafts d
  join public.subjects s on s.id=d.subject_id
  left join public.other_adult_held_uploads pending on pending.subject_id=s.id and pending.state='pending'
  left join lateral (select h.* from public.other_adult_held_uploads h where h.subject_id=s.id
   order by h.held_at desc,h.id limit 1) latest on true
  where d.owner_account_id=p_account_id
   -- 20261016190000: a confirmed reviewed-document subject too.
   and (d.adult_flow='path-b-subject-esignature' or (d.adult_flow='path-b-reviewed-document' and d.state='confirmed'
    and private.path_b_reviewed_document_retained_v1(s.id)))
   and s.owner_account_id=p_account_id and s.subject_class='other_adult'
   and ((d.state in ('draft','invited') and s.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
    or (d.state='confirmed' and s.lifecycle='active'))
 ) t;
 return v_result;
end;
$function$;

-- 13. Account deletion refuses this flow's graph exactly as it refuses the
-- e-signature flow's: no executor can yet dispose of either. Current body
-- with the changes marked "20261016190000".
create or replace function private.assert_account_path_b_deletion_supported_v1(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Path B issuers lock the same current profile before creating a draft,
  -- binding the person, or issuing held storage. Keep that serialization.
  perform 1 from public.profiles where id=p_account_id for update;
  if not found then raise exception using errcode='55000',message='unsupported_account_graph';end if;
  if exists(select 1 from public.adult_subject_drafts d join public.subjects s on s.id=d.subject_id
      -- 20261016190000: both Path B flows.
      where d.adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and (d.owner_account_id=p_account_id
        or s.owner_account_id=p_account_id or s.subject_account_id=p_account_id
        or exists(select 1 from public.subject_principals p where p.subject_id=s.id and p.account_id=p_account_id)))
    -- 20261016190000: any permission document session the account opened or that targets its subjects.
    or exists(select 1 from private.permission_document_sessions x join public.subjects s on s.id=x.subject_id
      where x.owner_account_id=p_account_id or s.owner_account_id=p_account_id or s.subject_account_id=p_account_id)
    or exists(select 1 from public.upload_sessions u where u.upload_authority_kind='other-adult-held'
      and (u.account_id=p_account_id or exists(select 1 from public.subjects s where s.id=u.subject_id
        and (s.owner_account_id=p_account_id or s.subject_account_id=p_account_id))))
    or exists(select 1 from public.other_adult_held_uploads h join public.subjects s on s.id=h.subject_id
      join public.subject_principals p on p.id=h.confirmation_principal_id
      where h.uploader_account_id=p_account_id or s.owner_account_id=p_account_id
        or s.subject_account_id=p_account_id or p.account_id=p_account_id)
    or exists(select 1 from private.path_b_report_bindings b join public.subjects s on s.id=b.subject_id
      join public.genome_files f on f.id=b.file_id where b.recipient_account_id=p_account_id
        or s.owner_account_id=p_account_id or s.subject_account_id=p_account_id or f.user_id=p_account_id)
    or exists(select 1 from public.purpose_grants g where g.target_kind='subject'
      and (g.path_b_originating_session_id is not null or exists(select 1 from public.adult_subject_drafts d
        where d.subject_id=g.target_id and d.adult_flow='path-b-subject-esignature'))
      and (exists(select 1 from public.subject_principals p where p.account_id=p_account_id
        and p.id in(g.data_subject_principal_id,g.signer_principal_id))
        or exists(select 1 from public.directional_grants d where d.grant_id=g.grant_id
          and (d.recipient_account_id=p_account_id or exists(select 1 from public.subject_principals p
            where p.id=d.recipient_principal_id and p.account_id=p_account_id)))))
  then
    -- Ending a descriptor/report is not a physical upload-working disposal ACK.
    -- Current, terminal and retained historical rows require one exact graph
    -- executor; no foreign ownership or provider inventory may be inferred.
    raise exception using errcode='55000',message='unsupported_account_graph';
  end if;
end;
$function$;

-- 14. What the uploader sees before activation -----------------------------------
-- One state per reviewed-document draft and nothing else: the name the
-- uploader typed, dates, whether they signed, and, for the document, only
-- its own ids once it is theirs to finalize. A barred and an eligible
-- request read the same.
create function private.path_b_reviewed_document_targets_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions a where a.id=p_session_id and a.user_id=p_account_id
  and (a.not_after is null or a.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.created_at,t.subject_id),'[]'::jsonb) into v_result from (
  select s.id as subject_id,d.created_at,jsonb_build_object(
   'subjectId',s.id,'label',s.display_label,'requestedAt',d.created_at,'answerBy',d.fixed_expires_at,
   'signed',exists(select 1 from public.subject_consents sc join public.consent_signatures cs on cs.id=sc.signature_id
     where sc.subject_id=s.id and sc.account_id=p_account_id and sc.consent_type='upload_class'
      and sc.revoked_at is null and cs.artifact_key='consent.upload-other-adult'),
   'state',case
    when d.state='cancelled' then 'document-refused'
    when d.state='invited' then 'awaiting-signature'
    when approved.id is not null then 'awaiting-request'
    when reviewing.id is not null then 'document-review'
    else 'awaiting-document' end,
   'documentId',case when d.state='draft' then approved.document_id end,
   'legalReviewId',case when d.state='draft' then approved.id end) as item
  from public.adult_subject_drafts d
  join public.subjects s on s.id=d.subject_id
  left join lateral (select r.* from private.permission_documents doc
   join private.permission_document_reviews r on r.document_id=doc.id and r.decision='approved'
    and r.review_revision=doc.review_revision-1
   where doc.subject_id=s.id and doc.review_state='approved' and private.permission_document_live_v1(doc)
   order by r.decided_at desc limit 1) approved on true
  left join lateral (select doc.id from private.permission_documents doc
   where doc.subject_id=s.id and doc.state in ('quarantined','clean') and doc.review_state='pending'
    and private.permission_document_live_v1(doc) limit 1) reviewing on true
  where d.owner_account_id=p_account_id and d.adult_flow='path-b-reviewed-document'
   and s.owner_account_id=p_account_id and s.subject_class='other_adult'
   and ((d.state in ('draft','invited') and s.lifecycle='draft') or d.state='cancelled')
   and d.fixed_expires_at>clock_timestamp()
 ) t;
 return v_result;
end $$;
revoke all on function private.path_b_reviewed_document_targets_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_reviewed_document_targets_v1(uuid,uuid,boolean) to service_role;
create function public.path_b_reviewed_document_targets_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.path_b_reviewed_document_targets_v1(p_account_id,p_session_id,p_test_jurisdiction); $$;
revoke all on function public.path_b_reviewed_document_targets_v1(uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.path_b_reviewed_document_targets_v1(uuid,uuid,boolean) to service_role;

-- 15. The retention sweep (jobs.retention) ------------------------------------------
-- adult.subject-draft-30d for a reviewed-document draft no pending request
-- covers (a pending request is ended by expire_due_adult_subject_invitations_v1
-- at the same fixed deadline): the same tombstone as an expired e-signature
-- draft. The commit-time trigger erases the document key; the objects and
-- rows go through public.permission_document_objects_due_v1. Spent nonces go
-- a day after use.
create function public.expire_due_path_b_reviewed_documents_v1()
returns integer language plpgsql security definer set search_path=pg_catalog,private as $$
declare v record; n integer:=0; v_now timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 for v in select d.id,d.subject_id from public.adult_subject_drafts d
  where d.adult_flow='path-b-reviewed-document' and d.state in ('draft','invited','cancelled') and d.fixed_expires_at<=v_now
   and not exists(select 1 from public.subject_invitations i where i.target_kind='subject' and i.target_id=d.subject_id
    and i.status='pending')
  order by d.fixed_expires_at,d.id for update of d
 loop
  update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
   where principal_id in (select id from public.subject_principals where subject_id=v.subject_id) and status='current';
  update public.subject_principals set status='deleted',principal_revision=principal_revision+1
   where subject_id=v.subject_id and status='pending';
  update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,updated_at=v_now
   where id=v.subject_id and lifecycle='draft';
  update public.subject_consents set revoked_at=v_now,revocation_reason='retention_expired'
   where subject_id=v.subject_id and consent_type='upload_class' and revoked_at is null;
  update public.adult_subject_drafts set state='expired' where id=v.id;
  n:=n+1;
 end loop;
 delete from private.path_b_reviewed_document_nonces where purge_after<=v_now;
 return n;
end $$;
revoke all on function public.expire_due_path_b_reviewed_documents_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_due_path_b_reviewed_documents_v1() to service_role;
