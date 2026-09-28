-- Another adult's genome, held apart until that adult answers (brief §2.6,
-- G2.6 adult half, G5.3). TEST-LOCAL only.
--
-- What this adds:
--   * An uploader who holds a pending adult-subject invitation may upload a
--     file for that reserved subject, only after signing the draft
--     `consent.upload-other-adult` (Tier 2) for that exact subject.
--   * The upload travels through the existing direct-Storage transport and
--     finalization, then stops: no `genome_files` row is written. The source
--     is recorded in `public.other_adult_held_uploads` and is unreadable by
--     every reader, because every reader reads through `genome_files`.
--   * Acceptance through the existing invitation flow releases the file to
--     the accepting account's own `self` subject, as an ordinary unprepared
--     own file. Nothing is prepared, analysed or enqueued; the subject's own
--     upload consent and choices govern from then on.
--   * Refusal, deletion of the reservation, invitation expiry, the fixed
--     `adult.unconfirmed-30d` deadline and the uploader's account deletion
--     reject the held session, which the existing upload-working executor
--     (`claim_own_upload_purge_v1`) then deletes from Storage and the
--     database.
--
-- Nothing here is available outside TEST-LOCAL. The artifact is a draft the
-- owner has not approved: no migration seeds it, and the one installer below
-- refuses unless the server passes the test-jurisdiction flag and the exact
-- pinned text. Signing and issuance both refuse without that flag. Without
-- the artifact no uploader consent can exist, and without that consent the
-- held-upload authority refuses every transport step.
--
-- Redefined functions keep their current bodies; each change is marked
-- "20260928150000" in a comment beside it.

-- 1. Schema -----------------------------------------------------------------

alter table public.upload_sessions
 add column upload_authority_kind text not null default 'own-subject'
  check (upload_authority_kind in ('own-subject','other-adult-held'));
alter table public.upload_sessions drop constraint upload_sessions_status_check;
alter table public.upload_sessions add constraint upload_sessions_status_check check (status in (
 'issued','uploaded','validating','held','promoted','rejected','expired','cancelled'));
-- Only a held-kind session can be held, and a held session has no file row.
alter table public.upload_sessions add constraint upload_sessions_held_kind_check check (
 status<>'held' or (upload_authority_kind='other-adult-held' and finalized_file_id is null and consumed_at is null));

create table public.other_adult_held_uploads (
 upload_session_id uuid primary key references public.upload_sessions(id) on delete cascade,
 subject_id uuid not null references public.subjects(id) on delete restrict,
 invitation_id uuid not null,
 uploader_account_id uuid not null references auth.users(id) on delete restrict,
 uploader_consent_id uuid not null references public.subject_consents(id) on delete restrict,
 storage_object_id uuid not null,
 object_name text not null check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 file_type public.genome_file_type not null,
 size_bytes bigint not null check (size_bytes>0),
 raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
 decoded_sha256 text not null check (decoded_sha256 ~ '^[0-9a-f]{64}$'),
 upload_revision bigint not null check (upload_revision>0),
 held_at timestamptz not null default clock_timestamp(),
 fixed_deadline timestamptz not null,
 state text not null default 'held' check (state in ('held','released','refused','deleted','expired','withdrawn')),
 terminal_at timestamptz,
 released_file_id uuid references public.genome_files(id) on delete set null,
 released_account_id uuid,
 check ((state='held')=(terminal_at is null)),
 check ((state='released')=(released_account_id is not null)),
 check (fixed_deadline>held_at and fixed_deadline<=held_at+interval '30 days')
);
create unique index other_adult_held_uploads_one_held_idx
 on public.other_adult_held_uploads(subject_id) where state='held';
create index other_adult_held_uploads_uploader_idx
 on public.other_adult_held_uploads(uploader_account_id, state);
alter table public.other_adult_held_uploads enable row level security;
revoke all on table public.other_adult_held_uploads from public,anon,authenticated,inherit_upload_only;
grant all on table public.other_adult_held_uploads to service_role;

-- A held source is upload working state until its subject answers; its
-- Storage objects stay in the upload-working manifest of its session.
insert into public.purge_target_stores(target_id,store_name,store_order)
values ('upload-and-ingest-working-state','public.other_adult_held_uploads',33);

alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign',
  'own_account_completion','other_adult_upload_artifact_sign'));

