-- Another adult's genome, uploaded by someone who already holds it, under the
-- register's Path B (brief §5.2 Path B; G2.6 adult half; G5.3). The owner
-- chose the register's two paths (docs/protocol/decisions.md, 2026-09-28):
--   * Path A, inviting someone to upload their own file, is untouched. Its
--     inviter never uploads (upload-class-v1 path-a-own-account; the
--     pre-consent-quarantine-v1 Path A rule; the /family/invite copy).
--   * Path B, "I have their file", is its own flow (path-b-subject-esignature):
--       1. the uploader reserves a Path B draft with the person's name, date
--          of birth (18 or older, checked here) and email;
--       2. the uploader signs consent.upload-other-adult (Tier 2) for it;
--       3. the uploader sends the e-signature request, an adult_subject
--          invitation that only this flow can create for a Path B draft;
--       4. the person signs their own artifact through the mailed rights
--          session, with no account. That consumes the draft into an
--          uploader-owned other_adult subject with one confirmation principal;
--       5. only then may the uploader upload. Every file revision is held,
--          quarantined, with no genome_files row, and the same commit queues
--          the upload-time notice and its confirmation credential;
--       6. the person confirms or refuses that exact revision through the
--          notice's rights session, or deletes everything. Refusal, deletion,
--          the fixed adult.unconfirmed-30d deadline and the uploader's account
--          deletion reject the held session, and the existing upload-working
--          executor deletes the source.
--
-- Confirmation lifts the quarantine and commits the register's
-- confirmed_blocked_current_gate outcome with zero job: the other_adult common
-- gates of analysis-eligibility-v1 (other-adult-mitigation-state-v1 and a
-- subject-bound source a reader can use) do not exist yet, so nothing reads
-- the source after confirmation either. No genome_files row can ever be made
-- from a held-kind session.
--
-- TEST-LOCAL only. consent.upload-other-adult v1 is approved and seeded here;
-- the person's own artifact, consent.subject-adult-esignature, is a draft the
-- owner has not approved, installable only by the TEST-LOCAL installer below.
-- Every entry point requires the test-jurisdiction flag the server passes only
-- under INHERIT_TEST_JURISDICTION=1.
--
-- Redefined functions keep their current bodies; each change is marked
-- "20260928150000" in a comment beside it.

-- 1. Schema -----------------------------------------------------------------

-- The flow is stored once on the draft, with its mode and evidence kind, and
-- never changes. A Path B draft is kept, confirmed, as the subject's record of
-- how it was confirmed; a Path A draft is consumed by acceptance as before.
alter table public.adult_subject_drafts
 add column adult_flow text not null default 'path-a-own-account'
  check (adult_flow in ('path-a-own-account','path-b-subject-esignature')),
 add column confirmation_mode text not null default 'path-a-account-required'
  check (confirmation_mode in ('path-a-account-required','path-b-token-or-account')),
 add column evidence_kind text not null default 'none' check (evidence_kind in ('none','esignature')),
 add column request_key text check (request_key ~ '^[0-9a-f]{64}$'),
 add constraint adult_subject_drafts_flow_check check (
  (adult_flow='path-a-own-account' and confirmation_mode='path-a-account-required' and evidence_kind='none'
   and request_key is null)
  or (adult_flow='path-b-subject-esignature' and confirmation_mode='path-b-token-or-account'
   and evidence_kind='esignature' and request_key is not null));
create unique index adult_subject_drafts_request_key_idx
 on public.adult_subject_drafts(owner_account_id,request_key) where request_key is not null;

create function private.freeze_adult_subject_flow_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $function$
begin
 if (new.adult_flow,new.confirmation_mode,new.evidence_kind,new.request_key,new.owner_account_id,new.subject_id)
  is distinct from (old.adult_flow,old.confirmation_mode,old.evidence_kind,old.request_key,old.owner_account_id,old.subject_id) then
  raise exception using errcode='55000',message='immutable_adult_flow'; end if;
 return new;
end;
$function$;
revoke all on function private.freeze_adult_subject_flow_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger freeze_adult_subject_flow before update on public.adult_subject_drafts
 for each row execute function private.freeze_adult_subject_flow_v1();

alter table public.upload_sessions
 add column upload_authority_kind text not null default 'own-subject'
  check (upload_authority_kind in ('own-subject','other-adult-held'));
alter table public.upload_sessions drop constraint upload_sessions_status_check;
alter table public.upload_sessions add constraint upload_sessions_status_check check (status in (
 'issued','uploaded','validating','held','promoted','rejected','expired','cancelled'));
-- Only a held-kind session can be held, and a held-kind session never gets a
-- genome_files row: nothing a reader reads can be made from it.
alter table public.upload_sessions add constraint upload_sessions_held_kind_check check (
 (status<>'held' or (upload_authority_kind='other-adult-held' and consumed_at is null))
 and (upload_authority_kind<>'other-adult-held' or (finalized_file_id is null and status<>'promoted')));

-- One row per held file revision (adult-upload-revision-confirmation-v1). Its
-- random id is the opaque fileId of the finalize receipt and the only target of
-- the notice, its credential and its rights session.
create table public.other_adult_held_uploads (
 id uuid primary key default gen_random_uuid(),
 upload_session_id uuid not null unique references public.upload_sessions(id) on delete cascade,
 subject_id uuid not null references public.subjects(id) on delete restrict,
 uploader_account_id uuid not null references auth.users(id) on delete restrict,
 uploader_consent_id uuid not null references public.subject_consents(id) on delete restrict,
 confirmation_principal_id uuid not null references public.subject_principals(id) on delete restrict,
 subject_binding_revision bigint not null check (subject_binding_revision>0),
 storage_object_id uuid not null,
 object_name text not null check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 file_type public.genome_file_type not null,
 size_bytes bigint not null check (size_bytes>0),
 raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
 decoded_sha256 text not null check (decoded_sha256 ~ '^[0-9a-f]{64}$'),
 upload_revision bigint not null check (upload_revision>0),
 held_at timestamptz not null default clock_timestamp(),
 fixed_deadline timestamptz not null,
 notice_outbox_id uuid not null unique,
 state text not null default 'pending'
  check (state in ('pending','confirmed','refused','deleted','expired','withdrawn')),
 analysis_state text not null default 'quarantined'
  check (analysis_state in ('quarantined','confirmed_blocked_current_gate')),
 confirmed_at timestamptz,
 terminal_at timestamptz,
 check (state<>'confirmed' or confirmed_at is not null),
 check ((analysis_state='quarantined')=(confirmed_at is null)),
 check ((state in ('pending','confirmed'))=(terminal_at is null)),
 check (fixed_deadline>held_at and fixed_deadline<=held_at+interval '30 days')
);
create unique index other_adult_held_uploads_one_pending_idx
 on public.other_adult_held_uploads(subject_id) where state='pending';
create index other_adult_held_uploads_uploader_idx
 on public.other_adult_held_uploads(uploader_account_id, state);
alter table public.other_adult_held_uploads enable row level security;
revoke all on table public.other_adult_held_uploads from public,anon,authenticated,inherit_upload_only,service_role;
grant select on table public.other_adult_held_uploads to service_role;

-- A held source is upload working state; its Storage objects stay in the
-- upload-working manifest of its session, which the executor deletes.
-- The next free position, as the embryo write fence registers its stores:
-- a fixed number would collide with whichever migration took it first.
insert into public.purge_target_stores(target_id,store_name,store_order)
 select 'upload-and-ingest-working-state','public.other_adult_held_uploads',coalesce(max(store_order),0)+1
 from public.purge_target_stores where target_id='upload-and-ingest-working-state';

alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign',
  'own_account_completion','other_adult_upload_artifact_sign'));

-- 2. The artifacts ----------------------------------------------------------
-- consent.upload-other-adult v1, approved by the owner on 2026-09-28 as
-- written. content/legal/consent.upload-other-adult/v1.md is the source;
-- content/legal/consent-upload-other-adult.test.ts holds this seed equal to it.
insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values('consent.upload-other-adult',1,'2a943b563a40098e7cb4a689c8a5a5489bd5c12f1e1a013c8a878f6a93a3fc6b',
$artifact$What this consent is:

You ask Inherit to hold a DNA file that belongs to another adult. You have their permission, and Inherit has invited them by email to say yes or no.

We cannot verify who you are or whose DNA this is. What we can do is make it impossible to do this by accident, keep a permanent record of exactly what you told us, and give the other person a real way to stop it.

We cannot check that the person accepting this invitation is the person whose DNA this is.

What happens to the file:

The file is held apart until the other person answers. Inherit does not read it to make a result, a report, an ancestry estimate or a Copilot answer. Nobody can open it, including you.

If they accept in their own account, the file moves to their account. From then on it is theirs, and only their own choices apply to it. Nothing is analysed until they choose.

If they refuse, delete the invitation, or do not answer within 30 days, Inherit deletes the file. Nothing is analysed.

You will not see their results. They can choose to share results with you later, one purpose at a time, and they can stop at any time.

What you confirm:

1. The person whose DNA this is is alive and 18 or older.

2. They gave me permission to upload their DNA to Inherit, and I can show that permission if asked.

3. I got this file lawfully, and they know I have it.

4. The email address I gave belongs to them.

5. They are not my employee, job applicant, tenant or student, they are not applying to me for insurance, and I am not in a legal case against them.

6. I understand that nothing is analysed until they accept, and that the file is deleted if they refuse or do not answer within 30 days.

7. I understand that I will not see their results unless they choose to share them with me.

How you sign:

You sign by ticking each statement and typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.$artifact$,
'You ask Inherit to hold another adult''s DNA file until they answer. Nobody can read it and nothing is analysed until they accept in their own account. If they refuse, or do not answer within 30 days, the file is deleted. You will not see their results unless they choose to share them. Signing this when it is not true may be a crime.',
date '2026-09-28');