-- 2. The draft artifact, installable only under TEST-LOCAL -------------------
-- The text is pinned by hash. The file content/legal/consent.upload-other-adult/v1.md
-- is the source; content/legal/consent-upload-other-adult.test.ts holds the
-- pins below equal to it. The owner's approval replaces this with an ordinary
-- seeded version.
create function private.install_test_local_other_adult_artifact_v1(p_body text,p_summary text,
 p_effective_on date,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_body is null or p_summary is null or p_effective_on is distinct from date '2026-09-28'
  -- pinned-body-sha256:consent.upload-other-adult
  or encode(extensions.digest(convert_to(p_body,'UTF8'),'sha256'),'hex')<>'2a943b563a40098e7cb4a689c8a5a5489bd5c12f1e1a013c8a878f6a93a3fc6b'
  -- pinned-summary-sha256:consent.upload-other-adult
  or encode(extensions.digest(convert_to(p_summary,'UTF8'),'sha256'),'hex')<>'ff2c367c1555fcfec74e9b299d121349c6dbfe832c70b17dc4652de11fe67380' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
 values('consent.upload-other-adult',1,'2a943b563a40098e7cb4a689c8a5a5489bd5c12f1e1a013c8a878f6a93a3fc6b',
  p_body,p_summary,p_effective_on)
 on conflict (artifact_key,version) do nothing;
 return exists(select 1 from public.consent_artifacts where artifact_key='consent.upload-other-adult'
  and version=1 and body_markdown=p_body and summary_markdown=p_summary and effective_on=p_effective_on);
end;
$function$;
revoke all on function private.install_test_local_other_adult_artifact_v1(text,text,date,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.install_test_local_other_adult_artifact_v1(text,text,date,boolean) to service_role;
create function public.install_test_local_other_adult_artifact_v1(p_body text,p_summary text,
 p_effective_on date,p_test_jurisdiction boolean)
returns boolean language sql security invoker set search_path=pg_catalog
as $function$ select private.install_test_local_other_adult_artifact_v1(p_body,p_summary,p_effective_on,p_test_jurisdiction); $function$;
revoke all on function public.install_test_local_other_adult_artifact_v1(text,text,date,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.install_test_local_other_adult_artifact_v1(text,text,date,boolean) to service_role;

-- 3. The uploader's reservation ---------------------------------------------
-- The reserved subject of the uploader's own pending adult-subject
-- invitation, before its recipient opens it. The recipient's review is what
-- they answer, so a held upload is only possible before the first rights
-- session exists: acceptance can never release a file its reviewer did not see.
create function private.other_adult_upload_reservation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; s public.subjects%rowtype; si public.subject_invitations%rowtype; v_self uuid; v_code text;
begin
 select id into v_self from public.subjects where subject_account_id=p_account_id
  and subject_class='self' and lifecycle='active';
 if v_self is null then raise exception using errcode='42501',message='not_found'; end if;
 -- The uploader's own live account, session, profile and self binding.
 c:=private.own_upload_context_v1(p_account_id,p_session_id,v_self);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'draft' or s.owner_account_id is distinct from p_account_id or s.subject_account_id is not null then
  raise exception using errcode='42501',message='not_found'; end if;
 select si0.* into si from public.subject_invitations si0
  join public.subject_principals ip on ip.id=si0.inviter_principal_id and ip.account_id=p_account_id
   and ip.principal_kind='account_subject' and ip.status='active'
  join public.adult_subject_drafts d on d.subject_id=si0.target_id and d.owner_account_id=p_account_id
   and d.state='invited' and d.fixed_expires_at>clock_timestamp()
 where si0.target_kind='subject' and si0.target_id=s.id and si0.invitation_kind='adult_subject'
  and si0.status='pending' and si0.expires_at>clock_timestamp()
 for share of si0;
 if si.id is null or private.invitation_contact_barred_v1(si.email_hmac) then
  raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from public.rights_sessions rs where rs.purpose='adult-subject-invitation'
  and rs.target_kind='subject' and rs.target_id=s.id) then
  raise exception using errcode='55000',message='recipient_reviewing'; end if;
 select jurisdiction_code into v_code from public.profiles where id=p_account_id;
 return jsonb_build_object('accountRevision',c->'accountRevision','authSessionRevision',c->'authSessionRevision',
  'jurisdictionRevision',c->'jurisdictionRevision','jurisdictionCode',coalesce(v_code,'ZZ'),
  'subjectBindingRevision',s.subject_binding_revision,'subjectLifecycleRevision',s.lifecycle_revision,
  'invitationId',si.id,'invitationRevision',si.invitation_revision,'invitationExpiresAt',si.expires_at,
  'inviterPrincipalId',si.inviter_principal_id);
end;
$function$;
revoke all on function private.other_adult_upload_reservation_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.other_adult_upload_reservation_v1(uuid,uuid,uuid) to service_role;

-- 4. The held-upload store authority ----------------------------------------
-- The same snapshot shape as private.own_upload_store_authority_v1, so the
-- existing transport compares it with the session row unchanged. It is never
-- a reader's authority: every reader keeps calling the own-subject authority,
-- which refuses an uploader who holds no binding to this subject.
create function private.other_adult_upload_store_authority_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; v_consent uuid; v_session bigint;
begin
 r:=private.other_adult_upload_reservation_v1(p_account_id,p_session_id,p_subject_id);
 -- The uploader's current Tier-2 signature of the draft artifact, hash-verified,
 -- at this subject's binding and the uploader's jurisdiction revision.
 select sc.id into v_consent from public.subject_consents sc
 join public.consent_signatures cs on cs.id=sc.signature_id
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where sc.subject_id=p_subject_id and sc.account_id=p_account_id and sc.consent_type='upload_class'
  and sc.scope=array['store'] and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp())
  and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=(r->>'inviterPrincipalId')::uuid
  and cs.subject_binding_revision=(r->>'subjectBindingRevision')::bigint
  and cs.jurisdiction_revision=(r->>'jurisdictionRevision')::bigint
  and cs.purpose='other-adult-upload'
  -- statement-keys:consent.upload-other-adult
  and cs.statement_keys=array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject','no-excluded-relationship','held-until-accepted','no-uploader-access']
  and ca.artifact_key='consent.upload-other-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 for share of sc,cs,ca;
 if v_consent is null then raise exception using errcode='55000',message='upload_consent_required'; end if;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions
  where id=p_session_id and user_id=p_account_id for share;
 return jsonb_build_object('accountRevision',r->'accountRevision','authSessionRevision',r->'authSessionRevision',
  'jurisdictionRevision',r->'jurisdictionRevision','subjectBindingRevision',r->'subjectBindingRevision',
  'accountBindingRevision',r->'invitationRevision','subjectLifecycleRevision',r->'subjectLifecycleRevision',
  'originatingSessionRevision',v_session,'uploadConsentId',v_consent);
end;
$function$;
revoke all on function private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.other_adult_upload_store_authority_v1(uuid,uuid,uuid) to service_role;

-- The transport's one dispatch point, by the immutable kind on the session.
create function private.subject_upload_store_authority_v1(p_kind text,p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
begin
 if p_kind='own-subject' then
  return private.own_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id); end if;
 if p_kind='other-adult-held' then
  return private.other_adult_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id); end if;
 raise exception using errcode='42501',message='not_found';
end;
$function$;
revoke all on function private.subject_upload_store_authority_v1(text,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.subject_upload_store_authority_v1(text,uuid,uuid,uuid) to service_role;

-- 5. Signing the draft artifact ----------------------------------------------
create function private.present_other_adult_upload_artifact_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_nonce_hash text,p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; a public.consent_artifacts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_expires_at is null
  or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 r:=private.other_adult_upload_reservation_v1(p_account_id,p_session_id,p_subject_id);
 select * into a from public.consent_artifacts where artifact_key='consent.upload-other-adult'
  and superseded_at is null and published_at<=clock_timestamp()
  and effective_on<=timezone('UTC',clock_timestamp())::date;
 if a.artifact_key is null
  or a.body_sha256 is distinct from encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex') then
  raise exception using errcode='55000',message='consent_artifact_unavailable'; end if;
 delete from public.account_operation_nonces where account_id=p_account_id
  and operation='other_adult_upload_artifact_sign' and expires_at<=clock_timestamp();
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(p_nonce_hash,p_account_id,p_session_id,'other_adult_upload_artifact_sign',p_expires_at);
 return jsonb_build_object('artifactKey',a.artifact_key,'artifactVersion',a.version,'artifactBodySha256',a.body_sha256);
end;
$function$;
revoke all on function private.present_other_adult_upload_artifact_v1(uuid,uuid,uuid,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.present_other_adult_upload_artifact_v1(uuid,uuid,uuid,text,timestamptz,boolean) to service_role;
create function public.present_other_adult_upload_artifact_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_nonce_hash text,p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.present_other_adult_upload_artifact_v1(p_account_id,p_session_id,p_subject_id,p_nonce_hash,p_expires_at,p_test_jurisdiction); $function$;
revoke all on function public.present_other_adult_upload_artifact_v1(uuid,uuid,uuid,text,timestamptz,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.present_other_adult_upload_artifact_v1(uuid,uuid,uuid,text,timestamptz,boolean) to service_role;

create function private.sign_other_adult_upload_artifact_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_artifact_version integer,p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,
 p_nonce_hash text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; a public.consent_artifacts%rowtype; v_nonce public.account_operation_nonces%rowtype;
 v_signature uuid; v_signed_at timestamptz; v_revision bigint;
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Every statement is its own checkbox; the whole published set, in order, or nothing.
 -- statement-keys:consent.upload-other-adult
 if p_statement_keys is distinct from array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject','no-excluded-relationship','held-until-accepted','no-uploader-access']
  or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext)<16
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 r:=private.other_adult_upload_reservation_v1(p_account_id,p_session_id,p_subject_id);
 select * into a from public.consent_artifacts where artifact_key='consent.upload-other-adult'
  and version=p_artifact_version and superseded_at is null and published_at<=clock_timestamp()
  and effective_on<=timezone('UTC',clock_timestamp())::date for share;
 if a.artifact_key is null or a.body_sha256 is distinct from p_artifact_body_sha256
  or encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex') is distinct from p_artifact_body_sha256 then
  raise exception using errcode='55000',message='consent_artifact_changed'; end if;
 select * into v_nonce from public.account_operation_nonces where nonce_hash=p_nonce_hash for update;
 if v_nonce.nonce_hash is null or v_nonce.account_id is distinct from p_account_id
  or v_nonce.session_id is distinct from p_session_id or v_nonce.operation<>'other_adult_upload_artifact_sign'
  or v_nonce.consumed_at is not null or v_nonce.expires_at<=clock_timestamp() then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.account_operation_nonces set consumed_at=clock_timestamp() where nonce_hash=p_nonce_hash;
 insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
  signer_account_id,target_kind,target_id,purpose,statement_keys,signing_name_encrypted,jurisdiction_code,
  jurisdiction_revision,subject_binding_revision)
 values(a.artifact_key,a.version,a.body_sha256,(r->>'inviterPrincipalId')::uuid,p_account_id,'subject',p_subject_id,
  'other-adult-upload',p_statement_keys,p_signing_name_ciphertext,r->>'jurisdictionCode',
  (r->>'jurisdictionRevision')::bigint,(r->>'subjectBindingRevision')::bigint)
 returning id,signed_at into v_signature,v_signed_at;
 -- A fresh signature supersedes only this uploader's own store grant for this subject.
 update public.subject_consents set revoked_at=v_signed_at,revocation_reason='superseded'
  where subject_id=p_subject_id and account_id=p_account_id and consent_type='upload_class' and revoked_at is null
  returning grant_revision into v_revision;
 insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope,grant_revision)
 values(v_signature,p_subject_id,p_account_id,'upload_class',array['store'],coalesce(v_revision,0)+1);
 perform private.append_legal_audit_event('consent.signed',null,'api.consents','accepted',
  jsonb_build_object('artifact_key',a.artifact_key,'artifact_version',a.version,'upload_class','other_adult'));
 return jsonb_build_object('recordKind','artifact_signature','recordId',v_signature,
  'artifactKey',a.artifact_key,'artifactVersion',a.version,'signedAt',v_signed_at);