-- consent.subject-adult-esignature v1, the person's own Path B artifact: a
-- draft the owner has not approved. No migration seeds it. The installer takes
-- only this exact text, pinned by hash, and only under TEST-LOCAL.
create function private.install_test_local_subject_esignature_artifact_v1(p_body text,p_summary text,
 p_effective_on date,p_test_jurisdiction boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_body is null or p_summary is null or p_effective_on is distinct from date '2026-09-28'
  -- pinned-body-sha256:consent.subject-adult-esignature
  or encode(extensions.digest(convert_to(p_body,'UTF8'),'sha256'),'hex')<>'eb8f46bcc608a8f59ef294bab88f8a1c59283ab3c9c5aded5b34229ec29b0b47'
  -- pinned-summary-sha256:consent.subject-adult-esignature
  or encode(extensions.digest(convert_to(p_summary,'UTF8'),'sha256'),'hex')<>'6fd980f2e7022245c21d35c0060d32c2dc5e01d36157c5c7088b77749c047dff' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
 values('consent.subject-adult-esignature',1,'eb8f46bcc608a8f59ef294bab88f8a1c59283ab3c9c5aded5b34229ec29b0b47',p_body,p_summary,p_effective_on)
 on conflict (artifact_key,version) do nothing;
 return exists(select 1 from public.consent_artifacts where artifact_key='consent.subject-adult-esignature'
  and version=1 and body_markdown=p_body and summary_markdown=p_summary and effective_on=p_effective_on);
end;
$function$;
revoke all on function private.install_test_local_subject_esignature_artifact_v1(text,text,date,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.install_test_local_subject_esignature_artifact_v1(text,text,date,boolean) to service_role;
create function public.install_test_local_subject_esignature_artifact_v1(p_body text,p_summary text,
 p_effective_on date,p_test_jurisdiction boolean)
returns boolean language sql security invoker set search_path=pg_catalog
as $function$ select private.install_test_local_subject_esignature_artifact_v1(p_body,p_summary,p_effective_on,p_test_jurisdiction); $function$;
revoke all on function public.install_test_local_subject_esignature_artifact_v1(text,text,date,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.install_test_local_subject_esignature_artifact_v1(text,text,date,boolean) to service_role;

-- A current artifact whose stored body still hashes to its recorded hash.
create function private.current_hashed_artifact_v1(p_key text)
returns public.consent_artifacts language sql stable security definer set search_path=pg_catalog
as $function$
 select a.* from public.consent_artifacts a where a.artifact_key=p_key and a.superseded_at is null
  and a.published_at<=clock_timestamp() and a.effective_on<=timezone('UTC',clock_timestamp())::date
  and a.body_sha256=encode(extensions.digest(convert_to(a.body_markdown,'UTF8'),'sha256'),'hex');
$function$;
revoke all on function private.current_hashed_artifact_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.current_hashed_artifact_v1(text) to service_role;

-- 3. The uploader -----------------------------------------------------------
-- The acting account: live, adult, not deleting, on a live session, with its
-- own self subject and account principal.
create function private.path_b_uploader_v1(p_account_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c jsonb; v_self uuid; v_principal uuid; v_code text;
begin
 select id into v_self from public.subjects where subject_account_id=p_account_id
  and subject_class='self' and lifecycle='active';
 if v_self is null then raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_upload_context_v1(p_account_id,p_session_id,v_self);
 perform 1 from auth.users where id=p_account_id and (banned_until is null or banned_until<=clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 if c->>'birthDateState'<>'adult' then raise exception using errcode='55000',message='adult_account_required'; end if;
 select sp.id into v_principal from public.subject_principals sp where sp.subject_id=v_self
  and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active'
 order by sp.created_at limit 1 for share;
 if v_principal is null then raise exception using errcode='42501',message='not_found'; end if;
 select jurisdiction_code into v_code from public.profiles where id=p_account_id;
 return jsonb_build_object('accountRevision',c->'accountRevision','authSessionRevision',c->'authSessionRevision',
  'jurisdictionRevision',c->'jurisdictionRevision','jurisdictionCode',coalesce(v_code,'ZZ'),
  'principalId',v_principal,'selfSubjectId',v_self);
end;
$function$;
revoke all on function private.path_b_uploader_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_uploader_v1(uuid,uuid) to service_role;

-- The uploader's current Tier-2 signature of consent.upload-other-adult for
-- this subject, hash-verified, at the uploader's current jurisdiction revision.
create function private.path_b_uploader_consent_v1(p_account_id uuid,p_subject_id uuid,p_principal_id uuid,
 p_jurisdiction_revision bigint)
returns uuid language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v_consent uuid;
begin
 select sc.id into v_consent from public.subject_consents sc
 join public.consent_signatures cs on cs.id=sc.signature_id
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where sc.subject_id=p_subject_id and sc.account_id=p_account_id and sc.consent_type='upload_class'
  and sc.scope=array['store'] and sc.revoked_at is null and (sc.expires_at is null or sc.expires_at>clock_timestamp())
  and cs.target_kind='subject' and cs.target_id=p_subject_id and cs.signer_account_id=p_account_id
  and cs.signer_principal_id=p_principal_id and cs.jurisdiction_revision=p_jurisdiction_revision
  and cs.purpose='other-adult-upload'
  -- statement-keys:consent.upload-other-adult
  and cs.statement_keys=array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject','no-excluded-relationship','held-until-accepted','no-uploader-access']
  and ca.artifact_key='consent.upload-other-adult' and ca.superseded_at is null
  and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 order by cs.signed_at desc limit 1
 for share of sc,cs,ca;
 return v_consent;
end;
$function$;
revoke all on function private.path_b_uploader_consent_v1(uuid,uuid,uuid,bigint)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_uploader_consent_v1(uuid,uuid,uuid,bigint) to service_role;

-- 4. Reserving a Path B draft (api.subject-drafts, closed-subject-draft-create-v1)
-- The body receives one digest: the active revision's, handed over by the
-- keyed definer below once the presented set has resolved against the
-- keyring. The contact row and its index take that digest's revision, and the
-- keyring's link trigger indexes the same contact under every other usable
-- revision of the declared set.
create function private.create_path_b_adult_draft_core_v1(p_account_id uuid,p_session_id uuid,p_display_name text,
 p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,p_test_jurisdiction boolean)
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
 select * into d from public.adult_subject_drafts where owner_account_id=p_account_id and request_key=p_request_key;
 if d.id is not null then
  return jsonb_build_object('subjectDraftId',d.subject_id,'state','awaiting_uploader_artifact',
   'next','sign_uploader_artifact','expiresAt',d.fixed_expires_at); end if;
 insert into public.subjects(owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values(p_account_id,null,'other_adult','adult',v_name,'draft') returning id into v_subject;
 insert into public.subject_demographics(subject_id,date_of_birth) values(v_subject,p_date_of_birth);
 insert into public.subject_principals(subject_id,account_id,principal_kind,status)
 values(v_subject,null,'non_account_subject','pending') returning id into v_principal;
 insert into public.adult_subject_drafts(owner_account_id,subject_id,draft_revision,state,fixed_expires_at,
  adult_flow,confirmation_mode,evidence_kind,request_key)
 values(p_account_id,v_subject,1,'draft',v_expires,'path-b-subject-esignature','path-b-token-or-account',
  'esignature',p_request_key) returning * into d;
 insert into public.draft_participant_slots(adult_draft_id,slot_kind,principal_id,slot_revision,state)
 values(d.id,'adult_subject',v_principal,1,'pending');
 -- The revision the digest was computed under, never an assumed one: after a
 -- rotation an undeclared digest is refused here rather than filed as 1.
 v_revision:=private.contact_hmac_key_revision_v1(p_contact_hmac);
 insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,
  authority_revision,status)
 values(v_principal,p_contact_ciphertext,p_contact_hmac,v_revision,1,'current') returning id into v_contact;
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
 values(v_contact,p_contact_hmac,v_revision,'current',v_expires);
 perform private.append_legal_audit_event('subject-draft.created',null,'api.subject-drafts','accepted',
  jsonb_build_object('adult_flow','path-b-subject-esignature','revision',1));
 return jsonb_build_object('subjectDraftId',v_subject,'state','awaiting_uploader_artifact',
  'next','sign_uploader_artifact','expiresAt',v_expires);
end;
$function$;
revoke all on function private.create_path_b_adult_draft_core_v1(uuid,uuid,text,date,bytea,text,text,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
-- The keyed definer (hmac_keyring, invitation_keyring_quota_doors): the shared
-- invitation transition lock first, so no call sees half a rotation; then the
-- presented set resolved against the keyring, failing closed when a usable
-- revision is missing; then the set declared for this transaction only.
create function private.create_path_b_adult_draft_keyed_v1(p_account_id uuid,p_session_id uuid,p_display_name text,
 p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_set jsonb; v_result jsonb;
begin
 perform private.lock_invitation_transitions_v1();
 v_set:=private.resolve_hmac_set_v1('contact',p_contact_hmac,p_contact_hmac_set);
 if v_set is not null then
  perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set)); end if;
 v_result:=private.create_path_b_adult_draft_core_v1(p_account_id,p_session_id,p_display_name,p_date_of_birth,
  p_contact_ciphertext,coalesce(v_set->>private.hmac_active_revision_v1('contact')::text,p_contact_hmac),
  p_request_key,p_test_jurisdiction);
 perform private.declare_contact_alias_groups_v1('[]'::jsonb);
 return v_result;
end;
$function$;
revoke all on function private.create_path_b_adult_draft_keyed_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.create_path_b_adult_draft_keyed_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 to service_role;
create function public.create_path_b_adult_draft_v1(p_account_id uuid,p_session_id uuid,p_display_name text,
 p_date_of_birth date,p_contact_ciphertext bytea,p_contact_hmac text,p_request_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb default null)
returns jsonb language sql security invoker set search_path=''
as $function$ select private.create_path_b_adult_draft_keyed_v1(p_account_id,p_session_id,p_display_name,p_date_of_birth,p_contact_ciphertext,p_contact_hmac,p_request_key,p_test_jurisdiction,p_contact_hmac_set); $function$;
revoke all on function public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb) to service_role;

-- 5. The Path B subject -----------------------------------------------------
-- What the uploader may sign for: their own Path B draft (not yet confirmed)
-- or the confirmed Path B subject it became. A Path A reservation is never a
-- target: its draft carries path-a-own-account.
create function private.path_b_signing_target_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 select * into d from public.adult_subject_drafts where subject_id=p_subject_id for share;
 if s.id is null or d.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.owner_account_id is distinct from p_account_id or d.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not null
  or d.adult_flow<>'path-b-subject-esignature'
  or not ((d.state in ('draft','invited') and s.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
   or (d.state='confirmed' and s.lifecycle='active')) then
  raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('subjectBindingRevision',s.subject_binding_revision,'draftState',d.state);
end;
$function$;
revoke all on function private.path_b_signing_target_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_signing_target_v1(uuid,uuid) to service_role;

-- What the uploader may upload for: the confirmed Path B subject they own,
-- bound to one current terminally completed confirmation principal whose
-- signature of the subject artifact is at the current binding revision and
-- whose contact is live.
create function private.path_b_subject_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare s public.subjects%rowtype; d public.adult_subject_drafts%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_signature uuid;
begin
 select * into s from public.subjects where id=p_subject_id for share;
 if s.id is null or s.subject_class<>'other_adult' or s.upload_class is distinct from 'adult'
  or s.lifecycle<>'active' or s.owner_account_id is distinct from p_account_id or s.subject_account_id is not null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- path-b-only: a Path A subject never has a confirmed Path B draft.
 select * into d from public.adult_subject_drafts where subject_id=s.id and owner_account_id=p_account_id
  and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;
 if d.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into p from public.subject_principals where subject_id=s.id and principal_kind='non_account_subject'
  and status='active' and account_id is null for share;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for share;
 if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
 select cs.id into v_signature from public.consent_signatures cs
 join public.consent_artifacts ca on ca.artifact_key=cs.artifact_key and ca.version=cs.artifact_version
  and ca.body_sha256=cs.artifact_body_sha256
 where cs.target_kind='subject' and cs.target_id=s.id and cs.signer_principal_id=p.id and cs.signer_account_id is null
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
revoke all on function private.path_b_subject_v1(uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.path_b_subject_v1(uuid,uuid) to service_role;

-- 6. The held-upload store authority ----------------------------------------
-- The same snapshot shape as private.own_upload_store_authority_v1, so the
-- existing transport compares it with the session row unchanged. It is never
-- a reader's authority: every reader keeps calling the own-subject authority,
-- which refuses an uploader who holds no binding to this subject.
create function private.other_adult_upload_store_authority_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u jsonb; t jsonb; v_consent uuid; v_session bigint;
begin
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 t:=private.path_b_subject_v1(p_account_id,p_subject_id);
 v_consent:=private.path_b_uploader_consent_v1(p_account_id,p_subject_id,(u->>'principalId')::uuid,
  (u->>'jurisdictionRevision')::bigint);
 if v_consent is null then raise exception using errcode='55000',message='upload_consent_required'; end if;
 select coalesce(refresh_token_counter,0)+1 into v_session from auth.sessions
  where id=p_session_id and user_id=p_account_id for share;
 return jsonb_build_object('accountRevision',u->'accountRevision','authSessionRevision',u->'authSessionRevision',
  'jurisdictionRevision',u->'jurisdictionRevision','subjectBindingRevision',t->'subjectBindingRevision',
  'accountBindingRevision',t->'principalRevision','subjectLifecycleRevision',t->'subjectLifecycleRevision',
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

-- 7. Signing consent.upload-other-adult --------------------------------------
create function private.present_other_adult_upload_artifact_v1(p_account_id uuid,p_session_id uuid,
 p_subject_id uuid,p_nonce_hash text,p_expires_at timestamptz,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare a public.consent_artifacts%rowtype;
begin
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$' or p_expires_at is null
  or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 perform private.path_b_uploader_v1(p_account_id,p_session_id);
 perform private.path_b_signing_target_v1(p_account_id,p_subject_id);
 a:=private.current_hashed_artifact_v1('consent.upload-other-adult');
 if a.artifact_key is null then raise exception using errcode='55000',message='consent_artifact_unavailable'; end if;
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
declare u jsonb; t jsonb; a public.consent_artifacts%rowtype; v_nonce public.account_operation_nonces%rowtype;
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
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 t:=private.path_b_signing_target_v1(p_account_id,p_subject_id);
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
 values(a.artifact_key,a.version,a.body_sha256,(u->>'principalId')::uuid,p_account_id,'subject',p_subject_id,
  'other-adult-upload',p_statement_keys,p_signing_name_ciphertext,u->>'jurisdictionCode',
  (u->>'jurisdictionRevision')::bigint,(t->>'subjectBindingRevision')::bigint)
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

-- 8. The e-signature request (api.invitations, path-b-subject-esignature) -----
-- Only after the uploader's signature, and only to the exact address the draft
-- holds: a mismatch, a foreign or used draft, a missing signature and a live
-- refusal bar all return the same receipt and write nothing. The body compares
-- one digest (the one the stored contact was written under); the keyed definer
-- below declares the whole presented set first, so the bar check walks every
-- usable revision.
create function private.create_path_b_invitation_core_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_contact_hmac text,p_idempotency_key text,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u jsonb; d public.adult_subject_drafts%rowtype; s public.subjects%rowtype; p public.subject_principals%rowtype;
 e public.encrypted_contact_references%rowtype; v_slot uuid; v_invitation uuid; v_outbox uuid;
 v_expires timestamptz; v_received constant jsonb:=jsonb_build_object('status','received');
begin
 perform private.lock_invitation_transitions_v1();
 if p_test_jurisdiction is distinct from true then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_contact_hmac is null or p_contact_hmac!~'^[0-9a-f]{64}$'
  or p_idempotency_key is null or p_idempotency_key!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 u:=private.path_b_uploader_v1(p_account_id,p_session_id);
 if exists(select 1 from public.mail_outbox where idempotency_key=p_idempotency_key
  and template_id='adult-subject-invitation' and target_kind='subject_invitation') then return v_received; end if;
 select * into d from public.adult_subject_drafts where subject_id=p_subject_id and owner_account_id=p_account_id
  and adult_flow='path-b-subject-esignature' and state='draft' and fixed_expires_at>clock_timestamp() for update;
 select * into s from public.subjects where id=p_subject_id for update;
 if d.id is null or s.id is null or s.lifecycle<>'draft' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is not null then return v_received; end if;
 select sp.* into p from public.draft_participant_slots slot join public.subject_principals sp on sp.id=slot.principal_id
  where slot.adult_draft_id=d.id and slot.slot_kind='adult_subject' and slot.state='pending'
   and sp.subject_id=s.id and sp.principal_kind='non_account_subject' and sp.status='pending'
  for update of sp;
 select * into e from public.encrypted_contact_references where principal_id=p.id and status='current'
  and contact_ciphertext is not null and authority_revision=p.principal_revision for update;
 if p.id is null or e.id is null or e.contact_hmac<>p_contact_hmac
  or private.path_b_uploader_consent_v1(p_account_id,s.id,(u->>'principalId')::uuid,
   (u->>'jurisdictionRevision')::bigint) is null
  or private.invitation_contact_barred_v1(p_contact_hmac) then return v_received; end if;
 select id into v_slot from public.draft_participant_slots where adult_draft_id=d.id and principal_id=p.id;
 v_expires:=least(clock_timestamp()+interval '30 days',d.fixed_expires_at);
 insert into public.subject_invitations(target_kind,target_id,inviter_principal_id,invitee_principal_id,email_hmac,
  email_encrypted,token_hash,invitation_kind,status,invitation_revision,expires_at)
 values('subject',s.id,(u->>'principalId')::uuid,p.id,e.contact_hmac,e.contact_ciphertext,
  encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),'adult_subject','pending',1,v_expires)
 returning id into v_invitation;
 insert into public.invitation_candidates(invitation_id,draft_slot_id,contact_reference_id,candidate_revision,state)
 values(v_invitation,v_slot,e.id,1,'issued');
 insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
  recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
 values('adult-subject-invitation','adult-subject-invitation','subject_invitation',v_invitation,p.id,e.id,
  p.principal_revision,1,p_idempotency_key,'adult-subject-invitation',v_invitation,
  jsonb_build_object('request','esignature'),v_expires)
 returning id into v_outbox;
 insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
 values(v_outbox,'adult-subject-invitation','subject_invitation',v_invitation,1,'pending',v_expires);
 update public.adult_subject_drafts set state='invited' where id=d.id;
 perform private.append_legal_audit_event('invitation.issued',null,'api.invitations','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow','path-b-subject-esignature','revision',1));
 return v_received;
end;
$function$;
revoke all on function private.create_path_b_invitation_core_v1(uuid,uuid,uuid,text,text,boolean)
 from public,anon,authenticated,service_role,inherit_upload_only;
-- The keyed definer: the transition lock, then the per-account and per-network
-- invitation attempt quota (global-contact-refusal-bar-v1.quotaAuthority)
-- before any identity, draft or address match. A missing key set fails the
-- whole call; an exhausted quota writes nothing else and returns the receipt
-- a barred address gets. Then the presented set resolves against the keyring
-- (a set missing a usable revision fails closed) and is declared, and the body
-- is handed the digest under the revision the draft's contact was written
-- under, or the active one, which the body then refuses as a mismatch.
create function private.create_path_b_invitation_keyed_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_contact_hmac text,p_idempotency_key text,p_test_jurisdiction boolean,p_contact_hmac_set jsonb,p_quota_keys jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_set jsonb; v_contact text:=p_contact_hmac; v_stored public.encrypted_contact_references%rowtype;
 v_result jsonb;
begin
 perform private.lock_invitation_transitions_v1();
 if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then
  return jsonb_build_object('status','received'); end if;
 v_set:=private.resolve_hmac_set_v1('contact',p_contact_hmac,p_contact_hmac_set);
 if v_set is not null then
  perform private.declare_contact_alias_groups_v1(jsonb_build_array(v_set));
  select e.* into v_stored from public.adult_subject_drafts d
   join public.draft_participant_slots slot on slot.adult_draft_id=d.id
    and slot.slot_kind='adult_subject' and slot.state='pending'
   join public.subject_principals sp on sp.id=slot.principal_id and sp.status='pending'
   join public.encrypted_contact_references e on e.principal_id=sp.id and e.status='current'
   where d.subject_id=p_subject_id and d.owner_account_id=p_account_id
    and d.adult_flow='path-b-subject-esignature'
   limit 1;
  v_contact:=private.presented_contact_digest_v1(v_set,v_stored.contact_hmac,v_stored.key_revision);
 end if;
 v_result:=private.create_path_b_invitation_core_v1(p_account_id,p_session_id,p_subject_id,v_contact,
  p_idempotency_key,p_test_jurisdiction);
 perform private.declare_contact_alias_groups_v1('[]'::jsonb);
 return v_result;
end;
$function$;
revoke all on function private.create_path_b_invitation_keyed_v1(uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function private.create_path_b_invitation_keyed_v1(uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 to service_role;
create function public.create_path_b_invitation_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_contact_hmac text,p_idempotency_key text,p_test_jurisdiction boolean,
 p_contact_hmac_set jsonb default null,p_quota_keys jsonb default null)
returns jsonb language sql security invoker set search_path=''
as $function$ select private.create_path_b_invitation_keyed_v1(p_account_id,p_session_id,p_subject_id,p_contact_hmac,p_idempotency_key,p_test_jurisdiction,p_contact_hmac_set,p_quota_keys); $function$;
revoke all on function public.create_path_b_invitation_v1(uuid,uuid,uuid,text,text,boolean,jsonb,jsonb)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.create_path_b_invitation_v1(uuid,uuid,uuid,text,text,boolean,jsonb,jsonb) to service_role;

-- 9. The person signs (api.withdraw confirm, adult-subject-confirmation-v1) --
-- The no-account branch of path-b-token-or-account: the rights session the
-- request mail opened is the signature channel. The draft becomes an
-- uploader-owned other_adult subject with one active non-account principal;
-- the draft row stays, confirmed, as the immutable record of its flow.
create function private.confirm_path_b_subject_v1(p_session_hash text,p_nonce text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,p_jurisdiction_code text,
 p_test_jurisdiction boolean)
returns text language plpgsql security definer set search_path=pg_catalog,private
as $function$
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
  and adult_flow='path-b-subject-esignature' and fixed_expires_at>v_now for update;
 select * into s from public.subjects where id=v_invitation.target_id for update;
 select * into p from public.subject_principals where id=v_invitation.invitee_principal_id and subject_id=s.id
  and status='pending' and principal_kind='non_account_subject' for update;
 select date_of_birth into v_dob from public.subject_demographics where subject_id=s.id;
 if d.id is null or s.id is null or p.id is null or s.lifecycle<>'draft' or s.subject_account_id is not null
  or s.owner_account_id is distinct from d.owner_account_id or v_session.principal_id<>p.id
  or v_dob is null or v_dob>(timezone('UTC',v_now)::date-interval '18 years')::date then
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
 perform private.append_legal_audit_event('invitation.accepted',null,'api.withdraw','accepted',
  jsonb_build_object('invitation_kind','adult_subject','adult_flow','path-b-subject-esignature','revision',1));
 return 'accepted';
end;
$function$;
revoke all on function private.confirm_path_b_subject_v1(text,text,integer,text,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.confirm_path_b_subject_v1(text,text,integer,text,text[],bytea,text,boolean) to service_role;
create function public.confirm_path_b_subject_v1(p_session_hash text,p_nonce text,p_artifact_version integer,
 p_artifact_body_sha256 text,p_statement_keys text[],p_signing_name_ciphertext bytea,p_jurisdiction_code text,
 p_test_jurisdiction boolean)
returns text language sql security invoker set search_path=pg_catalog
as $function$ select private.confirm_path_b_subject_v1(p_session_hash,p_nonce,p_artifact_version,p_artifact_body_sha256,p_statement_keys,p_signing_name_ciphertext,p_jurisdiction_code,p_test_jurisdiction); $function$;
revoke all on function public.confirm_path_b_subject_v1(text,text,integer,text,text[],bytea,text,boolean)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.confirm_path_b_subject_v1(text,text,integer,text,text[],bytea,text,boolean) to service_role;

-- 10. Issuance ---------------------------------------------------------------
-- The own issuer's body with the held-upload authority, one pending revision
-- per subject (the unique pending index also refuses a second completion), a
-- declared hash, and held bytes counted against the uploader's allowance.
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
 if exists(select 1 from public.other_adult_held_uploads where subject_id=p_subject_id and state='pending') then
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

-- 11. The transport: current bodies, one authority call each dispatched ------
-- Recovery is unchanged for both kinds.
-- There is no session-independent finalization: a retry requires the same
-- currently authorized originating session within the original upload expiry,
-- and no job resumes one.

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
  -- 20260928150000: a held revision is finished; it waits for its subject.
  if u.status='held' then return jsonb_build_object('status','held','fileId',(select h.id from public.other_adult_held_uploads h where h.upload_session_id=u.id)); end if;
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
 -- 20260928150000: a held revision is finished; it waits for its subject.
 if u.status='held' then return jsonb_build_object('status','held','fileId',(select h.id from public.other_adult_held_uploads h where h.upload_session_id=u.id)); end if;
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
 v_kind text; v_deadline timestamptz; v_held_at timestamptz; r uuid; t jsonb; v_revision uuid; v_outbox uuid;
begin
 -- 20260928150000: a held upload serializes with the invitation and rights
 -- transitions (activation, confirmation, refusal) before its authority is read.
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
 -- 20260928150000: another adult's file stops here. No genome_files row, no
 -- genome_storage_objects row and no job exist; the validated object is
 -- recorded only in the held revision, which no reader reads. The same commit
 -- queues the upload-time notice and its confirmation credential, or nothing
 -- commits (upload-time-rights-notice-v1.transaction).
 if u.upload_authority_kind='other-adult-held' then
  t:=private.path_b_subject_v1(p_account_id,u.subject_id);
  v_revision:=gen_random_uuid();
  v_held_at:=clock_timestamp();
  v_deadline:=v_held_at+interval '30 days';
  insert into public.mail_outbox(template_id,purpose,target_kind,target_id,recipient_principal_id,contact_reference_id,
   recipient_authority_revision,semantic_revision,idempotency_key,token_purpose,token_target_id,template_payload,expires_at)
  values('adult-upload-notice','adult-upload-confirmation','adult_upload_revision',v_revision,(t->>'principalId')::uuid,
   (t->>'contactReferenceId')::uuid,(t->>'principalRevision')::bigint,u.upload_revision,
   encode(extensions.digest(convert_to('adult-upload-notice-v1:'||v_revision::text,'UTF8'),'sha256'),'hex'),
   'adult-upload-confirmation',v_revision,
   jsonb_build_object('fileKind',case when kind::text like 'array_%' then 'array' else 'vcf' end,
    'uploadedOn',to_char(timezone('UTC',v_held_at),'YYYY-MM-DD'),
    'deleteBy',to_char(timezone('UTC',v_deadline),'YYYY-MM-DD')),
   v_deadline)
  returning id into v_outbox;
  insert into public.token_candidates(outbox_id,purpose,target_kind,target_id,token_revision,state,expires_at)
  values(v_outbox,'adult-upload-confirmation','adult_upload_revision',v_revision,1,'pending',v_deadline);
  insert into public.other_adult_held_uploads(id,upload_session_id,subject_id,uploader_account_id,uploader_consent_id,
   confirmation_principal_id,subject_binding_revision,storage_object_id,object_name,file_type,size_bytes,raw_sha256,
   decoded_sha256,upload_revision,held_at,fixed_deadline,notice_outbox_id)
  values(v_revision,u.id,u.subject_id,p_account_id,u.upload_consent_id,(t->>'principalId')::uuid,
   (t->>'subjectBindingRevision')::bigint,p_storage_object_id,u.final_object_name::text,kind,u.expected_size,
   p_raw_sha256,p_decoded_sha256,u.upload_revision,v_held_at,v_deadline,v_outbox);
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
  return jsonb_build_object('fileId',v_revision,'status','stored_quarantined','analysisState','quarantined',
   'noticeState','queued');
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

-- 12. The notice and its credential (upload-time-rights-notice-v1) ------------
-- A notice row is current only while its revision is pending before its fixed
-- deadline and its subject, principal and contact are exactly as they were.
create function private.adult_upload_mail_current_v1(m public.mail_outbox)
returns boolean language sql stable security invoker set search_path=''
as $function$
 select exists(select 1 from public.other_adult_held_uploads h
  join public.subjects s on s.id=h.subject_id
  join public.subject_principals sp on sp.id=h.confirmation_principal_id
  join public.encrypted_contact_references e on e.id=m.contact_reference_id and e.principal_id=sp.id
  join public.token_candidates tc on tc.outbox_id=m.id
  where m.template_id='adult-upload-notice' and m.purpose='adult-upload-confirmation'
   and m.token_purpose='adult-upload-confirmation' and m.target_kind='adult_upload_revision'
   and m.target_id=h.id and m.token_target_id=h.id and h.notice_outbox_id=m.id
   and h.state='pending' and h.fixed_deadline>statement_timestamp()
   and s.lifecycle='active' and s.subject_binding_revision=h.subject_binding_revision
   and sp.id=m.recipient_principal_id and sp.status='active' and sp.principal_revision=m.recipient_authority_revision
   and e.status='current' and e.contact_ciphertext is not null and e.authority_revision=m.recipient_authority_revision
   and tc.purpose='adult-upload-confirmation' and tc.target_kind='adult_upload_revision' and tc.target_id=h.id
   and tc.state in ('pending','issued') and tc.expires_at>statement_timestamp());
$function$;
revoke all on function private.adult_upload_mail_current_v1(public.mail_outbox) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.adult_upload_mail_current_v1(public.mail_outbox) to service_role;

create or replace function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea,
  delivery_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_raw_token text;
  v_token_hash text;
begin
  perform private.lock_invitation_transitions_v1();
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.invitation_terminal_notice_id is null
    and m.state in ('queued', 'claimed')
    and not exists (
      select 1
      from public.subject_principals sp
      join public.encrypted_contact_references ecr
        on ecr.id = m.contact_reference_id
       and ecr.principal_id = sp.id
      where sp.id = m.recipient_principal_id
        and (
          sp.status = 'active'
          or (
            m.purpose in ('adult-subject-invitation', 'co-parent-invitation')
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  -- A live contact is not enough: readiness belongs to this exact source.
  -- Invalidated rows retain their ordinary history/retention rules.
  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'file_target_unavailable'
  where m.template_id = 'report-ready' and m.state in ('queued', 'claimed')
    and private.file_ready_mail_current_v1(m) is not true;

  -- Recheck the exact invitation and all stored contact-key aliases before
  -- token creation, under the same transition lock as refusal/acceptance.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='invitation_authority_stale'
  where m.state in('queued','claimed')
    and m.token_purpose in('adult-subject-invitation','co-parent-invitation')
    and not private.invitation_mail_current_v1(m);

  -- 20260928150000: an upload notice is current only while its revision is.
  update public.mail_outbox m set state='invalidated',claimed_at=null,
    last_outcome_code='upload_revision_stale'
  where m.state in('queued','claimed')
    and m.token_purpose='adult-upload-confirmation'
    and not private.adult_upload_mail_current_v1(m);

  select m.* into v_outbox
  from public.mail_outbox m
  where m.invitation_terminal_notice_id is null and (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
    and (m.template_id <> 'report-ready' or private.file_ready_mail_current_v1(m) is true)
  order by m.not_before, m.created_at
  for update skip locked
  limit 1;

  if v_outbox.id is null then return; end if;

  update public.mail_outbox m
  set state = 'claimed',
      claimed_at = clock_timestamp(),
      attempt_count = (m.attempt_count + 1)::smallint,
      last_outcome_code = null
  where m.id = v_outbox.id
  returning m.* into v_outbox;

  if v_outbox.token_purpose in ('adult-subject-invitation', 'co-parent-invitation') then
    if not private.invitation_mail_current_v1(v_outbox) then return; end if;
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.target_kind = 'subject_invitation'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;

    update public.subject_invitations
    set token_hash = v_token_hash
    where id = v_candidate.target_id
      and status = 'pending'
      and expires_at > clock_timestamp();
    if not found then
      raise exception using errcode = '55000', message = 'invitation is not current';
    end if;
  end if;

  -- 20260928150000: the upload-time notice's confirmation credential.
  if v_outbox.token_purpose = 'adult-upload-confirmation' then
    if not private.adult_upload_mail_current_v1(v_outbox) then return; end if;
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.purpose = 'adult-upload-confirmation'
      and tc.target_kind = 'adult_upload_revision'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;
  end if;

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    v_outbox.idempotency_key,
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;

create or replace function private.authorize_mail_submission_v1(p_outbox uuid,p_attempt smallint)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.mail_outbox%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select * into m from public.mail_outbox where id=p_outbox for update;
 if m.id is null or m.state<>'claimed' or m.attempt_count is distinct from p_attempt
  or m.expires_at<=clock_timestamp() or m.invitation_terminal_notice_id is not null then return false; end if;
 if not exists(select 1 from public.encrypted_contact_references e
  join public.subject_principals sp on sp.id=e.principal_id
  where e.id=m.contact_reference_id and sp.id=m.recipient_principal_id
   and e.status='current' and e.contact_ciphertext is not null
   and e.authority_revision=m.recipient_authority_revision and sp.principal_revision=m.recipient_authority_revision
   and (sp.status='active' or (sp.status='pending' and m.token_purpose in('adult-subject-invitation','co-parent-invitation')))
 ) then return false; end if;
 if m.token_purpose in('adult-subject-invitation','co-parent-invitation') then
  if not private.invitation_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   join public.subject_invitations i on i.id=tc.target_id and i.token_hash=th.token_hash
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 -- 20260928150000: an upload notice goes out only while its revision is pending.
 if m.token_purpose='adult-upload-confirmation' then
  if not private.adult_upload_mail_current_v1(m) or not exists(
   select 1 from public.token_candidates tc join public.token_hashes th on th.candidate_id=tc.id
   where tc.outbox_id=m.id and tc.state='issued' and th.status='current'
  ) then return false; end if;
 end if;
 if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;
 return true;
end;
$$;

create or replace function public.activate_rights_session_v1(
  p_token_hash text,
  p_session_hash text,
  p_form_nonce text
)
returns table (
  purpose text,
  target_kind text,
  target_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_purpose text;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_adult_draft public.adult_subject_drafts%rowtype;
  v_expires_at timestamptz;
  v_held public.other_adult_held_uploads%rowtype;
begin
  perform private.lock_invitation_transitions_v1();
  v_now := clock_timestamp();
  if p_token_hash is null or p_session_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  -- The activation form's one-time nonce is recorded before any read, so a
  -- replayed form fails closed even when its token is still current.
  perform private.consume_embryo_operation_nonce_v1(
    p_form_nonce, null, null, 'rights_activate', 'form', null
  );

  select th.* into v_token
  from public.token_hashes th
  where th.token_hash = p_token_hash and th.status = 'current'
  for update;
  if v_token.id is null then return; end if;

  select tc.purpose into v_purpose
  from public.token_candidates tc
  where tc.id = v_token.candidate_id;

  if v_purpose = 'adult-subject-invitation' then
    v_invitation := private.current_adult_subject_invitation_v1(v_token.id);
    if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

    select d.* into v_adult_draft
    from public.adult_subject_drafts d
    where d.subject_id = v_invitation.target_id
      and d.state = 'invited'
      and d.fixed_expires_at > v_now
    for update;
    if v_adult_draft.id is null then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_invitation.invitee_principal_id, 'adult-subject-invitation',
      'subject', v_invitation.target_id, v_invitation.invitation_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-subject-invitation')
    );

    return query select
      'adult-subject-invitation'::text, 'subject'::text,
      v_invitation.target_id, v_expires_at;
    return;
  end if;

  -- 20260928150000: the upload-time notice's credential opens a session for
  -- exactly its pending revision, bound to the subject's confirmation principal.
  if v_purpose = 'adult-upload-confirmation' then
    select h.* into v_held
    from public.token_candidates tc
    join public.other_adult_held_uploads h on h.id = tc.target_id
    where tc.id = v_token.candidate_id
      and tc.purpose = 'adult-upload-confirmation'
      and tc.target_kind = 'adult_upload_revision'
      and tc.state = 'issued' and tc.expires_at > v_now
      and tc.token_revision = v_token.token_revision
      and h.notice_outbox_id = tc.outbox_id
      and h.state = 'pending' and h.fixed_deadline > v_now
    for update of h;
    if v_held.id is null or not exists (
      select 1 from public.subjects s
      join public.subject_principals sp on sp.id = v_held.confirmation_principal_id
        and sp.subject_id = s.id and sp.status = 'active'
      where s.id = v_held.subject_id and s.lifecycle = 'active'
        and s.subject_binding_revision = v_held.subject_binding_revision
    ) then return; end if;

    v_expires_at := least(v_now + interval '24 hours', v_held.fixed_deadline);

    insert into public.rights_sessions (
      token_hash_id, principal_id, purpose, target_kind, target_id,
      authority_revision, session_hash, status, expires_at
    ) values (
      v_token.id, v_held.confirmation_principal_id, 'adult-upload-confirmation',
      'adult_upload_revision', v_held.id, v_held.subject_binding_revision,
      p_session_hash, 'active', v_expires_at
    );

    update public.token_hashes
    set status = 'consumed', ended_at = v_now
    where id = v_token.id;

    perform private.append_legal_audit_event(
      'rights.session.activated', null, 'api.rights-activate', 'accepted',
      jsonb_build_object('purpose', 'adult-upload-confirmation')
    );

    return query select
      'adult-upload-confirmation'::text, 'adult_upload_revision'::text,
      v_held.id, v_expires_at;
    return;
  end if;

  if v_purpose is distinct from 'co-parent-invitation' then return; end if;

  v_invitation := private.current_co_parent_invitation_v1(v_token.id);
  if v_invitation.id is null or private.invitation_contact_barred_v1(v_invitation.email_hmac) then return; end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return; end if;

  v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

  insert into public.rights_sessions (
    token_hash_id, principal_id, purpose, target_kind, target_id,
    authority_revision, session_hash, status, expires_at
  ) values (
    v_token.id, v_invitation.invitee_principal_id, 'co-parent-invitation',
    'cohort_draft', v_draft.id, v_invitation.invitation_revision,
    p_session_hash, 'active', v_expires_at
  );

  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id;

  perform private.append_legal_audit_event(
    'rights.session.activated', null, 'api.rights-activate', 'accepted',
    jsonb_build_object('purpose', 'co-parent-invitation')
  );

  return query select
    'co-parent-invitation'::text, 'cohort_draft'::text, v_draft.id, v_expires_at;
end;
$$;

revoke all on function public.activate_rights_session_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function public.activate_rights_session_v1(text, text, text)
  to service_role;

-- 13. The person answers one file revision (api.withdraw) ---------------------
-- Every revision ends the same way: its held session is rejected and made due
-- at once, so the existing upload-working executor deletes its staging and
-- final objects, then the session and this row. Nothing here reads the source.
create function private.end_other_adult_held_upload_v1(p_revision_id uuid,p_state text)
returns boolean language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h public.other_adult_held_uploads%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_state not in ('refused','deleted','expired','withdrawn') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 select * into h from public.other_adult_held_uploads where id=p_revision_id for update;
 if h.id is null or h.state not in ('pending','confirmed') then return false; end if;
 update public.upload_sessions set status='rejected',consumed_at=coalesce(consumed_at,v_now),
  finalization_cleanup_pending=true,expires_at=least(expires_at,v_now)
 where id=h.upload_session_id and status='held';
 if not found then raise exception using errcode='55000',message='held_upload_unavailable'; end if;
 update public.other_adult_held_uploads set state=p_state,terminal_at=v_now where id=h.id;
 update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='upload_revision_ended'
  where id=h.notice_outbox_id and state in ('queued','claimed');
 update public.token_candidates set state='invalidated' where outbox_id=h.notice_outbox_id and state in ('pending','issued');
 update public.token_hashes th set status='revoked',ended_at=v_now from public.token_candidates tc
  where tc.id=th.candidate_id and tc.outbox_id=h.notice_outbox_id and th.status='current';
 update public.rights_sessions set status='revoked',ended_at=v_now
  where purpose='adult-upload-confirmation' and target_kind='adult_upload_revision' and target_id=h.id and status='active';
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
 return true;
end;
$function$;
revoke all on function private.end_other_adult_held_upload_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The subject's own delete (revocation-and-purge for the exact adult subject,
-- with no uploader involvement): every file revision ends, the principal and
-- its contact are removed, and the uploader's store grant is revoked.
create function private.delete_path_b_subject_v1(p_subject_id uuid,p_state text)
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h record; n integer:=0; v_now timestamptz:=clock_timestamp();
begin
 for h in select id from public.other_adult_held_uploads where subject_id=p_subject_id
  and state in ('pending','confirmed') order by held_at,id loop
  if private.end_other_adult_held_upload_v1(h.id,p_state) then n:=n+1; end if;
 end loop;
 update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,
  subject_binding_revision=subject_binding_revision+1,updated_at=v_now
 where id=p_subject_id and lifecycle<>'purged';
 update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
  where principal_id in (select id from public.subject_principals where subject_id=p_subject_id) and status='current';
 update public.contact_hmac_indexes set status='revoked',expires_at=least(expires_at,v_now)
  where contact_reference_id in (select e.id from public.encrypted_contact_references e
   join public.subject_principals sp on sp.id=e.principal_id where sp.subject_id=p_subject_id) and status='current';
 update public.subject_principals set status='deleted',principal_revision=principal_revision+1
  where subject_id=p_subject_id and principal_kind='non_account_subject' and status in ('active','pending');
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn'
  where subject_id=p_subject_id and consent_type='upload_class' and revoked_at is null;
 update public.rights_sessions set status='revoked',ended_at=v_now where status='active'
  and ((target_kind='subject' and target_id=p_subject_id)
   or (target_kind='adult_upload_revision' and target_id in (select id from public.other_adult_held_uploads where subject_id=p_subject_id)));
 perform private.append_legal_audit_event('subject.deleted',null,'api.withdraw',p_state,
  jsonb_build_object('upload_class','other_adult','revisions',n));
 return n;
end;
$function$;
revoke all on function private.delete_path_b_subject_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The revision a live rights session of the upload-confirmation purpose was
-- opened for, locked, with its subject and principal unchanged since.
create function private.adult_upload_revision_session_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v_session public.rights_sessions%rowtype; h public.other_adult_held_uploads%rowtype; s public.subjects%rowtype;
begin
 if p_session_hash is null or p_session_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select rs.* into v_session from public.rights_sessions rs where rs.session_hash=p_session_hash
  and rs.purpose='adult-upload-confirmation' and rs.target_kind='adult_upload_revision'
  and rs.status='active' and rs.expires_at>clock_timestamp() for update;
 if v_session.id is null then return null; end if;
 select * into h from public.other_adult_held_uploads where id=v_session.target_id for update;
 select * into s from public.subjects where id=h.subject_id for update;
 if h.id is null or s.id is null or h.state not in ('pending','confirmed') or s.lifecycle<>'active'
  or h.confirmation_principal_id<>v_session.principal_id
  or s.subject_binding_revision<>v_session.authority_revision or h.subject_binding_revision<>v_session.authority_revision
  or not exists(select 1 from public.subject_principals sp where sp.id=h.confirmation_principal_id and sp.status='active') then
  return null; end if;
 return jsonb_build_object('sessionId',v_session.id,'revisionId',h.id,'subjectId',s.id,'state',h.state,
  'label',s.display_label,'fileKind',case when h.file_type::text like 'array_%' then 'array' else 'vcf' end,
  'addedOn',h.held_at,'deleteBy',h.fixed_deadline,'confirmedOn',h.confirmed_at);
end;
$function$;
revoke all on function private.adult_upload_revision_session_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function private.adult_upload_revision_session_v1(text) to service_role;

-- The read-only view: exactly what the uploader can see, and nothing else.
create function public.read_adult_upload_revision_v1(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb;
begin
 r:=private.adult_upload_revision_session_v1(p_session_hash);
 if r is null then return null; end if;
 return r-'sessionId'-'revisionId'-'subjectId';
end;
$function$;
revoke all on function public.read_adult_upload_revision_v1(text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.read_adult_upload_revision_v1(text) to service_role;

create function public.respond_adult_upload_revision_v1(p_session_hash text,p_nonce text,p_action text)
returns text language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare r jsonb; v_now timestamptz; h public.other_adult_held_uploads%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 if p_action is null or p_action not in ('confirm','refuse','delete') then return 'unavailable'; end if;
 r:=private.adult_upload_revision_session_v1(p_session_hash);
 if r is null then return 'unavailable'; end if;
 perform private.consume_embryo_operation_nonce_v1(p_nonce,null,null,'adult_upload_respond','rights_session',
  (r->>'sessionId')::uuid);
 select * into h from public.other_adult_held_uploads where id=(r->>'revisionId')::uuid for update;
 if p_action='confirm' then
  if h.state<>'pending' or h.fixed_deadline<=v_now then return 'unavailable'; end if;
  -- adult-upload-revision-confirmation-v1: only this revision. The other_adult
  -- common gates are not built, so the outcome is confirmed_blocked_current_gate
  -- with zero job, and no purpose grant is created or revived.
  update public.other_adult_held_uploads set state='confirmed',confirmed_at=v_now,
   analysis_state='confirmed_blocked_current_gate' where id=h.id;
  update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
   completed_at=v_now,terminal_outcome_code='subject_confirmed'
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and status in ('pending','retry');
  update public.retention_rows set state='cancelled',ended_at=v_now
  where retention_id='adult.unconfirmed-30d' and target_kind='upload_session' and target_id=h.upload_session_id
   and state in ('scheduled','active');
  perform private.append_legal_audit_event('upload.revision-confirmed',null,'api.withdraw','accepted',
   jsonb_build_object('upload_class','other_adult','revision',h.upload_revision,
    'outcome','confirmed_blocked_current_gate'));
  return 'confirmed';
 end if;
 update public.rights_sessions set status='consumed',ended_at=v_now where id=(r->>'sessionId')::uuid;
 if p_action='refuse' then
  -- adult-upload-revision-refusal-v1: only this revision and its source; the
  -- subject's confirmation, other files and the ended invitation stay as they are.
  perform private.end_other_adult_held_upload_v1(h.id,'refused');
  return 'refused';
 end if;
 perform private.delete_path_b_subject_v1(h.subject_id,'deleted');
 return 'deleted';
end;
$function$;
revoke all on function public.respond_adult_upload_revision_v1(text,text,text) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.respond_adult_upload_revision_v1(text,text,text) to service_role;

-- 14. The retention job's sweep ------------------------------------------------
-- Runs before the upload-working executor. It ends a pending revision whose
-- fixed deadline passed, every revision whose uploader is deleting their
-- account or whose subject is no longer active, and a Path B draft whose
-- request was never sent before its own deadline.
create function public.expire_due_other_adult_held_uploads_v1()
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare v record; n integer:=0; v_now timestamptz;
begin
 perform private.lock_invitation_transitions_v1();
 v_now:=clock_timestamp();
 for v in select h.id,
   case when p.id is null or p.deletion_requested_at is not null then 'withdrawn'
    when s.lifecycle<>'active' then 'deleted' else 'expired' end as reason
  from public.other_adult_held_uploads h
  join public.subjects s on s.id=h.subject_id
  left join public.profiles p on p.id=h.uploader_account_id
  where h.state in ('pending','confirmed') and ((h.state='pending' and h.fixed_deadline<=v_now)
   or p.id is null or p.deletion_requested_at is not null or s.lifecycle<>'active')
  order by h.fixed_deadline,h.id
 loop
  if private.end_other_adult_held_upload_v1(v.id,v.reason) then n:=n+1; end if;
 end loop;
 for v in select d.id,d.subject_id from public.adult_subject_drafts d
  where d.adult_flow='path-b-subject-esignature' and d.state='draft' and d.fixed_expires_at<=v_now
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
 return n;
end;
$function$;
revoke all on function public.expire_due_other_adult_held_uploads_v1() from public,anon,authenticated,inherit_upload_only;
grant execute on function public.expire_due_other_adult_held_uploads_v1() to service_role;

-- 15. What the uploader can see ------------------------------------------------
-- Their Path B people and one state each: the name they typed, dates and the
-- state of the latest file. No address, file name, genotype, hash or object.
create function private.other_adult_upload_targets_v1(p_account_id uuid,p_session_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
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
  where d.owner_account_id=p_account_id and d.adult_flow='path-b-subject-esignature'
   and s.owner_account_id=p_account_id and s.subject_class='other_adult'
   and ((d.state in ('draft','invited') and s.lifecycle='draft' and d.fixed_expires_at>clock_timestamp())
    or (d.state='confirmed' and s.lifecycle='active'))
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

-- 16. Path A stays Path A --------------------------------------------------------
-- The shared response body, unchanged except that its account acceptance, the
-- Path A confirmation, refuses a Path B request: a Path B draft is confirmed
-- only by the person's own artifact above, never by binding it to an account.

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

    -- 20260928150000: account acceptance is Path A's confirmation only. A
    -- Path B request is confirmed by the person's own artifact, never here.
    if v_draft.adult_flow <> 'path-a-own-account' then
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