end;
$function$;
revoke all on function private.sign_other_adult_upload_artifact_v1(uuid,uuid,uuid,integer,text,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.sign_other_adult_upload_artifact_v1(uuid,uuid,uuid,integer,text,text[],bytea,text,boolean) to service_role;
create function public.sign_other_adult_upload_artifact_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_artifact_version integer,p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,
 p_nonce_hash text,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.sign_other_adult_upload_artifact_v1(p_account_id,p_session_id,p_subject_id,p_artifact_version,p_artifact_body_sha256,p_statement_keys,p_signing_name_ciphertext,p_nonce_hash,p_test_jurisdiction); $function$;
revoke all on function public.sign_other_adult_upload_artifact_v1(uuid,uuid,uuid,integer,text,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.sign_other_adult_upload_artifact_v1(uuid,uuid,uuid,integer,text,text[],bytea,text,boolean) to service_role;

-- 6. Issuance ----------------------------------------------------------------
-- The own issuer's body with the held-upload authority, no second upload
-- once one is held (the unique held index also refuses a second completion),
-- a declared hash, and held bytes counted against the uploader's allowance.
create function private.issue_other_adult_held_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; u public.upload_sessions%rowtype; v_max bigint; v_not_after timestamptz;
 limits private.upload_authorization_config%rowtype; v_reserved numeric;
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_declared_format is null or p_declared_format not in
  ('consumer-array-text-v1','consumer-array-text-v2','consumer-array-text-v3','consumer-array-text-v4','VCF','VCF.GZ','gVCF')
  or p_size_bytes is null or p_size_bytes<=0 or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or p_subject_id is null then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into limits from private.upload_authorization_config where singleton for share;
 if limits.maximum_array_bytes is null or limits.maximum_vcf_bytes is null
  or limits.maximum_account_bytes is null or limits.maximum_active_uploads is null then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 c:=private.other_adult_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 if exists(select 1 from public.upload_sessions where subject_id=p_subject_id
   and upload_authority_kind='other-adult-held' and status='held') then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 v_max:=case when p_declared_format like 'consumer-array-text-v%' then limits.maximum_array_bytes
  when p_declared_format='gVCF' then coalesce(limits.maximum_gvcf_bytes,limits.maximum_vcf_bytes) else limits.maximum_vcf_bytes end;
 if p_size_bytes>v_max then raise exception using errcode='22023',message='file_too_large'; end if;
 select coalesce(sum(size_bytes),0) into v_reserved from public.genome_files where user_id=p_account_id;
 v_reserved:=v_reserved+(select coalesce(sum(expected_size),0) from public.upload_sessions
  where account_id=p_account_id and (status='held'
   or (status in ('issued','uploaded','validating') and expires_at>clock_timestamp())));
 if v_reserved+p_size_bytes>limits.maximum_account_bytes then
  raise exception using errcode='22023',message='file_too_large'; end if;
 if (select count(*) from public.upload_sessions where account_id=p_account_id
  and status in ('issued','uploaded','validating') and expires_at>clock_timestamp())>=limits.maximum_active_uploads then
  raise exception using errcode='55000',message='upload_unavailable'; end if;
 select not_after into v_not_after from auth.sessions where id=p_session_id and user_id=p_account_id;
 insert into public.upload_sessions(account_id,auth_session_id,subject_id,staging_object_name,expected_size,
  expected_sha256,content_type,upload_revision,status,expires_at,storage_bucket,token_jti,declared_format,
  account_revision,account_auth_session_revision,originating_session_revision,jurisdiction_revision,
  subject_binding_revision,account_binding_revision,subject_lifecycle_revision,upload_consent_id,maximum_decoded_bytes,
  upload_authority_kind)
 values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256,
  'application/octet-stream',1,'issued',least(clock_timestamp()+interval '30 minutes',v_not_after),
  'genomes',gen_random_uuid(),p_declared_format,(c->>'accountRevision')::bigint,
  (c->>'authSessionRevision')::bigint,(c->>'originatingSessionRevision')::bigint,
  (c->>'jurisdictionRevision')::bigint,(c->>'subjectBindingRevision')::bigint,
  (c->>'accountBindingRevision')::bigint,(c->>'subjectLifecycleRevision')::bigint,(c->>'uploadConsentId')::uuid,v_max,
  'other-adult-held')
 returning * into u;
 return jsonb_build_object('accountId',u.account_id,'sessionId',u.auth_session_id,
  'accountAuthSessionRevision',u.account_auth_session_revision,'uploadId',u.id,'jti',u.token_jti,
  'stagingKey',u.staging_object_name,'expiresAt',u.expires_at,'maximumBytes',u.expected_size);
end;
$function$;
revoke all on function private.issue_other_adult_held_upload_v1(uuid,uuid,uuid,text,bigint,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.issue_other_adult_held_upload_v1(uuid,uuid,uuid,text,bigint,text,boolean) to service_role;
create function public.issue_other_adult_held_upload_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_declared_format text,p_size_bytes bigint,p_sha256 text,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.issue_other_adult_held_upload_v1(p_account_id,p_session_id,p_subject_id,p_declared_format,p_size_bytes,p_sha256,p_test_jurisdiction); $function$;
revoke all on function public.issue_other_adult_held_upload_v1(uuid,uuid,uuid,text,bigint,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.issue_other_adult_held_upload_v1(uuid,uuid,uuid,text,bigint,text,boolean) to service_role;

-- 7. The transport: current bodies, one authority call each dispatched ------

create or replace function private.authorize_storage_upload_insert()
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare claims jsonb:=auth.jwt(); live jsonb; u public.upload_sessions%rowtype; c jsonb;
begin
 if claims->>'role' is distinct from 'inherit_upload_only'
  or claims->>'aud' is distinct from 'inherit-storage-upload'
  or coalesce(claims->>'jti','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(claims->>'upload_session_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(claims->>'staging_key','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or jsonb_typeof(claims->'iat') is distinct from 'number'
  or coalesce(claims->>'iat','')!~'^[0-9]+$'
  or jsonb_typeof(claims->'nbf') is distinct from 'number'
  or claims->'nbf' is distinct from claims->'iat'
  or (claims->>'iat')::numeric>extract(epoch from clock_timestamp())
  or (claims->>'exp')::numeric-(claims->>'iat')::numeric>1800
  or claims ? 'refresh_token' then return false; end if;
 live:=private.assert_live_authenticated_session();
 if live->>'authorized' is distinct from 'true' then return false; end if;
 select * into u from public.upload_sessions where id=(claims->>'upload_session_id')::uuid for share;
 if u.id is null or u.token_jti is distinct from (claims->>'jti')::uuid
  or u.account_id is distinct from (claims->>'sub')::uuid or u.auth_session_id is distinct from (claims->>'session_id')::uuid
  or u.token_jti=u.auth_session_id or u.storage_bucket<>'genomes' or u.status<>'issued' or u.consumed_at is not null
  or u.staging_object_name is distinct from claims->>'staging_key' or u.expires_at<=clock_timestamp()
  or claims->'maximum_bytes' is distinct from to_jsonb(u.expected_size)
  or (claims->>'exp')::numeric>extract(epoch from u.expires_at)
  or u.account_auth_session_revision is distinct from (live->>'account_auth_session_revision')::bigint
  or u.originating_session_revision is distinct from (live->>'session_revision')::bigint then return false; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,u.account_id,u.auth_session_id,u.subject_id);
 return c=jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
  'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
  'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
  'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id);
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or numeric_value_out_of_range then
 return false;
end;
$function$;
revoke all on function private.authorize_storage_upload_insert() from public,anon,authenticated;
grant execute on function private.authorize_storage_upload_insert() to inherit_upload_only,service_role;

create or replace function private.guard_storage_upload_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype;
 c jsonb; caller_role text:=auth.jwt()->>'role';
begin
 if tg_op='UPDATE' then
  perform 1 from public.upload_sessions where token_jti is not null
   and storage_bucket=old.bucket_id and staging_object_name=old.name;
  if found then raise exception using errcode='42501',message='upload_unavailable'; end if;
 end if;
 select * into u from public.upload_sessions where token_jti is not null
  and storage_bucket=new.bucket_id and staging_object_name=new.name;
 if u.id is null then return new; end if;
 if tg_op<>'INSERT' or coalesce(caller_role,'') not in ('inherit_upload_only','service_role') then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 if caller_role='inherit_upload_only' and not private.authorize_storage_upload_insert() then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 if caller_role='inherit_upload_only' and not (new.metadata ? 'size') then
  -- The AFTER trigger consumes this caller-role INSERT after its RLS check.
  return new;
 end if;
 -- Acquire account/session/subject/consent locks before the upload-row lock,
 -- consistent with issuance and the caller-role permission predicate.
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,u.account_id,u.auth_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(locked_u) is distinct from to_jsonb(u)
  or u.status<>'issued' or u.consumed_at is not null or u.expires_at<=clock_timestamp()
  or jsonb_typeof(new.metadata->'size') is distinct from 'number'
  or (new.metadata->>'size')::numeric is distinct from u.expected_size::numeric
  or (caller_role='service_role' and new.owner_id is distinct from u.account_id::text)
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,
   'authSessionRevision',u.account_auth_session_revision,'jurisdictionRevision',u.jurisdiction_revision,
   'subjectBindingRevision',u.subject_binding_revision,'accountBindingRevision',u.account_binding_revision,
   'subjectLifecycleRevision',u.subject_lifecycle_revision,'originatingSessionRevision',u.originating_session_revision,
   'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 if caller_role='service_role' then
  update public.upload_sessions set status='uploaded' where id=u.id;
 end if;
 return new;
exception when insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation or numeric_value_out_of_range then
 raise exception using errcode='42501',message='upload_unavailable';
end;
$function$;
revoke all on function private.guard_storage_upload_write() from public,anon,authenticated,inherit_upload_only;
grant execute on function private.guard_storage_upload_write() to service_role;

create or replace function private.own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid,p_start boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 -- V2 owns an independent attempt lease even before the first checkpoint.
 -- Legacy callers cannot enter it; every existing read/write/complete RPC
 -- still passes here, so rotating the claim fences all previous holders.
 if exists(select 1 from private.own_upload_finalization_attempts where upload_id=u.id) then
  if p_start and u.status<>'promoted' then
   raise exception using errcode='55000',message='upload_unavailable';
  elsif not p_start and not exists(select 1 from private.own_upload_finalization_attempts a
   where a.upload_id=u.id and a.claim=p_claim and a.lease_expires_at>clock_timestamp()) then
   raise exception using errcode='42501',message='not_found';
  end if;
 end if;
 if p_start then
  if u.status='promoted' and u.finalized_file_id is not null then
   return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
  -- 20260928150000: a held upload is finished; it waits for its subject.
  if u.status='held' then return jsonb_build_object('status','held','uploadId',u.id); end if;
  if u.status='validating' then
   -- Resume this session's own finalization, or refuse. The lapsed lease is
   -- the only evidence that the previous holder is gone; a live one means it
   -- is still working and a second request must not join it.
   if not exists(select 1 from private.own_upload_finalization_checkpoints k
    where k.upload_id=u.id and k.finalization_claim=u.finalization_claim
     and k.lease_expires_at<=clock_timestamp()) then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  elsif u.status<>'uploaded' then
   raise exception using errcode='55000',message='upload_unavailable';
  else
   update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
    final_object_name=gen_random_uuid(),finalization_started_at=clock_timestamp()
    where id=u.id returning * into u;
  end if;
 elsif u.status<>'validating' or p_claim is null or u.finalization_claim is distinct from p_claim then
  raise exception using errcode='42501',message='not_found';
 end if;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;

create or replace function private.begin_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb; a private.own_upload_finalization_attempts%rowtype;
 k private.own_upload_finalization_checkpoints%rowtype; previous_claim uuid; stamp timestamptz;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- 20260928150000: dispatched by the session's immutable authority kind.
 c:=private.subject_upload_store_authority_v1(u.upload_authority_kind,p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 if u.status='promoted' and u.finalized_file_id is not null then
  return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
 -- 20260928150000: a held upload is finished; it waits for its subject.
 if u.status='held' then return jsonb_build_object('status','held','uploadId',u.id); end if;
 select * into a from private.own_upload_finalization_attempts where upload_id=u.id for update;
 select * into k from private.own_upload_finalization_checkpoints where upload_id=u.id for update;
 stamp:=clock_timestamp();
 if u.status='validating' then
  if a.upload_id is not null then
   if a.claim is distinct from u.finalization_claim or a.lease_expires_at>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  else
   -- A request started by the old deployment has no attempt lease. Drain its
   -- existing 300-second invocation window after its latest known activity.
   -- Missing validation progress may restart only once that window has passed.
   if u.finalization_started_at is null or
    greatest(u.finalization_started_at,coalesce(k.updated_at,u.finalization_started_at))+interval '300 seconds'>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  end if;
  if k.upload_id is not null and k.finalization_claim is distinct from u.finalization_claim then
   raise exception using errcode='42501',message='not_found'; end if;
 elsif u.status<>'uploaded' or a.upload_id is not null or k.upload_id is not null then
  raise exception using errcode='55000',message='upload_unavailable';
 end if;
 previous_claim:=u.finalization_claim;
 update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
  final_object_name=coalesce(final_object_name,gen_random_uuid()),finalization_started_at=stamp
  where id=u.id returning * into u;
 insert into private.own_upload_finalization_attempts(upload_id,claim,lease_expires_at)
  values(u.id,u.finalization_claim,least(stamp+interval '60 seconds',u.expires_at))
  on conflict(upload_id) do update set claim=excluded.claim,lease_expires_at=excluded.lease_expires_at;
 -- Transfer only the exact prior claim's immutable evidence. Revision and byte
 -- offset do not reset, so any stale writer fails both ownership and CAS.
 update private.own_upload_finalization_checkpoints set finalization_claim=u.finalization_claim,
  lease_expires_at=least(stamp+interval '60 seconds',u.expires_at)
  where upload_id=u.id and finalization_claim=previous_claim;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;
revoke all on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean),
 private.begin_own_upload_finalization_v2(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean),
 private.begin_own_upload_finalization_v2(uuid,uuid,uuid) to service_role;

create or replace function private.complete_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,
 p_claim uuid,p_storage_object_id uuid,p_raw_sha256 text,p_decoded_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare m jsonb; u public.upload_sessions%rowtype; f uuid; kind public.genome_file_type;
 v_kind text; v_invitation uuid; v_deadline timestamptz; r uuid;
begin
 -- 20260928150000: a held upload serializes with the invitation's
 -- transitions (activation, acceptance, refusal) before its authority is read.
 select upload_authority_kind into v_kind from public.upload_sessions where id=p_upload_id;
 if v_kind='other-adult-held' then perform private.lock_invitation_transitions_v1(); end if;
 m:=private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
 select * into u from public.upload_sessions where id=p_upload_id;
 if p_raw_sha256 is null or p_raw_sha256!~'^[0-9a-f]{64}$'
  or p_decoded_sha256 is null or p_decoded_sha256!~'^[0-9a-f]{64}$'
  or (u.expected_sha256 is not null and p_raw_sha256<>u.expected_sha256)
  or exists(select 1 from storage.objects where bucket_id='genomes' and name=u.staging_object_name)
  or not exists(select 1 from storage.objects where id=p_storage_object_id and bucket_id='genomes'
   and name=u.final_object_name::text and (metadata->>'size')::numeric=u.expected_size) then
  raise exception using errcode='42501',message='upload_unavailable'; end if;
 kind:=(case u.declared_format when 'consumer-array-text-v1' then 'array_23andme'
  when 'consumer-array-text-v2' then 'array_ancestry' when 'consumer-array-text-v3' then 'array_myheritage'
  when 'consumer-array-text-v4' then 'array_ftdna' when 'gVCF' then 'gvcf' else 'vcf' end)::public.genome_file_type;
 -- 20260928150000: another adult's file stops here. No genome_files row,
 -- no genome_storage_objects row and no job exist until its subject accepts;
 -- the validated object is recorded only in the held row, which no reader reads.
 if u.upload_authority_kind='other-adult-held' then
  select si.id,si.expires_at into v_invitation,v_deadline from public.subject_invitations si
   where si.target_kind='subject' and si.target_id=u.subject_id and si.invitation_kind='adult_subject'
    and si.status='pending' and si.expires_at>clock_timestamp()
   order by si.created_at desc limit 1;
  if v_invitation is null then raise exception using errcode='42501',message='upload_unavailable'; end if;
  v_deadline:=least(clock_timestamp()+interval '30 days',v_deadline);
  insert into public.other_adult_held_uploads(upload_session_id,subject_id,invitation_id,uploader_account_id,
   uploader_consent_id,storage_object_id,object_name,file_type,size_bytes,raw_sha256,decoded_sha256,upload_revision,
   fixed_deadline)
  values(u.id,u.subject_id,v_invitation,p_account_id,u.upload_consent_id,p_storage_object_id,u.final_object_name::text,
   kind,u.expected_size,p_raw_sha256,p_decoded_sha256,u.upload_revision,v_deadline);
  update public.upload_sessions set status='held' where id=u.id;
  delete from private.own_upload_finalization_attempts where upload_id=u.id;
  -- adult.unconfirmed-30d: the registered clock for another adult's unconfirmed file.
  insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline)
  values('adult.unconfirmed-30d','upload_session',u.id,u.upload_revision,u.upload_revision,1,v_deadline)
  returning id into r;
  insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,
   immutable_envelope)
  values(r,'adult.unconfirmed-30d','adult-unconfirmed-source-expiry','compound-atomic',1,v_deadline,'upload_session',u.id,
   u.upload_revision,1,'service-retention',1,jsonb_build_object('uploadId',u.id,'uploadRevision',u.upload_revision));
  perform private.append_legal_audit_event('upload.held',null,'api.file-finalize','accepted',
   jsonb_build_object('upload_class','other_adult','revision',u.upload_revision));
  return jsonb_build_object('uploadId',u.id,'status','stored_quarantined','analysisState','quarantined');
 end if;
 insert into public.genome_files(user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
  upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values(p_account_id,u.subject_id,u.final_object_name::text,'Genome file',kind,1,u.expected_size,p_raw_sha256,'uploaded',
  u.upload_revision,'single-logical-sample-v1',clock_timestamp(),p_decoded_sha256,p_storage_object_id) returning id into f;
 insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values(p_storage_object_id,u.final_object_name::text,'genomes',f,p_raw_sha256,u.expected_size,u.upload_revision,'current');
 update public.upload_sessions set status='promoted',consumed_at=clock_timestamp(),finalized_file_id=f where id=u.id;
 return jsonb_build_object('fileId',f,'status','finalized_ready_for_processing','analysisState','ready_for_processing',
  'next',jsonb_build_object('routeId','api.file-process','operation','process'));
end;
$function$;
revoke all on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- 8. Release and end ---------------------------------------------------------
-- Release runs inside the acceptance transaction. The file becomes an
-- ordinary unprepared own file of the accepting account's self subject, with
-- the structural evidence finalization already proved. No job is enqueued and
-- no purpose is granted: the subject's own consents govern everything after.
create function private.release_other_adult_held_uploads_v1(p_subject_id uuid,p_account_id uuid,p_self_subject_id uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h public.other_adult_held_uploads%rowtype; u public.upload_sessions%rowtype; f uuid; n integer:=0;
begin
 if not exists(select 1 from public.subjects where id=p_self_subject_id and subject_account_id=p_account_id
  and subject_class='self' and lifecycle='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 for h in select * from public.other_adult_held_uploads where subject_id=p_subject_id and state='held'
  order by held_at,upload_session_id for update loop
  select * into u from public.upload_sessions where id=h.upload_session_id for update;
  if u.id is null or u.status<>'held' or u.upload_authority_kind<>'other-adult-held' or u.finalized_file_id is not null
   or u.subject_id is distinct from p_subject_id or u.final_object_name::text is distinct from h.object_name
   or h.fixed_deadline<=clock_timestamp()
   or not exists(select 1 from storage.objects o where o.id=h.storage_object_id and o.bucket_id='genomes'
    and o.name=h.object_name and (o.metadata->>'size')::numeric=h.size_bytes) then
   raise exception using errcode='55000',message='held_upload_unavailable'; end if;
  insert into public.genome_files(user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
   upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
  values(p_account_id,p_self_subject_id,h.object_name,'Genome file',h.file_type,1,h.size_bytes,h.raw_sha256,'uploaded',
   h.upload_revision,'single-logical-sample-v1',h.held_at,h.decoded_sha256,h.storage_object_id) returning id into f;
  insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
  values(h.storage_object_id,h.object_name,'genomes',f,h.raw_sha256,h.size_bytes,h.upload_revision,'current');
  update public.upload_sessions set status='promoted',consumed_at=clock_timestamp(),finalized_file_id=f where id=u.id;
  update public.other_adult_held_uploads set state='released',terminal_at=clock_timestamp(),
   released_file_id=f,released_account_id=p_account_id where upload_session_id=h.upload_session_id;
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
   completed_at=clock_timestamp(),terminal_outcome_code='subject_confirmed'
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=u.id
   and status in ('pending','retry');
  update public.retention_rows set state='cancelled',ended_at=clock_timestamp()
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=u.id
   and state in ('scheduled','active');
  perform private.append_legal_audit_event('upload.held-released',null,'api.withdraw','accepted',
   jsonb_build_object('upload_class','other_adult','revision',u.upload_revision));
  n:=n+1;
 end loop;
 return n;
end;
$function$;
revoke all on function private.release_other_adult_held_uploads_v1(uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Every other end: the session is rejected and made due at once, so the
-- existing upload-working executor deletes its staging and final objects,
-- then the session and this row. Nothing here reads the source.
create function private.end_other_adult_held_uploads_v1(p_subject_id uuid,p_state text)
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h public.other_adult_held_uploads%rowtype; n integer:=0; v_now timestamptz:=clock_timestamp();
begin
 if p_state not in ('refused','deleted','expired','withdrawn') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 for h in select * from public.other_adult_held_uploads where subject_id=p_subject_id and state='held'
  order by held_at,upload_session_id for update loop
  update public.upload_sessions set status='rejected',consumed_at=coalesce(consumed_at,v_now),
   finalization_cleanup_pending=true,expires_at=least(expires_at,v_now)
  where id=h.upload_session_id and status='held';
  if not found then raise exception using errcode='55000',message='held_upload_unavailable'; end if;
  update public.other_adult_held_uploads set state=p_state,terminal_at=v_now
  where upload_session_id=h.upload_session_id;
  update public.retention_due_phases set status=case when p_state='expired' then 'succeeded' else 'cancelled' end,
   claim_token_hash=null,claim_expires_at=null,completed_at=v_now,
   terminal_outcome_code=case p_state when 'expired' then 'adult_unconfirmed_source_expired'
    when 'refused' then 'subject_refused' when 'deleted' then 'subject_deleted' else 'uploader_withdrawn' end
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and status in ('pending','retry');
  update public.retention_rows set state=case when p_state='expired' then 'complete' else 'cancelled' end,ended_at=v_now
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and state in ('scheduled','active');
  perform private.append_legal_audit_event('upload.held-ended',null,null,p_state,
   jsonb_build_object('upload_class','other_adult','revision',h.upload_revision));
  n:=n+1;
 end loop;
 return n;
end;
$function$;
revoke all on function private.end_other_adult_held_uploads_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The retention job's sweep, before the upload-working executor runs. It ends
-- a held file whose fixed deadline passed, whose invitation or reservation is
-- no longer pending, or whose uploader asked to delete their account.
create function public.expire_due_other_adult_held_uploads_v1()
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v record; n integer:=0; v_now timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 for v in select h.subject_id,
   case when p.deletion_requested_at is not null then 'withdrawn'
    when si.status='refused' then 'refused' when si.status='revoked' then 'deleted' else 'expired' end as reason
  from public.other_adult_held_uploads h
  join public.subjects s on s.id=h.subject_id
  left join public.subject_invitations si on si.id=h.invitation_id
  left join public.profiles p on p.id=h.uploader_account_id
  where h.state='held' and (h.fixed_deadline<=v_now or si.id is null or si.status<>'pending'
   or si.expires_at<=v_now or s.lifecycle<>'draft' or p.id is null or p.deletion_requested_at is not null)
  order by h.fixed_deadline,h.subject_id
 loop
  n:=n+private.end_other_adult_held_uploads_v1(v.subject_id,v.reason);
 end loop;
 return n;
end;
$function$;
revoke all on function public.expire_due_other_adult_held_uploads_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_due_other_adult_held_uploads_v1() to service_role;

-- 9. What the uploader can see: their pending reservations and one state
-- line each. No address, file name, genotype or object identity.
create function private.other_adult_upload_targets_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v_result jsonb;
begin
 if p_test_jurisdiction is distinct from true then return '[]'::jsonb; end if;
 perform 1 from auth.sessions a where a.id=p_session_id and a.user_id=p_account_id
  and (a.not_after is null or a.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select coalesce(jsonb_agg(t.item order by t.invited_at,t.subject_id),'[]'::jsonb) into v_result from (
  select s.id as subject_id,si.created_at as invited_at,jsonb_build_object(
   'subjectId',s.id,'label',s.display_label,'invitedAt',si.created_at,'answerBy',si.expires_at,
   'state',case
    when h.upload_session_id is not null then 'held'
    when exists(select 1 from public.rights_sessions rs where rs.purpose='adult-subject-invitation'
     and rs.target_kind='subject' and rs.target_id=s.id) then 'reviewing'
    when exists(select 1 from public.subject_consents sc join public.consent_signatures cs on cs.id=sc.signature_id
     where sc.subject_id=s.id and sc.account_id=p_account_id and sc.consent_type='upload_class'
      and sc.revoked_at is null and cs.artifact_key='consent.upload-other-adult') then 'signed'
    else 'unsigned' end,
   'heldAt',h.held_at,'deleteBy',h.fixed_deadline) as item
  from public.subjects s
  join public.subject_invitations si on si.target_kind='subject' and si.target_id=s.id
   and si.invitation_kind='adult_subject' and si.status='pending' and si.expires_at>clock_timestamp()
  join public.subject_principals ip on ip.id=si.inviter_principal_id and ip.account_id=p_account_id
  left join public.other_adult_held_uploads h on h.subject_id=s.id and h.state='held'
  where s.owner_account_id=p_account_id and s.subject_class='other_adult' and s.lifecycle='draft'
 ) t;
 return v_result;
end;
$function$;
revoke all on function private.other_adult_upload_targets_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.other_adult_upload_targets_v1(uuid,uuid,boolean) to service_role;
create function public.other_adult_upload_targets_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language sql security invoker set search_path=pg_catalog
as $function$ select private.other_adult_upload_targets_v1(p_account_id,p_session_id,p_test_jurisdiction); $function$;
revoke all on function public.other_adult_upload_targets_v1(uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.other_adult_upload_targets_v1(uuid,uuid,boolean) to service_role;

-- 10. Acceptance, refusal and deletion: the current shared response body,
-- with the held file released on acceptance and ended otherwise.

create or replace function private.adult_subject_invitation_response_v1(
  p_token_hash_id uuid,
  p_session_id uuid,
  p_action text,
  p_account_id uuid,
  p_account_email_hmac text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.adult_subject_drafts%rowtype;
  v_principal public.subject_principals%rowtype;
  v_account_principal public.subject_principals%rowtype;
  v_profile public.profiles%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_signature_id uuid;
  v_contact_id uuid;
  v_terminal_status text;
begin
  if p_action not in ('confirm', 'refuse', 'delete') then return 'unavailable'; end if;

  select th.* into v_token
  from public.token_hashes th
  where th.id = p_token_hash_id
  for update;
  if v_token.id is null then return 'unavailable'; end if;

  v_invitation := private.current_adult_subject_invitation_v1(
    p_token_hash_id, p_session_id
  );
  if v_invitation.id is null
    or private.invitation_contact_barred_v1(v_invitation.email_hmac) then
    return 'unavailable';
  end if;

  select tc.* into v_candidate
  from public.token_candidates tc
  where tc.id = v_token.candidate_id
  for update;
  if v_candidate.id is null then return 'unavailable'; end if;

  select d.* into v_draft
  from public.adult_subject_drafts d
  where d.subject_id = v_invitation.target_id
    and d.state = 'invited'
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return 'unavailable'; end if;

  select ic.contact_reference_id into v_contact_id
  from public.invitation_candidates ic
  where ic.invitation_id = v_invitation.id
  for update;

  select sp.* into strict v_principal
  from public.subject_principals sp
  where sp.id = v_invitation.invitee_principal_id
    and sp.subject_id = v_invitation.target_id
    and sp.status = 'pending'
  for update;

  if p_action = 'confirm' then
    if p_account_id is null
      or p_account_email_hmac is null
      or p_account_email_hmac <> v_invitation.email_hmac
      or p_account_id = v_draft.owner_account_id
    then
      return 'unavailable';
    end if;

    -- 20260928150000: a held file is released only through the rights
    -- session whose review showed it, never through the older token path.
    if p_session_id is null and exists (
      select 1 from public.other_adult_held_uploads h
      where h.subject_id = v_invitation.target_id and h.state = 'held'
    ) then
      return 'unavailable';
    end if;

    select sp.* into strict v_account_principal
    from public.subject_principals sp
    join public.subjects s on s.id = sp.subject_id
    where sp.account_id = p_account_id
      and sp.principal_kind = 'account_subject'
      and sp.status = 'active'
      and s.subject_class = 'self'
      and s.subject_account_id = p_account_id
      and s.lifecycle = 'active'
    order by sp.created_at
    limit 1
    for update of sp, s;

    select * into strict v_profile
    from public.profiles where id = p_account_id for update;
    select * into strict v_artifact
    from public.consent_artifacts
    where artifact_key = 'consent.subject-adult'
      and version = 1;

    update public.subjects
    set owner_account_id = null,
        subject_account_id = p_account_id,
        lifecycle = 'active',
        subject_binding_revision = subject_binding_revision + 1,
        lifecycle_revision = lifecycle_revision + 1,
        updated_at = v_now
    where id = v_invitation.target_id;

    update public.subject_principals
    set account_id = p_account_id,
        principal_kind = 'account_subject',
        principal_revision = principal_revision + 1,
        status = 'active'
    where id = v_principal.id
    returning * into v_principal;

    insert into public.subject_account_bindings (
      subject_id, subject_principal_id, account_id, account_principal_id,
      binding_kind, binding_revision, status
    ) values (
      v_invitation.target_id, v_principal.id, p_account_id,
      v_account_principal.id, 'adult_claim', 1, 'current'
    );

    insert into public.subject_relationships (
      subject_id, data_subject_principal_id, recipient_principal_id,
      recipient_account_id, relationship_kind, relationship_revision, status
    ) values (
      v_invitation.target_id, v_principal.id, v_principal.id,
      p_account_id, 'self', 1, 'current'
    );

    insert into public.consent_signatures (
      artifact_key, artifact_version, artifact_body_sha256,
      signer_principal_id, signer_account_id, target_kind, target_id,
      purpose, statement_keys, jurisdiction_code, jurisdiction_revision,
      subject_binding_revision
    ) values (
      v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
      v_principal.id, p_account_id, 'subject', v_invitation.target_id,
      'adult-subject-account-acceptance',
      array['age-18-plus', 'mailbox-control', 'no-inviter-access',
        'identity-not-verified', 'revocable'],
      coalesce(v_profile.jurisdiction_code, 'ZZ'),
      v_profile.jurisdiction_revision, 2
    ) returning id into v_signature_id;

    insert into public.subject_consents (
      signature_id, subject_id, account_id, consent_type, scope,
      grant_revision
    ) values (
      v_signature_id, v_invitation.target_id, p_account_id, 'adult_source',
      array['variants', 'reports.monogenic', 'reports.polygenic', 'ancestry',
        'copilot.local', 'family.portrait', 'raw.export', 'raw.browse'], 1
    );

    update public.subject_invitations
    set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
        contact_purge_due_at = v_now + interval '30 days'
    where id = v_invitation.id;

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id and status = 'current';
    update public.token_candidates
    set state = 'invalidated' where id = v_candidate.id;
    if p_session_id is not null then
      update public.rights_sessions
      set status = 'consumed', ended_at = v_now
      where id = p_session_id;
    end if;
    delete from public.adult_subject_drafts where id = v_draft.id;
    -- 20260928150000: the held file moves to the accepting account.
    perform private.release_other_adult_held_uploads_v1(
      v_invitation.target_id, p_account_id, v_account_principal.subject_id
    );

    perform private.append_legal_audit_event(
      'invitation.accepted', null, 'api.withdraw', 'accepted',
      jsonb_build_object('invitation_kind', 'adult_subject', 'revision', 1)
    );
    return 'accepted';
  end if;

  v_terminal_status := case when p_action = 'refuse' then 'refused' else 'revoked' end;
  update public.subject_invitations
  set status = v_terminal_status, terminal_at = v_now,
      contact_purge_due_at = v_now + interval '30 days',
      email_encrypted = null
  where id = v_invitation.id;

  if p_action = 'refuse' then
  insert into public.invitation_refusal_hmacs (
    email_hmac, refusal_revision, created_at, expires_at
  ) values (
    v_invitation.email_hmac, 1, v_now, v_now + interval '365 days'
  ) on conflict (email_hmac) do update
    set refusal_revision = public.invitation_refusal_hmacs.refusal_revision + 1,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;

  insert into public.contact_refusal_bars (
    contact_hmac, target_kind, target_id, refusal_revision, expires_at
  ) values (
    v_invitation.email_hmac, 'subject', v_invitation.target_id, 1,
    v_now + interval '365 days'
  ) on conflict (contact_hmac, target_kind, target_id, refusal_revision)
    do nothing;
  end if;

  update public.encrypted_contact_references
  set contact_ciphertext = null, status = 'shredded', ended_at = v_now
  where id = v_contact_id;
  update public.contact_hmac_indexes
  set status = 'revoked', expires_at = least(expires_at, v_now)
  where contact_reference_id = v_contact_id and status = 'current';
  update public.subject_principals
  set status = 'deleted', principal_revision = principal_revision + 1
  where id = v_principal.id;
  update public.subjects
  set lifecycle = 'purged', lifecycle_revision = lifecycle_revision + 1,
      updated_at = v_now
  where id = v_invitation.target_id;
  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id and status = 'current';
  update public.token_candidates
  set state = 'invalidated' where id = v_candidate.id;
  if p_session_id is not null then
    update public.rights_sessions
    set status = 'consumed', ended_at = v_now
    where id = p_session_id;
  end if;
  update public.mail_outbox
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_terminal'
  where id = v_candidate.outbox_id and state in ('queued', 'claimed');
  delete from public.adult_subject_drafts where id = v_draft.id;
  -- 20260928150000: a held file is rejected and made due for deletion.
  perform private.end_other_adult_held_uploads_v1(
    v_invitation.target_id,
    case when p_action = 'refuse' then 'refused' else 'deleted' end
  );

  perform private.append_legal_audit_event(
    case when p_action = 'refuse' then 'invitation.refused'
      else 'invitation.deleted' end,
    null, 'api.withdraw', v_terminal_status,
    jsonb_build_object('invitation_kind', 'adult_subject', 'revision', 1)
  );
  return case when p_action = 'refuse' then 'refused' else 'deleted' end;
end;
$$;

revoke all on function private.adult_subject_invitation_response_v1(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
